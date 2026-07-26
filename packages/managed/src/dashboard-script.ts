export const dashboardScript = `
const q=id=>document.getElementById(id);
const reduceMotion=matchMedia('(prefers-reduced-motion:reduce)').matches;
const routeMeta={
  overview:{title:'Protection overview',description:'Current readiness, usage, decisions, and open operational work.'},
  integrate:{title:'Integration guide',description:'Connect the SDK or CLI, validate before dispatch, and bind side effects to accountable execution.'},
  decisions:{title:'Tool-call decisions',description:'Validate calls and inspect accountable valid, repaired, and rejected outcomes.'},
  schemas:{title:'Schemas & releases',description:'Register contracts, review drift, and control runtime admission by environment.'},
  environments:{title:'Environments',description:'Create isolated runtime boundaries and control policy and schema admission.'},
  actions:{title:'Action execution',description:'Classify and execute side effects through idempotency, anchors, and reconciliation.'},
  approvals:{title:'Approval inbox',description:'Create, approve, and cancel time-bounded authorization challenges.'},
  alerts:{title:'Alerts & delivery',description:'Review incidents and operate signed webhook delivery, retry, dead-letter, and redrive.'},
  intelligence:{title:'Compatibility intelligence',description:'Review privacy-safe failure patterns and publish verified compatibility evidence.'},
  evidence:{title:'Evidence & integrity',description:'Verify audit chains, signed control state, rulesets, and tenant exports.'},
  access:{title:'Access keys',description:'Create scoped tenant credentials, copy secrets once, and revoke access deliberately.'},
  usage:{title:'Usage & billing',description:'Inspect entitlements, quota, plan boundaries, and billing-provider readiness.'},
  workbench:{title:'Managed API workbench',description:'Use editable, guarded requests for the complete managed API surface.'},
  settings:{title:'Tenant settings',description:'Inspect lifecycle, policy, keys, billing boundaries, retention, and deletion controls.'}
};
const shell=q('app-shell');
const workspace=q('workspace');
let mobileNavOpener=null;
let loadGeneration=0;
let activeLoadController=null;
let workspaceData=null;
let challengeFilter='pending';
let auditRecords=[];
let auditDialogOpener=null;
let browserSession=false;
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

const actionDialog=q('action-dialog');
let actionDialogResolve=null;
let actionDialogOpener=null;
let actionDialogNeedsInput=false;
function settleActionDialog(result){
  if(!actionDialogResolve)return;
  const resolve=actionDialogResolve;actionDialogResolve=null;
  if(actionDialog.open)actionDialog.close();
  resolve(result);
  const opener=actionDialogOpener;actionDialogOpener=null;
  if(opener instanceof HTMLElement)requestAnimationFrame(()=>opener.focus({preventScroll:true}));
}
function askAction({title,copy,confirmLabel='Confirm',kicker='Confirm action',tone='default',inputLabel='',inputPlaceholder=''}) {
  if(actionDialogResolve)settleActionDialog(null);
  actionDialogOpener=document.activeElement;
  actionDialog.dataset.tone=tone;
  text('action-dialog-kicker',kicker);text('action-dialog-title',title);text('action-dialog-copy',copy);
  text('action-dialog-confirm',confirmLabel);text('action-dialog-mark',tone==='danger'?'!':'✓');
  const inputWrap=q('action-dialog-input-wrap');const input=q('action-dialog-input');
  actionDialogNeedsInput=Boolean(inputLabel);inputWrap.hidden=!actionDialogNeedsInput;
  text('action-dialog-input-label',inputLabel);input.placeholder=inputPlaceholder;input.value='';
  text('action-dialog-error','');
  actionDialog.showModal();
  requestAnimationFrame(()=>actionDialogNeedsInput?input.focus():q('action-dialog-cancel').focus());
  return new Promise(resolve=>{actionDialogResolve=resolve});
}
q('action-dialog-cancel').onclick=()=>settleActionDialog(null);
q('action-dialog-confirm').onclick=()=>{
  if(actionDialogNeedsInput){
    const input=q('action-dialog-input').value.trim();
    if(!input){text('action-dialog-error','Enter the required evidence reference to continue.');q('action-dialog-input').focus();return}
    settleActionDialog(input);return;
  }
  settleActionDialog(true);
};
actionDialog.addEventListener('cancel',event=>{event.preventDefault();settleActionDialog(null)});
actionDialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();settleActionDialog(null)}});
actionDialog.addEventListener('click',event=>{if(event.target===actionDialog)settleActionDialog(null)});
q('action-dialog-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();q('action-dialog-confirm').click()}});
const confirmAction=async options=>(await askAction(options))===true;

const auditDialog=q('audit-dialog');
function closeAuditDialog(){
  if(auditDialog.open)auditDialog.close();
  const opener=auditDialogOpener;auditDialogOpener=null;
  if(opener instanceof HTMLElement)requestAnimationFrame(()=>opener.focus({preventScroll:true}));
}
q('audit-dialog-close').onclick=()=>closeAuditDialog();
auditDialog.addEventListener('cancel',event=>{event.preventDefault();closeAuditDialog()});
auditDialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeAuditDialog()}});
auditDialog.addEventListener('click',event=>{if(event.target===auditDialog)closeAuditDialog()});

function setCredentialMode(mode){
  workspace.dataset.credential=mode;
  const connected=mode==='connected';
  q('credential-connected').hidden=!connected;q('change-key').hidden=!connected;
  q('sign-in').hidden=browserSession;
  q('sign-out').hidden=!(connected&&browserSession);
  q('change-key').hidden=!connected||browserSession;
  text('credential-connected-detail',browserSession?'Authenticated browser session; permissions follow assigned organization roles.':'The tenant key remains only in this tab’s memory.');
  q('key').closest('.credential-editor').hidden=connected;
}

const panelIds=['lifecycle','usage','chain','alerts','releases','schemas','policy','descriptors','challenges','intelligence','audits','webhooks','deliveries','notifications','actions','reconciliation','billing','control-integrity','rulesets','api-keys','export-result'];
const clearPanels=()=>{for(const id of panelIds)q(id).textContent='—'};
function resetDerivedViews(){
  for(const id of ['usage-total','usage-limit','accept-rate','repair-total','rejection-total','plan-name','open-alert-total','environment-total','api-key-total','service-state','inventory-tool-total','inventory-release-total','inventory-environment-total','inventory-action-total'])text(id,'—');
  text('tenant-name','Tenant workspace');text('tenant-avatar','A');text('protection-state-text','Awaiting tenant');
  q('protection-state').className='status-pill';q('quota-meter').style.removeProperty('--quota-scale');q('quota-meter-track').setAttribute('aria-valuenow','0');
  for(const id of ['decision-rows','schema-rows','release-rows','environment-rows','descriptor-rows','anchor-delivery-rows','reconciliation-pending-rows','reconciliation-history-rows','challenge-rows','webhook-rows','delivery-rows','notification-rows','compatibility-rows','quality-rows','evidence-audit-rows','api-key-rows'])q(id)?.replaceChildren();
  q('decision-empty').hidden=false;
  for(const id of ['validate-result','compile-result','action-evaluate-result','checkpoint-compare-result','webhook-secret','api-key-secret']){const node=q(id);if(node){node.hidden=true;node.replaceChildren()}}
  for(const id of ['release-chain-label','checkpoint-label','reconciliation-chain-label','audit-chain-label','privacy-threshold-label']){if(q(id))text(id,'Not loaded')}
  for(const id of ['failure-cluster-total','compatibility-total','recommendation-total','network-cluster-total','usage-period','usage-current','usage-cap','retention-days','payment-state','lifecycle-status','lifecycle-reason','lifecycle-deletion-time','lifecycle-updated'])if(q(id))text(id,'—');
  for(const id of ['entitlement-list','plan-grid','billing-summary','integrity-components','recommendation-list','failure-cluster-list'])q(id)?.replaceChildren();
  const resetList=(id,message)=>{const list=q(id);list.replaceChildren();const row=document.createElement('li');row.textContent=message;list.append(row)};
  resetList('readiness-list','Load the workspace to evaluate readiness.');
  resetList('alert-list','Load the workspace to review alerts.');
  resetList('alerts-page-list','Load the workspace to review alerts.');
  q('inventory-tool-rows').replaceChildren();tableEmpty('inventory-tool-rows',4,'Load the workspace to inspect registered assets.');
  q('inventory-runtime-list').replaceChildren();const inventoryEmpty=document.createElement('p');inventoryEmpty.textContent='No conformance evidence loaded.';q('inventory-runtime-list').append(inventoryEmpty);
  text('inventory-boundary','Registered and observed assets only. This is not endpoint, cloud-account, shadow-agent, or shadow-MCP discovery.');
  auditRecords=[];
  text('decision-filter-count','0 records');
  for(const id of ['integration-key-state','integration-decision-state','integration-action-state']){text(id,'Waiting');q(id).className=''}
  q('integration-state').className='status-pill warn';text('integration-state-text','Connect a tenant');
}
const parseBody=async response=>{const body=await response.text();if(!body)return null;try{return JSON.parse(body)}catch{return {unparsed_response:true}}};
async function requestRaw(path,options={},key=q('key').value){
  const headers={...options.headers};
  if(key)headers.authorization='Bearer '+key;
  const response=await fetch(path,{...options,headers,credentials:'same-origin',cache:'no-store'});
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
const value=(object,...keys)=>{for(const key of keys)if(object&&object[key]!==undefined&&object[key]!==null)return object[key];return '—'};
const formatTime=input=>input&&input!=='—'?new Date(input).toLocaleString():'—';
const short=(input,length=20)=>{const output=String(input??'—');return output.length>length?output.slice(0,length)+'…':output};
const status=(id,message,tone='')=>{const node=q(id);node.className='form-status '+tone;node.textContent=message};
const parseJson=id=>{try{return JSON.parse(q(id).value)}catch{throw new Error('Enter valid JSON in the highlighted field')}};
function tableEmpty(id,columns,message){
  const body=q(id);body.replaceChildren();const row=document.createElement('tr');const cell=document.createElement('td');
  cell.colSpan=columns;cell.className='empty-row';cell.textContent=message;row.append(cell);body.append(row);
}
function appendCells(row,items){
  for(const item of items){const cell=document.createElement('td');if(item instanceof Node)cell.append(item);else cell.textContent=String(item??'—');row.append(cell)}
}
function codeValue(input){const code=document.createElement('code');code.textContent=short(input,24);code.title=String(input??'');return code}
function tag(input,tone=''){const node=document.createElement('span');node.className='tag '+tone;node.textContent=String(input??'—');return node}
function actionButton(label,handler,tone='secondary'){
  const button=document.createElement('button');button.type='button';button.className='btn '+tone;button.textContent=label;
  button.onclick=async()=>{button.disabled=true;try{await handler()}catch(error){q('status').className='bad';q('status').textContent=error instanceof Error?error.message:'Action failed'}finally{button.disabled=false}};
  return button;
}
function fingerprintControl(hash){
  const full=String(hash||'—');
  const wrap=document.createElement('span');wrap.className='row-actions';
  const code=document.createElement('code');code.textContent=full.slice(0,16);
  const copy=actionButton('Copy full fingerprint',async()=>{await navigator.clipboard.writeText(full);copy.textContent='Copied'});
  copy.setAttribute('aria-label','Copy full fingerprint '+full);
  wrap.append(code,copy);return wrap;
}
function syncEnvironmentSelects(environments){
  const ids=['release-environment','environment-select','descriptor-environment','action-environment','challenge-environment'];
  for(const id of ids){
    const select=q(id);if(!select)continue;const selected=select.value;select.replaceChildren();
    for(const environment of environments){const option=document.createElement('option');option.value=environment.id||environment.name;option.textContent=environment.name;option.dataset.name=environment.name;select.append(option)}
    if(Array.from(select.options).some(option=>option.value===selected))select.value=selected;
  }
}
function renderChecklist(items){
  const list=q('readiness-list');list.replaceChildren();
  for(const item of items){
    const row=document.createElement('li');
    const icon=document.createElement('span');icon.className='check'+(item.ready?'':' open');icon.textContent=item.ready?'✓':'!';
    const copy=document.createElement('span');const title=document.createElement('b');title.textContent=item.label;const note=document.createElement('small');note.textContent=item.note;copy.append(title,note);
    let state;
    if(!item.ready&&item.route){
      state=document.createElement('button');state.type='button';state.className='btn secondary readiness-action';state.textContent='Resolve';state.onclick=()=>navigate(item.route);
    }else{state=document.createElement('small');state.textContent=item.ready?'Ready':'Needs attention'}
    row.append(icon,copy,state);list.append(row);
  }
}
function auditEvidence(item){
  return {
    sequence:item.sequence,
    audit_id:item.audit_id,
    occurred_at:item.occurred_at,
    decision:item.decision,
    reason_code:item.reason_code??null,
    repair_rules:Array.isArray(item.repair_rules)?item.repair_rules:[],
    event_hash:item.event_hash,
    previous_hash:item.previous_hash,
    signature:item.signature,
    envelope:item.envelope
  };
}
function openAudit(item,opener){
  auditDialogOpener=opener;
  text('audit-dialog-title',item.audit_id||'Audit record');
  text('audit-dialog-summary',formatTime(item.occurred_at)+' · '+item.decision);
  const grid=q('audit-detail-grid');grid.replaceChildren();
  for(const [label,detail] of [['Outcome',item.decision],['Reason',item.reason_code||'None'],['Sequence',item.sequence],['Repair rules',Array.isArray(item.repair_rules)&&item.repair_rules.length?item.repair_rules.join(', '):'None'],['Event hash',item.event_hash||'—'],['Previous hash',item.previous_hash||'Genesis anchor']]){
    const wrap=document.createElement('div');const term=document.createElement('dt');term.textContent=label;const valueNode=document.createElement('dd');valueNode.textContent=String(detail??'—');wrap.append(term,valueNode);grid.append(wrap);
  }
  q('audit-dialog-json').textContent=JSON.stringify(auditEvidence(item),null,2);
  q('audit-dialog').showModal();
  requestAnimationFrame(()=>q('audit-dialog-close').focus());
}
function auditDetailButton(item){
  const button=document.createElement('button');button.type='button';button.className='btn secondary';button.textContent='Inspect';button.onclick=()=>openAudit(item,button);return button;
}
function renderDecisions(items){
  auditRecords=items;
  const selected=q('decision-filter').value;
  const query=q('decision-search').value.trim().toLowerCase();
  const filtered=items.filter(item=>{
    if(selected!=='all'&&item.decision!==selected)return false;
    if(!query)return true;
    const searchable=[item.audit_id,item.reason_code,...(Array.isArray(item.repair_rules)?item.repair_rules:[])].join(' ').toLowerCase();
    return searchable.includes(query);
  });
  const body=q('decision-rows');body.replaceChildren();
  for(const item of filtered.slice(0,25)){
    const row=document.createElement('tr');
    const time=document.createElement('td');time.textContent=new Date(item.occurred_at).toLocaleString();
    const decision=document.createElement('td');decision.className='decision '+item.decision;decision.textContent=item.decision;
    const reason=document.createElement('td');reason.textContent=item.reason_code||'—';
    const repairs=document.createElement('td');repairs.textContent=Array.isArray(item.repair_rules)?item.repair_rules.join(', ')||'None':String(item.repaired_fields_count??'None');
    const audit=document.createElement('td');const code=document.createElement('code');code.textContent=String(item.audit_id).slice(0,18)+'…';audit.append(code);
    const action=document.createElement('td');action.append(auditDetailButton(item));
    row.append(time,decision,reason,repairs,audit,action);body.append(row);
  }
  text('decision-filter-count',filtered.length+' of '+items.length+' records');
  q('decision-empty').textContent=items.length?'No decisions match these filters.':'No retained decisions yet.';
  q('decision-empty').hidden=filtered.length>0;
}
q('decision-filter').onchange=()=>renderDecisions(auditRecords);
q('decision-search').oninput=()=>renderDecisions(auditRecords);
q('decision-filter-clear').onclick=()=>{q('decision-filter').value='all';q('decision-search').value='';renderDecisions(auditRecords);q('decision-search').focus()};
function renderAlerts(items){
  for(const list of [q('alert-list'),q('alerts-page-list')]){
    list.replaceChildren();
    for(const item of items.filter(alert=>!alert.acknowledged_at).slice(0,8)){
      const row=document.createElement('li');
      const icon=document.createElement('span');icon.className='check open';icon.textContent='!';
      const copy=document.createElement('span');const title=document.createElement('b');title.textContent=item.kind;const note=document.createElement('small');note.textContent=new Date(item.created_at).toLocaleString();copy.append(title,note);
      const action=document.createElement('button');action.type='button';action.className='btn secondary';action.textContent='Acknowledge';action.onclick=async()=>{
        if(!await confirmAction({title:'Acknowledge alert?',copy:'Mark '+item.kind+' as reviewed for this tenant. The alert remains in retained evidence.',confirmLabel:'Acknowledge alert',kicker:'Alert review'}))return;
        action.disabled=true;
        try{await request('/v1/alerts/'+encodeURIComponent(item.id)+'/acknowledge',{method:'POST'});q('load').click()}catch(error){q('status').className='bad';q('status').textContent=error instanceof Error?error.message:'Acknowledgement failed';action.disabled=false}
      };
      row.append(icon,copy,action);list.append(row);
    }
    if(list.children.length===0){const row=document.createElement('li');row.textContent='No open alerts.';list.append(row)}
  }
}
function renderSchemas(data){
  const schemas=data.schemas.schemas||[];
  const releases=data.releases.releases||[];
  const schemaBody=q('schema-rows');schemaBody.replaceChildren();
  for(const item of schemas){
    const row=document.createElement('tr');
    appendCells(row,[codeValue(value(item,'tool_name_hash','tool_name','tool')),value(item,'adapter'),value(item,'version'),codeValue(value(item,'schema_hash','hash')),item.drift?.classification??item.drift?.status??item.drift_status??'none',formatTime(value(item,'registered_at','created_at'))]);
    schemaBody.append(row);
  }
  if(!schemas.length)tableEmpty('schema-rows',6,'No schemas registered yet.');
  const releaseBody=q('release-rows');releaseBody.replaceChildren();
  for(const item of releases){
    const row=document.createElement('tr');
    appendCells(row,[value(item,'environment_name','environment'),codeValue(value(item,'tool_name_hash','tool_name','tool')),value(item,'version'),codeValue(value(item,'schema_hash','expected_schema_hash')),formatTime(value(item,'promoted_at','released_at','created_at'))]);
    releaseBody.append(row);
  }
  if(!releases.length)tableEmpty('release-rows',5,'No schema releases yet.');
  const valid=Boolean(data.releaseChain.valid);
  text('release-chain-label',valid?'Release chain verified':'Release chain requires attention');
  q('release-chain-label').className='integrity-label '+(valid?'good':'bad');
}
function renderEnvironments(data){
  const environments=data.environments.environments||[];
  syncEnvironmentSelects(environments);
  const body=q('environment-rows');body.replaceChildren();
  for(const item of environments){
    const row=document.createElement('tr');
    const open=actionButton('Configure',()=>{q('environment-select').value=item.id||item.name;q('environment-enforcement').value=item.schema_enforcement||'observe';q('environment-policy-editor').value=JSON.stringify(item.policy||{},null,2);q('environment-update-form').scrollIntoView({behavior:reduceMotion?'auto':'smooth'})});
    appendCells(row,[item.name,tag(item.schema_enforcement||'observe'),short(JSON.stringify(item.policy||{}),52),formatTime(item.updated_at),open]);body.append(row);
  }
  if(!environments.length)tableEmpty('environment-rows',5,'No environments configured.');
  const selected=environments.find(item=>(item.id||item.name)===q('environment-select').value);
  if(selected){q('environment-enforcement').value=selected.schema_enforcement||'observe';q('environment-policy-editor').value=JSON.stringify(selected.policy||{},null,2)}
}
function renderActions(data){
  const control=data.actionControl||{};
  q('action-control-hold').checked=Boolean(control.hold);
  q('action-control-reason').value=control.reason_code||'';
  q('action-control-enforced').value=JSON.stringify(control.enforced_policy||{},null,2);
  q('action-control-shadow').value=control.shadow_policy===null||control.shadow_policy===undefined?'':JSON.stringify(control.shadow_policy,null,2);
  text('action-control-label',control.hold?'Actions held':control.shadow_policy?'Enforcing + shadowing':'Enforcing');
  q('action-control-label').className='integrity-label '+(control.hold?'bad':control.shadow_policy?'warn':'good');
  const descriptors=data.descriptors.descriptors||[];
  const body=q('descriptor-rows');body.replaceChildren();
  for(const item of descriptors){const row=document.createElement('tr');appendCells(row,[codeValue(value(item,'tool_name_hash','tool_name','tool')),value(item,'environment_name','environment'),tag(value(item,'risk_level','risk')),value(item,'side_effect'),formatTime(value(item,'updated_at','created_at'))]);body.append(row)}
  if(!descriptors.length)tableEmpty('descriptor-rows',5,'No action descriptors configured.');
  const checkpoint=data.checkpoint||{};
  text('checkpoint-label',checkpoint.revision!==undefined?'Revision '+checkpoint.revision:'Checkpoint unavailable');
  q('checkpoint-label').className='integrity-label '+(checkpoint.revision!==undefined?'good':'bad');
  q('checkpoint-input').value=JSON.stringify(checkpoint,null,2);
  const deliveries=data.anchorDeliveries.deliveries||[];
  const deliveryBody=q('anchor-delivery-rows');deliveryBody.replaceChildren();
  for(const item of deliveries){
    const row=document.createElement('tr');const controls=document.createElement('div');controls.className='row-actions';
    if(item.status==='dead')controls.append(actionButton('Redrive',async()=>{await request('/v1/actions/idempotency/anchors/deliveries/'+encodeURIComponent(item.delivery_id)+'/redrive',{method:'POST'});await refreshActions()}));
    appendCells(row,[value(item,'revision'),tag(item.status),number(item.attempt_count),formatTime(value(item,'last_attempt_at','next_attempt_at','created_at')),controls]);deliveryBody.append(row);
  }
  if(!deliveries.length)tableEmpty('anchor-delivery-rows',5,'No anchor deliveries recorded.');
  const pending=data.reconciliationPending.pending||[];
  const pendingBody=q('reconciliation-pending-rows');pendingBody.replaceChildren();
  for(const item of pending){
    const row=document.createElement('tr');const controls=document.createElement('div');controls.className='row-actions';
    controls.append(actionButton('Executed',async()=>{const reservation=item.reservation_id||item.id;const reference=await askAction({title:'Confirm executed outcome?',copy:'Record reservation '+reservation+' as executed. This authoritative outcome cannot be changed.',confirmLabel:'Confirm executed',kicker:'Reconciliation decision',tone:'danger',inputLabel:'Execution-ledger evidence reference',inputPlaceholder:'ledger/change/transaction reference'});if(typeof reference!=='string')return;await request('/v1/actions/reconciliation/'+encodeURIComponent(reservation),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({outcome:'confirmed_executed',evidence_reference:reference})});await refreshActions()}));
    controls.append(actionButton('Not executed',async()=>{const reservation=item.reservation_id||item.id;const reference=await askAction({title:'Confirm non-execution?',copy:'Record reservation '+reservation+' as not executed. This authoritative outcome cannot be changed.',confirmLabel:'Confirm not executed',kicker:'Reconciliation decision',tone:'danger',inputLabel:'Execution-ledger evidence reference',inputPlaceholder:'ledger/change/transaction reference'});if(typeof reference!=='string')return;await request('/v1/actions/reconciliation/'+encodeURIComponent(reservation),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({outcome:'confirmed_not_executed',evidence_reference:reference})});await refreshActions()}));
    appendCells(row,[codeValue(item.reservation_id||item.id),codeValue(value(item,'tool_name_hash','tool_name','tool')),codeValue(value(item,'execution_fingerprint')),formatTime(value(item,'updated_at','created_at')),codeValue(value(item,'audit_id')),controls]);pendingBody.append(row);
  }
  if(!pending.length)tableEmpty('reconciliation-pending-rows',6,'No reservations await reconciliation.');
  const history=data.reconciliationHistory.reconciliations||[];
  const historyBody=q('reconciliation-history-rows');historyBody.replaceChildren();
  for(const item of history){const row=document.createElement('tr');appendCells(row,[codeValue(item.reservation_id||item.id),tag(item.outcome),codeValue(value(item,'evidence_hash','evidence_reference')),formatTime(value(item,'reconciled_at','created_at')),codeValue(value(item,'audit_id','record_hash'))]);historyBody.append(row)}
  if(!history.length)tableEmpty('reconciliation-history-rows',5,'No reconciliation history yet.');
  const chainValid=Boolean(data.reconciliationChain.valid);
  text('reconciliation-chain-label',chainValid?'Reconciliation chain verified':'Reconciliation chain requires attention');
  q('reconciliation-chain-label').className='integrity-label '+(chainValid?'good':'bad');
}
function renderChallenges(data){
  const items=data.challenges.challenges||[];
  const filtered=challengeFilter==='all'?items:items.filter(item=>item.status===challengeFilter);
  const body=q('challenge-rows');body.replaceChildren();
  for(const item of filtered){
    const challenge=item.challenge||item;
    const row=document.createElement('tr');const controls=document.createElement('div');controls.className='row-actions';
    if(item.status==='pending'){
      controls.append(actionButton('Approve',async()=>{if(!await confirmAction({title:'Approve this challenge?',copy:'Authorize '+challenge.tool_name_hash+' in '+challenge.environment+' under challenge '+challenge.challenge_id+'.',confirmLabel:'Approve challenge',kicker:'Human authority'}))return;const approved=await request('/v1/actions/challenges/'+encodeURIComponent(challenge.challenge_id)+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});q('action-approval').value=JSON.stringify(approved.approval||approved,null,2);await refreshChallenges()}));
      controls.append(actionButton('Cancel',async()=>{if(!await confirmAction({title:'Cancel this challenge?',copy:'Revoke pending authority for challenge '+challenge.challenge_id+'. This cannot be approved afterward.',confirmLabel:'Cancel challenge',kicker:'Revoke authority',tone:'danger'}))return;await request('/v1/actions/challenges/'+encodeURIComponent(challenge.challenge_id),{method:'DELETE'});await refreshChallenges()},'danger'));
    }
    appendCells(row,[codeValue(value(challenge,'tool_name_hash','tool_name','tool')),value(challenge,'environment'),value(challenge,'risk_level','risk'),tag(item.status),formatTime(challenge.expires_at),codeValue(challenge.challenge_id),controls]);body.append(row);
  }
  if(!filtered.length)tableEmpty('challenge-rows',7,'No challenges match this filter.');
}
function renderAlertOperations(data){
  renderAlerts(data.alerts.alerts||[]);
  const webhooks=data.webhooks.webhooks||[];
  const webhookBody=q('webhook-rows');webhookBody.replaceChildren();
  for(const item of webhooks){
    const row=document.createElement('tr');const controls=document.createElement('div');controls.className='row-actions';
    if(!item.disabled_at)controls.append(actionButton('Disable',async()=>{if(!await confirmAction({title:'Disable alert receiver?',copy:item.label+' will stop receiving new signed alert deliveries. Retained delivery evidence is preserved.',confirmLabel:'Disable receiver',kicker:'Delivery control',tone:'danger'}))return;await request('/v1/alert-webhooks/'+encodeURIComponent(item.webhook_id),{method:'DELETE'});await refreshAlerts()},'danger'));
    appendCells(row,[item.label,codeValue(item.endpoint_hash),tag(item.disabled_at?'disabled':'active'),formatTime(item.created_at),controls]);webhookBody.append(row);
  }
  if(!webhooks.length)tableEmpty('webhook-rows',5,'No alert receivers configured.');
  const deliveries=data.deliveries.deliveries||[];
  const deliveryBody=q('delivery-rows');deliveryBody.replaceChildren();
  for(const item of deliveries){
    const row=document.createElement('tr');const controls=document.createElement('div');controls.className='row-actions';
    if(item.status==='dead')controls.append(actionButton('Redrive',async()=>{await request('/v1/alert-webhooks/deliveries/'+encodeURIComponent(item.delivery_id)+'/redrive',{method:'POST'});await refreshAlerts()}));
    appendCells(row,[value(item,'webhook_id'),tag(item.status),number(item.attempt_count),formatTime(item.next_attempt_at),short(value(item,'error_code'),36),controls]);deliveryBody.append(row);
  }
  if(!deliveries.length)tableEmpty('delivery-rows',6,'No webhook deliveries recorded.');
  const notifications=data.notifications?.notifications||[];
  const notificationBody=q('notification-rows');notificationBody.replaceChildren();
  for(const item of notifications){
    const row=document.createElement('tr');const controls=document.createElement('div');controls.className='row-actions';
    if(item.status==='dead')controls.append(actionButton('Redrive',async()=>{await request('/v1/admin/notifications/'+encodeURIComponent(item.notification_id)+'/redrive',{method:'POST'});await refreshAlerts()}));
    appendCells(row,[String(item.kind||'—').replaceAll('_',' '),tag(item.status),number(item.attempt_count),formatTime(item.next_attempt_at),codeValue(short(value(item,'provider_message_id'),24)),short(value(item,'error_code'),36),controls]);notificationBody.append(row);
  }
  if(!notifications.length)tableEmpty('notification-rows',7,'No transactional notifications recorded.');
}
function renderIntelligence(data){
  const intel=data.intelligence||{};
  const failures=intel.failure_clusters||intel.failures||[];
  const compatibility=intel.compatibility_matrix||intel.compatibility||intel.conformance_runs||[];
  const recommendations=intel.recommendations||[];
  const networks=intel.network_failure_clusters||intel.network_clusters||[];
  text('failure-cluster-total',failures.length);text('compatibility-total',compatibility.length);text('recommendation-total',recommendations.length);text('network-cluster-total',networks.length);
  text('privacy-threshold-label',intel.privacy_threshold!==undefined?'Network threshold '+intel.privacy_threshold:value(intel,'privacy_threshold_status','privacy_status'));
  const recommendationList=q('recommendation-list');recommendationList.replaceChildren();
  for(const item of recommendations.slice(0,12)){const row=document.createElement('li');const title=document.createElement('b');title.textContent=String(value(item,'code','title','recommendation','kind'));const note=document.createElement('small');note.textContent=String(value(item,'message','detail','description','reason'));row.append(title,note);recommendationList.append(row)}
  if(!recommendations.length){const row=document.createElement('li');row.textContent='No privacy-safe recommendations available.';recommendationList.append(row)}
  const failureList=q('failure-cluster-list');failureList.replaceChildren();
  for(const item of failures.slice(0,12)){const row=document.createElement('li');const title=document.createElement('b');title.textContent=String(value(item,'category','reason_code','kind','cluster'));const note=document.createElement('small');note.textContent=number(value(item,'event_count','count','occurrences'))+' observations';row.append(title,note);failureList.append(row)}
  if(!failures.length){const row=document.createElement('li');row.textContent='No clusters meet the privacy threshold.';failureList.append(row)}
  const compatibilityBody=q('compatibility-rows');compatibilityBody.replaceChildren();
  for(const item of compatibility){const row=document.createElement('tr');appendCells(row,[value(item,'provider')+' '+value(item,'latest_provider_version','provider_version'),value(item,'framework')+' '+value(item,'latest_framework_version','framework_version'),value(item,'adapter'),value(item,'latest_suite_version','suite_version','suite'),number(item.passed),number(item.failed),formatTime(value(item,'last_tested_at','executed_at','created_at'))]);compatibilityBody.append(row)}
  if(!compatibility.length)tableEmpty('compatibility-rows',7,'No conformance runs recorded.');
  const quality=intel.schema_quality||intel.quality||[];
  const qualityBody=q('quality-rows');qualityBody.replaceChildren();
  for(const item of quality){const row=document.createElement('tr');appendCells(row,[codeValue(value(item,'tool_name_hash','tool_name','tool')),value(item,'adapter'),value(item,'version'),item.quality?.score??item.quality?.classification??item.quality_score??'—',item.drift?.classification??item.drift?.status??item.drift_status??'none']);qualityBody.append(row)}
  if(!quality.length)tableEmpty('quality-rows',5,'No schema-quality observations available.');
}
function renderEvidence(data){
  const integrity=q('integrity-components');integrity.replaceChildren();
  const entries=[
    ['Control plane',Boolean(data.integrity.valid??data.integrity.control_plane_valid)],
    ['Audit chain',Boolean(data.chain.valid)],
    ['Release chain',Boolean(data.releaseChain.valid)],
    ['Reconciliation',Boolean(data.reconciliationChain.valid)],
    ['Ruleset',data.ruleset.status!=='not_configured'&&Boolean(data.ruleset.valid??data.ruleset.signature_valid??(data.ruleset.signature&&data.ruleset.public_key))]
  ];
  for(const [label,valid] of entries){const card=document.createElement('div');const title=document.createElement('span');title.textContent=label;const result=tag(valid?'Verified':'Attention',valid?'good':'bad');card.append(title,result);integrity.append(card)}
  const audits=data.audits.audits||[];
  const body=q('evidence-audit-rows');body.replaceChildren();
  for(const item of audits){const row=document.createElement('tr');appendCells(row,[formatTime(item.occurred_at),tag(item.decision),value(item,'reason_code'),Array.isArray(item.repair_rules)?item.repair_rules.join(', ')||'None':'None',codeValue(item.audit_id),auditDetailButton(item)]);body.append(row)}
  if(!audits.length)tableEmpty('evidence-audit-rows',6,'No retained audit records yet.');
  text('audit-chain-label',data.chain.valid?'Audit chain verified':'Audit chain requires attention');
  q('audit-chain-label').className='integrity-label '+(data.chain.valid?'good':'bad');
}
const scopeNames=['validate','compile','evaluate:action','approve:action','reconcile:action','manage:webhooks','promote:schema','read:audit','read:alerts','read:billing','read:environment','read:intelligence','read:ruleset','read:usage','write:schema','admin'];
function renderAccess(data){
  const picker=q('scope-picker');
  if(!picker.querySelector('input'))for(const scope of scopeNames){const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.value=scope;input.checked=false;label.append(input,document.createTextNode(scope));picker.append(label)}
  const keys=data.apiKeys.api_keys||[];
  const body=q('api-key-rows');body.replaceChildren();
  for(const item of keys){
    const row=document.createElement('tr');const controls=document.createElement('div');controls.className='row-actions';
    if(!item.revoked_at&&!item.current)controls.append(actionButton('Revoke',async()=>{if(!await confirmAction({title:'Revoke this API key?',copy:'Clients using '+value(item,'prefix','key_prefix')+' will immediately lose access. This key cannot be restored.',confirmLabel:'Revoke API key',kicker:'Credential control',tone:'danger'}))return;await request('/v1/admin/api-keys/'+encodeURIComponent(item.key_id||item.id),{method:'DELETE'});await refreshAccess()},'danger'));
    appendCells(row,[codeValue(value(item,'key_prefix','prefix')),Array.isArray(item.scopes)?item.scopes.join(', '):'—',formatTime(item.created_at),tag(item.revoked_at?'revoked':item.current?'current':'active'),controls]);body.append(row);
  }
  if(!keys.length)tableEmpty('api-key-rows',5,'No API keys found.');
}
function renderUsage(data){
  const usage=data.usage;const counts=usage.usage||{};
  text('usage-period',value(counts,'month'));
  text('usage-current',number(counts.validation_count).toLocaleString());
  text('usage-cap','of '+number(usage.monthly_limit).toLocaleString());
  text('retention-days',value(usage.entitlements,'retention_days'));
  text('payment-state',value(usage,'payment_processing','billing_status'));
  const entitlements=q('entitlement-list');entitlements.replaceChildren();
  const entitlementValues=[
    ['Validations per month',number(usage.entitlements?.validations_per_month).toLocaleString()],
    ['Retention',number(usage.entitlements?.retention_days)+' days'],
    ['Managed workflows',usage.entitlements?.managed_workflows==='full'?'Complete managed control plane':'Evaluation workflows'],
    ['Overage',usage.entitlements?.overage==='disabled'?'Disabled — quota fails closed':value(usage.entitlements,'overage')]
  ];
  for(const [name,detail] of entitlementValues){const row=document.createElement('div');const title=document.createElement('dt');title.textContent=name;const result=document.createElement('dd');result.textContent=String(detail);row.append(title,result);entitlements.append(row)}
  if(!entitlements.children.length){const row=document.createElement('div');const title=document.createElement('dt');title.textContent='Status';const result=document.createElement('dd');result.textContent='No entitlements reported.';row.append(title,result);entitlements.append(row)}
  const plans=q('plan-grid');plans.replaceChildren();
  for(const plan of data.plans.plans||[]){
    const card=document.createElement('article');card.className='plan-option';
    const name=document.createElement('h4');name.textContent=value(plan,'display_name','name','id');
    const price=document.createElement('strong');price.className='price';const amount=number(plan.price?.amount_minor);price.textContent=amount?'$'+(amount/100).toLocaleString()+' / 90 days':'Not for sale';
    const equivalent=document.createElement('p');const monthly=number(plan.price?.monthly_equivalent_minor);equivalent.textContent=monthly?'$'+(monthly/100).toLocaleString()+' monthly equivalent · invite only':String(value(plan,'availability'));
    const detail=document.createElement('p');detail.textContent=String(value(plan,'audience','description','summary'));
    const facts=document.createElement('dl');
    for(const [label,fact] of [['Usage',number(plan.entitlements?.validations_per_month).toLocaleString()+' validations / month'],['Retention',number(plan.entitlements?.retention_days)+' days'],['Workflows',plan.entitlements?.managed_workflows==='full'?'Complete managed control plane':'Evaluation only'],['Support',value(plan,'support')],['Collection',plan.payment_collection==='manual_provider_setup_required'?'Manual during private beta':'Disabled']]){const row=document.createElement('div');const term=document.createElement('dt');term.textContent=label;const result=document.createElement('dd');result.textContent=String(fact);row.append(term,result);facts.append(row)}
    card.append(name,price,equivalent,detail,facts);plans.append(card)
  }
  const summary=q('billing-summary');summary.replaceChildren();
  for(const [label,item] of [['Period',value(data.billing,'period')],['Amount due',data.billing.amount_due??'Not calculated'],['Plan',value(usage,'plan_name','plan')],['Payment automation',value(data.billing,'payment_processing')]]){const wrap=document.createElement('div');const term=document.createElement('span');term.textContent=label;const result=document.createElement('strong');result.textContent=String(item);wrap.append(term,result);summary.append(wrap)}
  const billingBlocked=data.billing.payment_processing==='integration_required'||usage.payment_processing==='manual_provider_setup_required';
  q('billing-checkout').disabled=billingBlocked;q('billing-portal').disabled=billingBlocked;
  text('billing-boundary-copy',billingBlocked?'Enrollment is operator-led and manually invoiced. Checkout and the billing portal remain disabled until the real provider sandbox passes.':'Billing provider state returned by the managed service.');
}
function renderIntegration(data){
  const validations=number(data.usage?.usage?.validation_count);
  const actionReady=(data.descriptors?.descriptors||[]).length>0&&data.checkpoint?.revision!==undefined;
  text('integration-key-state','Connected');text('integration-decision-state',validations>0?'Observed':'Run first call');text('integration-action-state',actionReady?'Configured':'Configure');
  q('integration-key-state').className='good';q('integration-decision-state').className=validations>0?'good':'bad';q('integration-action-state').className=actionReady?'good':'bad';
  const active=validations>0&&actionReady;
  q('integration-state').className='status-pill '+(active?'':'warn');text('integration-state-text',active?'Execution path configured':'Setup in progress');
  const inventory=data.inventory||{};
  const summary=inventory.summary||{};
  text('inventory-tool-total',number(summary.registered_tools).toLocaleString());
  text('inventory-release-total',number(summary.promoted_releases).toLocaleString());
  text('inventory-environment-total',number(summary.environments).toLocaleString());
  text('inventory-action-total',number(summary.action_profiles).toLocaleString());
  const toolRows=q('inventory-tool-rows');toolRows.replaceChildren();
  const tools=inventory.tools||[];
  if(tools.length===0){const row=document.createElement('tr');const cell=document.createElement('td');cell.colSpan=4;cell.textContent='No registered tools yet. Register a schema to establish the first governed asset.';row.append(cell);toolRows.append(row)}
  for(const tool of tools){
    const row=document.createElement('tr');
    const fingerprint=document.createElement('td');fingerprint.append(fingerprintControl(tool.tool_name_hash));
    const contract=document.createElement('td');contract.textContent=[...(tool.adapters||[]),...(tool.versions||[]).map(version=>'v'+version)].join(' · ')||'—';
    const release=document.createElement('td');const releases=tool.releases||[];release.textContent=releases.length?releases.map(item=>item.environment+' / '+item.compatibility).join(', '):'Not promoted';
    const actions=document.createElement('td');actions.textContent='Schema / release authority';
    row.append(fingerprint,contract,release,actions);toolRows.append(row)
  }
  const runtime=q('inventory-runtime-list');runtime.replaceChildren();
  const actionProfiles=inventory.action_profiles||[];
  const providers=inventory.observed_runtime?.providers||[];
  const frameworks=inventory.observed_runtime?.frameworks||[];
  if(actionProfiles.length===0&&providers.length===0&&frameworks.length===0){const empty=document.createElement('p');empty.textContent='No action or conformance evidence recorded yet.';runtime.append(empty)}
  for(const profile of actionProfiles){const item=document.createElement('div');const label=fingerprintControl(profile.tool_name_hash||'Unknown action fingerprint');const detail=document.createElement('span');detail.textContent='Registered action policy · '+String(profile.environment||'unknown')+' · '+String(profile.risk_level||'unclassified')+' · '+String(profile.side_effect||'unknown');item.append(label,detail);runtime.append(item)}
  for(const provider of providers){const item=document.createElement('div');const label=document.createElement('strong');label.textContent=String(provider.provider||'Unknown provider');const detail=document.createElement('span');detail.textContent=((provider.frameworks||[]).join(', ')||'No framework')+' · '+((provider.statuses||[]).join(', ')||'untested');item.append(label,detail);runtime.append(item)}
  for(const framework of frameworks){const item=document.createElement('div');const label=document.createElement('strong');label.textContent=String(framework.framework||'Unknown framework');const detail=document.createElement('span');detail.textContent=((framework.adapters||[]).join(', ')||'No adapter')+' · '+((framework.versions||[]).join(', ')||'version not recorded');item.append(label,detail);runtime.append(item)}
  const limitations=inventory.discovery?.limitations||[];
  text('inventory-boundary',limitations.length?limitations.join(' '):'Registered and observed assets only. This is not endpoint, cloud-account, shadow-agent, or shadow-MCP discovery.');
}
function renderSettings(data){
  const lifecycle=data.lifecycle.lifecycle||{};
  text('lifecycle-status',value(lifecycle,'status'));text('lifecycle-reason',value(lifecycle,'reason'));text('lifecycle-deletion-time',value(lifecycle,'deletion_requested_at'));text('lifecycle-updated',formatTime(value(lifecycle,'updated_at')));
  text('lifecycle-state',value(lifecycle,'status'));
  q('policy-editor').value=JSON.stringify(data.policy.policy||data.policy,null,2);
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
  text('service-state',data.serviceReadiness.status==='ready'?'Ready':data.serviceReadiness.status);
  q('quota-meter').style.setProperty('--quota-scale',(quotaPercent/100).toFixed(3));
  q('quota-meter-track').setAttribute('aria-valuenow',quotaPercent.toFixed(1));
  q('protection-state').className='status-pill '+(integrityValid?'':'bad');
  text('protection-state-text',integrityValid?'Protection healthy':'Integrity attention required');
  renderChecklist([
    {label:'Managed service readiness',ready:data.serviceHealth.status==='ok'&&data.serviceReadiness.status==='ready',note:'Liveness and dependency readiness are observed through the same service boundary',route:'evidence'},
    {label:'Control-plane integrity',ready:integrityValid,note:integrityValid?'Signed state verified':'Open integrity details before action traffic',route:'evidence'},
    {label:'Production schema admission',ready:Boolean(production&&production.schema_enforcement==='enforce'&&productionReleased),note:productionReleased?'Production has a reviewed release':'Promote and enforce a reviewed schema',route:'schemas'},
    {label:'Schema registry',ready:schemas.length>0,note:schemas.length+' latest registered contract(s) are reachable',route:'schemas'},
    {label:'Action classification',ready:descriptors.length>0,note:descriptors.length+' signed action descriptor(s) are reachable',route:'actions'},
    {label:'Approval queue',ready:pendingChallenges.length===0,note:pendingChallenges.length+' pending approval challenge(s)',route:'approvals'},
    {label:'Independent checkpoint',ready:Boolean(data.checkpoint&&data.checkpoint.revision!==undefined),note:'Latest idempotency checkpoint is available for comparison',route:'actions'},
    {label:'Alert delivery',ready:(data.webhooks.webhooks||[]).some(item=>item.disabled_at===null||item.enabled===true),note:'Configure and exercise a customer-owned HTTPS receiver',route:'alerts'},
    {label:'Audit chain',ready:Boolean(data.chain.valid),note:data.chain.valid?'Retained decisions verify':'Stop and investigate chain integrity',route:'evidence'}
  ]);
  renderDecisions(data.audits.audits||[]);
  renderAlerts(data.alerts.alerts||[]);
  renderIntegration(data);
}
q('load').onclick=async()=>{
  const generation=++loadGeneration;
  if(activeLoadController)activeLoadController.abort();
  const controller=new AbortController();activeLoadController=controller;
  const key=q('key').value;
  const options={signal:controller.signal};
  const loadGet=path=>get(path,options,key);
  const loadGetOptional=path=>getOptional(path,options,key);
  const loadReadiness=async()=>{
    const result=await requestRaw('/readyz',options,key);
    if(result.ok||result.status===503)return result.body;
    throw new Error(result.body?.message||result.body?.error||('HTTP '+result.status));
  };
  clearPanels();q('status').className='';q('status').textContent='Loading…';resetDerivedViews();workspace.dataset.connected='false';setCredentialMode('editing');text('connection-label','Connecting');
  try{
    const [serviceHealth,serviceReadiness,lifecycle]=await Promise.all([loadGet('/healthz'),loadReadiness(),loadGet('/v1/admin/tenant/lifecycle')]);
    if(generation!==loadGeneration)return;
    q('lifecycle').textContent=JSON.stringify(lifecycle,null,2);
    text('tenant-name',lifecycle.tenant_name||lifecycle.tenant_id||'Tenant');
    text('tenant-avatar',String(lifecycle.tenant_name||lifecycle.tenant_id||'Tenant').slice(0,1).toUpperCase());
    if(lifecycle.lifecycle.status!=='active'){workspace.dataset.connected='false';setCredentialMode('editing');text('connection-label','Access locked');q('protection-state').className='status-pill bad';text('protection-state-text','Tenant '+lifecycle.lifecycle.status);q('status').className='bad';q('status').textContent='Loaded — operational access is locked';return}
    const [usage,chain,audits,alerts,intelligence,environments,releases,releaseChain,schemas,policy,descriptors,actionControl,challenges,webhooks,deliveries,notifications,checkpoint,anchorDeliveries,reconciliationPending,reconciliationHistory,reconciliationChain,billing,integrity,ruleset,apiKeys,plans,inventory]=await Promise.all([
      loadGet('/v1/usage'),loadGet('/v1/audits/verify'),loadGet('/v1/audits?limit=25'),loadGet('/v1/alerts'),loadGet('/v1/intelligence'),loadGet('/v1/environments'),loadGet('/v1/schema-releases?limit=25'),loadGet('/v1/schema-releases/verify'),
      loadGet('/v1/schemas'),loadGet('/v1/admin/policy'),loadGet('/v1/admin/actions/descriptors'),loadGet('/v1/admin/actions/control'),loadGet('/v1/actions/challenges?limit=100'),
      loadGet('/v1/alert-webhooks'),loadGet('/v1/alert-webhooks/deliveries?limit=100'),loadGet('/v1/admin/notifications'),loadGet('/v1/actions/idempotency/checkpoint'),loadGet('/v1/actions/idempotency/anchors/deliveries?limit=100'),
      loadGet('/v1/actions/reconciliation/pending'),loadGet('/v1/actions/reconciliation/history'),loadGet('/v1/actions/reconciliation/verify'),loadGet('/v1/billing/statement'),loadGet('/v1/admin/control-plane-integrity'),loadGetOptional('/v1/rulesets/latest'),loadGet('/v1/admin/api-keys'),loadGet('/v1/plans'),loadGet('/v1/inventory')
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
    q('notifications').textContent=JSON.stringify(notifications,null,2);
    q('actions').textContent=JSON.stringify({control:actionControl,checkpoint,anchor_deliveries:anchorDeliveries.deliveries},null,2);
    q('reconciliation').textContent=JSON.stringify({pending:reconciliationPending.pending,reconciliations:reconciliationHistory.reconciliations,chain:reconciliationChain},null,2);
    q('billing').textContent=JSON.stringify(billing,null,2);
    q('control-integrity').textContent=JSON.stringify(integrity,null,2);
    q('rulesets').textContent=JSON.stringify(ruleset,null,2);
    q('api-keys').textContent=JSON.stringify(apiKeys,null,2);
    workspaceData={serviceHealth,serviceReadiness,lifecycle,usage,chain,audits,alerts,intelligence,environments,releases,releaseChain,schemas,policy,descriptors,actionControl,challenges,webhooks,deliveries,notifications,checkpoint,anchorDeliveries,reconciliationPending,reconciliationHistory,reconciliationChain,billing,integrity,ruleset,apiKeys,plans,inventory};
    renderOverview(workspaceData);renderSchemas(workspaceData);renderEnvironments(workspaceData);renderActions(workspaceData);renderChallenges(workspaceData);renderAlertOperations(workspaceData);renderIntelligence(workspaceData);renderEvidence(workspaceData);renderAccess(workspaceData);renderUsage(workspaceData);renderSettings(workspaceData);
    workspace.dataset.connected='true';setCredentialMode('connected');text('connection-label','Connected');q('status').className='good';q('status').textContent='Workspace loaded';
  }catch(error){if(generation!==loadGeneration||error?.name==='AbortError')return;workspace.dataset.connected='false';setCredentialMode('editing');text('connection-label','Not connected');clearPanels();resetDerivedViews();q('status').className='bad';q('status').textContent=error instanceof Error?error.message:'Request failed'}
  finally{if(generation===loadGeneration)activeLoadController=null}
};
q('key').addEventListener('keydown',event=>{if(event.key==='Enter')q('load').click()});
q('change-key').onclick=()=>{setCredentialMode('editing');q('key').focus();q('key').select()};
q('sign-out').onclick=async()=>{
  try{
    const result=await requestRaw('/v1/auth/logout',{method:'POST'},'');
    if(!result.ok)throw new Error(result.body?.message||'Sign out failed');
    browserSession=false;workspace.dataset.connected='false';setCredentialMode('editing');clearPanels();resetDerivedViews();location.assign(result.body?.logout_url||'/');
  }catch(error){q('status').className='bad';q('status').textContent=error instanceof Error?error.message:'Sign out failed'}
};
async function refreshSchemas(){
  const [schemas,releases,releaseChain]=await Promise.all([get('/v1/schemas'),get('/v1/schema-releases?limit=25'),get('/v1/schema-releases/verify')]);
  Object.assign(workspaceData,{schemas,releases,releaseChain});q('schemas').textContent=JSON.stringify(schemas,null,2);q('releases').textContent=JSON.stringify({chain:releaseChain,releases:releases.releases},null,2);renderSchemas(workspaceData);return refreshInventoryBestEffort();
}
async function refreshDecisions(){
  const [usage,chain,audits,alerts,intelligence]=await Promise.all([get('/v1/usage'),get('/v1/audits/verify'),get('/v1/audits?limit=25'),get('/v1/alerts'),get('/v1/intelligence')]);
  Object.assign(workspaceData,{usage,chain,audits,alerts,intelligence});q('usage').textContent=JSON.stringify(usage,null,2);q('chain').textContent=JSON.stringify(chain,null,2);q('audits').textContent=JSON.stringify(compactAudits(audits.audits),null,2);q('alerts').textContent=JSON.stringify(compactAlerts(alerts.alerts),null,2);q('intelligence').textContent=JSON.stringify(intelligence,null,2);renderOverview(workspaceData);renderAlertOperations(workspaceData);renderIntelligence(workspaceData);renderEvidence(workspaceData);renderUsage(workspaceData);
}
async function refreshEnvironments(){
  const environments=await get('/v1/environments');Object.assign(workspaceData,{environments});q('releases').textContent=JSON.stringify({environments:environments.environments,chain:workspaceData.releaseChain,releases:workspaceData.releases.releases},null,2);renderEnvironments(workspaceData);return refreshInventoryBestEffort();
}
async function refreshActions(){
  const [descriptors,actionControl,checkpoint,anchorDeliveries,reconciliationPending,reconciliationHistory,reconciliationChain]=await Promise.all([get('/v1/admin/actions/descriptors'),get('/v1/admin/actions/control'),get('/v1/actions/idempotency/checkpoint'),get('/v1/actions/idempotency/anchors/deliveries?limit=100'),get('/v1/actions/reconciliation/pending'),get('/v1/actions/reconciliation/history'),get('/v1/actions/reconciliation/verify')]);
  Object.assign(workspaceData,{descriptors,actionControl,checkpoint,anchorDeliveries,reconciliationPending,reconciliationHistory,reconciliationChain});q('descriptors').textContent=JSON.stringify(descriptors,null,2);q('actions').textContent=JSON.stringify({control:actionControl,checkpoint,anchor_deliveries:anchorDeliveries.deliveries},null,2);q('reconciliation').textContent=JSON.stringify({pending:reconciliationPending.pending,reconciliations:reconciliationHistory.reconciliations,chain:reconciliationChain},null,2);renderActions(workspaceData);return refreshInventoryBestEffort();
}
async function refreshChallenges(){const challenges=await get('/v1/actions/challenges?limit=100');workspaceData.challenges=challenges;q('challenges').textContent=JSON.stringify(challenges,null,2);renderChallenges(workspaceData)}
async function refreshAlerts(){
  const [alerts,webhooks,deliveries,notifications]=await Promise.all([get('/v1/alerts'),get('/v1/alert-webhooks'),get('/v1/alert-webhooks/deliveries?limit=100'),get('/v1/admin/notifications')]);
  Object.assign(workspaceData,{alerts,webhooks,deliveries,notifications});q('alerts').textContent=JSON.stringify(compactAlerts(alerts.alerts),null,2);q('webhooks').textContent=JSON.stringify(webhooks,null,2);q('deliveries').textContent=JSON.stringify(deliveries,null,2);q('notifications').textContent=JSON.stringify(notifications,null,2);renderAlertOperations(workspaceData);
}
async function refreshIntelligence(){
  const [intelligence,ruleset]=await Promise.all([get('/v1/intelligence'),getOptional('/v1/rulesets/latest')]);Object.assign(workspaceData,{intelligence,ruleset});q('intelligence').textContent=JSON.stringify(intelligence,null,2);q('rulesets').textContent=JSON.stringify(ruleset,null,2);renderIntelligence(workspaceData);return refreshInventoryBestEffort();
}
async function refreshInventoryBestEffort(){try{const inventory=await get('/v1/inventory');workspaceData.inventory=inventory;renderIntegration(workspaceData);return true}catch{return false}}
const savedWithInventory=(message,fresh)=>fresh?message:message+'; supplemental inventory refresh pending';
async function refreshAccess(){const apiKeys=await get('/v1/admin/api-keys');workspaceData.apiKeys=apiKeys;q('api-keys').textContent=JSON.stringify(apiKeys,null,2);renderAccess(workspaceData)}
async function refreshUsage(){
  const [usage,billing,plans]=await Promise.all([get('/v1/usage'),get('/v1/billing/statement'),get('/v1/plans')]);Object.assign(workspaceData,{usage,billing,plans});q('usage').textContent=JSON.stringify(usage,null,2);q('billing').textContent=JSON.stringify(billing,null,2);renderUsage(workspaceData);
}
async function refreshSettings(){
  const [lifecycle,policy]=await Promise.all([get('/v1/admin/tenant/lifecycle'),get('/v1/admin/policy')]);Object.assign(workspaceData,{lifecycle,policy});q('lifecycle').textContent=JSON.stringify(lifecycle,null,2);q('policy').textContent=JSON.stringify(policy,null,2);renderSettings(workspaceData);
}
function bindForm(id,statusId,handler){
  q(id).addEventListener('submit',async event=>{
    event.preventDefault();const submit=q(id).querySelector('[type="submit"]');submit.disabled=true;status(statusId,'Working…');
    try{const message=await handler();status(statusId,message||'Saved','good')}catch(error){status(statusId,error instanceof Error?error.message:'Request failed','bad')}finally{submit.disabled=false}
  });
}
function showJson(id,result){const node=q(id);node.hidden=false;node.textContent=JSON.stringify(result,null,2)}
function showSecret(id,label,secret){
  const node=q(id);node.replaceChildren();node.hidden=false;const copy=document.createElement('p');copy.textContent=label+' is shown once. Copy it into a secret manager now.';
  const button=actionButton('Copy secret',async()=>{await navigator.clipboard.writeText(secret);button.textContent='Copied'});
  node.append(copy,button);
}
bindForm('validate-form','validate-status',async()=>{
  const node=q('validate-result');node.hidden=true;node.replaceChildren();
  const response=await requestRaw('/v1/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tool_name:q('validate-tool').value,tool_schema:parseJson('validate-schema'),raw_arguments:parseJson('validate-arguments'),context:{environment:q('validate-environment').value,adapter:'json_schema'}})});
  const result=response.body;
  if(!response.ok&&!(response.status===422&&result?.decision==='rejected'))throw new Error(result?.message||result?.error||('HTTP '+response.status));
  await refreshDecisions();
  node.hidden=false;const outcome=document.createElement('strong');outcome.textContent=value(result,'decision','outcome');const reason=document.createElement('span');reason.textContent='Reason: '+value(result,'reason_code','reason');const audit=document.createElement('code');audit.textContent='Audit '+value(result,'audit_id');node.append(outcome,reason,audit);
  q('challenge-decision').value=JSON.stringify(result,null,2);q('action-decision').value=JSON.stringify(result,null,2);return 'Decision recorded';
});
bindForm('compile-form','compile-status',async()=>{
  const node=q('compile-result');node.hidden=true;node.replaceChildren();
  const response=await requestRaw('/v1/contracts/compile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({target:q('compile-target').value,tool_name:q('compile-tool').value,tool_schema:parseJson('compile-schema')})});
  const result=response.body;
  if(response.status===422&&result?.status==='unsupported'){
    showJson('compile-result',result);
    throw new Error('Contract unsupported — review the blocker issues');
  }
  if(!response.ok)throw new Error(result?.message||result?.error||('HTTP '+response.status));
  showJson('compile-result',result);return 'Contract compiled';
});
bindForm('schema-register-form','schema-register-status',async()=>{await request('/v1/schemas',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tool_name:q('schema-tool').value,adapter:q('schema-adapter').value,version:q('schema-version').value,schema:parseJson('schema-body')})});return savedWithInventory('Schema version registered',await refreshSchemas())});
bindForm('schema-release-form','schema-release-status',async()=>{
  const environment=q('release-environment');await request('/v1/schema-releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({environment:environment.selectedOptions[0]?.dataset.name||environment.value,tool_name:q('release-tool').value,adapter:q('release-adapter').value,version:q('release-version').value,expected_schema_hash:q('release-hash').value})});return savedWithInventory('Schema release promoted',await refreshSchemas());
});
bindForm('environment-create-form','environment-create-status',async()=>{await request('/v1/admin/environments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:q('environment-name').value,policy:parseJson('environment-policy-initial')})});return savedWithInventory('Environment created',await refreshEnvironments())});
bindForm('environment-update-form','environment-update-status',async()=>{
  const id=q('environment-select').value;await request('/v1/admin/environments/'+encodeURIComponent(id)+'/policy',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(parseJson('environment-policy-editor'))});await request('/v1/admin/environments/'+encodeURIComponent(id)+'/schema-enforcement',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({mode:q('environment-enforcement').value})});return savedWithInventory('Environment policy and enforcement saved',await refreshEnvironments());
});
q('environment-select').onchange=()=>{if(!workspaceData)return;const item=(workspaceData.environments.environments||[]).find(environment=>(environment.id||environment.name)===q('environment-select').value);if(item){q('environment-enforcement').value=item.schema_enforcement||'observe';q('environment-policy-editor').value=JSON.stringify(item.policy||{},null,2)}};
bindForm('descriptor-form','descriptor-status',async()=>{const environment=q('descriptor-environment');await request('/v1/admin/actions/descriptors',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({tool_name:q('descriptor-tool').value,environment:environment.selectedOptions[0]?.dataset.name||environment.value,risk_level:q('descriptor-risk').value,side_effect:q('descriptor-side-effect').value})});return savedWithInventory('Action descriptor saved',await refreshActions())});
bindForm('action-control-form','action-control-status',async()=>{
  const hold=q('action-control-hold').checked;
  const reason=q('action-control-reason').value.trim()||null;
  if(hold&&!reason)throw new Error('Emergency hold requires a reason code');
  const shadow=q('action-control-shadow').value.trim();
  if(hold&&!await confirmAction({title:'Hold all tenant actions?',copy:'Every action evaluation will be rejected before approval and idempotency reservation until an administrator clears this hold.',confirmLabel:'Activate action hold',kicker:'Emergency control',tone:'danger'}))return 'Action-control change canceled';
  await request('/v1/admin/actions/control',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({hold,reason_code:reason,enforced_policy:parseJson('action-control-enforced'),shadow_policy:shadow?JSON.parse(shadow):null})});
  q('action-control-confirm').checked=false;
  await refreshActions();
  return hold?'Emergency action hold is active':'Action controls saved';
});
bindForm('action-evaluate-form','action-evaluate-status',async()=>{const environment=q('action-environment');const workload=q('action-workload-identity').value.trim();const result=await request('/v1/actions/evaluate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tool_name:q('action-tool').value,environment:environment.selectedOptions[0]?.dataset.name||environment.value,...(workload?{workload_identity:workload}:{}),idempotency_key:q('action-idempotency-key').value,decision:parseJson('action-decision'),approval:parseJson('action-approval')})});showJson('action-evaluate-result',result);return savedWithInventory('Action evaluation recorded',await refreshActions())});
bindForm('reservation-form','reservation-status',async()=>{await request('/v1/actions/idempotency/'+q('reservation-transition').value,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idempotency_key:q('reservation-key').value,execution_fingerprint:q('reservation-fingerprint').value})});return savedWithInventory('Reservation transition recorded',await refreshActions())});
bindForm('checkpoint-compare-form','checkpoint-compare-status',async()=>{const result=await request('/v1/actions/idempotency/checkpoint/compare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({checkpoint:parseJson('checkpoint-input')})});showJson('checkpoint-compare-result',result);return 'Checkpoint compared'});
for(const button of document.querySelectorAll('[data-challenge-filter]'))button.onclick=()=>{challengeFilter=button.dataset.challengeFilter||'all';for(const peer of document.querySelectorAll('[data-challenge-filter]'))peer.classList.toggle('active',peer===button);if(workspaceData)renderChallenges(workspaceData)};
bindForm('challenge-form','challenge-status',async()=>{const environment=q('challenge-environment');const workload=q('challenge-workload-identity').value.trim();await request('/v1/actions/challenges',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tool_name:q('challenge-tool').value,environment:environment.selectedOptions[0]?.dataset.name||environment.value,...(workload?{workload_identity:workload}:{}),decision:parseJson('challenge-decision'),expires_in_seconds:number(q('challenge-expires').value)})});await refreshChallenges();return 'Approval challenge created'});
bindForm('webhook-create-form','webhook-create-status',async()=>{const result=await request('/v1/alert-webhooks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:q('webhook-label').value,endpoint:q('webhook-endpoint').value})});const secret=value(result,'signing_secret','secret','webhook_secret');if(secret!=='—')showSecret('webhook-secret','Webhook signing secret',String(secret));try{await refreshAlerts();return 'Alert receiver created'}catch{return 'Alert receiver created; copy the secret now, then reload inventory'}});
bindForm('notification-create-form','notification-create-status',async()=>{await request('/v1/admin/notifications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:q('notification-kind').value,to:q('notification-recipient').value,template_alias:q('notification-template').value,template_model:parseJson('notification-model'),idempotency_key:q('notification-idempotency').value})});q('notification-confirm').checked=false;await refreshAlerts();return 'Transactional email queued'});
bindForm('conformance-form','conformance-status',async()=>{await request('/v1/conformance-runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:q('conformance-provider').value,provider_version:q('conformance-provider-version').value,framework:q('conformance-framework').value,framework_version:q('conformance-framework-version').value,adapter:q('conformance-adapter').value,suite_version:q('conformance-suite').value,executed_at:new Date().toISOString(),passed:number(q('conformance-passed').value),failed:number(q('conformance-failed').value),repaired:0,rejected:0})});return savedWithInventory('Conformance run recorded',await refreshIntelligence())});
bindForm('ruleset-form','ruleset-status',async()=>{const issued=new Date();await request('/v1/admin/rulesets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:q('ruleset-version').value,issued_at:issued.toISOString(),expires_at:new Date(issued.getTime()+number(q('ruleset-days').value)*86400000).toISOString(),rules:parseJson('ruleset-body')})});return savedWithInventory('Signed ruleset published',await refreshIntelligence())});
bindForm('api-key-form','api-key-status',async()=>{const scopes=Array.from(q('scope-picker').querySelectorAll('input:checked')).map(input=>input.value);if(!scopes.length)throw new Error('Select at least one scope');const result=await request('/v1/admin/api-keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scopes})});showSecret('api-key-secret','Tenant API key',result.api_key);for(const input of q('scope-picker').querySelectorAll('input'))input.checked=false;q('api-key-confirm').checked=false;try{await refreshAccess();return 'API key created'}catch{return 'API key created; copy the key now, then reload inventory'}});
async function billingAction(path){
  const result=await request(path,{method:'POST'});const target=value(result,'url','checkout_url','portal_url');
  if(target!=='—'){const link=document.createElement('a');link.href=String(target);link.target='_blank';link.rel='noopener';link.textContent='Continue to billing provider';q('billing-action-status').replaceChildren(link)}else status('billing-action-status','Provider returned no destination','bad');
}
q('billing-checkout').onclick=async()=>{status('billing-action-status','Creating checkout…');try{await billingAction('/v1/billing/checkout-session')}catch(error){status('billing-action-status',error instanceof Error?error.message:'Checkout unavailable','bad')}};
q('billing-portal').onclick=async()=>{status('billing-action-status','Opening portal…');try{await billingAction('/v1/billing/portal-session')}catch(error){status('billing-action-status',error instanceof Error?error.message:'Portal unavailable','bad')}};
q('local-plan-change').onclick=async()=>{if(!q('local-plan-confirm').checked){status('billing-action-status','Confirm the local-only plan change first','bad');return}status('billing-action-status','Applying plan…');try{await request('/v1/admin/plan',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({plan:q('local-plan-select').value})});await refreshUsage();status('billing-action-status','Local evaluation plan applied','good')}catch(error){status('billing-action-status',error instanceof Error?error.message:'Plan change blocked','bad')}};
bindForm('policy-form','policy-status',async()=>{await request('/v1/admin/policy',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(parseJson('policy-editor'))});await refreshSettings();return 'Organization policy saved'});
q('retention-purge').onclick=async()=>{if(!q('retention-confirm').checked){status('retention-status','Confirm the irreversible purge first','bad');return}if(!await confirmAction({title:'Purge expired audit records?',copy:'Permanently remove audits older than this tenant’s retention window. The signed anchor boundary remains, but deleted records cannot be recovered.',confirmLabel:'Purge expired audits',kicker:'Irreversible data action',tone:'danger'}))return;status('retention-status','Purging…');try{const result=await request('/v1/admin/retention/purge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({before:new Date(Date.now()-number(workspaceData?.usage?.entitlements?.retention_days||30)*86400000).toISOString()})});status('retention-status','Purged '+number(value(result,'deleted','purged','deleted_count'))+' audit records','good')}catch(error){status('retention-status',error instanceof Error?error.message:'Purge failed','bad')}};
async function downloadAuditCsv(){
  const headers={};if(q('key').value)headers.authorization='Bearer '+q('key').value;
  const response=await fetch('/v1/audits?format=csv',{headers,credentials:'same-origin',cache:'no-store'});if(!response.ok){const body=await parseBody(response);throw new Error(body?.message||body?.error||'Audit CSV export failed')}const blob=await response.blob();const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='akriven-audits.csv';link.click();URL.revokeObjectURL(link.href);
}
for(const id of ['audit-csv','evidence-audit-csv'])q(id).onclick=async()=>{try{await downloadAuditCsv();q('status').className='good';q('status').textContent='Audit CSV downloaded'}catch(error){q('status').className='bad';q('status').textContent=error instanceof Error?error.message:'Audit CSV failed'}};
q('evaluation-export').onclick=async()=>{
  const button=q('evaluation-export');button.disabled=true;
  try{
    const data=await get('/v1/intelligence/evaluation-export');
    const blob=new Blob([JSON.stringify(data,null,2)+'\\n'],{type:'application/json'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='akriven-value-free-evaluation.json';link.click();URL.revokeObjectURL(link.href);
    q('status').className='good';q('status').textContent='Value-free evaluation evidence downloaded';
  }catch(error){q('status').className='bad';q('status').textContent=error instanceof Error?error.message:'Evaluation export failed'}finally{button.disabled=false}
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
q('export-secondary').onclick=()=>q('export').click();
q('settings-export').onclick=()=>q('export').click();
q('request-deletion').onclick=async()=>{
  q('deletion-result').textContent='Submitting request…';
  try{
    const result=await request('/v1/admin/tenant/deletion-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm_tenant_id:q('deletion-confirm').value})});
    q('lifecycle').textContent=JSON.stringify({lifecycle:result.lifecycle},null,2);
    q('deletion-result').textContent='Deletion requested. An operator must verify the export before execution.';
    workspace.dataset.connected='false';setCredentialMode('editing');text('connection-label','Access locked');
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
  action_control:{method:'PUT',path:'/v1/admin/actions/control',body:{hold:false,reason_code:null,enforced_policy:{max_auto_execute_risk:'low',max_repaired_auto_execute_risk:'read',require_idempotency_for_side_effects:true},shadow_policy:null}},
  action_challenge:{method:'POST',path:'/v1/actions/challenges',body:{tool_name:'counter',environment:'development',workload_identity:'[REPLACE:WORKLOAD_IDENTITY]',decision:'[REPLACE:ACCEPTED_DECISION_OBJECT]',expires_in_seconds:300}},
  action_approve:{method:'POST',path:'/v1/actions/challenges/{CHALLENGE_ID}/approve',body:{}},
  action_cancel:{method:'DELETE',path:'/v1/actions/challenges/{CHALLENGE_ID}',body:null,mutation:true},
  action_evaluate:{method:'POST',path:'/v1/actions/evaluate',body:{tool_name:'counter',environment:'development',workload_identity:'[REPLACE:WORKLOAD_IDENTITY]',decision:'[REPLACE:ACCEPTED_DECISION_OBJECT]',idempotency_key:'[REPLACE:UNIQUE_IDEMPOTENCY_KEY]',approval:'[REPLACE:APPROVED_CHALLENGE_OBJECT]'}},
  action_complete:{method:'POST',path:'/v1/actions/idempotency/complete',body:{idempotency_key:'[REPLACE:UNIQUE_IDEMPOTENCY_KEY]',execution_fingerprint:'[REPLACE:EXECUTION_FINGERPRINT]'}},
  action_release:{method:'POST',path:'/v1/actions/idempotency/release',body:{idempotency_key:'[REPLACE:UNIQUE_IDEMPOTENCY_KEY]',execution_fingerprint:'[REPLACE:EXECUTION_FINGERPRINT]'},mutation:true},
  checkpoint_compare:{method:'POST',path:'/v1/actions/idempotency/checkpoint/compare',body:{checkpoint:'[REPLACE:CHECKPOINT_OBJECT]'}},
  anchor_redrive:{method:'POST',path:'/v1/actions/idempotency/anchors/deliveries/{DELIVERY_ID}/redrive',body:{}},
  reconcile:{method:'POST',path:'/v1/actions/reconciliation/{RESERVATION_ID}',body:{outcome:'confirmed_executed',evidence_reference:'[REPLACE:LEDGER_REFERENCE]'},mutation:true},
  conformance_run:{method:'POST',path:'/v1/conformance-runs',body:{provider:'openai',provider_version:'[REPLACE:PINNED_PROVIDER_VERSION]',framework:'openai-agents',framework_version:'[REPLACE:PINNED_FRAMEWORK_VERSION]',adapter:'openai_agents',suite_version:'[REPLACE:REVIEWED_SUITE_VERSION]',executed_at:'[REPLACE:EXECUTION_TIMESTAMP]',passed:1,failed:0,repaired:0,rejected:0}},
  webhook_create:{method:'POST',path:'/v1/alert-webhooks',body:{label:'on-call',endpoint:'[REPLACE:PUBLIC_HTTPS_WEBHOOK_URL]'}},
  webhook_redrive:{method:'POST',path:'/v1/alert-webhooks/deliveries/{DELIVERY_ID}/redrive',body:{}},
  webhook_disable:{method:'DELETE',path:'/v1/alert-webhooks/{WEBHOOK_ID}',body:null,mutation:true},
  notification_create:{method:'POST',path:'/v1/admin/notifications',body:{kind:'security_alert',to:'[REPLACE:RECIPIENT_EMAIL]',template_alias:'[REPLACE:REVIEWED_TEMPLATE_ALIAS]',template_model:{incident_reference:'[REPLACE:NON_SENSITIVE_REFERENCE]'},idempotency_key:'[REPLACE:UNIQUE_IDEMPOTENCY_KEY]'}},
  notification_redrive:{method:'POST',path:'/v1/admin/notifications/{NOTIFICATION_ID}/redrive',body:{}},
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
    const bodyless=method==='GET'||method==='HEAD';
    if(!bodyless&&!q('operation-confirm').checked)throw new Error('Confirm this mutation before executing');
    const raw=q('operation-body').value.trim();
    const options={method,headers:{}};
    if(raw&&!bodyless){
      if(/\\[REPLACE:[A-Z0-9_]+\\]/u.test(raw))throw new Error('Replace every JSON placeholder before execution');
      options.headers['content-type']='application/json';options.body=JSON.stringify(JSON.parse(raw));
    }
    const result=await requestRaw(path,options);
    q('operation-result').textContent=JSON.stringify(result,null,2);
    q('operation-result').className=result.ok?'':'bad';
  }catch(error){q('operation-result').className='bad';q('operation-result').textContent=error instanceof Error?error.message:'Operation failed'}
};
loadPreset();
for(const button of document.querySelectorAll('[data-preset]'))button.onclick=()=>{
  q('operation').value=button.dataset.preset;loadPreset();navigate('workbench');
};
void (async()=>{
  try{
    const session=await requestRaw('/v1/auth/session',{},'');
    if(!session.ok)return;
    browserSession=true;
    q('key').value='';
    q('load').click();
  }catch{}
})();
`;
