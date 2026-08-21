# Contributing

Thanks for helping make emergency-call technology safer and more accessible.

## Ground rules

1. **Simulation only.** Nothing in this project may be wired to a real emergency line, present
   itself as a real dispatcher, or give medical advice beyond what a sourced protocol pack states.
2. **Provenance is mandatory for protocol content.** A protocol pack PR must declare its source
   and license in `provenance`, and the source must permit redistribution (public domain, open
   government license, or records obtained under public-records law). **Do not contribute
   proprietary protocol content** (MPDS®/ProQA®, PowerPhone, or any licensed system) — such PRs
   will be closed.
3. **Synthetic data only.** Never include real emergency calls, transcripts, or personal data in
   code, packs, tests, or issues.
4. **Every locale ships complete.** The loader enforces that every string exists in every declared
   locale — translations are part of a pack, not an afterthought. Machine translation is
   acceptable for a draft PR if flagged for native-speaker review. Completeness covers what the
   dispatcher *hears* too: an answer option must be recognisable by more than one word in every
   locale, and no locale may be a byte-for-byte copy of the default. Both are enforced by the
   suite, not by review.

## Developer Certificate of Origin

Contributions require a DCO sign-off (`git commit -s`), certifying you have the right to submit
the work under the project license (https://developercertificate.org/).

## Practical bits

- `npm test` runs the suite; `npm run typecheck` must pass. Both run keyless.
- Schema changes bump `schemaVersion` and must keep the reference pack loading.
- New packs live in `packs/<jurisdiction-slug>/pack.json` and validate against
  `schema/pack.schema.json`.
- `npm run coverage` scores packs against the published requirements rubrics in `rubrics/`;
  `npm run diff -- a/pack.json b/pack.json` compares two packs structurally; `npm run score`
  scores the calls themselves and will flag a card that asks nothing or dispatches nothing.
- Extractor vocabulary (`src/lexicon.ts`) is language data, not logic. Adding a locale there is
  welcome; a pack may also carry its own `lexicon` block.
  Requirements rubrics carry the same licensing bar as packs — see
  [rubrics/README.md](rubrics/README.md).
