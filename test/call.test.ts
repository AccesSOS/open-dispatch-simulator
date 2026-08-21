import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../scripts/call.ts', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));

/**
 * Run the CLI with `answers` on stdin and collect everything it said. Uses
 * spawn rather than execFile: execFile's `input` option is execFileSync's, so
 * the child sits waiting on a stdin that never closes.
 */
function call(args: string[], answers: string[] = []): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', ['--import', 'tsx', script, ...args], { cwd });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.stdin.end(answers.length ? answers.join('\n') + '\n' : '');
    child.on('close', (code) => resolve({ code: code ?? 0, out }));
  });
}

test('a scripted call runs to a response level and reports it', async () => {
  const { code, out } = await call(
    ['us-nhtsa-emd'],
    ['12 Pine St', '555-0100', 'chest pain', '58', 'yes', 'yes', 'no'],
  );
  assert.equal(code, 0);
  assert.match(out, /SIMULATION ONLY/);
  assert.match(out, /911 {2}Nine-one-one\./);
  assert.match(out, /protocol: {4}chest_pain/);
  assert.match(out, /response: {4}ALS_HOT/);
});

test('--score prints the scorecard for the call just held', async () => {
  const { out } = await call(
    ['us-nhtsa-emd', '--score'],
    ['12 Pine St', '555-0100', 'chest pain', '58', 'yes', 'yes', 'no'],
  );
  assert.match(out, /scorecard/);
  assert.match(out, /protocol-selection/);
  assert.match(out, /information captured: \d+\/\d+/);
});

test('it speaks the locale asked for, and extracts what the caller said', async () => {
  const { out } = await call(
    ['us-openises-emd', '--locale', 'es'],
    [
      'Estamos en Calle Reforma 10, colonia Juárez',
      'mi número es 555-0100',
      'le duele el pecho',
      'uno',
      'tiene 58 años',
      'sí', 'sí', 'hombre', 'Ana', 'sí', 'sí', 'no', 'no', 'no', 'no', 'no', 'no', 'no', 'no',
    ],
  );
  assert.match(out, /Nueve-uno-uno\./);
  assert.doesNotMatch(out, /Nine-one-one/);
  assert.match(out, /captured: .*location=Calle Reforma 10/);
  assert.match(out, /age=58 años/);
});

test('running out of answers says where the call got to', async () => {
  const { out } = await call(['us-nhtsa-emd'], ['12 Pine St', '555-0100', 'chest pain']);
  assert.match(out, /call ended early — still waiting on "age"/);
  assert.match(out, /protocol: {4}chest_pain/);
});

test('/quit hangs up', async () => {
  const { code, out } = await call(['us-nhtsa-emd'], ['12 Pine St', '/quit']);
  assert.equal(code, 0);
  assert.match(out, /\(hung up\)/);
});

test('the ways a person gets the invocation wrong are answered, not stack-traced', async () => {
  const noPack = await call([]);
  assert.equal(noPack.code, 2);
  assert.match(noPack.out, /usage: npm run call/);
  assert.match(noPack.out, /packs: .*us-openises-emd/);

  const badPack = await call(['no-such-pack']);
  assert.equal(badPack.code, 2);
  assert.match(badPack.out, /could not load "no-such-pack"/);
  assert.doesNotMatch(badPack.out, /at Object\./, 'no stack trace');

  const badLocale = await call(['us-nj-emd', '--locale', 'de']);
  assert.equal(badLocale.code, 2);
  assert.match(badLocale.out, /speaks en, not "de"/);
});
