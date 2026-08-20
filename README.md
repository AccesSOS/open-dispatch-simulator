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
npm test        # engine + simulator suites (keyless)
npm run sim     # branch-sweep every pack in every locale, enforce invariants
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
| `strings.<locale>` | Every utterance template, per locale — validated complete at load time |
| `provenance` | Where the playbook came from and its redistribution license |

Schema **v0.2** adds three features (v0.1 packs remain valid): `extract: "number"` on a question
captures the first number in the answer; determinant and edge conditions may then be **numeric**
(`{ "slot": "age", "gt": 35 }` — never matching when no number was captured, so age-unknown falls
to whichever tier the pack lists as default); edges gain `when` (compound conditions on prior
slots) and `gotoProtocol` — faithful **card jumps**, e.g. both bundled real packs now route an
unconscious, non-breathing patient to their Cardiac Arrest card mid-case-entry, exactly as the
printed flow charts direct.

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

## Content policy

- **Only openly licensed playbooks ship here** — public-domain sources (e.g. the NHTSA EMD
  National Standard Curriculum), state-published protocols, and public-records SOPs, each with
  provenance declared in the pack. Proprietary systems (e.g. MPDS®/ProQA®) are **not** included
  and must not be contributed; agencies that license them may encode them as *private* packs and
  load them locally.
- **Synthetic data only.** No real emergency calls, transcripts, or personal data — ever.
- The bundled [`packs/us-nhtsa-emd`](packs/us-nhtsa-emd/pack.json) is a heavily simplified
  reference subset that exists to exercise the engine, not a usable medical protocol.
- [`packs/us-openises-emd`](packs/us-openises-emd/pack.json) is the first **source-faithful**
  pack: the Open ISES Project's freely licensed (GFDL-1.2+) EMD guide cards — All Callers
  Interrogation plus the M5 Chest Pain, C1 Cardiac Arrest, C6 Unconscious/Fainting, and M17
  Unknown/Man Down cards, with the source's own Code RED/YELLOW response taxonomy. See its
  [SOURCE.md](packs/us-openises-emd/SOURCE.md) for attribution and digitization decisions.
- [`packs/us-nj-emd`](packs/us-nj-emd/pack.json) digitizes the **official State of New Jersey
  EMD Guidecards** (nj.gov/911, updated May 2026): All Caller Interrogation + Chest Pain,
  Cardiac Arrest/DOA, Unconscious/Fainting, and Unknown/Person Down, with New Jersey's own
  dispatch tiers (`SIMULTANEOUS_ALS_BLS` / `BLS_DISPATCH` / `FOLLOW_LOCAL_PROTOCOL`). License
  status: written permission pending — see [SOURCE.md](packs/us-nj-emd/SOURCE.md).

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
