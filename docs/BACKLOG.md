# Backlog

Priority order. One item per unit of work; each completed item is checked off with a one-line
result note and its commit hash. `[BLOCKED: reason]` marks an item that cannot proceed without
external input (a permission reply, a decision from Kevin, a records request).

- [ ] **Requirements-coverage report.** Encode Maine's EMD administrative rule §2
      protocol-requirements list (see [PROTOCOL-SOURCES.md](PROTOCOL-SOURCES.md) — Maine adopts
      MPDS, but the requirements list itself is public law) and the NHTSA EMD curriculum's
      EMDPRS elements as machine-readable rubrics with citations, plus `npm run coverage`
      producing a per-pack requirements-coverage report. This is the public, safe comparison
      story — "covers every element the state requires" — per
      [PRIVATE-PACKS.md](PRIVATE-PACKS.md).
- [ ] **Pack-diff tool.** Check `scripts/diff.ts` first — this may already exist from a separate
      task. If absent: structural diff of two packs (complaint coverage, slots, tier mapping,
      jumps — NOT text similarity), `npm run diff -- a/pack.json b/pack.json`, human + `--json`
      output, tested on the bundled packs.
- [ ] **Schema v0.3 — interactive scripting.** Minimal design to support the OpenISES procedure
      cards (H1/H3/H4) and instruction scripts (I1, I3–I8) that were skipped by design (C1
      already embeds the I2 CPR script; use that as the fidelity bar). v0.1/0.2 packs must remain
      valid. Then digitize those cards trilingual (en/es/fr) into `packs/us-openises-emd`, GFDL
      attribution in SOURCE.md as before.
- [ ] **Slot value extraction.** Dispatch read-backs currently interpolate whole caller
      sentences. Add deterministic extractors (regex/structured, per slot type — age, counts,
      yes/no, addresses) so read-backs echo values. No LLM. Verify via the sim sweep.
- [ ] **Fire call-taking deck source hunt (ONE bounded round).** Verify the leads already
      recorded in PROTOCOL-SOURCES.md (state-admin-code edicts, MuckRock released records,
      obxairwaves stray cards — verify authorship/license before touching, could be an APCO
      copy). Ship a pack ONLY if license-clean; otherwise record findings and mark this item done
      with a summary. Do not loop on hunting.
- [ ] **Locale completeness pass.** Everything in the flagship pack trilingual en/es/fr;
      translations flagged editorial in SOURCE.md, as established.
