# Replay validation — does the engine behave like a real dispatcher?

Two studies, one harness. Both replay a **real** call's facts through the deterministic engine
and compare what the engine *did* with what the human dispatcher *did*.

| Study | Compares | Needs | Who |
| --- | --- | --- | --- |
| **Observable behavior** (this doc, do first) | Questions asked, instructions given, when dispatch was announced | Publicly released recordings + a human coder | Us, now |
| **Outcome agreement** | Protocol selected and response level sent | A partner PSAP's own calls with CAD outcomes, on their machines | Partner, later |

The observable study can honestly say *"asked the same questions and gave the same instructions
as real dispatchers N% of the time"*. It cannot say *"dispatched the same"* — that needs outcomes.

## The rule (from the README, restated)

Real-call material — audio, transcripts, names, addresses — never enters this repository, the
public corpus, any hosted model, or the engine's behaviour. Case files live in `replay-private/`
(gitignored). Only **aggregate** results are published, never a per-call row. Coding is done by a
person listening; any transcription runs **on-device only** (e.g. whisper.cpp), never a cloud API.

## Source

The Gary Allen archive (*Dispatch Monthly* / 911dispatch.com; 742 publicly sourced recordings,
shared by his estate as an educational resource): audio on Kaggle
(`louisteitelbaum/911-recordings`, free account) or via the archive links in the metadata CSV
(GitHub `n8maxey/911project`, metadata only). ~94 entries are medical after filtering out violent
incidents; expect 40–60 codeable EMD calls after screening. Known biases, to be stated with any
result: the collection was curated for *critical or unusual* calls, skews 1993–2012, and is not a
shift's call mix.

## Coding a call (10–15 min each)

1. **Screen.** Skip if it starts mid-call, is radio traffic, a non-medical incident, or a
   non-civilian caller. Multi-call recordings: code the first caller only.
2. **Listen once through.** Then code. Do not transcribe.
3. **Code what the dispatcher actually asked**, in order, using the codes below — not what they
   should have asked. A question asked twice is coded once unless re-asked after new information.
4. **Record the facts** the caller gave, as answers the engine's questions would receive. Use
   placeholders for anything identifying: location = `12 Pine St`, callback = `555-0100`, no names.
5. **Mark the dispatch moment**: the number of questions asked before the dispatcher first said
   help was on the way (0 if announced immediately).
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
| `Q.kq:<slug>` | any card-specific key question, e.g. `Q.kq:chest_pain_duration` |

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

### Case file (`replay-private/<archive-id>.json`)

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
`replay/codes/<pack>.json`, built with the harness) and answers "I don't know" to anything the
call never covered — an unanswered question is never invented.

## What the harness reports (`npm run replay -- replay-private/ --pack <id>`)

Per pack, across all case files (never per call in any committed or published output):

- **Question recall / precision** — of what the dispatcher asked, the share the engine asks; of
  what the engine asks, the share the dispatcher asked. Core codes and `Q.kq:*` reported separately.
- **Opening-order agreement** — first three questions identical; Kendall τ over shared codes.
- **Instruction recall / precision** — same, over `I.*` codes.
- **Dispatch timing** — questions-before-dispatch, engine minus dispatcher (a fast-track that
  fires later than the human did is the finding that matters most).
- **Protocol agreement** — engine's selected protocol vs the coder's `impliedProtocol`.
- **Miss list** — codes the dispatcher used that the engine never produces on any path: the
  corpus-gap list, and the most useful output for the advisory circle.

State the archive's biases next to any number, and never name an agency or a call.
