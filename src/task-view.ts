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
body{background:var(--bg);color:var(--fg);font:400 clamp(12px,3.2vw,40px)/1.35 -apple-system,"SF Pro Text",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased;padding:5vw 6vw 4.5vw;display:flex;flex-direction:column;gap:2.2vw;overflow:hidden}
button{font:inherit;color:inherit;cursor:pointer;border:0}
button:focus-visible{outline:2px solid var(--call);outline-offset:3px}
.top{display:flex;align-items:center;gap:.8em}
.chip{display:inline-flex;align-items:center;gap:.5em;font-size:.58em;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--call)}
.chip::before{content:"";width:.7em;height:.7em;border-radius:50%;background:currentColor}
.chip.needs{color:var(--needs)}.chip.done{color:var(--done)}.chip.warn{color:var(--warn)}.chip.idle{color:var(--dim)}
.check{display:none;width:1.5em;height:1.5em;border-radius:50%;background:var(--done);color:var(--bg);place-items:center;font-weight:800;font-size:1.1em}
body.booked .check{display:grid;animation:land 520ms cubic-bezier(0.2,0,0,1) both}
@keyframes land{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}
.stake{font-size:2.6em;font-weight:680;letter-spacing:-.025em;line-height:1.04;font-variant-numeric:tabular-nums;text-wrap:balance}
.sub{font-size:.95em;color:var(--dim);text-wrap:pretty;max-width:34em;font-variant-numeric:tabular-nums}
.actions{display:flex;gap:.5em;flex-wrap:wrap;align-items:center;margin-top:.3em}
.actions:empty{display:none}
.actions button{min-height:2.5em;padding:0 1em;border-radius:.55em;background:var(--btn);font-weight:600;font-size:.88em}
.actions button.primary{background:var(--go);color:#fff;font-size:.95em;padding:0 1.4em}
.actions button.offer{background:transparent;box-shadow:inset 0 0 0 1.5px var(--faint)}
.actions button.quiet{background:transparent;color:var(--dim);padding:0 .6em;text-decoration:underline;text-underline-offset:.2em}
.actions button.call{background:var(--fg);color:var(--bg)}
.actions button:active{transform:scale(.97)}
.hint{font-size:.72em;color:var(--dim)}
.hint:empty{display:none}
.foot{margin-top:auto;display:grid;grid-template-columns:minmax(0,max-content) 1fr;gap:.45em .8em;align-content:start;border-top:1px solid var(--faint);padding-top:.9em;font-size:.72em;color:var(--dim)}
.foot:empty{display:none}
.line{display:contents}
.line b{font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.foot.how{border-top:0;padding-top:0;margin-top:.4em;font-size:.86em;gap:.6em;grid-template-columns:1.4em 1fr;color:var(--fg)}
.foot.how b{color:var(--call)}
body[data-device="tv"]{font-size:clamp(12px,6vw,40px);padding:0 7vw;gap:0;justify-content:center}
body[data-device="tv"] .top,body[data-device="tv"] .foot,body[data-device="tv"] .sub,body[data-device="tv"] .hint,body[data-device="tv"] .actions{display:none}
body[data-device="tv"] .stake{font-size:1.15em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body[data-device="tv"] .tvline{display:block}
.tvline{display:none;font-size:.62em;font-weight:650;color:var(--needs);letter-spacing:.04em}
@media (prefers-reduced-motion:reduce){*{animation:none !important}}
</style></head><body>
<div class="top"><span class="check" aria-hidden="true">&#10003;</span><span class="chip idle" id="chip">Ready</span></div>
<span class="tvline" id="tvline"></span>
<div class="stake" id="stake"></div>
<p class="sub" id="sub"></p>
<div class="actions" id="actions"></div>
<p class="hint" id="hint"></p>
<div class="foot" id="foot"></div>
<script>
let seq=0;const pending=new Map();let tick;
addEventListener("message",e=>{const m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!==undefined&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p[1](new Error(m.error.message||"tool error")):p[0](m.result);}
 if(m.method==="ui/notifications/tool-result"&&m.params&&m.params.structuredContent)render(m.params.structuredContent);
 if(m.method==="ui/notifications/host-context-changed"&&m.params)applyDevice(m.params.hostContext||m.params);});
${HOST_BOOT}
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const usd=n=>"$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:2});
const clock=ms=>{const s=Math.max(0,Math.floor(ms/1000));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0");};
const DEMO="Call Joe's Plumbing and book a visit tomorrow to fix the kitchen sink, keep it under 150";
const HOW=["Ambient phones the business and says it is an AI, first thing.","Over your limit? It puts them on hold and asks you, right here.","You hear only what the business actually confirmed."];
function business(steps){for(const s of steps){const m=/^(?:Calling|Connected to) (.+)$/.exec(s);if(m)return m[1];}return "";}
function speaker(s,biz){const who=["Ambient",biz].find(n=>n&&s.startsWith(n+": "));if(who)return{who,text:s.slice(who.length+2)};const m=/^([^:]{1,40}): (.+)$/.exec(s);return m?{who:m[1],text:m[2]}:null;}
function speakers(steps,biz){return steps.map(s=>speaker(s,biz)).filter(Boolean);}
function act(name,args){return rpc("tools/call",{name,arguments:args}).catch(()=>undefined);}
function offers(ap){const limit=ap.limitUsd,amount=ap.amountUsd;if(limit===undefined||amount===undefined)return [];
 const out=[];for(let v=limit+10;v<amount&&out.length<2;v+=10)out.push(v);return out;}
function buttons(list){const box=$("actions");box.innerHTML="";
 for(const b of list){const el=document.createElement("button");el.type="button";el.textContent=b.label;if(b.kind)el.className=b.kind;el.onclick=()=>{el.disabled=true;b.run();};box.appendChild(el);}}
function foot(lines,how){const box=$("foot");box.className=how?"foot how":"foot";
 box.innerHTML=lines.map(l=>'<div class="line"><b>'+esc(l.who)+'</b><span>'+l.text+'</span></div>').join("");}
function ownerSaid(line,biz){if(!line)return "";const decided=/^\\S+ (approved|declined): /.exec(line.text);if(decided)return "You "+decided[1]+" it.";
 const offer=/^offer\\s+\\$?(\\d+)/i.exec(line.text);return offer?"You offered "+usd(offer[1])+". Waiting for "+biz+".":"You told them: \\u201c"+cap(line.text)+"\\u201d";}
function render(d){
 clearInterval(tick);
 const t=d.task||{},steps=t.steps||[],ap=(d.approvals||[])[0],o=t.outcome,biz=t.subject||business(steps)||"the business";
 const live=t.status&&!["completed","failed","cancelled","unknown"].includes(t.status);
 const connected=steps.some(s=>s.startsWith("Connected to"));
 const chip=$("chip"),stake=$("stake"),sub=$("sub"),hint=$("hint"),tv=$("tvline");
 const said=speakers(steps,biz),owner=said.filter(l=>l.who!=="Ambient"&&l.who!==biz).at(-1);
 document.body.classList.remove("booked");hint.textContent="";tv.textContent="";buttons([]);foot([]);
 if(ap){chip.className="chip needs";
  chip.textContent=ap.amountUsd!==undefined&&ap.limitUsd!==undefined?"Needs you \\u00b7 "+usd(ap.amountUsd-ap.limitUsd)+" over your "+usd(ap.limitUsd)+" limit":"Needs you";
  tv.textContent="Over your limit";
  stake.textContent=(ap.amountUsd!==undefined?usd(ap.amountUsd)+" \\u00b7 ":"")+(ap.when?cap(ap.when):biz);
  const since=Date.parse(ap.createdAt||"");
  const hold=()=>{sub.textContent=ap.kind==="dial"?"Place this call?":biz+" is on hold"+(Number.isFinite(since)?" \\u00b7 "+clock(Date.now()-since):"");};
  hold();if(ap.kind!=="dial")tick=setInterval(hold,1000);
  buttons([{label:ap.amountUsd!==undefined?"Approve "+usd(ap.amountUsd):"Approve",kind:"primary",run:()=>act("approve",{decision:"once"})},
   ...offers(ap).map(v=>({label:"Offer "+usd(v),kind:"offer",run:()=>act("delegate",{task:"offer "+v})})),
   {label:"Decline",kind:"quiet",run:()=>act("approve",{decision:"deny"})}]);
  hint.textContent=ap.kind==="dial"?"":"Declining ends the call politely. Nothing is booked.";
  foot([{who:"While you decide",text:"Ambient tells "+esc(biz)+" it is still checking with you, every 15 seconds."}]);}
 else if(o){const ok=o.kind==="confirmed";chip.className="chip "+(ok?"done":"warn");
  if(ok)document.body.classList.add("booked");
  chip.textContent=ok?"Booked \\u00b7 confirmed by "+biz:o.kind==="unconfirmed"?"Not confirmed":o.kind==="declined"?"Declined":"No deal";
  stake.textContent=ok?((o.amountUsd!==undefined?usd(o.amountUsd)+" \\u00b7 ":"")+cap(o.when||biz)):biz;
  const theirs=said.filter(l=>l.who===biz).at(-1);
  sub.textContent=ok?(theirs?"In their words: \\u201c"+theirs.text+"\\u201d":"Booked with "+biz+"."):t.status==="cancelled"?"You ended the call before "+biz+" confirmed. Nothing was booked.":cap(o.reason)+". Nothing was booked.";
  if(ok)foot([{who:"Honest by design",text:"Ambient only reports a booking when the business says it out loud."}]);
  else buttons([{label:"Call again",kind:"call",run:()=>act("delegate",{task:DEMO,newConversation:true})}]);}
 else if(live){chip.className="chip";chip.textContent=connected?"On the phone":"Calling";
  stake.textContent=biz;
  sub.textContent=owner?ownerSaid(owner,biz):connected?biz+" answered. Ambient said it is an AI.":"Ringing\\u2026 Ambient will say it is an AI first.";
  foot(said.slice(-3).map(l=>({who:l.who,text:esc(cap(l.text))})));}
 else{chip.className="chip idle";chip.textContent="Ready";stake.textContent="Alexa, handle the call.";
  sub.textContent="Say \\u201cAlexa, tell Ambient to call Joe's Plumbing,\\u201d or tap below.";
  buttons([{label:"Call Joe's Plumbing",kind:"call",run:()=>act("delegate",{task:DEMO,newConversation:true})}]);
  foot(HOW.map((x,i)=>({who:String(i+1),text:x})),true);}}
render({});
boot();
</script></body></html>`;
