# Threat model

## Assets and attackers

Assets include tool-call integrity, policy configuration, schemas, arguments, audit correlation data, and downstream tool authority. Attackers may control model output, tool arguments, some schemas, a framework adapter payload, or network input to a hosted wrapper.

## Principal threats and controls

- **Coercion smuggling:** ambiguous strings exploit permissive conversion. Controls: anchored lexical rules, exact decimal round trips, safe-integer bounds, finite-number checks, leading-zero/negative-zero rejection, explicit boolean case, revalidation, and property tests.
- **Semantic invention:** a repair supplies missing intent. Control: no defaults, aliases, fuzzy matching, enum choice, trimming, splitting, or arbitrary parsing.
- **Schema evasion:** invalid or exotic schemas disable validation. Controls: strict Draft 2020-12 compilation, conservative regular-expression screening, and fail-closed rejection.
- **Unknown-field injection:** payload adds privileged fields. Control: schemas may set `additionalProperties: false`; policy may require it.
- **Policy bypass:** caller weakens policy. Control: managed mode binds policy after authentication and merges it monotonically; caller input can only narrow.
- **Payload disclosure:** audits/logs retain secrets. Controls: value-free envelope, loopback API, `no-store`, opt-in file sink. Remaining risk exists in caller/proxy/crash logs.
- **Hash inference:** low-entropy values are guessed. Control for production: tenant-keyed hashes; local MVP documents the residual risk.
- **Resource exhaustion:** huge/deep schemas, slow request bodies, or pathological regexes consume CPU/memory. Controls: 1 MB HTTP body cap, 10,000-node and 64-level JSON safety budgets, regex screening, and side-effect-free timeout handling for incomplete managed requests. Worker/process isolation is still required before hostile public exposure.
- **Adapter drift:** framework output shape silently changes. Controls: explicit adapter errors, source fingerprints, version context, fixtures, compatibility tests.
- **Audit forgery:** database rows are edited. Control: tenant-specific chained HMAC signatures, signed-envelope/index-column consistency checks, and retained-prefix anchors detect modification. A host attacker with both database write access and the master secret can still forge history.
- **Ruleset key substitution:** a database attacker replaces a signed body and its embedded public key. Control: verify the key ID/public key against a master-secret-authenticated local trust record and reject expired rulesets. A host attacker with the master secret remains authoritative.
- **Downstream harm despite valid schema:** structurally valid call is dangerous. Control: out of scope; require authorization, confirmations, least privilege, and business policy after the guard.

## Residual risks before production

Managed local mode adds authentication, tenant isolation, keyed identifiers, signed audits, retention, rate limits, encrypted ruleset keys, and schema complexity bounds. TLS termination, public ingress hardening, cloud KMS, multi-process distributed limits, worker isolation, independent security review, and disaster recovery across failure domains remain before public production exposure.
