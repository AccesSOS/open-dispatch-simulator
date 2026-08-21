# Backlog

Round 1 is complete — the record is kept below for the decisions in it. Round 2 is at the bottom.

Priority order. One item per unit of work; each completed item is checked off with a one-line
result note and its commit hash. `[BLOCKED: reason]` marks an item that cannot proceed without
external input (a permission reply, a decision from Kevin, a records request).

- [x] **Requirements-coverage report.** Encode Maine's EMD administrative rule §2
      protocol-requirements list (see [PROTOCOL-SOURCES.md](PROTOCOL-SOURCES.md) — Maine adopts
      MPDS, but the requirements list itself is public law) and the NHTSA EMD curriculum's
      EMDPRS elements as machine-readable rubrics with citations, plus `npm run coverage`
      producing a per-pack requirements-coverage report. This is the public, safe comparison
      story — "covers every element the state requires" — per
      [PRIVATE-PACKS.md](PRIVATE-PACKS.md).
      → *Done* (a127e1f). `schema/rubric.schema.json` + `rubrics/us-me-emdprs.json` (40 requirements) and
      `rubrics/us-nhtsa-emd-curriculum.json` (21, plus the 32-chief-complaint taxonomy Maine
      §II.2.A.27 cites); `npm run coverage` scores every pack with per-finding evidence. Flagship
      pack: 31/37 Maine, 17/19 NHTSA. Two gaps are schema gaps (`notRepresentable`), which feeds
      the v0.3 item below.
- [x] **Pack-diff tool.** Check `scripts/diff.ts` first — this may already exist from a separate
      task. If absent: structural diff of two packs (complaint coverage, slots, tier mapping,
      jumps — NOT text similarity), `npm run diff -- a/pack.json b/pack.json`, human + `--json`
      output, tested on the bundled packs.
      → *Done* (613f3e9). `scripts/diff.ts` did not exist. `src/diff.ts` + `npm run diff`: case-entry slots
      and ordering, complaint coverage, per-card slot/decision-slot/response-level/jump diffs,
      `--json`. Cards align by id, then through the coverage taxonomy — so NJ `chest_pain` lines
      up with MX `inc10314_infarto` across languages. Response level names are never mapped.
- [x] **Schema v0.3 — interactive scripting.** Minimal design to support the OpenISES procedure
      cards (H1/H3/H4) and instruction scripts (I1, I3–I8) that were skipped by design (C1
      already embeds the I2 CPR script; use that as the fidelity bar). v0.1/0.2 packs must remain
      valid. Then digitize those cards trilingual (en/es/fr) into `packs/us-openises-emd`, GFDL
      attribution in SOURCE.md as before.
      → *Done*, across five commits. `13d0228` schema v0.3 (`scripts` of say/ask/stay steps,
      `postDispatchScripts`, `dispatcherNotes`; scripts must be a DAG so termination is
      structural; `npm run sim` sweeps every walk and fails on an unreachable step).
      `e4653b8` I1/I2/I5 adult, `92afb65` I3/I4/I6/I7 paediatric routed by age, `c2d6c92` I8
      childbirth, `262fc0e` H1/H3/H4 procedure cards. 37 cards, 27 scripts, 172 steps,
      trilingual; only I9/I10 (airway control) remain. Coverage moved 31/37 → 33/37 (Maine) and
      17/19 → 18/19 with nothing unmet (NHTSA).
- [x] **Slot value extraction.** Dispatch read-backs currently interpolate whole caller
      sentences. Add deterministic extractors (regex/structured, per slot type — age, counts,
      yes/no, addresses) so read-backs echo values. No LLM. Verify via the sim sweep.
      *Was also a routing concern:* C1/C2 pick the infant, child or adult instruction deck from
      the age slot, and "six months old" extracted as 6, so an infant described that way took the
      child deck.
      → *Done* (8559d25). Schema v0.4: `extract` widened to `number` / `age` / `count` / `address` /
      `phone`, plus a per-locale `lexicon`. Read-backs now echo the value ("I have 12 Pine
      Street"), `age` is unit-aware so six months routes to the infant deck, and extraction that
      recognises nothing leaves the caller's own words in place. Applied to `us-openises-emd`
      (en/es/fr) and `mx-cnie-911` (es); the other packs stay at 0.1/0.2 as back-compat canaries.
- [x] **Fire call-taking deck source hunt (ONE bounded round).** Verify the leads already
      recorded in PROTOCOL-SOURCES.md (state-admin-code edicts, MuckRock released records,
      obxairwaves stray cards — verify authorship/license before touching, could be an APCO
      copy). Ship a pack ONLY if license-clean; otherwise record findings and mark this item done
      with a summary. Do not loop on hunting.
      → *Done* (254ff65). No pack shipped — nothing was licence-clean. Verified and closed: the obxairwaves
      PDF (33 scanned bitmaps, no text layer, no author/copyright anywhere, host has no standing
      to license it), the PowerDMS "PGPD" fire dispatch procedure (Punta Gorda, dispatch-side),
      Butler County KS (mandates ProQA by name), state admin codes (nothing embedded), MuckRock
      (nothing released). One real find: **North Island 9-1-1 (BC) O.G. 7.4.0 "Standard Call
      Taking Procedure — Fire Dispatch"** — genuine fire call-taking, no proprietary system, no
      copyright notice; recorded as a permission-ask lead in the Alameda posture. Closes both the
      fire and Canada gaps if the ask lands. Full findings in PROTOCOL-SOURCES.md.
- [x] **Locale completeness pass.** Everything in the flagship pack trilingual en/es/fr;
      translations flagged editorial in SOURCE.md, as established.
      → *Done* (06593bf). Audit found the utterance catalogs already complete — 392/392 strings genuinely
      translated in both es and fr, nothing copied from English. The real gap was the *answer*
      side: Spanish shipped one negative ("no") on 201 of 471 options while en had "no"/"not" and
      fr "non"/"pas", so "para nada" or "ninguno" met a clarify-and-re-ask. Yes/no vocabulary
      brought to parity across the corpus (1369 option/locale sets, appended so the sweep's
      answers are unchanged — every determinant and response count is byte-identical before and
      after). `test/locales.test.ts` now enforces both directions corpus-wide.

## Round 2 — more use cases

The corpus and engine are strong; what is thin is the number of ways to *get at* them. These come
from the README's own roadmap (call-scoring, richer answer matching, persona traits and
interpreter relay, a practice UI) plus the access gaps that showed up while building round 1.

- [x] **Call scoring.** `npm run score`: turn a call from "did it complete" into "was it handled
      to protocol". Score a session's event stream against the pack on the QA variables Maine
      §III.4.C names — all-caller questions, protocol selection, complaint-specific questions,
      priority determination, post-dispatch and pre-arrival instructions — with evidence per axis.
      Run it over each pack's branch sweep so it doubles as a pack-quality report: slots asked but
      never parsed, protocols only reachable by fallback, cards that ask nothing. Deterministic,
      keyless. Synthetic transcripts only, as always.
      → *Done.* `src/score.ts` + `npm run score`, six cited axes, 59k calls scored across the
      corpus in ~9s. Compliance (dispatcher and pack) is separated from information capture
      (caller) — conflating them was the first version's bug, along with scoring a card's
      deliberate fast-track to dispatch as a skipped interrogation. Corpus is clean; the failure
      paths are proven on deliberately broken packs rather than asserted. It also turned up the
      "I do not know" reading recorded under answer matching below.
- [x] **Serve the dispatcher.** `npm run serve`: a `node:http` JSON API (no new dependencies) so a
      process in any language can hold a call — start a session, post an answer, read the
      utterances and the result. This is what an AI caller, a crash-detection client or an alarm
      integration needs to test against a realistic dispatcher without linking the library.
      → *Done.* `src/server.ts` + `npm run serve`. Eight endpoints including `/packs` (with
      provenance) and `/packs/:id/graph` for visualizers. Loopback-only and unauthenticated by
      design, with the simulation notice on every response; held calls are capped and idle-swept
      so a forgotten client cannot grow the heap.
- [x] **Hold a call from the terminal.** `npm run call -- <pack> [--locale es]`: an interactive
      REPL call. The practice/rehearsal use case in its smallest honest form, and the fastest way
      to sanity-check a pack you are writing.
      → *Done.* `scripts/call.ts` + `npm run call`. Reads stdin so it scripts as well as it
      converses, `--score` prints the call's scorecard, and running out of answers says which
      slot it was still waiting on rather than exiting silently.
- [x] **Richer caller-answer matching.** The v0 matcher is whole-word, first-option-wins, and has
      known hazards: "no shock" matched "shock" until the options were reordered, Spanish "si"
      also means "if", and "sí, no puede respirar" matches the negative first. Make matching
      negation-aware and add an explicit "unknown / I don't know" outcome distinct from an
      unparsed answer. Prove no sweep outcome moves except the ones intended.
      *Concrete case, found by the scorer:* any pack listing "not" as a negative keyword — the
      OpenISES pack does — reads "I do not know", "not sure" and "no idea" as a firm **no**. The
      reference pack does not list "not", so the same phrase clarifies there instead. Same engine,
      opposite readings of an answer that means neither.
      → *Done.* "I don't know" resolves to its own `unknowns` outcome in all three locales and is
      not re-asked; the longer match wins with ties going to the pack, so M10's real "not sure"
      answer still works. The loader now rejects options that shadow each other — which
      immediately caught a defect the locale-parity pass had introduced: the generic negative
      "never" made "never like this" (a real *yes* on the headache card) unreachable in all three
      locales, invisible to the sweep because the sweep never says those words. Every determinant
      and response count in the sweep is unchanged. *Not done:* position-aware matching — earliest
      keyword wins rather than option order — which fixes "sí, no puede respirar" but regresses
      the Spanish "si" that also means "if". Left alone deliberately; the current order biases to
      the higher-acuity reading.
- [x] **Replay harness (observable behavior).** `npm run replay -- replay-private/ --pack <id>`
      per `docs/REPLAY.md`: read private case files (facts keyed by behavior code, observed
      question/instruction codes, dispatch moment, implied protocol), map each pack's question
      slots and instruction lines/script steps to behavior codes via `replay/codes/<pack>.json`
      (build the maps for all five packs), feed facts as answers through `DispatchSession`
      ("I don't know" for anything uncoded — never invent), and report ONLY aggregates: question
      recall/precision (core vs `Q.kq:*`), opening-order agreement (first-3 + Kendall τ),
      instruction recall/precision, dispatch-timing delta, protocol agreement, and the miss list.
      Ship 3 synthetic example case files under `test/fixtures/replay/` (clearly fake, for tests
      only — the real ones are gitignored). Deterministic, keyless, no new deps. Never print a
      per-call row in committed output.
      → *Done* (bd522b7). `src/replay.ts` + `npm run replay`; code maps for all five packs (317
      OpenISES slots including every I-card ask step, validated key-by-key against the packs);
      a case-file validator that enforces the placeholders and rejects phone-like digits, street
      names and capitalized words; three synthetic fixtures. `Q.caller_name` joined the core
      codes — three packs ask it. On the fixtures the engine announces dispatch ~13 questions
      later than the coded dispatcher, and `Q.with_patient` is on the OpenISES miss list (the
      caller-proximity gap the rubric pass had already found). Real case files come next, under
      `replay-private/`.
- [ ] **Caller personas for the harness.** Callers do not answer in keywords. Add caller-side
      profiles — panicked, third-party ("I can't see him from here"), non-native speaker,
      indirect — so packs are exercised against messy input rather than clean option words. Pairs
      with interpreter-relay simulation from the roadmap.
