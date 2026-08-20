import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DispatchSession, loadPackFromFile, runBatch, runCall, sweepScripts } from '../src/index.js';
import type { SessionEvent } from '../src/index.js';

const packPath = fileURLToPath(new URL('../packs/us-nhtsa-emd/pack.json', import.meta.url));
const pack = loadPackFromFile(packPath);

test('unmatched choice answer triggers clarify-and-re-ask, then moves on', () => {
  const events: SessionEvent[] = [];
  const s = new DispatchSession(pack, { onEvent: (e) => events.push(e) });
  s.start();
  s.answer('9 Elm Ave');
  s.answer('555-0111');
  s.answer('chest pain');
  s.answer('50');

  const out = s.answer('banana'); // q_conscious, unintelligible
  assert.deepEqual(out.map((u) => u.stringId), ['clarify', 'q_conscious']);
  assert.deepEqual(
    events.filter((e) => e.type === 'clarify'),
    [{ type: 'clarify', nodeId: 'q_conscious', questionId: 'q_conscious', attempt: 1 }],
  );
  assert.equal(s.pending()?.questionId, 'q_conscious', 'still on the same question');

  const out2 = s.answer('banana again'); // attempts exhausted -> move on
  assert.equal(out2[0]!.stringId, 'q_breathing');
  const answered = events.find((e) => e.type === 'answer' && e.questionId === 'q_conscious');
  assert.equal(answered && 'option' in answered ? answered.option : undefined, null);

  // A matched answer later must not be affected by the earlier clarify.
  const out3 = s.answer('yes, breathing');
  assert.equal(out3[0]!.stringId, 'kq_cp_alert');
});

test('word-boundary matching: "I do not know" is not a "no"', () => {
  const s = new DispatchSession(pack);
  s.start();
  s.answer('9 Elm Ave');
  s.answer('555-0111');
  s.answer('chest pain');
  s.answer('50');
  const out = s.answer('I do not know'); // "not"/"know" must NOT match keyword "no"
  assert.deepEqual(out.map((u) => u.stringId), ['clarify', 'q_conscious']);
  const out2 = s.answer('no, he passed out'); // a real "no" still matches
  assert.equal(out2[0]!.stringId, 'q_breathing');
});

test('branch sweep enumerates every option combination per protocol', () => {
  const scripts = sweepScripts(pack, 'en');
  // case entry choices (2×2) × protocol extras: chest_pain 2×2 -> 16,
  // unconscious 2 -> 8, general_medical (fallback) -> 4
  assert.equal(scripts.length, 28);
  assert.ok(scripts.every((s) => s.slots['complaint'] !== undefined));
});

test('every swept call reaches dispatch with a response level (en + es)', () => {
  for (const locale of pack.locales) {
    const report = runBatch(pack, sweepScripts(pack, locale));
    assert.equal(report.completed, report.total, `incomplete calls in ${locale}: ${report.incomplete.join(', ')}`);
    assert.ok(report.calls.every((m) => m.result.response !== null));
    for (const d of ['cp_not_alert', 'cp_clammy', 'cp_default', 'unc_not_breathing', 'gm_default']) {
      assert.ok(report.byDeterminant[d], `determinant ${d} never reached in ${locale}`);
    }
    assert.ok(report.byResponse['ALS_HOT'] && report.byResponse['BLS_COLD']);
    assert.ok(report.avgTurns > 4);
  }
});

test('a confused caller clarifies but the call still completes', () => {
  const m = runCall(pack, {
    id: 'confused',
    locale: 'en',
    slots: { address: '1 Oak St', callback: '555-0122', complaint: 'chest pain', age: '70' },
    fallbackAnswer: 'ehh please hurry', // no option keywords hidden inside ("not" contains "no"!)
  });
  assert.ok(m.completed, 'call must reach dispatch even when nothing parses');
  assert.ok(m.clarifies > 0);
  assert.equal(m.result.protocolId, 'chest_pain');
  assert.equal(m.result.determinantId, 'cp_default', 'unparsed choices fall through to the default determinant');
});
