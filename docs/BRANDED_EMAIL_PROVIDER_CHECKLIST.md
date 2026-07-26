# Akriven branded email provider checklist

Status: the single human mailbox is provisioned, its provider-managed DNS is
public, and inbound delivery is proven. Outbound destination receipt, reply,
recovery, message-header alignment, Postmark, and production transactional
sending remain unproven.

## Observed live state — 2026-07-26

The signed-in GoDaddy account and public DNS were inspected, then the already
purchased mailbox entitlement was consumed for the owner-approved primary
address:

- `support@akriven.com` is provisioned on **Professional Email powered by Titan
  Pro Light**, expiring or renewing on 2027-07-21;
- the mailbox password is held in an owner-only file outside the repository,
  and the owner's independent Gmail address is configured for recovery;
- GoDaddy automatically published the two documented MX records, the single
  root `v=spf1 include:secureserver.net -all` SPF record, the `email` webmail
  CNAME, and both `secureserver1`/`secureserver2` DKIM CNAMEs;
- `_dmarc.akriven.com` currently publishes `p=quarantine` with relaxed DKIM/SPF
  alignment and a GoDaddy aggregate-report destination;
- public DNS resolution confirms the provider-managed MX, SPF, DKIM, webmail
  and DMARC records;
- the owner explicitly accepted Titan's first-use terms; webmail authentication
  and recovery-address configuration succeeded;
- a non-sensitive Gmail-to-support certification message was received in the
  Titan inbox;
- a non-sensitive support-to-Gmail certification message was submitted, but
  destination receipt has not yet been observed and therefore is not counted
  as outbound-delivery proof;
- no reply, recovery reset, message-header alignment, spam placement, bounce,
  complaint, or independent-recipient behavior has yet been exercised.

This is **configured DNS/mailbox evidence plus inbound delivery proof**, not
complete bidirectional or transactional delivery proof. The existing
quarantine policy must still be reconciled with Postmark before any
transactional-sender claim.

## Required boundary

A mailbox and a transactional email service solve different problems and must
not share application credentials:

- **Human mail for the first private cohort:** use the already-owned GoDaddy
  Professional Email powered by Titan mailbox unless the owner chooses to incur
  a separate Google Workspace subscription. The Pro Light entitlement should
  be treated as one primary inbox; GoDaddy's current documentation limits Titan
  aliases to Premium and Ultra plans, so do not promise aliases on this plan.
- **Human mail after a team or shared-inbox need appears:** reassess Google
  Workspace or a dedicated support desk rather than upgrading by inertia.
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
- [GoDaddy Professional Email powered by Titan setup](https://www.godaddy.com/en-uk/help/set-up-professional-email-32288)
- [GoDaddy Professional Email account limitations](https://www.godaddy.com/en-ph/help/professional-email-account-limitations-31970)
- [GoDaddy Professional Email alias availability](https://www.godaddy.com/en-uk/help/create-an-alias-for-my-professional-email-41888)
- [Google Workspace business email](https://workspace.google.com/intl/en_in/)

## Owner-confirmation gates

Stop for explicit owner confirmation before:

1. accepting a Google Workspace, Postmark, WorkOS, or GoDaddy upgrade/renewal
   commitment;
2. consuming the existing single mailbox entitlement before the owner confirms
   its permanent address;
3. creating or changing GoDaddy MX, SPF, DKIM, return-path, or DMARC records;
4. switching WorkOS production mail to the Akriven domain;
5. enabling customer-facing email or public signup.

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

After the owner selects the permanent address, consume the existing GoDaddy
Professional Email powered by Titan Pro Light entitlement and:

1. generate a unique password directly into the owner's password manager or an
   owner-only secret file, never chat or repository state;
2. create the primary mailbox and connect it only to the owner's GoDaddy
   identity;
3. add the owner's recovery address and enable all MFA/recovery controls the
   plan exposes;
4. preserve the current zone before allowing GoDaddy to add MX, SPF, or DKIM
   records;
5. verify the exact public records after propagation;
6. test inbound delivery, outbound delivery, reply handling, spam placement,
   account recovery, mailbox suspension, and recovery from a second provider.

Do not assume that Pro Light includes aliases. If separate public roles are
needed, verify whether GoDaddy forwarding addresses meet the operational and
reply-identity requirements; otherwise purchase another mailbox or migrate the
human-mail boundary after owner approval.

Candidate addresses that require an owner decision:

- `support@akriven.com` — strongest customer-facing choice for a single inbox;
- `ops@akriven.com` — stronger separation for provider verification and
  operational recovery, but it does not satisfy a public support inbox;
- `security@akriven.com` — vulnerability and incident reports;
- `privacy@akriven.com` — privacy and deletion requests;
- `billing@akriven.com` — billing replies;
- `postmaster@akriven.com` and `abuse@akriven.com` — monitored aliases.

For a one-mailbox private beta, `support@akriven.com` is the recommended primary
address if the same owner will handle support and provider verification. Add a
separate operational mailbox before responsibility is delegated. Do not use a
founder's personal mailbox as the only recovery administrator or the only
incident destination.

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

After both the selected human-mail provider and Postmark pass DKIM and aligned
SPF where applicable:

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
- GoDaddy Professional Email inbound/outbound/reply/recovery behavior, or
  equivalent evidence if the owner explicitly selects Google Workspace;
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
