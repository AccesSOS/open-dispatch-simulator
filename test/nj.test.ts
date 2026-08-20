import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DispatchSession, loadPackFromFile } from '../src/index.js';

const packPath = fileURLToPath(new URL('../packs/us-nj-emd/pack.json', import.meta.url));
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
    s.answer(bySlot[s.pending()!.slot] ?? 'nothing that I know of');
  }
  return s.result();
}

// All Caller order: location, callback, emergency, name, age, sex, conscious, breathing
const CASE_OK = ['12 Grove St, Trenton', '609-555-0100', 'my husband has chest pain', 'Ana', '58', 'male', 'yes', 'yes, normally'];

test('nj pack loads with NJ dispatch taxonomy and pending-permission provenance', () => {
  assert.equal(pack.provenance.license, 'state-published-permission-pending');
  const responses = new Set(pack.protocols.flatMap((p) => p.determinants.map((d) => d.response)));
  assert.deepEqual(
    [...responses].sort(),
    ['BLS_DISPATCH', 'FOLLOW_LOCAL_PROTOCOL', 'SIMULTANEOUS_ALS_BLS'],
  );
});

test('unconscious + breathing "unsure" jumps to the CARDIAC ARREST/DOA card (v0.2)', () => {
  const events: string[] = [];
  const s = new DispatchSession(pack, {
    onEvent: (e) => {
      if (e.type === 'protocol_selected') events.push(`${e.via}:${e.protocolId}`);
    },
  });
  s.start();
  for (const a of ['12 Grove St', '609-555-0100', 'chest pain', 'Ana', '58', 'male', 'no']) s.answer(a);
  const out = s.answer("I'm not sure, maybe"); // conscious=no + breathing unsure -> jump
  assert.equal(out[0]!.stringId, 'kq_ca_responds', 'C1 card takes over');
  assert.deepEqual(events, ['keywords:chest_pain_heart_problems', 'jump:cardiac_arrest_doa']);
  s.answer('no');
  s.answer('no, gasping');
  s.answer('an hour ago');
  s.answer('no');
  assert.ok(s.isDone());
  const r = s.result();
  assert.equal(r.protocolId, 'cardiac_arrest_doa');
  assert.equal(r.determinantId, 'ca_als_arrest');
});

test('conscious + breathing "unsure" stays on the complaint card and dispatches', () => {
  const s = new DispatchSession(pack);
  s.start();
  for (const a of ['12 Grove St', '609-555-0100', 'chest pain', 'Ana', '58', 'male', 'yes']) s.answer(a);
  const out = s.answer("I'm not sure, maybe");
  assert.equal(out[0]!.stringId, 'dispatch_confirm');
  const r = s.result();
  assert.equal(r.determinantId, 'cp_als_breathing_unsure');
  assert.equal(r.response, 'SIMULTANEOUS_ALS_BLS');
});

test('numeric age tiers: under-35 chest pain reaches BLS_DISPATCH, unknown age stays ALS', () => {
  const young = run(
    ['12 Grove St', '609-555-0100', 'chest pain', 'Ana', 'he is 28 years old', 'male', 'yes', 'yes, normally'],
    { cp_sweating: 'no', cp_nausea: 'no', cp_weak: 'no', cp_pain_moves: 'no', cp_heart_history: 'no, never', cp_rapid_heart: 'no' },
  );
  assert.equal(young.numbers['age'], 28);
  assert.equal(young.determinantId, 'cp_bls_under_35');
  assert.equal(young.response, 'BLS_DISPATCH');

  const unknown = run(
    ['12 Grove St', '609-555-0100', 'chest pain', 'Ana', 'I have no idea', 'male', 'yes', 'yes, normally'],
    { cp_sweating: 'no', cp_nausea: 'no', cp_weak: 'no', cp_pain_moves: 'no', cp_heart_history: 'no, never', cp_rapid_heart: 'no' },
  );
  assert.equal(unknown.numbers['age'], undefined);
  assert.equal(unknown.determinantId, 'cp_als_default_age_unknown', 'age unknown -> higher tier');
});

test('chest pain with no critical symptoms still defaults to ALS (age-unknown, safety-first)', () => {
  const r = run(CASE_OK, {
    cp_sweating: 'no',
    cp_nausea: 'no',
    cp_weak: 'no',
    cp_pain_moves: 'no',
    cp_heart_history: 'no, never',
    cp_rapid_heart: 'no',
  });
  assert.equal(r.protocolId, 'chest_pain_heart_problems');
  assert.equal(r.determinantId, 'cp_als_default_age_unknown');
  assert.equal(r.response, 'SIMULTANEOUS_ALS_BLS');
});

test('cardiac arrest: confirmed hospice expected death → FOLLOW_LOCAL_PROTOCOL', () => {
  const r = run(
    ['12 Grove St', '609-555-0100', 'I think his heart stopped', 'Ana', '90', 'male', 'no', 'no'],
    {},
  );
  // breathing "no" short-circuits before key questions; hospice never asked -> ALS arrest
  assert.equal(r.protocolId, 'cardiac_arrest_doa');
  assert.equal(r.determinantId, 'ca_als_arrest');

  const r2 = run(
    ['12 Grove St', '609-555-0100', 'cardiac arrest, he is on hospice', 'Ana', '90', 'male', 'no', 'yes, normally'],
    { ca_responds: 'no', ca_breathing: 'yes, normally', ca_hospice: 'yes, he is on hospice' },
  );
  assert.equal(r2.determinantId, 'ca_hospice_expected_death');
  assert.equal(r2.response, 'FOLLOW_LOCAL_PROTOCOL');
});

test('recovered faint without critical symptoms → BLS_DISPATCH', () => {
  const r = run(
    ['12 Grove St', '609-555-0100', 'my mom fainted but came around', 'Ana', '40', 'female', 'yes', 'yes, normally'],
    {
      uf_first_time: 'yes, first time',
      uf_substances: 'no',
      uf_responds: 'yes, she responds and follows commands',
    },
  );
  assert.equal(r.protocolId, 'unconscious_fainting');
  assert.equal(r.determinantId, 'uf_bls_recovered');
  assert.equal(r.response, 'BLS_DISPATCH');
});

test('unclear complaint falls back to Unknown/Person Down → BLS third-party default', () => {
  const r = run(
    ['12 Grove St', '609-555-0100', 'somebody is lying on the sidewalk across the street', 'Ana', 'unknown', 'unknown', 'yes', 'yes, normally'],
    { up_injuries: 'no', up_blood: 'no' },
  );
  assert.equal(r.protocolId, 'unknown_person_down');
  assert.equal(r.determinantId, 'up_bls_third_party');
  assert.equal(r.response, 'BLS_DISPATCH');
});
