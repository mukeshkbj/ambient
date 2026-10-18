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
 --bg:oklch(0.16 0.008 255);--fg:oklch(0.96 0.004 255);--dim:oklch(0.76 0.01 255);--faint:oklch(0.30 0.01 255);
 --call:oklch(0.78 0.11 225);--needs:oklch(0.84 0.15 85);--done:oklch(0.80 0.15 155);--warn:oklch(0.82 0.12 70)}
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{background:var(--bg);color:var(--fg);font:400 clamp(11px,2.6vw,30px)/1.35 -apple-system,"SF Pro Text",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased;padding:5.5vw 6vw;display:flex;flex-direction:column;gap:2.6vw;overflow:hidden}
.chip{display:inline-flex;align-items:center;gap:.5em;font-size:.62em;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--call)}
.chip::before{content:"";width:.7em;height:.7em;border-radius:50%;background:currentColor}
.chip.needs{color:var(--needs)}.chip.done{color:var(--done)}.chip.warn{color:var(--warn)}.chip.idle{color:var(--dim)}
.stake{font-size:2.05em;font-weight:650;letter-spacing:-.02em;line-height:1.05;font-variant-numeric:tabular-nums;text-wrap:balance}
.stake small{display:block;font-size:.42em;font-weight:500;letter-spacing:0;color:var(--dim);margin-top:.45em;line-height:1.3}
.question{font-size:.95em;color:var(--fg);text-wrap:pretty;max-width:34em}
.hint{align-self:flex-start;font-size:.8em;font-weight:600;color:var(--fg);background:var(--faint);padding:.45em 1em;border-radius:999px}
.hint:empty{display:none}
.hint.quiet{background:none;padding:0;color:var(--dim);font-weight:500}
.lines[hidden]{display:none}
.lines.how{margin-top:1em;border-top:0;padding-top:0;font-size:.92em;gap:.7em}
.lines.how .line{grid-template-columns:1.6em 1fr;color:var(--fg)}
.lines.how b{color:var(--call)}
.lines{margin-top:auto;display:flex;flex-direction:column;gap:.45em;font-size:.72em;border-top:1px solid var(--faint);padding-top:1.1em}
.line{display:grid;grid-template-columns:7.5em 1fr;gap:.8em;color:var(--dim)}
.line b{font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
body[data-device="tv"]{font-size:clamp(12px,5.2vw,40px);padding:0 6vw;gap:1.5vw;justify-content:center}
body[data-device="tv"] .lines,body[data-device="tv"] .question,body[data-device="tv"] .hint,body[data-device="tv"] .stake small{display:none}
body[data-device="tv"] .stake{font-size:1.5em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>
<span class="chip idle" id="chip">Ready</span>
<div class="stake" id="stake"></div>
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
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const usd=n=>"$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:2});
const IDLE="Alexa, handle the call.<small>Say \\u201cAlexa, tell Ambient to call Joe\\u2019s Plumbing.\\u201d</small>";
const HOW=["Ambient phones the business and says it is an AI, first thing.","Over your limit? It puts them on hold and asks you, right here.","You hear only what the business actually confirmed."];
function business(steps){for(const s of steps){const m=/^(?:Calling|Connected to) (.+)$/.exec(s);if(m)return m[1];}return "";}
function speakers(steps){return steps.map(s=>/^([^:]{1,40}): (.+)$/.exec(s)).filter(Boolean).map(m=>({who:m[1],text:m[2]}));}
function render(d){
 const t=d.task||{},steps=t.steps||[],ap=(d.approvals||[])[0],o=t.outcome,biz=business(steps)||t.title||"";
 const chip=$("chip"),stake=$("stake"),q=$("question"),hint=$("hint");
 hint.className="hint";
 if(ap){chip.className="chip needs";chip.textContent="Needs you";
  stake.innerHTML=(ap.amountUsd!==undefined?usd(ap.amountUsd)+" \\u00b7 ":"")+esc(biz)+"<small>"+(ap.kind==="dial"?"Place this call?":"Over your limit")+"</small>";
  q.textContent=ap.description||ap.command;
  hint.textContent=ap.kind==="dial"?"Say \\u201cAlexa, tell Ambient yes\\u201d":"Say \\u201cAlexa, tell Ambient approve\\u201d or \\u201coffer\\u2026\\u201d";}
 else if(o){const ok=o.kind==="confirmed";chip.className="chip "+(ok?"done":"warn");
  chip.textContent=ok?"Confirmed by "+(biz||"them"):o.kind==="unconfirmed"?"Not confirmed":o.kind==="declined"?"Declined":"No deal";
  stake.innerHTML=ok?((o.amountUsd!==undefined?usd(o.amountUsd)+" \\u00b7 ":"")+esc(o.when||biz)):esc(biz)+"<small>Nothing was booked</small>";
  q.textContent=ok?o.summary:cap(o.reason)+".";hint.textContent="";}
 else if(t.status&&t.status!=="completed"&&t.status!=="cancelled"){chip.className="chip";chip.textContent=steps.some(s=>s.startsWith("Connected to"))?"On the phone":"Calling";
  stake.innerHTML=esc(biz)+"<small>"+esc(t.title||"")+"</small>";q.textContent="";hint.className="hint quiet";hint.textContent="I\\u2019ll tell you if they need you.";}
 else{chip.className="chip idle";chip.textContent="Ready";stake.innerHTML=IDLE;q.textContent="";hint.textContent="";}
 const box=$("lines");
 box.className="lines";
 if(!ap&&!o&&!(t.status&&t.status!=="completed"&&t.status!=="cancelled")){box.hidden=false;box.className="lines how";box.innerHTML=HOW.map((x,i)=>'<div class="line"><b>'+(i+1)+'</b><span>'+x+'</span></div>').join("");return;}
 const lines=speakers(steps).slice(-3);
 box.hidden=lines.length===0;
 box.innerHTML=lines.map(l=>'<div class="line"><b>'+esc(l.who)+'</b><span>'+esc(cap(l.text))+'</span></div>').join("");}
render({});
boot();
</script></body></html>`;
