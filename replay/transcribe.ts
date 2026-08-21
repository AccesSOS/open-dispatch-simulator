import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * npm run replay:transcribe -- <dir> [--model <ggml.bin>] [--whisper whisper-cli] [--only 18,58]
 *
 * Transcribe every audio file in <dir> with whisper.cpp, locally and offline
 * (`brew install whisper-cpp`; models from huggingface.co/ggerganov/whisper.cpp — the default
 * path below is the gitignored replay-private/models/ggml-small.en.bin). Writes <id>.txt beside
 * the audio and skips files that already have one. Prints ids and timings only — never a word of
 * a transcript. Text sources have no audio and skip this step.
 */
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const dir = positional[0];
if (!dir) {
  console.error('usage: npm run replay:transcribe -- <dir> [--model <ggml.bin>] [--whisper <binary>] [--only 18,58]');
  process.exit(2);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const model = flag('model') ?? process.env.WHISPER_MODEL ?? join(root, 'replay-private', 'models', 'ggml-small.en.bin');
const whisper = flag('whisper') ?? process.env.WHISPER_BIN ?? 'whisper-cli';
const only = flag('only')?.split(',').map((s) => s.trim());
if (!existsSync(model)) {
  console.error(`✗ model not found: ${model}\n  download e.g. https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin`);
  process.exit(2);
}
for (const bin of ['ffmpeg', whisper]) {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
  } catch {
    console.error(`✗ ${bin} not on PATH (brew install ffmpeg whisper-cpp)`);
    process.exit(2);
  }
}

const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.mp4']);
const files = readdirSync(dir)
  .filter((f) => AUDIO.has(extname(f).toLowerCase()))
  .filter((f) => !only || only.includes(basename(f, extname(f))))
  .sort((a, b) => Number(basename(a, extname(a))) - Number(basename(b, extname(b))) || a.localeCompare(b));

let done = 0;
let skipped = 0;
let failed = 0;
const work = mkdtempSync(join(tmpdir(), 'replay-transcribe-'));
try {
  for (const f of files) {
    const id = basename(f, extname(f));
    const out = join(dir, `${id}.txt`);
    if (existsSync(out) && statSync(out).size > 0) {
      skipped++;
      continue;
    }
    const wav = join(work, `${id}.wav`);
    const started = Date.now();
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, f), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { stdio: 'ignore' });
      const prefix = join(work, id);
      execFileSync(whisper, ['-m', model, '-f', wav, '-otxt', '-of', prefix, '-np', '-nt'], { stdio: 'ignore' });
      const text = readFileSync(`${prefix}.txt`, 'utf8').trim();
      const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString().trim());
      writeFileSync(out, text + '\n');
      done++;
      console.log(`✓ ${id}  ${duration.toFixed(0)}s audio · ${text.split(/\s+/).length} words · ${((Date.now() - started) / 1000).toFixed(0)}s`);
    } catch (e) {
      failed++;
      console.log(`✗ ${id}  ${(e as Error).message.split('\n')[0]}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`\ntranscribed ${done} · already present ${skipped} · failed ${failed}`);
