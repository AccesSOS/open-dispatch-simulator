# Protocol source registry

The living record of the hunt for openly licensed emergency call-taking playbooks. Every source
we ship, every one we're waiting on, every dead end (with *why*), and every promising lead —
so contributors and cohort teams can pick up the search without repeating it.

**The bar:** a pack ships only from content we may lawfully redistribute — public domain, an open
license, or written permission — with provenance recorded in the pack and enforced by CI
(`.github/workflows/ci.yml` provenance allowlist). "It's on the internet" is not a license.

## Shipped (in `packs/`)

| Source | License | Pack | Notes |
| --- | --- | --- | --- |
| Open ISES Project EMD Guide Cards v0.26.2 (2008) | GFDL-1.2-or-later (verified in the PDF) | `us-openises-emd` | 15 cards digitized of ~34; community-authored model cards built for adoption. Remainder: T-cards, H1/H3–H5, M-cards, I-scripts (CPR/childbirth). Source: archive.org `files-all/cards911.zip`. |
| State of New Jersey EMD Guidecards ("Updated May 2026") | `state-published-permission-pending` — AccesSOS/infra#8 | `us-nj-emd` | Official statewide cards, no copyright notice, state-mandated (strong government-edicts posture). NJ publishes EMD only — no fire/police guidecards. |
| Alameda PD Public Safety Dispatcher Training Manual (2020) | `city-published-permission-pending` — AccesSOS/infra#9 | `us-alameda-police` | First police pack. Training prose condensed to cards (pages cited in SOURCE.md). |
| México CNIE v3.0 (SESNSP, junio 2024) | Libre-Uso-MX (gob.mx open-use terms) | `mx-cnie-911` | National classification catalog: codes/definitions/priorities verbatim; interrogation editorial. |
| NHTSA EMD National Standard Curriculum (1996) | Public domain (US federal) | `us-nhtsa-emd` | Curriculum defines EMDPRS *structure* + 32 complaint lessons but deliberately no filled-in cards → our pack is a simplified reference subset; the 805-page full text (ERIC ED425308) is an enrichment/verification source. |

## Verified dead ends — do not re-litigate

- **MPDS® / ProQA® (IAED / Priority Dispatch Corp)** — trademarked, patented, sold per seat.
  Never ship or accept contributions of it. Licensees may load *private* packs locally.
- **APCO guidecards (EMD / Fire / Law Enforcement)** — commercial product. Copies floating on
  training sites are not licenses.
- **PowerPhone Total Response** — commercial.
- **Maine** — its "EMD Priority Reference System" is the administrative rule adopting MPDS
  statewide (no cards). Useful side-product: its §2 protocol-requirements list is a good external
  rubric for what a complete pack must contain.
- **Rhode Island** — adopted ProQA (2022). **Virginia** — locally approved cards, none published.
- **Ontario DPCI II** — provincially authored but not publicly published, and Ontario is
  migrating to MPDS. BC / Québec / Nova Scotia run MPDS.
- **Phoenix Regional SOPs M.P. 205.01, La Verne Fire Dispatch Manual** — real public documents,
  but dispatch/radio-side (alarm levels, unit assignment, command); no caller interrogation.
- **Open ISES SourceForge** — no police/fire card sets (their other product is Tickets CAD).

## Permission-pending / in flight

- **NJ OETS** — infra#8 (email drafted; Kevin sends).
- **City of Alameda** — infra#9 (email drafted; Kevin sends).

## Open gaps and promising leads

- **Fire call-taking interrogation** — the biggest remaining domain gap. Four sources checked
  were dispatch-side only. Leads: more city fire *communications/call-taking* manuals (the
  police-manual pattern worked — try Belmont, Sebastopol, Cloverdale, Yuba City equivalents for
  fire); county public-records requests for PSAP fire guidecards; USFA/FEMA publications
  (federal PD) worth a deeper pass.
- **More police packs** — Belmont, Sebastopol, Cloverdale, Yuba City PD dispatcher manuals are
  published like Alameda's (city-permission posture). Useful for jurisdictional variance.
- **Canada** — no open source found; path is public-records/FOI to Ontario MOH or a CACC, or a
  provincial partnership. The engine's FR machinery is already proven.
- **UK (999)** — College of Policing APP covers contact management/call grading (THRIVE), but
  College content carries its own licence (typically non-commercial), *not* OGL: needs a written
  permission ask before any use. Force-level policies (e.g. Merseyside, West Yorkshire) are
  published under FOI schemes — same permission posture. NHS Pathways is proprietary.
- **Public-records route (US)** — PSAP SOPs and locally approved guidecards are public records
  in many states. A structured records-request campaign is the scalable corpus play (and a good
  cohort-team project): request, digitize, tag `state/city-published-permission-pending` or the
  granted license.
- **988 / crisis lines** — SAMHSA publications are federal PD; the Lifeline's clinical safety
  assessment is not. Treat as future work with clinical review, not a quick pack.

## Posture patterns (precedents)

- Government-published, no notice, mandated for use → digitize + explicit
  `*-permission-pending` license + CI allowlist entry + infra issue with a drafted permission
  email. (NJ, Alameda.)
- Government open-use terms → cite them (`Libre-Uso-MX`; UK OGL would qualify if a source is
  actually under it).
- Free-content licenses (GFDL, CC) → verify the notice *in the document itself*, carry
  attribution + change summary in SOURCE.md.
- Unknown-tier answers always land on the safer tier (age unknown → higher acuity; felony
  timeframe unknown → PRIORITY_1). Documented per pack in `provenance.notes`.
- Never condition a card's determinants on the slot that routes calls into it (every arrival has
  it — it makes the card's own criteria dead code).
