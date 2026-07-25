# Akriven branded email provider checklist

Status: provider selection prepared; no mailbox purchase, live DNS mutation, or
production sender activation has been performed.

## Required boundary

A mailbox and a transactional email service solve different problems and must
not share application credentials:

- **Human mail:** use Google Workspace for addresses such as
  `support@akriven.com` and `security@akriven.com`. This preserves the familiar
  Gmail workflow while giving Akriven a domain-based identity.
- **Transactional mail:** use Postmark for application notifications and, once
  certified, as the WorkOS custom email provider. The managed service already
  implements a fail-closed Postmark adapter and encrypted durable outbox.
- **Authentication:** keep WorkOS responsible for authentication state and
  one-time-code generation. Route its outbound messages through the verified
  Postmark domain instead of implementing a second authentication-mail
  subsystem.
- **Marketing mail:** keep it out of Postmark transactional streams and out of
  the authentication path. Select a separate consent-aware marketing provider
  only if a real marketing workflow is introduced.

Official references:

- [WorkOS custom email providers](https://workos.com/docs/authkit/custom-email-providers)
- [WorkOS email domains](https://workos.com/docs/custom-domains/email)
- [Postmark DKIM setup](https://postmarkapp.com/support/article/setting-up-dkim-for-your-domain)
- [Postmark SPF and custom return-path guidance](https://postmarkapp.com/support/article/how-do-i-set-up-spf-for-postmark)
- [Google Workspace business email](https://workspace.google.com/intl/en_in/)

## Owner-confirmation gates

Stop for explicit owner confirmation before:

1. accepting a Google Workspace, Postmark, or WorkOS paid commitment;
2. creating or changing GoDaddy MX, SPF, DKIM, return-path, or DMARC records;
3. switching WorkOS production mail to the Akriven domain;
4. enabling customer-facing email or public signup.

Provider-generated tokens and DNS record values must go directly into an
owner-only secret file or provider console. Do not paste them into chat, logs,
issues, commits, shell history, or screenshots.

## Ordered setup

### 1. Inventory the current DNS zone

Before writing anything, export or screenshot the complete current GoDaddy DNS
zone and record:

- authoritative name servers;
- all MX records and priorities;
- the single root SPF TXT record, if present;
- every DKIM selector;
- the `_dmarc` record;
- CAA records;
- existing application, verification, and return-path CNAME records.

Resolve each record independently with `dig` from at least two public
resolvers. Preserve this evidence and a rollback copy. Never create a second
root SPF record; merge authorized senders into one policy only when the
provider's current instructions require it.

### 2. Provision the human mailbox

After owner approval, start Google Workspace with one least-privileged
administrator and:

1. verify ownership of `akriven.com` using Google's current provider-generated
   record;
2. create the initial human mailbox and aliases only after ownership verifies;
3. enable administrator and user MFA, recovery methods, audit logging, and
   backup codes stored in the owner's password manager;
4. replace MX records only after preserving the prior set and confirming the
   exact Google-provided priorities;
5. publish Google's current DKIM selector and verify signing;
6. test inbound delivery, outbound delivery, reply handling, spam placement,
   account recovery, administrator recovery, and mailbox suspension.

Recommended initial addresses:

- `support@akriven.com` — customer-visible human support;
- `security@akriven.com` — vulnerability and incident reports;
- `privacy@akriven.com` — privacy and deletion requests;
- `billing@akriven.com` — billing replies;
- `postmaster@akriven.com` and `abuse@akriven.com` — monitored aliases.

Do not use a founder's personal mailbox as the only recovery administrator or
the only incident destination.

### 3. Verify the Postmark sending domain

After owner approval:

1. create separate Postmark servers/message streams for staging and
   production;
2. add the Akriven sending domain and copy the provider-generated records
   directly between Postmark and GoDaddy;
3. verify DKIM;
4. configure and verify a custom return-path for SPF/DMARC alignment;
5. configure the provider callback to the existing authenticated Akriven
   notification endpoint using an owner-only callback secret;
6. restrict the application server token to the correct environment and store
   it as a mounted secret file;
7. keep broadcast/marketing traffic out of the transactional stream.

Do not add a legacy Postmark SPF include merely because an old guide suggests
it. Follow the current Postmark return-path guidance and verify the resulting
message headers.

### 4. Introduce DMARC safely

After both Google Workspace and Postmark pass DKIM and aligned SPF where
applicable:

1. publish a reporting-only `p=none` DMARC policy with a monitored aggregate
   report destination;
2. observe reports for every legitimate sender and investigate unknown
   sources;
3. confirm that authentication, notification, support, recovery, bounce, and
   forwarded-message samples remain deliverable;
4. move to a sampled `quarantine` policy only after the evidence is clean;
5. move to `reject` only after a documented observation window and owner
   approval.

Exact DMARC values are deployment evidence, not repository defaults. They must
be derived from the live sender inventory.

### 5. Connect WorkOS to Postmark

Use the WorkOS environment's Email Provider configuration and provider-created
Postmark credentials. Keep WorkOS responsible for verification, invitation,
magic-auth, password-reset, Radar, and Admin Portal message semantics.

Exercise in staging before production:

- new-user verification and expired/incorrect code behavior;
- resend throttling and replay rejection;
- password reset and previously used-link rejection;
- invitation acceptance, expiration, revocation, and wrong-organization use;
- MFA enrollment, recovery, and provider-side session revocation;
- hard bounce, soft bounce, complaint, duplicate callback, reordered callback,
  callback-signature failure, provider timeout, and outage recovery;
- message content, links, From/Reply-To, DKIM, SPF, DMARC, and absence of
  secrets or raw tool arguments.

WorkOS staging may continue to use its hosted AuthKit domain. A branded AuthKit
or email domain in production is a separate paid/customer-facing activation
and must not be inferred from a successful staging provider test.

### 6. Certify Akriven application notifications

Mount the Postmark server token and callback secret using the existing
file-secret configuration, then verify:

1. an event is committed before delivery is attempted;
2. transient failures retry with bounded backoff;
3. permanent failures dead-letter;
4. operator redrive is authorized, audited, and idempotent;
5. duplicate and reordered callbacks do not corrupt state;
6. raw tool arguments, credentials, and customer-sensitive payloads do not
   appear in message bodies, provider metadata, application logs, or exports;
7. provider outage does not permit a guarded action to bypass its checkpoint;
8. delivery evidence survives restart and PostgreSQL restore.

## Acceptance evidence

The branded-email gate is complete only when retained evidence proves:

- the authoritative DNS zone and rollback copy;
- Google Workspace inbound/outbound/reply/recovery behavior;
- Postmark DKIM and return-path verification;
- DMARC reports showing every authorized sender;
- WorkOS verification, invitation, reset, MFA, bounce, complaint, replay, and
  outage behavior through the real provider;
- Akriven notification send, retry, dead-letter, redrive, callback, privacy,
  restart, and restore behavior;
- an independent recipient at a second mailbox provider;
- a monitored support and security inbox with a named human owner.

Until then, branded email is **configured only** or **blocked**, never
production-proven.
