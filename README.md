# Open Dispatch Simulator

> ⚠️ **SIMULATION ONLY.** This project simulates the *dispatcher's* side of an emergency call for
> testing, research, and practice. It is **not certified for live emergency call-taking**, gives no
> medical advice, and must never be connected to a real emergency line. **In a real emergency, call
> your local emergency number (911 in the US, Canada, and Mexico).**

A protocol-grounded, multilingual synthetic 911 dispatcher, built by
[accesSOS](https://accessos.io) — the nonprofit making emergency services accessible.

Real dispatchers follow strict, trained protocol decision trees. Everyone building toward 911 —
accessibility apps, crash detection, alarm monitoring, AI callers — needs to test against a
realistic dispatcher, and there has never been an open, faithful stand-in for one. This engine
plays that role by **strictly executing a loaded protocol pack, never improvising**: every word it
says is rendered from the pack's string catalog, so it structurally cannot say anything the
playbook does not say.

## Two axes, deliberately separate

- **Jurisdiction** is a *pack*: a country/region's call-intake playbook (case-entry questions,
  protocol decision trees, dispatch determinants, post-dispatch instructions) with provenance and
  licensing declared per pack. See [`schema/pack.schema.json`](schema/pack.schema.json).
- **Language** is a *catalog*: protocol logic references string ids, and each pack carries
  per-locale catalogs. Any playbook can speak any language it ships catalogs for. The reference
  pack speaks English and Spanish; Canadian packs will ship English/French.

A Mexico pack is not a translated US pack — different protocols, different institutions. The
schema keeps those concerns apart so both can grow independently.

## Quick start

```bash
npm install
npm test         # engine + simulator suites (keyless)
npm run sim      # branch-sweep every pack in every locale, enforce invariants
npm run coverage # score every pack against the published requirements rubrics
```

### Live decision-tree demo

```bash
npm run demo   # then open http://localhost:4179/demo/
```

Runs a call in the browser and animates the dispatcher's "brain" in real time over the pack's
decision tree: the path taken, the active node, what is being assessed next, and milestones —
protocol selected, and what resources were deployed at what response level. Built on the engine's
`onEvent` stream and `packGraph()` export, which any richer UI (e.g. React Flow) can consume the
same way.

```ts
import { DispatchSession, loadPackFromFile } from 'open-dispatch-simulator';

const pack = loadPackFromFile('packs/us-nhtsa-emd/pack.json');
const call = new DispatchSession(pack, { locale: 'es' });

let utterances = call.start();          // "Nueve-uno-uno." / "¿Cuál es la dirección…?"
utterances = call.answer('Calle Reforma 10');
// … keep answering until call.isDone()
console.log(call.result());             // protocol, determinant, response level, transcript
```

## What's in a pack

| Piece | What it is |
| --- | --- |
| `caseEntry` | Universal intake questions asked on every call, in order |
| `protocols[].keywords` | Per-locale complaint keywords that select the protocol |
| `protocols[].keyQuestions` | The decision tree: choice questions with conditional edges |
| `protocols[].determinants` | Ordered rules mapping answers to a neutral response level |
| `protocols[].postDispatch` | Instructions read after responders are dispatched |
| `scripts` | v0.3: interactive instruction scripts (CPR, choking, childbirth) a card hands off to |
| `protocols[].dispatcherNotes` | v0.3: content for the dispatcher, structurally never spoken |
| `strings.<locale>` | Every utterance template, per locale — validated complete at load time |
| `provenance` | Where the playbook came from and its redistribution license |

Schema **v0.2** adds three features (v0.1 packs remain valid): `extract: "number"` on a question
captures the first number in the answer; determinant and edge conditions may then be **numeric**
(`{ "slot": "age", "gt": 35 }` — never matching when no number was captured, so age-unknown falls
to whichever tier the pack lists as default); edges gain `when` (compound conditions on prior
slots) and `gotoProtocol` — faithful **card jumps**, e.g. both bundled real packs now route an
unconscious, non-breathing patient to their Cardiac Arrest card mid-case-entry, exactly as the
printed flow charts direct.

Schema **v0.3** adds **interactive instruction scripts** — the part of a card the dispatcher
*performs* rather than reads. `postDispatch` is a list of lines; a script is a small graph of
`say` / `ask` / `stay` steps that branches on what the caller answers, hands off to other scripts
("jump to I1: AED Instructions"), and ends by holding the line. A card selects one with
`postDispatchScripts`, ordered and conditional, so the same card routes an infant, a child, and an
adult to different CPR scripts exactly as the printed decks do. The call no longer ends when the
ambulance is rolling: the response level is fixed at dispatch, and everything after it is the
caller being talked through what to do.

Scripts must form a **DAG** — the loader rejects a pack whose scripts can reach themselves, so a
pack that loads cannot trap a caller in a loop. Termination is a property of the content, not a
runtime step budget.

v0.3 also adds `dispatcherNotes`: the cards' "Call Taker Prompts", "Dispatcher Short Report" and
"Useful Information" — content for the call-taker that is **never spoken**. Those string ids are
kept disjoint from every spoken id, so "never said to the caller" is enforced by the loader rather
than trusted.

The loader (`loadPack`) enforces the grounding contract up front: every referenced string must
exist in **every** declared locale, templates may only interpolate collected slots, every edge and
determinant must reference real questions and options. A pack that loads is safe to execute.

## Caller simulation at scale

`runCall` / `runBatch` / `sweepScripts` (see [`src/sim.ts`](src/sim.ts)) drive scripted callers
through a pack and score the outcomes: turns to dispatch, clarify rate, and the distribution of
protocols, determinants, and response levels. `sweepScripts` enumerates **every combination of
choice options per protocol**, and `npm run sim` (also a CI gate) enforces the simulator's core
invariant: *every call reaches dispatch with a response level*, in every locale. Dispatchers also
clarify-and-re-ask when a choice answer doesn't parse (`clarifyAttempts`, default 1), and keyword
matching is Unicode word-boundary aware — "I do not know" is not a "no".

## Dispatcher personas

Real PSAPs don't all sound the same, so sessions accept a `persona` — deterministic given its
`seed`, so eval runs reproduce exactly:

```ts
new DispatchSession(pack, { persona: { seed: 7, confirmRate: 1, clarifyAttempts: 2 } });
```

- **Phrasing variants**: a catalog entry may be an array of equivalent wordings; the persona picks
  one (still only ever the pack's own strings — grounding is preserved).
- **Read-backs**: questions may declare a `confirmStringId` ("Okay, {address}.") that the persona
  speaks after the answer with probability `confirmRate`.
- **Patience**: `clarifyAttempts` controls how often an unparsed answer is met with
  clarify-and-re-ask.

Personas change phrasing and pacing, never the clinical outcome — a pinned test asserts the same
answers produce the same protocol, determinant, and response level under every seed.

## Requirements coverage

There has never been an open way to answer *"is this protocol set complete?"* without comparing it
against someone's proprietary cardset. So instead we measure the corpus against **published
requirements** — a state's administrative rule, a national curriculum — encoded as machine-readable
rubrics in [`rubrics/`](rubrics/README.md), citation by citation:

```bash
npm run coverage                              # every pack against every rubric
npm run coverage -- --pack us-openises-emd    # one pack, with its evidence
npm run coverage -- --json                    # machine-readable
```

```
us-openises-emd [en/es/fr]  vs  Maine EMDPRS §II.2 — Protocol Requirements
  31 met · 2 partial · 4 unmet of 37 scored (84%); 3 program-scope requirements not scored

  ✓ ME-II-2-A-3  Verification of the call-back number.
      §II.2.A.3
      · caseEntry:q_callback (slot callback)
  ~ ME-II-2-A-23a  Medical management: cardio-pulmonary resuscitation (CPR) and AED.
      §II.2.A.23.a
      · /push (hard|down)|compress|…/ → pd_cpr_push (en) +2 more
      ! no match for /\baed\b|defibrillat|…/
```

Two rubrics ship today: **Maine's EMDPRS §II.2** protocol-requirements list (public law — Maine
adopts MPDS® statewide, but the requirements list is Maine's own, and no proprietary content is
encoded) and the **NHTSA EMD National Standard Curriculum's** EMDPRS structural elements plus its
32 chief complaint types (US federal, public domain).

Every finding prints the question, string, or protocol it came from, so a reader with the pack open
can check the tool's work. Requirements that belong to the *agency* rather than the protocol —
QA/QI case review, dispatcher training, record-keeping — are marked program-scope and never scored
against a pack. This is deliberately the **only** comparison we publish; see
[docs/PRIVATE-PACKS.md](docs/PRIVATE-PACKS.md) for why we never publish similarity claims against
proprietary systems.

## Comparing two packs

```bash
npm run diff -- packs/us-openises-emd/pack.json packs/us-nj-emd/pack.json
npm run diff -- a/pack.json b/pack.json --json
```

Structural, never textual: what each pack asks, what its determinants can branch on, which
response levels each card can reach, where it jumps — not how closely two packs' wordings
resemble each other. (A similarity metric that exists gets quoted, and the one comparison this
project refuses to publish is similarity against a proprietary system.)

Two packs from different jurisdictions share no ids, so cards are lined up first by id and then
through the **shared complaint taxonomy** the coverage rubrics already use — which is why New
Jersey's `chest_pain_heart_problems` and Mexico's `inc10314_infarto` align despite being in
different languages. Response level names are never mapped: `CODE_RED` and
`SIMULTANEOUS_ALS_BLS` are two jurisdictions' words, and asserting they mean the same thing
would be a clinical claim, not a diff.

## Content policy

The hunt for sources — what shipped, what's pending, verified dead ends, and open leads — is
recorded in [docs/PROTOCOL-SOURCES.md](docs/PROTOCOL-SOURCES.md).

- **Only openly licensed playbooks ship here** — public-domain sources (e.g. the NHTSA EMD
  National Standard Curriculum), state-published protocols, and public-records SOPs, each with
  provenance declared in the pack. Proprietary systems (e.g. MPDS®/ProQA®) are **not** included
  and must not be contributed; agencies that license them may encode them as *private* packs and
  load them locally — see [docs/PRIVATE-PACKS.md](docs/PRIVATE-PACKS.md) for the mechanics and
  the permissions you need first.
- **Synthetic data only.** No real emergency calls, transcripts, or personal data — ever.
- The bundled [`packs/us-nhtsa-emd`](packs/us-nhtsa-emd/pack.json) is a heavily simplified
  reference subset that exists to exercise the engine, not a usable medical protocol.
- [`packs/us-openises-emd`](packs/us-openises-emd/pack.json) is the flagship **source-faithful**
  pack: the Open ISES Project's freely licensed (GFDL-1.2+) EMD guide cards — the All Callers
  Interrogation plus all 34 complaint cards, trilingual, with the source's own Code RED/YELLOW
  response taxonomy, and the I1 (AED), I2/I3/I4 (adult, child and infant CPR) and I5/I6/I7
  (adult, child and infant choking) instruction cards as interactive scripts, routed by age. See its [SOURCE.md](packs/us-openises-emd/SOURCE.md) for attribution,
  digitization decisions, and which cards are still to come.
- [`packs/us-nj-emd`](packs/us-nj-emd/pack.json) digitizes the **official State of New Jersey
  EMD Guidecards** (nj.gov/911, updated May 2026): All Caller Interrogation + Chest Pain,
  Cardiac Arrest/DOA, Unconscious/Fainting, and Unknown/Person Down, with New Jersey's own
  dispatch tiers (`SIMULTANEOUS_ALS_BLS` / `BLS_DISPATCH` / `FOLLOW_LOCAL_PROTOCOL`). License
  status: written permission pending — see [SOURCE.md](packs/us-nj-emd/SOURCE.md).
- [`packs/us-alameda-police`](packs/us-alameda-police/pack.json) is the corpus's first **police
  call-taking** pack, grounded on the City of Alameda PD's published Dispatcher Training Manual:
  the What/When/Where/Who/Weapons interrogation, top-down suspect descriptions, and the manual's
  own `PRIORITY_1`/`PRIORITY_2`/`PRIORITY_3` classifications plus 30-second fire/medical
  screen-and-transfer (`TRANSFER_FIRE_EMS`). License: written permission pending — see
  [SOURCE.md](packs/us-alameda-police/SOURCE.md).
- [`packs/mx-cnie-911`](packs/mx-cnie-911/pack.json) grounds a Spanish-language Mexico pack on
  the **Catálogo Nacional de Incidentes de Emergencia v3.0** (SESNSP, official June 2024 — the
  normative classification for every Mexican 9-1-1 center): verbatim incident codes,
  definitions, and `ALTA`/`MEDIA` priorities, with card jumps implementing the catalog's own
  reclassification-by-definition. Open-use license (Libre Uso MX) — see
  [SOURCE.md](packs/mx-cnie-911/SOURCE.md).

## Roadmap

- Protocol corpus: US state-published protocols; Canada (bilingual EN/FR); Mexico (starting from
  the national 911 incident catalog, CNIE).
- Richer caller-answer matching (the v0 keyword matcher is deliberately simple), dispatcher
  persona traits (patience, interruption handling, interpreter-relay simulation), and
  call-scoring for automated evaluation.
- A practice-call web UI so anyone can safely rehearse calling 911 in their own language.

## Governance

CI runs typecheck, tests, pack validation, and a provenance-license allowlist on every push and
PR (`.github/workflows/ci.yml`). Contributions require a DCO sign-off — see
[CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and
[SECURITY.md](SECURITY.md).

## License

[AGPL-3.0-only](LICENSE). Protocol packs carry their own content licenses in `provenance`.
"accesSOS" and the accesSOS logo are trademarks of accesSOS — see [TRADEMARKS.md](TRADEMARKS.md).
