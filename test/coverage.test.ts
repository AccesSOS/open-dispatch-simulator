import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  coverage,
  loadPack,
  loadPackFromFile,
  loadRubric,
  loadRubricFromFile,
  RubricValidationError,
} from '../src/index.js';
import type { ProtocolPack, Rubric } from '../src/index.js';

const rubricsDir = fileURLToPath(new URL('../rubrics', import.meta.url));
const packsDir = fileURLToPath(new URL('../packs', import.meta.url));

const rubrics = readdirSync(rubricsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => loadRubricFromFile(join(rubricsDir, f)));
const packs = readdirSync(packsDir).map((d) => loadPackFromFile(join(packsDir, d, 'pack.json')));

const openises = packs.find((p) => p.id === 'us-openises-emd')!;
const maine = rubrics.find((r) => r.id === 'us-me-emdprs')!;
const nhtsa = rubrics.find((r) => r.id === 'us-nhtsa-emd-curriculum')!;

const req = (r: Rubric, packUnderTest: ProtocolPack, id: string) =>
  coverage(packUnderTest, r, rubrics).results.find((x) => x.id === id)!;

/** A minimal but valid pack, used to exercise each check kind in isolation. */
function tinyPack(overrides: Partial<ProtocolPack> = {}): ProtocolPack {
  const base = {
    schemaVersion: '0.2',
    id: 'test-pack',
    name: { en: 'Test' },
    jurisdiction: { country: 'US', emergencyNumber: '911' },
    provenance: { source: 'synthetic', license: 'CC0-1.0' },
    locales: ['en'],
    defaultLocale: 'en',
    caseEntry: [
      { id: 'q_loc', slot: 'location', stringId: 's_loc' },
      { id: 'q_cb', slot: 'callback', stringId: 's_cb' },
      { id: 'q_c', slot: 'complaint', stringId: 's_c', selectsProtocol: true },
    ],
    protocols: [
      {
        id: 'only',
        name: { en: 'Chest Pain' },
        keywords: { en: ['chest pain'] },
        keyQuestions: [{ id: 'kq', slot: 'sweating', stringId: 's_kq' }],
        determinants: [{ id: 'd', response: 'HOT' }],
        postDispatch: ['s_pd'],
      },
    ],
    fallbackProtocol: 'only',
    strings: {
      en: {
        greeting: '911.',
        closing: 'Help is on the way.',
        dispatch_confirm: 'Sending help.',
        clarify: 'Sorry?',
        s_loc: 'What is the address?',
        s_cb: 'What number are you calling from?',
        s_c: 'Tell me exactly what happened.',
        s_kq: 'Is the person sweating?',
        s_pd: 'Do not move the person.',
      },
    },
  };
  return loadPack({ ...base, ...overrides }) as ProtocolPack;
}

test('every bundled rubric loads and declares an open provenance license', () => {
  assert.ok(rubrics.length >= 2, 'expected the Maine and NHTSA rubrics');
  for (const r of rubrics) {
    assert.ok(r.requirements.length > 0, `${r.id} has requirements`);
    assert.ok(
      ['public-domain', 'government-edict', 'CC0-1.0', 'CC-BY-4.0'].includes(r.provenance.license),
      `${r.id} license ${r.provenance.license} is open`,
    );
    assert.ok(r.authority.instrument.length > 0);
    for (const req of r.requirements) assert.ok(req.citation.length > 0, `${req.id} cites its source`);
  }
});

test('loadRubric rejects a malformed rubric', () => {
  assert.throws(() => loadRubric({ schemaVersion: '0.1', id: 'x' }), RubricValidationError);
});

test('loadRubric rejects duplicate requirement ids and uncompilable patterns', () => {
  const dup = {
    schemaVersion: '0.1',
    id: 'dup',
    name: 'Dup',
    authority: { instrument: 'test' },
    provenance: { source: 'test', license: 'CC0-1.0' },
    requirements: [
      { id: 'A', citation: '§1', text: 'a', appliesTo: 'pack', check: { kind: 'cardJump' } },
      { id: 'A', citation: '§2', text: 'b', appliesTo: 'pack', check: { kind: 'text', patterns: ['('] } },
    ],
  };
  try {
    loadRubric(dup);
    assert.fail('expected RubricValidationError');
  } catch (e) {
    assert.ok(e instanceof RubricValidationError);
    assert.ok(e.problems.some((p) => p.includes('duplicate requirement id')));
    assert.ok(e.problems.some((p) => p.includes('invalid regex')));
  }
}); 

test('program-scope requirements are reported but never scored against a pack', () => {
  const report = coverage(openises, maine, rubrics);
  const program = report.results.filter((r) => r.appliesTo === 'program');
  assert.ok(program.length >= 3);
  for (const r of program) {
    assert.equal(r.status, 'n/a');
    assert.deepEqual(r.evidence, []);
  }
  assert.equal(report.summary.programScope, program.length);
  assert.equal(report.summary.scored, report.results.length - program.length);
  assert.equal(
    report.summary.met + report.summary.partial + report.summary.unmet,
    report.summary.scored,
  );
});

test('every met or partial finding cites evidence — a claim nobody can audit is worth nothing', () => {
  for (const pack of packs) {
    for (const rubric of rubrics) {
      for (const r of coverage(pack, rubric, rubrics).results) {
        if (r.status === 'met' || r.status === 'partial') {
          assert.ok(
            r.evidence.length > 0,
            `${pack.id}/${rubric.id}/${r.id} claims ${r.status} with no evidence`,
          );
        }
      }
    }
  }
});

test('checks fire off pack structure: caseEntry, order, selector, sections, levels', () => {
  const p = tinyPack();
  assert.equal(req(nhtsa, p, 'NHTSA-SURVEY-LOCATION').status, 'met');
  assert.equal(req(nhtsa, p, 'NHTSA-SURVEY-CALLBACK').status, 'met');
  assert.equal(req(nhtsa, p, 'NHTSA-SURVEY-COMPLAINT').status, 'met');
  assert.equal(req(nhtsa, p, 'NHTSA-SURVEY-AGE').status, 'unmet');
  assert.equal(req(nhtsa, p, 'NHTSA-ORDER-WHERE-FIRST').status, 'met');
  assert.equal(req(nhtsa, p, 'NHTSA-CARD-A').status, 'met');
  assert.equal(req(nhtsa, p, 'NHTSA-CARD-C').status, 'met');
  // one determinant response only — a pack with no way to vary the response
  assert.equal(req(nhtsa, p, 'NHTSA-CARD-B').status, 'partial');
  // no protocol-to-protocol jump declared
  assert.equal(req(nhtsa, p, 'NHTSA-ARREST-JUMP').status, 'unmet');
  // one post-dispatch string is not a scripted sequence
  assert.equal(req(nhtsa, p, 'NHTSA-TYPE-3').status, 'unmet');
});

test('caseEntryOrder fails when the location question comes after the complaint', () => {
  const p = tinyPack({
    caseEntry: [
      { id: 'q_c', slot: 'complaint', stringId: 's_c', selectsProtocol: true },
      { id: 'q_loc', slot: 'location', stringId: 's_loc' },
      { id: 'q_cb', slot: 'callback', stringId: 's_cb' },
    ],
  });
  const r = req(nhtsa, p, 'NHTSA-ORDER-WHERE-FIRST');
  assert.equal(r.status, 'unmet');
  assert.match(r.detail!, /reverse order/);
});

test('text checks are partial when some patterns match and name what is missing', () => {
  const r = req(maine, openises, 'ME-II-2-A-23a');
  assert.equal(r.status, 'partial');
  assert.match(r.detail!, /aed/i, 'the AED half of the requirement is the missing one');
  assert.ok(r.evidence.some((e) => e.includes('pd_cpr_push')));
});

test('a rubric may cite another rubric’s taxonomy', () => {
  // Maine §II.2.A.27 defers to the NHTSA 32 — resolved across rubrics.
  const r = req(maine, openises, 'ME-II-2-A-27');
  assert.equal(r.status, 'partial');
  assert.match(r.evidence[0]!, /31\/32/);
  assert.match(r.detail!, /electrocution/);
  // …and without the NHTSA rubric loaded, the check says so rather than guessing.
  const alone = coverage(openises, maine, []).results.find((x) => x.id === 'ME-II-2-A-27')!;
  assert.equal(alone.status, 'unmet');
  assert.match(alone.detail!, /not loaded/);
});

test('complaint coverage names the card a reader would name', () => {
  const r = req(nhtsa, openises, 'NHTSA-32-COMPLAINTS');
  assert.ok(r.evidence.includes('breathing-problems → m4_breathing_problems'));
  assert.ok(r.evidence.includes('cardiac-arrest → c1_cardiac_arrest'));
  assert.ok(r.evidence.includes('fall-victim → t6_falls'));
});

test('the flagship pack clears both rubrics comfortably', () => {
  for (const rubric of [maine, nhtsa]) {
    const report = coverage(openises, rubric, rubrics);
    assert.ok(
      report.summary.metRate >= 0.8,
      `${rubric.id}: ${(report.summary.metRate * 100).toFixed(0)}% is below the 80% the flagship pack has held`,
    );
    assert.equal(report.summary.unmet <= 4, true, `${rubric.id}: ${report.summary.unmet} unmet`);
  }
});

test('known gaps stay visible: no AED script, no proximity question, no electrocution card', () => {
  assert.equal(req(maine, openises, 'ME-II-2-A-8').status, 'unmet');
  assert.equal(req(maine, openises, 'ME-II-2-A-23g').status, 'unmet');
  assert.equal(req(nhtsa, openises, 'NHTSA-CARD-D').status, 'unmet');
});
