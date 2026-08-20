# Source & License — us-nj-emd

This pack digitizes a subset of:

> **State of New Jersey Emergency Medical Dispatch Guidecards**
> Electronic edition, header "Updated May, 2026" (card footers Ver 01/16–02/16)
> Approved by the NJ Department of Health, Office of Emergency Medical Services
> Adopted by the NJ Office of Information Technology, Office of Emergency Telecommunications Services
> [nj.gov/911 download](https://www.nj.gov/911/documents/resource/EMD%20Guidecards%202022%20elec%20proj%20Ebola.pdf)

## License status: permission pending

The source PDF carries **no copyright notice or terms of use**, is published for free download,
and is state-mandated for New Jersey PSAPs — a strong posture under the government-edicts
doctrine (*Georgia v. Public.Resource.Org* (2020); *Veeck v. SBCCI*). However, state government
works are **not automatically public domain** (unlike U.S. federal works), so a written
permission request to NJ OETS is in flight — tracked at **AccesSOS/infra#8** — and this pack's
`provenance.license` is `state-published-permission-pending` until it resolves. This repository
is private; nothing is being distributed while the request is open. If permission is declined or
conditioned, this pack will be amended or removed before the repository becomes public.

## What was digitized

The **All Caller Interrogation** plus the **Chest Pain / Heart Problems**, **Cardiac Arrest /
DOA**, **Unconscious / Fainting**, and **Unknown / Person Down** (fallback) guidecards, keeping
New Jersey's own dispatch taxonomy: `SIMULTANEOUS_ALS_BLS`, `BLS_DISPATCH`, and
`FOLLOW_LOCAL_PROTOCOL` (confirmed hospice expected death). Substantive digitization decisions —
flattened cross-card jumps, the inexpressible over-35 age criterion (defaulted to the higher
tier, safety-first), editorial confirm/greeting wordings, and the three-way breathing question
(`yes` / `no` / `unsure`) — are recorded in the pack's `provenance.notes`.

## Operational warning

SIMULATION ONLY — for testing, research, and practice. Not certified for live emergency
call-taking. Real NJ PSAPs use the official cards under state oversight and medical direction.
