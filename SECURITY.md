# Security Policy

## Reporting

Report vulnerabilities privately to **hello@accessos.io** (subject: `[open-dispatch-simulator]
security`). Please do not open public issues for security reports. We aim to acknowledge within
5 business days.

## Scope notes

- This repository is a **simulator**. It contains no live emergency infrastructure, no telephony
  credentials, and no connection to accesSOS production systems. Issues affecting the accesSOS
  app or services should also go to hello@accessos.io.
- Reports we especially care about: anything that could let a deployment be mistaken for a real
  emergency service, prompt/content injection paths through protocol packs, and supply-chain
  issues in dependencies.
- **Never include real emergency-call data in a report.** Reproduce with synthetic data only.
