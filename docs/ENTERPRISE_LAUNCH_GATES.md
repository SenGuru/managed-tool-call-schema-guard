# Enterprise launch gates

Status date: 2026-07-21

## Current decision

**Public deployment: NO-GO.** The deterministic enforcement product and its
single-node managed runtime have strong local evidence. The repository is not a
complete self-serve enterprise SaaS yet. A green local test run must not be used
to imply hosted identity, payment settlement, high availability, disaster
recovery, or an operated security program.

## Verified in the exact production images

- Fresh PostgreSQL bootstrap and two-tenant bootstrap complete successfully.
- Tenant audit and usage data remain isolated through authenticated HTTP calls.
- Schema registration, reviewed promotion, enforced admission, exact validation,
  allowlisted repair, ambiguous-input rejection, contract compilation, policy,
  rulesets, conformance ingestion, intelligence, audit verification, retention,
  API-key issue/revocation, and action controls execute through production
  containers.
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
- The complete credentialed PostgreSQL test suite passes 184 tests. Coverage
  gates currently pass at 79.34% statements, 73.07% branches, 78.99% functions,
  and 81.38% lines. Production-container E2E coverage is additional behavioral
  evidence and is not included in those source-instrumentation percentages.
- Runtime integration gates execute MCP SDK, OpenAI Agents, PydanticAI, and
  Google ADK adapters. Repaired integer arguments reach real framework tool
  execution and rejected inputs execute zero tools. These gates do not call a
  model provider.

## Blocking gates before any public server

| Gate                                   | Current evidence                                                                                                         | Required completion evidence                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Human identity and organization access | API keys and scopes exist; hosted users do not                                                                           | OIDC-based signup/login, verified email, secure sessions, MFA policy, organization membership, role separation, invitation/recovery flows, CSRF/session tests, and enterprise SSO design                                       |
| Billing and entitlement authority      | Usage statements exist; payment processing is explicitly `integration_required`                                          | Hosted checkout, customer portal, raw-body webhook signature verification, event replay/idempotency, subscription-state reconciliation, refunds/cancellations, tax decision, and E2E test-mode settlement                      |
| Multi-instance availability            | Shared PostgreSQL state exists, but `SCHEMA_GUARD_INSTANCE_COUNT>1` deliberately fails                                   | Remove remaining SQLite/local projection boundaries, separate migrations from app startup, run two or more instances, test concurrent traffic, rolling restart, instance loss, database failover, and no split-brain admission |
| Key custody and rotation               | Secrets can be injected from read-only files                                                                             | Cloud KMS or equivalent envelope encryption, versioned key identifiers, staged rotation, rollback/recovery procedure, and rotation drills without losing tenant integrity                                                      |
| Backup and disaster recovery           | Self-contained SQLite restore drill and process/database restart tests pass                                              | Automated encrypted off-machine PostgreSQL and anchor backups, point-in-time recovery, independent failure domains, measured RPO/RTO, destructive restore drill, and checkpoint comparison before action traffic resumes       |
| Production observability               | Structured request logs, health/readiness, delivery state exist                                                          | Metrics for latency/errors/quotas/outbox age/dead letters, dashboards, SLOs, paging routes, synthetic probes, log retention/redaction review, and exercised alerts                                                             |
| Internet edge                          | Public-mode configuration fails closed                                                                                   | Reviewed DNS/TLS, reverse proxy/WAF limits, trusted-proxy tests, DDoS/rate strategy, body/header limits at the edge, certificate renewal, and external uptime checks                                                           |
| Security assurance                     | Static lint/security rules, dependency audit, image scan, workflow audit, threat model, adversarial/property tests exist | Independent penetration test, OWASP ASVS verification record, dependency/license review, secret scan in protected CI, incident-response exercise, vulnerability disclosure process, and remediation SLA                        |
| Provider fleet evidence                | Deterministic fixtures and framework runtimes pass                                                                       | Protected live OpenAI/Anthropic/Gemini probes with pinned model versions, scheduled execution, retained reports, drift alerts, and reviewed failures; no skipped provider is a passing result                                  |
| Release supply chain                   | Dependencies/images/actions are pinned and release audit is fail-closed                                                  | Registry publishing decision, SBOM and provenance/attestation for the shipped digest, protected environment approval, rollback test, immutable release record, and verified consumer installation                              |
| Legal and support operations           | Documentation/runbooks exist                                                                                             | Terms, privacy notice, DPA position, subprocessors, retention/deletion policy, security contact, support channel, severity definitions, escalation ownership, and status communication                                         |
| Market evidence                        | Benchmarks and local failure interception exist                                                                          | Design partners using real workflows, measured intercepted failures and debugging time, willingness-to-pay evidence, retention/usage evidence, and no representation of benchmark success as customer validation               |

## Required certification sequence

1. Complete the hosted identity and billing control planes in a test environment.
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
npm run audit:images
npm run audit:extreme
npm run audit:release-candidate -- --output release-candidate-report.json
```

The release-candidate command is intentionally non-skippable. It must fail when
PostgreSQL, Docker, a scanner, provider credentials, or pinned provider model
versions are absent.
