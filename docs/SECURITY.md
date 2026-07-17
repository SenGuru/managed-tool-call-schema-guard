# Security model

## Invariants

- No LLM or network call is made by the canonical enforcement engine.
- A repair must be registered, enabled, type-directed by the schema, recorded, and followed by full revalidation.
- Policies only narrow behavior.
- Unexpected failures return `rejected`.
- Audit envelopes contain hashes and argument paths, not values.
- The engine never executes the target tool.

## Sensitive data

Raw arguments remain in process memory because validation requires them and accepted responses return them to the caller. They are not written by core. CLI/API audit output writes only the minimized envelope. Debuggers, crash dumps, reverse proxies, shell history, and caller logs are outside that guarantee and must be configured separately.

SHA-256 fingerprints are correlation aids, not encryption. Low-entropy values may be guessable by brute force, so remote multi-tenant deployments should use tenant-scoped keyed hashes. The local MVP intentionally avoids pretending to provide that hosted control.

## Operational guidance

- Bind the sample server to loopback; place real authentication and TLS at a reviewed production boundary.
- Treat schemas as untrusted code-like configuration and cap request sizes/time.
- Keep target-tool credentials out of guard configuration.
- Use closed schemas for high-impact tools and deny sensitive argument paths where appropriate.
- Retain local audits only as long as necessary and protect file permissions/backups.
- Pin dependencies with `package-lock.json`; run the full check and dependency audit before releases.

## Managed local controls

The managed package stores no raw arguments. API keys are HMAC-derived, tenant queries are scoped, caller policy cannot widen organization policy, compatibility aggregates require a distinct-tenant threshold, audit history is chained and signed, and ruleset private keys are encrypted at rest. SQLite files, the master secret, backups, and host process memory remain sensitive assets.

Report vulnerabilities privately to the repository owner. Do not include live secrets or customer payloads in reports.
