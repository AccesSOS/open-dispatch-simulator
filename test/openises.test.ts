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

test('M5: numeric age tiers — under 35 clean is CODE_YELLOW, over 35 clean is CODE_RED', () => {
  const clean = {
    m5_alert: 'yes',
    m5_breathing_normal: 'yes, normally',
    m5_sweating: 'no',
    m5_nausea: 'no',
    m5_weak: 'no',
    m5_rapid_heart: 'no',
    m5_cardiac_history: 'no',
    m5_drugs: 'no',
  };
  const young = run(
    ['12 Pine St', '555-0100', 'chest pain', 'one', '28', 'yes', 'yes', 'male', 'Ana'],
    clean,
  );
  assert.equal(young.numbers['age'], 28);
  assert.equal(young.determinantId, 'm5_yellow_under_35');
  assert.equal(young.response, 'CODE_YELLOW');

  const older = run(CASE_OK, clean); // age 58 -> the card only defines YELLOW for <35
  assert.equal(older.determinantId, 'm5_red_over_35_or_unknown');
  assert.equal(older.response, 'CODE_RED');
});

test('All Callers: unconscious + not breathing jumps to the C1 card (v0.2)', () => {
  const s = new DispatchSession(pack);
  s.start();
  s.answer('12 Pine St');
  s.answer('555-0100');
  s.answer('chest pain');
  s.answer('one');
  s.answer('58');
  s.answer('no, unconscious');
  const out = s.answer('no'); // conscious=no + breathing=no -> C1 takes over the call
  assert.equal(out[0]!.stringId, 'kq_alert', 'C1 card first key question');
  s.answer('no');
  s.answer('no, gasping');
  s.answer('no response at all');
  s.answer('no, not expected');
  assert.ok(s.isDone());
  const r = s.result();
  assert.equal(r.protocolId, 'c1_cardiac_arrest');
  assert.equal(r.determinantId, 'c1_red_arrest');
  assert.equal(r.response, 'CODE_RED');
});

test('All Callers: unconscious but breathing jumps to C6, overriding the complaint', () => {
  const r = run(
    ['12 Pine St', '555-0100', 'I think he is in cardiac arrest', 'one', '90', 'no', 'yes', 'male', 'Ana'],
    {},
  );
  assert.equal(r.protocolId, 'c6_unconscious_fainting', 'breathing patient routes to C6 per the card flow');
  assert.equal(r.determinantId, 'c6_red_confirmed_unconscious');
  assert.equal(r.response, 'CODE_RED');
});

test('C1: confirmed hospice expected death is the CODE_YELLOW exception', () => {
  const r = run(
    ['12 Pine St', '555-0100', 'he stopped breathing and he is on hospice', 'one', '90', 'no', 'no', 'male', 'Ana'],
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

test('M4: conscious + not breathing routes to Breathing Problems; chest pain chains to M5', () => {
  const s = new DispatchSession(pack);
  s.start();
  for (const a of ['12 Pine St', '555-0100', 'she is wheezing badly', 'one', '60', 'yes', 'no']) s.answer(a);
  // conscious=yes + breathing=no -> M4 takes over
  assert.equal(s.pending()?.protocolId, 'm4_breathing_problems');
  s.answer('yes, alert');
  s.answer('no, wheezing hard');
  s.answer('about an hour');
  const out = s.answer('yes, her chest hurts too'); // M4 card Q4 -> jump to M5
  assert.equal(out[0]!.stringId, 'kq_alert', 'M5 card starts from its own key questions');
  let guard = 0;
  while (!s.isDone() && guard++ < 30) s.answer('no');
  const r = s.result();
  assert.equal(r.protocolId, 'm5_chest_pain');
});

test('M4: abnormal breathing needs a factor for CODE_RED; benign defaults CODE_YELLOW', () => {
  const base = ['12 Pine St', '555-0100', 'he is having trouble breathing', 'one', '40', 'yes', 'no'];
  const withAsthma = run(base, {
    m4_alert: 'yes, alert',
    m4_breathing_normal: 'no',
    m4_chest_pain: 'no',
    m4_full_sentences: 'yes, full sentences',
    m4_sit_up: 'no',
    m4_drooling: 'no',
    m4_asthma: 'yes, he has asthma',
    m4_recent_hosp: 'no',
    m4_birth_control: 'no',
    m4_oxygen: 'no',
  });
  assert.equal(withAsthma.protocolId, 'm4_breathing_problems');
  assert.equal(withAsthma.determinantId, 'm4_red_bn_asthma');
  assert.equal(withAsthma.response, 'CODE_RED');

  const benign = run(base, {
    m4_alert: 'yes, alert',
    m4_breathing_normal: 'no',
    m4_chest_pain: 'no',
    m4_full_sentences: 'yes, full sentences',
    m4_sit_up: 'no',
    m4_drooling: 'no',
    m4_asthma: 'no',
    m4_recent_hosp: 'no',
    m4_birth_control: 'no',
    m4_oxygen: 'no',
  });
  assert.equal(benign.determinantId, 'm4_yellow_benign', 'the card requires abnormal breathing PLUS a factor for RED');
  assert.equal(benign.response, 'CODE_YELLOW');
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
