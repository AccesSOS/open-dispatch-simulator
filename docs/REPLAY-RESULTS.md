# Replay results — observable behavior, round 1

*2026-08-21. Aggregates only, per [REPLAY.md](REPLAY.md): no per-call row, no agency, no quote.
Regenerate with `npm run replay -- replay-private/cases --pack <id>` after any change to the
case files, the code maps, or the packs.*

## What was replayed

**52 case files**, all from one source, the Gary Allen archive (publicly released recordings,
1993–2013; see [REPLAY-SOURCES.md](REPLAY-SOURCES.md)). Coded by an agent from local
whisper.cpp transcripts; a 10 % sample (5 calls) is on a review sheet awaiting a human listener, so
**no inter-coder agreement number exists yet** — every figure below is single-coder.

**Source bias, stated plainly.** The archive was curated for *critical or unusual* calls. Of the
52: 22 are cardiac/respiratory arrest or unresponsive patients (C1/C6-type), 7 are childbirths,
10 have a child aged three to ten as the caller, and several are on the list *because* something
went wrong — a transfer to a hold recording, a refusal to do CPR, an address that could not be
found, a dispatcher who declined to send help. Nothing here is a shift's call mix. Pre-2010 calls
show 15:2 CPR with pulse checks. Dispatch-timing numbers are the most selection-sensitive of all:
calls where a dispatcher announced help unusually early or late are over-represented.

**The honest yield.** 94 candidates → 91 reachable → 52 coded (39 rejected: 18 not medical, 11
unusable audio, 8 starting mid-call, 1 hold recording, 1 non-civilian caller). The archive is
exhausted; further volume comes only from the records requests now drafted.

## Flagship pack — `us-openises-emd`

### Questions

| | Dispatcher | Engine | Shared | Recall | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| Core codes | 233 | 486 | 186 | **80 %** | 38 % |
| Card-specific (`Q.kq:*`) | 181 | 232 | 35 | **19 %** | 15 % |

Read the core line as: of the address/complaint/age/conscious/breathing-type questions real
dispatchers asked, the engine asks four in five; but the engine asks every case-entry question on
every call, so fewer than two in five of *its* questions were ones the dispatcher asked. Real
dispatchers skip: they asked the callback number on 12 of 52 calls (the engine: 52), the
patient's sex on 4 (engine: 38), the number of patients on 3 (engine: 52). They asked the
caller's name on 20 calls, the engine on 38.

Card-specific agreement is low for two reasons that the per-code table separates: the engine
reaches a card's questions only after selecting the card (see *Protocol*), and dispatchers ask
things no card in the pack contains (see *Miss list*).

**Opening order.** First question identical on 28 of 52 (54 %) — the other half opened with
"what's the emergency" or went straight to the patient when the caller had volunteered the
address. First *three* identical on 3 of 52. Kendall τ over shared codes **0.73** (49 calls with
≥ 2 shared): when both asked the same things, they asked them in broadly the same order.

### Instructions

| | Dispatcher | Engine | Shared | Recall | Precision |
| --- | ---: | ---: | ---: | ---: | ---: |
| All `I.*` | 255 | 382 | 139 | **55 %** | 36 % |

Help-on-the-way and stay-on-the-line match wherever the dispatcher gave them (45/45, 25/25).
"Watch and report" and the pets line are on every engine call and on 15 and 3 of the human ones.
The biggest real shortfall is **"unlock the door / send someone out / flag the crew"**: dispatchers
gave it on 24 calls; the engine's equivalent appears on 16 and matched on 9 — it lives only on the
unknown-man-down card's "flag the unit" line, not as a general post-dispatch instruction. CPR
coaching matched on 4 of 14 compressions calls and 5 of 9 breaths calls, almost entirely because
the engine did not reach the C1 card (below), not because the I-cards lack the steps.

### Dispatch timing

Questions before help was announced, engine minus dispatcher, over the 45 calls where the
dispatcher announced it: **mean +9.3, median +9**; engine later on 44, earlier on 1, never the
same. Distribution: +1…+4 on 7, +5…+9 on 16, ≥ +10 on 21. On **7 further calls the dispatcher
never said help was coming** (declined, transferred away, or the caller left the line); the
engine always announces.

This is the finding the study was built to surface. Real dispatchers announced help after a
median of ~3 questions — address, complaint, one of breathing/conscious/age — and kept
interrogating afterwards. The engine's structure is *finish the card, then dispatch*: its case
entry alone is nine questions. The one early call was a card with a fast-track (`$determine`).

### Protocol

Agreement **21 of 49** (43 %); 3 coded `unknown`; the engine fell back to the default card on 16.
The confusion table's top row is the actionable one: **7 coded cardiac arrests routed to
`m17_unknown_man_down`**, 2 more to `c6_unconscious_fainting`. The callers said "not responsive",
"can't wake him up", "he just collapsed", "barely breathing", "I can't tell" — none of which is a
keyword on the C1 card, and the case-entry breathing answer that would jump to C1 was "barely"
or "I don't think so", which the yes/no options do not read as *no*. Childbirth (5/6), falls
(3/4), burns, heat, MVC and obvious death routed correctly. Drownings split between C1 and the
fallback (no "drown/underwater" keyword reached C3 from the phrasing used).

### Miss list — what dispatchers did that this pack cannot do on any path

Questions (calls):

| Code | Calls | What the dispatcher asked |
| --- | ---: | --- |
| `Q.with_patient` | 21 | "are you with him / right by her now?" — the caller-proximity gap the rubric pass already flagged |
| `Q.kq:others_present` | 20 | "is anyone there with you?" — before CPR, childbirth, or to fetch help |
| `Q.kq:caller_age` | 8 | to a child caller |
| `Q.kq:patient_position` | 8 | "is he on his back / on the floor?" — the T-CPR entry question |
| `Q.kq:pulse_check` | 5 | pre-2010 coaching; not on any card, and should stay off |
| `Q.kq:patient_name` | 5 | |
| `Q.kq:parent_home` | 4 | to a child caller |
| `Q.kq:baby_out`, `Q.kq:vehicle`, `Q.kq:where_from` | 3 each | childbirth; roadside calls; rapport |
| `Q.kq:physician`, `Q.kq:placenta`, `Q.kq:still_driving` | 2 each | |

Instructions (calls): `I.childbirth:tie_cord` 3 (I8 says do not cut or pull; real dispatchers had
a shoelace tied six inches from the baby on three calls), `I.childbirth:dont_prevent` 2,
`I.childbirth:remove_clothing` 2, `I.other:find_bystander` 2, `I.other:hand_phone_to_helper` 2,
`I.other:not_an_emergency` 2 (the engine never declines), `I.other:check_pulse` 2 (should stay
off), and singletons: continue CPR, compressions-only, cool the patient, no finger sweep, no
tourniquet, stop the vehicle, hazard lights, don't shake the baby.

## Two comparison packs, same 52 calls (`--all`)

| | `us-nj-emd` | `us-nhtsa-emd` |
| --- | --- | --- |
| Core recall / precision | 74 % / 38 % | 69 % / 51 % |
| Instruction recall / precision | 43 % / 43 % | 33 % / 53 % |
| Kendall τ (cases) | 0.74 (48) | 0.75 (47) |
| Timing, engine − dispatcher | mean +8.0, median +8; later on 45/45 | **mean +1.1, median +2; earlier 15, same 5, later 25** |
| Protocol agreement | 0/49 — card ids differ; 36 fallbacks | 0/49 — three cards only; 46 fallbacks |

The NHTSA reference subset, with six case-entry questions and three cards, dispatches when a real
dispatcher did; it simply asks for nothing else. NJ's structural miss is `Q.breathing` (29 calls):
its case entry asks "breathing *normally*?" and never "breathing at all?". Card-specific slugs are
pack-specific, so their cross-pack recall is not meaningful and is omitted.

## What to do with this

In priority order, each a backlog item, none of which touches a recording:

1. **Route "unresponsive / can't wake / barely breathing" to C1** — keywords on the card, and a
   case-entry breathing option that reads "barely", "I don't think so", "can't tell" as *not
   normal* rather than as nothing. The largest single source of disagreement.
2. **A caller-proximity question and an others-present question** at case entry or at the top of
   the arrest cards: `Q.with_patient` (21) and `Q.kq:others_present` (20) are the two biggest
   misses and both gate T-CPR.
3. **A general "unlock the door / send someone to meet them" post-dispatch line.**
4. **Dispatch timing** — the engine's finish-the-card-then-dispatch shape is ~9 questions behind
   real practice. Whether the answer is an earlier `$determine` on the arrest cards or a
   pre-dispatch point after address + complaint + breathing is a design decision for the
   advisory circle, not a patch.
5. **Childbirth**: tie the cord (with a string, six inches out, no cutting) is common practice the
   I8 card omits; "do not try to prevent the birth" and "remove clothing below the waist" likewise.

## Not yet done

- **Human agreement.** `replay-private/review-sheet.csv` (5 calls) needs a listener; then
  `npm run replay:qa -- replay-private/cases --score …` gives per-code agreement and the
  systematic-miss list to re-code against.
- **Volume.** 52 is a pilot. The five drafted records requests are the route to 300.
