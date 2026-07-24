export const dashboardStyle = `
:root{color-scheme:light}*{box-sizing:border-box}body{font:15px/1.5 system-ui;margin:2rem auto;max-width:1200px;padding:0 1rem;color:#18212f;background:#fff}
input,button,select,textarea{font:inherit;padding:.55rem;border:1px solid #aeb9c6;border-radius:6px}input,textarea{width:100%}button{cursor:pointer;margin-right:.4rem;background:#fff}button:hover{background:#eef3f8}
.credential-row{display:grid;grid-template-columns:minmax(18rem,1fr) auto auto;gap:.5rem;align-items:start}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin:1.5rem 0}
.card,.workbench{border:1px solid #dbe2ea;border-radius:10px;padding:1rem;background:#f8fafc;min-width:0}.workbench-grid{display:grid;grid-template-columns:10rem 1fr;gap:.75rem 1rem;align-items:start}.workbench-grid label{font-weight:650;padding-top:.55rem}
pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;overflow:auto;background:#111827;color:#e5e7eb;padding:1rem;border-radius:8px;font-size:12px;line-height:1.45;min-height:3rem}
textarea{min-height:15rem;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}.actions{margin-top:1rem}.confirm{display:flex;gap:.5rem;align-items:center;margin:.75rem 0}.confirm input{width:auto}
small{color:#526071}.bad{color:#a01616}.good{color:#126b39}.muted{color:#526071}@media(max-width:700px){body{margin-top:1rem}.credential-row,.workbench-grid{grid-template-columns:1fr}.workbench-grid label{padding-top:0}}
`;

export const dashboardScript = `
const q=id=>document.getElementById(id);
const panelIds=['lifecycle','usage','chain','alerts','releases','intelligence','audits','webhooks','deliveries','actions','reconciliation','billing','control-integrity','rulesets','export-result'];
const clearPanels=()=>{for(const id of panelIds)q(id).textContent='—'};
const parseBody=async response=>{const text=await response.text();if(!text)return null;try{return JSON.parse(text)}catch{return {unparsed_response:true}}};
async function requestRaw(path,options={}){
  const response=await fetch(path,{...options,headers:{authorization:'Bearer '+q('key').value,...options.headers},cache:'no-store'});
  return {status:response.status,ok:response.ok,body:await parseBody(response)};
}
async function request(path,options={}){
  const result=await requestRaw(path,options);
  if(!result.ok)throw new Error(result.body?.message||result.body?.error||('HTTP '+result.status));
  return result.body;
}
const get=path=>request(path);
const getOptional=async path=>{const result=await requestRaw(path);if(result.ok)return result.body;if(result.status===404)return {status:'not_configured',detail:result.body};throw new Error(result.body?.message||result.body?.error||('HTTP '+result.status))};
const compactAudits=items=>items.map(({audit_id,occurred_at,decision,reason_code,repair_rules})=>({audit_id,occurred_at,decision,reason_code,repair_rules}));
const compactAlerts=items=>items.map(({id,kind,severity,created_at,acknowledged_at,detail})=>({id,kind,severity,created_at,acknowledged_at,detail}));
q('load').onclick=async()=>{
  clearPanels();q('status').className='';q('status').textContent='Loading…';
  try{
    const lifecycle=await get('/v1/admin/tenant/lifecycle');
    q('lifecycle').textContent=JSON.stringify(lifecycle,null,2);
    if(lifecycle.lifecycle.status!=='active'){q('status').textContent='Loaded — operational access is locked';return}
    const [usage,chain,audits,alerts,intelligence,environments,releases,releaseChain,webhooks,deliveries,checkpoint,anchorDeliveries,reconciliationPending,reconciliationHistory,reconciliationChain,billing,integrity,ruleset]=await Promise.all([
      get('/v1/usage'),get('/v1/audits/verify'),get('/v1/audits?limit=25'),get('/v1/alerts'),get('/v1/intelligence'),get('/v1/environments'),get('/v1/schema-releases?limit=25'),get('/v1/schema-releases/verify'),
      get('/v1/alert-webhooks'),get('/v1/alert-webhooks/deliveries?limit=100'),get('/v1/actions/idempotency/checkpoint'),get('/v1/actions/idempotency/anchors/deliveries?limit=100'),
      get('/v1/actions/reconciliation/pending'),get('/v1/actions/reconciliation/history'),get('/v1/actions/reconciliation/verify'),get('/v1/billing/statement'),get('/v1/admin/control-plane-integrity'),getOptional('/v1/rulesets/latest')
    ]);
    q('usage').textContent=JSON.stringify(usage,null,2);
    q('chain').textContent=JSON.stringify(chain,null,2);
    q('audits').textContent=JSON.stringify(compactAudits(audits.audits),null,2);
    q('alerts').textContent=JSON.stringify(compactAlerts(alerts.alerts),null,2);
    q('releases').textContent=JSON.stringify({environments:environments.environments,chain:releaseChain,releases:releases.releases},null,2);
    q('intelligence').textContent=JSON.stringify(intelligence,null,2);
    q('webhooks').textContent=JSON.stringify(webhooks,null,2);
    q('deliveries').textContent=JSON.stringify(deliveries,null,2);
    q('actions').textContent=JSON.stringify({checkpoint,anchor_deliveries:anchorDeliveries.deliveries},null,2);
    q('reconciliation').textContent=JSON.stringify({pending:reconciliationPending.pending,history:reconciliationHistory.history,chain:reconciliationChain},null,2);
    q('billing').textContent=JSON.stringify(billing,null,2);
    q('control-integrity').textContent=JSON.stringify(integrity,null,2);
    q('rulesets').textContent=JSON.stringify(ruleset,null,2);
    q('status').className='good';q('status').textContent='Loaded';
  }catch(error){clearPanels();q('status').className='bad';q('status').textContent=error instanceof Error?error.message:'Request failed'}
};
q('export').onclick=async()=>{
  q('export-result').textContent='Preparing export…';
  try{
    const data=await get('/v1/admin/tenant/export');
    const blob=new Blob([JSON.stringify(data,null,2)+'\\n'],{type:'application/json'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='akriven-tenant-export.json';link.click();URL.revokeObjectURL(link.href);
    q('export-result').textContent=JSON.stringify({content_sha256:data.content_sha256,generated_at:data.generated_at,downloaded:true},null,2);
  }catch(error){q('export-result').textContent=error instanceof Error?error.message:'Export failed'}
};
q('request-deletion').onclick=async()=>{
  q('deletion-result').textContent='Submitting request…';
  try{
    const result=await request('/v1/admin/tenant/deletion-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm_tenant_id:q('deletion-confirm').value})});
    q('lifecycle').textContent=JSON.stringify({lifecycle:result.lifecycle},null,2);
    q('deletion-result').textContent='Deletion requested. An operator must verify the export before execution.';
    q('status').textContent='Loaded — operational access is locked';
  }catch(error){q('deletion-result').textContent=error instanceof Error?error.message:'Deletion request failed'}
};
const presets={
  validate:{method:'POST',path:'/v1/validate',body:{tool_name:'counter',tool_schema:{type:'object',additionalProperties:false,required:['count'],properties:{count:{type:'integer'}}},raw_arguments:{count:'2'},context:{environment:'development',adapter:'json_schema'}}},
  compile_contract:{method:'POST',path:'/v1/contracts/compile',body:{target:'mcp',tool_name:'counter',tool_schema:{type:'object',additionalProperties:false,required:['count'],properties:{count:{type:'integer'}}}}},
  register_schema:{method:'POST',path:'/v1/schemas',body:{tool_name:'counter',adapter:'json_schema',version:'1',schema:{type:'object',additionalProperties:false,required:['count'],properties:{count:{type:'integer'}}}}},
  release_schema:{method:'POST',path:'/v1/schema-releases',body:{environment:'development',tool_name:'counter',adapter:'json_schema',version:'1',expected_schema_hash:'[REPLACE:SCHEMA_HASH]'}},
  create_environment:{method:'POST',path:'/v1/admin/environments',body:{name:'sandbox',policy:{}}},
  environment_policy:{method:'PUT',path:'/v1/admin/environments/{ENVIRONMENT_ID}/policy',body:{max_repairs:1,require_closed_schema:true}},
  environment_enforcement:{method:'PUT',path:'/v1/admin/environments/{ENVIRONMENT_ID}/schema-enforcement',body:{mode:'enforce'}},
  organization_policy:{method:'PUT',path:'/v1/admin/policy',body:{max_repairs:1,require_closed_schema:true}},
  action_descriptor:{method:'PUT',path:'/v1/admin/actions/descriptors',body:{tool_name:'counter',environment:'development',risk_level:'high',side_effect:'reversible'}},
  action_challenge:{method:'POST',path:'/v1/actions/challenges',body:{tool_name:'counter',environment:'development',decision:'[REPLACE:ACCEPTED_DECISION_OBJECT]',expires_in_seconds:300}},
  action_approve:{method:'POST',path:'/v1/actions/challenges/{CHALLENGE_ID}/approve',body:{}},
  action_cancel:{method:'DELETE',path:'/v1/actions/challenges/{CHALLENGE_ID}',body:null,mutation:true},
  action_evaluate:{method:'POST',path:'/v1/actions/evaluate',body:{tool_name:'counter',environment:'development',decision:'[REPLACE:ACCEPTED_DECISION_OBJECT]',idempotency_key:'[REPLACE:UNIQUE_IDEMPOTENCY_KEY]',approval:'[REPLACE:APPROVED_CHALLENGE_OBJECT]'}},
  action_complete:{method:'POST',path:'/v1/actions/idempotency/complete',body:{idempotency_key:'[REPLACE:UNIQUE_IDEMPOTENCY_KEY]',execution_fingerprint:'[REPLACE:EXECUTION_FINGERPRINT]'}},
  action_release:{method:'POST',path:'/v1/actions/idempotency/release',body:{idempotency_key:'[REPLACE:UNIQUE_IDEMPOTENCY_KEY]',execution_fingerprint:'[REPLACE:EXECUTION_FINGERPRINT]'},mutation:true},
  checkpoint_compare:{method:'POST',path:'/v1/actions/idempotency/checkpoint/compare',body:{checkpoint:'[REPLACE:CHECKPOINT_OBJECT]'}},
  anchor_redrive:{method:'POST',path:'/v1/actions/idempotency/anchors/deliveries/{DELIVERY_ID}/redrive',body:{}},
  reconcile:{method:'POST',path:'/v1/actions/reconciliation/{RESERVATION_ID}',body:{outcome:'confirmed_executed',evidence_reference:'[REPLACE:LEDGER_REFERENCE]'},mutation:true},
  conformance_run:{method:'POST',path:'/v1/conformance-runs',body:{provider:'openai',provider_version:'[REPLACE:PINNED_PROVIDER_VERSION]',framework:'openai-agents',framework_version:'[REPLACE:PINNED_FRAMEWORK_VERSION]',adapter:'openai_agents',suite_version:'[REPLACE:REVIEWED_SUITE_VERSION]',executed_at:'[REPLACE:EXECUTION_TIMESTAMP]',passed:1,failed:0,repaired:0,rejected:0}},
  webhook_create:{method:'POST',path:'/v1/alert-webhooks',body:{label:'on-call',endpoint:'[REPLACE:PUBLIC_HTTPS_WEBHOOK_URL]'}},
  webhook_redrive:{method:'POST',path:'/v1/alert-webhooks/deliveries/{DELIVERY_ID}/redrive',body:{}},
  webhook_disable:{method:'DELETE',path:'/v1/alert-webhooks/{WEBHOOK_ID}',body:null,mutation:true},
  publish_ruleset:{method:'POST',path:'/v1/admin/rulesets',body:{version:'[REPLACE:UNIQUE_RULESET_VERSION]',issued_at:'',expires_at:'',rules:[{id:'coerce.string_to_integer',enabled_by_default:true,description:'Exact integer strings'}]}},
  create_api_key:{method:'POST',path:'/v1/admin/api-keys',body:{scopes:['validate','compile','evaluate:action','approve:action','reconcile:action','manage:webhooks','promote:schema','read:audit','read:alerts','read:billing','read:environment','read:intelligence','read:ruleset','read:usage','write:schema','admin']}},
  revoke_api_key:{method:'DELETE',path:'/v1/admin/api-keys/{KEY_ID}',body:null,mutation:true},
  billing_checkout:{method:'POST',path:'/v1/billing/checkout-session',body:null,mutation:true},
  billing_portal:{method:'POST',path:'/v1/billing/portal-session',body:null,mutation:true},
  plan_change:{method:'PUT',path:'/v1/admin/plan',body:{plan:'team'},mutation:true},
  retention_purge:{method:'POST',path:'/v1/admin/retention/purge',body:{before:'2025-01-01T00:00:00.000Z'},mutation:true}
};
function loadPreset(){
  const preset=presets[q('operation').value];
  const body=preset.body===null?null:structuredClone(preset.body);
  if(q('operation').value==='publish_ruleset'&&body){const issued=new Date();body.issued_at=issued.toISOString();body.expires_at=new Date(issued.getTime()+30*24*60*60*1000).toISOString()}
  q('operation-method').value=preset.method;q('operation-path').value=preset.path;q('operation-body').value=body===null?'':JSON.stringify(body,null,2);
  q('operation-confirm').checked=false;q('operation-result').textContent='—';
  q('operation-help').textContent=preset.mutation?'This operation changes or removes state and requires confirmation.':'Review and edit every placeholder before execution.';
}
q('operation').onchange=loadPreset;
q('operation-load').onclick=loadPreset;
q('operation-run').onclick=async()=>{
  q('operation-result').textContent='Executing…';
  try{
    const method=q('operation-method').value.toUpperCase();
    const path=q('operation-path').value.trim();
    if(!path.startsWith('/v1/'))throw new Error('Path must start with /v1/');
    if(/[{}]/u.test(path))throw new Error('Replace every path placeholder before execution');
    if(method!=='GET'&&!q('operation-confirm').checked)throw new Error('Confirm this mutation before executing');
    const raw=q('operation-body').value.trim();
    if(/\\[REPLACE:[A-Z0-9_]+\\]/u.test(raw))throw new Error('Replace every JSON placeholder before execution');
    const options={method,headers:{}};
    if(raw){options.headers['content-type']='application/json';options.body=JSON.stringify(JSON.parse(raw))}
    const result=await requestRaw(path,options);
    q('operation-result').textContent=JSON.stringify(result,null,2);
    q('operation-result').className=result.ok?'':'bad';
  }catch(error){q('operation-result').className='bad';q('operation-result').textContent=error instanceof Error?error.message:'Operation failed'}
};
loadPreset();
`;

export function dashboardHtml(publicMode = false): string {
  const title = publicMode ? 'Schema Guard Control Plane' : 'Schema Guard Local Control Plane';
  const description = publicMode
    ? "Enter a tenant API key. It remains only in this tab's memory and is sent to this service origin over its configured TLS connection."
    : "Enter a tenant API key. It remains only in this tab's memory and is sent to this loopback service origin.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${title}</title><link rel="stylesheet" href="/dashboard/app.css"></head>
<body><h1>${title}</h1><p>${description}</p>
<div class="credential-row"><input id="key" type="password" autocomplete="off" placeholder="sg_live_…"><button id="load" type="button">Load complete control plane</button><button id="export" type="button">Download tenant export</button></div><p id="status"></p>
<div class="grid">
<div class="card"><h2>Tenant lifecycle</h2><pre id="lifecycle">—</pre></div><div class="card"><h2>Usage</h2><pre id="usage">—</pre></div><div class="card"><h2>Audit chain</h2><pre id="chain">—</pre></div><div class="card"><h2>Alerts</h2><pre id="alerts">—</pre></div>
<div class="card"><h2>Alert webhooks</h2><pre id="webhooks">—</pre></div><div class="card"><h2>Webhook deliveries</h2><pre id="deliveries">—</pre></div><div class="card"><h2>Action checkpoint</h2><pre id="actions">—</pre></div><div class="card"><h2>Reconciliation</h2><pre id="reconciliation">—</pre></div>
<div class="card"><h2>Billing boundary</h2><pre id="billing">—</pre></div><div class="card"><h2>Control-plane integrity</h2><pre id="control-integrity">—</pre></div><div class="card"><h2>Latest ruleset</h2><pre id="rulesets">—</pre></div>
</div>
<h2>Managed API workbench</h2><p>Exercise every managed workflow through this browser boundary. Presets are editable examples, not trusted defaults. Replace placeholders and review the exact request before execution.</p>
<section class="workbench"><div class="workbench-grid">
<label for="operation">Preset</label><div><select id="operation">
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
</div><p id="operation-help" class="muted"></p><label class="confirm"><input id="operation-confirm" type="checkbox">I reviewed this exact request and authorize this mutation.</label><div class="actions"><button id="operation-run" type="button">Execute request</button></div><pre id="operation-result">—</pre></section>
<h2>Tenant export</h2><pre id="export-result">—</pre><small>Exports include tenant-owned configuration and evidence, but never API-key verifiers or encrypted webhook credentials.</small>
<h2>Request tenant deletion</h2><p>Type the exact tenant ID. This locks operational access immediately; an operator must still verify a current export before deleting data.</p><input id="deletion-confirm" autocomplete="off" placeholder="Exact tenant ID"><button id="request-deletion" type="button">Request deletion</button><p id="deletion-result"></p>
<h2>Environment schema releases</h2><pre id="releases">—</pre><small>Observation/enforcement mode, promoted versions, compatibility, and release-chain integrity.</small>
<h2>Compatibility intelligence</h2><pre id="intelligence">—</pre><small>Value-free failure clusters, schema quality, compatibility results, and recommended actions.</small>
<h2>Recent decisions</h2><pre id="audits">—</pre><small>No argument values are stored or shown.</small>
<script type="module" src="/dashboard/app.js"></script></body></html>`;
}
