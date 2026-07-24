const icons: Record<string, string> = {
  overview:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  decisions:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h10M4 19h7"/><circle cx="18" cy="16" r="3"/></svg>',
  schemas:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3.5 7.5 12 12l8.5-4.5zM3.5 12 12 16.5l8.5-4.5M3.5 16.5 12 21l8.5-4.5"/></svg>',
  environments:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/></svg>',
  actions:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6.5V12c0 4.6 3.2 7.7 8 9 4.8-1.3 8-4.4 8-9V6.5z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
  approvals:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v4H7zM5 5H3v16h18V5h-2"/><path d="m8 14 2.5 2.5L16 11"/></svg>',
  alerts:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
  evidence:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  intelligence:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/><path d="M2 19h20"/></svg>',
  access:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-2 2 1.5 1.5-2 2L17 10l-3 3"/></svg>',
  usage:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-8M22 19V3"/><path d="M2 19h20"/></svg>',
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
      ['environments', 'Environments'],
      ['actions', 'Actions & execution'],
      ['approvals', 'Approval inbox'],
    ],
  },
  {
    label: 'Operate',
    items: [
      ['alerts', 'Alerts & delivery'],
      ['intelligence', 'Intelligence'],
      ['evidence', 'Evidence & integrity'],
    ],
  },
  {
    label: 'Admin',
    items: [
      ['access', 'Access & API keys'],
      ['usage', 'Usage & plan'],
      ['settings', 'Tenant settings'],
      ['workbench', 'API workbench'],
    ],
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
  return `<details class="evidence-block${wide ? ' wide' : ''}"><summary><span>${title}</span><small>Raw evidence</small></summary><pre id="${id}">—</pre></details>`;
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
          <article class="panel"><div class="panel-head"><div><h3>Workspace inventory</h3><p>Reachable tenant authority.</p></div></div><div class="panel-body inline-stat"><div><strong id="environment-total">—</strong><span>Environments</span></div><div><strong id="api-key-total">—</strong><span>Active API keys</span></div><div><strong id="service-state">—</strong><span>Service readiness</span></div></div></article>
        </div>
      </div>
    </section>

    <section class="route-view" data-route-view="decisions" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Protect / Tool calls</span><h2>Decide before execution.</h2><p>Validate a real call, compile provider contracts, and inspect accountable outcomes without sending argument values into logs or intelligence.</p></div><button class="btn secondary" id="audit-csv" type="button">Export audit CSV</button></div>
      <div class="task-grid">
        <form class="panel task-form" id="validate-form">
          <div class="panel-head"><div><h3>Validate a tool call</h3><p>Allow only exact schema matches or safe allowlisted repairs.</p></div><span class="method-badge">POST /v1/validate</span></div>
          <div class="panel-body form-grid">
            <label>Tool name<input class="field" id="validate-tool" required value="counter"></label>
            <label>Environment<input class="field" id="validate-environment" required value="development"></label>
            <label class="span-2">JSON Schema<textarea class="field code-field" id="validate-schema" required spellcheck="false">{"type":"object","additionalProperties":false,"required":["count"],"properties":{"count":{"type":"integer"}}}</textarea></label>
            <label class="span-2">Raw arguments<textarea class="field code-field compact" id="validate-arguments" required spellcheck="false">{"count":"2"}</textarea></label>
            <div class="form-actions span-2"><button class="btn" type="submit">Validate call</button><span class="form-status" id="validate-status" role="status"></span></div>
            <div class="result-card span-2" id="validate-result" hidden></div>
          </div>
        </form>
        <form class="panel task-form" id="compile-form">
          <div class="panel-head"><div><h3>Compile provider contract</h3><p>Generate the reviewed declaration for one target.</p></div><span class="method-badge">POST /v1/contracts/compile</span></div>
          <div class="panel-body form-grid">
            <label>Target<select class="field" id="compile-target"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google_gemini">Google Gemini</option><option value="mcp">MCP</option></select></label>
            <label>Tool name<input class="field" id="compile-tool" required value="counter"></label>
            <label class="span-2">Canonical schema<textarea class="field code-field" id="compile-schema" required spellcheck="false">{"type":"object","additionalProperties":false,"required":["count"],"properties":{"count":{"type":"integer"}}}</textarea></label>
            <div class="form-actions span-2"><button class="btn" type="submit">Compile contract</button><span class="form-status" id="compile-status" role="status"></span></div>
            <pre class="inline-result span-2" id="compile-result" hidden></pre>
          </div>
        </form>
      </div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Decision explorer</h3><p>Recent valid, safely repaired, and rejected outcomes.</p></div><span class="integrity-label" id="audit-chain-label">Chain not loaded</span></div><div class="panel-body flush"><div class="table-scroll"><table><thead><tr><th>Time</th><th>Outcome</th><th>Reason</th><th>Repairs</th><th>Audit ID</th></tr></thead><tbody id="decision-rows"></tbody></table><p class="muted empty-copy" id="decision-empty">Load the workspace to review decisions.</p></div></div></article>
    </section>

    <section class="route-view" data-route-view="schemas" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Protect / Contracts</span><h2>Register once. Release deliberately.</h2><p>Immutable schema versions and exact-hash promotion make runtime admission reviewable.</p></div><span class="integrity-label" id="release-chain-label">Release chain not loaded</span></div>
      <div class="task-grid">
        <form class="panel task-form" id="schema-register-form">
          <div class="panel-head"><div><h3>Register schema version</h3><p>Create an immutable registry entry.</p></div><span class="method-badge">POST /v1/schemas</span></div>
          <div class="panel-body form-grid">
            <label>Tool name<input class="field" id="schema-tool" required></label>
            <label>Version<input class="field" id="schema-version" required placeholder="1.0.0"></label>
            <label>Adapter<select class="field" id="schema-adapter"><option value="json_schema">JSON Schema</option><option value="mcp">MCP</option><option value="openai_agents">OpenAI Agents</option><option value="pydantic_ai">PydanticAI</option><option value="google_adk">Google ADK</option></select></label>
            <label class="span-2">Schema<textarea class="field code-field" id="schema-body" required spellcheck="false">{"type":"object","additionalProperties":false,"properties":{}}</textarea></label>
            <label class="confirm span-2"><input id="schema-register-confirm" type="checkbox" required>I reviewed this schema version and authorize registration.</label>
            <div class="form-actions span-2"><button class="btn" type="submit">Register version</button><span class="form-status" id="schema-register-status" role="status"></span></div>
          </div>
        </form>
        <form class="panel task-form" id="schema-release-form">
          <div class="panel-head"><div><h3>Promote reviewed schema</h3><p>Bind an exact registered hash to an environment.</p></div><span class="method-badge">POST /v1/schema-releases</span></div>
          <div class="panel-body form-grid">
            <label>Environment<select class="field" id="release-environment" required></select></label>
            <label>Tool name<input class="field" id="release-tool" required></label>
            <label>Adapter<select class="field" id="release-adapter"><option value="json_schema">JSON Schema</option><option value="mcp">MCP</option><option value="openai_agents">OpenAI Agents</option><option value="pydantic_ai">PydanticAI</option><option value="google_adk">Google ADK</option></select></label>
            <label>Version<input class="field" id="release-version" required></label>
            <label class="span-2">Expected schema hash<input class="field mono-input" id="release-hash" required placeholder="sha256:…"></label>
            <label class="confirm span-2"><input id="schema-release-confirm" type="checkbox" required>I verified the exact schema hash and authorize promotion.</label>
            <div class="form-actions span-2"><button class="btn" type="submit">Promote release</button><span class="form-status" id="schema-release-status" role="status"></span></div>
          </div>
        </form>
      </div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Schema registry</h3><p>Latest immutable contracts, quality, and drift state.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Tool</th><th>Adapter</th><th>Version</th><th>Schema hash</th><th>Drift</th><th>Registered</th></tr></thead><tbody id="schema-rows"></tbody></table></div></article>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Release history</h3><p>Environment admission authority.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Environment</th><th>Tool</th><th>Version</th><th>Schema hash</th><th>Released</th></tr></thead><tbody id="release-rows"></tbody></table></div></article>
      <div class="evidence-grid top-gap">${evidenceBlock('schemas', 'Schema registry evidence')}${evidenceBlock('releases', 'Schema release evidence')}</div>
    </section>

    <section class="route-view" data-route-view="environments" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Protect / Admission boundaries</span><h2>Separate rollout from enforcement.</h2><p>Create environments, tune their policy, and move from observation to fail-closed schema admission.</p></div></div>
      <div class="task-grid">
        <form class="panel task-form" id="environment-create-form">
          <div class="panel-head"><div><h3>Create environment</h3><p>Start with an isolated policy boundary.</p></div><span class="method-badge">POST /v1/admin/environments</span></div>
          <div class="panel-body form-grid">
            <label class="span-2">Environment name<input class="field" id="environment-name" required placeholder="staging"></label>
            <label class="span-2">Initial policy JSON<textarea class="field code-field compact" id="environment-policy-initial" spellcheck="false">{}</textarea></label>
            <label class="confirm span-2"><input id="environment-create-confirm" type="checkbox" required>I reviewed the environment name and initial policy.</label>
            <div class="form-actions span-2"><button class="btn" type="submit">Create environment</button><span class="form-status" id="environment-create-status" role="status"></span></div>
          </div>
        </form>
        <form class="panel task-form" id="environment-update-form">
          <div class="panel-head"><div><h3>Configure environment</h3><p>Changes apply to the next request.</p></div><span class="method-badge">PUT environment controls</span></div>
          <div class="panel-body form-grid">
            <label class="span-2">Environment<select class="field" id="environment-select" required></select></label>
            <label>Schema enforcement<select class="field" id="environment-enforcement"><option value="observe">Observe</option><option value="enforce">Enforce</option></select></label>
            <label class="span-2">Policy JSON<textarea class="field code-field compact" id="environment-policy-editor" spellcheck="false">{}</textarea></label>
            <label class="confirm span-2"><input id="environment-update-confirm" type="checkbox" required>I reviewed this environment policy and enforcement mode.</label>
            <div class="form-actions span-2"><button class="btn" type="submit">Save environment</button><span class="form-status" id="environment-update-status" role="status"></span></div>
          </div>
        </form>
      </div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Environment inventory</h3><p>Each row is an independent runtime admission boundary.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Name</th><th>Enforcement</th><th>Policy</th><th>Updated</th><th></th></tr></thead><tbody id="environment-rows"></tbody></table></div></article>
    </section>

    <section class="route-view" data-route-view="actions" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Protect / Side effects</span><h2>Make execution accountable.</h2><p>Classify tools, evaluate approved calls once, and preserve an independently anchored execution ledger.</p></div><span class="integrity-label" id="checkpoint-label">Checkpoint not loaded</span></div>
      <div class="task-grid">
        <form class="panel task-form" id="descriptor-form">
          <div class="panel-head"><div><h3>Classify tool action</h3><p>Risk and side-effect semantics are signed control state.</p></div><span class="method-badge">PUT /v1/admin/actions/descriptors</span></div>
          <div class="panel-body form-grid">
            <label>Tool name<input class="field" id="descriptor-tool" required></label>
            <label>Environment<select class="field" id="descriptor-environment" required></select></label>
            <label>Risk<select class="field" id="descriptor-risk"><option value="read">Read</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
            <label>Side effect<select class="field" id="descriptor-side-effect"><option value="none">None</option><option value="reversible">Reversible</option><option value="irreversible">Irreversible</option></select></label>
            <label class="confirm span-2"><input id="descriptor-confirm" type="checkbox" required>I reviewed the action classification.</label>
            <div class="form-actions span-2"><button class="btn" type="submit">Save descriptor</button><span class="form-status" id="descriptor-status" role="status"></span></div>
          </div>
        </form>
        <form class="panel task-form" id="action-evaluate-form">
          <div class="panel-head"><div><h3>Evaluate approved execution</h3><p>Admission succeeds once or fails closed.</p></div><span class="method-badge">POST /v1/actions/evaluate</span></div>
          <div class="panel-body form-grid">
            <label>Tool name<input class="field" id="action-tool" required></label>
            <label>Environment<select class="field" id="action-environment" required></select></label>
            <label class="span-2">Idempotency key<input class="field mono-input" id="action-idempotency-key" required></label>
            <label class="span-2">Accepted decision JSON<textarea class="field code-field compact" id="action-decision" required spellcheck="false"></textarea></label>
            <label class="span-2">Approved challenge JSON<textarea class="field code-field compact" id="action-approval" required spellcheck="false"></textarea></label>
            <label class="confirm span-2"><input id="action-evaluate-confirm" type="checkbox" required>I reviewed this exact action evaluation request.</label>
            <div class="form-actions span-2"><button class="btn" type="submit">Evaluate action</button><span class="form-status" id="action-evaluate-status" role="status"></span></div>
            <pre class="inline-result span-2" id="action-evaluate-result" hidden></pre>
          </div>
        </form>
      </div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Action descriptors</h3><p>Current signed classification.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Tool</th><th>Environment</th><th>Risk</th><th>Side effect</th><th>Updated</th></tr></thead><tbody id="descriptor-rows"></tbody></table></div></article>
      <div class="task-grid top-gap">
        <form class="panel task-form" id="reservation-form">
          <div class="panel-head"><div><h3>Execution ledger transition</h3><p>Complete confirmed execution or release confirmed non-execution.</p></div></div>
          <div class="panel-body form-grid">
            <label>Transition<select class="field" id="reservation-transition"><option value="complete">Complete execution</option><option value="release">Release without execution</option></select></label>
            <label class="span-2">Idempotency key<input class="field mono-input" id="reservation-key" required></label>
            <label class="span-2">Execution fingerprint<input class="field mono-input" id="reservation-fingerprint" required></label>
            <label class="confirm span-2"><input id="reservation-confirm" type="checkbox" required>I verified this transition against the execution ledger.</label>
            <div class="form-actions span-2"><button class="btn" type="submit">Record transition</button><span class="form-status" id="reservation-status" role="status"></span></div>
          </div>
        </form>
        <form class="panel task-form" id="checkpoint-compare-form">
          <div class="panel-head"><div><h3>Compare external checkpoint</h3><p>Verify independently retained state before resuming traffic.</p></div></div>
          <div class="panel-body form-grid">
            <label class="span-2">Checkpoint JSON<textarea class="field code-field" id="checkpoint-input" required spellcheck="false"></textarea></label>
            <div class="form-actions span-2"><button class="btn" type="submit">Compare checkpoint</button><span class="form-status" id="checkpoint-compare-status" role="status"></span></div>
            <pre class="inline-result span-2" id="checkpoint-compare-result" hidden></pre>
          </div>
        </form>
      </div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Checkpoint anchor deliveries</h3><p>Dead deliveries can be redriven after recovery.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Revision</th><th>Status</th><th>Attempts</th><th>Updated</th><th></th></tr></thead><tbody id="anchor-delivery-rows"></tbody></table></div></article>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Pending reconciliation</h3><p>Resolve only against an authoritative external execution ledger.</p></div><span class="integrity-label" id="reconciliation-chain-label">History not loaded</span></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Reservation</th><th>Tool hash</th><th>Execution fingerprint</th><th>Reserved</th><th>Audit ID</th><th></th></tr></thead><tbody id="reconciliation-pending-rows"></tbody></table></div></article>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Reconciliation history</h3><p>Confirmed execution outcomes and evidence hashes.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Reservation</th><th>Outcome</th><th>Evidence</th><th>Reconciled</th><th>Audit ID</th></tr></thead><tbody id="reconciliation-history-rows"></tbody></table></div></article>
      <div class="evidence-grid top-gap">${evidenceBlock('actions', 'Checkpoint and anchor evidence')}${evidenceBlock('descriptors', 'Descriptor evidence')}${evidenceBlock('reconciliation', 'Reconciliation evidence', true)}</div>
    </section>

    <section class="route-view" data-route-view="approvals" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Protect / Human authority</span><h2>Review the exact decision.</h2><p>Approval challenges bind a stored accepted decision, tool, environment, and expiration window.</p></div><div class="segmented" role="group" aria-label="Approval filter"><button type="button" data-challenge-filter="">All</button><button type="button" data-challenge-filter="pending">Pending</button><button type="button" data-challenge-filter="approved">Approved</button><button type="button" data-challenge-filter="revoked">Revoked</button></div></div>
      <form class="panel task-form" id="challenge-form">
        <div class="panel-head"><div><h3>Create approval challenge</h3><p>The decision must match a stored accepted audit.</p></div><span class="method-badge">POST /v1/actions/challenges</span></div>
        <div class="panel-body form-grid three">
          <label>Tool name<input class="field" id="challenge-tool" required></label>
          <label>Environment<select class="field" id="challenge-environment" required></select></label>
          <label>Expires in seconds<input class="field" id="challenge-expires" type="number" min="60" max="86400" value="300" required></label>
          <label class="span-all">Accepted decision JSON<textarea class="field code-field compact" id="challenge-decision" required spellcheck="false"></textarea></label>
          <label class="confirm span-all"><input id="challenge-confirm" type="checkbox" required>I reviewed the exact decision and challenge lifetime.</label>
          <div class="form-actions span-all"><button class="btn" type="submit">Create challenge</button><span class="form-status" id="challenge-status" role="status"></span></div>
        </div>
      </form>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Approval inbox</h3><p>Pending challenges require an explicit approve or cancel decision.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Tool</th><th>Environment</th><th>Risk</th><th>Status</th><th>Expires</th><th>Challenge ID</th><th></th></tr></thead><tbody id="challenge-rows"></tbody></table></div></article>
      ${evidenceBlock('challenges', 'Approval challenge evidence', true)}
    </section>

    <section class="route-view" data-route-view="alerts" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Operate / Incidents</span><h2>Deliver operational state durably.</h2><p>Acknowledge alerts, manage signed HTTPS receivers, and recover dead-letter deliveries.</p></div></div>
      <div class="content-grid equal"><article class="panel"><div class="panel-head"><div><h3>Alert queue</h3><p>Open incidents requiring acknowledgement.</p></div></div><div class="panel-body"><ul class="clean-list" id="alerts-page-list"><li>Load the workspace to review alerts.</li></ul></div></article>
        <form class="panel task-form" id="webhook-create-form"><div class="panel-head"><div><h3>Add alert receiver</h3><p>Public HTTPS only; private and unsafe targets fail closed.</p></div><span class="method-badge">POST /v1/alert-webhooks</span></div><div class="panel-body form-grid"><label>Label<input class="field" id="webhook-label" required placeholder="On-call"></label><label class="span-2">HTTPS endpoint<input class="field" id="webhook-endpoint" type="url" required placeholder="https://alerts.example.com/akriven"></label><label class="confirm span-2"><input id="webhook-create-confirm" type="checkbox" required>I verified this customer-owned receiver.</label><div class="form-actions span-2"><button class="btn" type="submit">Create receiver</button><span class="form-status" id="webhook-create-status" role="status"></span></div><div class="one-time-secret span-2" id="webhook-secret" hidden></div></div></form>
      </div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Alert receivers</h3><p>Signing secrets are shown only when created; endpoint values remain encrypted.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Label</th><th>Endpoint hash</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody id="webhook-rows"></tbody></table></div></article>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Delivery queue</h3><p>Retry, dead-letter, and redrive state.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Receiver</th><th>Status</th><th>Attempts</th><th>Next attempt</th><th>Last error</th><th></th></tr></thead><tbody id="delivery-rows"></tbody></table></div></article>
      <div class="evidence-grid top-gap">${evidenceBlock('alerts', 'Alert evidence')}${evidenceBlock('webhooks', 'Receiver evidence')}${evidenceBlock('deliveries', 'Delivery evidence', true)}</div>
    </section>

    <section class="route-view" data-route-view="intelligence" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Operate / Compatibility</span><h2>Turn failures into reviewed fixes.</h2><p>Inspect tenant-safe clusters, schema quality, provider/framework conformance, and privacy-thresholded network evidence.</p></div><span class="status-pill warn" id="privacy-threshold-label">Privacy threshold —</span></div>
      <div class="metric-strip four"><article class="metric"><small>Failure clusters</small><strong id="failure-cluster-total">—</strong><span>tenant evidence</span></article><article class="metric"><small>Compatibility rows</small><strong id="compatibility-total">—</strong><span>provider/framework versions</span></article><article class="metric"><small>Recommendations</small><strong id="recommendation-total">—</strong><span>reviewed next actions</span></article><article class="metric"><small>Network clusters</small><strong id="network-cluster-total">—</strong><span>thresholded aggregate</span></article></div>
      <div class="content-grid equal"><article class="panel"><div class="panel-head"><div><h3>Recommendations</h3><p>Explainable fixes from observed failures and schema quality.</p></div></div><div class="panel-body"><ul class="clean-list" id="recommendation-list"><li>Load the workspace to review recommendations.</li></ul></div></article><article class="panel"><div class="panel-head"><div><h3>Failure clusters</h3><p>Value-free signatures and counts.</p></div></div><div class="panel-body"><ul class="clean-list" id="failure-cluster-list"><li>Load the workspace to review clusters.</li></ul></div></article></div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Compatibility matrix</h3><p>Observed provider, framework, adapter, and suite versions.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Provider</th><th>Framework</th><th>Adapter</th><th>Suite</th><th>Passed</th><th>Failed</th><th>Executed</th></tr></thead><tbody id="compatibility-rows"></tbody></table></div></article>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Schema quality</h3><p>Closed-world and structural quality signals.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Tool hash</th><th>Adapter</th><th>Version</th><th>Score</th><th>Drift</th></tr></thead><tbody id="quality-rows"></tbody></table></div></article>
      <div class="task-grid top-gap">
        <form class="panel task-form" id="conformance-form"><div class="panel-head"><div><h3>Record conformance run</h3><p>Ingest an externally executed, pinned result.</p></div></div><div class="panel-body form-grid"><label>Provider<input class="field" id="conformance-provider" required value="openai"></label><label>Provider version<input class="field" id="conformance-provider-version" required></label><label>Framework<input class="field" id="conformance-framework" required value="openai-agents"></label><label>Framework version<input class="field" id="conformance-framework-version" required></label><label>Adapter<input class="field" id="conformance-adapter" required value="openai_agents"></label><label>Suite version<input class="field" id="conformance-suite" required></label><label>Passed<input class="field" id="conformance-passed" type="number" min="0" value="1"></label><label>Failed<input class="field" id="conformance-failed" type="number" min="0" value="0"></label><label class="confirm span-2"><input id="conformance-confirm" type="checkbox" required>I verified the pinned versions and result counts.</label><div class="form-actions span-2"><button class="btn" type="submit">Record run</button><span class="form-status" id="conformance-status" role="status"></span></div></div></form>
        <form class="panel task-form" id="ruleset-form"><div class="panel-head"><div><h3>Publish signed ruleset</h3><p>Rules are signed on publication and verified on read.</p></div></div><div class="panel-body form-grid"><label>Version<input class="field" id="ruleset-version" required></label><label>Validity days<input class="field" id="ruleset-days" type="number" min="1" max="365" value="30"></label><label class="span-2">Rules JSON<textarea class="field code-field" id="ruleset-body" required spellcheck="false">[{"id":"coerce.string_to_integer","enabled_by_default":true,"description":"Exact integer strings"}]</textarea></label><label class="confirm span-2"><input id="ruleset-confirm" type="checkbox" required>I reviewed the complete ruleset and validity window.</label><div class="form-actions span-2"><button class="btn" type="submit">Publish ruleset</button><span class="form-status" id="ruleset-status" role="status"></span></div></div></form>
      </div>
      <div class="evidence-grid top-gap">${evidenceBlock('intelligence', 'Intelligence evidence', true)}${evidenceBlock('rulesets', 'Signed ruleset evidence', true)}</div>
    </section>

    <section class="route-view" data-route-view="evidence" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Operate / Verifiable state</span><h2>Evidence that survives review.</h2><p>Verify every control-plane chain and export tenant-owned evidence without credential verifiers or encrypted secrets.</p></div><div class="page-actions"><button class="btn secondary" id="evidence-audit-csv" type="button">Export audit CSV</button><button class="btn" id="export-secondary" type="button">Download tenant export</button></div></div>
      <div class="integrity-grid" id="integrity-components"><p>Load the workspace to verify component integrity.</p></div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Recent audit evidence</h3><p>Value-free decision records.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Time</th><th>Decision</th><th>Reason</th><th>Repairs</th><th>Audit ID</th></tr></thead><tbody id="evidence-audit-rows"></tbody></table></div></article>
      <div class="evidence-grid top-gap">${evidenceBlock('control-integrity', 'Control-plane integrity')}${evidenceBlock('chain', 'Audit chain')}${evidenceBlock('audits', 'Audit payloads', true)}${evidenceBlock('export-result', 'Tenant export result', true)}</div>
      <p class="raw-note">Raw evidence is value-free. API keys, webhook credentials, and sensitive arguments are excluded.</p>
    </section>

    <section class="route-view" data-route-view="access" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Admin / Credentials</span><h2>Least privilege by default.</h2><p>Issue scoped tenant keys, hand the secret off once, and revoke credentials without exposing verifiers.</p></div></div>
      <form class="panel task-form" id="api-key-form">
        <div class="panel-head"><div><h3>Create scoped API key</h3><p>The plaintext key is returned once and never stored by this dashboard.</p></div><span class="method-badge">POST /v1/admin/api-keys</span></div>
        <div class="panel-body">
          <fieldset class="scope-picker" id="scope-picker"><legend>Scopes</legend></fieldset>
          <label class="confirm"><input id="api-key-confirm" type="checkbox" required>I reviewed the selected scopes and have a secure destination ready.</label>
          <div class="form-actions"><button class="btn" type="submit">Create API key</button><span class="form-status" id="api-key-status" role="status"></span></div>
          <div class="one-time-secret" id="api-key-secret" hidden></div>
        </div>
      </form>
      <article class="panel top-gap"><div class="panel-head"><div><h3>API-key inventory</h3><p>Prefixes and scopes only; secret verifiers never leave managed storage.</p></div></div><div class="panel-body flush table-scroll"><table><thead><tr><th>Prefix</th><th>Scopes</th><th>Created</th><th>Status</th><th></th></tr></thead><tbody id="api-key-rows"></tbody></table></div></article>
      ${evidenceBlock('api-keys', 'API-key evidence', true)}
    </section>

    <section class="route-view" data-route-view="usage" hidden>
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Admin / Entitlements</span><h2>Usage, plan, and billing boundary.</h2><p>See exactly what the tenant can use and whether payment automation is configured.</p></div><div class="page-actions"><button class="btn secondary" id="billing-portal" type="button">Open billing portal</button><button class="btn" id="billing-checkout" type="button">Start checkout</button></div></div>
      <div class="usage-hero"><div><span>Current period</span><strong id="usage-period">—</strong></div><div><span>Validations</span><strong id="usage-current">—</strong><small id="usage-cap">of —</small></div><div><span>Retention</span><strong id="retention-days">—</strong><small>days</small></div><div><span>Payment</span><strong id="payment-state">—</strong></div></div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Entitlements</h3><p>Effective limits for the authenticated tenant.</p></div></div><div class="panel-body"><dl class="definition-grid" id="entitlement-list"><div><dt>Status</dt><dd>Load the workspace</dd></div></dl></div></article>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Available plans</h3><p>Private-beta enrollment is operator-led until billing is proven.</p></div></div><div class="plan-grid" id="plan-grid"><p class="empty-copy">Loading plan catalog…</p></div></article>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Billing statement</h3><p id="billing-boundary-copy">Load the workspace to inspect the integration boundary.</p></div></div><div class="panel-body"><div id="billing-summary" class="definition-grid"></div><div class="local-plan-control"><label>Local evaluation plan<select class="field" id="local-plan-select"><option value="trial">Internal evaluation</option><option value="team">Private-beta design partner</option></select></label><label class="confirm"><input id="local-plan-confirm" type="checkbox">I understand this operator control is disabled in public mode.</label><button class="btn secondary" id="local-plan-change" type="button">Apply local plan</button></div><p class="form-status" id="billing-action-status" role="status"></p></div></article>
      <div class="evidence-grid top-gap">${evidenceBlock('usage', 'Usage evidence')}${evidenceBlock('billing', 'Billing evidence')}</div>
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
      <div class="page-head"><div class="page-head-copy"><span class="page-kicker">Admin / Tenant</span><h2>Tenant policy and data lifecycle.</h2><p>Control the organization-wide guard policy, export retained evidence, and request deletion through an explicit lock-first workflow.</p></div><button class="btn" id="settings-export" type="button">Download tenant export</button></div>
      <div class="content-grid equal">
        <article class="panel"><div class="panel-head"><div><h3>Tenant lifecycle</h3><p>Only lifecycle and export remain available after a lock.</p></div><span class="status-pill warn" id="lifecycle-state">Not loaded</span></div><div class="panel-body"><dl class="definition-grid"><div><dt>Status</dt><dd id="lifecycle-status">—</dd></div><div><dt>Reason</dt><dd id="lifecycle-reason">—</dd></div><div><dt>Deletion requested</dt><dd id="lifecycle-deletion-time">—</dd></div><div><dt>Updated</dt><dd id="lifecycle-updated">—</dd></div></dl></div></article>
        <form class="panel task-form" id="policy-form"><div class="panel-head"><div><h3>Organization guard policy</h3><p>Applies on the next request and can only tighten caller policy.</p></div><span class="method-badge">PUT /v1/admin/policy</span></div><div class="panel-body form-grid"><label class="span-2">Policy JSON<textarea class="field code-field" id="policy-editor" required spellcheck="false">{}</textarea></label><label class="confirm span-2"><input id="policy-confirm" type="checkbox" required>I reviewed the complete organization policy.</label><div class="form-actions span-2"><button class="btn" type="submit">Save policy</button><span class="form-status" id="policy-status" role="status"></span></div></div></form>
      </div>
      <article class="panel top-gap"><div class="panel-head"><div><h3>Retention and export</h3><p>Export before purge or deletion. Audit purges retain the signed anchor boundary.</p></div><button class="btn secondary" id="retention-purge" type="button">Purge expired audits</button></div><div class="panel-body"><label class="confirm"><input id="retention-confirm" type="checkbox">I understand this permanently removes audits older than the tenant retention window.</label><p class="form-status" id="retention-status" role="status"></p></div><div class="destructive"><h3>Request tenant deletion</h3><p>Type the exact tenant ID. This immediately locks operational access; an operator must still verify a current export before deleting data.</p><div class="destructive-row"><input class="field" id="deletion-confirm" autocomplete="off" placeholder="Exact tenant ID"><button class="btn danger" id="request-deletion" type="button">Request tenant deletion</button></div><p id="deletion-result" role="status"></p></div></article>
      <div class="evidence-grid top-gap">${evidenceBlock('lifecycle', 'Lifecycle evidence')}${evidenceBlock('policy', 'Policy evidence')}</div>
    </section>
  </main>
</section>
</div>
<dialog class="action-dialog" id="action-dialog" aria-labelledby="action-dialog-title" aria-describedby="action-dialog-copy">
  <div class="dialog-surface">
    <div class="dialog-mark" id="action-dialog-mark" aria-hidden="true">?</div>
    <div class="dialog-copy">
      <span class="dialog-kicker" id="action-dialog-kicker">Confirm action</span>
      <h2 id="action-dialog-title">Continue?</h2>
      <p id="action-dialog-copy"></p>
    </div>
    <label class="dialog-input" id="action-dialog-input-wrap" hidden><span id="action-dialog-input-label"></span><input class="field mono-input" id="action-dialog-input" autocomplete="off"></label>
    <p class="dialog-error" id="action-dialog-error" role="alert"></p>
    <div class="dialog-actions">
      <button class="btn secondary" id="action-dialog-cancel" type="button">Cancel</button>
      <button class="btn" id="action-dialog-confirm" type="button">Confirm</button>
    </div>
  </div>
</dialog>
<script type="module" src="/dashboard/app.js"></script></body></html>`;
}
