# Replay source registry

The living record of the hunt for **publicly released 911 recordings and transcripts** that the
replay study ([REPLAY.md](REPLAY.md)) may code. Same shape as
[PROTOCOL-SOURCES.md](PROTOCOL-SOURCES.md): every source we use, every one we are waiting on,
every dead end with *why*, and every lead — so nobody repeats the search.

**The bar.** A recording is codeable only if it was *publicly released* — a public-records
release, an investigation report, a court exhibit, or a curated public archive — and the host's
terms allow downloading. Partner-agency calls are never touched here (they are processed on the
agency's machines, see REPLAY.md). Nothing from any source enters the repository, trains or tunes
anything, or is published except as an aggregate. Sources that need an account are a job for a
person, recorded under *Human to-do*, never done by an agent. Non-US calls are a different
protocol family and are logged as leads for a separate study, not coded.

State every source's **distribution bias** next to any number it contributes to: none of these
is a shift's call mix.

## Status summary (2026-08-21)

| Stage | Count |
| --- | ---: |
| Validated medical case files | 52 (all `gary-allen`) |
| Target | ≥ 300 |
| Sources shipped | 1 |
| Requests filed / drafted awaiting filing | 2 / 3 |

## Shipped (case files exist)

### Gary Allen archive — *Dispatch Monthly* / 911dispatch.com

| | |
| --- | --- |
| Access route | Wayback Machine captures (2015) of the original `mp3.911dispatch.com` S3 host, linked from the metadata CSV in GitHub `n8maxey/911project` (metadata only — the repo's README claims to hold the MP3s; it does not). `replay-private/candidates.csv` holds the 94 medical rows. No account. |
| Public-record status | Recordings the archive's curator collected from public releases and news coverage 1993–2014 and shared, via his estate, as an educational resource. Already public; we add no new exposure. |
| Volume | 742 recordings in the archive; **94** tagged medical after filtering out violent incidents. |
| Medical share / yield | Of the 94: 3 not on Wayback (404), **91 downloaded and transcribed**. **52 coded**, 39 rejected — non-medical incident (fire, police, missing persons, aircraft, water rescue with no patient, two violent crimes the filter missed) 18; unusable audio (ringing, radio, beeps, unintelligible, news-clip fragments) 11; starts mid-call or a transfer gap 8; hold-recording only 1; non-civilian caller 1. The archive's real ceiling was **~52 coded calls**, at the low end of the 40–60 the design doc hoped for — many entries are news-clip fragments or radio. |
| Terms | Wayback/archive.org permit download for research; the archive was published for educational use. |
| Distribution bias | Curated for *critical or unusual* calls; skews 1993–2013 (pre-2010 CPR ratios appear); over-represents cardiac arrest, childbirth and child callers; several calls are on the list *because* something went wrong (transfer delays, refusals, wrong addresses). Not a shift's call mix. Dispatch-announcement timing in particular is biased by the selection. |
| Status | **Shipped, complete** (every codeable call coded; nothing more to get from it). Pipeline: `npm run replay:fetch` → `replay:transcribe` (whisper.cpp small.en, local) → agent coding → `replay:validate` → `replay:qa` review sheet. |

Mirrors of the same material, for completeness: **Kaggle** `louisteitelbaum/911-recordings` (needs an
account — human to-do only if Wayback keeps refusing specific ids); **Within the Trenches** was
reported to host the library but the site now carries only the podcast (404 on the library page,
2026-08-21).

## Pending — drafted, a person files them

The records-request lever. One granted month of 911 audio from a mid-size PSAP is thousands of calls — the only
route to 300 that does not depend on what someone else happened to publish. Drafts are in
`replay-private/requests/` (they carry the org's contact details); statute basis verified
2026-08-21. Retention windows are short (Phoenix 6 months, Dane 120 days, some Florida counties
60 days): file promptly, ask for the most recent complete month, ask for a fee estimate first, and
accept a ten-call sample if volume is refused.

| Agency | State basis | Why this one | Status |
| --- | --- | --- | --- |
| Cincinnati Emergency Communications Center (via CPD Records) | Ohio R.C. 149.43; *Cincinnati Enquirer v. Hamilton County*, 1996-Ohio-214 — 911 tapes are public records per se; *Enquirer v. Sage*, 2015; fees limited to copy cost | Strongest statute in the country; large urban PSAP with EMD | **filed 2026-08-21** (ref P491325-082126), **denied as compilation + voluminous** (Shaughnessy/Zidonis; the denial skipped the (B)(2) revision duty). Revised request pending: log ask withdrawn — Cincinnati publishes CAD calls-for-service and fire/EMS incident data on data.cincinnati-oh.gov daily — audio narrowed to a bounded 2-hour window, cap 50. Court of Claims 2743.75 is the backstop |
| Pinellas County 911 | Ch. 119 F.S.; §365.171(15) — caller name/address/phone excised, remainder public (AG opinions) | Florida's long public-records tradition; county runs its own EMD centre | drafted |
| Dane County Public Safety Communications | Wis. Stat. §§19.31–19.39; Marsy's Law redactions possible | Published request form and $15/recording fee schedule; 120-day retention | drafted |
| New Hanover County 911 | N.C. G.S. 132-1.4(c)(4) — call contents public; voice, name, address, phone altered/withheld | Statute explicitly covers 911 contents; portal-based requests. Voice alteration will degrade audio — transcripts still fine | drafted |
| Phoenix Fire Regional Dispatch Center | A.R.S. §39-121; §39-121.03 non-commercial statement (copying cost only) | EMD-running fire dispatch for ~26 jurisdictions; online portal; $16.50/CD (electronic requested instead). Fire + EMS calls only — police 911 audio sits with Phoenix PD | **filed 2026-08-21** (ref F058027-082126): all 911 audio for July 2026 + CAD log, weekly batches offered |

Considered and set aside: **Texas** — Gov't Code §552.157 makes any recording containing a
person's *final words* confidential and the §552.108 law-enforcement exception is discretionary,
so yield per request is lower; **Virginia** — discretionary withholding. **Colorado** (CORA; 911
audio public with personal information redacted, e.g. CRCA 911) is a good sixth target if one of
the five fails.

## Verified dead ends — do not re-litigate

- **HuggingFace `spikecodes/911-call-transcripts`** (518 rows, MIT) — role/content chat format,
  empty dataset card, no provenance. Reads as LLM-generated; even if some rows were scraped, there
  is no way to tell which. Synthetic text cannot be "what a dispatcher did". Never use as real.
- **GitHub `n8maxey/911project`** — metadata CSV and an R analysis only, despite its README; the
  audio links point at the dead 911dispatch.com host. Use the Wayback route above.
- **Within the Trenches audio library** — gone (404); the site is a podcast.
- **CourtListener / RECAP (automated)** — the opinion HTML is served behind a bot challenge
  (HTTP 202, empty body) and the REST API requires an account token. The *search* API does work
  anonymously and finds opinions quoting 911 exchanges (e.g. *Stefanski v. Saginaw County 911*,
  Mich. 2025; *Bartlett v. Valley Communications Center*, Wash. App. 2026; *Yong Shao Ma v. City &
  County of San Francisco*, Cal. App. 2002; *Allen v. District of Columbia*, D.C. 2014). Reading
  them needs a person with a free CourtListener token — see *Human to-do*. Expect excerpts, not
  full calls: opinions quote the disputed exchange.
- **archive.org "9/11 911 calls"** — the 2006 NYC release (thousands of calls, with transcripts)
  is a mass-casualty terror attack: callers trapped in burning towers, not EMD medical calls.
  Out of scope for this study; noted because it is the largest public 911 release in existence.
- **MuckRock** — completed requests are per-incident (one address, one hour), mostly police
  matters. A place to *file* a bulk request, not to find one already granted.
- **South Sound 911 (WA) public-records archive** — the page is a JavaScript download manager with
  no content in the HTML; could not determine what it holds without a browser session. Lead only.
- **Collier County Sheriff (FL) 911 audio page** — 403 to automated fetch; human could read it.

## Leads, in priority order

1. **Bulk releases in open-audio states.** Nothing bulk found hosted by an agency — releases are
   per-incident on request. The records request *is* the bulk release.
2. **Investigation / commission reports reproducing full 911 transcripts.** Searches returned
   mass-shooting commission reports (Parkland, Uvalde) and terror-attack reviews — not medical.
   A medical-dispatch failure review that prints the full call does exist in news coverage (e.g. a
   2022 Palo Alto dispatcher review; a 2013 NYC Department of Investigation report on an EMS response) but the reports themselves were
   not located in this round. Worth a targeted pass by a person with news-archive access.
3. **News-station pages hosting released audio** — they exist for notable calls (e.g. a 2026
   driver medical-emergency call) but each is one call, often edited. Last resort per the design;
   note platform terms per station before downloading.
4. **Non-US calls** — logged for a separate study: UK 999 and Australian 000 releases surface
   frequently in coronial findings; different protocol family (NHS Pathways / AMPDS).

## Human to-do

1. **File the five requests** in `replay-private/requests/` (and Colorado if one fails).
2. **CourtListener token** (free account) — then an agent can pull the opinions listed above
   through the API and screen them for full-call transcripts.
3. **Kaggle** — only if specific Gary Allen ids keep failing on Wayback.
4. **Review sheet** — `replay-private/review-sheet.csv` (10 % sample) needs a listener.
