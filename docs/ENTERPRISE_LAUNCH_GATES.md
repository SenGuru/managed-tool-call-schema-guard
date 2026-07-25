# Enterprise launch gates

Status date: 2026-07-24

## Current decision

**Public production: NO-GO.** The deterministic enforcement product and its
single-node managed runtime have strong local evidence. The repository is not a
complete self-serve enterprise SaaS yet. A green local test run must not be used
to imply hosted identity, payment settlement, high availability, disaster
recovery, or an operated security program.

## Verified in the exact production images

- Fresh PostgreSQL bootstrap and two-tenant bootstrap complete successfully.
- Exact-r5 public/shared bootstrap keeps the one-time administrator credential
  out of stdout and process arguments by using protected file input or a new
  mode-0600 output file.
- Tenant audit and usage data remain isolated through authenticated HTTP calls.
- Schema registration, reviewed promotion, enforced admission, exact validation,
  allowlisted repair, ambiguous-input rejection, contract compilation, policy,
  rulesets, conformance ingestion, intelligence, audit verification, retention,
  API-key issue/revocation, tenant lifecycle/export/deletion locking, and action
  controls execute through production containers.
- A high-risk action is not returned as allowed until a separately running
  checkpoint receiver acknowledges the exact signed checkpoint through trusted
  HTTPS.
- A deliberate receiver outage returns a bounded fail-closed `503`, preserves a
  duplicate-blocking reservation, recovers its transactional outbox after the
  receiver restarts, and requires explicit release or reconciliation.
- PostgreSQL, managed-service, and anchor-receiver restarts preserve integrity
  and recover readiness.
- Managed and anchor containers run non-root with read-only root filesystems,
  dropped capabilities, no-new-privileges, PID limits, file-mounted secrets,
  correlation IDs, and privacy-normalized structured access logs.
- The production images are pinned distroless Node 22 images. The current Trivy
  gate reports zero HIGH/CRITICAL vulnerabilities and zero embedded secrets.
- The current non-credentialed repository gate passes 191 tests with 16
  PostgreSQL-only tests skipped and four Python tests passed. The latest
  complete credentialed PostgreSQL suite passed 207/207 tests in 8.35 seconds;
  coverage was 79.63% statements, 73.72% branches, 80.98% functions, and 81.59%
  lines. Production-container E2E coverage is additional behavioral evidence
  and is not included in those source-instrumentation percentages.
- The corrected exact-r7 public workflow passes 64 HTTPS requests after its
  first run caught and blocked an internal alert `source_key_hash` in tenant
  export. The in-app browser executes every 29/29 workbench preset and loads
  every 14/14 read panel.
- Runtime integration gates execute MCP SDK, OpenAI Agents, PydanticAI, and
  Google ADK adapters. Repaired integer arguments reach real framework tool
  execution and rejected inputs execute zero tools. These gates do not call a
  model provider.

## Blocking gates before any public server

| Gate                                   | Current evidence                                                                                                                                                                                                                          | Required completion evidence                                                                                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Human identity and organization access | API keys and scopes exist; hosted users do not                                                                                                                                                                                            | OIDC-based signup/login, verified email, secure sessions, MFA policy, organization membership, role separation, invitation/recovery flows, CSRF/session tests, and enterprise SSO design                                       |
| Billing and entitlement authority      | Sandbox-only Checkout/Portal/provider-current reconciliation, signed raw-body parsing, durable replay state, and fail-closed entitlements pass deterministic and PostgreSQL tests; unconfigured deployment remains `integration_required` | Real Stripe test-account Checkout/Portal/test-clock E2E, tax/refund/credit/invoice policy, hosted-identity binding, exact-image public-TLS/browser proof, and retained redacted settlement evidence                            |
| Multi-instance availability            | Shared PostgreSQL state exists, but `SCHEMA_GUARD_INSTANCE_COUNT>1` deliberately fails                                                                                                                                                    | Remove remaining SQLite/local projection boundaries, separate migrations from app startup, run two or more instances, test concurrent traffic, rolling restart, instance loss, database failover, and no split-brain admission |
| Key custody and rotation               | Secrets can be injected from read-only files                                                                                                                                                                                              | Cloud KMS or equivalent envelope encryption, versioned key identifiers, staged rotation, rollback/recovery procedure, and rotation drills without losing tenant integrity                                                      |
| Backup and disaster recovery           | Fresh rotated-recipient backups decrypted/restored; checkpoints/chains and four restored deletion receipts matched; a pre-r3 encrypted ciphertext was verified off-machine; owner accepted daily RPO and attested escrow complete         | Prove clean-machine escrow retrieval, add operated failure paging and periodic drills, and use WAL/PITR before promising a tighter RPO                                                                                         |
| Production observability               | Structured request logs, trace correlation, health/readiness, delivery state, and protected Prometheus request/latency/timeout/dependency/dispatch/process metrics exist                                                                  | Add quota/outbox-age/dead-letter gauges, operated dashboards, SLOs, paging routes, synthetic probes, log retention/redaction review, and exercised alerts                                                                      |
| Internet edge                          | `api.akriven.com` has reviewed DNS/TLS, hardened proxy, trusted-proxy/CORS/body-limit tests, restricted ports, and real public E2E                                                                                                        | Observe certificate renewal, add independent uptime/paging, approve DDoS/rate strategy, and retain ongoing edge evidence                                                                                                       |
| Security assurance                     | Static lint/security rules, dependency audit, image scan, workflow audit, threat model, adversarial/property tests exist                                                                                                                  | Independent penetration test, OWASP ASVS verification record, dependency/license review, secret scan in protected CI, incident-response exercise, vulnerability disclosure process, and remediation SLA                        |
| Provider fleet evidence                | Deterministic fixtures and framework runtimes pass                                                                                                                                                                                        | Protected live OpenAI/Anthropic/Gemini probes with pinned model versions, scheduled execution, retained reports, drift alerts, and reviewed failures; no skipped provider is a passing result                                  |
| Release supply chain                   | Dependencies/images/actions are pinned and release audit is fail-closed                                                                                                                                                                   | Registry publishing decision, SBOM and provenance/attestation for the shipped digest, protected environment approval, rollback test, immutable release record, and verified consumer installation                              |
| Legal and support operations           | Private owner-only Sites version 15 serves reviewed terms/privacy/support/security pages and retains explicit pre-launch/no-checkout boundaries; customer-facing DNS was not changed                                                      | Legal review, DPA/subprocessor position, retention/deletion policy, security-contact ownership, support ownership, severity definitions, escalation, and status communication                                                  |
| Market evidence                        | Benchmarks and local failure interception exist                                                                                                                                                                                           | Design partners using real workflows, measured intercepted failures and debugging time, willingness-to-pay evidence, retention/usage evidence, and no representation of benchmark success as customer validation               |

## Required certification sequence

1. Complete hosted identity and run the implemented billing control plane
   through the external Stripe sandbox certification in
   [`BILLING_STRIPE_SANDBOX.md`](BILLING_STRIPE_SANDBOX.md).
2. Remove the single-instance guard only after every authoritative state path is
   shared and migration execution is independently controlled.
3. Stand up production-like staging with separate primary and anchor failure
   domains, encrypted managed PostgreSQL, KMS-backed secrets, monitoring, and
   backups.
4. Run destructive fault drills: instance loss, database restart/failover,
   receiver outage, delayed webhook, duplicate billing event, backup restore,
   key rotation, dependency compromise response, and rollback.
5. Pass the non-skippable release audit with PostgreSQL, Docker, coverage,
   framework runtimes, all live provider credentials/model versions, full
   production-image E2E, and image vulnerability/secret gates.
6. Complete an independent security review and close all launch-blocking
   findings.
7. Admit only a private design-partner environment first. A public launch
   requires stable operational evidence from that environment, not only local
   certification.

## Evidence commands

```bash
SCHEMA_GUARD_TEST_POSTGRES_URL=postgresql://... npm run test:coverage
npm run audit:framework-integrations
npm run audit:container-e2e
SCHEMA_GUARD_PUBLIC_E2E_BASE_URL=https://... \
  SCHEMA_GUARD_PUBLIC_E2E_API_KEY_FILE=/owner-only/path \
  SCHEMA_GUARD_PUBLIC_E2E_TENANT_ID=audit-... \
  npm run audit:public-managed
npm run audit:images
npm run audit:extreme
npm run audit:release-candidate -- --output release-candidate-report.json
npm run audit:commercial-release -- \
  --target private-beta \
  --source-revision 0123456789abcdef0123456789abcdef01234567 \
  --evidence-dir /owner-only/path/to/evidence \
  --output /owner-only/path/to/private-beta-verdict.json
```

The release-candidate command is intentionally non-skippable for the internal
and live-model boundary. It must fail when
PostgreSQL, Docker, a scanner, provider credentials, or pinned provider model
versions are absent. It reports `commercial_ready: false` even on success.
Commercial admission separately requires the fail-closed gate documented in
[`COMMERCIAL_RELEASE_GATE.md`](COMMERCIAL_RELEASE_GATE.md).
