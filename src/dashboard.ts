import type { RuntimeRegistry } from "./runtimes/registry.js";
import type { RunStatus } from "./types.js";

export type DashboardSnapshot = {
  generatedAt: string;
  assistants: unknown[];
  work: unknown[];
  approvals: unknown[];
};

/** One call, whole view: batched store reads, no per-runtime fan-out. */
export function dashboardSnapshot(registry: RuntimeRegistry): DashboardSnapshot {
  const assistants = registry.list();
  const work = registry.recentRuns(25).map(run => ({ ...run, assistant: registry.label(run.runtimeId) }));
  const approvals = registry.pendingApprovals().map(item => ({ ...item.approval, assistant: item.entry.descriptor.label }));
  return { generatedAt: new Date().toISOString(), assistants, work, approvals };
}

const STATUS_ICON: Record<RunStatus, string> = {
  queued: "…", accepted: "→", running: "▸", waiting_approval: "!",
  completed: "✓", failed: "✕", cancelled: "–", cancel_requested: "◌", unknown: "?"
};

export const DASHBOARD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root{color-scheme:dark;--bg:#0c0d10;--panel:#14161a;--line:#23262c;--fg:#e6e8ec;--dim:#8a909c;--accent:#7cc7ff;--ok:#5ad48a;--bad:#ff7a7a;--warn:#ffc66e}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--fg);font:13px/1.45 -apple-system,"SF Mono",ui-monospace,system-ui,sans-serif;padding:12px;display:flex;flex-direction:column;gap:10px;height:100vh}
h1{font-size:13px;font-weight:600;letter-spacing:.14em;color:var(--dim)}
h1 b{color:var(--fg)}
.assistants{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--line);border-radius:99px;background:var(--panel);cursor:pointer;font:inherit;color:var(--fg)}
.chip.sel{border-color:var(--accent)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--dim)}
.dot.online{background:var(--ok)}.dot.offline{background:var(--bad)}.dot.unknown{background:var(--warn)}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px;overflow:auto}
#work{flex:1;min-height:0}
.row{display:flex;gap:8px;padding:5px 2px;border-bottom:1px solid var(--line);align-items:baseline}
.row:last-child{border:0}
.ic{width:14px;text-align:center;color:var(--dim);flex:none}
.ic.completed{color:var(--ok)}.ic.failed{color:var(--bad)}.ic.running,.ic.accepted,.ic.cancel_requested{color:var(--accent)}.ic.waiting_approval{color:var(--warn)}
.ins{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{color:var(--dim);font-size:11px;flex:none}
.ans{display:block;color:var(--dim);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap{display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid var(--line)}
.ap:last-child{border:0}
.ap .cmd{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button{font:inherit;background:#1c2129;color:var(--fg);border:1px solid var(--line);border-radius:7px;padding:4px 10px;cursor:pointer}
button:hover{border-color:var(--accent)}
button.deny{color:var(--bad)}
form{display:flex;gap:6px}
input{flex:1;font:inherit;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--fg);outline:none}
input:focus{border-color:var(--accent)}
.empty{color:var(--dim);padding:4px 2px}
#err{color:var(--bad);font-size:11px;min-height:14px}
</style></head><body>
<h1>A M B I E N T</h1>
<div class="assistants" id="assistants"></div>
<section id="approvalsSec" style="display:none"><div id="approvals"></div></section>
<section id="work"><div id="runs"></div></section>
<div id="err"></div>
<form id="ask"><input id="q" placeholder="Ask the selected assistant…" autocomplete="off"><button>Send</button></form>
<script>
let seq=0;const pending=new Map();
addEventListener("message",e=>{const m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!==undefined&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p[1](new Error(m.error.message||"tool error")):p[0](m.result);}
 if(m.method==="ui/notifications/tool-result"&&m.params&&m.params.structuredContent)render(m.params.structuredContent);});
function call(name,args){return new Promise((res,rej)=>{const id=++seq;pending.set(id,[res,rej]);
 parent.postMessage({jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments:args||{}}},"*");
 setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error("timeout"));}},15000);});}
parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*");
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ago=t=>{const s=(Date.now()-new Date(t).getTime())/1e3;return s<60?Math.round(s)+"s":s<3600?Math.round(s/60)+"m":Math.round(s/3600)+"h"};
const ICONS=${JSON.stringify(STATUS_ICON)};
function render(d){
 document.getElementById("assistants").innerHTML=d.assistants.map(a=>
  \`<button class="chip\${a.selected?" sel":""}" data-id="\${esc(a.id)}" title="\${esc(a.id)} · \${esc(a.adapter)}"><span class="dot \${esc(a.state)}"></span>\${esc(a.label)}</button>\`).join("");
 document.querySelectorAll(".chip").forEach(c=>c.onclick=()=>{call("agents",{use:c.dataset.id}).then(refresh).catch(showErr);});
 const ap=d.approvals||[];document.getElementById("approvalsSec").style.display=ap.length?"":"none";
 document.getElementById("approvals").innerHTML=ap.map(a=>\`<div class="ap"><span class="ic waiting_approval">!</span><span class="cmd" title="\${esc(a.description||a.command)}"><b>\${esc(a.assistant)}</b> wants to \${esc(a.command)}</span><button data-ap="\${esc(a.id)}" data-d="once">Approve once</button><button class="deny" data-ap="\${esc(a.id)}" data-d="deny">Deny</button></div>\`).join("");
 document.querySelectorAll("[data-ap]").forEach(b=>b.onclick=()=>{call("approve",{approvalId:b.dataset.ap,decision:b.dataset.d}).then(refresh).catch(showErr);});
 const w=d.work||[];document.getElementById("runs").innerHTML=w.length?w.map(r=>\`<div class="row"><span class="ic \${esc(r.status)}">\${ICONS[r.status]||"?"}</span><span class="ins"><b>\${esc(r.assistant)}</b> \${esc(r.instruction)}\${r.answer?'<span class="ans">'+esc(r.answer)+"</span>":""}\${r.failure?'<span class="ans" style="color:var(--bad)">'+esc(r.failure)+"</span>":""}</span><span class="meta">\${ago(r.updatedAt)}</span></div>\`).join(""):'<div class="empty">No work yet — ask something below.</div>';
}
function showErr(e){document.getElementById("err").textContent=e.message||String(e);setTimeout(()=>document.getElementById("err").textContent="",6e3);}
function refresh(){call("dashboard").then(r=>{if(r&&r.structuredContent)render(r.structuredContent);}).catch(()=>{});}
document.getElementById("ask").onsubmit=e=>{e.preventDefault();const q=document.getElementById("q");if(!q.value.trim())return;
 call("delegate",{task:q.value.trim()}).then(()=>{q.value="";refresh();}).catch(showErr);};
refresh();setInterval(refresh,2500);
</script></body></html>`;

export const TASK_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root{color-scheme:dark;--bg:#0c0d10;--panel:#14161a;--line:#23262c;--fg:#e6e8ec;--dim:#8a909c;--accent:#7cc7ff;--ok:#5ad48a;--bad:#ff7a7a;--warn:#ffc66e}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,system-ui,sans-serif;padding:14px;display:flex;flex-direction:column;gap:8px}
h1{font-size:15px;font-weight:600}
.status{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.status.waiting_approval{color:var(--warn)}.status.completed{color:var(--ok)}.status.failed{color:var(--bad)}.status.running,.status.accepted,.status.queued{color:var(--accent)}
ol{margin:0;padding-left:18px;color:var(--dim);font-size:12px;display:flex;flex-direction:column;gap:2px}
.answer{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
.approval{border:1px solid var(--warn);border-radius:8px;padding:8px 10px;font-size:13px}
</style></head><body>
<h1 id="title">Task</h1><div class="status" id="status"></div><ol id="steps"></ol>
<div class="approval" id="approval" style="display:none"></div>
<div class="answer" id="answer" style="display:none"></div>
<script>
addEventListener("message",e=>{const m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.method==="ui/notifications/tool-result"&&m.params&&m.params.structuredContent)render(m.params.structuredContent);});
parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*");
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function render(d){const t=d.task||{};
 document.getElementById("title").textContent=t.title||"Task";
 const s=document.getElementById("status");s.textContent=(t.status||"").replace("_"," ");s.className="status "+(t.status||"");
 document.getElementById("steps").innerHTML=(t.steps||[]).map(x=>"<li>"+esc(x)+"</li>").join("");
 const ap=(d.approvals||[])[0];const apEl=document.getElementById("approval");
 if(ap){apEl.style.display="";apEl.innerHTML="<b>"+esc(ap.agent)+"</b> is asking: "+esc(ap.description||ap.command);}
 else apEl.style.display="none";
 const a=document.getElementById("answer");
 if(t.answer||t.failure){a.style.display="";a.textContent=t.answer||t.failure;}else a.style.display="none";}
</script></body></html>`;
