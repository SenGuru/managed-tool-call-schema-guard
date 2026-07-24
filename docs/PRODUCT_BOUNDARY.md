# Product and license boundary

## Decision

Akriven has one deterministic open-source enforcement product and one paid
managed operations product. The boundary is architectural, commercial, and
machine-checked; it is not a marketing distinction layered over one coupled
runtime.

## Open-source enforcement

The MIT-licensed layer is the code a team needs to stop malformed tool calls
without an Akriven account or network dependency:

- the versioned request/decision protocol;
- JSON Schema validation and explicit, proof-carrying repairs;
- local narrowing policy, action gate, and incident replay;
- provider/framework normalization and contract compilation;
- local drift comparison and value-free audit envelopes;
- the CLI, local API, TypeScript SDK, and thin Python client;
- public conformance fixtures and examples.

Its authoritative paths are listed under `open_source` in
[`product-boundary.json`](../product-boundary.json). Public workspaces may
depend only on other public workspaces and third-party packages. They may not
import managed, shared-state, billing, tenant, or anchor code.

## Paid managed product

The proprietary layer starts where a team needs durable shared authority and
operations:

- tenant and API-key lifecycle, scopes, quotas, and entitlements;
- PostgreSQL-backed organization policy and environment admission;
- schema registry, reviewed promotions, and release-chain verification;
- durable audit, alert, webhook, approval, idempotency, reconciliation, and
  independent checkpoint-anchor workflows;
- privacy-thresholded cross-tenant compatibility intelligence;
- tenant export/deletion, retention operations, billing authority, dashboard,
  deployment, backup, monitoring, and operator tooling.

Its authoritative paths are listed under `paid_managed` in
`product-boundary.json`. These workspaces are `private: true`, are excluded
from public package dry runs, and may depend on the open core.

## Private-beta offer

The private beta is operator-onboarded managed service plus the independently
usable OSS checkpoint. It does not include public signup, self-service
organization creation, live payment collection, or a claim that external
email, paging, KMS, identity, or model-provider integrations are proven.
Those boundaries must fail closed or be recorded as blocked until exercised
with the actual provider in its sandbox or production-appropriate mode.

## Enforcement

`npm run check:packages` validates the machine-readable boundary, including:

1. exact public/private workspace membership;
2. `private: true` on every paid-managed workspace;
3. MIT metadata and distributable license files on public workspaces;
4. no dependency from a public workspace to a paid-managed workspace;
5. no managed package import or relative managed-path reference in public
   source roots;
6. complete public npm package contents.

The root workspace is private and `UNLICENSED` because it assembles both
license domains. Earlier revisions remain governed by the license shipped
with those revisions; the scoped notice does not revoke previously granted
rights.
