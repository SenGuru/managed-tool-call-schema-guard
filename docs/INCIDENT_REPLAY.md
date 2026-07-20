# Incident capture and replay

Schema Guard can turn a concrete tool-call incident into a deterministic local
regression fixture. A fixture records the schema, raw arguments, policy/context,
expected decision, repair rule/path list, repaired-output hash, policy outcome,
and generalized validation-issue signatures.

## Privacy boundary

Replay needs the original values to reproduce parsing, coercion, enum, format,
and bound behavior. Every fixture therefore declares:

```json
{
  "classification": "local_sensitive",
  "contains_raw_argument_values": true,
  "safe_for_managed_upload": false
}
```

The CLI writes a new fixture with owner-only permissions and refuses to
overwrite an existing file. Keep fixtures in a customer-controlled private
repository or incident store. They are not compatibility-network telemetry.

## Capture and replay

```bash
schemaguard fixture \
  --tool create_ticket \
  --schema schema.json \
  --args incident-arguments.json \
  --policy policy.json \
  --out regressions/create-ticket-001.json

schemaguard replay --fixture regressions/create-ticket-001.json
```

`replay` accepts one fixture object or a JSON array of fixtures. It exits nonzero
when any decision, reason, repair, repaired-output hash, policy result, or
validation-issue signature changes. The report identifies exact mismatch
fields, making it suitable for CI. Replay reports contain expectation metadata
and hashes, not the raw request or accepted argument object; fixture creation
prints only a path/ID/privacy summary rather than echoing the fixture values.

## Integrity and limitations

`fixture_id` hashes the fixture version, request, and expectation. Edited or
stale content fails before validation runs. This is an accidental/stale-change
integrity check, not an author signature; repository review and signed commits
remain the trust mechanism for intentional baseline changes.

The current capture is exact, not automatically minimized. A future managed
workflow may propose redacted/minimized reproductions, but no minimized fixture
may be called replayable until it independently reproduces the same decision and
repair proof.
