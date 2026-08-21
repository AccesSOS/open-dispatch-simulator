import { createWriteStream, existsSync, mkdirSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * npm run replay:fetch -- <candidates.csv> <out-dir> [--delay-ms 1500] [--only 18,58,…]
 *
 * Download the audio (or text) for every candidate whose screen_decision is blank or "yes",
 * into <out-dir>/<archive_id>.<ext>. Resumable: a file that already exists is skipped.
 * Outcomes go to <out-dir>/fetch-log.csv (id, status, bytes, content-type, error) — never
 * anything from inside a recording. Everything under the out-dir is private (gitignored).
 *
 * Sources are publicly released recordings reached through Wayback/archive.org or a government
 * host. Do not point this at a source whose terms forbid downloading.
 */
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const [csvPath, outDir] = positional;
if (!csvPath || !outDir) {
  console.error('usage: npm run replay:fetch -- <candidates.csv> <out-dir> [--delay-ms 1500] [--only 18,58]');
  process.exit(2);
}
const delayMs = Number(flag('delay-ms') ?? 1500);
const only = flag('only')?.split(',').map((s) => s.trim());

/** Minimal RFC-4180 reader: quoted fields, doubled quotes, CRLF. */
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

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
const logPath = join(outDir, 'fetch-log.csv');
if (!existsSync(logPath)) appendFileSync(logPath, 'archive_id,status,bytes,content_type,error\n');
const log = (id: string, status: string, bytes: number | '', type: string, error = '') =>
  appendFileSync(logPath, `${id},${status},${bytes},${type},"${error.replace(/"/g, "'")}"\n`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const wanted = rows.filter((r) => {
  const d = (r.screen_decision ?? '').trim().toLowerCase();
  return (d === '' || d === 'yes') && (!only || only.includes(r.archive_id ?? ''));
});
console.log(`${rows.length} candidates, ${wanted.length} to fetch (blank or "yes" screen_decision)`);

let ok = 0;
let skipped = 0;
let failed = 0;
for (const r of wanted) {
  const id = (r.archive_id ?? '').trim();
  const link = (r.link ?? '').trim();
  if (!id || !link) {
    failed++;
    log(id || '?', 'failed', '', '', 'missing archive_id or link');
    continue;
  }
  const ext = extname(basename(link.split('?')[0] ?? '')).toLowerCase() || '.bin';
  const target = join(outDir, `${id}${ext}`);
  if (existsSync(target) && statSync(target).size > 0) {
    skipped++;
    continue;
  }
  try {
    const res = await fetch(link, { redirect: 'follow', headers: { 'user-agent': 'open-dispatch-simulator replay (research; contact via repo)' } });
    if (!res.ok || !res.body) {
      failed++;
      log(id, 'failed', '', res.headers.get('content-type') ?? '', `HTTP ${res.status}`);
      console.log(`✗ ${id}  HTTP ${res.status}`);
    } else {
      const tmp = `${target}.part`;
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
      const bytes = statSync(tmp).size;
      const type = res.headers.get('content-type') ?? '';
      if (bytes < 1024 || /text\/html/.test(type)) {
        failed++;
        log(id, 'failed', bytes, type, 'not audio (html or empty)');
        console.log(`✗ ${id}  not audio (${type}, ${bytes} B)`);
      } else {
        const { renameSync } = await import('node:fs');
        renameSync(tmp, target);
        ok++;
        log(id, 'ok', bytes, type);
        console.log(`✓ ${id}  ${(bytes / 1024).toFixed(0)} KB`);
      }
    }
  } catch (e) {
    failed++;
    log(id, 'failed', '', '', (e as Error).message);
    console.log(`✗ ${id}  ${(e as Error).message}`);
  }
  await sleep(delayMs);
}
console.log(`\ndownloaded ${ok} · already present ${skipped} · failed ${failed} → ${logPath}`);
