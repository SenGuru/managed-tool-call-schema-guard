const icons: Record<string, string> = {
  overview:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  decisions:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h10M4 19h7"/><circle cx="18" cy="16" r="3"/></svg>',
  schemas:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3.5 7.5 12 12l8.5-4.5zM3.5 12 12 16.5l8.5-4.5M3.5 16.5 12 21l8.5-4.5"/></svg>',
  actions:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6.5V12c0 4.6 3.2 7.7 8 9 4.8-1.3 8-4.4 8-9V6.5z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
  alerts:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
  evidence:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  workbench:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7L0 10.5v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2.3h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7z" transform="translate(2 -1) scale(.83)"/></svg>',
};

const navigation = [
  {
    label: 'Workspace',
    items: [
      ['overview', 'Overview'],
      ['decisions', 'Tool-call decisions'],
    ],
  },
  {
    label: 'Protect',
    items: [
      ['schemas', 'Schemas & releases'],
      ['actions', 'Actions & approvals'],
    ],
  },
  {
    label: 'Operate',
    items: [
      ['alerts', 'Alerts & delivery'],
      ['evidence', 'Evidence & integrity'],
      ['workbench', 'API workbench'],
    ],
  },
  {
    label: 'Admin',
    items: [['settings', 'Tenant settings']],
  },
]
  .map(
    (group) =>
      `<div class="nav-group"><span class="nav-label">${group.label}</span>${group.items
        .map(
          ([route, label]) =>
            `<a class="nav-link" data-route="${route}" href="/dashboard/${route}" title="${label}">${icons[route ?? ''] ?? ''}<span class="nav-copy">${label}</span></a>`,
        )
        .join('')}</div>`,
  )
  .join('');

function evidenceBlock(id: string, title: string, wide = false): string {
  return `<article class="evidence-block${wide ? ' wide' : ''}"><h3>${title}</h3><pre id="${id}">—</pre></article>`;
}

export function dashboardHtml(publicMode = false): string {
  const title = publicMode
    ? 'Akriven / Schema Guard Control Plane'
    : 'Akriven / Schema Guard Local Control Plane';
  const description = publicMode
    ? "Enter a tenant API key. It remains only in this tab's memory and is sent to this service origin over its configured TLS connection."
    : "Enter a tenant API key. It remains only in this tab's memory and is sent to this loopback service origin.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${title}</title><link rel="stylesheet" href="/dashboard/app.css"></head>
<body><a class="skip-link" href="#main-content">Skip to content</a>
<div class="app-shell" id="app-shell" data-sidebar="expanded" data-mobile-nav="closed">
<aside class="sidebar" id="sidebar" aria-label="Product navigation">
  <div class="sidebar-head">
    <a class="brand" href="/dashboard/overview" data-route="overview" aria-label="Akriven overview">
      <svg class="brand-mark" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="#F5F4EE" d="M24 20h158l50 50v166H24z"/><path fill="#11131A" fill-rule="evenodd" d="M107 58h42l50 142h-37l-11-34h-48l-11 34H56zm5 79h30l-15-47z"/><path fill="#11131A" d="M24 139h180v27H24z"/><path fill="#DDFE52" d="M204 139h28v27h-28z"/></svg>
      <span class="brand-copy">Akriven</span>
    </a>
    <button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-label="Collapse navigation" aria-expanded="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 7-5 5 5 5"/></svg></button>
  </div>
  <nav class="sidebar-nav">${navigation}</nav>
  <div class="sidebar-foot"><div class="tenant-chip"><span class="tenant-avatar" id="tenant-avatar">A</span><span class="tenant-copy"><strong id="tenant-name">Tenant workspace</strong><small>Schema Guard control plane</small></span></div></div>
</aside>
<button class="mobile-backdrop" id="mobile-backdrop" type="button" aria-label="Close navigation"></button>

<section class="workspace" id="workspace" data-connected="false">
  <header class="workspace-bar">
    <button class="mobile-nav-toggle" id="mobile-nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <div class="workspace-heading"><h1 id="page-title">Protection overview</h1><p id="page-description">Current readiness, usage, decisions, and open operational work.</p></div>
    <div class="workspace-actions"><span class="connection-dot"></span><span class="connection-label" id="connection-label">Not connected</span><button class="icon-button" type="button" data-route-target="settings" aria-label="Open tenant settings">${icons.settings}</button></div>
  </header>
  <section class="credential" aria-label="Workspace connection">
    <label class="sr-only" for="key">Tenant API key</label>
    <input id="key" type="password" autocomplete="off" aria-describedby="credential-help" placeholder="Tenant API key — held only in this tab">
    <button class="btn" id="load" type="button">Load workspace</button>
    <button class="btn secondary" id="export" type="button">Download tenant export</button>
    <small class="credential-help" id="credential-help">${description}</small>
    <p id="status" role="status" aria-live="polite"></p>
  </section>

  <main class="content" id="main-content" tabindex="-1">
    <section class="route-view" data-route-view="overview">
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Workspace / Live state</span><h2>Protection that can be inspected.</h2><p>See whether the tenant is ready for guarded action traffic, then move directly into the work that needs attention.</p></div><span class="status-pill warn" id="protection-state" role="status"><i class="dot"></i><span id="protection-state-text">Credential required</span></span></div>
      <div class="metric-strip">
        <article class="metric"><small>Decisions this month</small><strong id="usage-total">—</strong><span id="usage-limit">— included</span><div class="meter" id="quota-meter-track" role="progressbar" aria-label="Monthly quota use" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="quota-meter"></i></div></article>
        <article class="metric"><small>Accepted rate</small><strong id="accept-rate">—</strong><span>valid + repaired</span></article>
        <article class="metric"><small>Safely repaired</small><strong id="repair-total">—</strong><span>proof-carrying repairs</span></article>
        <article class="metric"><small>Rejected</small><strong id="rejection-total">—</strong><span>stopped pre-execution</span></article>
        <article class="metric"><small>Plan</small><strong id="plan-name">—</strong><span>current entitlement</span></article>
      </div>
      <div class="content-grid">
        <article class="panel"><div class="panel-head"><div><h3>Private-beta readiness</h3><p>Controls that must hold before action traffic.</p></div><button class="btn ghost" type="button" data-route-target="evidence">Inspect evidence</button></div><div class="panel-body"><ul class="clean-list" id="readiness-list"><li>Load the workspace to evaluate readiness.</li></ul></div></article>
        <div>
          <article class="panel"><div class="panel-head"><div><h3>Open alerts</h3><p><span id="open-alert-total">—</span> require review.</p></div><button class="btn ghost" type="button" data-route-target="alerts">Open alerts</button></div><div class="panel-body"><ul class="clean-list" id="alert-list"><li>Load the workspace to review alerts.</li></ul></div></article>
          <article class="panel"><div class="panel-head"><div><h3>Workspace inventory</h3><p>Reachable tenant authority.</p></div></div><div class="panel-body inline-stat"><div><strong id="environment-total">—</strong><span>Environments</span></div><div><strong id="api-key-total">—</strong><span>Active API keys</span></div></div></article>
        </div>
      </div>
    </section>

    <section class="route-view" data-route-view="decisions" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Protect / Tool calls</span><h2>Decide before execution.</h2><p>Run deterministic validation, compile provider contracts, and inspect the accountable result stream without storing argument values.</p></div><div class="page-actions"><button class="btn" type="button" data-preset="validate">Validate a tool call</button><button class="btn secondary" type="button" data-preset="compile_contract">Compile contract</button></div></div>
      <article class="panel"><div class="panel-head"><div><h3>Recent decisions</h3><p>Valid, safely repaired, and rejected outcomes.</p></div><button class="btn ghost" type="button" data-route-target="evidence">Verify audit chain</button></div><div class="panel-body flush"><div class="table-scroll"><table><thead><tr><th>Time</th><th>Outcome</th><th>Reason</th><th>Audit ID</th></tr></thead><tbody id="decision-rows"></tbody></table><p class="muted empty-copy" id="decision-empty">Load the workspace to review decisions.</p></div></div></article>
      <div class="panel top-gap"><div class="panel-head"><div><h3>Decision workflows</h3><p>Start with the operator job; each opens a guarded request.</p></div></div><div class="workflow-list"><article class="workflow"><b>Validate raw arguments</b><p>Apply only exact allowlisted repairs and return proof-carrying evidence.</p><button data-preset="validate" type="button">Open validation</button></article><article class="workflow"><b>Compile a provider contract</b><p>Normalize a contract for MCP, OpenAI Agents, PydanticAI, or Google ADK.</p><button data-preset="compile_contract" type="button">Open compiler</button></article></div></div>
    </section>

    <section class="route-view" data-route-view="schemas" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Protect / Runtime admission</span><h2>Release contracts deliberately.</h2><p>Register immutable schema versions, promote reviewed releases, and switch environments to fail-closed admission.</p></div><div class="page-actions"><button class="btn" type="button" data-preset="register_schema">Register schema</button><button class="btn secondary" type="button" data-preset="release_schema">Prepare release</button></div></div>
      <div class="evidence-grid">${evidenceBlock('releases', 'Environment schema releases', true)}${evidenceBlock('schemas', 'Schema registry')}${evidenceBlock('intelligence', 'Compatibility intelligence')}</div>
      <div class="panel top-gap"><div class="panel-head"><div><h3>Release workflows</h3><p>Exact API operations remain editable and confirmed.</p></div></div><div class="workflow-list"><article class="workflow"><b>Create an environment</b><p>Establish a separate policy and schema-admission boundary.</p><button data-preset="create_environment" type="button">Create environment</button></article><article class="workflow"><b>Enforce reviewed schemas</b><p>Reject missing, mismatched, or integrity-invalid releases before execution.</p><button data-preset="environment_enforcement" type="button">Configure enforcement</button></article></div></div>
    </section>

    <section class="route-view" data-route-view="actions" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Protect / Side effects</span><h2>Make high-risk execution accountable.</h2><p>Classify tools, bind approval to a decision, reserve idempotency, require anchor acknowledgement, and reconcile uncertainty.</p></div><div class="page-actions"><button class="btn" type="button" data-preset="action_challenge">Create approval</button><button class="btn secondary" type="button" data-preset="reconcile">Reconcile action</button></div></div>
      <div class="evidence-grid">${evidenceBlock('actions', 'Action checkpoint & anchor', true)}${evidenceBlock('descriptors', 'Action descriptors')}${evidenceBlock('challenges', 'Approval challenges')}${evidenceBlock('reconciliation', 'Reconciliation', true)}</div>
      <div class="panel top-gap"><div class="panel-head"><div><h3>Action workflows</h3><p>Reservations remain duplicate-blocked across outage and recovery.</p></div></div><div class="workflow-list"><article class="workflow"><b>Classify a tool</b><p>Bind environment, risk, and side-effect semantics to a signed descriptor.</p><button data-preset="action_descriptor" type="button">Set descriptor</button></article><article class="workflow"><b>Evaluate approved execution</b><p>Admit exactly once only after approval and current checkpoint acknowledgement.</p><button data-preset="action_evaluate" type="button">Evaluate action</button></article><article class="workflow"><b>Compare checkpoints</b><p>Verify an externally retained checkpoint against the current manifest.</p><button data-preset="checkpoint_compare" type="button">Compare checkpoint</button></article><article class="workflow"><b>Resolve ambiguity</b><p>Record confirmed execution or non-execution against an authoritative ledger.</p><button data-preset="reconcile" type="button">Open reconciliation</button></article></div></div>
    </section>

    <section class="route-view" data-route-view="alerts" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Operate / Incidents</span><h2>Deliver operational state durably.</h2><p>Review tenant alerts and inspect signed webhook delivery, retry, dead-letter, and redrive state.</p></div><button class="btn" type="button" data-preset="webhook_create">Configure receiver</button></div>
      <div class="content-grid equal"><article class="panel"><div class="panel-head"><div><h3>Alert queue</h3><p>Open incidents requiring acknowledgement.</p></div></div><div class="panel-body"><ul class="clean-list" id="alerts-page-list"><li>Load the workspace to review alerts.</li></ul></div></article><article class="panel"><div class="panel-head"><div><h3>Delivery boundary</h3><p>Customer-owned public HTTPS receivers only.</p></div></div><div class="panel-body"><p class="muted">Webhook endpoints and one-time signing secrets are sealed at rest. Unsafe callback targets fail closed.</p></div></article></div>
      <div class="evidence-grid top-gap">${evidenceBlock('alerts', 'Alerts')}${evidenceBlock('webhooks', 'Alert webhooks')}${evidenceBlock('deliveries', 'Webhook deliveries', true)}</div>
    </section>

    <section class="route-view" data-route-view="evidence" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Operate / Verifiable state</span><h2>Evidence that survives review.</h2><p>Inspect signed chains and control state, then export tenant-owned evidence without credential verifiers or encrypted secrets.</p></div><button class="btn" id="export-secondary" type="button">Download tenant export</button></div>
      <div class="evidence-grid">${evidenceBlock('control-integrity', 'Control-plane integrity', true)}${evidenceBlock('chain', 'Audit chain')}${evidenceBlock('rulesets', 'Latest signed ruleset')}${evidenceBlock('audits', 'Recent audit payloads', true)}${evidenceBlock('export-result', 'Tenant export result', true)}</div>
      <p class="raw-note">Read panels are value-free operational evidence. Raw API keys, webhook credentials, and sensitive arguments are excluded.</p>
    </section>

    <section class="route-view" data-route-view="workbench" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Operate / Advanced</span><h2>Managed API workbench</h2><p>All 29 managed operations remain available as editable examples. Replace every placeholder and review the exact request before execution.</p></div></div>
      <section class="panel workbench" id="workbench"><div class="panel-body">
        <div class="workbench-grid">
          <label for="operation">Operation</label><div><select id="operation">
            <option value="validate">Validate tool call</option><option value="compile_contract">Compile provider contract</option><option value="register_schema">Register schema</option><option value="release_schema">Release schema</option>
            <option value="create_environment">Create environment</option><option value="environment_policy">Update environment policy</option><option value="environment_enforcement">Update schema enforcement</option><option value="organization_policy">Update organization policy</option>
            <option value="action_descriptor">Set action descriptor</option><option value="action_challenge">Create approval challenge</option><option value="action_approve">Approve challenge</option><option value="action_cancel">Cancel challenge</option><option value="action_evaluate">Evaluate action</option>
            <option value="action_complete">Complete reservation</option><option value="action_release">Release reservation</option><option value="checkpoint_compare">Compare checkpoint</option><option value="anchor_redrive">Redrive anchor delivery</option><option value="reconcile">Reconcile uncertain action</option>
            <option value="conformance_run">Ingest conformance run</option><option value="webhook_create">Create alert webhook</option><option value="webhook_redrive">Redrive webhook delivery</option><option value="webhook_disable">Disable webhook</option>
            <option value="publish_ruleset">Publish ruleset</option><option value="create_api_key">Create API key</option><option value="revoke_api_key">Revoke API key</option><option value="billing_checkout">Start Stripe checkout</option><option value="billing_portal">Open Stripe billing portal</option><option value="plan_change">Attempt plan change</option><option value="retention_purge">Purge retained audits</option>
          </select><button id="operation-load" type="button">Reset preset</button></div>
          <label for="operation-method">Method</label><input id="operation-method" autocomplete="off">
          <label for="operation-path">Path</label><input id="operation-path" autocomplete="off">
          <label for="operation-body">JSON body</label><textarea id="operation-body" spellcheck="false"></textarea>
        </div>
        <p id="operation-help" class="muted"></p>
        <label class="confirm"><input id="operation-confirm" type="checkbox">I reviewed this exact request and authorize this mutation.</label>
        <button id="operation-run" type="button">Execute request</button>
        <pre class="operation-result" id="operation-result">—</pre>
      </div></section>
    </section>

    <section class="route-view" data-route-view="settings" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Admin / Tenant</span><h2>Tenant authority and lifecycle.</h2><p>Inspect the signed configuration that controls access, entitlement, retention, and deletion.</p></div><button class="btn secondary" type="button" data-preset="create_api_key">Create scoped API key</button></div>
      <div class="evidence-grid">${evidenceBlock('lifecycle', 'Tenant lifecycle')}${evidenceBlock('usage', 'Usage & entitlement')}${evidenceBlock('policy', 'Organization policy')}${evidenceBlock('api-keys', 'API key inventory')}${evidenceBlock('billing', 'Billing boundary', true)}</div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Retention and data controls</h3><p>Export before requesting deletion. Execution remains an offline verified operation.</p></div><button class="btn secondary" type="button" data-preset="retention_purge">Prepare retention purge</button></div><div class="destructive"><h3>Request tenant deletion</h3><p>Type the exact tenant ID. This immediately locks operational access; an operator must still verify a current export before deleting data.</p><div class="destructive-row"><input id="deletion-confirm" autocomplete="off" placeholder="Exact tenant ID"><button class="btn danger" id="request-deletion" type="button">Request tenant deletion</button></div><p id="deletion-result"></p></div></article>
    </section>
  </main>
</section>
</div><script type="module" src="/dashboard/app.js"></script></body></html>`;
}
