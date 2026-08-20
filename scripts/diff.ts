import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPackFromFile } from '../src/loader.js';
import { loadRubricFromFile } from '../src/coverage.js';
import { diffPacks } from '../src/diff.js';
import type { PackDiffResult, SetDiff } from '../src/diff.js';

/**
 * npm run diff -- packs/a/pack.json packs/b/pack.json [--json] [--taxonomy <rubricId#key>]
 *
 * Structural only — see src/diff.ts for why there is no similarity score here.
 */
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const asJson = argv.includes('--json');
const paths = argv.filter((x, i) => !x.startsWith('--') && !argv[i - 1]?.startsWith('--taxonomy'));

if (paths.length !== 2) {
  console.error('usage: npm run diff -- <a/pack.json> <b/pack.json> [--json] [--taxonomy <rubricId#key>]');
  process.exit(2);
}

const DEFAULT_TAXONOMY = 'us-nhtsa-emd-curriculum#chief-complaints-32';
const ref = flag('taxonomy') ?? DEFAULT_TAXONOMY;
const [rubricId = '', key = ''] = ref.split('#');

const rubricsDir = new URL('../rubrics', import.meta.url).pathname;
const rubric = readdirSync(rubricsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => loadRubricFromFile(join(rubricsDir, f)))
  .find((r) => r.id === rubricId);
const taxonomy = rubric?.taxonomies?.[key];
if (!taxonomy && flag('taxonomy')) {
  console.error(`✗ taxonomy ${ref} not found in rubrics/`);
  process.exit(2);
}

const a = loadPackFromFile(paths[0]!);
const b = loadPackFromFile(paths[1]!);
const result = diffPacks(a, b, taxonomy ? { taxonomy: { id: ref, taxonomy } } : {});

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const CAP = 8;
const list = (xs: string[]) =>
  xs.length > CAP ? `${xs.slice(0, CAP).join(', ')} …and ${xs.length - CAP} more` : xs.join(', ');

const fmt = (d: SetDiff, labelA: string, labelB: string, indent = '  ') => {
  if (d.onlyA.length) console.log(`${indent}only ${labelA} (${d.onlyA.length}): ${list(d.onlyA)}`);
  if (d.onlyB.length) console.log(`${indent}only ${labelB} (${d.onlyB.length}): ${list(d.onlyB)}`);
  if (!d.onlyA.length && !d.onlyB.length) console.log(`${indent}same (${d.both.length})`);
};

const A = result.a.id;
const B = result.b.id;
console.log(`${A} [${result.a.locales.join('/')}, ${result.a.protocols} protocols]`);
console.log(`${B} [${result.b.locales.join('/')}, ${result.b.protocols} protocols]`);

if (result.identical) {
  console.log('\nStructurally identical.');
  process.exit(0);
}

console.log('\nLocales');
fmt(result.locales, A, B);

console.log('\nCase entry (asked on every call)');
fmt(result.caseEntry, A, B);
for (const r of result.caseEntry.reordered) {
  console.log(`  reordered: ${r.slot} — #${r.positionA} in ${A}, #${r.positionB} in ${B}`);
}

if (result.complaints) {
  console.log(`\nComplaint coverage (${result.complaints.taxonomy})`);
  fmt(result.complaints, A, B);
}

console.log('\nResponse levels — jurisdiction-specific names, never auto-mapped');
console.log(`  ${A}: ${result.responseLevels.a.map((l) => `${l.level}×${l.protocols}`).join('  ') || '—'}`);
console.log(`  ${B}: ${result.responseLevels.b.map((l) => `${l.level}×${l.protocols}`).join('  ') || '—'}`);
if (result.responseLevels.sharedNames.length) {
  console.log(`  shared names: ${result.responseLevels.sharedNames.join(', ')}`);
}

console.log('\nProtocols');
if (result.protocols.onlyA.length) console.log(`  only ${A}: ${result.protocols.onlyA.join(', ')}`);
if (result.protocols.onlyB.length) console.log(`  only ${B}: ${result.protocols.onlyB.join(', ')}`);
console.log(`  aligned: ${result.protocols.matched.length}`);

for (const m of result.protocols.matched) {
  const changed =
    m.slots.onlyA.length ||
    m.slots.onlyB.length ||
    m.decisionSlots.onlyA.length ||
    m.decisionSlots.onlyB.length ||
    m.responseLevels.onlyA.length ||
    m.responseLevels.onlyB.length ||
    m.jumpsOut.onlyA.length ||
    m.jumpsOut.onlyB.length ||
    m.determinantCount.a !== m.determinantCount.b ||
    m.postDispatchSteps.a !== m.postDispatchSteps.b;
  if (!changed) continue;
  const how = m.via === 'id' ? 'same id' : `via ${m.taxonomyEntry}`;
  console.log(`\n  ${m.idA}  ↔  ${m.idB}   (${how})`);
  console.log(`    ${m.nameA}`);
  console.log(`    ${m.nameB}`);
  if (m.via === 'taxonomy') {
    console.log('    (slot ids are pack-local — across jurisdictions, read the counts, not the names)');
  }
  console.log('    key-question slots:');
  fmt(m.slots, A, B, '      ');
  if (m.decisionSlots.onlyA.length || m.decisionSlots.onlyB.length) {
    console.log('    slots the determinants branch on:');
    fmt(m.decisionSlots, A, B, '      ');
  }
  if (m.responseLevels.onlyA.length || m.responseLevels.onlyB.length) {
    console.log('    response levels reachable:');
    fmt(m.responseLevels, A, B, '      ');
  }
  if (m.jumpsOut.onlyA.length || m.jumpsOut.onlyB.length) {
    console.log('    card jumps out:');
    fmt(m.jumpsOut, A, B, '      ');
  }
  if (m.determinantCount.a !== m.determinantCount.b) {
    console.log(`    determinant rules: ${m.determinantCount.a} vs ${m.determinantCount.b}`);
  }
  if (m.postDispatchSteps.a !== m.postDispatchSteps.b) {
    console.log(`    post-dispatch steps: ${m.postDispatchSteps.a} vs ${m.postDispatchSteps.b}`);
  }
}

const unchanged = result.protocols.matched.length;
console.log(`\n(${unchanged} aligned card${unchanged === 1 ? '' : 's'}; identical ones omitted above.)`);
