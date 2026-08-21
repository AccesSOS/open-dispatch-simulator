import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { loadPackFromFile } from '../src/loader.js';
import { DispatchSession } from '../src/engine.js';
import { scoreCall } from '../src/score.js';
import { SIMULATION_NOTICE } from '../src/server.js';
import type { Persona, ProtocolPack, SessionEvent } from '../src/types.js';

/**
 * npm run call -- [pack] [--locale es] [--seed 7] [--confirm 1] [--score]
 *
 * Hold a call from the terminal. This is the practice use case in its smallest
 * honest form, and the fastest way to feel whether a pack you are writing
 * actually works — a branch sweep tells you every path terminates, but not
 * whether the questions land in an order a frightened person could follow.
 *
 * Reads answers from stdin, so it scripts as well as it converses:
 *   printf '12 Pine St\\n555-0100\\nchest pain\\n' | npm run call -- us-nhtsa-emd
 */
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

const packsDir = new URL('../packs', import.meta.url).pathname;
const available = readdirSync(packsDir);

const target = positional[0];
if (!target) {
  console.error('usage: npm run call -- <pack> [--locale xx] [--seed N] [--confirm 0..1] [--score]');
  console.error(`\npacks: ${available.join(', ')}`);
  process.exit(2);
}
const path = target.endsWith('.json') ? target : join(packsDir, target, 'pack.json');
let pack: ProtocolPack;
try {
  pack = loadPackFromFile(path);
} catch (e) {
  console.error(`✗ could not load "${target}": ${(e as Error).message}`);
  console.error(`\npacks: ${available.join(', ')}`);
  process.exit(2);
}

const locale = flag('locale') ?? pack.defaultLocale;
if (!pack.locales.includes(locale)) {
  console.error(`✗ ${pack.id} speaks ${pack.locales.join('/')}, not "${locale}"`);
  process.exit(2);
}
const persona: Persona = {};
if (flag('seed')) persona.seed = Number(flag('seed'));
if (flag('confirm')) persona.confirmRate = Number(flag('confirm'));

const events: SessionEvent[] = [];
const session = new DispatchSession(pack, {
  locale,
  ...(Object.keys(persona).length ? { persona } : {}),
  onEvent: (e) => events.push(e),
});

const isTTY = process.stdin.isTTY;
const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);

console.log(`\n⚠️  ${SIMULATION_NOTICE}\n`);
console.log(dim(`${pack.id} · ${locale} · type /quit to hang up\n`));

const speak = (utterances: { text: string }[]) => {
  for (const u of utterances) console.log(`${bold('911')}  ${u.text}`);
};

speak(session.start());

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: isTTY });
const prompt = () => {
  if (session.isDone()) return finish();
  rl.setPrompt(isTTY ? '\nyou  ' : '');
  rl.prompt();
};

let finished = false;

function finish(): void {
  if (finished) return;
  finished = true;
  const result = session.result();
  console.log(`\n${dim('─'.repeat(60))}`);
  console.log(`protocol:    ${result.protocolId ?? '(none)'}`);
  console.log(`determinant: ${result.determinantId ?? '(none)'}`);
  console.log(`response:    ${bold(result.response ?? '(none)')}`);
  if (result.scripts.length) console.log(`instructions: ${result.scripts.join(' → ')}`);
  if (Object.keys(result.values).length) {
    console.log(`captured:    ${Object.entries(result.values).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  }
  if (argv.includes('--score')) {
    const score = scoreCall(pack, locale, events, result);
    console.log(`\n${dim('scorecard')}`);
    for (const a of score.axes) {
      const mark = { pass: '✓', partial: '~', fail: '✗', 'n/a': '–' }[a.status];
      console.log(`  ${mark} ${a.id.padEnd(28)} ${a.detail}`);
    }
    console.log(
      `  information captured: ${score.information.answered}/${score.information.asked} ` +
        `(${(score.information.rate * 100).toFixed(0)}%)`,
    );
  }
  rl.close();
}

rl.on('line', (line) => {
  const text = line.trim();
  if (text === '/quit' || text === '/q') {
    console.log(dim('\n(hung up)'));
    rl.close();
    return;
  }
  if (!text) return prompt();
  try {
    speak(session.answer(text));
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    rl.close();
    return;
  }
  prompt();
});
rl.on('close', () => {
  // Stdin can run out before the call does — a scripted run with too few
  // answers, or a Ctrl-D. Say where it got to rather than vanishing, since
  // that is exactly the moment you are debugging a pack.
  if (!finished && !session.isDone()) {
    const pending = session.pending();
    console.log(dim(`\n(call ended early${pending ? ` — still waiting on "${pending.slot}"` : ''})`));
    finish();
  }
  process.exit(0);
});

prompt();
