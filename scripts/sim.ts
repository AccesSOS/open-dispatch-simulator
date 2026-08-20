import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPackFromFile } from '../src/loader.js';
import { runBatch, sweepInstructionScripts, sweepScripts } from '../src/sim.js';

/**
 * Branch-sweep every pack in every declared locale and enforce the simulator
 * invariant: every call must reach dispatch with a response level. Exits
 * nonzero on any violation — CI runs this.
 */
const packsDir = new URL('../packs', import.meta.url).pathname;
let failed = false;

// Sweep under multiple dispatcher personas: the default profile, plus a
// chatty/patient one and a different phrasing seed — invariants must hold
// for all of them.
const PERSONAS = [
  { label: 'default', persona: undefined },
  { label: 'chatty seed=7', persona: { seed: 7, confirmRate: 1, clarifyAttempts: 2 } },
  { label: 'terse seed=2029', persona: { seed: 2029, confirmRate: 0 } },
];

for (const dir of readdirSync(packsDir)) {
  const pack = loadPackFromFile(join(packsDir, dir, 'pack.json'));
  for (const locale of pack.locales) {
    for (const { label, persona } of PERSONAS) {
    const report = runBatch(pack, sweepScripts(pack, locale), persona ? { persona } : {});
    const noResponse = report.calls.filter((m) => m.completed && !m.result.response);
    console.log(`\n${pack.id} [${locale}] persona=${label} — ${report.total} calls swept`);
    console.log(`  completed: ${report.completed}/${report.total}  avg turns: ${report.avgTurns.toFixed(1)}  clarify rate: ${(report.clarifyRate * 100).toFixed(0)}%`);
    console.log(`  responses: ${Object.entries(report.byResponse).map(([k, v]) => `${k}×${v}`).join('  ')}`);
    console.log(`  determinants: ${Object.entries(report.byDeterminant).map(([k, v]) => `${k}×${v}`).join('  ')}`);
    if (report.incomplete.length) {
      failed = true;
      console.error(`  ✗ INCOMPLETE CALLS: ${report.incomplete.join(', ')}`);
    }
    if (noResponse.length) {
      failed = true;
      console.error(`  ✗ NO RESPONSE LEVEL: ${noResponse.map((m) => m.scriptId).join(', ')}`);
    }
    }

    // v0.3: instruction scripts are swept separately — one caller per walk
    // through the script DAG. Every walk must still end the call, and every
    // step must be reached by some walk, or the deck has dead lines in it.
    if (pack.scripts?.length) {
      const sweep = sweepInstructionScripts(pack, locale);
      const report = runBatch(pack, sweep.scripts);
      const steps = pack.scripts.reduce((n, s) => n + s.steps.length, 0);
      console.log(
        `  instruction scripts [${locale}]: ${report.total} walks over ${pack.scripts.length} scripts / ${steps} steps` +
          `  avg turns: ${report.avgTurns.toFixed(1)}`,
      );
      if (report.incomplete.length) {
        failed = true;
        console.error(`  ✗ INSTRUCTION WALKS DID NOT CLOSE: ${report.incomplete.slice(0, 5).join(', ')}`);
      }
      if (sweep.unreachable.length) {
        failed = true;
        console.error(`  ✗ UNREACHABLE SCRIPT STEPS: ${sweep.unreachable.join(', ')}`);
      }
      if (sweep.capped.length) {
        console.error(`  ! path enumeration capped (coverage not exhaustive): ${sweep.capped.join(', ')}`);
      }
    }
  }
}

console.log(failed ? '\n✗ simulator invariants violated' : '\n✓ every simulated call reached dispatch');
process.exit(failed ? 1 : 0);
