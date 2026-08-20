import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DispatchSession, loadPackFromFile } from '../src/index.js';

const packPath = fileURLToPath(new URL('../packs/us-alameda-police/pack.json', import.meta.url));
const pack = loadPackFromFile(packPath);

function run(caseAnswers: string[], bySlot: Record<string, string>) {
  const s = new DispatchSession(pack);
  s.start();
  for (const a of caseAnswers) {
    if (s.isDone()) break;
    s.answer(a);
  }
  let guard = 0;
  while (!s.isDone() && guard++ < 40) {
    s.answer(bySlot[s.pending()!.slot] ?? 'I could not tell');
  }
  return s.result();
}

// Case entry: what happened, when, where, dwelling, name, callback, suspect there, weapons
test('police pack loads: Alameda priority taxonomy + transfer', () => {
  const responses = new Set(pack.protocols.flatMap((p) => p.determinants.map((d) => d.response)));
  assert.deepEqual([...responses].sort(), ['PRIORITY_1', 'PRIORITY_2', 'PRIORITY_3', 'TRANSFER_FIRE_EMS']);
  assert.equal(pack.provenance.license, 'city-published-permission-pending');
});

test('burglary in progress ("someone is trying to break into my home") is PRIORITY_1', () => {
  const r = run(
    ['someone is trying to break into my home', 'it is happening right now', '533 Buena Vista Ave', 'a house', 'Dana', '510-555-0100', 'yes, still here', 'no'],
    {
      burg_vehicle: 'a white van out front, plate 1ABC123',
      burg_desc: 'white male, thirties, black hoodie and jeans',
      burg_caller_safe: 'I am locked in the upstairs bathroom',
    },
  );
  assert.equal(r.protocolId, 'burglary_459');
  assert.equal(r.determinantId, 'burg_p1_in_progress');
  assert.equal(r.response, 'PRIORITY_1');
});

test('cold burglary report is PRIORITY_3 per the manual', () => {
  const r = run(
    ['somebody broke into my garage', 'it was last night while we slept', '533 Buena Vista Ave', 'a house', 'Dana', '510-555-0100', 'no, long gone', 'no'],
    {},
  );
  assert.equal(r.protocolId, 'burglary_459');
  assert.equal(r.determinantId, 'burg_p3_cold');
  assert.equal(r.response, 'PRIORITY_3');
});

test('physical domestic violence is PRIORITY_1; verbal disturbance is PRIORITY_2', () => {
  const physical = run(
    ['my husband is hitting me', 'right now', '2260 Buena Vista Apt 4', 'apartment 4', 'R', '510-555-0111', 'yes', 'no'],
    { dv_physical: 'physical, he hit me', dv_speak_freely: 'no I cannot', dv_desc: 'my husband' },
  );
  assert.equal(physical.protocolId, 'domestic_violence');
  assert.equal(physical.determinantId, 'dv_p1_physical');
  assert.equal(physical.response, 'PRIORITY_1');

  const verbal = run(
    ['the neighbors are fighting and screaming at each other', 'right now', '2260 Buena Vista Apt 4', 'apartment', 'R', '510-555-0111', 'yes', 'no'],
    { dv_physical: 'just verbal, yelling', dv_speak_freely: 'yes', dv_desc: 'two adults next door' },
  );
  assert.equal(verbal.determinantId, 'dv_p2_disturbance');
  assert.equal(verbal.response, 'PRIORITY_2');
});

test('suspicious person is PRIORITY_2, upgraded to PRIORITY_1 by a weapon', () => {
  const base = ['there is a suspicious man looking into cars', 'right now', '1500 Santa Clara Ave', 'on the street', 'F', '510-555-0122'];
  const noWeapon = run([...base, 'yes, still there', 'no'], {});
  assert.equal(noWeapon.protocolId, 'suspicious_person_912p');
  assert.equal(noWeapon.response, 'PRIORITY_2');

  const weapon = run([...base, 'yes, still there', 'yes, I think he has a knife'], {});
  assert.equal(weapon.determinantId, 'susp_p1_weapons');
  assert.equal(weapon.response, 'PRIORITY_1');
});

test('injury accident is automatic PRIORITY_1 with an EMS transfer line', () => {
  const s = new DispatchSession(pack);
  const texts: string[] = s.start().map((u) => u.text);
  for (const a of ['a car crash, someone got hit', 'just now', 'Webster and Buena Vista', 'intersection', 'J', '510-555-0133', 'no', 'no', 'yes, the pedestrian is hurt', 'two cars', 'yes, blocking']) {
    if (s.isDone()) break;
    texts.push(...s.answer(a).map((u) => u.text));
  }
  const r = s.result();
  assert.equal(r.protocolId, 'injury_accident_901a');
  assert.equal(r.determinantId, 'acc_p1_injury');
  assert.equal(r.response, 'PRIORITY_1');
  assert.ok(texts.some((t) => t.includes('connecting you with fire and medical')), 'ACRECC transfer line spoken');
});

test('medical complaint to the police line screens straight to transfer', () => {
  const s = new DispatchSession(pack);
  s.start();
  s.answer('my father is having a heart attack');
  s.answer('right now');
  s.answer('1412 Caroline St');
  s.answer('house');
  s.answer('Ana');
  s.answer('510-555-0144');
  s.answer('no');
  const out = s.answer('no');
  assert.equal(out[0]!.stringId, 'dispatch_confirm');
  const r = s.result();
  assert.equal(r.protocolId, 'fire_medical_transfer');
  assert.equal(r.response, 'TRANSFER_FIRE_EMS');
});
