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

## OWASP GenAI and agentic risks

| Risk area                                                                                      | Akriven control contribution                                                                                                                                                                                                            | Evidence                                                                                                         | Coverage                                                                                                             |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Improper output handling / tool misuse                                                         | Strict portable-JSON parsing, schema validation, bounded allowlisted repair, full revalidation, provider normalization, and reject-on-uncertainty before dispatch                                                                       | `packages/core`; adversarial, property, conformance, differential, SDK and managed tests                         | **Direct, bounded**                                                                                                  |
| Excessive agency                                                                               | Registered action descriptors, environment policy, risk and side-effect classification, separate approval authority, idempotency reservation, completion/release/reconciliation, and fail-closed independent checkpoint acknowledgement | `packages/core/src/action.ts`; managed action stores/routes; action, approval, race, anchor and recovery tests   | **Direct, bounded**                                                                                                  |
| Identity and privilege abuse                                                                   | Scoped API keys, constant-time verification, rotation/revocation, tenant isolation, separate evaluator/approver scopes and public-mode configuration checks                                                                             | Managed auth/store/shared-state tests and BOLA/IDOR cases                                                        | **Partial** — operator-created API-key identity only; human SSO, invitations, MFA and recovery are external blockers |
| Unbounded consumption / denial of service                                                      | Request body, JSON depth/node/string/array/object limits; validation timeouts; rate and quota enforcement; PostgreSQL pool bounds; request metrics                                                                                      | Resource-limit, malformed-input, rate-limit, quota, timeout and load tests                                       | **Partial** — sustained host soak and operated SLO evidence remain required                                          |
| Sensitive information disclosure                                                               | Value-free audit and intelligence envelopes, hashed tool identifiers, export allowlists, secret-file configuration, privacy-thresholded network evidence, privacy-safe metric labels and trace logs                                     | Privacy/adversarial/export tests; `packages/managed/src/evaluation-export.ts`; `packages/managed/src/metrics.ts` | **Direct for Akriven evidence paths** — not a prompt/output DLP system                                               |
| Supply-chain vulnerabilities                                                                   | Lockfiles, CI gates, package-boundary audit, SBOM/license/secret/dependency/container scanning scripts and pinned deployment inputs                                                                                                     | Repository workflows and audit scripts                                                                           | **Partial** — protected-CI execution, signed release provenance and independent review remain external gates         |
| Prompt injection / agent behavior hijacking                                                    | Akriven still validates the resulting proposed tool call and can block malformed, unapproved or replayed actions                                                                                                                        | Deterministic decision and action-gate suites                                                                    | **Complementary only** — Akriven does not classify prompts, retrieved content or model intent                        |
| Data/model poisoning, system-prompt leakage, vector weaknesses, misinformation and model theft | No primary control                                                                                                                                                                                                                      | Explicit product boundary                                                                                        | **Out of scope**                                                                                                     |

## NIST AI RMF and Generative AI Profile

| Function | Product contribution                                                                                                                                                                                              | Evidence boundary                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Govern   | Versioned organization/environment policy, action authority separation, signed rulesets, API-key lifecycle, retention and deletion controls                                                                       | Technical controls are implemented; accountable human roles, legal approval, risk acceptance and incident ownership remain organizational                                                                                              |
| Map      | Registered-and-observed inventory presents schemas/releases, environments, separately domain-hashed action profiles, providers and frameworks without returning tool names or tenant identifiers                  | `GET /v1/inventory`, SDK/CLI/dashboard coverage; schema and action fingerprints are intentionally not correlated, and this is not automatic discovery                                                                                  |
| Measure  | Deterministic outcomes, conformance runs, compatibility matrix, schema drift/quality, privacy-thresholded failure clusters, latency/request/dependency metrics and content-addressed value-free evaluation export | Synthetic and local/container evidence is proven; a maintained production corpus and external evaluation-tool import are not yet proven                                                                                                |
| Manage   | Fail-closed admission, approvals, idempotency, independent checkpoint acknowledgement, durable alert/webhook queues, dead-letter/redrive, reconciliation, audit chains, retention anchors and recovery procedures | Provider-independent behavior and a one-host independent-TLS container boundary are exercised; exact-source separate-host deployment, real paging, clean-host off-machine restore, and customer incident drills remain blocked/pending |

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
