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
| Open ISES Project EMD Guide Cards v0.26.2 (2008) | GFDL-1.2-or-later (verified in the PDF) | `us-openises-emd` | **All 34 interrogation cards digitized** (M1–M17, T1–T10, C1–C6, H2/H5), trilingual. **Instruction cards** now unblocked by schema v0.3 (`scripts`): I1 (AED), I2/I3/I4 (adult/child/infant CPR) and I5/I6/I7 (adult/child/infant choking) are live as interactive scripts, with C1/C2 routing by age, plus I8 (childbirth) off C5; I9/I10 (airway control) and H1/H3/H4 remain. Source: archive.org `files-all/cards911.zip`. |
| State of New Jersey EMD Guidecards ("Updated May 2026") | `state-published-permission-pending` — AccesSOS/infra#8 | `us-nj-emd` | Official statewide cards, no copyright notice, state-mandated (strong government-edicts posture). NJ publishes EMD only — no fire/police guidecards. |
| Alameda PD Public Safety Dispatcher Training Manual (2020) | `city-published-permission-pending` — AccesSOS/infra#9 | `us-alameda-police` | First police pack. Training prose condensed to cards (pages cited in SOURCE.md). |
| México CNIE v3.0 (SESNSP, junio 2024) | Libre-Uso-MX (gob.mx open-use terms) | `mx-cnie-911` | National classification catalog: codes/definitions/priorities verbatim; interrogation editorial. |
| NHTSA EMD National Standard Curriculum (1996) | Public domain (US federal) | `us-nhtsa-emd` | Curriculum defines EMDPRS *structure* + 32 complaint lessons but deliberately no filled-in cards → our pack is a simplified reference subset; the 805-page full text (ERIC ED425308) is an enrichment/verification source. |

## Verified dead ends — do not re-litigate

- **MPDS® / ProQA® (IAED / Priority Dispatch Corp)** — trademarked, patented, sold per seat.
  Never ship or accept contributions of it. Licensees may load *private* packs locally
  ([PRIVATE-PACKS.md](PRIVATE-PACKS.md)) — with the rights holder's written authorization, since
  an operational license does not cover re-encoding the content into a third-party tool.
- **APCO guidecards (EMD / Fire / Law Enforcement)** — commercial product. Copies floating on
  training sites are not licenses.
- **PowerPhone Total Response** — commercial.
- **Maine** — its "EMD Priority Reference System" is the administrative rule adopting MPDS
  statewide (no cards). The side-product paid off: its §II.2 protocol-requirements list is now
  encoded as the `us-me-emdprs` **rubric** (see *Requirements rubrics* below), so packs can be
  measured against public law instead of against anyone's cardset.
- **Rhode Island** — adopted ProQA (2022). **Virginia** — locally approved cards, none published.
- **Ontario DPCI II** — provincially authored but not publicly published, and Ontario is
  migrating to MPDS. BC / Québec / Nova Scotia run MPDS.
- **Phoenix Regional SOPs M.P. 205.01, La Verne Fire Dispatch Manual** — real public documents,
  but dispatch/radio-side (alarm levels, unit assignment, command); no caller interrogation.
- **Open ISES SourceForge** — no police/fire card sets (their other product is Tickets CAD).
- **Criteria Based Dispatch (King County EMS / Seattle)** — the third major US protocol family,
  but King County states the guidelines are **not available for licensing outside King County**.
  Permission-ask-only (their Dispatch Working Group is the contact); do not chase public copies.
- **Resuscitation Academy T-CPR Toolkit** (© 2017, mycares.net) — excellent free QI training on
  T-CPR *principles* (compression-only emphasis; push hard/fast/don't stop; 100–120/min; never
  interrupt), but no verbatim caller script and no open license → background/verification
  source only. The shippable scripts are the OpenISES **I-cards** (GFDL) — I2 Adult CPR is now
  wired into the C1 card; I1/I3–I8 (AED, child/infant CPR, choking, childbirth) remain.
- **Wisconsin / North Carolina / Pennsylvania** — no state-published guidecards found.

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
- **Unverified stray leads** — `obxairwaves.com/EMD-Cards.pdf` (an NC-area EMD card set of
  unknown authorship/license — verify before touching: could be an APCO copy); ECU EMS policy
  manual (university EMS dispatch/pre-arrival appendix).
- **State admin codes as edicts** — some states incorporate dispatch standards into regulation
  (e.g. NJ NJAC 17:24). Cards embedded *in* the administrative code itself would be
  government-edict material (strongest tier). Worth a systematic pass of state 911 regs.
- **MuckRock** — completed public-records requests are browsable; search for released PSAP
  guidecards/SOPs before filing new requests.
- **988 / crisis lines** — SAMHSA publications are federal PD; the Lifeline's clinical safety
  assessment is not. Treat as future work with clinical review, not a quick pack.

## Requirements rubrics (in `rubrics/`)

Not protocol content — the *requirements* published bodies impose on protocol content. Encoded so
`npm run coverage` can score every pack against them with a citation per line
([rubrics/README.md](../rubrics/README.md)). Same licensing bar as packs.

| Source | License | Rubric | Notes |
| --- | --- | --- | --- |
| Maine EMDPRS §II.2 Protocol Requirements (Maine Board of EMS / ESCB, rev. June 2014) | government edict (state board rule under 32 M.R.S.A. §85-A) | `us-me-emdprs` | 40 requirements, 37 pack-scope. Maine adopts MPDS® in §II.1 — **none of that content is encoded**; only §II.2's own list. The direct document URL was not recorded at retrieval — re-verify against Maine EMS's published EMD documents before citing publicly. |
| NHTSA EMD National Standard Curriculum (1996), Modules 2–3 | public domain (US federal; ERIC ED425308) | `us-nhtsa-emd-curriculum` | EMDPRS structural elements (three protocol types, the four card design components, initial-survey contents, Where→What order) plus the **32 chief complaint types** as a reusable taxonomy that Maine §II.2.A.27 cites. |

What the first run found, and what it is worth: the flagship OpenISES pack meets 31/37 Maine
pack-scope requirements and 17/19 NHTSA ones. The gaps are real and each points at existing work —
no AED script and no childbirth delivery script (the deliberately skipped OpenISES I-cards), no
electrocution card, no caller-proximity question, and two things the *schema* cannot express at
all: EMD-facing "Useful Information" and repetitive-persistence phrasing. Rubric findings of kind
`notRepresentable` are the cleanest signal we have for what a schema revision should add.

Leads for more rubrics: other states' EMD administrative rules (the NJ, Virginia and Rhode Island
regs were read for cards, not for requirements — worth a second pass); ASTM F 1258 (cited by
Maine, but ASTM standards are copyrighted and sold — **not** shippable); NFPA 1221 (same posture);
the APCO/NENA ANS standards (member-licensed, not open).

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
