export const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        plan TEXT NOT NULL CHECK(plan IN ('trial','team')),
        monthly_limit INTEGER NOT NULL,
        retention_days INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        key_hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE audit_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        audit_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason_code TEXT,
        repair_rules_json TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        signature TEXT NOT NULL,
        UNIQUE(tenant_id, audit_id)
      );
      CREATE INDEX audit_tenant_time ON audit_events(tenant_id, occurred_at DESC);
      CREATE TABLE tool_schemas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        tool_name_hash TEXT NOT NULL,
        adapter TEXT NOT NULL,
        version TEXT NOT NULL,
        schema_hash TEXT NOT NULL,
        schema_json TEXT NOT NULL,
        drift_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(tenant_id, tool_name_hash, version)
      );
      CREATE TABLE usage_monthly (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        validation_count INTEGER NOT NULL DEFAULT 0,
        repair_count INTEGER NOT NULL DEFAULT 0,
        rejection_count INTEGER NOT NULL DEFAULT 0,
        drift_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(tenant_id, month)
      );
      CREATE TABLE compatibility_signatures (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        signature TEXT NOT NULL,
        category TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id, signature)
      );
      CREATE TABLE rulesets (
        version TEXT PRIMARY KEY,
        body_json TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        signature TEXT NOT NULL
      );
      CREATE TABLE alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        acknowledged_at TEXT
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE audit_chain_anchors (
        tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        last_deleted_hash TEXT NOT NULL,
        deleted_through_sequence INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE tenants ADD COLUMN policy_json TEXT NOT NULL DEFAULT '{}';
      CREATE TABLE signing_keys (
        id TEXT PRIMARY KEY,
        public_key_pem TEXT NOT NULL,
        encrypted_private_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE signing_keys ADD COLUMN trust_hmac TEXT;
      CREATE TABLE tenant_rulesets (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        body_json TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        signature TEXT NOT NULL,
        PRIMARY KEY(tenant_id, version)
      );
      CREATE INDEX tenant_rulesets_latest ON tenant_rulesets(tenant_id, issued_at DESC);
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE audit_chain_anchors ADD COLUMN signature TEXT;
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE failure_clusters (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        signature TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('repair','rejection')),
        adapter TEXT NOT NULL,
        provider TEXT NOT NULL,
        framework TEXT NOT NULL,
        reason_code TEXT,
        repair_rules_json TEXT NOT NULL,
        issue_shapes_json TEXT NOT NULL,
        event_count INTEGER NOT NULL DEFAULT 1,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        affected_versions_json TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY(tenant_id, signature)
      );
      CREATE INDEX failure_clusters_tenant_count
        ON failure_clusters(tenant_id, event_count DESC, last_seen_at DESC);
      CREATE TABLE conformance_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_version TEXT NOT NULL,
        framework TEXT NOT NULL,
        framework_version TEXT NOT NULL,
        adapter TEXT NOT NULL,
        suite_version TEXT NOT NULL,
        executed_at TEXT NOT NULL,
        passed INTEGER NOT NULL,
        failed INTEGER NOT NULL,
        repaired INTEGER NOT NULL,
        rejected INTEGER NOT NULL,
        failure_signature_ids_json TEXT NOT NULL DEFAULT '[]',
        report_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(tenant_id, report_hash)
      );
      CREATE INDEX conformance_runs_tenant_time
        ON conformance_runs(tenant_id, executed_at DESC);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE environments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        policy_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, name)
      );
      CREATE INDEX environments_tenant_name ON environments(tenant_id, name);
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE action_approvals (
        challenge_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        binding_hash TEXT NOT NULL,
        challenge_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','revoked')),
        evidence_json TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        approved_at TEXT,
        PRIMARY KEY(tenant_id, challenge_id)
      );
      CREATE INDEX action_approvals_tenant_status
        ON action_approvals(tenant_id, status, expires_at);
      CREATE TABLE action_descriptors (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        tool_name_hash TEXT NOT NULL,
        environment TEXT NOT NULL,
        risk_level TEXT NOT NULL CHECK(risk_level IN ('read','low','medium','high','critical')),
        side_effect TEXT NOT NULL CHECK(side_effect IN ('none','reversible','irreversible')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id, tool_name_hash, environment)
      );
      CREATE TABLE action_idempotency (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        key_hash TEXT NOT NULL,
        execution_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','completed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id, key_hash)
      );
      CREATE INDEX action_idempotency_tenant_state
        ON action_idempotency(tenant_id, state, updated_at);
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE action_idempotency ADD COLUMN reservation_id TEXT;
      ALTER TABLE action_idempotency ADD COLUMN audit_id TEXT;
      ALTER TABLE action_idempotency ADD COLUMN tool_name_hash TEXT;
      ALTER TABLE action_idempotency ADD COLUMN environment TEXT;
      CREATE UNIQUE INDEX action_idempotency_reservation
        ON action_idempotency(tenant_id, reservation_id)
        WHERE reservation_id IS NOT NULL;
      CREATE TABLE action_reconciliations (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        reconciliation_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        reservation_id TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        execution_fingerprint TEXT NOT NULL,
        audit_id TEXT NOT NULL,
        tool_name_hash TEXT NOT NULL,
        environment TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('confirmed_executed','confirmed_not_executed')),
        evidence_hash TEXT NOT NULL,
        reconciled_by_hash TEXT NOT NULL,
        reconciled_at TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        UNIQUE(tenant_id, reconciliation_id),
        UNIQUE(tenant_id, reservation_id)
      );
      CREATE INDEX action_reconciliations_tenant_time
        ON action_reconciliations(tenant_id, reconciled_at DESC);
    `,
  },
  {
    version: 10,
    sql: `
      CREATE TABLE alert_webhooks (
        webhook_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        endpoint_hash TEXT NOT NULL,
        encrypted_endpoint TEXT NOT NULL,
        encrypted_signing_secret TEXT NOT NULL,
        created_at TEXT NOT NULL,
        disabled_at TEXT,
        PRIMARY KEY(tenant_id, webhook_id),
        UNIQUE(tenant_id, label),
        UNIQUE(tenant_id, endpoint_hash)
      );
      CREATE TABLE alert_deliveries (
        delivery_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        webhook_id TEXT NOT NULL,
        alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','processing','delivered','dead')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        lease_id TEXT,
        lease_expires_at TEXT,
        last_attempt_at TEXT,
        delivered_at TEXT,
        response_status INTEGER,
        error_code TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id, webhook_id)
          REFERENCES alert_webhooks(tenant_id, webhook_id) ON DELETE CASCADE,
        UNIQUE(webhook_id, alert_id)
      );
      CREATE INDEX alert_deliveries_due
        ON alert_deliveries(status, next_attempt_at, lease_expires_at);
      CREATE INDEX alert_deliveries_tenant_time
        ON alert_deliveries(tenant_id, created_at DESC);
    `,
  },
  {
    version: 11,
    sql: `
      ALTER TABLE environments ADD COLUMN schema_enforcement TEXT NOT NULL DEFAULT 'observe'
        CHECK(schema_enforcement IN ('observe','enforce'));
      CREATE TABLE schema_releases (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        release_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        tool_name_hash TEXT NOT NULL,
        environment TEXT NOT NULL,
        schema_row_id INTEGER NOT NULL REFERENCES tool_schemas(id) ON DELETE RESTRICT,
        schema_hash TEXT NOT NULL,
        adapter TEXT NOT NULL,
        version TEXT NOT NULL,
        compatibility TEXT NOT NULL
          CHECK(compatibility IN ('initial','identical','backward_compatible','breaking','review')),
        evidence_hash TEXT NOT NULL,
        promoted_by_hash TEXT NOT NULL,
        promoted_at TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        UNIQUE(tenant_id, release_id)
      );
      CREATE INDEX schema_releases_target
        ON schema_releases(tenant_id, environment, tool_name_hash, sequence DESC);
      CREATE INDEX schema_releases_tenant_time
        ON schema_releases(tenant_id, promoted_at DESC);
    `,
  },
  {
    version: 12,
    sql: `
      ALTER TABLE tenants ADD COLUMN control_hmac TEXT;
      ALTER TABLE api_keys ADD COLUMN control_hmac TEXT;
      ALTER TABLE environments ADD COLUMN control_hmac TEXT;
      ALTER TABLE action_descriptors ADD COLUMN control_hmac TEXT;
      ALTER TABLE action_approvals ADD COLUMN control_hmac TEXT;
      ALTER TABLE action_idempotency ADD COLUMN control_hmac TEXT;
      ALTER TABLE alert_webhooks ADD COLUMN control_hmac TEXT;
      ALTER TABLE alert_deliveries ADD COLUMN payload_hmac TEXT;
    `,
  },
  {
    version: 13,
    sql: `
      CREATE TABLE action_idempotency_manifests (
        tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK(revision >= 0),
        row_count INTEGER NOT NULL CHECK(row_count >= 0),
        accumulator TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        control_hmac TEXT NOT NULL
      );
    `,
  },
  {
    version: 14,
    sql: `
      CREATE TABLE checkpoint_anchor_deliveries (
        delivery_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK(revision >= 0),
        checkpoint_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','processing','delivered','dead')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        lease_id TEXT,
        lease_expires_at TEXT,
        last_attempt_at TEXT,
        delivered_at TEXT,
        response_status INTEGER,
        error_code TEXT,
        created_at TEXT NOT NULL,
        payload_hmac TEXT NOT NULL,
        acknowledgement_hmac TEXT,
        UNIQUE(tenant_id, revision)
      );
      CREATE INDEX checkpoint_anchor_deliveries_due
        ON checkpoint_anchor_deliveries(status, next_attempt_at, lease_expires_at);
      CREATE INDEX checkpoint_anchor_deliveries_tenant_time
        ON checkpoint_anchor_deliveries(tenant_id, revision DESC);
    `,
  },
  {
    version: 15,
    sql: `
      CREATE TABLE tenant_lifecycle (
        tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        status TEXT NOT NULL
          CHECK(status IN ('active','suspended','canceled','deletion_pending')),
        reason_code TEXT,
        deletion_requested_at TEXT,
        updated_at TEXT NOT NULL,
        control_hmac TEXT NOT NULL
      );
      CREATE TABLE tenant_deletion_receipts (
        tenant_ref TEXT PRIMARY KEY,
        export_sha256 TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        receipt_hmac TEXT NOT NULL
      );
    `,
  },
  {
    version: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS action_controls (
        tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        hold INTEGER NOT NULL DEFAULT 0 CHECK(hold IN (0,1)),
        reason_code TEXT,
        enforced_policy_json TEXT NOT NULL DEFAULT '{}',
        shadow_policy_json TEXT,
        updated_at TEXT NOT NULL,
        updated_by_hash TEXT NOT NULL,
        control_hmac TEXT NOT NULL
      );
    `,
  },
] as const;
