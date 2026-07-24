export const dashboardStyle = `
/*
THESIS: Akriven is an evidence console organized around operator jobs, never a single scrolling API document.
OWN-WORLD: Warm paper, near-black ink, one-pixel rules, restrained white surfaces, and rare acid-lime state.
STORY: Connect a tenant, move between focused protection workflows, act deliberately, and inspect exact evidence.
FIRST VIEWPORT: Collapsible product navigation, compact workspace header, protection summary, readiness, and live work.
FORM: Multi-page operational shell inherited from the commercial Akriven identity.
*/
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;src:url("/dashboard/fonts/geist-sans.woff2") format("woff2-variations")}
@font-face{font-family:"Geist Mono";font-style:normal;font-weight:100 900;font-display:swap;src:url("/dashboard/fonts/geist-mono.woff2") format("woff2-variations")}
:root{
  color-scheme:light;
  --ink:#11131a;
  --ink-hover:#242731;
  --ink-soft:#3f433f;
  --paper:#f5f4ee;
  --paper-deep:#ebe9df;
  --white:#fffefa;
  --acid:#ddfe52;
  --mint:#72e6b1;
  --coral:#ff6b5e;
  --muted:#676b66;
  --line:rgba(17,19,26,.16);
  --line-strong:rgba(17,19,26,.42);
  --green:#14734f;
  --amber:#8a5700;
  --red:#b12b22;
  --sidebar:248px;
  --sidebar-collapsed:72px;
  --ease-out:cubic-bezier(.23,1,.32,1);
  --ease-in-out:cubic-bezier(.77,0,.175,1);
  --sans:Geist,"Helvetica Neue",Arial,ui-sans-serif,system-ui,sans-serif;
  --mono:"Geist Mono","SFMono-Regular",Consolas,ui-monospace,monospace
}
*{box-sizing:border-box}
html{background:var(--paper-deep)}
body{margin:0;color:var(--ink);background:var(--paper-deep);font:14px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer}
button:disabled{cursor:not-allowed;opacity:.46}
a{color:inherit}
a,button,input,select,textarea{outline:none}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{
  box-shadow:0 0 0 2px var(--paper),0 0 0 4px var(--ink),0 0 0 6px var(--acid)
}
::selection{color:var(--ink);background:var(--acid)}
[hidden]{display:none!important}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip-link{position:fixed;z-index:1000;left:1rem;top:1rem;padding:.65rem .8rem;color:var(--paper);background:var(--ink);border:1px solid var(--ink);transform:translateY(-180%);transition:transform 150ms var(--ease-out)}
.skip-link:focus{transform:translateY(0)}

.app-shell{min-height:100vh;display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr);background:var(--paper);transition:grid-template-columns 200ms var(--ease-out)}
.app-shell[data-sidebar="collapsed"]{grid-template-columns:var(--sidebar-collapsed) minmax(0,1fr)}
.sidebar{
  position:sticky;z-index:40;top:0;height:100vh;overflow:hidden;
  display:flex;flex-direction:column;background:var(--ink);color:var(--paper);
  border-right:1px solid var(--ink)
}
.sidebar-head{height:72px;display:flex;align-items:center;gap:.75rem;padding:0 14px;border-bottom:1px solid rgba(245,244,238,.15)}
.brand{min-width:0;display:flex;align-items:center;gap:.7rem;text-decoration:none;font-size:17px;font-weight:650;letter-spacing:-.035em}
.brand-mark{display:block;width:34px;height:34px;flex:none;transition:opacity 130ms ease}
.brand-copy{white-space:nowrap;transition:opacity 130ms ease,transform 180ms var(--ease-out)}
.sidebar-toggle,.mobile-nav-toggle,.icon-button{
  width:38px;height:38px;flex:none;display:grid;place-items:center;padding:0;
  border:1px solid var(--line-strong);border-radius:6px;background:transparent;color:inherit;
  transition:background 150ms ease,transform 140ms var(--ease-out)
}
.sidebar-toggle{position:absolute;left:198px;top:17px;border-color:rgba(245,244,238,.24);transition:left 200ms var(--ease-out),background 150ms ease,transform 200ms var(--ease-out)}
.sidebar-toggle:hover{background:rgba(245,244,238,.1)}
.sidebar-toggle:active,.mobile-nav-toggle:active,.icon-button:active{transform:scale(.97)}
.sidebar-toggle svg,.mobile-nav-toggle svg,.icon-button svg,.nav-link svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.sidebar-nav{flex:1;overflow-y:auto;overflow-x:hidden;padding:18px 10px 12px}
.nav-group{margin-bottom:18px}
.nav-label{display:block;height:22px;padding:0 10px;color:rgba(245,244,238,.52);font:600 9px/22px var(--mono);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;transition:opacity 120ms ease,transform 180ms var(--ease-out)}
.nav-link{
  position:relative;min-height:42px;display:flex;align-items:center;gap:12px;margin:2px 0;padding:0 11px;
  border-radius:6px;color:rgba(245,244,238,.7);text-decoration:none;font-size:13px;font-weight:540;
  transition:color 140ms ease,background 140ms ease,transform 140ms var(--ease-out)
}
.nav-link:hover{color:var(--paper);background:rgba(245,244,238,.08)}
.nav-link:active{transform:scale(.98)}
.nav-link[aria-current="page"]{color:var(--ink);background:var(--paper);font-weight:650}
.nav-link[aria-current="page"]::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:3px;background:var(--acid)}
.nav-link svg{flex:none}
.nav-copy{white-space:nowrap;transition:opacity 120ms ease,transform 180ms var(--ease-out)}
.sidebar-foot{padding:12px;border-top:1px solid rgba(245,244,238,.15)}
.tenant-chip{min-height:58px;display:flex;align-items:center;gap:10px;padding:8px;border:1px solid rgba(245,244,238,.17);border-radius:8px}
.tenant-avatar{width:34px;height:34px;flex:none;display:grid;place-items:center;border-radius:6px;background:var(--acid);color:var(--ink);font-weight:750}
.tenant-copy{min-width:0;transition:opacity 120ms ease,transform 180ms var(--ease-out)}
.tenant-copy strong,.tenant-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tenant-copy strong{font-size:12px}.tenant-copy small{color:rgba(245,244,238,.55);font:10px var(--mono)}
.app-shell[data-sidebar="collapsed"] .brand-copy,
.app-shell[data-sidebar="collapsed"] .nav-copy,
.app-shell[data-sidebar="collapsed"] .nav-label,
.app-shell[data-sidebar="collapsed"] .tenant-copy{opacity:0;transform:translateX(-6px);pointer-events:none}
.app-shell[data-sidebar="collapsed"] .sidebar-toggle{left:17px;transform:rotate(180deg)}
.app-shell[data-sidebar="collapsed"] .brand-mark{opacity:0}
.app-shell[data-sidebar="collapsed"] .nav-link{justify-content:center;padding:0}
.app-shell[data-sidebar="collapsed"] .nav-link[aria-current="page"]::before{top:8px;bottom:8px}
.app-shell[data-sidebar="collapsed"] .tenant-chip{justify-content:center;padding:8px 0;border-color:transparent}

.mobile-backdrop{display:none}
.workspace{min-width:0;background:var(--paper)}
.workspace-bar{
  position:sticky;z-index:30;top:0;min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:20px;
  padding:12px 28px;border-bottom:1px solid var(--line);background:rgba(245,244,238,.94);backdrop-filter:blur(14px)
}
.mobile-nav-toggle{display:none}
.workspace-heading{min-width:0}.workspace-heading h1{margin:0;font-size:20px;line-height:1.2;letter-spacing:-.032em;font-weight:630}
.workspace-heading p{margin:3px 0 0;color:var(--muted);font-size:12px}
.workspace-actions{display:flex;align-items:center;gap:8px}
.connection-dot{width:8px;height:8px;border-radius:50%;background:var(--amber)}
.workspace[data-connected="true"] .connection-dot{background:var(--green)}
.connection-label{font:600 11px var(--mono);color:var(--muted)}

.credential{
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;
  padding:14px 28px;border-bottom:1px solid var(--line);background:var(--paper-deep)
}
.credential-editor{display:grid;grid-template-columns:minmax(240px,520px) auto;gap:8px}
.credential-connected{min-height:42px;display:flex;align-items:center;gap:10px}
.credential-connected .connection-dot{background:var(--green)}
.credential-connected strong,.credential-connected small{display:block}
.credential-connected small{margin-top:2px;font-size:11px}
.workspace[data-credential="connected"] .credential{grid-template-columns:minmax(0,1fr) auto auto}
.credential-help{grid-column:1/-1;color:var(--muted);font-size:11px;max-width:75ch}
#status{grid-column:1/-1;min-height:1.5em;margin:0;font:11px var(--mono)}
#status:empty{display:none}
.field,.credential input,.workbench input,.workbench select,.workbench textarea,.destructive input{
  width:100%;min-height:42px;padding:10px 12px;border:1px solid var(--line-strong);
  border-radius:6px;background:var(--white);
  transition:border-color 150ms ease,box-shadow 150ms ease
}
.field:hover,.credential input:hover,.workbench input:hover,.workbench select:hover,.workbench textarea:hover,.destructive input:hover{border-color:var(--ink)}
.btn,.workbench button{
  min-height:42px;padding:9px 14px;border:1px solid var(--ink);border-radius:6px;
  background:var(--ink);color:var(--paper);font-weight:650;
  transition:background 150ms ease,transform 140ms var(--ease-out)
}
.btn:hover,.workbench button:hover{background:var(--ink-hover)}
.btn:active,.workbench button:active{transform:scale(.97)}
.btn.secondary{background:var(--white);color:var(--ink)}
.btn.secondary:hover{background:var(--acid)}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--line-strong)}
.btn.danger{background:var(--white);color:var(--red);border-color:var(--red)}
.btn.danger:hover{background:var(--red);color:var(--white)}

.content{max-width:1320px;margin:0 auto;padding:30px 32px 56px}
.route-view{min-width:0}
.route-view[data-entering="true"]{animation:route-in 150ms var(--ease-out)}
@keyframes route-in{from{opacity:.55;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:24px}
.page-head-copy{max-width:70ch}.page-kicker{display:block;margin-bottom:8px;font:600 10px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.page-head h2{margin:0;font-size:28px;line-height:1.15;letter-spacing:-.038em;font-weight:620}
.page-head p{margin:8px 0 0;color:var(--muted);font-size:14px}
.page-actions{display:flex;flex-wrap:wrap;gap:8px}
.status-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid currentColor;border-radius:999px;background:rgba(114,230,177,.2);color:var(--green);font-size:12px;font-weight:650;white-space:nowrap}
.status-pill.bad{background:rgba(255,107,94,.12);color:var(--red)}
.status-pill.warn{background:var(--acid);color:var(--ink);border-color:var(--ink)}
.dot{width:7px;height:7px;border-radius:50%;background:currentColor}

.metric-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-block:1px solid var(--line);margin-bottom:24px}
.metric{min-width:0;padding:16px 18px;border-right:1px solid var(--line)}
.metric:first-child{border-left:1px solid var(--line)}
.metric small{display:block;color:var(--muted);font:600 10px var(--mono);letter-spacing:.05em;text-transform:uppercase}
.metric strong{display:block;margin:5px 0 2px;font-size:22px;line-height:1.2;letter-spacing:-.03em;font-weight:630}
.metric span{display:block;color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meter{height:4px;margin-top:8px;overflow:hidden;background:var(--paper-deep)}
.meter i{display:block;height:100%;background:var(--acid);transform:scaleX(var(--quota-scale,0));transform-origin:left;transition:transform 220ms var(--ease-out)}

.content-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);gap:16px}
.content-grid.equal{grid-template-columns:repeat(2,minmax(0,1fr))}
.content-grid.single{grid-template-columns:minmax(0,1fr)}
.task-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.panel{min-width:0;background:var(--white);border:1px solid var(--line);border-radius:12px}
.panel+.panel{margin-top:16px}
.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:18px 20px;border-bottom:1px solid var(--line)}
.panel-head h3{margin:0;font-size:14px;letter-spacing:-.015em}.panel-head p{margin:3px 0 0;color:var(--muted);font-size:11px}
.panel-body{padding:18px 20px}
.panel-body.flush{padding:0}
.panel-actions{display:flex;flex-wrap:wrap;gap:8px}
.clean-list{list-style:none;padding:0;margin:0}
.clean-list li{display:grid;grid-template-columns:auto 1fr auto;gap:11px;padding:13px 0;border-top:1px solid var(--line);align-items:center}
.clean-list li:first-child{border-top:0}
.clean-list b,.clean-list small{display:block}.clean-list small{color:var(--muted);font-size:11px}
.check{width:20px;height:20px;display:grid;place-items:center;border-radius:50%;background:rgba(114,230,177,.24);color:var(--green);font-size:10px;font-weight:900}
.check.open{background:var(--acid);color:var(--ink)}
.inline-stat{display:flex;gap:18px;align-items:center}
.inline-stat div{min-width:92px}.inline-stat strong,.inline-stat span{display:block}.inline-stat strong{font-size:20px}.inline-stat span{color:var(--muted);font-size:10px}

.task-form label{display:grid;gap:6px;color:var(--ink-soft);font-size:11px;font-weight:620}
.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px}
.form-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.span-2{grid-column:1/-1}.span-all{grid-column:1/-1}
.code-field{min-height:150px;resize:vertical;font:11px/1.55 var(--mono)}
.code-field.compact{min-height:96px}.mono-input{font-family:var(--mono)}
.form-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.form-status{min-height:1.4em;margin:0;color:var(--muted);font:11px/1.4 var(--mono)}
.form-status.good{color:var(--green)}.form-status.bad{color:var(--red)}
.readiness-action{min-height:32px;padding:5px 9px;font-size:11px}
.method-badge{flex:none;padding:5px 7px;border:1px solid var(--line);border-radius:6px;color:var(--muted);background:var(--paper);font:10px var(--mono)}
.inline-result{min-height:90px;max-height:300px;border-radius:8px}
.result-card{padding:16px;border:1px solid var(--line);border-radius:8px;background:var(--paper)}
.result-card h4{margin:0 0 8px;font-size:16px}.result-card dl{margin:0}
.result-card.valid{border-color:var(--green)}.result-card.valid_with_repair{border-color:var(--amber)}.result-card.rejected{border-color:var(--red)}
.integrity-label{display:inline-flex;align-items:center;min-height:28px;padding:5px 8px;border:1px solid var(--line-strong);border-radius:6px;color:var(--muted);font:10px var(--mono);white-space:nowrap}
.integrity-label.good{color:var(--green);border-color:var(--green);background:rgba(114,230,177,.12)}
.integrity-label.bad{color:var(--red);border-color:var(--red);background:rgba(255,107,94,.08)}
.segmented{display:flex;gap:1px;padding:3px;border:1px solid var(--line);border-radius:8px;background:var(--paper-deep)}
.segmented button{min-height:32px;padding:5px 10px;border:0;border-radius:5px;background:transparent;color:var(--muted);font-size:11px;font-weight:620}
.segmented button[aria-pressed="true"]{background:var(--ink);color:var(--paper)}
.row-actions{display:flex;justify-content:flex-end;gap:6px;white-space:nowrap}
.row-actions .btn{min-height:32px;padding:5px 9px;font-size:11px}
.tag-list{display:flex;flex-wrap:wrap;gap:4px;max-width:360px}
.tag{display:inline-flex;padding:3px 6px;border-radius:999px;background:var(--paper-deep);font:10px var(--mono)}
.tag.good{background:rgba(114,230,177,.2)}.tag.warn{background:rgba(221,254,82,.35)}.tag.bad{background:rgba(255,107,94,.14)}
.empty-row td{padding:22px;color:var(--muted);text-align:center}
.truncate{display:block;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.one-time-secret{margin-top:16px;padding:14px;border:1px solid var(--amber);border-radius:8px;background:rgba(221,254,82,.16)}
.one-time-secret strong,.one-time-secret code{display:block}.one-time-secret code{margin:8px 0;padding:10px;overflow-wrap:anywhere;background:var(--ink);color:var(--paper);font:11px var(--mono)}
.local-plan-control{margin-top:20px;padding-top:20px;border-top:1px solid var(--line);display:grid;grid-template-columns:minmax(180px,280px) minmax(240px,1fr) auto;gap:16px;align-items:end}
.local-plan-control label:first-child{display:grid;gap:8px;font-size:.78rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.scope-picker{margin:0 0 16px;padding:0;border:1px solid var(--line);display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:var(--line);gap:1px}.scope-picker legend{margin:0;padding:0 0 10px;font-weight:650;background:var(--white)}
.scope-picker-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;border:1px solid var(--line);background:var(--line)}
.scope-picker label{display:flex;align-items:flex-start;gap:8px;padding:10px;background:var(--white);font-size:11px}.scope-picker input{margin-top:2px;accent-color:var(--ink)}
.usage-hero{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);background:var(--white)}
.usage-hero>div{min-width:0;padding:18px;border-right:1px solid var(--line)}.usage-hero>div:last-child{border-right:0}
.usage-hero span,.usage-hero strong,.usage-hero small{display:block}.usage-hero span{color:var(--muted);font:10px var(--mono);text-transform:uppercase}.usage-hero strong{margin-top:6px;font-size:20px}.usage-hero small{margin-top:2px}
.definition-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;margin:0;border:1px solid var(--line)}
.definition-grid>div{display:grid;grid-template-columns:minmax(120px,.7fr) minmax(0,1.3fr);gap:12px;padding:11px 12px;border-bottom:1px solid var(--line)}.definition-grid>div:nth-last-child(-n+2){border-bottom:0}
.definition-grid dt{color:var(--muted);font-size:11px}.definition-grid dd{margin:0;text-align:right;font-weight:620;overflow-wrap:anywhere}
.plan-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line)}
.plan-option{padding:18px;background:var(--white)}.plan-option h4{margin:0;font-size:16px}.plan-option p{margin:5px 0;color:var(--muted);font-size:11px}.plan-option dl{margin:12px 0 0}.plan-option .price{font-size:18px;font-weight:650}
.plan-option dl>div{display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-top:1px solid var(--line)}
.plan-option dt{color:var(--muted);font-size:11px}.plan-option dd{margin:0;text-align:right;font-size:11px;font-weight:620}
.integrity-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;border:1px solid var(--line);background:var(--line)}
.integrity-component{padding:14px;background:var(--white)}.integrity-component b,.integrity-component span{display:block}.integrity-component span{margin-top:3px;color:var(--muted);font-size:11px}

.workflow-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line)}
.workflow{min-width:0;padding:18px;background:var(--white)}
.workflow b{display:block;margin-bottom:4px}.workflow p{min-height:42px;margin:0 0 14px;color:var(--muted);font-size:12px}
.workflow button{border:0;padding:0;background:transparent;color:var(--ink);font-weight:650;text-align:left}
.workflow button::after{content:" →"}.workflow button:hover{text-decoration:underline;text-decoration-color:var(--acid);text-decoration-thickness:3px;text-underline-offset:3px}
.top-gap{margin-top:16px}.empty-copy{padding:16px}

.activation-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line);background:var(--line);gap:1px}
.activation-strip article{min-width:0;display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:12px;align-items:center;padding:16px;background:var(--white)}
.activation-strip article>span{width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--ink);border-radius:6px;background:var(--acid);font:700 11px var(--mono)}
.activation-strip strong,.activation-strip small{display:block}.activation-strip small{margin-top:3px;font-size:11px}.activation-strip b{font:650 10px var(--mono);white-space:nowrap}
.integration-layout{display:grid;grid-template-columns:minmax(320px,.8fr) minmax(0,1.2fr)}
.integration-steps{list-style:none;margin:0;padding:0;border-right:1px solid var(--line)}
.integration-steps li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;padding:18px 20px;border-top:1px solid var(--line)}
.integration-steps li:first-child{border-top:0}.integration-steps strong,.integration-steps span{display:block}.integration-steps span{color:var(--muted);font-size:12px}.integration-steps .btn{grid-column:2;grid-row:1/3;align-self:center;white-space:nowrap}
.integration-code{min-height:100%;max-height:none;border-radius:0}
.compact-code{min-height:0;max-height:none;border-radius:0 0 12px 12px}
.protocol-flow{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:22px 20px;border-bottom:1px solid var(--line)}
.protocol-flow span{padding:6px 8px;border:1px solid var(--line-strong);border-radius:6px;background:var(--paper);font:600 10px var(--mono)}.protocol-flow i{color:var(--muted);font-style:normal}
.table-tools{display:grid;grid-template-columns:minmax(150px,220px) minmax(220px,1fr) auto auto;gap:10px;align-items:end;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--paper)}
.table-tools label{display:grid;gap:5px;color:var(--muted);font-size:10px;font-weight:620}.table-tools .field{min-height:38px;padding:8px 10px}.table-tools .btn{min-height:38px}.table-tools>span{align-self:center;white-space:nowrap}

.table-scroll{overflow:auto}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:var(--muted);font:600 10px var(--mono);letter-spacing:.05em;text-transform:uppercase}
th,td{padding:12px 14px;border-bottom:1px solid var(--line)}
tbody tr:hover{background:rgba(221,254,82,.13)}
td code{font:11px var(--mono)}
.decision{font-weight:700}.decision.valid{color:var(--green)}.decision.valid_with_repair{color:var(--amber)}.decision.rejected{color:var(--red)}

.evidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.evidence-block{min-width:0;background:var(--white);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.evidence-block.wide{grid-column:1/-1}
.evidence-block summary{display:flex;justify-content:space-between;gap:12px;padding:13px 16px;cursor:pointer;font-size:12px;font-weight:650;list-style:none}
.evidence-block summary::-webkit-details-marker{display:none}.evidence-block summary::after{content:"+";font:16px/1 var(--mono)}.evidence-block[open] summary::after{content:"−"}
.evidence-block summary small{font-weight:400}
.evidence-block[open] summary{border-bottom:1px solid var(--line)}
pre{margin:0;min-height:110px;max-height:360px;padding:15px 16px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:var(--ink);color:var(--paper);font:11px/1.55 var(--mono)}
.raw-note{padding:10px 16px;color:var(--muted);background:var(--paper-deep);font-size:10px}

.workbench{max-width:920px}
.workbench-grid{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px 16px;align-items:start}
.workbench-grid label{padding-top:10px;font-weight:620}
.workbench-grid>div{display:flex;gap:8px}
.workbench select{flex:1}
.workbench textarea{min-height:260px;font:12px/1.55 var(--mono)}
.workbench #operation-load{background:var(--white);color:var(--ink)}
.confirm{display:flex;align-items:flex-start;gap:9px;margin:18px 0}.confirm input{width:auto;margin-top:3px;accent-color:var(--ink)}
.operation-result{margin-top:16px}
.destructive{padding:18px 20px;border-top:1px solid rgba(177,43,34,.35);background:rgba(255,107,94,.04)}
.destructive h3{margin:0 0 6px;color:var(--red)}.destructive p{max-width:70ch;color:var(--muted)}
.destructive-row{display:flex;gap:8px;max-width:640px}
.good{color:var(--green)}.bad{color:var(--red)}.muted,small{color:var(--muted)}

.action-dialog{
  width:min(520px,calc(100vw - 32px));max-width:none;margin:auto;padding:0;overflow:visible;
  border:0;border-radius:14px;background:transparent;color:var(--ink);
  box-shadow:0 28px 80px rgba(17,19,26,.34)
}
.action-dialog::backdrop{
  background:rgba(17,19,26,.62);backdrop-filter:blur(3px);
  animation:dialog-backdrop-in 160ms ease-out
}
.dialog-surface{
  position:relative;display:grid;grid-template-columns:44px minmax(0,1fr);gap:18px;
  padding:24px;border:1px solid var(--line-strong);border-radius:14px;background:var(--white);
  box-shadow:0 18px 60px rgba(17,19,26,.28);
  animation:dialog-in 180ms cubic-bezier(.16,1,.3,1)
}
.dialog-mark{
  width:44px;height:44px;display:grid;place-items:center;border:1px solid var(--ink);
  border-radius:10px;background:var(--acid);font:750 18px/1 var(--mono)
}
.action-dialog[data-tone="danger"] .dialog-mark{border-color:var(--red);background:rgba(255,107,94,.13);color:var(--red)}
.dialog-kicker{display:block;margin-bottom:7px;color:var(--muted);font:650 9px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase}
.dialog-copy h2{margin:0;font-size:22px;line-height:1.16;letter-spacing:-.035em;font-weight:650}
.dialog-copy p{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.55}
.dialog-input{grid-column:1/-1;display:grid;gap:7px;color:var(--ink-soft);font-size:11px;font-weight:620}
.dialog-input[hidden]{display:none}
.dialog-error{grid-column:1/-1;min-height:1.4em;margin:0;color:var(--red);font:11px/1.4 var(--mono)}
.dialog-error:empty{display:none}
.dialog-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
.action-dialog[data-tone="danger"] #action-dialog-confirm{border-color:var(--red);background:var(--red);color:var(--white)}
.action-dialog[data-tone="danger"] #action-dialog-confirm:hover{background:#8f211a}
@keyframes dialog-in{from{opacity:.01;transform:translateY(10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes dialog-backdrop-in{from{background:rgba(17,19,26,0);backdrop-filter:blur(0)}to{background:rgba(17,19,26,.62);backdrop-filter:blur(3px)}}

.evidence-dialog{
  width:min(820px,calc(100vw - 32px));max-width:none;max-height:min(860px,calc(100vh - 32px));margin:auto;padding:0;
  border:0;border-radius:14px;background:transparent;color:var(--ink);overflow:visible
}
.evidence-dialog::backdrop{background:rgba(17,19,26,.62);backdrop-filter:blur(3px);animation:dialog-backdrop-in 160ms ease-out}
.evidence-dialog-surface{max-height:min(860px,calc(100vh - 32px));overflow:auto;padding:24px;border:1px solid var(--line-strong);border-radius:14px;background:var(--white);box-shadow:0 18px 60px rgba(17,19,26,.28);animation:dialog-in 180ms cubic-bezier(.16,1,.3,1)}
.evidence-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}.evidence-dialog-head h2{margin:0;font-size:22px;letter-spacing:-.035em}.evidence-dialog-head p{margin:6px 0 0;color:var(--muted)}
.audit-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:0 0 18px;border:1px solid var(--line)}
.audit-detail-grid>div{min-width:0;padding:11px 12px;border-bottom:1px solid var(--line)}.audit-detail-grid>div:nth-child(odd){border-right:1px solid var(--line)}.audit-detail-grid>div:nth-last-child(-n+2){border-bottom:0}
.audit-detail-grid dt{color:var(--muted);font:600 9px var(--mono);letter-spacing:.06em;text-transform:uppercase}.audit-detail-grid dd{margin:5px 0 0;overflow-wrap:anywhere;font:11px/1.45 var(--mono)}

@media(max-width:1120px){
  .metric-strip{grid-template-columns:repeat(3,1fr)}
  .metric:nth-child(4),.metric:nth-child(5){border-top:1px solid var(--line)}
  .content-grid,.content-grid.equal,.task-grid{grid-template-columns:1fr}
  .activation-strip{grid-template-columns:1fr}
  .integration-layout{grid-template-columns:1fr}.integration-steps{border-right:0;border-bottom:1px solid var(--line)}
  .scope-picker-grid,.scope-picker{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:900px){
  .app-shell,.app-shell[data-sidebar="collapsed"]{display:block}
  .sidebar{position:fixed;left:0;top:0;width:min(82vw,288px);transform:translateX(-102%);visibility:hidden;box-shadow:12px 0 36px rgba(17,19,26,.18);transition:transform 220ms var(--ease-out),visibility 0s linear 220ms}
  .app-shell[data-mobile-nav="open"] .sidebar{transform:translateX(0);visibility:visible;transition-delay:0s}
  .app-shell[data-sidebar="collapsed"] .brand-copy,.app-shell[data-sidebar="collapsed"] .nav-copy,.app-shell[data-sidebar="collapsed"] .nav-label,.app-shell[data-sidebar="collapsed"] .tenant-copy{opacity:1;transform:none;pointer-events:auto}
  .app-shell[data-sidebar="collapsed"] .sidebar-toggle,.sidebar-toggle{position:static;margin-left:auto;transform:none}
  .app-shell[data-sidebar="collapsed"] .brand-mark{opacity:1}
  .app-shell[data-sidebar="collapsed"] .sidebar-nav{padding:18px 10px 12px}
  .app-shell[data-sidebar="collapsed"] .nav-link{justify-content:flex-start;padding:0 11px}
  .app-shell[data-sidebar="collapsed"] .tenant-chip{justify-content:flex-start;padding:8px;border-color:rgba(245,244,238,.17)}
  .mobile-backdrop{display:block;position:fixed;z-index:35;inset:0;border:0;background:rgba(17,19,26,.38);opacity:0;visibility:hidden;pointer-events:none;transition:opacity 180ms ease,visibility 0s linear 180ms}
  .app-shell[data-mobile-nav="open"] .mobile-backdrop{opacity:1;visibility:visible;pointer-events:auto;transition-delay:0s}
  .mobile-nav-toggle{display:grid}
  .workspace-bar{padding:12px 18px}
  .credential{padding:12px 18px}
  .content{padding:24px 18px 44px}
}
@media(max-width:680px){
  .workspace-heading p,.connection-label{display:none}
  .page-head{display:block}.page-actions{margin-top:16px}
  .metric-strip{grid-template-columns:repeat(2,1fr)}
  .metric:nth-child(3){border-top:1px solid var(--line)}
  .metric:nth-child(5){grid-column:1/-1}
  .workflow-list,.evidence-grid{grid-template-columns:1fr}
  .evidence-block.wide{grid-column:auto}
  .credential,.workspace[data-credential="connected"] .credential{grid-template-columns:1fr}.credential-editor{grid-template-columns:1fr}.credential .btn,.credential .btn.secondary{grid-column:auto;width:100%}
  .workbench-grid{grid-template-columns:1fr}.workbench-grid label{padding:0}.workbench-grid>div{display:grid}
  .form-grid,.form-grid.three{grid-template-columns:1fr}.span-2,.span-all{grid-column:auto}
  .usage-hero{grid-template-columns:repeat(2,1fr)}.usage-hero>div:nth-child(2){border-right:0}.usage-hero>div:nth-child(-n+2){border-bottom:1px solid var(--line)}
  .definition-grid,.plan-grid,.integrity-grid,.scope-picker-grid,.scope-picker{grid-template-columns:1fr}
  .local-plan-control{grid-template-columns:1fr}
  .definition-grid>div{border-bottom:1px solid var(--line)!important}
  .definition-grid>div:last-child{border-bottom:0!important}
  .destructive-row{display:grid}
  .panel-head{display:block}.panel-actions{margin-top:12px}
  .activation-strip article{grid-template-columns:32px minmax(0,1fr)}.activation-strip article>b{grid-column:2}
  .integration-steps li{grid-template-columns:1fr}.integration-steps .btn{grid-column:auto;grid-row:auto;width:100%}
  .protocol-flow{align-items:stretch;flex-direction:column}.protocol-flow i{align-self:center;transform:rotate(90deg)}
  .table-tools{grid-template-columns:1fr}.table-tools>span{justify-self:start}
  .audit-detail-grid{grid-template-columns:1fr}.audit-detail-grid>div{border-right:0!important;border-bottom:1px solid var(--line)!important}.audit-detail-grid>div:last-child{border-bottom:0!important}
  .evidence-dialog-surface{padding:20px}
  .dialog-surface{grid-template-columns:40px minmax(0,1fr);gap:14px;padding:20px}
  .dialog-mark{width:40px;height:40px}
  .dialog-actions{display:grid;grid-template-columns:1fr 1fr}
}
@media(hover:hover) and (pointer:fine){
  .nav-link:hover,.btn:hover,.workbench button:hover,.workflow button:hover{will-change:transform}
}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
}
`;
