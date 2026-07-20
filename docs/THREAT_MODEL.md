# Threat model

## Assets and attackers

Assets include tool-call integrity, policy configuration, schemas, arguments, audit correlation data, and downstream tool authority. Attackers may control model output, tool arguments, some schemas, a framework adapter payload, or network input to a hosted wrapper.

## Principal threats and controls

- **Coercion smuggling:** ambiguous strings exploit permissive conversion. Controls: anchored lexical rules, exact decimal round trips, safe-integer bounds, finite-number checks, leading-zero/negative-zero rejection, explicit boolean case, revalidation, and property tests.
- **Parser disagreement:** duplicate object members, escaped-equivalent names, accessors, sparse arrays, symbol keys, non-plain objects, or ill-formed Unicode produce runtime-dependent arguments. Controls: bounded pre-parse JSON scanning, per-object decoded-key uniqueness, and strict portable-JSON object inspection before schema evaluation.
- **Semantic invention:** a repair supplies missing intent. Control: no defaults, aliases, fuzzy matching, enum choice, trimming, splitting, or arbitrary parsing.
- **Schema evasion:** invalid or exotic schemas disable validation. Controls: strict Draft 2020-12 compilation, conservative regular-expression screening, and fail-closed rejection.
- **Unknown-field injection:** payload adds privileged fields. Control: schemas may set `additionalProperties: false`; policy may require it.
- **Policy bypass:** caller weakens policy. Control: managed mode binds policy after authentication and merges it monotonically; caller input can only narrow.
- **Payload disclosure:** audits/logs retain secrets. Controls: value-free envelope, loopback API, `no-store`, opt-in file sink. Remaining risk exists in caller/proxy/crash logs.
- **Hash inference:** low-entropy values are guessed. Control for production: tenant-keyed hashes; local MVP documents the residual risk.
- **Resource exhaustion:** huge/deep schemas, slow request bodies, or pathological regexes consume CPU/memory. Controls: 1 MB HTTP body cap, 10,000-node and 64-level JSON safety budgets, regex screening, and side-effect-free timeout handling for incomplete managed requests. Worker/process isolation is still required before hostile public exposure.
- **Adapter drift:** framework output shape silently changes. Controls: explicit adapter errors, source fingerprints, version context, fixtures, compatibility tests.
- **Provider contract mismatch:** a canonical schema is silently weakened to fit a provider declaration. Controls: versioned compiler profiles, explicit compatibility statuses, only hash-recorded lossless transforms, policy labels for semantic transforms, and no declaration for unsupported constraints. Residual risk: documentation can differ from model/version runtime behavior, so unprobed profiles remain `runtime_unverified`.
- **Regression recurrence:** a fixed incident reappears after an engine, ruleset, schema, or provider change. Controls: integrity-checked local incident fixtures and exact replay-suite comparisons. Residual risk: fixtures contain original values and require customer-controlled storage.
- **Repair-proof tampering:** a caller edits repaired arguments or provenance before execution. Controls: receipts bind ruleset, rule, schema fragment, input/output hashes, ambiguity checks, and post-validation results; the action gate verifies receipt hashes before allowing execution.
- **Approval replay or substitution:** approval for one mutation is applied to another. Controls: HMAC evidence binds exact post-repair arguments, tool, risk, side effect, environment, validation policy, repair receipts, and expiry.
- **Duplicate mutation:** retries execute a side effect twice. Controls: action
  policy requires an idempotency key/ledger for side effects and blocks
  duplicate/conflicting reservations. The managed SQLite ledger persists
  tenant-scoped reservations across restart and retains them if completion
  becomes uncertain. An authenticated monotonic manifest detects reservation
  deletion at restart and after out-of-band commits before the next action.
  Value-free checkpoints can be retained outside SQLite to reveal whole-database
  rollback; a transactional signed outbox automatically delivers each revision
  when an independent receiver is configured. Aged uncertain reservations require separately scoped,
  evidence-backed reconciliation with an authenticated history. Residual risk:
  multi-instance production requires shared transactional storage and an
  independently operated receiver. The managed HTTP action route withholds an
  allowed reservation until the exact checkpoint is acknowledged; an outage
  returns `503` and retains the pending reservation. An incorrect operator claim that an action
  did not execute can still permit duplication.
- **Audit forgery:** database rows are edited. Control: tenant-specific chained HMAC signatures, signed-envelope/index-column consistency checks, and retained-prefix anchors detect modification. A host attacker with both database write access and the master secret can still forge history.
- **Control-plane substitution:** a database writer widens an API-key scope,
  weakens tenant/environment policy, changes schema-enforcement mode, or
  downgrades action risk, revives an approval, edits an idempotency reservation,
  re-enables a webhook, or substitutes a queued payload. Controls:
  master-secret HMACs bind each security-relevant row and immutable delivery
  payload; authentication and enforcement verify records before use; startup
  and the tenant-scoped admin endpoint perform deep scans; readiness repeatedly
  scans bounded live configuration. Migration backfill occurs only in the
  migration transaction, so a later null value fails closed. Idempotency-set
  count/accumulator manifests additionally expose row deletion. Residual risk:
  whole-database rollback to an older valid manifest requires comparison with an
  externally retained checkpoint; a repository-local checkpoint cannot prove its
  own freshness.
- **Ruleset key substitution:** a database attacker replaces a signed body and its embedded public key. Control: verify the key ID/public key against a master-secret-authenticated local trust record and reject expired rulesets. A host attacker with the master secret remains authoritative.
- **Downstream harm despite valid schema:** structurally valid call is dangerous. Controls: optional risk classification, environment limits, exact approval binding, and idempotency gating. Residual risk: Schema Guard is not the target system's identity/authorization or fraud/business-policy engine; those controls remain mandatory.
- **Webhook SSRF:** a tenant tries to reach internal services through an alert
  destination. Controls: HTTPS/443 registration, no literal/local hosts, public
  IPv4 DNS filtering, address pinning for TLS, and no redirects. Residual risk:
  deployments still need restrictive egress policy and DNS monitoring.
- **Webhook credential disclosure:** stored endpoint tokens or signing secrets
  leak. Controls: purpose- and record-bound AES-256-GCM sealing; list APIs expose
  only a label and endpoint HMAC. A master-secret or process-memory compromise
  still exposes the material.
- **Receiver outage:** operational alerts are missed. Controls: transactional
  outbox, delivery leases, bounded retry, dead-letter visibility, and explicit
  redrive. A separate monitor must page on dead-letter growth.
- **Schema substitution after review:** an agent or compromised integration
  presents a different schema than the one reviewed for production. Controls:
  exact hash admission, registry-row binding, append-only HMAC release history,
  source-body rehashing, separately scoped promotion, and protocol-level
  rejection without executable arguments. A privileged promoter can still
  authorize a harmful schema, so code review and downstream authorization remain
  necessary.

## Residual risks before production

Managed local mode adds authentication, tenant isolation, keyed identifiers,
authenticated core control rows, signed audits, retention, rate limits,
encrypted ruleset keys, and schema complexity bounds. TLS termination, public
ingress hardening, cloud KMS, a deployed independent anchor receiver, shared
multi-process persistence and limits, worker isolation, independent
security review, and disaster recovery across failure domains remain before
public production exposure.
