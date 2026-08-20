# Backlog

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
