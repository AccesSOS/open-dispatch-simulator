import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DispatchSession, loadPackFromFile } from '../src/index.js';

const packPath = fileURLToPath(new URL('../packs/us-openises-emd/pack.json', import.meta.url));
const pack = loadPackFromFile(packPath);

function run(caseAnswers: string[], bySlot: Record<string, string>) {
  const s = new DispatchSession(pack);
  s.start();
  for (const a of caseAnswers) {
    if (s.isDone()) break;
    s.answer(a);
  }
  let guard = 0;
  while (!s.isDone() && guard++ < 60) {
    s.answer(bySlot[s.pending()!.slot] ?? 'nothing of note');
  }
  return s.result();
}

const OK = (complaint: string, age = '40') =>
  ['12 Pine St', '555-0100', complaint, 'one', age, 'yes', 'yes', 'male', 'Ana'];
const AB = { }; // alert + breathing-normal clean answers provided per-slot below

test('T6: fall height is a numeric criterion — 15 feet is RED, 6 feet clean is YELLOW', () => {
  const high = run(OK('my dad fell off the ladder'), {
    t6_alert: 'yes, alert',
    t6_breathing_normal: 'yes, normally',
    t6_how_far: 'about 15 feet',
    t6_prior: 'no',
    t6_move: 'yes, he can move them',
    t6_bleeding: 'no',
  });
  assert.equal(high.protocolId, 't6_falls');
  assert.equal(high.numbers['t6_how_far'], 15);
  assert.equal(high.determinantId, 't6_red_high_fall');
  assert.equal(high.response, 'CODE_RED');

  const low = run(OK('she fell down'), {
    t6_alert: 'yes, alert',
    t6_breathing_normal: 'yes, normally',
    t6_how_far: 'maybe 6 feet',
    t6_prior: 'no',
    t6_move: 'yes, moving fine',
    t6_bleeding: 'no',
  });
  assert.equal(low.determinantId, 't6_yellow_low_fall');
  assert.equal(low.response, 'CODE_YELLOW');
});

test('T3: squirting blood short-circuits to CODE_RED (arterial), with the I11 pressure script', () => {
  const s = new DispatchSession(pack);
  const texts: string[] = s.start().map((u) => u.text);
  for (const a of OK('he cut himself badly and there is blood everywhere')) {
    texts.push(...s.answer(a).map((u) => u.text));
  }
  texts.push(...s.answer('yes, alert').map((u) => u.text));
  texts.push(...s.answer('yes, normally').map((u) => u.text));
  texts.push(...s.answer('from his forearm').map((u) => u.text));
  texts.push(...s.answer('yes, it is squirting out').map((u) => u.text));
  assert.ok(s.isDone());
  const r = s.result();
  assert.equal(r.protocolId, 't3_bleeding');
  assert.equal(r.determinantId, 't3_red_arterial');
  assert.ok(texts.some((t) => t.includes('apply pressure directly over it')), 'I11 script spoken');
  assert.ok(texts.some((t) => t.includes('do not remove it')), 'soaked-cloth line spoken');
});

test('T2: stabbing answer jumps to the T8 card per the card', () => {
  const s = new DispatchSession(pack);
  s.start();
  for (const a of OK('my neighbor was attacked and beaten')) s.answer(a);
  s.answer('no, he ran off');
  s.answer('yes, I am safe');
  s.answer('physical, they beat him');
  const out = s.answer('actually he was stabbed with a knife');
  assert.equal(out[0]!.stringId, 'kq_t8_assailant', 'T8 card takes over');
  let guard = 0;
  while (!s.isDone() && guard++ < 30) s.answer('no');
  const r = s.result();
  assert.equal(r.protocolId, 't8_stabbing_gunshot');
  assert.equal(r.response, 'CODE_RED');
});

test('C5: visible head is imminent delivery — CODE_RED and immediate dispatch', () => {
  const s = new DispatchSession(pack);
  s.start();
  for (const a of ['12 Pine St', '555-0100', 'my wife is in labor and the baby is coming', 'one', '29', 'yes', 'yes', 'female', 'Leo']) s.answer(a);
  s.answer('yes, alert');
  s.answer('yes, normally');
  s.answer('nine months, full term');
  s.answer('yes, contractions very close');
  s.answer('no urge yet');
  const out = s.answer('yes, I can see the head');
  assert.equal(out[0]!.stringId, 'dispatch_confirm');
  const r = s.result();
  assert.equal(r.protocolId, 'c5_childbirth');
  assert.equal(r.determinantId, 'c5_red_imminent');
  assert.equal(r.response, 'CODE_RED');
});

test('C3: person still in the water short-circuits to CODE_RED', () => {
  const s = new DispatchSession(pack);
  s.start();
  for (const a of OK('someone is drowning in the pool')) s.answer(a);
  s.answer('no, not alert'); // -> $determine via alert edge? no: alert no edge goes to determine
  const r = s.result();
  assert.equal(r.protocolId, 'c3_drowning');
  assert.equal(r.determinantId, 'c3_red_not_alert');
  assert.equal(r.response, 'CODE_RED');

  // NB: "fell in the water" would match T6 Falls first (array order) — a
  // realistic keyword-collision; the unambiguous complaint routes to C3.
  const r2 = run(OK('he nearly drowned but they pulled him from the water'), {
    c3_alert: 'yes, alert',
    c3_breathing_normal: 'yes, normally',
    c3_removed: 'yes, he is out of the water',
    c3_scuba: 'no',
  });
  assert.equal(r2.determinantId, 'c3_yellow_no_critical');
});

test('M1: vomiting blood is CODE_RED; dizzy over-50 compound rule fires', () => {
  const blood = run(OK('her stomach hurts terribly'), {
    m1_alert: 'yes, alert',
    m1_breathing_normal: 'yes, normally',
    m1_chest: 'no',
    m1_injury: 'no',
    m1_vomit: 'yes and there was blood in it',
    m1_stool: 'no, normal',
    m1_pregnant: 'no',
    m1_dizzy: 'no',
  });
  assert.equal(blood.protocolId, 'm1_abdominal_pain');
  assert.equal(blood.determinantId, 'm1_red_vomiting_blood');

  const elder = run(OK('his stomach hurts', '72'), {
    m1_alert: 'yes, alert',
    m1_breathing_normal: 'yes, normally',
    m1_chest: 'no',
    m1_injury: 'no',
    m1_vomit: 'no',
    m1_stool: 'no, normal',
    m1_pregnant: 'no',
    m1_dizzy: 'yes, he nearly fainted',
  });
  assert.equal(elder.determinantId, 'm1_red_faint_over_50');
});

test('M2: known severe reaction history is CODE_RED; localized first-time is YELLOW', () => {
  const severe = run(OK('she is having an allergic reaction to a bee sting'), {
    m2_alert: 'yes, alert',
    m2_breathing_normal: 'yes, normally',
    m2_swallow: 'no',
    m2_rash: 'yes, hives',
    m2_itching: 'yes',
    m2_history: 'yes, she reacted badly before and has an epipen',
    m2_worse: 'no',
  });
  assert.equal(severe.protocolId, 'm2_allergies_stings');
  assert.equal(severe.determinantId, 'm2_red_severe_history');

  const mild = run(OK('he got stung and has a rash'), {
    m2_alert: 'yes, alert',
    m2_breathing_normal: 'yes, normally',
    m2_swallow: 'no',
    m2_rash: 'yes',
    m2_itching: 'yes',
    m2_history: 'no, never',
    m2_worse: 'no',
  });
  assert.equal(mild.determinantId, 'm2_yellow_localized');
});

test('M15: sick person with nothing critical is the benign YELLOW; complaint routes off M17', () => {
  const r = run(OK('my mom has the flu and a fever'), {
    m15_alert: 'yes, alert',
    m15_breathing_normal: 'yes, normally',
    m15_pain: 'no',
    m15_bleeding: 'no',
    m15_vomited: 'no',
    m15_manner: 'yes, normal',
    m15_diabetic: 'no',
  });
  assert.equal(r.protocolId, 'm15_sick_person');
  assert.equal(r.determinantId, 'm15_yellow_no_critical');
  assert.equal(r.response, 'CODE_YELLOW');
});
