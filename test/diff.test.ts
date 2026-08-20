import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { diffPacks, loadPackFromFile, loadRubricFromFile } from '../src/index.js';
import type { ProtocolPack } from '../src/index.js';

const packsDir = fileURLToPath(new URL('../packs', import.meta.url));
const load = (id: string) => loadPackFromFile(join(packsDir, id, 'pack.json'));

const openises = load('us-openises-emd');
const nj = load('us-nj-emd');
const mx = load('mx-cnie-911');

const nhtsa = loadRubricFromFile(
  fileURLToPath(new URL('../rubrics/us-nhtsa-emd-curriculum.json', import.meta.url)),
);
const TAX = {
  id: 'us-nhtsa-emd-curriculum#chief-complaints-32',
  taxonomy: nhtsa.taxonomies!['chief-complaints-32']!,
};

const clone = (p: ProtocolPack): ProtocolPack => JSON.parse(JSON.stringify(p));

test('a pack against itself is structurally identical', () => {
  for (const p of [openises, nj, mx]) {
    const d = diffPacks(p, p, { taxonomy: TAX });
    assert.equal(d.identical, true, `${p.id} differs from itself`);
    assert.deepEqual(d.protocols.onlyA, []);
    assert.deepEqual(d.protocols.onlyB, []);
    assert.deepEqual(d.caseEntry.reordered, []);
  }
});

test('both sides of every set diff are reported', () => {
  // Regression: the diff once read its inputs as iterators and consumed them
  // twice, so onlyB came back empty and every difference looked one-sided.
  const d = diffPacks(openises, nj, { taxonomy: TAX });
  assert.deepEqual(d.locales.onlyA, ['es', 'fr']);
  assert.deepEqual(d.locales.onlyB, []);
  assert.ok(d.caseEntry.onlyA.includes('breathing'), 'openises asks `breathing`');
  assert.ok(d.caseEntry.onlyB.includes('breathing_normally'), 'NJ asks `breathing_normally`');
  assert.ok(d.caseEntry.both.includes('location'));
});

test('case-entry reordering is reported with both positions', () => {
  const d = diffPacks(openises, nj, { taxonomy: TAX });
  const moved = d.caseEntry.reordered.find((r) => r.slot === 'caller_name');
  assert.ok(moved, 'caller_name moves between the two packs');
  assert.equal(moved.positionA, 9);
  assert.equal(moved.positionB, 4);
});

test('cards align across jurisdictions through the shared complaint taxonomy', () => {
  const d = diffPacks(openises, nj, { taxonomy: TAX });
  const pair = d.protocols.matched.find((m) => m.taxonomyEntry === 'chest-pain');
  assert.ok(pair);
  assert.equal(pair.via, 'taxonomy');
  assert.equal(pair.idA, 'm5_chest_pain');
  assert.equal(pair.idB, 'chest_pain_heart_problems');
  assert.ok(d.protocols.onlyA.includes('t4_burns'), 'NJ has no burns card');
});

test('alignment works across languages — the taxonomy is the shared vocabulary', () => {
  const d = diffPacks(nj, mx, { taxonomy: TAX });
  const pair = d.protocols.matched.find((m) => m.taxonomyEntry === 'chest-pain');
  assert.ok(pair);
  assert.equal(pair.idB, 'inc10314_infarto');
  assert.ok(d.protocols.matched.some((m) => m.taxonomyEntry === 'cardiac-arrest'));
});

test('without a taxonomy, packs from different jurisdictions align on ids alone', () => {
  const d = diffPacks(openises, nj);
  assert.equal(d.protocols.matched.length, 0);
  assert.equal(d.complaints, undefined);
  assert.equal(d.protocols.onlyA.length, openises.protocols.length);
  assert.equal(d.protocols.onlyB.length, nj.protocols.length);
});

test('response level names are never mapped across jurisdictions', () => {
  const d = diffPacks(openises, nj, { taxonomy: TAX });
  assert.deepEqual(d.responseLevels.sharedNames, []);
  assert.ok(d.responseLevels.a.some((l) => l.level === 'CODE_RED'));
  assert.ok(d.responseLevels.b.some((l) => l.level === 'SIMULTANEOUS_ALS_BLS'));
  const pair = d.protocols.matched.find((m) => m.taxonomyEntry === 'chest-pain')!;
  assert.deepEqual(pair.responseLevels.both, [], 'CODE_RED is not SIMULTANEOUS_ALS_BLS');
});

test('a targeted edit shows up exactly where it was made, and nowhere else', () => {
  const edited = clone(openises);
  edited.id = 'us-openises-emd-edited';
  edited.protocols[0]!.determinants[0]!.response = 'CODE_BLUE';
  edited.protocols[0]!.postDispatch.pop();
  [edited.caseEntry[0], edited.caseEntry[1]] = [edited.caseEntry[1]!, edited.caseEntry[0]!];

  const d = diffPacks(openises, edited, { taxonomy: TAX });
  assert.equal(d.identical, false);
  assert.deepEqual(d.caseEntry.onlyA, []);
  assert.deepEqual(
    d.caseEntry.reordered.map((r) => r.slot).sort(),
    ['callback', 'location'],
  );

  const touched = d.protocols.matched.find((m) => m.idA === openises.protocols[0]!.id)!;
  assert.equal(touched.via, 'id');
  assert.deepEqual(touched.responseLevels.onlyB, ['CODE_BLUE']);
  assert.equal(touched.postDispatchSteps.a, touched.postDispatchSteps.b + 1);

  const untouched = d.protocols.matched.filter((m) => m.idA !== openises.protocols[0]!.id);
  for (const m of untouched) {
    assert.deepEqual(m.slots.onlyA, [], `${m.idA} should be untouched`);
    assert.deepEqual(m.responseLevels.onlyA, []);
    assert.equal(m.postDispatchSteps.a, m.postDispatchSteps.b);
  }
});

test('card jumps are diffed structurally', () => {
  const d = diffPacks(openises, nj, { taxonomy: TAX });
  const breathing = d.protocols.matched.find((m) => m.taxonomyEntry === 'breathing-problems')!;
  assert.ok(breathing.jumpsOut.onlyA.includes('m5_chest_pain'));
});
