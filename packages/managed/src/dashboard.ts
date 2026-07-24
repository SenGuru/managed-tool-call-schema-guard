export const dashboardStyle = `
/*
THESIS: Akriven's control plane is an accountable instrument, not a generic SaaS dashboard.
OWN-WORLD: Warm paper, near-black ink, one-pixel rules, acid-lime action, and compact mono evidence.
STORY: Load a workspace, assess protection, run the lifecycle, then inspect exact evidence and controls.
FIRST VIEWPORT: A quiet product bar, credential gate, 240px navigation, protection status, and four metrics.
FORM: Restrained console/observability shell derived from the established commercial identity and Astryx dashboard frame.
*/
:root{color-scheme:light;--ink:#11131a;--ink-2:#1a1d24;--paper:#f5f4ee;--paper-deep:#ebe9df;--white:#fffefa;--acid:#ddfe52;--mint:#72e6b1;--coral:#ff6b5e;--muted:#686b66;--line:rgba(17,19,26,.17);--line-strong:rgba(17,19,26,.42);--green:#14734f;--amber:#8a5700;--red:#b12b22;--duration-fast:175ms;--ease:cubic-bezier(.24,1,.4,1);--sans:Geist,"Helvetica Neue",Arial,ui-sans-serif,system-ui,sans-serif;--mono:"Geist Mono","SFMono-Regular",Consolas,ui-monospace,monospace}
*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--paper-deep)}body{font:14px/1.5 var(--sans);margin:0;color:var(--ink);background:var(--paper-deep);-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.48}a,button,input,select,textarea,summary{outline:none}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{box-shadow:0 0 0 2px var(--paper),0 0 0 4px var(--ink),0 0 0 6px var(--acid)}
::selection{color:var(--ink);background:var(--acid)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.skip-link{position:fixed;z-index:1000;left:1rem;top:1rem;padding:.65rem .8rem;color:var(--paper);background:var(--ink);border:1px solid var(--ink);box-shadow:3px 3px 0 var(--acid);transform:translateY(-200%)}.skip-link:focus{transform:translateY(0)}.shell{max-width:1440px;margin:auto;min-height:100vh;background:var(--paper);border-inline:1px solid var(--line)}.topbar{height:74px;display:flex;justify-content:space-between;align-items:center;padding:0 1.5rem;background:rgba(245,244,238,.94);border-bottom:1px solid var(--line);color:var(--ink)}.brand{display:flex;align-items:center;gap:.7rem;font-weight:650;letter-spacing:-.03em;font-size:17px}.brand-mark{display:block;width:34px;height:34px;flex:none}.topbar small{color:var(--muted);font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase}
.credential{padding:1rem 1.5rem;background:var(--paper-deep);border-bottom:1px solid var(--line)}.credential-row{display:grid;grid-template-columns:minmax(18rem,1fr) auto auto;gap:.6rem;align-items:start}.credential input,.workbench input,.workbench select,.workbench textarea,.destructive input{width:100%;min-height:42px;padding:.62rem .75rem;border:1px solid var(--line-strong);border-radius:4px;background:var(--white);transition:border-color var(--duration-fast) var(--ease),box-shadow var(--duration-fast) var(--ease)}.credential input:hover,.workbench input:hover,.workbench select:hover,.workbench textarea:hover,.destructive input:hover{border-color:var(--ink)}.credential>small{display:block;margin-top:.45rem;max-width:75ch}.credential #status{min-height:1.5em;margin:.35rem 0 0;font-family:var(--mono);font-size:11px}.credential #status:empty{display:none}.btn,.workbench button{min-height:42px;border:1px solid var(--ink);border-radius:3px;padding:.62rem .9rem;font-weight:650;background:var(--ink);color:var(--paper);box-shadow:3px 3px 0 var(--acid);transition:transform var(--duration-fast) var(--ease),box-shadow var(--duration-fast) var(--ease),background var(--duration-fast) var(--ease)}.btn:hover,.workbench button:hover{transform:translate(1px,1px);box-shadow:2px 2px 0 var(--acid)}.btn:active,.workbench button:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--acid)}.btn.secondary{background:var(--white);color:var(--ink);box-shadow:none}.btn.secondary:hover{background:var(--acid);transform:none}.btn.danger{background:var(--white);color:var(--red);border-color:var(--red);box-shadow:none}.btn.danger:hover{color:var(--white);background:var(--red);transform:none}
.layout{display:grid;grid-template-columns:240px minmax(0,1fr)}.sidebar{padding:1.25rem .9rem;border-right:1px solid var(--line);background:var(--paper)}.sidebar strong{display:block;padding:.6rem .75rem .85rem;font-weight:650;letter-spacing:-.02em}.sidebar a{display:block;color:var(--muted);text-decoration:none;padding:.6rem .75rem;border:1px solid transparent;border-radius:3px;margin:.1rem 0;transition:color var(--duration-fast) var(--ease),background var(--duration-fast) var(--ease),border-color var(--duration-fast) var(--ease)}.sidebar a:hover{color:var(--ink);background:var(--paper-deep);border-color:var(--line)}.sidebar a:active{background:var(--acid)}main{padding:1.75rem;min-width:0}.hero-row{display:flex;justify-content:space-between;gap:1rem;align-items:start;margin-bottom:1.2rem}.hero-row h1{margin:0;font-size:1.75rem;line-height:1.2;letter-spacing:-.035em;font-weight:620}.hero-row p{margin:.3rem 0 0;color:var(--muted)}
.status-pill{display:inline-flex;align-items:center;gap:.45rem;padding:.42rem .65rem;border:1px solid currentColor;border-radius:999px;background:rgba(114,230,177,.2);color:var(--green);font-weight:650;white-space:nowrap}.status-pill.bad{background:rgba(255,107,94,.12);color:var(--red)}.status-pill.warn{background:var(--acid);color:var(--ink);border-color:var(--ink)}.dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1rem 0 1.5rem}.metric,.panel,.workflow-card,.advanced{background:var(--white);border:1px solid var(--line);border-radius:8px}.metric{padding:1rem}.metric small{display:block;color:var(--muted);font-family:var(--mono);text-transform:uppercase;letter-spacing:.07em;font-size:10px}.metric strong{display:block;font-size:1.65rem;line-height:1.2;letter-spacing:-.035em;font-weight:620;margin:.3rem 0}.metric span{color:var(--muted);font-size:12px}.meter{height:5px;background:var(--paper-deep);border-radius:999px;overflow:hidden;margin-top:.75rem}.meter i{display:block;height:100%;width:100%;background:var(--acid);border-right:1px solid var(--ink);transform:scaleX(var(--quota-scale,0));transform-origin:left;transition:transform 230ms var(--ease)}
.section-head{display:flex;justify-content:space-between;align-items:end;margin:1.8rem 0 .75rem}.section-head h2{margin:0;font-size:1.12rem;line-height:1.4;letter-spacing:-.025em;font-weight:620}.section-head p{margin:.1rem 0 0;color:var(--muted);font-size:12px}.workflow-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem}.workflow-card{padding:1rem;position:relative}.workflow-card b{display:block;margin-bottom:.25rem;padding-right:2rem;font-weight:650}.workflow-card p{color:var(--muted);margin:.2rem 0 .8rem;min-height:2.8rem}.workflow-card button{border:0;background:none;color:var(--ink);padding:0;font-weight:650;text-decoration:underline;text-decoration-color:var(--acid);text-decoration-thickness:3px;text-underline-offset:3px;transition:text-decoration-thickness var(--duration-fast) var(--ease)}.workflow-card button:hover{text-decoration-thickness:7px}.workflow-card .step{position:absolute;right:.8rem;top:.8rem;color:var(--muted);font:650 10px var(--mono)}
.two-col{display:grid;grid-template-columns:1.15fr .85fr;gap:.75rem}.panel{padding:1rem;min-width:0;margin-top:1.5rem}.panel .section-head{margin:.1rem 0 .75rem}.panel h3{margin:0 0 .75rem;font-size:.95rem}.clean-list{list-style:none;padding:0;margin:0}.clean-list li{display:grid;grid-template-columns:auto 1fr auto;gap:.65rem;padding:.65rem 0;border-top:1px solid var(--line);align-items:center}.clean-list li:first-child{border-top:0}.clean-list small{color:var(--muted)}.check{width:19px;height:19px;display:grid;place-items:center;border-radius:50%;background:rgba(114,230,177,.24);color:var(--green);font-size:10px;font-weight:900}.check.open{background:var(--acid);color:var(--ink)}
.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;color:var(--muted);font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em}th,td{padding:.7rem .62rem;border-bottom:1px solid var(--line)}tbody tr:hover{background:rgba(221,254,82,.18)}td code{font:11px var(--mono)}.decision{font-weight:700}.decision.valid{color:var(--green)}.decision.valid_with_repair{color:var(--amber)}.decision.rejected{color:var(--red)}
details{margin-top:1.5rem}summary{cursor:pointer;width:max-content;font-weight:650;text-decoration:underline;text-decoration-color:var(--acid);text-decoration-thickness:3px;text-underline-offset:4px}.advanced{padding:1rem;margin-top:.85rem}.data-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:.7rem;margin-top:.8rem}.data-card{border:1px solid var(--line);border-radius:6px;padding:.8rem;min-width:0;background:var(--paper)}.data-card h3{font-size:12px;margin:0 0 .5rem}
pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;overflow:auto;background:var(--ink);color:var(--paper);padding:.8rem;border-radius:4px;font:11px/1.5 var(--mono);min-height:2.5rem;max-height:22rem}textarea{min-height:13rem;font:12px/1.5 var(--mono)}.workbench-grid{display:grid;grid-template-columns:10rem 1fr;gap:.7rem 1rem;align-items:start}.workbench-grid label{font-weight:600;padding-top:.55rem}.workbench-grid>div{display:flex;gap:.5rem}.workbench select{flex:1}.workbench #operation-load{background:var(--white);color:var(--ink);box-shadow:none}.actions{margin-top:1rem}.confirm{display:flex;gap:.5rem;align-items:center;margin:.75rem 0}.confirm input{width:auto;accent-color:var(--ink)}
.destructive{border-top:1px solid var(--line);margin-top:1.4rem;padding-top:1rem}.destructive input{max-width:32rem;margin-right:.5rem;border-color:rgba(177,43,34,.55)}.good{color:var(--green)}.bad{color:var(--red)}.muted,small{color:var(--muted)}
@media(max-width:1050px){.metrics{grid-template-columns:repeat(2,1fr)}.workflow-grid{grid-template-columns:repeat(2,1fr)}.two-col{grid-template-columns:1fr}.topbar small{display:none}}
@media(max-width:760px){.shell{border-inline:0}.layout{grid-template-columns:1fr}.sidebar{display:none}.credential-row,.workbench-grid{grid-template-columns:1fr}.workbench-grid>div{display:grid}.metrics,.workflow-grid,.data-grid{grid-template-columns:minmax(0,1fr)}.hero-row{display:block}.status-pill{margin-top:.8rem}main{padding:1rem}.topbar{height:64px;padding:0 1rem}.credential{padding:1rem}.panel{margin-top:1rem}.destructive input{margin:0 0 .5rem}}
@media(hover:hover){.sidebar a:hover,.workflow-card button:hover,.btn:hover,.workbench button:hover{will-change:transform}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
`;

export const dashboardScript = `
const q=id=>document.getElementById(id);
const reduceMotion=matchMedia('(prefers-reduced-motion:reduce)').matches;
const panelIds=['lifecycle','usage','chain','alerts','releases','schemas','policy','descriptors','challenges','intelligence','audits','webhooks','deliveries','actions','reconciliation','billing','control-integrity','rulesets','api-keys','export-result'];
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
  for(const item of items.slice(0,8)){
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
  const list=q('alert-list');list.replaceChildren();
  for(const item of items.filter(alert=>!alert.acknowledged_at).slice(0,6)){
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
  text('tenant-name',data.lifecycle.tenant_name||data.lifecycle.tenant_id||'Tenant');
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
  clearPanels();q('status').className='';q('status').textContent='Loading…';
  try{
    const lifecycle=await get('/v1/admin/tenant/lifecycle');
    q('lifecycle').textContent=JSON.stringify(lifecycle,null,2);
    text('tenant-name',lifecycle.tenant_name||lifecycle.tenant_id||'Tenant');
    if(lifecycle.lifecycle.status!=='active'){q('protection-state').className='status-pill bad';text('protection-state-text','Tenant '+lifecycle.lifecycle.status);q('status').textContent='Loaded — operational access is locked';return}
    const [usage,chain,audits,alerts,intelligence,environments,releases,releaseChain,schemas,policy,descriptors,challenges,webhooks,deliveries,checkpoint,anchorDeliveries,reconciliationPending,reconciliationHistory,reconciliationChain,billing,integrity,ruleset,apiKeys]=await Promise.all([
      get('/v1/usage'),get('/v1/audits/verify'),get('/v1/audits?limit=25'),get('/v1/alerts'),get('/v1/intelligence'),get('/v1/environments'),get('/v1/schema-releases?limit=25'),get('/v1/schema-releases/verify'),
      get('/v1/schemas'),get('/v1/admin/policy'),get('/v1/admin/actions/descriptors'),get('/v1/actions/challenges?limit=100'),
      get('/v1/alert-webhooks'),get('/v1/alert-webhooks/deliveries?limit=100'),get('/v1/actions/idempotency/checkpoint'),get('/v1/actions/idempotency/anchors/deliveries?limit=100'),
      get('/v1/actions/reconciliation/pending'),get('/v1/actions/reconciliation/history'),get('/v1/actions/reconciliation/verify'),get('/v1/billing/statement'),get('/v1/admin/control-plane-integrity'),getOptional('/v1/rulesets/latest'),get('/v1/admin/api-keys')
    ]);
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
for(const button of document.querySelectorAll('[data-preset]'))button.onclick=()=>{
  q('operation').value=button.dataset.preset;loadPreset();q('advanced-details').open=true;q('workbench').scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'start'});
};
`;

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
<body><a class="skip-link" href="#main-content">Skip to content</a><div class="shell">
<header class="topbar"><div class="brand"><svg class="brand-mark" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="#11131A" d="M24 20h158l50 50v166H24z"/><path fill="#F5F4EE" fill-rule="evenodd" d="M107 58h42l50 142h-37l-11-34h-48l-11 34H56zm5 79h30l-15-47z"/><path fill="#F5F4EE" d="M24 139h180v27H24z"/><path fill="#DDFE52" d="M204 139h28v27h-28z"/></svg><span>Akriven</span></div><small>${title}</small></header>
<section class="credential"><div class="credential-row"><label class="sr-only" for="key">Tenant API key</label><input id="key" type="password" autocomplete="off" aria-describedby="credential-help" placeholder="Tenant API key — held only in this tab"><button class="btn" id="load" type="button">Load workspace</button><button class="btn secondary" id="export" type="button">Download tenant export</button></div><small id="credential-help">${description}</small><p id="status" role="status" aria-live="polite"></p></section>
<div class="layout"><nav class="sidebar" aria-label="Workspace sections"><strong id="tenant-name">Tenant workspace</strong><a href="#overview">Overview</a><a href="#workflows">Protect &amp; release</a><a href="#decisions">Decisions</a><a href="#alerts-section">Alerts</a><a href="#advanced">Advanced controls</a><a href="#data-controls">Data controls</a></nav>
<main id="main-content">
<section id="overview"><div class="hero-row"><div><h1>Protection overview</h1><p><span id="plan-name">Load a tenant to begin</span> · value-free operational evidence</p></div><span class="status-pill warn" id="protection-state" role="status"><i class="dot"></i><span id="protection-state-text">Credential required</span></span></div>
<div class="metrics">
<article class="metric"><small>Decisions this month</small><strong id="usage-total">—</strong><span id="usage-limit">— included</span><div class="meter" id="quota-meter-track" role="progressbar" aria-label="Monthly quota use" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="quota-meter"></i></div></article>
<article class="metric"><small>Accepted rate</small><strong id="accept-rate">—</strong><span>valid + safely repaired</span></article>
<article class="metric"><small>Safely repaired</small><strong id="repair-total">—</strong><span>proof-carrying repairs</span></article>
<article class="metric"><small>Rejected</small><strong id="rejection-total">—</strong><span>stopped before execution</span></article>
</div></section>
<section id="workflows"><div class="section-head"><div><h2>Run the protection lifecycle</h2><p>Start from the customer job; advanced controls open with a reviewed preset.</p></div></div>
<div class="workflow-grid">
<article class="workflow-card"><span class="step">01</span><b>Protect a tool call</b><p>Validate raw arguments, apply only exact repairs, and return an accountable outcome.</p><button data-preset="validate" type="button">Open validation workflow →</button></article>
<article class="workflow-card"><span class="step">02</span><b>Register a contract</b><p>Add a schema version and see drift before it reaches an environment.</p><button data-preset="register_schema" type="button">Register schema →</button></article>
<article class="workflow-card"><span class="step">03</span><b>Release to an environment</b><p>Promote a reviewed schema and switch runtime admission to fail-closed enforcement.</p><button data-preset="release_schema" type="button">Prepare release →</button></article>
<article class="workflow-card"><span class="step">04</span><b>Govern a high-risk action</b><p>Bind approval to the accepted decision and reserve an idempotency key before execution.</p><button data-preset="action_challenge" type="button">Create approval →</button></article>
<article class="workflow-card"><span class="step">05</span><b>Resolve uncertain execution</b><p>Review aged reservations and reconcile only against an authoritative external ledger.</p><button data-preset="reconcile" type="button">Open reconciliation →</button></article>
<article class="workflow-card"><span class="step">06</span><b>Deliver an alert</b><p>Register a signed HTTPS receiver and inspect retry, dead-letter, and redrive state.</p><button data-preset="webhook_create" type="button">Configure receiver →</button></article>
</div></section>
<section class="two-col"><article class="panel"><div class="section-head"><div><h2>Private-beta readiness</h2><p>Controls that must hold before action traffic.</p></div></div><ul class="clean-list" id="readiness-list"><li>Load the workspace to evaluate readiness.</li></ul></article>
<article class="panel" id="alerts-section"><div class="section-head"><div><h2>Open alerts</h2><p><span id="open-alert-total">—</span> require review</p></div></div><ul class="clean-list" id="alert-list"><li>Load the workspace to review alerts.</li></ul><div class="two-col"><div class="metric"><small>Managed environments</small><strong id="environment-total">—</strong><span>development, staging, production, and custom</span></div><div class="metric"><small>Active API keys</small><strong id="api-key-total">—</strong><span>scoped tenant credentials</span></div></div></article></section>
<section class="panel" id="decisions"><div class="section-head"><div><h2>Recent decisions</h2><p>No argument values are stored or shown.</p></div></div><div class="table-scroll"><table><thead><tr><th>Time</th><th>Outcome</th><th>Reason</th><th>Audit ID</th></tr></thead><tbody id="decision-rows"></tbody></table><p class="muted" id="decision-empty">Load the workspace to review decisions.</p></div></section>
<details id="advanced-details"><summary id="advanced">Advanced controls and evidence</summary><section class="advanced">
<p>These are exact API surfaces for trained operators. Read panels are value-free. Mutations require explicit confirmation and reject unresolved placeholders.</p>
<div class="data-grid">
<div class="data-card"><h3>Tenant lifecycle</h3><pre id="lifecycle">—</pre></div><div class="data-card"><h3>Usage</h3><pre id="usage">—</pre></div><div class="data-card"><h3>Audit chain</h3><pre id="chain">—</pre></div><div class="data-card"><h3>Alerts</h3><pre id="alerts">—</pre></div>
<div class="data-card"><h3>Alert webhooks</h3><pre id="webhooks">—</pre></div><div class="data-card"><h3>Webhook deliveries</h3><pre id="deliveries">—</pre></div><div class="data-card"><h3>Action checkpoint</h3><pre id="actions">—</pre></div><div class="data-card"><h3>Reconciliation</h3><pre id="reconciliation">—</pre></div>
<div class="data-card"><h3>Billing boundary</h3><pre id="billing">—</pre></div><div class="data-card"><h3>Control-plane integrity</h3><pre id="control-integrity">—</pre></div><div class="data-card"><h3>Latest ruleset</h3><pre id="rulesets">—</pre></div>
<div class="data-card"><h3>API key inventory</h3><pre id="api-keys">—</pre></div>
<div class="data-card"><h3>Organization policy</h3><pre id="policy">—</pre></div><div class="data-card"><h3>Schema registry</h3><pre id="schemas">—</pre></div>
<div class="data-card"><h3>Action descriptors</h3><pre id="descriptors">—</pre></div><div class="data-card"><h3>Approval challenges</h3><pre id="challenges">—</pre></div>
<div class="data-card"><h3>Environment schema releases</h3><pre id="releases">—</pre></div><div class="data-card"><h3>Compatibility intelligence</h3><pre id="intelligence">—</pre></div><div class="data-card"><h3>Recent audit payloads</h3><pre id="audits">—</pre></div>
</div>
<h2>Managed API workbench</h2><p>Presets are editable examples, not trusted defaults. Replace placeholders and review the exact request before execution.</p>
<section class="workbench" id="workbench"><div class="workbench-grid">
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
</section></details>
<section class="panel" id="data-controls"><div class="section-head"><div><h2>Evidence and data controls</h2><p>Export first; deletion remains an offline verified operation.</p></div></div><h3>Tenant export</h3><pre id="export-result">—</pre><small>Exports include tenant-owned configuration and evidence, but never API-key verifiers or encrypted webhook credentials.</small>
<div class="destructive"><h3>Request tenant deletion</h3><p>Type the exact tenant ID. This locks operational access immediately; an operator must still verify a current export before deleting data.</p><input id="deletion-confirm" autocomplete="off" placeholder="Exact tenant ID"><button class="btn danger" id="request-deletion" type="button">Request deletion</button><p id="deletion-result"></p></div></section>
</main></div></div><script type="module" src="/dashboard/app.js"></script></body></html>`;
}
