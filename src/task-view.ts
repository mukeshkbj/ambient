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
 --bg:oklch(0.16 0.008 255);--fg:oklch(0.96 0.004 255);--dim:oklch(0.78 0.01 255);--faint:oklch(0.30 0.01 255);
 --call:oklch(0.78 0.11 225);--needs:oklch(0.84 0.15 85);--done:oklch(0.80 0.15 155);--warn:oklch(0.82 0.12 70);
 --go:oklch(0.52 0.13 152);--btn:oklch(0.26 0.01 255)}
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{background:var(--bg);color:var(--fg);font:400 clamp(12px,2.4vw,28px)/1.35 -apple-system,"SF Pro Text",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased;padding:5vw 6vw;display:flex;flex-direction:column;gap:2.4vw;overflow:hidden}
button{font:inherit;color:inherit;cursor:pointer;border:0}
button:focus-visible{outline:2px solid var(--call);outline-offset:3px}
.chip{display:inline-flex;align-items:center;gap:.5em;font-size:.6em;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--call)}
.chip::before{content:"";width:.7em;height:.7em;border-radius:50%;background:currentColor}
.chip.needs{color:var(--needs)}.chip.done{color:var(--done)}.chip.warn{color:var(--warn)}.chip.idle{color:var(--dim)}
.stake{font-size:2.2em;font-weight:650;letter-spacing:-.02em;line-height:1.05;font-variant-numeric:tabular-nums;text-wrap:balance}
.sub{font-size:1em;color:var(--dim);text-wrap:pretty;max-width:32em}
.actions{display:flex;gap:.6em;flex-wrap:wrap;margin-top:.4em}
.actions:empty{display:none}
.actions button{min-height:2.4em;padding:0 1.2em;border-radius:.6em;background:var(--btn);font-weight:600;font-size:.9em}
.actions button.primary{background:var(--go);color:#fff;font-size:1em;padding:0 1.6em}
.actions button.call{background:var(--fg);color:var(--bg)}
.actions button:active{transform:scale(.97)}
.hint{font-size:.78em;color:var(--dim)}
.hint:empty{display:none}
.lines[hidden]{display:none}
.lines{margin-top:auto;display:flex;flex-direction:column;gap:.45em;font-size:.72em;border-top:1px solid var(--faint);padding-top:1em}
.line{display:grid;grid-template-columns:7.5em 1fr;gap:.8em;color:var(--dim)}
.line b{font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lines.how{margin-top:.6em;border-top:0;padding-top:0;font-size:.9em;gap:.6em}
.lines.how .line{grid-template-columns:1.6em 1fr;color:var(--fg)}
.lines.how b{color:var(--call)}
body[data-device="tv"]{font-size:clamp(12px,5.2vw,40px);padding:0 6vw;gap:1.4vw;justify-content:center}
body[data-device="tv"] .lines,body[data-device="tv"] .sub,body[data-device="tv"] .hint,body[data-device="tv"] .actions{display:none}
body[data-device="tv"] .stake{font-size:1.15em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>
<span class="chip idle" id="chip">Ready</span>
<div class="stake" id="stake"></div>
<p class="sub" id="sub"></p>
<div class="actions" id="actions"></div>
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
const DEMO="Call Joe\\u2019s Plumbing and book a visit tomorrow to fix the kitchen sink, keep it under 150";
const HOW=["Ambient phones the business and says it is an AI, first thing.","Over your limit? It puts them on hold and asks you, right here.","You hear only what the business actually confirmed."];
function business(steps){for(const s of steps){const m=/^(?:Calling|Connected to) (.+)$/.exec(s);if(m)return m[1];}return "";}
function speakers(steps){return steps.map(s=>/^([^:]{1,40}): (.+)$/.exec(s)).filter(Boolean).map(m=>({who:m[1],text:m[2]}));}
function act(name,args){return rpc("tools/call",{name,arguments:args}).catch(()=>undefined);}
function buttons(list){const box=$("actions");box.innerHTML="";
 for(const b of list){const el=document.createElement("button");el.type="button";el.textContent=b.label;if(b.kind)el.className=b.kind;el.onclick=()=>{el.disabled=true;b.run();};box.appendChild(el);}}
function render(d){
 const t=d.task||{},steps=t.steps||[],ap=(d.approvals||[])[0],o=t.outcome,biz=business(steps)||"Joe\\u2019s Plumbing";
 const live=t.status&&!["completed","failed","cancelled","unknown"].includes(t.status);
 const chip=$("chip"),stake=$("stake"),sub=$("sub"),hint=$("hint"),box=$("lines");
 const said=speakers(steps),owner=said.filter(l=>l.who!=="Ambient"&&l.who!==biz).at(-1);
 box.className="lines";hint.textContent="";buttons([]);
 if(ap){chip.className="chip needs";chip.textContent="Needs you";
  stake.textContent=(ap.amountUsd!==undefined?usd(ap.amountUsd)+" \\u00b7 ":"")+biz;
  sub.textContent=ap.kind==="dial"?"Place this call?":"Over your limit. They are on hold.";
  buttons([{label:ap.amountUsd!==undefined?"Approve "+usd(ap.amountUsd):"Approve",kind:"primary",run:()=>act("approve",{decision:"once"})},{label:"Decline",run:()=>act("approve",{decision:"deny"})}]);
  hint.textContent="Or say \\u201cAlexa, tell Ambient offer one sixty.\\u201d";}
 else if(o){const ok=o.kind==="confirmed";chip.className="chip "+(ok?"done":"warn");
  chip.textContent=ok?"Confirmed by "+biz:o.kind==="unconfirmed"?"Not confirmed":o.kind==="declined"?"Declined":"No deal";
  stake.textContent=ok?((o.amountUsd!==undefined?usd(o.amountUsd)+" \\u00b7 ":"")+cap(o.when||biz)):biz;
  const theirs=said.filter(l=>l.who===biz).at(-1);
  sub.textContent=ok?(theirs?"In their words: “"+theirs.text+"”":"Booked with "+biz+"."):t.status==="cancelled"?"You ended the call. Nothing was booked.":"Nothing was booked.";
  buttons([{label:"Call again",run:()=>act("delegate",{task:DEMO,newConversation:true})}]);}
 else if(live){chip.className="chip";chip.textContent=steps.some(s=>s.startsWith("Connected to"))?"On the phone":"Calling";
  stake.textContent=biz;
  const decided=owner&&/^\\S+ (approved|declined): /.exec(owner.text);
  sub.textContent=decided?"You "+decided[1]+" it.":owner?"You told them: \\u201c"+cap(owner.text)+"\\u201d":"I\\u2019ll tell you if they need you.";}
 else{chip.className="chip idle";chip.textContent="Ready";stake.textContent="Alexa, handle the call.";
  sub.textContent="Say \\u201cAlexa, tell Ambient to call Joe\\u2019s Plumbing,\\u201d or tap below.";
  buttons([{label:"Call Joe\\u2019s Plumbing",kind:"call",run:()=>act("delegate",{task:DEMO,newConversation:true})}]);
  box.hidden=false;box.className="lines how";box.innerHTML=HOW.map((x,i)=>'<div class="line"><b>'+(i+1)+'</b><span>'+x+'</span></div>').join("");return;}
 const lines=said.slice(-3);
 box.hidden=lines.length===0||!!o;
 box.innerHTML=lines.map(l=>'<div class="line"><b>'+esc(l.who)+'</b><span>'+esc(cap(l.text))+'</span></div>').join("");}
render({});
boot();
</script></body></html>`;
