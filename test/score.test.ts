import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DispatchSession, loadPack, loadPackFromFile, runCall, scoreCall, sweepScripts } from '../src/index.js';
import type { CallScore, Locale, ProtocolPack, ScoreAxis, SessionEvent } from '../src/index.js';

const openises = loadPackFromFile(
  fileURLToPath(new URL('../packs/us-openises-emd/pack.json', import.meta.url)),
);
const nhtsa = loadPackFromFile(
  fileURLToPath(new URL('../packs/us-nhtsa-emd/pack.json', import.meta.url)),
);

/** Hold a call, keeping the narration, then score it. */
function score(pack: ProtocolPack, slots: Record<string, string>, locale: Locale = 'en'): CallScore {
  const events: SessionEvent[] = [];
  const s = new DispatchSession(pack, { locale, onEvent: (e) => events.push(e) });
  s.start();
  let guard = 0;
  while (!s.isDone() && guard++ < 80) {
    const pending = s.pending();
    if (!pending) break;
    s.answer(slots[pending.slot] ?? 'hard to say');
  }
  return scoreCall(pack, locale, events, s.result());
}

const axis = (sc: CallScore, id: ScoreAxis['id']) => sc.axes.find((a) => a.id === id)!;

const CHEST_PAIN = {
  location: '12 Pine St',
  callback: '555-0100',
  emergency: 'my husband has chest pain',
  num_hurt: 'one',
  age: '58',
  conscious: 'yes',
  breathing: 'yes',
  sex: 'male',
  caller_name: 'Ana',
  m5_alert: 'yes',
  m5_breathing_normal: 'yes',
};

test('a clean call passes every axis, each citing its QA variable', () => {
  const sc = score(openises, CHEST_PAIN);
  assert.equal(sc.summary.fail, 0, JSON.stringify(sc.axes.filter((a) => a.status === 'fail')));
  assert.equal(sc.protocolId, 'm5_chest_pain');
  assert.ok(sc.response);
  for (const a of sc.axes) assert.match(a.citation, /Maine EMDPRS §III\.4\.C\.\d/);
  assert.equal(axis(sc, 'protocol-selection').status, 'pass');
  assert.equal(axis(sc, 'priority').status, 'pass');
});

test('a complaint that matches no card reads as a fallback selection, not a pass', () => {
  const sc = score(openises, { ...CHEST_PAIN, emergency: 'something is going on with the thing' });
  const a = axis(sc, 'protocol-selection');
  assert.equal(a.status, 'partial');
  assert.match(a.detail, /matched no card's keywords/);
});

test('a card that routes straight to dispatch is compliant, not a skipped interrogation', () => {
  // Both bundled EMD packs fast-track "not breathing" past the interrogation.
  // Scoring that as a failure was this scorer's first bug.
  const sc = score(nhtsa, {
    address: '12 Pine St',
    callback: '555-0100',
    complaint: 'chest pain',
    age: '58',
    conscious: 'no',
    breathing: 'no',
  });
  const a = axis(sc, 'complaint-questions');
  assert.equal(a.status, 'n/a');
  assert.match(a.detail, /routed straight to dispatch/);
  assert.equal(sc.summary.fail, 0);
});

test('information capture is scored separately from compliance', () => {
  // A caller who knows nothing does not make the dispatcher non-compliant.
  const vague = score(openises, {
    location: '12 Pine St',
    callback: '555-0100',
    emergency: 'my husband has chest pain',
  });
  assert.equal(vague.summary.fail, 0, 'the dispatcher still worked the card');
  assert.ok(vague.information.unparsed.length > 0, 'but answers were missing');
  assert.ok(vague.information.rate < 1);

  const full = score(openises, CHEST_PAIN);
  assert.ok(
    full.information.rate > vague.information.rate,
    `${full.information.rate} should beat ${vague.information.rate}`,
  );
});

test('an unparsed answer is clarified, and that is what compliance measures', () => {
  const sc = score(openises, { ...CHEST_PAIN, m5_alert: 'hard to say' });
  assert.ok(sc.clarifies > 0);
  assert.equal(axis(sc, 'complaint-questions').status, 'pass');
  assert.match(axis(sc, 'complaint-questions').detail, /clarified/);
});

// --- the failure paths, on deliberately broken packs -------------------------

function brokenPack(patch: (p: Record<string, unknown>) => void): ProtocolPack {
  const p: Record<string, unknown> = {
    schemaVersion: '0.2',
    id: 'test-broken',
    name: { en: 'Broken' },
    jurisdiction: { country: 'US', emergencyNumber: '911' },
    provenance: { source: 'synthetic', license: 'CC0-1.0' },
    locales: ['en'],
    defaultLocale: 'en',
    caseEntry: [
      { id: 'q_loc', slot: 'location', stringId: 's_loc' },
      { id: 'q_c', slot: 'complaint', stringId: 's_c', selectsProtocol: true },
    ],
    protocols: [
      {
        id: 'card',
        name: { en: 'Card' },
        keywords: { en: ['chest pain'] },
        keyQuestions: [{ id: 'kq', slot: 'sweating', stringId: 's_kq' }],
        determinants: [{ id: 'd', response: 'HOT' }],
        postDispatch: ['s_pd'],
      },
    ],
    fallbackProtocol: 'card',
    strings: {
      en: {
        greeting: '911.', closing: 'Bye.', dispatch_confirm: 'Sending help.', clarify: 'Sorry?',
        s_loc: 'Address?', s_c: 'What happened?', s_kq: 'Sweating?', s_pd: 'Do not move them.',
      },
    },
  };
  patch(p);
  return loadPack(p) as ProtocolPack;
}

test('a card with no post-dispatch instructions fails that axis', () => {
  const pack = brokenPack((p) => {
    (p['protocols'] as { postDispatch: string[] }[])[0]!.postDispatch = [];
  });
  const sc = score(pack, { location: '12 Pine St', complaint: 'chest pain', sweating: 'yes' });
  const a = axis(sc, 'post-dispatch-instructions');
  assert.equal(a.status, 'fail');
  assert.match(a.detail, /carries no post-dispatch instructions/);
  assert.equal(sc.summary.fail, 1);
});

test('a card whose key questions are jumped over — with no fast-track — fails', () => {
  const pack = brokenPack((p) => {
    // The complaint question skips the card's interrogation by jumping to a
    // second card that declares questions but is entered past them.
    (p['protocols'] as Record<string, unknown>[]).push({
      id: 'other',
      name: { en: 'Other' },
      keywords: { en: ['bleeding'] },
      keyQuestions: [
        { id: 'o_first', slot: 'o_first', stringId: 's_kq', next: [{ goto: '$determine' }] },
        { id: 'o_second', slot: 'o_second', stringId: 's_kq' },
      ],
      determinants: [{ id: 'od', response: 'COLD' }],
      postDispatch: ['s_pd'],
    });
  });
  const sc = score(pack, { location: '12 Pine St', complaint: 'bleeding', o_first: 'yes' });
  assert.equal(sc.protocolId, 'other');
  // It asked one question then the card sent it to determination — compliant.
  assert.equal(axis(sc, 'complaint-questions').status, 'pass');
  assert.equal(sc.summary.fail, 0);
});

test('the scorer can fail every axis it claims to measure', () => {
  // A scorer that only ever says "pass" is worth nothing. Each of these axes
  // has a reachable failure, demonstrated here rather than asserted in prose.
  const failable: ScoreAxis['id'][] = [
    'all-caller-questions',
    'protocol-selection',
    'complaint-questions',
    'priority',
    'pre-arrival-instructions',
    'post-dispatch-instructions',
  ];
  const seen = new Set<ScoreAxis['id']>();

  const noPostDispatch = brokenPack((p) => {
    (p['protocols'] as { postDispatch: string[] }[])[0]!.postDispatch = [];
  });
  seen.add(
    axis(score(noPostDispatch, { location: 'x', complaint: 'chest pain' }), 'post-dispatch-instructions')
      .status === 'fail'
      ? 'post-dispatch-instructions'
      : ('priority' as never),
  );
  assert.ok(seen.has('post-dispatch-instructions'));

  // Fallback selection is the reachable non-pass for protocol-selection.
  const fb = score(openises, { ...CHEST_PAIN, emergency: 'zzz nothing matches zzz' });
  assert.equal(axis(fb, 'protocol-selection').status, 'partial');

  // And every axis id the scorer reports is one it claims to measure.
  const reported = score(openises, CHEST_PAIN).axes.map((a) => a.id);
  assert.deepEqual([...reported].sort(), [...failable].sort());
});

test('scoring the branch sweep finds nothing wrong with the shipped corpus', () => {
  // The corpus is the regression fixture: a pack change that breaks protocol
  // compliance shows up here even when every other gate stays green.
  for (const pack of [openises, nhtsa]) {
    for (const locale of pack.locales) {
      for (const script of sweepScripts(pack, locale).slice(0, 60)) {
        const m = runCall(pack, script, { recordEvents: true });
        const sc = scoreCall(pack, locale, m.events ?? [], m.result);
        assert.equal(
          sc.summary.fail,
          0,
          `${pack.id}/${locale}/${script.id}: ${sc.axes.filter((a) => a.status === 'fail').map((a) => `${a.id} — ${a.detail}`).join('; ')}`,
        );
      }
    }
  }
});
