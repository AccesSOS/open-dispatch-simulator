# Replay validation — does the engine behave like a real dispatcher?

Two studies, one harness. Both replay a **real** call's facts through the deterministic engine
and compare what the engine *did* with what the human dispatcher *did*.

| Study | Compares | Needs | Who |
| --- | --- | --- | --- |
| **Observable behavior** (this doc, do first) | Questions asked, instructions given, when dispatch was announced | Publicly released recordings + a coder (person or agent, human-spot-checked) | Us, now |
| **Outcome agreement** | Protocol selected and response level sent | A partner PSAP's own calls with CAD outcomes, on their machines | Partner, later |

The observable study can honestly say *"asked the same questions and gave the same instructions
as real dispatchers N% of the time"*. It cannot say *"dispatched the same"* — that needs outcomes.

## The rule (from the README, restated)

Real-call material — audio, transcripts, names, addresses — never enters this repository, the
public corpus, or the engine's behaviour; nothing is trained or tuned on a call. Case files live in
`replay-private/` (gitignored), use placeholders for anything identifying, and only **aggregate**
results are published — never a per-call row, an agency name, or a quote.

Who may handle the raw material depends on where it came from:

| Source | Handling |
| --- | --- |
| **Publicly released** — public-records releases, investigation reports, court exhibits, the Gary Allen archive | Already public; may be transcribed and coded by people **or by tools, including AI assistants**. A human spot-checks a sample of machine-coded files against the audio (quality, not policy). |
| **Partner agency's own calls** (outcome study) | Their data, their data-use agreement: processed only on the agency's machines, by the agency or under their supervision, with whatever tooling the agreement allows. |

## Source

The Gary Allen archive (*Dispatch Monthly* / 911dispatch.com; 742 publicly sourced recordings,
shared by his estate as an educational resource): audio on Kaggle
(`louisteitelbaum/911-recordings`, free account) or via the archive links in the metadata CSV
(GitHub `n8maxey/911project`, metadata only). ~94 entries are medical after filtering out violent
incidents; expect 40–60 codeable EMD calls after screening. Known biases, to be stated with any
result: the collection was curated for *critical or unusual* calls, skews 1993–2012, and is not a
shift's call mix.

## Coding a call (10–15 min each by hand; agents follow the same steps)

1. **Screen.** Skip if it starts mid-call, is radio traffic, a non-medical incident, or a
   non-civilian caller. Multi-call recordings: code the first caller only.
2. **Listen once through.** Then code. Do not transcribe.
3. **Code what the dispatcher actually asked**, in order, using the codes below — not what they
   should have asked. A question asked twice is coded once unless re-asked after new information.
4. **Record the facts** the caller gave, as answers the engine's questions would receive. Use
   placeholders for anything identifying: location = `12 Pine St`, callback = `555-0100`, no names.
   Write facts and notes **entirely in lowercase** (brand names too) — the validator treats any
   other capitalized word as a possible name and rejects the file. `Q.caller_name` is recorded as
   `given` or `unknown`, never the name. A question the dispatcher asked but the caller could not
   answer gets the fact `unknown`.
5. **Mark the dispatch moment**: the number of questions asked before the dispatcher first said
   help was on the way (0 if announced immediately; `null` if help was never announced — refused,
   transferred away, or the caller hung up — which the report counts separately).
6. **Label the implied card**: which protocol in the target pack this call belongs on
   (e.g. `c1_cardiac_arrest`). Unsure → `unknown`.

### Behavior codes

Questions — core (every pack's case entry)

| Code | Dispatcher asked… |
| --- | --- |
| `Q.location` | where the emergency is |
| `Q.callback` | the phone number |
| `Q.what_happened` | what happened / what's the problem |
| `Q.num_patients` | how many people are hurt/sick |
| `Q.age` | patient age |
| `Q.sex` | patient sex |
| `Q.conscious` | awake / conscious |
| `Q.breathing` | breathing at all |
| `Q.breathing_quality` | breathing normally / agonal / effort |
| `Q.with_patient` | whether caller is with the patient |
| `Q.scene_safety` | weapons, danger, fire, traffic |
| `Q.history` | prior condition, meds, pregnancy, diabetes… |
| `Q.caller_name` | the caller's own name |
| `Q.kq:<slug>` | any card-specific key question. **Use the slugs in `replay/codes/<pack>.json`** (e.g. `Q.kq:duration`, `Q.kq:sweating`) so the engine's question and the dispatcher's can match; a slug the map does not know lands on the miss list. |

Instructions

| Code | Dispatcher told the caller… |
| --- | --- |
| `I.help_on_way` | help is coming |
| `I.stay_on_line` | stay on the line |
| `I.cpr_compressions` | chest compressions (any coaching) |
| `I.cpr_breaths` | rescue breaths |
| `I.aed` | get/use an AED |
| `I.choking_maneuver` | back blows / abdominal thrusts |
| `I.positioning` | lay flat / recovery position / sit up |
| `I.bleeding_pressure` | direct pressure |
| `I.airway_clear` | clear mouth / tilt head |
| `I.unlock_door` | unlock door, turn on lights, send someone out |
| `I.gather_meds` | gather medications / medical info |
| `I.dont_move` | don't move the patient |
| `I.keep_warm` | keep warm / calm |
| `I.watch_and_report` | watch breathing, call back / tell me if anything changes |
| `I.leave_for_safety` | get away from danger |
| `I.childbirth:<slug>` | any childbirth step |
| `I.other:<slug>` | anything else, briefly |

### Case file (`replay-private/cases/<source>-<id>.json`)

```json
{
  "source": "gary-allen", "sourceId": 18, "coder": "initials", "codedOn": "2026-08-21",
  "pack": "us-openises-emd", "impliedProtocol": "c1_cardiac_arrest",
  "facts": {
    "Q.location": "12 Pine St", "Q.callback": "555-0100",
    "Q.what_happened": "my baby isn't breathing", "Q.num_patients": "1",
    "Q.age": "4 months", "Q.sex": "female", "Q.conscious": "no", "Q.breathing": "no",
    "Q.with_patient": "yes"
  },
  "observed": {
    "questions": ["Q.location", "Q.what_happened", "Q.age", "Q.breathing", "Q.callback"],
    "instructions": ["I.help_on_way", "I.cpr_compressions", "I.stay_on_line"],
    "dispatchAfterQuestion": 2,
    "notes": "dispatcher skipped conscious question; began CPR coaching before callback"
  }
}
```

Answers are keyed by behavior code; the harness maps each pack's question slots to codes (see
`replay/codes/<pack>.json`) and answers "I don't know" to anything the call never covered — an
unanswered question is never invented. `coder` is initials for a person or `agent` for a machine
coder; `impliedProtocol` is a protocol id of the named pack or `unknown`.

`npm run replay:validate -- replay-private/cases` (or the harness itself) rejects a file that:
names a pack or protocol that does not exist; uses a code outside the taxonomy; has a non-placeholder
location or callback; contains a phone-like digit run, a street name, a capitalized word outside a
short allowlist (`I`, `CPR`, `AED`, `EMS`…), an email or URL; records an observed question with no
fact for it; repeats a question code; or marks dispatch after more questions than were observed.

### Code maps (`replay/codes/<pack>.json`)

One per shipped pack, validated against the pack by `test/replay.test.ts` (every key must exist in
the pack; every case-entry, key-question and script ask-step slot must be mapped):

- `slots` — question slot → `Q.*` code. Every OpenISES card opens with "alert?" and "breathing
  normally?"; those map to `Q.conscious` / `Q.breathing_quality` and, like the coder, the harness
  counts a code once however many slots produced it.
- `strings` — `dispatch_confirm` and post-dispatch string ids → `I.*` code(s).
- `steps` / `scripts` — `scriptId/stepId` or a whole script → `I.*` code(s) inside the I-cards.

A slot left out of the map is still a question the caller had to answer (it counts toward dispatch
timing) but not a behavior (it is excluded from precision) — the report lists any such slot it met,
and the shipped maps leave none.

## What the harness reports (`npm run replay -- replay-private/cases --pack <id> [--json]`)

`src/replay.ts` does the work; `scripts/replay.ts` is the CLI. Three synthetic, clearly fake case
files under `test/fixtures/replay/` exercise it in CI — the real ones never leave `replay-private/`.

Per pack, across all case files (never per call in any committed or published output):

- **Question recall / precision** — of what the dispatcher asked, the share the engine asks; of
  what the engine asks, the share the dispatcher asked. Core codes and `Q.kq:*` reported separately.
- **Opening-order agreement** — first three questions identical; Kendall τ over shared codes.
- **Instruction recall / precision** — same, over `I.*` codes.
- **Dispatch timing** — questions-before-dispatch, engine minus dispatcher (a fast-track that
  fires later than the human did is the finding that matters most).
- **Protocol agreement** — engine's selected protocol vs the coder's `impliedProtocol`.
- **Miss list** — codes the dispatcher used that the engine never produces on any path (they
  appear nowhere in the pack's code map): the corpus-gap list, and the most useful output for the
  advisory circle. A code that is in the map but was not reached on these calls is *not* a miss.
- **Intake** — files seen, not case files, invalid (reasons as counts), for other packs, replayed.

State the archive's biases next to any number, and never name an agency or a call.
