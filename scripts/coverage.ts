import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPackFromFile } from '../src/loader.js';
import { coverage, loadRubricFromFile } from '../src/coverage.js';
import type { CoverageReport, RequirementResult } from '../src/coverage.js';

/**
 * Measure every pack against every published requirements rubric.
 *
 * This is the project's safe comparison story (docs/PRIVATE-PACKS.md): we score
 * the open corpus against public law and public curricula — never against a
 * proprietary protocol. Every row prints the evidence behind its verdict so a
 * reader can check the tool's work against the pack by hand.
 */
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

const asJson = has('json');
const showAll = has('all');
const onlyPack = flag('pack');
const onlyRubric = flag('rubric');
const min = flag('min') ? Number(flag('min')) : undefined;

const packsDir = new URL('../packs', import.meta.url).pathname;
const rubricsDir = new URL('../rubrics', import.meta.url).pathname;

const rubrics = readdirSync(rubricsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => loadRubricFromFile(join(rubricsDir, f)))
  .sort((a, b) => a.id.localeCompare(b.id));

const packs = readdirSync(packsDir)
  .map((d) => loadPackFromFile(join(packsDir, d, 'pack.json')))
  .sort((a, b) => a.id.localeCompare(b.id));

const reports: CoverageReport[] = [];
for (const pack of packs) {
  if (onlyPack && pack.id !== onlyPack) continue;
  for (const rubric of rubrics) {
    if (onlyRubric && rubric.id !== onlyRubric) continue;
    reports.push(coverage(pack, rubric, rubrics));
  }
}

if (asJson) {
  console.log(JSON.stringify({ generated: { packs: packs.length, rubrics: rubrics.length }, reports }, null, 2));
} else {
  const GLYPH: Record<RequirementResult['status'], string> = {
    met: '✓',
    partial: '~',
    unmet: '✗',
    'n/a': '–',
  };
  for (const r of reports) {
    const rubric = rubrics.find((x) => x.id === r.rubricId)!;
    const pct = (r.summary.metRate * 100).toFixed(0);
    console.log(`\n${'─'.repeat(78)}`);
    console.log(`${r.packId} [${r.locales.join('/')}]  vs  ${r.rubricName}`);
    console.log(`  ${r.citation}`);
    if (rubric.scope) {
      console.log(`  rubric scope: ${rubric.scope} — a pack for another discipline scores low by definition, which is a scope statement, not a defect.`);
    }
    console.log(
      `  ${r.summary.met} met · ${r.summary.partial} partial · ${r.summary.unmet} unmet of ${r.summary.scored} scored (${pct}%)` +
        `; ${r.summary.programScope} program-scope requirements not scored`,
    );
    console.log('');
    for (const req of r.results) {
      if (req.appliesTo === 'program' && !showAll) continue;
      console.log(`  ${GLYPH[req.status]} ${req.id}  ${req.text}`);
      console.log(`      ${req.citation}`);
      for (const e of req.evidence.slice(0, 6)) console.log(`      · ${e}`);
      if (req.evidence.length > 6) console.log(`      · …and ${req.evidence.length - 6} more`);
      if (req.detail) console.log(`      ! ${req.detail}`);
    }
    if (!showAll && r.summary.programScope) {
      console.log(
        `\n  (${r.summary.programScope} program-scope requirements omitted — QA/QI, training, records. Run with --all to list them.)`,
      );
    }
  }
  console.log(`\n${'─'.repeat(78)}\nSummary`);
  for (const r of reports) {
    console.log(
      `  ${r.packId.padEnd(20)} ${r.rubricId.padEnd(26)} ${String(r.summary.met).padStart(3)}/${r.summary.scored} met` +
        `  (${(r.summary.metRate * 100).toFixed(0)}%, ${r.summary.partial} partial)`,
    );
  }
}

if (min !== undefined) {
  const below = reports.filter((r) => r.summary.metRate * 100 < min);
  if (below.length) {
    console.error(
      `\n✗ below --min ${min}%: ${below.map((r) => `${r.packId}/${r.rubricId} (${(r.summary.metRate * 100).toFixed(0)}%)`).join(', ')}`,
    );
    process.exit(1);
  }
}
