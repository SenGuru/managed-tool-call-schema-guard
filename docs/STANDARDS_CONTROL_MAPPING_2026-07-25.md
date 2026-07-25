# Akriven standards and control mapping

**Date:** 2026-07-25
**Status:** implementation mapping, not certification or legal assurance

This document maps observed product controls to current security and AI
risk-management guidance. A mapping means that a control can contribute evidence
to a risk-management program. It does **not** mean that Akriven, a customer
deployment, or the surrounding agent system is compliant with or certified
against the referenced standard.

Primary references:

- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/)
- [OWASP Top 10 for Agentic Applications announcement](https://genai.owasp.org/2025/12/09/owasp-genai-security-project-releases-top-10-risks-and-mitigations-for-agentic-ai-security/)
- [OWASP Application Security Verification Standard 5.0](https://owasp.org/www-project-application-security-verification-standard/)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [NIST AI 600-1 Generative AI Profile](https://doi.org/10.6028/NIST.AI.600-1)
- [NIST NCCoE draft concept paper on Software and AI Agent Identity and Authorization](https://www.nccoe.nist.gov/sites/default/files/2026-02/accelerating-the-adoption-of-software-and-ai-agent-identity-and-authorization-concept-paper.pdf)
- [Five Eyes guidance: Careful adoption of agentic AI services](https://media.defense.gov/2026/Apr/30/2003922823/-1/-1/0/CAREFUL%20ADOPTION%20OF%20AGENTIC%20AI%20SERVICES_FINAL.PDF)

## OWASP GenAI and agentic risks

| Risk area                                                                                      | Akriven control contribution                                                                                                                                                                                                                       | Evidence                                                                                                         | Coverage                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Improper output handling / tool misuse                                                         | Strict portable-JSON parsing, schema validation, bounded allowlisted repair, full revalidation, provider normalization, and reject-on-uncertainty before dispatch                                                                                  | `packages/core`; adversarial, property, conformance, differential, SDK and managed tests                         | **Direct, bounded**                                                                                                                                                                                               |
| Excessive agency                                                                               | Registered action descriptors, environment policy, risk and side-effect classification, separate approval authority, idempotency reservation, completion/release/reconciliation, and fail-closed independent checkpoint acknowledgement            | `packages/core/src/action.ts`; managed action stores/routes; action, approval, race, anchor and recovery tests   | **Direct, bounded**                                                                                                                                                                                               |
| Identity and privilege abuse                                                                   | Scoped API keys, constant-time verification, rotation/revocation, tenant isolation, privacy-safe human principals, organization-to-tenant binding, role-derived scopes, separate evaluator/approver authority and public-mode configuration checks | Managed auth/store/shared-state tests, identity contract tests and BOLA/IDOR cases                               | **Partial** — WorkOS staging is configured and email verified, but the live MFA/session/recovery/invitation boundary is not yet certified; agent identity lifecycle and delegated-token exchange are integrations |
| Unbounded consumption / denial of service                                                      | Request body, JSON depth/node/string/array/object limits; validation timeouts; rate and quota enforcement; PostgreSQL pool bounds; request metrics                                                                                                 | Resource-limit, malformed-input, rate-limit, quota, timeout and load tests                                       | **Partial** — sustained host soak and operated SLO evidence remain required                                                                                                                                       |
| Sensitive information disclosure                                                               | Value-free audit and intelligence envelopes, hashed tool identifiers, export allowlists, secret-file configuration, privacy-thresholded network evidence, privacy-safe metric labels and trace logs                                                | Privacy/adversarial/export tests; `packages/managed/src/evaluation-export.ts`; `packages/managed/src/metrics.ts` | **Direct for Akriven evidence paths** — not a prompt/output DLP system                                                                                                                                            |
| Supply-chain vulnerabilities                                                                   | Lockfiles, CI gates, package-boundary audit, SBOM/license/secret/dependency/container scanning scripts and pinned deployment inputs                                                                                                                | Repository workflows and audit scripts                                                                           | **Partial** — protected-CI execution, signed release provenance and independent review remain external gates                                                                                                      |
| Prompt injection / agent behavior hijacking                                                    | Akriven still validates the resulting proposed tool call and can block malformed, unapproved or replayed actions                                                                                                                                   | Deterministic decision and action-gate suites                                                                    | **Complementary only** — Akriven does not classify prompts, retrieved content or model intent                                                                                                                     |
| Data/model poisoning, system-prompt leakage, vector weaknesses, misinformation and model theft | No primary control                                                                                                                                                                                                                                 | Explicit product boundary                                                                                        | **Out of scope**                                                                                                                                                                                                  |

## NIST AI RMF and Generative AI Profile

| Function | Product contribution                                                                                                                                                                                              | Evidence boundary                                                                                                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Govern   | Versioned organization/environment policy, action authority separation, signed rulesets, API-key lifecycle, retention and deletion controls                                                                       | Technical controls are implemented; accountable human roles, legal approval, risk acceptance and incident ownership remain organizational                                                                                     |
| Map      | Registered-and-observed inventory presents schemas/releases, environments, separately domain-hashed action profiles, providers and frameworks without returning tool names or tenant identifiers                  | `GET /v1/inventory`, SDK/CLI/dashboard coverage; schema and action fingerprints are intentionally not correlated, and this is not automatic discovery                                                                         |
| Measure  | Deterministic outcomes, conformance runs, compatibility matrix, schema drift/quality, privacy-thresholded failure clusters, latency/request/dependency metrics and content-addressed value-free evaluation export | Synthetic and local/container evidence is proven; a maintained production corpus and external evaluation-tool import are not yet proven                                                                                       |
| Manage   | Fail-closed admission, approvals, idempotency, independent checkpoint acknowledgement, durable alert/webhook queues, dead-letter/redrive, reconciliation, audit chains, retention anchors and recovery procedures | Exact DreamHost/DigitalOcean deployment, separate-host outage/redrive/restart, rollback, encrypted off-machine clean restore and checkpoint comparison are exercised; real paging and customer incident drills remain blocked |

## 2026 agent identity and deployment guidance

The February 2026 NIST NCCoE document is a draft concept paper seeking input,
not a finalized control standard. It nevertheless identifies the identity
questions an enterprise buyer is likely to ask: distinguish human and agent
identities, authenticate workloads, apply least privilege, prove authority for a
specific action, represent “on behalf of” delegation, bind human approval, and
retain tamper-verifiable action evidence.

The April 2026 Five Eyes guidance recommends approved tool/version registries,
tool-use logging, trigger-action permission restriction, separation of duties,
time-bounded delegation, risk-based consensus/human approval, recorded grant
chains, incident exercises, centralized per-action policy decisions and
progressive autonomy.

| Guidance area                               | Current Akriven evidence                                                                                                                                                                                                                     | Honest disposition                                                                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Known agent/workload at the action boundary | An optional bounded workload identity is tenant-keyed with HMAC, never retained in plaintext, and is bound into approval and execution fingerprints. Human dashboard sessions derive a separate privacy-safe principal from WorkOS identity. | **Partial** — this proves stable local binding, not enterprise workload attestation, lifecycle management or a human-to-agent delegation chain.                                                                              |
| Specific-action authority                   | Schema-release admission, organization/environment policy, action descriptor, approval challenge, idempotency reservation, exact checkpoint acknowledgement and completion/reconciliation form one fail-closed protocol.                     | **Direct, bounded** for the integrated action. It does not mint downstream resource credentials or prove that a separate target system enforced least privilege.                                                             |
| Separation of duties and approval           | Human roles derive server-side scopes; evaluator and approver authority are distinct; approvals bind exact normalized evidence and expire; revoked or altered approvals fail closed.                                                         | **Direct, bounded** for one human approval. Multi-agent consensus and recorded multi-hop delegation are not implemented and should be required only when a selected customer architecture actually delegates between agents. |
| Tool/version registry                       | Registered schemas, reviewed releases, environment admission and registry-derived inventory are implemented; drift and unsupported provider constraints remain visible.                                                                      | **Direct for registered integrations**, not automatic discovery, vulnerability reputation or third-party component attestation.                                                                                              |
| Tamper-verifiable accountability            | Signed audit/control/release/reconciliation chains, independent exact-revision checkpoint acknowledgement, purge receipts and privacy-safe exports are implemented and exercised through separate-host outage and clean restore.             | **Direct for Akriven evidence**. It is not full reasoning/provenance capture and cannot establish non-repudiation for data or actions that bypass Akriven.                                                                   |
| Progressive autonomy and incident response  | Schema observe/enforce modes, policy shadow comparison, tenant emergency hold, fail-closed dependency behavior, rollback, reconciliation, alert queues and outage/recovery drills are implemented.                                           | **Partial operational proof** — owner alert delivery was exercised, while a customer incident, second responder, delegated-agent compromise and customer-authored autonomy-expansion criteria remain external evidence.      |

## OWASP ASVS 5.0 disposition

ASVS is a web-application verification standard, not an AI-agent product
certification. The repository has technical evidence relevant to authentication,
access control, validation, cryptography, logging, data protection, API security,
configuration and malicious-input handling. It does not yet have a completed,
independently reviewed ASVS 5.0 requirement-by-requirement verification record.
That record remains a release gate rather than a marketing claim.

## Explicit non-claims

- This mapping is not an OWASP or NIST endorsement.
- It is not a penetration test, SOC 2 report, ISO 27001 certification, DPIA or
  legal opinion.
- Akriven is not a prompt-injection firewall, content-safety filter, PII/DLP
  gateway, model monitor, full tracing platform, red-team platform, cloud asset
  scanner or autonomous remediation system.
- The value-free evaluation export is a stable Akriven interchange boundary. A
  native import into LangSmith, Langfuse, Braintrust, Phoenix or another external
  provider remains unproven until that provider is selected and exercised.
