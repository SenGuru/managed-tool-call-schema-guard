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
] as const;
