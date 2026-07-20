# Managed alert webhooks

The managed service has a durable, tenant-scoped HTTPS webhook outbox for
privacy-safe operational alerts. This is a generic webhook integration, not a
native Slack, Teams, PagerDuty, or email connector.

## Register and retain the secret

Use a key with `manage:webhooks`. The endpoint must be public HTTPS on port 443.
The service returns the signing secret once; store it in the receiver's secret
manager.

```http
POST /v1/alert-webhooks
Authorization: Bearer <webhook-manager-key>
Content-Type: application/json

{
  "label": "production-oncall",
  "endpoint": "https://alerts.example.com/schema-guard"
}
```

The database retains only an HMAC endpoint identifier plus AES-256-GCM sealed
copies of the endpoint and signing secret. Listing webhooks never returns the
endpoint or secret.

## Verify deliveries

Each POST contains the exact JSON body covered by these headers:

- `X-Schema-Guard-Timestamp`: ISO-8601 signing time.
- `X-Schema-Guard-Signature`: `v1=` followed by the hex HMAC-SHA-256 of
  `<timestamp>.<exact request bytes>` under the one-time signing secret.

Receivers should reject stale timestamps, compare signatures in constant time,
parse JSON only after verification, and deduplicate the stable `event_id`.
Payload details are projected through a kind-specific allowlist. Tool argument
values, raw tool names, tenant IDs, API keys, endpoint URLs, and signing secrets
are not included.

## Delivery behavior

Alerts and their outbox rows commit in the same SQLite transaction. A leased
worker prevents overlapping delivery within the implemented single-node
profile. HTTP 2xx completes a delivery. Network failures, 408, 425, 429, and 5xx
responses retry with bounded exponential backoff; redirects and other 4xx
responses dead-letter immediately. The default maximum is eight attempts.

The transport resolves DNS immediately before each request, rejects private,
loopback, link-local, reserved, and documentation IPv4 destinations, pins the
approved public IPv4 address for the TLS connection, and does not follow
redirects. IPv6-only endpoints are not supported by this first transport.

Inspect and operate the outbox with:

- `GET /v1/alert-webhooks`
- `GET /v1/alert-webhooks/deliveries?limit=100`
- `POST /v1/alert-webhooks/deliveries/:delivery_id/redrive`
- `DELETE /v1/alert-webhooks/:webhook_id` (disables; it does not erase history)

Redrive is allowed only for a dead delivery whose endpoint remains enabled.
Before launch, send a real alert through the deployed TLS/egress path, verify it
at the receiver, alert separately on dead-letter growth, and document ownership.
