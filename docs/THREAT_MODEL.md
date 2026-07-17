# Threat model

## Assets and attackers

Assets include tool-call integrity, policy configuration, schemas, arguments, audit correlation data, and downstream tool authority. Attackers may control model output, tool arguments, some schemas, a framework adapter payload, or network input to a hosted wrapper.

## Principal threats and controls

- **Coercion smuggling:** ambiguous strings exploit permissive conversion. Controls: anchored lexical rules, finite-number checks, leading-zero rejection, explicit boolean case, revalidation, property tests.
- **Semantic invention:** a repair supplies missing intent. Control: no defaults, aliases, fuzzy matching, enum choice, trimming, splitting, or arbitrary parsing.
- **Schema evasion:** invalid or exotic schemas disable validation. Controls: strict Draft 2020-12 compilation and fail-closed rejection.
- **Unknown-field injection:** payload adds privileged fields. Control: schemas may set `additionalProperties: false`; policy may require it.
- **Policy bypass:** caller weakens policy. Control: managed mode binds policy after authentication and merges it monotonically; caller input can only narrow.
- **Payload disclosure:** audits/logs retain secrets. Controls: value-free envelope, loopback API, `no-store`, opt-in file sink. Remaining risk exists in caller/proxy/crash logs.
- **Hash inference:** low-entropy values are guessed. Control for production: tenant-keyed hashes; local MVP documents the residual risk.
- **Resource exhaustion:** huge/deep schemas or inputs consume CPU/memory. Control: API 1 MB body cap. Depth/time isolation is required before hostile public exposure.
- **Adapter drift:** framework output shape silently changes. Controls: explicit adapter errors, source fingerprints, version context, fixtures, compatibility tests.
- **Audit forgery:** database rows are edited. Control: tenant-specific chained HMAC signatures and retained-prefix anchors detect modification. A host attacker with both database write access and the master secret can still forge history.
- **Downstream harm despite valid schema:** structurally valid call is dangerous. Control: out of scope; require authorization, confirmations, least privilege, and business policy after the guard.

## Residual risks before production

Managed local mode adds authentication, tenant isolation, keyed identifiers, signed audits, retention, rate limits, and encrypted ruleset keys. TLS termination, public ingress hardening, cloud KMS, multi-process distributed limits, schema complexity isolation, independent security review, and disaster recovery across failure domains remain before public production exposure.
