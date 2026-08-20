import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DispatchSession, loadPackFromFile } from '../src/index.js';

const packPath = fileURLToPath(new URL('../packs/us-openises-emd/pack.json', import.meta.url));
const pack = loadPackFromFile(packPath);

/** Run a call answering case entry with `caseAnswers`, then every subsequent
 * question from the `bySlot` map (fallback for free-text questions). */
function run(caseAnswers: string[], bySlot: Record<string, string>) {
  const s = new DispatchSession(pack);
  s.start();
  for (const a of caseAnswers) {
    if (s.isDone()) break;
    s.answer(a);
  }
  let guard = 0;
  while (!s.isDone() && guard++ < 50) {
    const slot = s.pending()!.slot;
    s.answer(bySlot[slot] ?? 'nothing of note');
  }
  return s.result();
}

const CASE_OK = ['12 Pine St', '555-0100', 'my husband has chest pain', 'one', '58', 'yes', 'yes', 'male', 'Ana'];

test('openises pack loads: trilingual, jurisdiction response taxonomy', () => {
  assert.deepEqual(pack.locales, ['en', 'es', 'fr']);
  assert.equal(pack.fallbackProtocol, 'm17_unknown_man_down');
  assert.equal(pack.provenance.license, 'GFDL-1.2-or-later');
});

test('spanish call: chest pain with cardiac history → CODE_RED, all es strings', () => {
  const s = new DispatchSession(pack, { locale: 'es' });
  const texts: string[] = s.start().map((u) => u.text);
  const answers = [
    'Calle Reforma 10',
    '555-0100',
    'mi esposo tiene dolor de pecho',
    'una',
    '58',
    'sí',
    'sí, respira',
    'hombre',
    'Ana',
    'sí, alerta',
    'sí, normalmente',
    'no',
    'no',
    'no',
    'en el centro del pecho',
    'no',
    'nada más',
    'una hora',
    'sí, tuvo un infarto',
    'no',
  ];
  for (const a of answers) {
    if (s.isDone()) break;
    texts.push(...s.answer(a).map((u) => u.text));
  }
  assert.ok(s.isDone());
  const r = s.result();
  assert.equal(r.protocolId, 'm5_chest_pain');
  assert.equal(r.determinantId, 'm5_red_cardiac_history');
  assert.equal(r.response, 'CODE_RED');
  const esCatalog = Object.values(pack.strings['es']!).flatMap((t) => (Array.isArray(t) ? t : [t]));
  for (const t of texts) {
    assert.ok(
      esCatalog.some((c) => t === c || (c.includes('{') && t.startsWith(c.split('{')[0]!))),
      `"${t}" not from the es catalog`,
    );
  }
});

test('french call: fainted but recovered → CODE_YELLOW via C6', () => {
  const s = new DispatchSession(pack, { locale: 'fr' });
  s.start();
  const answers = [
    '10 rue Sainte-Catherine',
    '514-555-0100',
    "ma mère s'est évanouie mais elle a repris connaissance",
    'une',
    '45',
    'oui',
    'oui, elle respire',
    'femme',
    'Chantal',
    'oui, alerte',
    'oui, normalement',
    'oui, première fois',
    'oui',
    'non',
    'elle préparait le souper',
    'aucune plainte',
    'non, pas de bracelet',
  ];
  for (const a of answers) {
    if (s.isDone()) break;
    s.answer(a);
  }
  assert.ok(s.isDone());
  const r = s.result();
  assert.equal(r.protocolId, 'c6_unconscious_fainting');
  assert.equal(r.determinantId, 'c6_yellow_recovered');
  assert.equal(r.response, 'CODE_YELLOW');
});

test('M5: cardiac history makes chest pain a CODE_RED (card criterion)', () => {
  const r = run(CASE_OK, {
    m5_alert: 'yes',
    m5_breathing_normal: 'yes, normally',
    m5_sweating: 'no',
    m5_nausea: 'no',
    m5_weak: 'no',
    m5_rapid_heart: 'no',
    m5_cardiac_history: 'yes, he had a heart attack two years ago',
    m5_drugs: 'no',
  });
  assert.equal(r.protocolId, 'm5_chest_pain');
  assert.equal(r.determinantId, 'm5_red_cardiac_history');
  assert.equal(r.response, 'CODE_RED');
});

test('M5: young patient with no critical symptoms is CODE_YELLOW', () => {
  const r = run(CASE_OK, {
    m5_alert: 'yes',
    m5_breathing_normal: 'yes, normally',
    m5_sweating: 'no',
    m5_nausea: 'no',
    m5_weak: 'no',
    m5_rapid_heart: 'no',
    m5_cardiac_history: 'no',
    m5_drugs: 'no',
  });
  assert.equal(r.determinantId, 'm5_yellow_no_critical');
  assert.equal(r.response, 'CODE_YELLOW');
});

test('All Callers: not breathing dispatches CODE_RED immediately', () => {
  const s = new DispatchSession(pack);
  s.start();
  s.answer('12 Pine St');
  s.answer('555-0100');
  s.answer('chest pain');
  s.answer('one');
  s.answer('58');
  s.answer('no, unconscious');
  const out = s.answer('no'); // breathing -> immediate Code Red, per the card
  assert.equal(out[0]!.stringId, 'dispatch_confirm');
  const r = s.result();
  assert.equal(r.determinantId, 'm5_red_not_breathing');
  assert.equal(r.response, 'CODE_RED');
});

test('C1: confirmed hospice expected death is the CODE_YELLOW exception', () => {
  const r = run(
    ['12 Pine St', '555-0100', 'I think he is in cardiac arrest', 'one', '90', 'no', 'yes', 'male', 'Ana'],
    {
      c1_alert: 'no',
      c1_breathing_normal: 'no, gasping',
      c1_responds: 'no',
      c1_expected: 'yes, he is in hospice care',
    },
  );
  assert.equal(r.protocolId, 'c1_cardiac_arrest');
  assert.equal(r.determinantId, 'c1_yellow_hospice');
  assert.equal(r.response, 'CODE_YELLOW');
});

test('C6: recovered faint with no critical symptoms is CODE_YELLOW', () => {
  const r = run(
    ['12 Pine St', '555-0100', 'my mom fainted but she came around', 'one', '45', 'yes', 'yes', 'female', 'Ana'],
    {
      c6_alert: 'yes, awake now',
      c6_breathing_normal: 'yes, normally',
      c6_first_time: 'yes',
      c6_tried_wake: 'yes',
      c6_drugs_alcohol: 'no',
    },
  );
  assert.equal(r.protocolId, 'c6_unconscious_fainting');
  assert.equal(r.determinantId, 'c6_yellow_recovered');
  assert.equal(r.response, 'CODE_YELLOW');
});

test('M13: mental-health crisis routes to the psychiatric card, CODE_YELLOW when airway is fine', () => {
  const r = run(
    ['12 Pine St', '555-0100', 'my brother is in a mental health crisis and talking about hurting himself', 'one', '28', 'yes', 'yes', 'male', 'Ana'],
    {
      m13_alert: 'yes, alert',
      m13_breathing_normal: 'yes, normally',
      m13_harmed: 'no, but he might',
      m13_substances: 'no',
      m13_diabetic: 'no',
      m13_injured: 'no',
      m13_bleeding: 'no',
    },
  );
  assert.equal(r.protocolId, 'm13_psychiatric');
  assert.equal(r.determinantId, 'm13_yellow_behavioral');
  assert.equal(r.response, 'CODE_YELLOW');
});

test('H2: smoke complaint routes to CO/Inhalation; multiple patients → CODE_RED MCI', () => {
  const r = run(
    ['12 Pine St', '555-0100', 'there is smoke coming from my kitchen and the smoke alarm is going off', 'one', '40', 'yes', 'yes', 'female', 'Ana'],
    {
      h2_alert: 'yes, alert',
      h2_breathing_normal: 'yes, normally',
      h2_removed: 'yes, everyone is outside',
      h2_co_detector: 'no',
      h2_multiple: 'yes, two of us feel dizzy',
    },
  );
  assert.equal(r.protocolId, 'h2_co_inhalation');
  assert.equal(r.determinantId, 'h2_red_mci');
  assert.equal(r.response, 'CODE_RED');
});

test('T4: burns with airway involvement short-circuits to CODE_RED', () => {
  const s = new DispatchSession(pack);
  s.start();
  for (const a of ['12 Pine St', '555-0100', 'she burned her face on the stove', 'one', '35', 'yes', 'yes', 'female', 'Ana']) s.answer(a);
  s.answer('on the stove, a grease flare');
  s.answer('no, nothing still burning');
  s.answer('it was not a chemical');
  const out = s.answer('yes, it hurts to breathe'); // airway -> immediate dispatch
  assert.equal(out[0]!.stringId, 'dispatch_confirm');
  const r = s.result();
  assert.equal(r.protocolId, 't4_burns');
  assert.equal(r.determinantId, 't4_red_airway_breath');
  assert.equal(r.response, 'CODE_RED');
});

test('T8: penetrating trauma always defaults to CODE_RED (documented safety-first)', () => {
  const r = run(
    ['12 Pine St', '555-0100', 'my neighbor was stabbed', 'one', '30', 'yes', 'yes', 'male', 'Ana'],
    {
      t8_assailant: 'no, he ran off',
      t8_safe: 'yes, I am safe',
      t8_weapon: 'no',
      t8_alert: 'yes, alert',
      t8_breathing_normal: 'yes, normally',
      t8_bleeding: 'no',
    },
  );
  assert.equal(r.protocolId, 't8_stabbing_gunshot');
  assert.equal(r.determinantId, 't8_red_penetrating');
  assert.equal(r.response, 'CODE_RED');
});

test('unclear complaint falls back to M17 Unknown/Man Down', () => {
  const r = run(
    ['12 Pine St', '555-0100', 'there is somebody lying on the sidewalk', 'one', 'unknown', 'yes', 'yes', 'unknown', 'Ana'],
    {
      m17_alert: 'yes',
      m17_breathing_normal: 'yes, normally',
      m17_able_talk: 'yes, talking',
      m17_able_move: 'yes, moving',
    },
  );
  assert.equal(r.protocolId, 'm17_unknown_man_down');
  assert.equal(r.determinantId, 'm17_yellow_talking_moving');
  assert.equal(r.response, 'CODE_YELLOW');
});
