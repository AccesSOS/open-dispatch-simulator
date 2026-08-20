import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DispatchSession, loadPackFromFile, runBatch, sweepInstructionScripts } from '../src/index.js';
import type { Locale, ProtocolPack } from '../src/index.js';

const pack: ProtocolPack = loadPackFromFile(
  fileURLToPath(new URL('../packs/us-openises-emd/pack.json', import.meta.url)),
);

/** Run a call to completion, answering by slot. */
function run(slots: Record<string, string>, locale: Locale = 'en') {
  const s = new DispatchSession(pack, { locale });
  s.start();
  let guard = 0;
  while (!s.isDone() && guard++ < 80) {
    const pending = s.pending();
    if (!pending) break;
    s.answer(slots[pending.slot] ?? 'unknown');
  }
  return s;
}

const ARREST = {
  location: '12 Pine St',
  callback: '555-0100',
  emergency: 'he is not breathing',
  num_hurt: 'one',
  age: '58',
  conscious: 'no',
  breathing: 'no',
  sex: 'male',
  caller_name: 'Ana',
};

const CHOKING = { ...ARREST, emergency: 'he is choking', conscious: 'yes', breathing: 'yes' };

test('the pack is v0.3 and carries the adult instruction cards', () => {
  assert.equal(pack.schemaVersion, '0.3');
  const ids = (pack.scripts ?? []).map((s) => s.id);
  assert.deepEqual(ids, [
    'i1_aed',
    'i2a_adult_cpr_entry',
    'i2b_adult_cpr_breaths',
    'i2c_adult_cpr_check',
    'i2c_adult_cpr_entry',
    'i2d_adult_cpr_compressions',
    'i5a_choking_adult',
    'i5b_choking_adult_airway',
    'i5c_choking_adult_compressions',
  ]);
  for (const s of pack.scripts ?? []) {
    assert.ok(s.source, `${s.id} records which card it digitizes`);
    for (const locale of pack.locales) assert.ok(s.name[locale], `${s.id} named in ${locale}`);
  }
});

test('C1 walks a willing caller through mouth-to-mouth, then compressions', () => {
  const s = run({ ...ARREST, i2_knows_cpr: 'no', i2_mouth_to_mouth: 'yes', i2b_obstacle: 'nothing', i2_chest_rose: 'yes', i2_aed_present: 'no' });
  const r = s.result();
  assert.equal(r.response, 'CODE_RED');
  assert.deepEqual(r.scripts, [
    'i2a_adult_cpr_entry',
    'i2b_adult_cpr_breaths',
    'i2c_adult_cpr_check',
    'i2c_adult_cpr_entry',
    'i2d_adult_cpr_compressions',
  ]);
  const said = r.transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text).join(' ');
  assert.match(said, /heel of your hand/);
  assert.match(said, /two breaths of air/);
});

test('a caller who already knows CPR is told to start, not walked through it', () => {
  const s = run({ ...ARREST, i2_knows_cpr: 'yes', i2_need_help: 'no' });
  assert.deepEqual(s.result().scripts, ['i2a_adult_cpr_entry']);
  const said = s.result().transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text).join(' ');
  assert.match(said, /Begin CPR on the person now/);
  assert.doesNotMatch(said, /heel of your hand/);
});

test('a caller who cannot do mouth-to-mouth goes straight to compression-only', () => {
  const s = run({ ...ARREST, i2_knows_cpr: 'no', i2_mouth_to_mouth: 'no', i2_aed_present: 'no' });
  assert.deepEqual(s.result().scripts, [
    'i2a_adult_cpr_entry',
    'i2c_adult_cpr_entry',
    'i2d_adult_cpr_compressions',
  ]);
  const said = s.result().transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text).join(' ');
  assert.match(said, /200 times/, 'the compression-only count from the card');
  assert.doesNotMatch(said, /Give two more breaths/);
});

test('breaths that do not go in route to the airway card, exactly as I2 §C directs', () => {
  const s = run({
    ...ARREST,
    i2_knows_cpr: 'no',
    i2_mouth_to_mouth: 'yes',
    i2b_obstacle: 'nothing',
    i2_chest_rose: 'no',
    i5b_chest_rose: 'no',
    i5c_moving: 'no',
    i2_aed_present: 'no',
  });
  const scripts = s.result().scripts;
  assert.ok(scripts.includes('i5b_choking_adult_airway'), scripts.join(' → '));
  assert.ok(scripts.includes('i5c_choking_adult_compressions'));
  assert.ok(scripts.includes('i2d_adult_cpr_compressions'), 'and back into compressions');
});

test('an AED on scene hands off to the I1 card', () => {
  const s = run({ ...ARREST, i2_knows_cpr: 'no', i2_mouth_to_mouth: 'no', i2_aed_present: 'yes', i1_machine_says: 'it says shock' });
  assert.ok(s.result().scripts.includes('i1_aed'));
  const said = s.result().transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text).join(' ');
  assert.match(said, /press the shock button/);
  assert.match(said, /conducts electricity/, 'the card carries its own do-not-operate caution');
});

test('"no shock indicated" is not read as "shock"', () => {
  const s = run({ ...ARREST, i2_knows_cpr: 'no', i2_mouth_to_mouth: 'no', i2_aed_present: 'yes', i1_machine_says: 'it says no shock advised' });
  const said = s.result().transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text).join(' ');
  assert.match(said, /no shock is indicated, keep doing CPR/);
  assert.doesNotMatch(said, /press the shock button/);
});

test('C2: a choking person who can still cough is left alone and watched', () => {
  const s = run({ ...CHOKING, i5_can_talk: 'yes' });
  assert.deepEqual(s.result().scripts, ['i5a_choking_adult']);
  const said = s.result().transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text).join(' ');
  assert.match(said, /do not do anything else/i);
  assert.doesNotMatch(said, /upward thrusts/);
});

test('C2: a conscious choking person gets abdominal thrusts', () => {
  const s = run({ ...CHOKING, i5_can_talk: 'no', i5_conscious: 'yes', i5_outcome: 'it came out' });
  const said = s.result().transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text).join(' ');
  assert.match(said, /quick, upward thrusts/);
});

test('C2: an unwitnessed unconscious choking goes to the CPR card, per I5 §A', () => {
  const s = run({ ...CHOKING, i5_can_talk: 'no', i5_conscious: 'no', i5_witnessed: 'no', i2_knows_cpr: 'yes', i2_need_help: 'no' });
  assert.deepEqual(s.result().scripts, ['i5a_choking_adult', 'i2a_adult_cpr_entry']);
});

test('the instruction cards speak Spanish and French, not English fallbacks', () => {
  const answers: Record<Locale, Record<string, string>> = {
    es: { location: 'Calle Reforma 10', callback: '555-0100', emergency: 'no respira', num_hurt: 'uno', age: '58', conscious: 'no', breathing: 'no', sex: 'hombre', caller_name: 'Ana', i2_knows_cpr: 'no', i2_mouth_to_mouth: 'sí', i2b_obstacle: 'nada', i2_chest_rose: 'sí', i2_aed_present: 'no' },
    fr: { location: '12 rue des Lilas', callback: '555-0100', emergency: 'ne respire pas', num_hurt: 'une', age: '58', conscious: 'non', breathing: 'non', sex: 'homme', caller_name: 'Ana', i2_knows_cpr: 'non', i2_mouth_to_mouth: 'oui', i2b_obstacle: 'rien', i2_chest_rose: 'oui', i2_aed_present: 'non' },
  };
  const expected: Record<Locale, RegExp> = {
    es: /talón de su mano/,
    fr: /talon de votre main/,
  };
  for (const locale of ['es', 'fr'] as Locale[]) {
    const s = run(answers[locale]!, locale);
    const r = s.result();
    assert.equal(r.response, 'CODE_RED', `${locale} reached dispatch`);
    const said = r.transcript.filter((t) => t.role === 'dispatcher').map((t) => t.text).join(' ');
    assert.match(said, expected[locale]!, `${locale} ran the compression script`);
    assert.doesNotMatch(said, /heel of your hand/, `${locale} leaked English`);
  }
});

test('every instruction step is reachable in every locale, and every walk closes', () => {
  for (const locale of pack.locales) {
    const sweep = sweepInstructionScripts(pack, locale);
    assert.deepEqual(sweep.unreachable, [], `${locale}: unreachable steps`);
    assert.deepEqual(sweep.capped, [], `${locale}: path enumeration was capped`);
    const report = runBatch(pack, sweep.scripts);
    assert.deepEqual(report.incomplete, [], `${locale}: walks that never closed`);
    for (const call of report.calls) {
      assert.ok(call.result.response, `${call.scriptId} lost its response level`);
    }
  }
});
