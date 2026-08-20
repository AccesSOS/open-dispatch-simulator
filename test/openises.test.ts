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

test('openises pack loads: single-locale, jurisdiction response taxonomy', () => {
  assert.deepEqual(pack.locales, ['en']);
  assert.equal(pack.fallbackProtocol, 'm17_unknown_man_down');
  assert.equal(pack.provenance.license, 'GFDL-1.2-or-later');
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
