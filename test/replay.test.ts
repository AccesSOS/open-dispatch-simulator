import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadPackFromFile } from '../src/loader.js';
import {
  aggregate,
  formatReport,
  producibleCodes,
  replayCase,
  scanForIdentifiers,
  unknownPhrase,
  validateCase,
  validateCodeMap,
} from '../src/replay.js';
import type { CodeMap, ReplayCase } from '../src/replay.js';
import type { ProtocolPack } from '../src/types.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const packIds = readdirSync(join(root, 'packs'));
const packs = new Map<string, ProtocolPack>(
  packIds.map((id) => [id, loadPackFromFile(join(root, 'packs', id, 'pack.json'))]),
);
const mapFor = (id: string): CodeMap => JSON.parse(readFileSync(join(root, 'replay', 'codes', `${id}.json`), 'utf8'));
const fixtureDir = join(root, 'test', 'fixtures', 'replay');
const fixtures: ReplayCase[] = readdirSync(fixtureDir)
  .sort()
  .map((f) => JSON.parse(readFileSync(join(fixtureDir, f), 'utf8')));
const protocolsByPack = Object.fromEntries([...packs].map(([id, p]) => [id, p.protocols.map((x) => x.id)]));
const openises = packs.get('us-openises-emd')!;
const openisesMap = mapFor('us-openises-emd');

// --- code maps ---

test('every shipped pack has a code map, and every key in it exists in the pack', () => {
  for (const [id, pack] of packs) {
    const map = mapFor(id);
    assert.deepEqual(validateCodeMap(pack, map), [], id);
  }
});

test('every case-entry slot and every key-question slot of every pack is mapped', () => {
  // Map coverage is what makes "unmapped" mean "not a behavior" rather than "forgot".
  for (const [id, pack] of packs) {
    const map = mapFor(id);
    const missing: string[] = [];
    for (const q of pack.caseEntry) if (!map.slots[q.slot]) missing.push(q.slot);
    for (const p of pack.protocols) for (const q of p.keyQuestions) if (!map.slots[q.slot]) missing.push(q.slot);
    for (const s of pack.scripts ?? []) for (const st of s.steps) if (st.slot && !map.slots[st.slot]) missing.push(st.slot);
    assert.deepEqual(missing, [], `${id} unmapped slots`);
    // Every pack announces dispatch, and the announcement is an instruction.
    assert.ok([map.strings.dispatch_confirm].flat().includes('I.help_on_way'), `${id} dispatch_confirm`);
  }
});

test('the code map rejects keys the pack does not have and codes outside the taxonomy', () => {
  const errors = validateCodeMap(openises, {
    pack: 'us-openises-emd',
    slots: { no_such_slot: 'Q.location', location: 'Q.not_a_code' },
    strings: { no_such_string: 'I.help_on_way', dispatch_confirm: 'I.nope' },
    steps: { 'i1_aed/no_such_step': 'I.aed' },
    scripts: { no_such_script: 'I.aed' },
  });
  assert.equal(errors.length, 6, errors.join('\n'));
});

// --- case-file validation ---

test('the three fixtures validate against the shipped packs', () => {
  for (const c of fixtures) assert.deepEqual(validateCase(c, { packs: protocolsByPack }), [], String(c.sourceId));
});

test('identifier scan: phone numbers, streets, capitalized words, name phrases, and nothing else', () => {
  assert.deepEqual(scanForIdentifiers('my baby is not breathing'), []);
  assert.deepEqual(scanForIdentifiers('12 Pine St'), []);
  assert.deepEqual(scanForIdentifiers('555-0100'), []);
  assert.deepEqual(scanForIdentifiers('4 months'), []);
  assert.deepEqual(scanForIdentifiers('he is 58, had a heart attack in 2019'), []);
  assert.deepEqual(scanForIdentifiers("I think so, I'm not sure, the EMS crew came last time"), []);
  assert.match(scanForIdentifiers('call me at 415-555-2368')[0]!, /phone-like/);
  assert.match(scanForIdentifiers('555 2368')[0]!, /phone-like/);
  assert.match(scanForIdentifiers('(415) 555 2368')[0]!, /phone-like/);
  assert.match(scanForIdentifiers('940 main street')[0]!, /street name/);
  assert.match(scanForIdentifiers('we are on elm avenue')[0]!, /street name/);
  // Generic words before a street type are not street names.
  assert.deepEqual(scanForIdentifiers('pulled over on the side of the road, on the highway near a county road'), []);
  assert.deepEqual(scanForIdentifiers('a long dirt road off the main road'), []);
  assert.match(scanForIdentifiers('my name is Robert')[0]!, /personal-name|capitalized/);
  assert.match(scanForIdentifiers('it is Robert, he fell')[0]!, /capitalized word "Robert"/);
  assert.match(scanForIdentifiers('email me at a@b.co')[0]!, /email/);
});

test('a case file with real-looking details is rejected, with the reasons', () => {
  const base = fixtures[0]!;
  const errs = (patch: Partial<ReplayCase> & { facts?: Record<string, string> }) =>
    validateCase({ ...base, ...patch, facts: { ...base.facts, ...(patch.facts ?? {}) } }, { packs: protocolsByPack });
  assert.ok(errs({ facts: { 'Q.location': '940 main street' } }).some((e) => /placeholder/.test(e)));
  assert.ok(errs({ facts: { 'Q.callback': '415-555-2368' } }).some((e) => /placeholder/.test(e)));
  assert.deepEqual(errs({ facts: { 'Q.location': 'unknown' } }), [], 'a caller who did not know the address');
  assert.ok(errs({ facts: { 'Q.age': 'he is Robert, 40' } }).some((e) => /capitalized/.test(e)));
  assert.ok(errs({ facts: { 'Q.caller_name': 'maria' } }).some((e) => /never the name/.test(e)));
  assert.ok(errs({ facts: { 'Q.history': 'lives at 22 oak lane' } }).some((e) => /street/.test(e)));
  assert.ok(errs({ impliedProtocol: 'c99_nope' }).some((e) => /not a protocol/.test(e)));
  assert.ok(errs({ pack: 'no-such-pack' }).some((e) => /unknown pack/.test(e)));
});

test('sanity rules: an observed question implies a fact, codes are from the taxonomy, dispatch moment is in range', () => {
  const base = fixtures[0]!;
  const withObserved = (observed: Partial<ReplayCase['observed']>) =>
    validateCase({ ...base, observed: { ...base.observed, ...observed } }, { packs: protocolsByPack });
  assert.ok(withObserved({ questions: [...base.observed.questions, 'Q.history'] }).some((e) => /has no fact/.test(e)));
  assert.ok(withObserved({ questions: ['Q.bogus'] }).some((e) => /not a question code/.test(e)));
  assert.ok(withObserved({ instructions: ['I.bogus'] }).some((e) => /not an instruction code/.test(e)));
  assert.ok(withObserved({ instructions: ['I.other:Bad Slug'] }).some((e) => /not an instruction code/.test(e)));
  assert.ok(withObserved({ dispatchAfterQuestion: 99 }).some((e) => /exceeds/.test(e)));
  assert.ok(withObserved({ dispatchAfterQuestion: -1 }).some((e) => /non-negative/.test(e)));
  // null = the dispatcher never said help was coming; a real outcome, not a coding error.
  assert.deepEqual(withObserved({ dispatchAfterQuestion: null }), []);
  assert.ok(withObserved({ questions: ['Q.location', 'Q.location'] }).some((e) => /repeats/.test(e)));
  assert.ok(withObserved({ notes: 'transferred to Mercy hospital' }).some((e) => /notes: capitalized/.test(e)));
  // "unknown" is a fact: the dispatcher asked, the caller could not say.
  assert.deepEqual(
    validateCase(
      { ...base, facts: { ...base.facts, 'Q.history': 'unknown' }, observed: { ...base.observed, questions: [...base.observed.questions, 'Q.history'] } },
      { packs: protocolsByPack },
    ),
    [],
  );
});

// --- replay ---

test('a coded cardiac-arrest call replays into the C1 card and infant CPR, with nothing invented', () => {
  const c = fixtures[0]!;
  const b = replayCase(openises, openisesMap, c);
  assert.ok(b.completed);
  assert.equal(b.protocolId, 'c1_cardiac_arrest');
  // "Not breathing" at case entry jumps straight to the C1 card — the fast-track, not a keyword match.
  assert.equal(b.selectedVia, 'jump');
  assert.deepEqual(b.questions.slice(0, 3), ['Q.location', 'Q.callback', 'Q.what_happened']);
  assert.ok(b.instructions.includes('I.help_on_way'));
  assert.ok(b.instructions.includes('I.cpr_compressions'));
  assert.ok(b.instructions.includes('I.cpr_breaths'));
  assert.ok(b.questionsBeforeDispatch > c.observed.dispatchAfterQuestion);
  // Slots the call never covered were answered "I don't know", never guessed …
  assert.deepEqual(b.unknownSlots, ['c1_expected']);
  // … and the jump skipped the rest of case entry (sex, caller name) — the engine never asked.
  assert.ok(!b.questions.includes('Q.sex') && !b.questions.includes('Q.caller_name'));
  assert.deepEqual(b.unmappedSlots, []);
});

test('an "unknown" fact is fed as the lexicon\'s own I-don\'t-know phrase, per locale', () => {
  assert.equal(unknownPhrase(openises, 'en'), "i don't know");
  assert.equal(unknownPhrase(openises, 'es'), 'no sé');
  assert.equal(unknownPhrase(openises, 'fr'), 'je ne sais pas');
  const c = fixtures[2]!; // Q.age and Q.breathing are "unknown"
  const b = replayCase(openises, openisesMap, c);
  assert.ok(b.unknownSlots.includes('age'));
  assert.ok(b.unknownSlots.includes('breathing'));
});

test('replay is deterministic', () => {
  for (const c of fixtures) {
    assert.deepEqual(replayCase(openises, openisesMap, c), replayCase(openises, openisesMap, c));
  }
});

test('every pack replays every fixture to completion (facts are keyed by code, not by pack)', () => {
  for (const [id, pack] of packs) {
    const map = mapFor(id);
    for (const c of fixtures) {
      const b = replayCase(pack, map, c);
      assert.ok(b.completed, `${id} / fixture ${c.sourceId}`);
      assert.ok(b.instructions.includes('I.help_on_way'), `${id} announces dispatch`);
    }
  }
});

// --- aggregates ---

test('the report is aggregates only: counts, ratios, and codes — never a fact, a note, or a source id', () => {
  const replayed = fixtures.map((c) => ({ c, b: replayCase(openises, openisesMap, c) }));
  const r = aggregate(openises, openisesMap, replayed);
  assert.equal(r.cases, 3);
  assert.equal(r.completed, 3);
  assert.equal(r.protocol.compared, 2);
  assert.equal(r.protocol.agree, 2);
  assert.equal(r.protocol.skipped, 1);
  assert.equal(r.questions.core.observed, 20);
  assert.ok(r.questions.core.recall! > 0.9);
  assert.ok(r.dispatchTiming.engineLater === 3, 'the engine finishes its interrogation before announcing dispatch');
  assert.equal(r.dispatchTiming.neverAnnounced, 0);
  const never = aggregate(openises, openisesMap, [
    ...replayed,
    { c: { ...fixtures[0]!, observed: { ...fixtures[0]!.observed, dispatchAfterQuestion: null } }, b: replayed[0]!.b },
  ]);
  assert.equal(never.dispatchTiming.neverAnnounced, 1);
  assert.equal(never.dispatchTiming.evaluated, 3);
  assert.equal(r.opening.evaluated, 3);
  assert.ok(r.opening.kendallTau !== null);
  const text = formatReport(r);
  const json = JSON.stringify(r);
  for (const c of fixtures) {
    for (const v of Object.values(c.facts)) {
      if (v === '12 Pine St' || v === '555-0100' || /^(yes|no|1|unknown|given|female|male)$/.test(v)) continue;
      assert.ok(!text.includes(v) && !json.includes(v), `fact leaked: ${v}`);
    }
    assert.ok(!text.includes(c.observed.notes!) && !json.includes(c.observed.notes!), 'notes leaked');
  }
  assert.ok(!text.includes('fixture'), 'source leaked');
  assert.ok(!text.includes('12 Pine St') && !text.includes('555-0100'));
});

test('the miss list names exactly the codes this pack cannot produce on any path', () => {
  const replayed = fixtures.map((c) => ({ c, b: replayCase(openises, openisesMap, c) }));
  const r = aggregate(openises, openisesMap, replayed);
  const q = r.missList.questions.map((t) => t.code);
  const i = r.missList.instructions.map((t) => t.code);
  assert.ok(q.includes('Q.kq:not_a_real_question'));
  assert.ok(q.includes('Q.with_patient'), 'OpenISES has no caller-proximity question — a known rubric gap');
  assert.ok(i.includes('I.other:not_a_real_instruction'));
  // pd_m14_mouth exists, so "nothing in mouth" is producible and must NOT be on the miss list,
  // even though this replay never reached the seizure card.
  assert.ok(!i.includes('I.other:nothing_in_mouth'));
  const producible = producibleCodes(openisesMap);
  for (const code of q) assert.ok(!producible.questions.has(code));
});

test('the unmapped-slot report is empty for every shipped map', () => {
  for (const [id, pack] of packs) {
    const map = mapFor(id);
    const replayed = fixtures.map((c) => ({ c, b: replayCase(pack, map, c) }));
    assert.deepEqual(aggregate(pack, map, replayed).unmappedSlots, [], id);
  }
});
