# Private packs — running a licensed protocol you already pay for

Some agencies run proprietary protocol systems (MPDS®/ProQA®, PowerPhone, APCO guidecards, NHS
Pathways, …). Those systems are **never shipped in, or accepted into, this repository** — see
[CONTRIBUTING.md](../CONTRIBUTING.md) and [PROTOCOL-SOURCES.md](PROTOCOL-SOURCES.md). But the
engine is content-neutral: it executes any pack that validates against
[`schema/pack.schema.json`](../schema/pack.schema.json), wherever that pack lives on disk.

That separation is the opt-in model:

- **The public corpus** (`packs/`) carries only openly licensed content, enforced by the CI
  provenance allowlist.
- **A private pack** is a pack file you keep outside the public corpus and load yourself. The
  engine treats it identically; the licensing is yours.

## How to load one

Put the pack anywhere outside `packs/` — the conventional place is `packs-private/`, which is
gitignored so it cannot be committed or contributed by accident:

```ts
import { loadPackFromFile } from 'open-dispatch-simulator';

const pack = loadPackFromFile('packs-private/my-agency-mpds/pack.json');
```

Set `provenance.license` to something honest, e.g. `"proprietary-priority-dispatch"`. The schema
accepts any license string; the CI allowlist only gates what ships in `packs/`.

## Whose permission you need (read this part)

**Your operational license is probably not enough.** A cardset or ProQA seat license authorizes
using the system to dispatch calls. Digitizing the cards into another tool's format — this one's —
is reproducing and adapting the licensed content, which those licenses typically do not grant.
Proprietary protocol vendors may also hold patents on parts of their systems, and a content
license is not a patent license.

So before encoding a proprietary system as a private pack:

1. **Get written authorization from the rights holder** (for MPDS, that is Priority Dispatch
   Corp. / IAED) covering use of the content in a third-party training/simulation tool. As their
   customer, your agency is the right party to ask — it has standing this project does not.
2. Keep the pack private: don't commit it, don't publish it, don't share it outside the terms of
   that authorization.

This project's maintainers will not digitize proprietary content for you, host it, or accept it —
with or without your license. What we ship is the container, the validator, and the engine.

## Comparisons against proprietary systems

We do not publish similarity claims ("N% identical to <proprietary system>") against proprietary
protocols, and we don't accept PRs or docs that do. Measuring that requires a copy of the
proprietary content, and publishing the result is a claim about their protected expression —
both are problems that belong to lawyers, not READMEs.

What we do instead:

- Measure the open corpus against **public requirements** — e.g. a state's administrative-rule
  requirements for EMD protocols, or the NHTSA EMD curriculum elements (see
  [PROTOCOL-SOURCES.md](PROTOCOL-SOURCES.md)).
- Let licensed agencies compare **privately**: load your own system as a private pack and diff it
  against an open pack on your own machines. The result is yours; publishing it is your call
  under your license, not ours.
