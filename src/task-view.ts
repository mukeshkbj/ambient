const HOST_BOOT = `
let hostCtx={};
function rpc(method,params){return new Promise((res,rej)=>{const id=++seq;pending.set(id,[res,rej]);
 parent.postMessage({jsonrpc:"2.0",id,method,params:params||{}},"*");
 setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error("timeout"));}},15000);});}
function applyDevice(ctx){
 hostCtx=ctx||{};const dc=(ctx.deviceClass||"display");
 document.body.dataset.device=dc;
 if(dc==="tv")document.body.classList.add("big");
 if(dc==="mobile")document.body.classList.add("compact");
 if(dc==="voice")document.body.classList.add("voice");
}
async function boot(){
 try{const init=await rpc("ui/initialize",{protocolVersion:"2025-11-25",clientInfo:{name:"ambient-view",version:"1.0"}});
  applyDevice(init&&init.hostContext);}catch{}
 parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*");
}
`;

export const TASK_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root{color-scheme:dark;--bg:#0c0d10;--panel:#14161a;--line:#23262c;--fg:#e6e8ec;--dim:#8a909c;--accent:#7cc7ff;--ok:#5ad48a;--bad:#ff7a7a;--warn:#ffc66e}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,system-ui,sans-serif;padding:14px;display:flex;flex-direction:column;gap:8px}
body.big{font-size:24px;padding:48px;gap:16px}
body.big h1{font-size:30px}body.big .status{font-size:18px}body.big ol{font-size:20px}body.big .answer,body.big .approval{font-size:22px;padding:16px 20px}
body.compact{font-size:13px;padding:10px}
body.voice{background:transparent;padding:10px}
h1{font-size:1.1em;font-weight:600}
.status{font-size:.78em;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.status.waiting_approval{color:var(--warn)}.status.completed{color:var(--ok)}.status.failed{color:var(--bad)}.status.running,.status.accepted,.status.queued{color:var(--accent)}
ol{margin:0;padding-left:1.3em;color:var(--dim);font-size:.85em;display:flex;flex-direction:column;gap:2px}
.answer{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:.93em}
.approval{border:1px solid var(--warn);border-radius:8px;padding:8px 10px;font-size:.93em}
</style></head><body>
<h1 id="title">Task</h1><div class="status" id="status"></div><ol id="steps"></ol>
<div class="approval" id="approval" style="display:none"></div>
<div class="answer" id="answer" style="display:none"></div>
<script>
let seq=0;const pending=new Map();
addEventListener("message",e=>{const m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!==undefined&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p[1](new Error(m.error.message||"tool error")):p[0](m.result);}
 if(m.method==="ui/notifications/tool-result"&&m.params&&m.params.structuredContent)render(m.params.structuredContent);
 if(m.method==="ui/notifications/host-context-changed"&&m.params)applyDevice(m.params.hostContext||m.params);});
${HOST_BOOT}
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
boot();
</script></body></html>`;
