# Commercial release gate

Status date: 2026-07-26

## Purpose and boundary

`npm run audit:release-candidate` proves the internal product and live-model
provider boundary. It deliberately does **not** prove that Akriven is
commercially launchable.

`npm run audit:commercial-release` is the separate fail-closed aggregation gate
for a private beta or public production release. It accepts only current,
redacted, owner-only, content-addressed evidence. Missing, stale,
configured-only, incomplete, altered, symlinked, or secret-bearing reports
fail. No report may convert a mock, dry run, documentation claim, or
unexercised provider configuration into proof.

## Commands

Create a fail-closed evidence skeleton under an already owner-only parent:

```bash
npm run audit:commercial-template -- \
  --target private-beta \
  --source-revision 0123456789abcdef0123456789abcdef01234567 \
  --output-dir /owner-only/path/to/new-evidence-directory
```

The generator refuses an existing destination or a group/other-accessible
parent. It creates every report with mode `0600`, `status: "unproven"`, all
checks `false`, and no artifacts. It never fabricates a passing report. Review
and replace each field only after the named behavior has been exercised and
the redacted artifact has been hashed.

```bash
npm run audit:commercial-release -- \
  --target private-beta \
  --source-revision 0123456789abcdef0123456789abcdef01234567 \
  --evidence-dir /owner-only/path/to/evidence \
  --output /owner-only/path/to/private-beta-verdict.json
```

```bash
npm run audit:commercial-release -- \
  --target public-production \
  --source-revision 0123456789abcdef0123456789abcdef01234567 \
  --evidence-dir /owner-only/path/to/evidence \
  --output /owner-only/path/to/public-production-verdict.json
```

The default maximum age is 30 days. Override it only with an explicit reviewed
policy:

```bash
--max-age-days 14
```

Exit code `0` means every required gate passed. Any missing or invalid evidence
returns exit code `1` and verdict `no_go`.

`--source-revision` must be the exact lowercase 40-character commit SHA being
certified. Every gate report must name that same revision. Evidence reviewed
for another build cannot pass.

## Evidence directory contract

The evidence directory, every gate report, and every referenced artifact must
be owner-only. Reports and artifacts must be regular files inside the canonical
evidence directory; symbolic links and path escapes are rejected.

Each `<gate-id>.json` report has this shape:

```json
{
  "report_version": "1",
  "gate_id": "identity",
  "source_revision": "0123456789abcdef0123456789abcdef01234567",
  "status": "proven",
  "redacted": true,
  "evidence_kind": "external_provider",
  "executed_at": "2026-07-26T12:00:00.000Z",
  "checks": {
    "callback_session": true,
    "mfa": true,
    "logout_revoke": true,
    "recovery": true,
    "tenant_isolation": true
  },
  "artifacts": [
    {
      "path": "identity/session-drill.redacted.json",
      "sha256": "sha256:<64 lowercase hexadecimal characters>"
    }
  ]
}
```

Allowed `evidence_kind` values are `deterministic_local`,
`production_like_network`, `external_provider`, and `manual_review`. The
evidence kind describes the boundary actually exercised; it does not change
the required checks.

Reports must contain no credential, authorization, password, cookie, API-key,
or token fields. `redacted: true` is an assertion, not a sanitizer: the
operator must redact artifacts before hashing them. Store actual credentials
only in the selected secret manager or owner-only secret file outside this
evidence tree.

## Private-beta gates

| Report                     | Required proven checks                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `internal.json`            | full regression, PostgreSQL, container E2E, SDK/CLI, security scans, migration rollback              |
| `website.json`             | private hosted site, route inventory, onboarding handoff                                             |
| `staging.json`             | TLS edge, separate anchor, outage recovery, backup/restore                                           |
| `identity.json`            | callback/session, MFA, logout/revoke, recovery, tenant isolation                                     |
| `human_email.json`         | mailbox ready, inbound, outbound, recovery                                                           |
| `transactional_email.json` | domain authentication, delivery, bounce, retry/dead-letter, privacy                                  |
| `operations.json`          | monitoring, delivered paging, restore drill, runbooks, named support owner, named incident owner     |
| `security.json`            | dependency, secret and image scans, authentication abuse, tenant isolation, protected secret custody |
| `model_providers.json`     | live pinned OpenAI, Anthropic and Gemini probes                                                      |
| `billing.json`             | one of the billing variants below                                                                    |

Private beta may use a documented `manual` billing variant only when manual
invoice policy, operator entitlement, cancellation policy, and absence of
automated charging are all proven. It may instead use the `stripe_test`
variant. Manual billing is not accepted for public production.

## Public-production additions

Public production additionally requires:

- SBOMs, provenance/attestation, and a verified consumer installation;
- public-domain TLS;
- database failover, rolling release, and multi-instance operation;
- invitation, revocation, and cross-organization isolation;
- delivery to an independent human-email recipient;
- DMARC observation and transactional-provider outage recovery;
- a second responder, sustained soak, incident drill, and operated status
  page;
- a key-rotation drill and independently recoverable credential escrow;
- `legal.json` proving reviewed terms, privacy, DPA, retention, and refund/tax
  positions;
- `independent_review.json` proving penetration testing, findings disposition,
  and remediation retest;
- `customer_integration.json` proving a customer-owned webhook, downstream
  side-effect ledger, and outage reconciliation;
- `market_validation.json` proving a design partner's real workflow,
  willingness to pay, and a retention/continued-use signal; and
- Stripe test-mode Checkout, Portal, signature, replay/reordering,
  failed-payment recovery, cancellation, entitlement reconciliation, and test
  clock evidence.

The gate never enables live billing, publishes DNS, changes site access, or
deploys code. Those remain separately approved operator actions.

## GitHub commercial certification

`.github/workflows/commercial-release.yml` is a manual, read-only certification
workflow. It:

1. checks out the exact workflow revision;
2. downloads one immutable evidence artifact from an explicitly selected run
   in this repository;
3. rejects an artifact-service digest mismatch;
4. restores owner-only permissions removed by artifact ZIP transport;
5. binds every report to `GITHUB_SHA`;
6. runs this gate; and
7. retains the verdict even when certification fails.

The existing release-candidate workflow is explicitly named
**Internal and live-provider release certification** and is not commercial
approval.

Repository-owner console setup is still required. Create the
`commercial-private-beta` and `commercial-public-production` GitHub
environments, restrict eligible branches, and configure required reviewers,
self-review prevention, and administrator-bypass prevention where the
repository plan supports them. [GitHub's environment documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
states that a job referencing an environment is held until its protection rules
pass, but required reviewers for private repositories depend on the account
plan. Until the protection settings are observed in a real run, the workflow is
implemented but its independent-approval property is **configured only**.

## Current observed verdict

The 2026-07-26 empty-evidence negative drill exited `1` and returned `no_go`
with all ten private-beta reports missing. This is the expected current
commercial result until provider and operator evidence is collected. The
internal release candidate and managed-load gates remain separate and cannot
override it.
