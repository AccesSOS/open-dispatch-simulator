import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPackFromFile } from '../src/loader.js';

const packsDir = new URL('../packs', import.meta.url).pathname;
let failed = false;
for (const dir of readdirSync(packsDir)) {
  const path = join(packsDir, dir, 'pack.json');
  try {
    const pack = loadPackFromFile(path);
    console.log(`✓ ${pack.id} (${pack.jurisdiction.country}, ${pack.locales.join('/')})`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${path}\n${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
