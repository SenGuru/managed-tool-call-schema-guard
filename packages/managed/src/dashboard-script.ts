export const dashboardScript = `
const q=id=>document.getElementById(id);
const reduceMotion=matchMedia('(prefers-reduced-motion:reduce)').matches;
const routeMeta={
  overview:{title:'Protection overview',description:'Current readiness, usage, decisions, and open operational work.'},
  decisions:{title:'Tool-call decisions',description:'Validate calls and inspect accountable valid, repaired, and rejected outcomes.'},
  schemas:{title:'Schemas & releases',description:'Register contracts, review drift, and control runtime admission by environment.'},
  actions:{title:'Actions & approvals',description:'Govern high-risk execution through approval, idempotency, anchors, and reconciliation.'},
  alerts:{title:'Alerts & delivery',description:'Review incidents and operate signed webhook delivery, retry, dead-letter, and redrive.'},
  evidence:{title:'Evidence & integrity',description:'Verify audit chains, signed control state, rulesets, and tenant exports.'},
  workbench:{title:'Managed API workbench',description:'Use editable, guarded requests for the complete managed API surface.'},
  settings:{title:'Tenant settings',description:'Inspect lifecycle, policy, keys, billing boundaries, retention, and deletion controls.'}
};
const shell=q('app-shell');
const workspace=q('workspace');
let mobileNavOpener=null;
let loadGeneration=0;
let activeLoadController=null;
const routeViews=Array.from(document.querySelectorAll('[data-route-view]'));
const routeLinks=Array.from(document.querySelectorAll('.nav-link[data-route]'));
const allRouteTriggers=Array.from(document.querySelectorAll('[data-route]'));
const routeFromPath=()=>{
  const segment=location.pathname.replace(/\\/+$/u,'').split('/').pop();
  return segment&&routeMeta[segment]?segment:'overview';
};
function closeMobileNav({restoreFocus=true}={}){
  const wasOpen=shell.dataset.mobileNav==='open';
  shell.dataset.mobileNav='closed';
  q('mobile-nav-toggle').setAttribute('aria-expanded','false');
  q('mobile-nav-toggle').setAttribute('aria-label','Open navigation');
  if(wasOpen&&restoreFocus&&mobileNavOpener)mobileNavOpener.focus();
  mobileNavOpener=null;
}
function navigate(route,{replace=false}={}){
  if(!routeMeta[route])route='overview';
  for(const view of routeViews){
    const active=view.dataset.routeView===route;
    view.hidden=!active;
    if(active&&!reduceMotion){view.dataset.entering='true';setTimeout(()=>delete view.dataset.entering,170)}
  }
  for(const link of routeLinks){
    if(link.dataset.route===route)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  q('page-title').textContent=routeMeta[route].title;
  q('page-description').textContent=routeMeta[route].description;
  document.title='Akriven / '+routeMeta[route].title;
  const path='/dashboard/'+route;
  if(location.pathname!==path){
    if(replace)history.replaceState({route},'',path);else history.pushState({route},'',path);
  }
  closeMobileNav({restoreFocus:false});
  q('main-content').focus({preventScroll:true});
}
for(const link of allRouteTriggers)link.addEventListener('click',event=>{
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();navigate(link.dataset.route);
});
for(const button of document.querySelectorAll('[data-route-target]'))button.addEventListener('click',()=>navigate(button.dataset.routeTarget));
addEventListener('popstate',()=>navigate(routeFromPath(),{replace:true}));
q('sidebar-toggle').onclick=()=>{
  const collapsed=shell.dataset.sidebar!=='collapsed';
  shell.dataset.sidebar=collapsed?'collapsed':'expanded';
  q('sidebar-toggle').setAttribute('aria-expanded',String(!collapsed));
  q('sidebar-toggle').setAttribute('aria-label',collapsed?'Expand navigation':'Collapse navigation');
  try{localStorage.setItem('akriven-sidebar',collapsed?'collapsed':'expanded')}catch{}
};
q('mobile-nav-toggle').onclick=()=>{
  const open=shell.dataset.mobileNav!=='open';
  shell.dataset.mobileNav=open?'open':'closed';
  q('mobile-nav-toggle').setAttribute('aria-expanded',String(open));
  q('mobile-nav-toggle').setAttribute('aria-label',open?'Close navigation':'Open navigation');
  if(open){mobileNavOpener=document.activeElement;requestAnimationFrame(()=>q('sidebar').querySelector('a,button')?.focus())}else closeMobileNav();
};
q('mobile-backdrop').onclick=()=>closeMobileNav();
addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeMobileNav();return}
  if(event.key!=='Tab'||shell.dataset.mobileNav!=='open')return;
  const focusable=Array.from(q('sidebar').querySelectorAll('a[href],button:not([disabled])'));
  if(focusable.length===0)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
});
try{if(localStorage.getItem('akriven-sidebar')==='collapsed'){shell.dataset.sidebar='collapsed';q('sidebar-toggle').setAttribute('aria-expanded','false');q('sidebar-toggle').setAttribute('aria-label','Expand navigation')}}catch{}
navigate(routeFromPath(),{replace:true});

const panelIds=['lifecycle','usage','chain','alerts','releases','schemas','policy','descriptors','challenges','intelligence','audits','webhooks','deliveries','actions','reconciliation','billing','control-integrity','rulesets','api-keys','export-result'];
const clearPanels=()=>{for(const id of panelIds)q(id).textContent='—'};
function resetDerivedViews(){
  for(const id of ['usage-total','usage-limit','accept-rate','repair-total','rejection-total','plan-name','open-alert-total','environment-total','api-key-total'])text(id,'—');
  text('tenant-name','Tenant workspace');text('tenant-avatar','A');text('protection-state-text','Awaiting tenant');
  q('protection-state').className='status-pill';q('quota-meter').style.removeProperty('--quota-scale');q('quota-meter-track').setAttribute('aria-valuenow','0');
  q('decision-rows').replaceChildren();q('decision-empty').hidden=false;
  const resetList=(id,message)=>{const list=q(id);list.replaceChildren();const row=document.createElement('li');row.textContent=message;list.append(row)};
  resetList('readiness-list','Load the workspace to evaluate readiness.');
  resetList('alert-list','Load the workspace to review alerts.');
  resetList('alerts-page-list','Load the workspace to review alerts.');
}
const parseBody=async response=>{const body=await response.text();if(!body)return null;try{return JSON.parse(body)}catch{return {unparsed_response:true}}};
async function requestRaw(path,options={},key=q('key').value){
  const response=await fetch(path,{...options,headers:{authorization:'Bearer '+key,...options.headers},cache:'no-store'});
  return {status:response.status,ok:response.ok,body:await parseBody(response)};
}
async function request(path,options={},key){
  const result=await requestRaw(path,options,key);
  if(!result.ok)throw new Error(result.body?.message||result.body?.error||('HTTP '+result.status));
  return result.body;
}
const get=(path,options,key)=>request(path,options,key);
const getOptional=async(path,options,key)=>{const result=await requestRaw(path,options,key);if(result.ok)return result.body;if(result.status===404)return {status:'not_configured',detail:result.body};throw new Error(result.body?.message||result.body?.error||('HTTP '+result.status))};
const compactAudits=items=>items.map(({audit_id,occurred_at,decision,reason_code,repair_rules})=>({audit_id,occurred_at,decision,reason_code,repair_rules}));
const compactAlerts=items=>items.map(({id,kind,severity,created_at,acknowledged_at,detail})=>({id,kind,severity,created_at,acknowledged_at,detail}));
const text=(id,value)=>{q(id).textContent=String(value)};
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const percent=value=>Math.max(0,Math.min(100,value));
function renderChecklist(items){
  const list=q('readiness-list');list.replaceChildren();
  for(const item of items){
    const row=document.createElement('li');
    const icon=document.createElement('span');icon.className='check'+(item.ready?'':' open');icon.textContent=item.ready?'✓':'!';
    const copy=document.createElement('span');const title=document.createElement('b');title.textContent=item.label;const note=document.createElement('small');note.textContent=item.note;copy.append(title,note);
    const state=document.createElement('small');state.textContent=item.ready?'Ready':'Needs attention';
    row.append(icon,copy,state);list.append(row);
  }
}
function renderDecisions(items){
  const body=q('decision-rows');body.replaceChildren();
  for(const item of items.slice(0,12)){
    const row=document.createElement('tr');
    const time=document.createElement('td');time.textContent=new Date(item.occurred_at).toLocaleString();
    const decision=document.createElement('td');decision.className='decision '+item.decision;decision.textContent=item.decision;
    const reason=document.createElement('td');reason.textContent=item.reason_code||'—';
    const audit=document.createElement('td');const code=document.createElement('code');code.textContent=String(item.audit_id).slice(0,18)+'…';audit.append(code);
    row.append(time,decision,reason,audit);body.append(row);
  }
  q('decision-empty').hidden=items.length>0;
}
function renderAlerts(items){
  for(const list of [q('alert-list'),q('alerts-page-list')]){
    list.replaceChildren();
    for(const item of items.filter(alert=>!alert.acknowledged_at).slice(0,8)){
      const row=document.createElement('li');
      const icon=document.createElement('span');icon.className='check open';icon.textContent='!';
      const copy=document.createElement('span');const title=document.createElement('b');title.textContent=item.kind;const note=document.createElement('small');note.textContent=new Date(item.created_at).toLocaleString();copy.append(title,note);
      const action=document.createElement('button');action.type='button';action.className='btn secondary';action.textContent='Acknowledge';action.onclick=async()=>{
        if(!window.confirm('Acknowledge this alert for the tenant?'))return;
        action.disabled=true;
        try{await request('/v1/alerts/'+encodeURIComponent(item.id)+'/acknowledge',{method:'POST'});q('load').click()}catch(error){q('status').className='bad';q('status').textContent=error instanceof Error?error.message:'Acknowledgement failed';action.disabled=false}
      };
      row.append(icon,copy,action);list.append(row);
    }
    if(list.children.length===0){const row=document.createElement('li');row.textContent='No open alerts.';list.append(row)}
  }
}
function renderOverview(data){
  const usage=data.usage.usage||{};
  const total=number(usage.validation_count);
  const repaired=number(usage.repair_count);
  const rejected=number(usage.rejection_count);
  const accepted=Math.max(0,total-rejected);
  const quota=number(data.usage.monthly_limit);
  const quotaPercent=quota===0?0:percent(total/quota*100);
  const environments=data.environments.environments||[];
  const releases=data.releases.releases||[];
  const schemas=data.schemas.schemas||[];
  const descriptors=data.descriptors.descriptors||[];
  const pendingChallenges=(data.challenges.challenges||[]).filter(item=>item.status==='pending');
  const production=environments.find(item=>item.name==='production');
  const productionReleased=releases.some(item=>item.environment==='production');
  const openAlerts=(data.alerts.alerts||[]).filter(item=>!item.acknowledged_at);
  const integrityValid=Boolean(data.integrity.valid??data.integrity.control_plane_valid);
  const tenantName=data.lifecycle.tenant_name||data.lifecycle.tenant_id||'Tenant';
  text('tenant-name',tenantName);
  text('tenant-avatar',tenantName.slice(0,1).toUpperCase());
  text('plan-name',data.usage.plan_name||data.usage.plan);
  text('usage-total',total.toLocaleString());
  text('usage-limit',quota.toLocaleString()+' included');
  text('accept-rate',total===0?'—':(accepted/total*100).toFixed(1)+'%');
  text('repair-total',repaired.toLocaleString());
  text('rejection-total',rejected.toLocaleString());
  text('environment-total',environments.length.toLocaleString());
  text('open-alert-total',openAlerts.length.toLocaleString());
  text('api-key-total',(data.apiKeys.api_keys||[]).filter(item=>item.revoked_at===null).length.toLocaleString());
  q('quota-meter').style.setProperty('--quota-scale',(quotaPercent/100).toFixed(3));
  q('quota-meter-track').setAttribute('aria-valuenow',quotaPercent.toFixed(1));
  q('protection-state').className='status-pill '+(integrityValid?'':'bad');
  text('protection-state-text',integrityValid?'Protection healthy':'Integrity attention required');
  renderChecklist([
    {label:'Control-plane integrity',ready:integrityValid,note:integrityValid?'Signed state verified':'Open integrity details before action traffic'},
    {label:'Production schema admission',ready:Boolean(production&&production.schema_enforcement==='enforce'&&productionReleased),note:productionReleased?'Production has a reviewed release':'Promote and enforce a reviewed schema'},
    {label:'Schema registry',ready:schemas.length>0,note:schemas.length+' latest registered contract(s) are reachable'},
    {label:'Action classification',ready:descriptors.length>0,note:descriptors.length+' signed action descriptor(s) are reachable'},
    {label:'Approval queue',ready:pendingChallenges.length===0,note:pendingChallenges.length+' pending approval challenge(s)'},
    {label:'Independent checkpoint',ready:Boolean(data.checkpoint&&data.checkpoint.revision!==undefined),note:'Latest idempotency checkpoint is available for comparison'},
    {label:'Alert delivery',ready:(data.webhooks.webhooks||[]).some(item=>item.disabled_at===null||item.enabled===true),note:'Configure and exercise a customer-owned HTTPS receiver'},
    {label:'Audit chain',ready:Boolean(data.chain.valid),note:data.chain.valid?'Retained decisions verify':'Stop and investigate chain integrity'}
  ]);
  renderDecisions(data.audits.audits||[]);
  renderAlerts(data.alerts.alerts||[]);
}
q('load').onclick=async()=>{
  const generation=++loadGeneration;
  if(activeLoadController)activeLoadController.abort();
  const controller=new AbortController();activeLoadController=controller;
  const key=q('key').value;
  const options={signal:controller.signal};
  const loadGet=path=>get(path,options,key);
  const loadGetOptional=path=>getOptional(path,options,key);
  clearPanels();q('status').className='';q('status').textContent='Loading…';resetDerivedViews();workspace.dataset.connected='false';text('connection-label','Connecting');
  try{
    const lifecycle=await loadGet('/v1/admin/tenant/lifecycle');
    if(generation!==loadGeneration)return;
    q('lifecycle').textContent=JSON.stringify(lifecycle,null,2);
    text('tenant-name',lifecycle.tenant_name||lifecycle.tenant_id||'Tenant');
    text('tenant-avatar',String(lifecycle.tenant_name||lifecycle.tenant_id||'Tenant').slice(0,1).toUpperCase());
    if(lifecycle.lifecycle.status!=='active'){workspace.dataset.connected='false';text('connection-label','Access locked');q('protection-state').className='status-pill bad';text('protection-state-text','Tenant '+lifecycle.lifecycle.status);q('status').className='bad';q('status').textContent='Loaded — operational access is locked';return}
    const [usage,chain,audits,alerts,intelligence,environments,releases,releaseChain,schemas,policy,descriptors,challenges,webhooks,deliveries,checkpoint,anchorDeliveries,reconciliationPending,reconciliationHistory,reconciliationChain,billing,integrity,ruleset,apiKeys]=await Promise.all([
      loadGet('/v1/usage'),loadGet('/v1/audits/verify'),loadGet('/v1/audits?limit=25'),loadGet('/v1/alerts'),loadGet('/v1/intelligence'),loadGet('/v1/environments'),loadGet('/v1/schema-releases?limit=25'),loadGet('/v1/schema-releases/verify'),
      loadGet('/v1/schemas'),loadGet('/v1/admin/policy'),loadGet('/v1/admin/actions/descriptors'),loadGet('/v1/actions/challenges?limit=100'),
      loadGet('/v1/alert-webhooks'),loadGet('/v1/alert-webhooks/deliveries?limit=100'),loadGet('/v1/actions/idempotency/checkpoint'),loadGet('/v1/actions/idempotency/anchors/deliveries?limit=100'),
      loadGet('/v1/actions/reconciliation/pending'),loadGet('/v1/actions/reconciliation/history'),loadGet('/v1/actions/reconciliation/verify'),loadGet('/v1/billing/statement'),loadGet('/v1/admin/control-plane-integrity'),loadGetOptional('/v1/rulesets/latest'),loadGet('/v1/admin/api-keys')
    ]);
    if(generation!==loadGeneration)return;
    q('usage').textContent=JSON.stringify(usage,null,2);
    q('chain').textContent=JSON.stringify(chain,null,2);
    q('audits').textContent=JSON.stringify(compactAudits(audits.audits),null,2);
    q('alerts').textContent=JSON.stringify(compactAlerts(alerts.alerts),null,2);
    q('releases').textContent=JSON.stringify({environments:environments.environments,chain:releaseChain,releases:releases.releases},null,2);
    q('schemas').textContent=JSON.stringify(schemas,null,2);
    q('policy').textContent=JSON.stringify(policy,null,2);
    q('descriptors').textContent=JSON.stringify(descriptors,null,2);
    q('challenges').textContent=JSON.stringify(challenges,null,2);
    q('intelligence').textContent=JSON.stringify(intelligence,null,2);
    q('webhooks').textContent=JSON.stringify(webhooks,null,2);
    q('deliveries').textContent=JSON.stringify(deliveries,null,2);
    q('actions').textContent=JSON.stringify({checkpoint,anchor_deliveries:anchorDeliveries.deliveries},null,2);
    q('reconciliation').textContent=JSON.stringify({pending:reconciliationPending.pending,history:reconciliationHistory.history,chain:reconciliationChain},null,2);
    q('billing').textContent=JSON.stringify(billing,null,2);
    q('control-integrity').textContent=JSON.stringify(integrity,null,2);
    q('rulesets').textContent=JSON.stringify(ruleset,null,2);
    q('api-keys').textContent=JSON.stringify(apiKeys,null,2);
    renderOverview({lifecycle,usage,chain,audits,alerts,intelligence,environments,releases,releaseChain,schemas,policy,descriptors,challenges,webhooks,deliveries,checkpoint,anchorDeliveries,reconciliationPending,reconciliationHistory,reconciliationChain,billing,integrity,ruleset,apiKeys});
    workspace.dataset.connected='true';text('connection-label','Connected');q('status').className='good';q('status').textContent='Workspace loaded';
  }catch(error){if(generation!==loadGeneration||error?.name==='AbortError')return;workspace.dataset.connected='false';text('connection-label','Not connected');clearPanels();resetDerivedViews();q('status').className='bad';q('status').textContent=error instanceof Error?error.message:'Request failed'}
  finally{if(generation===loadGeneration)activeLoadController=null}
};
q('key').addEventListener('keydown',event=>{if(event.key==='Enter')q('load').click()});
q('export').onclick=async()=>{
  q('export-result').textContent='Preparing export…';
  try{
    const data=await get('/v1/admin/tenant/export');
    const blob=new Blob([JSON.stringify(data,null,2)+'\\n'],{type:'application/json'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='akriven-tenant-export.json';link.click();URL.revokeObjectURL(link.href);
    q('export-result').textContent=JSON.stringify({content_sha256:data.content_sha256,generated_at:data.generated_at,downloaded:true},null,2);
  }catch(error){q('export-result').textContent=error instanceof Error?error.message:'Export failed'}
};
q('export-secondary').onclick=()=>q('export').click();
q('request-deletion').onclick=async()=>{
  q('deletion-result').textContent='Submitting request…';
  try{
    const result=await request('/v1/admin/tenant/deletion-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm_tenant_id:q('deletion-confirm').value})});
    q('lifecycle').textContent=JSON.stringify({lifecycle:result.lifecycle},null,2);
    q('deletion-result').textContent='Deletion requested. An operator must verify the export before execution.';
    workspace.dataset.connected='false';text('connection-label','Access locked');
    q('status').className='bad';
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
for(const button of document.querySelectorAll('[data-preset]'))button.onclick=()=>{
  q('operation').value=button.dataset.preset;loadPreset();navigate('workbench');
};
`;
