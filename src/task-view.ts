const HOST_BOOT = `
let hostCtx={};
function rpc(method,params){return new Promise((res,rej)=>{const id=++seq;pending.set(id,[res,rej]);
 parent.postMessage({jsonrpc:"2.0",id,method,params:params||{}},"*");
 setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error("timeout"));}},15000);});}
function applyDevice(ctx){
 hostCtx=ctx||{};const dc=(ctx.deviceClass||"display");
 document.body.dataset.device=dc;
}
async function boot(){
 try{const init=await rpc("ui/initialize",{protocolVersion:"2025-11-25",clientInfo:{name:"ambient-view",version:"1.0"}});
  applyDevice(init&&init.hostContext);}catch{}
 parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*");
}
`;

export const TASK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{color-scheme:dark;
 --bg:oklch(0.16 0.008 255);--fg:oklch(0.96 0.004 255);--dim:oklch(0.74 0.01 255);--faint:oklch(0.30 0.01 255);
 --call:oklch(0.78 0.11 225);--needs:oklch(0.84 0.15 85);--done:oklch(0.80 0.15 155);--warn:oklch(0.82 0.12 70)}
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{background:var(--bg);color:var(--fg);font:400 clamp(11px,2.6vw,30px)/1.35 -apple-system,"SF Pro Text",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased;padding:5.5vw 6vw;display:flex;flex-direction:column;gap:2.6vw;overflow:hidden}
body[data-device="tv"]{padding:4vw 5vw;gap:2vw}
.chip{display:inline-flex;align-items:center;gap:.5em;font-size:.62em;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--call)}
.chip::before{content:"";width:.7em;height:.7em;border-radius:50%;background:currentColor}
.chip.needs{color:var(--needs)}.chip.done{color:var(--done)}.chip.warn{color:var(--warn)}.chip.idle{color:var(--dim)}
.stake{font-size:2.05em;font-weight:650;letter-spacing:-.02em;line-height:1.05;font-variant-numeric:tabular-nums;text-wrap:balance}
.stake small{display:block;font-size:.42em;font-weight:500;letter-spacing:0;color:var(--dim);margin-top:.35em}
.question{font-size:.95em;color:var(--fg);text-wrap:pretty;max-width:34em}
.hint{font-size:.7em;color:var(--dim)}
.hint b{color:var(--fg);font-weight:600}
.lines[hidden]{display:none}
.lines{margin-top:auto;display:flex;flex-direction:column;gap:.45em;font-size:.72em;border-top:1px solid var(--faint);padding-top:1.1em}
.line{display:grid;grid-template-columns:7.5em 1fr;gap:.8em;color:var(--dim)}
.line b{font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
body[data-device="tv"]{font-size:clamp(9px,3.4vw,40px);padding:7vw 8vw;gap:3vw;justify-content:center}
body[data-device="tv"] .lines,body[data-device="tv"] .question{display:none}
body[data-device="tv"] .stake{font-size:1.6em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body[data-device="tv"] .stake small{font-size:.5em}
body[data-device="tv"] .hint{font-size:.78em}
</style></head><body>
<span class="chip idle" id="chip">Ready</span>
<div class="stake" id="stake">Ask Alexa to handle a call</div>
<p class="question" id="question"></p>
<p class="hint" id="hint"></p>
<div class="lines" id="lines" hidden></div>
<script>
let seq=0;const pending=new Map();
addEventListener("message",e=>{const m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!==undefined&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p[1](new Error(m.error.message||"tool error")):p[0](m.result);}
 if(m.method==="ui/notifications/tool-result"&&m.params&&m.params.structuredContent)render(m.params.structuredContent);
 if(m.method==="ui/notifications/host-context-changed"&&m.params)applyDevice(m.params.hostContext||m.params);});
${HOST_BOOT}
const $=id=>document.getElementById(id);
const usd=n=>"$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:2});
function business(steps){for(const s of steps){const m=/^(?:Calling|Connected to) (.+)$/.exec(s);if(m)return m[1];}return "";}
function speakers(steps){return steps.map(s=>/^([^:]{1,40}): (.+)$/.exec(s)).filter(Boolean).map(m=>({who:m[1],text:m[2]}));}
function render(d){
 const t=d.task||{},steps=t.steps||[],ap=(d.approvals||[])[0],o=t.outcome,biz=business(steps)||t.title||"";
 const chip=$("chip"),stake=$("stake"),q=$("question"),hint=$("hint");
 if(ap){chip.className="chip needs";chip.textContent="Needs you";
  stake.innerHTML=(ap.amountUsd!==undefined?usd(ap.amountUsd)+" · ":"")+esc(biz)+"<small>"+(ap.kind==="dial"?"Place this call?":"Over your limit")+"</small>";
  q.textContent=ap.description||ap.command;hint.innerHTML='Say <b>\\u201cAlexa, tell Ambient approve\\u201d</b> or <b>\\u201coffer\\u2026\\u201d</b>';}
 else if(o){const ok=o.kind==="confirmed";chip.className="chip "+(ok?"done":"warn");
  chip.textContent=ok?"Confirmed by "+(biz||"them"):o.kind==="unconfirmed"?"Not confirmed":o.kind==="declined"?"Declined":"No deal";
  stake.innerHTML=ok?((o.amountUsd!==undefined?usd(o.amountUsd)+" · ":"")+esc(o.when||biz)):esc(biz)+"<small>Nothing was booked</small>";
  q.textContent=ok?o.summary:o.reason.charAt(0).toUpperCase()+o.reason.slice(1)+".";hint.textContent="";}
 else if(t.status&&t.status!=="completed"){chip.className="chip";chip.textContent=steps.some(s=>s.startsWith("Connected to"))?"On the phone":"Calling";
  stake.innerHTML=esc(biz)+"<small>"+esc(t.title||"")+"</small>";q.textContent="";hint.textContent="I\\u2019ll tell you if they need you.";}
 else{chip.className="chip idle";chip.textContent="Ready";stake.textContent=t.answer||"Ask Alexa to handle a call";q.textContent="";hint.textContent="";}
 const lines=speakers(steps).slice(-3),box=$("lines");
 box.hidden=lines.length===0;box.innerHTML=lines.map(l=>'<div class="line"><b>'+esc(l.who)+'</b><span>'+esc(l.text)+'</span></div>').join("");}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
boot();
</script></body></html>`;
