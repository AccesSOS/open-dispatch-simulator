import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DispatchSession, loadPackFromFile, runBatch, sweepScripts } from '../src/index.js';
import type { Persona } from '../src/index.js';

const packPath = fileURLToPath(new URL('../packs/us-nhtsa-emd/pack.json', import.meta.url));
const pack = loadPackFromFile(packPath);

function transcriptFor(persona: Persona | undefined, answers: string[]): string[] {
  const s = new DispatchSession(pack, persona ? { persona } : {});
  const texts = s.start().map((u) => u.text);
  for (const a of answers) texts.push(...s.answer(a).map((u) => u.text));
  return texts;
}

const ANSWERS = ['9 Elm Ave', '555-0111', 'chest pain', '50', 'yes', 'yes', 'yes, alert', 'no, dry'];

test('same persona seed reproduces the exact same call', () => {
  const a = transcriptFor({ seed: 42, confirmRate: 1 }, ANSWERS);
  const b = transcriptFor({ seed: 42, confirmRate: 1 }, ANSWERS);
  assert.deepEqual(a, b);
});

test('phrasing variants stay grounded in the pack catalog', () => {
  const variants = pack.strings['en']!['q_complaint'];
  assert.ok(Array.isArray(variants) && variants.length === 2, 'reference pack ships 2 variants');
  const seen = new Set<string>();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const texts = transcriptFor({ seed }, ANSWERS.slice(0, 2));
    const complaintQ = texts[texts.length - 1]!;
    assert.ok((variants as string[]).includes(complaintQ), `"${complaintQ}" not a pack variant`);
    seen.add(complaintQ);
  }
  assert.equal(seen.size, 2, 'different seeds exercise both variants');
});

test('confirmRate 1 reads answers back; confirmRate 0 never does', () => {
  const chatty = transcriptFor({ seed: 1, confirmRate: 1 }, ANSWERS);
  assert.ok(chatty.includes('Okay, 9 Elm Ave.'), 'address read back');
  assert.ok(
    chatty.includes('And if we get disconnected, I can reach you at 555-0111?'),
    'callback read back',
  );
  const terse = transcriptFor({ seed: 1, confirmRate: 0 }, ANSWERS);
  assert.ok(!terse.some((t) => t.startsWith('Okay, 9 Elm')), 'no read-backs when confirmRate 0');
});

test('sweep invariants hold across personas and locales', () => {
  const personas: (Persona | undefined)[] = [
    undefined,
    { seed: 7, confirmRate: 1, clarifyAttempts: 2 },
    { seed: 2029, confirmRate: 0.5 },
  ];
  for (const locale of pack.locales) {
    for (const persona of personas) {
      const report = runBatch(pack, sweepScripts(pack, locale), persona ? { persona } : {});
      assert.equal(report.completed, report.total);
      assert.ok(report.calls.every((m) => m.result.response !== null));
    }
  }
});

test('persona changes phrasing but never the clinical outcome', () => {
  const outcomes = new Set<string>();
  for (const seed of [1, 99, 12345]) {
    const s = new DispatchSession(pack, { persona: { seed, confirmRate: 1 } });
    s.start();
    for (const a of ANSWERS) s.answer(a);
    const r = s.result();
    outcomes.add(`${r.protocolId}/${r.determinantId}/${r.response}`);
  }
  assert.deepEqual([...outcomes], ['chest_pain/cp_default/ALS_COLD']);
});
