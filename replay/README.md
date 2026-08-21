# Replay pipeline

Scripts for the observable-behavior replay study ([docs/REPLAY.md](../docs/REPLAY.md)). They are
committed; **the material they process is not** — every script takes the location of the private
data as an argument and everything it reads or writes stays under `replay-private/` (gitignored).
No script prints a word of a recording or transcript, and nothing here trains or tunes anything.

| Script | Does |
| --- | --- |
| `npm run replay:fetch -- <candidates.csv> <out-dir>` | Download publicly released recordings (rows with blank or `yes` `screen_decision`); resumable; outcomes in `<out-dir>/fetch-log.csv`. |
| `npm run replay:transcribe -- <dir>` | whisper.cpp locally (`brew install whisper-cpp`, model under `replay-private/models/`); writes `<id>.txt` beside the audio; skips existing. |
| *(coding — a person or an agent, by hand, per docs/REPLAY.md)* | Screen, then code into `replay-private/cases/<source>-<id>.json` with placeholders and lowercase facts. |
| `npm run replay:validate -- <cases-dir>` | Schema + taxonomy + placeholder/identifier scan + sanity rules; exits 1 on any failure. |
| `npm run replay:qa -- <cases-dir>` | Writes a deterministic 10 % review sheet (codes only) for a human to check against the audio; `--score <sheet>` reports per-code agreement once it comes back. |
| `npm run replay -- <cases-dir> --pack <id>` | The harness ([scripts/replay.ts](../scripts/replay.ts)): aggregate agreement report, never a per-call row. |

`codes/<pack>.json` maps each pack's question slots, instruction strings and script steps to the
behavior codes; `test/replay.test.ts` validates every key against its pack.

Only download from sources whose terms allow it (government hosts, archive.org, Wayback). A source
that needs an account is a job for a person — write the instructions down in the ledger and move on.
