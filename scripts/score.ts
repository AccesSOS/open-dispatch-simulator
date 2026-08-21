import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPackFromFile } from '../src/loader.js';
import { scoreCall } from '../src/score.js';
import { runCall, sweepScripts, sweepInstructionScripts } from '../src/sim.js';
import type { AxisStatus, CallScore, ScoreAxis } from '../src/score.js';
import type { ProtocolPack } from '../src/types.js';

/**
 * Score every pack's branch sweep against the QA variables Maine's EMDPRS
 * §III.4.C names, and report how the calls actually went.
 *
 * Read `fail` as the signal. The sweep's callers answer each choice question
 * with that option's own first keyword and say "unknown" to anything their
 * branch did not anticipate — a jump into another card, say — so `partial` on
 * the question axes is mostly the harness being terse, not the pack being
 * wrong. A `fail` is a card that asked nothing, dispatched nothing, or promised
 * instructions it never gave.
 */
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const asJson = argv.includes('--json');
const onlyPack = flag('pack');
const top = Number(flag('top') ?? 3);

const packsDir = new URL('../packs', import.meta.url).pathname;
const packs: ProtocolPack[] = readdirSync(packsDir)
  .map((d) => loadPackFromFile(join(packsDir, d, 'pack.json')))
  .sort((a, b) => a.id.localeCompare(b.id));

interface PackReport {
  packId: string;
  calls: number;
  capture: { asked: number; answered: number; rate: number };
  byAxis: Record<string, Record<AxisStatus, number>>;
  findings: string[];
  worst: { scriptId: string; locale: string; protocolId: string | null; failed: string[] }[];
}

const AXES: ScoreAxis['id'][] = [
  'all-caller-questions',
  'protocol-selection',
  'complaint-questions',
  'priority',
  'pre-arrival-instructions',
  'post-dispatch-instructions',
];

const reports: PackReport[] = [];
let anyFail = false;

for (const pack of packs) {
  if (onlyPack && pack.id !== onlyPack) continue;

  const byAxis: PackReport['byAxis'] = {};
  for (const id of AXES) byAxis[id] = { pass: 0, partial: 0, fail: 0, 'n/a': 0 };

  // Structural findings only a run can see, accumulated across every call.
  const selectionVia = new Map<string, Set<string>>();
  const askedNoKeyQuestions = new Map<string, number>();
  const noPostDispatch = new Set<string>();
  const scriptPromisedNotRun = new Set<string>();
  const worst: PackReport['worst'] = [];
  let calls = 0;
  let asked = 0;
  let answered = 0;

  for (const locale of pack.locales) {
    const scripts = [
      ...sweepScripts(pack, locale),
      ...sweepInstructionScripts(pack, locale).scripts,
    ];
    for (const script of scripts) {
      const metrics = runCall(pack, script, { recordEvents: true });
      const score: CallScore = scoreCall(pack, locale, metrics.events ?? [], metrics.result);
      calls++;
      asked += score.information.asked;
      answered += score.information.answered;
      const failed: string[] = [];
      for (const a of score.axes) {
        byAxis[a.id]![a.status]++;
        if (a.status === 'fail') failed.push(a.id);
      }
      const pid = score.protocolId;
      if (pid) {
        const via = score.axes.find((a) => a.id === 'protocol-selection')!;
        const set = selectionVia.get(pid) ?? new Set<string>();
        set.add(via.status === 'partial' ? 'fallback' : 'matched');
        selectionVia.set(pid, set);
        if (score.axes.find((a) => a.id === 'complaint-questions')!.status === 'fail') {
          askedNoKeyQuestions.set(pid, (askedNoKeyQuestions.get(pid) ?? 0) + 1);
        }
        if (score.axes.find((a) => a.id === 'post-dispatch-instructions')!.status === 'fail') {
          noPostDispatch.add(pid);
        }
        if (score.axes.find((a) => a.id === 'pre-arrival-instructions')!.status === 'fail') {
          scriptPromisedNotRun.add(pid);
        }
      }
      if (failed.length && worst.length < top * 4) {
        worst.push({ scriptId: script.id, locale, protocolId: score.protocolId, failed });
      }
    }
  }

  const findings: string[] = [];
  for (const [pid, vias] of [...selectionVia].sort()) {
    if (vias.size === 1 && vias.has('fallback') && pid !== pack.fallbackProtocol) {
      findings.push(`${pid}: only ever reached by the fallback, never by its own keywords`);
    }
  }
  for (const [pid, n] of [...askedNoKeyQuestions].sort()) {
    findings.push(`${pid}: declares key questions, but ${n} call(s) asked none`);
  }
  for (const pid of [...noPostDispatch].sort()) {
    findings.push(`${pid}: carries no post-dispatch instructions`);
  }
  for (const pid of [...scriptPromisedNotRun].sort()) {
    findings.push(`${pid}: hands off to an instruction script that never ran`);
  }
  if (findings.length) anyFail = true;

  reports.push({
    packId: pack.id,
    calls,
    capture: { asked, answered, rate: asked ? answered / asked : 0 },
    byAxis,
    findings,
    worst: worst.slice(0, top),
  });
}

if (asJson) {
  console.log(JSON.stringify({ reports }, null, 2));
} else {
  for (const r of reports) {
    console.log(`\n${'─'.repeat(78)}`);
    console.log(`${r.packId} — ${r.calls} calls scored`);
    console.log('');
    for (const id of AXES) {
      const c = r.byAxis[id]!;
      const total = c.pass + c.partial + c.fail;
      const pct = total ? ((c.pass / total) * 100).toFixed(0) : '—';
      const bits = [
        `${c.pass} pass`,
        c.partial ? `${c.partial} partial` : '',
        c.fail ? `${c.fail} FAIL` : '',
        c['n/a'] ? `${c['n/a']} n/a` : '',
      ].filter(Boolean);
      console.log(`  ${id.padEnd(28)} ${bits.join(' · ').padEnd(38)} ${pct}% pass`);
    }
    console.log(
      `\n  information captured: ${r.capture.answered}/${r.capture.asked} answers parsed ` +
        `(${(r.capture.rate * 100).toFixed(0)}%) — a property of the callers, not of compliance`,
    );
    if (r.findings.length) {
      console.log('\n  findings:');
      for (const f of r.findings) console.log(`    ✗ ${f}`);
      if (r.worst.length) {
        console.log('\n  example calls:');
        for (const w of r.worst) {
          console.log(`    ${w.locale} ${w.scriptId} → ${w.protocolId ?? '(none)'}: ${w.failed.join(', ')}`);
        }
      }
    } else {
      console.log('\n  no findings — every call was handled to the card it landed on.');
    }
  }
  console.log(`\n${'─'.repeat(78)}\nSummary`);
  for (const r of reports) {
    const fails = AXES.reduce((n, id) => n + r.byAxis[id]!.fail, 0);
    console.log(
      `  ${r.packId.padEnd(20)} ${String(r.calls).padStart(6)} calls  ${String(fails).padStart(6)} axis failures  ` +
        `${r.findings.length} finding(s)  capture ${(r.capture.rate * 100).toFixed(0)}%`,
    );
  }
}

process.exit(anyFail && argv.includes('--strict') ? 1 : 0);
