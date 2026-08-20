# Source & License — us-alameda-police

The corpus's first **police call-taking** pack, grounded on:

> **Alameda Police Department — Public Safety Dispatcher Training Manual** (revised March 26, 2020)
> Published by the City of Alameda, California
> [PDF on alamedaca.gov](https://www.alamedaca.gov/files/assets/public/v/1/departments/alameda/police/dispatch-training-manual-060820.pdf)

## License status: permission pending

A City of Alameda government work, published openly on the city's own website. Like state works,
municipal works are not automatically public domain, so this pack ships under
`city-published-permission-pending` (explicitly allowlisted in CI) while a written-permission
request to the City is open — same posture as the NJ pack (see the AccesSOS/infra tracker). The
repository is private; nothing is distributed while the request is open. If permission is
declined or conditioned, this pack will be amended or removed before the repository goes public.

## What is from the source

- The emergency-line procedure: "911, what is the emergency?", then What happened / **When**
  (in progress · just occurred · cold — the manual's own prioritization axis) / Where (verify;
  house or apartment) / Who (suspects described **top-down**: race, sex, age, hair, clothing) /
  **Weapons** ("never assume the answer").
- The always-ask questions: *Is the suspect there now?* / *weapon — what kind, who has it?* /
  *vehicle — description and plate*, including the burglary-in-progress driveway-vehicle question.
- The dispatch priorities, quoted: **PRIORITY 1** — immediate danger to life or property; all
  felonies in progress or just occurred (within 10 minutes). **PRIORITY 2** — serious trouble may
  exist, no immediate emergency (disturbance 415, suspicious person 912P, alarms). **PRIORITY 3**
  — cold reports, no danger to life or property. Injury accidents (901A) are among the codes
  "automatically a priority one". Fire/medical calls are screened and **transferred within 30
  seconds** — modeled as an immediate-transfer protocol (`TRANSFER_FIRE_EMS`).
- The domestic-violence questions: *Is this physical or verbal?* and *Can you speak freely?*
  (with the yes/no "code" fallback), and the keep-caller-on-line / reassure / caller-safety rules.

## Editorial

The manual is training prose, not a card set — question wordings are condensed from it, and
protocol groupings (burglary, robbery, DV, suspicious person, injury accident, unknown) follow
its problem-code examples. All condensations are reviewable against the cited pages
(42–44, 55–59, 176–178).

## Operational warning

SIMULATION ONLY — for testing, research, and practice. Not certified for live call-taking. Real
Alameda dispatchers operate under APD policy, CLETS/POST requirements, and supervision.
