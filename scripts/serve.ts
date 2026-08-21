import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPackFromFile } from '../src/loader.js';
import { createDispatchServer, ENDPOINTS, SIMULATION_NOTICE } from '../src/server.js';

/**
 * npm run serve -- [--port 4180] [--host 127.0.0.1] [--cors]
 *
 * Loopback by default and unauthenticated, because it is a test fixture.
 */
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const port = Number(flag('port') ?? 4180);
const host = flag('host') ?? '127.0.0.1';
const cors = argv.includes('--cors');

const packsDir = new URL('../packs', import.meta.url).pathname;
const packs = readdirSync(packsDir)
  .map((d) => loadPackFromFile(join(packsDir, d, 'pack.json')))
  .sort((a, b) => a.id.localeCompare(b.id));

const server = createDispatchServer({ packs, cors });
server.listen(port, host, () => {
  console.log(`\n⚠️  ${SIMULATION_NOTICE}\n`);
  console.log(`open-dispatch-simulator listening on http://${host}:${port}`);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.log(`⚠️  bound to ${host} — this server has no authentication. Loopback only unless you know why.`);
  }
  console.log(`\npacks: ${packs.map((p) => p.id).join(', ')}`);
  console.log('\nendpoints:');
  for (const e of ENDPOINTS) console.log(`  ${e}`);
  console.log(`\n  curl -s localhost:${port}/calls -H 'content-type: application/json' \\`);
  console.log(`       -d '{"pack":"us-openises-emd","locale":"es"}'\n`);
});
