# Requirements rubrics

A **rubric** is a published list of requirements for emergency call-taking protocols — a state's
administrative rule, a national curriculum — encoded so packs can be measured against it, with a
citation on every line.

```bash
npm run coverage                                  # every pack against every rubric
npm run coverage -- --pack us-openises-emd        # one pack
npm run coverage -- --rubric us-me-emdprs --all   # include program-scope requirements
npm run coverage -- --json                        # machine-readable
npm run coverage -- --min 80                      # exit nonzero below 80% met
```

## Why this exists

This is the project's **safe comparison story**. We do not publish similarity claims against
proprietary protocols — measuring that needs a copy of the protected content and publishing the
result is a claim about someone's expression (see [../docs/PRIVATE-PACKS.md](../docs/PRIVATE-PACKS.md)).
What we can say, publicly and defensibly, is *"this pack covers every element the state requires"* —
because the requirements are public law and the evidence is in the pack.

So every finding prints the question id, string id, or protocol it came from. A coverage claim
nobody can audit is worth nothing; a reader with the pack open should be able to check the tool's
work line by line.

## Shipped rubrics

| Rubric | Instrument | License |
| --- | --- | --- |
| `us-me-emdprs` | Maine EMDPRS §II.2 Protocol Requirements (Maine Board of EMS / ESCB, rev. 2014) | government edict |
| `us-nhtsa-emd-curriculum` | NHTSA EMD National Standard Curriculum (1996) — EMDPRS structural elements + the 32 chief complaint types | public domain (US federal) |

Maine adopts MPDS® statewide; **none of that proprietary content is encoded here or anywhere in
this project**. What `us-me-emdprs` encodes is only §II.2 — Maine's own public-law list of what an
approved protocol must contain, issued by a state board under 32 M.R.S.A. §85-A.

## Scope: pack vs program

Every requirement declares `appliesTo`:

- **`pack`** — a property of the protocol content, and therefore scored.
- **`program`** — a property of the agency running it (QA/QI case review, dispatcher training,
  record-keeping, mass-casualty plans, medical-director approval). Reported for completeness and
  never scored, because nothing a pack contains could satisfy it.

Scoring a pack against a rubric written for another discipline (an EMD rubric against a police
pack) produces a low number that is a scope statement, not a defect. The report says so.

## Adding one

1. The source must be openly licensed — public law, a government edict, a public-domain federal
   publication, or written permission. Same bar as packs; record it in
   [../docs/PROTOCOL-SOURCES.md](../docs/PROTOCOL-SOURCES.md).
2. Write `rubrics/<slug>.json` against [`../schema/rubric.schema.json`](../schema/rubric.schema.json).
   Cite each requirement to its section, and condense the instrument's own wording rather than
   inventing your own.
3. Pick the narrowest check that is honest. If a requirement genuinely cannot be expressed in a
   pack today, say so with `notRepresentable` and a reason — a false ✓ is worse than a documented
   gap, and those gaps are how the schema learns what it is missing.

### Check kinds

| Kind | Satisfied when |
| --- | --- |
| `caseEntry` | A case-entry question's slot or id matches `slot` (or, with only `min`, the sequence is at least that long) |
| `caseEntryOrder` | The question matching `firstSlot` is asked before the one matching `thenSlot` |
| `protocolSelector` | Some case-entry answer selects the protocol |
| `keyQuestions` | `minProtocols` protocols carry key questions |
| `postDispatch` | `minProtocols` carry post-dispatch instructions, or (`minSteps`) one carries an ordered script |
| `responseLevels` | The pack distinguishes at least `min` response levels |
| `text` | Regexes match spoken text (`textScope`: `postDispatch`, `questions`, `all`) in any locale — all patterns met, some partial |
| `cardJump` | The pack declares protocol-to-protocol jumps |
| `complaints` | Protocols cover a named taxonomy, referenced as `<rubricId>#<key>` |
| `notRepresentable` | Never — the pack schema has nowhere to put this yet; the `note` says why |
| `manual` | Never scored; for `program` requirements |
