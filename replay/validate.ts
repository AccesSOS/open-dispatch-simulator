import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPackFromFile } from '../src/loader.js';
import { validateCase } from '../src/replay.js';

/**
 * npm run replay:validate -- <cases-dir>
 *
 * Validate every case file: schema, the behavior-code taxonomy, placeholders, the identifier scan
 * (phone-like digits, street names, capitalized words, name phrases, emails/URLs) and the sanity
 * rules (an observed question implies a fact or "unknown"; dispatch moment within range). Names
 * the failing files with reasons — never prints a fact. Exits 1 if any file fails.
 */
const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('usage: npm run replay:validate -- <cases-dir>');
  process.exit(2);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const packs: Record<string, string[]> = {};
for (const id of readdirSync(join(root, 'packs'))) {
  try {
    packs[id] = loadPackFromFile(join(root, 'packs', id, 'pack.json')).protocols.map((p) => p.id);
  } catch {
    /* not a pack */
  }
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

let ok = 0;
let bad = 0;
const reasons = new Map<string, number>();
const byPack = new Map<string, number>();
for (const file of files(resolve(dir))) {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    bad++;
    console.log(`✗ ${file}\n    not JSON: ${(e as Error).message}`);
    continue;
  }
  const errors = validateCase(data, { packs });
  if (errors.length) {
    bad++;
    console.log(`✗ ${file}`);
    for (const e of errors) {
      console.log(`    ${e}`);
      const key = e.replace(/"[^"]*"/g, '…').split(' — ')[0]!.split(': ')[0]!;
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
  } else {
    ok++;
    const pack = (data as { pack: string }).pack;
    byPack.set(pack, (byPack.get(pack) ?? 0) + 1);
  }
}
console.log(`\nvalid ${ok} · invalid ${bad}`);
for (const [pack, n] of byPack) console.log(`  ${pack}: ${n}`);
if (reasons.size) {
  console.log('rejection reasons:');
  for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${r}`);
}
process.exit(bad ? 1 : 0);
