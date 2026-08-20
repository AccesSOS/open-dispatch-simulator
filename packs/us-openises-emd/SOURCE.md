# Source & License — us-openises-emd

This pack is a **derivative work** of:

> **Emergency Medical Dispatch Guide Cards**, Draft Version 0.26.2 (flip-card format)
> Part of the Cards 911 Project, by **The Open ISES Project**
> Copyright © 2008 The Open ISES Process
> [archive.org copy](https://archive.org/download/files-all/cards911.zip/EMD_Card_Version_0.26.2.pdf)

Licensed under the **GNU Free Documentation License, Version 1.2 or any later version** published
by the Free Software Foundation; with no Invariant Sections, no Front-Cover Texts, and no
Back-Cover Texts. License text: <https://www.gnu.org/licenses/fdl-1.2.html>. This pack
(`pack.json`) is distributed under the same license.

## What was changed (per GFDL §4)

Digitized 2026-08-20 by the Open Dispatch Simulator project (accesSOS) into the machine-readable
protocol-pack format defined by `schema/pack.schema.json`. Substantive digitization decisions are
recorded in the pack's `provenance.notes`.

**Interrogation cards — complete.** The All Callers Interrogation plus all 34 complaint cards
(M1–M17, T1–T10, C1–C6, H2, H5).

**Instruction cards — in progress.** The I-cards are the scripts a dispatcher *performs*: they
branch on what the caller answers and hand off to one another. They needed schema v0.3
(`scripts` / `postDispatchScripts`) before they could be represented at all.

| Card | Status |
| --- | --- |
| I1 Automated External Defibrillator | digitized |
| I2 Adult CPR (sections A–D) | digitized |
| I3 Child CPR (sections A–D) | digitized |
| I4 Infant CPR (sections A–C) | digitized |
| I5 Choking Adult (sections A–C) | digitized |
| I6 Choking Child (sections A–C) | digitized |
| I7 Choking Infant (sections A–D) | digitized |
| I8 Childbirth (sections A–B) | digitized |
| I11 Bleeding Control | digitized (as flat post-dispatch lines — the card has no branches) |
| H1 Aircraft/Terrorism | digitized |
| H3 HazMat Incident Guidelines | digitized |
| H4 Helicopter Guidelines (landing zone) | digitized |
| I9/I10 Medical & Traumatic Airway Control | not yet |

C1 (Cardiac/Respiratory Arrest) and C2 (Choking) route to the age-appropriate deck — under 1 to
the infant cards, under 9 to the child cards, otherwise adult — as the source's own card titles
direct. The last route carries no condition, so a caller who never gives an age still gets
instructions. Since schema v0.4 the age question uses the unit-aware `age` extractor, so
"six months old" is 0.5 years and reaches the infant deck; "newborn", "bebé" and "nouveau-né"
resolve too.

Each card *section* is digitized as its own script, because the source itself names sections as
jump targets ("Jump to I5: Choking Adult Instructions, Section B"). I2 §C is split further, into
the "Did the chest rise?" gate and the "Compression Only / Choking Adult Entry Point" below it —
the card gives that lower half its own entry points, and keeping the two halves in one script
would have turned the I2↔I5 hand-offs into a cycle rather than the one-way flow the card
describes.

Two deliberate departures, both forced by the medium:

- The printed cards react to things a caller volunteers mid-procedure (*patient vomited*, *stoma*,
  *hysterical*). A turn-based engine cannot receive an unprompted report, so those become one
  asked question whose options are the card's own branch labels.
- I1's step 1 age gate ("if the person is not at least one year of age, jump to I4") is enforced
  upstream instead, by the calling card's age routing.
- I7 §B's "still conscious & choking, repeat sequence" is a loop on the printed card. It is
  digitized as a terminal instruction to repeat the sequence and report back, because a script
  that can re-enter itself is rejected at load.
- I8 reuses C5's own key questions for the imminence branch the card draws — a strong urge to
  push, or the head visible — rather than asking again. Its "baby delivered and not breathing"
  arrow points at the I7 card, and is digitized that way even though a newborn is not choking on
  an object: the arrow is the card's.

The three procedure cards produce no CODE RED/YELLOW tier — their dispatch sections are agency
notifications and a landing zone, not medical responses — so each declares its own outcome
(`NOTIFY_AIR_DEFENSE`, `NOTIFY_HAZMAT_AGENCIES`, `LANDING_ZONE`) rather than being filed under a
tier it does not have. H3 routes injuries to the T9 traumatic injury card, which is what its own
dispatch section directs. H4's first page is air-transport criteria for the call-taker rather than
anything spoken, so it lives in `dispatcherNotes.useful`; its landing-zone page is the caller
interrogation.

**Not digitized on purpose:** H1's list of Air Defense Sector telephone numbers. The source itself
says "The numbers above should be verified before their use becomes necessary. These numbers can
and do change" — shipping stale emergency phone numbers in a simulator would be worse than
shipping none.

The Spanish and French catalogs (added 2026-08-20) are translations by the Open Dispatch Simulator
project, not part of the English-only source document — flag translation issues as bugs. That
includes the **answer** vocabulary, not only what the dispatcher says: the keywords each yes/no
option recognises were brought to parity across the three locales on 2026-08-20, because Spanish
had shipped a single way to say no and a caller answering "para nada" was being asked the question
again. A locale that ships one word per option now fails the test suite.

## Operational warning (from the source, and from us)

The source document requires local medical-director approval before operational use, and this
digitized subset is additionally **SIMULATION ONLY** — for testing, research, and practice. It is
not certified for live emergency call-taking.
