import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ReplayCase } from '../src/replay.js';

/**
 * npm run replay:qa -- <cases-dir> [--out review-sheet.csv] [--sample 0.10] [--candidates <csv>]
 *   writes a review sheet: a deterministic sample of case files (id, link, the coder's codes, and
 *   blank columns for a human to fill in while listening).
 *
 * npm run replay:qa -- <cases-dir> --score <completed-sheet.csv>
 *   after the sheet comes back: per-code agreement between the coder and the human reviewer.
 *
 * The sheet holds codes, never facts or transcript text; it lives under replay-private/ too.
 * Reviewer conventions (also written as the sheet's last column): leave `human_questions`
 * blank to agree with the coder's codes; otherwise write the full corrected list. Same for
 * `human_instructions` and `human_dispatch_after`. `human_agrees` is yes / no / partly.
 */
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const dir = positional[0];
if (!dir) {
  console.error('usage: npm run replay:qa -- <cases-dir> [--out sheet.csv] [--sample 0.1] [--candidates csv] | --score <sheet.csv>');
  process.exit(2);
}

function files(d: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(d).sort()) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}
const cases = files(resolve(dir))
  .map((f) => ({ file: f, c: JSON.parse(readFileSync(f, 'utf8')) as ReplayCase }))
  .filter((x) => x.c && x.c.observed);
const idOf = (c: ReplayCase) => `${c.source}-${c.sourceId}`;

/** RFC-4180-enough. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.length)) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, ''), r[i] ?? ''])));
}
const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;

const scoreSheet = flag('score');
if (scoreSheet) {
  const rows = parseCsv(readFileSync(scoreSheet, 'utf8'));
  const byId = new Map(cases.map((x) => [idOf(x.c), x.c]));
  const tally = new Map<string, { coder: number; human: number; both: number }>();
  const get = (code: string) => {
    let t = tally.get(code);
    if (!t) tally.set(code, (t = { coder: 0, human: 0, both: 0 }));
    return t;
  };
  let reviewed = 0;
  let agrees = 0;
  let partly = 0;
  let disagrees = 0;
  let dispatchSame = 0;
  let dispatchReviewed = 0;
  for (const r of rows) {
    const c = byId.get(r.id ?? '');
    const verdict = (r.human_agrees ?? '').trim().toLowerCase();
    if (!c || !verdict) continue;
    reviewed++;
    if (verdict === 'yes') agrees++;
    else if (verdict === 'partly') partly++;
    else disagrees++;
    const split = (s: string | undefined) => (s ?? '').split(/[\s;|]+/).map((x) => x.trim()).filter(Boolean);
    const hq = (r.human_questions ?? '').trim() ? split(r.human_questions) : c.observed.questions;
    const hi = (r.human_instructions ?? '').trim() ? split(r.human_instructions) : c.observed.instructions;
    for (const [coder, human] of [
      [c.observed.questions, hq],
      [c.observed.instructions, hi],
    ] as const) {
      const cs = new Set(coder);
      const hs = new Set(human);
      for (const code of new Set([...cs, ...hs])) {
        const t = get(code);
        if (cs.has(code)) t.coder++;
        if (hs.has(code)) t.human++;
        if (cs.has(code) && hs.has(code)) t.both++;
      }
    }
    const hd = (r.human_dispatch_after ?? '').trim();
    if (hd !== '' || verdict === 'yes') {
      dispatchReviewed++;
      if (hd === '' || Number(hd) === c.observed.dispatchAfterQuestion) dispatchSame++;
    }
  }
  console.log(`reviewed ${reviewed} of ${rows.length} sheet rows — agrees ${agrees}, partly ${partly}, disagrees ${disagrees}`);
  if (dispatchReviewed) console.log(`dispatch moment identical in ${dispatchSame}/${dispatchReviewed}`);
  let coderTotal = 0;
  let humanTotal = 0;
  let bothTotal = 0;
  console.log('\n| Code | Coder | Human | Both | Coder-only | Human-only |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [code, t] of [...tally].sort((a, b) => b[1].human - a[1].human || a[0].localeCompare(b[0]))) {
    coderTotal += t.coder;
    humanTotal += t.human;
    bothTotal += t.both;
    console.log(`| \`${code}\` | ${t.coder} | ${t.human} | ${t.both} | ${t.coder - t.both} | ${t.human - t.both} |`);
  }
  const jaccard = coderTotal + humanTotal - bothTotal;
  console.log(`\ncode-level agreement (Jaccard over all codes): ${jaccard ? ((bothTotal / jaccard) * 100).toFixed(0) : 'n/a'}%`);
  console.log('systematic misses = codes with many coder-only or human-only counts; fix the coding rule, then re-code those files.');
  process.exit(0);
}

// --- write the sheet ---
const rate = Number(flag('sample') ?? 0.1);
const out = flag('out') ?? join(resolve(dir), '..', 'review-sheet.csv');
const candidates = flag('candidates');
const links = new Map<string, string>();
if (candidates) {
  for (const r of parseCsv(readFileSync(candidates, 'utf8'))) if (r.archive_id && r.link) links.set(r.archive_id, r.link);
}
// Deterministic sample: sort by id, take every k-th starting from the middle of the first stride,
// so re-runs produce the same sheet and additions shift it minimally.
const sorted = [...cases].sort((a, b) => idOf(a.c).localeCompare(idOf(b.c), undefined, { numeric: true }));
const k = Math.max(1, Math.round(1 / rate));
const sample = sorted.filter((_, i) => i % k === Math.floor(k / 2));
const header = [
  'id', 'link', 'pack', 'coder', 'implied_protocol', 'coder_questions', 'coder_instructions', 'coder_dispatch_after',
  'human_agrees', 'human_questions', 'human_instructions', 'human_dispatch_after', 'human_notes',
];
const lines = [header.join(',')];
for (const { c } of sample) {
  lines.push(
    [
      idOf(c), links.get(String(c.sourceId)) ?? '', c.pack, c.coder, c.impliedProtocol,
      c.observed.questions.join(' '), c.observed.instructions.join(' '), c.observed.dispatchAfterQuestion,
      '', '', '', '', '',
    ].map(q).join(','),
  );
}
lines.push(
  [
    '_how_to_review', '', '', '', '',
    'listen once through; compare to docs/REPLAY.md codes', '', '',
    'yes / no / partly', 'blank = agree; else full corrected list', 'blank = agree; else full corrected list',
    'blank = agree; else the number', 'no names, addresses or quotes here either',
  ].map(q).join(','),
);
writeFileSync(out, lines.join('\n') + '\n');
console.log(`${cases.length} case files → ${sample.length} sampled (every ${k}th) → ${out}`);
