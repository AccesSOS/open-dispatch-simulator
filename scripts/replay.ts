import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPackFromFile } from '../src/loader.js';
import { aggregate, formatReport, replayCase, validateCase, validateCodeMap } from '../src/replay.js';
import type { CodeMap, EngineBehavior, ReplayCase } from '../src/replay.js';

/**
 * npm run replay -- <cases-dir> --pack <id> [--json] [--codes <dir>]
 *
 * Replay private case files (docs/REPLAY.md) through a pack and print the
 * aggregate agreement report. The case files never enter the repository;
 * this script takes their location as an argument and prints no per-call row
 * — invalid files are named on stderr with their reasons, for the coder, and
 * nothing else about any single file is ever printed.
 */
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

const root = fileURLToPath(new URL('..', import.meta.url));
const packsDir = join(root, 'packs');
const codesDir = flag('codes') ?? join(root, 'replay', 'codes');
const packId = flag('pack');
const casesDir = positional[0] ?? join(root, 'replay-private');

if (!packId) {
  console.error('usage: npm run replay -- <cases-dir> --pack <id> [--json] [--codes <dir>]');
  console.error(`\npacks: ${readdirSync(packsDir).join(', ')}`);
  process.exit(2);
}

const pack = loadPackFromFile(join(packsDir, packId, 'pack.json'));
const map = JSON.parse(readFileSync(join(codesDir, `${packId}.json`), 'utf8')) as CodeMap;
const mapErrors = validateCodeMap(pack, map);
if (mapErrors.length) {
  console.error(`✗ replay/codes/${packId}.json does not match the pack:`);
  for (const e of mapErrors) console.error(`  - ${e}`);
  process.exit(1);
}

const packs: Record<string, string[]> = {};
for (const id of readdirSync(packsDir)) {
  try {
    packs[id] = loadPackFromFile(join(packsDir, id, 'pack.json')).protocols.map((p) => p.id);
  } catch {
    /* not a pack directory */
  }
}

/** Every .json file under the directory, one level of subdirectories deep. */
function caseFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries.sort()) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...caseFiles(path));
    else if (name.endsWith('.json')) out.push(path);
  }
  return out;
}

const files = caseFiles(resolve(casesDir));
const replayed: { c: ReplayCase; b: EngineBehavior }[] = [];
let otherPack = 0;
let notCase = 0;
const invalid = new Map<string, number>();
for (const file of files) {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    notCase++;
    continue;
  }
  if (typeof data !== 'object' || data === null || !('observed' in data)) {
    notCase++;
    continue;
  }
  const errors = validateCase(data, { packs });
  if (errors.length) {
    console.error(`✗ ${file}`);
    for (const e of errors) {
      console.error(`    ${e}`);
      const reason = e.replace(/"[^"]*"/g, '…').split(':')[0]!;
      invalid.set(reason, (invalid.get(reason) ?? 0) + 1);
    }
    continue;
  }
  const c = data as ReplayCase;
  if (c.pack !== pack.id) {
    otherPack++;
    continue;
  }
  replayed.push({ c, b: replayCase(pack, map, c) });
}

const report = aggregate(pack, map, replayed);
const intake = {
  filesSeen: files.length,
  notCaseFiles: notCase,
  invalid: [...invalid.entries()].map(([reason, count]) => ({ reason, count })),
  otherPack,
  replayed: replayed.length,
};

if (has('json')) {
  console.log(JSON.stringify({ intake, report }, null, 2));
} else {
  console.log(formatReport(report));
  console.log('### Intake');
  console.log('');
  console.log(
    `${intake.filesSeen} files seen · ${intake.notCaseFiles} not case files · ` +
      `${intake.invalid.reduce((a, b) => a + b.count, 0)} invalid · ${intake.otherPack} for other packs · ${intake.replayed} replayed`,
  );
  for (const i of intake.invalid) console.log(`- ${i.reason}: ${i.count}`);
  console.log('');
}
