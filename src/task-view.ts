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
 --call:oklch(0.78 0.11 225);--needs:oklch(0.78 0.17 62);--done:oklch(0.80 0.15 155);--warn:oklch(0.90 0.11 98 / .75);--stop:oklch(0.68 0.20 25);
 --go:oklch(0.52 0.13 152);--btn:oklch(0.26 0.01 255)}
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{background:var(--bg);color:var(--fg);font:400 clamp(12px,3.2vw,40px)/1.35 -apple-system,"SF Pro Text",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased;padding:7vw 6vw 4.5vw;display:flex;flex-direction:column;justify-content:flex-start;gap:2.2vw;overflow:hidden}
button{font:inherit;color:inherit;cursor:pointer;border:0}
button:focus-visible{outline:2px solid var(--call);outline-offset:3px}
.top{display:flex;align-items:center;gap:.8em}
.chip{display:inline-flex;align-items:center;gap:.5em;font-size:max(15px,.58em);font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--call)}
.chip::before{content:"";width:.7em;height:.7em;border-radius:50%;background:currentColor}
.chip.needs{color:var(--needs)}.chip.done{color:var(--done)}.chip.warn{color:var(--warn)}.chip.idle{color:var(--dim)}
.chip.needs::before{animation:breathe 2.4s ease-in-out infinite}
@keyframes breathe{50%{opacity:.35;transform:scale(.8)}}
.clock{margin-left:auto;font-size:max(15px,.62em);font-weight:600;font-variant-numeric:tabular-nums}
.clock:empty{display:none}
.what{font-size:1em;font-weight:600;margin-bottom:-.5em;text-wrap:balance}
.what:empty{display:none}
.sep{color:var(--dim)}
.check{display:none;width:2.2em;height:2.2em;border-radius:50%;background:var(--done);color:var(--bg);place-items:center}
.check svg{width:62%;height:62%;fill:none;stroke:currentColor;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:24;stroke-dashoffset:0}
body.booked .chip::before{display:none}
body.booked{background:radial-gradient(circle at 8% 22%,oklch(0.72 0.17 150 / .16),transparent 55%) var(--bg)}
body.booked.open{background:radial-gradient(circle at 8% 22%,oklch(0.78 0.17 62 / .16),transparent 55%) var(--bg)}
body.booked.open .check{background:var(--needs)}
body.booked .check{display:grid;animation:land 420ms cubic-bezier(0.2,0,0,1) both}
body.booked .check path{animation:draw 600ms 180ms cubic-bezier(0.2,0,0,1) both}
@keyframes land{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes draw{0%{stroke-dashoffset:24}100%{stroke-dashoffset:0}}
.stake{font-size:2.6em;font-weight:680;letter-spacing:-.025em;line-height:1.04;font-variant-numeric:tabular-nums;text-wrap:balance}
.stake.long{font-size:2em}
.over{font-size:1.05em;font-weight:620;color:var(--needs);font-variant-numeric:tabular-nums;margin-top:-.4em}
.over:empty{display:none}
.flag{font-size:.72em;font-weight:600;color:var(--needs);margin-top:-.4em}
.flag:empty{display:none}
.flag.date{font-size:.8em}
.flag.dim{color:var(--dim);font-weight:500}
.sub{font-size:.95em;color:var(--dim);text-wrap:pretty;max-width:34em;font-variant-numeric:tabular-nums}
.actions{display:flex;gap:.5em;flex-wrap:wrap;align-items:center;margin-top:.3em}
.actions:empty{display:none}
.actions button{min-height:2.5em;padding:0 1em;border-radius:.55em;background:var(--btn);font-weight:600;font-size:.95em}
.actions button.primary{background:var(--go);color:#fff;padding:0 1.4em}
.actions button.offer{background:transparent;box-shadow:inset 0 0 0 1.5px oklch(1 0 0 / .4)}
.actions button.quiet{background:transparent;color:var(--stop);padding:0 .8em;box-shadow:inset 0 0 0 1.5px oklch(0.68 0.20 25 / .45)}
body[data-state="live"]:not([data-device="tv"]),body[data-state="done"]:not([data-device="tv"]){justify-content:center}
body[data-state="needs"]:not([data-device="tv"]) .actions{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);align-items:stretch}
body[data-state="needs"] .actions button{padding-inline:.6em;min-height:max(56px,2.9em);min-width:44px}
.actions button small{display:block;font-size:max(13px,.8em);font-weight:500;text-wrap:balance}
.actions button.offer{padding-top:.3em;padding-bottom:.3em}
.actions button.call{background:var(--fg);color:var(--bg)}
.actions button:active{transform:scale(.97)}
.hint{font-size:max(15px,.72em);color:oklch(0.86 0.01 255)}
.hint:empty{display:none}
.foot{margin-top:1em;display:grid;grid-template-columns:minmax(0,max-content) 1fr;gap:.45em .8em;align-content:start;border-top:1px solid var(--faint);padding-top:.9em;font-size:max(13px,.72em);color:var(--dim)}
.foot:empty{display:none}
.line{display:contents}
.line b{font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
body[data-device="tv"]{font-size:clamp(12px,6vw,40px);padding:0 7vw;gap:0;justify-content:center}
body[data-device="tv"] .top,body[data-device="tv"] .what,body[data-device="tv"] .over,body[data-device="tv"] .flag,body[data-device="tv"] .foot,body[data-device="tv"] .sub,body[data-device="tv"] .hint,body[data-device="tv"] .actions{display:none}
body[data-device="tv"] .stake{font-size:1.15em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body[data-device="tv"] .tvline{display:block}
.tvline{display:none;font-size:max(15px,.7em);font-weight:650;color:var(--needs);letter-spacing:.02em}
@media (max-width:480px){
 body:not([data-device="tv"]){font-size:15px;padding:24px 20px;gap:12px;overflow:auto;justify-content:flex-start}
 body:not([data-device="tv"]) .stake{font-size:2.1em}
 body:not([data-device="tv"]) .sep{display:none}
 body:not([data-device="tv"]) .when{display:block}
 body:not([data-device="tv"]) .over{margin-top:-.2em}
 body:not([data-device="tv"]) .flag{font-size:13px;margin-top:-.2em}
 body:not([data-device="tv"]) .actions{flex-direction:column;align-items:stretch;gap:8px}
 body:not([data-device="tv"]) .actions button{min-height:48px;font-size:16px}
 body:not([data-device="tv"]) .hint{font-size:13px}
 body:not([data-device="tv"]) .foot{grid-template-columns:1fr;font-size:14px;gap:2px}
 body[data-state="needs"]:not([data-device="tv"]) .actions{grid-auto-flow:row}
}
body.arrive{animation:arrive 240ms cubic-bezier(0.2,0,0,1) both}
@keyframes arrive{0%{transform:scale(.98);opacity:.4}100%{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){*{animation:none !important}}
</style></head><body>
<div class="top"><span class="check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="chip idle" id="chip">Ready</span><span class="clock" id="clock"></span></div>
<span class="tvline" id="tvline"></span>
<p class="what" id="what"></p>
<div class="stake" id="stake"></div>
<p class="over" id="over"></p>
<p class="flag" id="flag"></p>
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
function errand(title){const m=/\\bto ([a-z][^,.]{2,48})/i.exec(title||"");return m?cap(m[1].trim()):"";}
function limitOf(text){const m=/\\b(?:under|below|up to|no more than|max(?:imum)?)\\s+\\$?(\\d[\\d,]*)/i.exec(text||"");return m?"limit $"+m[1]:"";}
function business(steps){for(const s of steps){const m=/^(?:Calling|Connected to) (.+)$/.exec(s);if(m)return m[1];}return "";}
function speaker(s,biz){const who=["Ambient",biz].find(n=>n&&s.startsWith(n+": "));if(who)return{who,text:s.slice(who.length+2)};const m=/^([^:]{1,40}): (.+)$/.exec(s);return m?{who:m[1],text:m[2]}:null;}
function speakers(steps,biz){return steps.map(s=>speaker(s,biz)).filter(Boolean);}
function act(name,args){return rpc("tools/call",{name,arguments:args}).catch(()=>undefined);}
function offers(ap,said){const limit=ap.limitUsd,amount=ap.amountUsd;if(limit===undefined||amount===undefined||amount<=limit)return [];
 return said.some(l=>l.who!=="Ambient"&&l.text.trim().toLowerCase()==="offer "+limit)?[]:[limit];}
function dated(when){return /\\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\b|\\d{1,2}\\/\\d{1,2}|\\bthe (?:\\d{1,2}(?:st|nd|rd|th)|(?:twenty|thirty)?-? ?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\\b/i.test(when||"");}
function buttons(list){const box=$("actions");box.innerHTML="";
 for(const b of list){const el=document.createElement("button");el.type="button";el.textContent=b.label;if(b.note){const n=document.createElement("small");n.textContent=b.note;el.appendChild(n);}if(b.kind)el.className=b.kind;el.onclick=()=>{el.disabled=true;b.run();};box.appendChild(el);}}
function foot(lines){const box=$("foot");
 box.innerHTML=lines.map(l=>'<div class="line"><b>'+esc(l.who)+'</b><span>'+l.text+'</span></div>').join("");}
function ownerSaid(line,biz){if(!line)return "";const decided=/^(Approved|Declined): /.exec(line.text);if(decided)return "You "+decided[1].toLowerCase()+" it.";
 const offer=/^offer\\s+\\$?(\\d+)/i.exec(line.text);return offer?"You offered "+usd(offer[1])+". Waiting for "+biz+".":"You told them: \\u201c"+cap(line.text)+"\\u201d";}
function setStake(amount,when){const el=$("stake");el.classList.toggle("long",String(when||"").length>16);
 el.innerHTML=amount===undefined?'<span class="when">'+esc(when)+'</span>':esc(usd(amount))+'<span class="sep"> \\u00b7 </span><span class="when">'+esc(when)+'</span>';}
let shown="";
function render(d){
 clearInterval(tick);
 const t=d.task||{},steps=t.steps||[],ap=(d.approvals||[])[0],o=t.outcome,biz=t.subject||business(steps)||"the business";
 const live=t.status&&!["completed","failed","cancelled","unknown"].includes(t.status);
 const connected=steps.some(s=>s.startsWith("Connected to"));
 const chip=$("chip"),stake=$("stake"),over=$("over"),flag=$("flag"),sub=$("sub"),hint=$("hint"),tv=$("tvline");
 const said=speakers(steps,biz),owner=said.filter(l=>l.who!=="Ambient"&&l.who!==biz).at(-1),what=errand(t.instruction);
 const theirs=said.filter(l=>l.who===biz).at(-1);
 const kind=ap?"needs":o?"done":live?"live":"idle";
 document.body.classList.remove("booked","open","arrive");
 if(kind==="needs"&&shown!=="needs"){void document.body.offsetWidth;document.body.classList.add("arrive");}
 shown=kind;document.body.dataset.state=kind;
 over.textContent="";flag.textContent="";flag.className="flag";hint.textContent="";tv.textContent="";$("what").textContent="";$("clock").textContent="";buttons([]);foot([]);
 if(ap){chip.className="chip needs";chip.textContent="Needs you";
  tv.textContent="Over your limit";
  $("what").textContent=what;
  setStake(ap.amountUsd,ap.when?cap(ap.when):biz);
  if(ap.amountUsd!==undefined&&ap.limitUsd!==undefined)over.textContent=usd(ap.amountUsd-ap.limitUsd)+" over your "+usd(ap.limitUsd)+" limit";
  const offered=ap.amountUsd>ap.limitUsd&&!offers(ap,said).length;
  if(offered){flag.className="flag dim";flag.textContent="You already offered "+usd(ap.limitUsd);}
  const asked=Date.parse(ap.createdAt||"");
  sub.textContent=ap.kind==="dial"?"Place this call?":offered?"":biz+" is on the line, waiting for you.";
  const hold=()=>{$("clock").textContent=Number.isFinite(asked)?"Waiting "+clock(Date.now()-asked):"";};
  if(ap.kind!=="dial"){hold();tick=setInterval(hold,1000);}
  if(theirs)foot([{who:biz+" said",text:"\\u201c"+esc(theirs.text)+"\\u201d"}]);
  const spend=ap.kind!=="dial";
  buttons([{label:ap.amountUsd!==undefined?"Book "+usd(ap.amountUsd):"Approve",note:spend?"Tells them yes":"",kind:"primary",run:()=>act("approve",{decision:"once"})},
   ...offers(ap,said).map(v=>({label:"Offer "+usd(v),note:"Your limit",kind:"offer",run:()=>act("delegate",{task:"offer "+v})})),
   {label:"Decline",note:spend?"Ambient hangs up":"",kind:"quiet",run:()=>act("approve",{decision:"deny"})}]);
  }
 else if(o){const ok=o.kind==="confirmed";chip.className="chip "+(ok?(dated(o.when)?"done":"needs"):"warn");
  if(ok)document.body.classList.add("booked");
  if(ok&&!dated(o.when))document.body.classList.add("open");
  chip.textContent=ok?(dated(o.when)?"Booked \\u00b7 confirmed by "+biz:"Booked \\u00b7 date still open"):o.kind==="unconfirmed"?"Not booked":o.kind==="declined"?"Declined":"No deal";
  if(ok){$("what").textContent=what?biz+" \\u00b7 "+what:biz;setStake(o.amountUsd,cap(o.when||biz));
   if(!dated(o.when)){flag.className="flag date";flag.textContent=(/\\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\\b/i.test(o.when||"")?"Only the weekday was given":"No date was given")+" \\u00b7 ask "+biz+" for the date";}}
  else{stake.textContent="Nothing was booked.";$("what").textContent=[biz,what,limitOf(t.instruction)].filter(Boolean).join(" \\u00b7 ");}
  const readBack=said.some(l=>l.who==="Ambient"&&/^(Just to confirm|Let me check once more|One last check|To be sure):/.test(l.text));
  sub.textContent=ok?(theirs?(readBack?"Ambient read back the total and the time. "+biz+" said \\u201c"+theirs.text+"\\u201d":"In their words: \\u201c"+theirs.text+"\\u201d"):"Booked with "+biz+"."):t.status==="cancelled"?"You ended the call before "+biz+" confirmed.":cap(o.reason)+".";
  const mine=said.filter(l=>l.who!=="Ambient"&&l.who!==biz);
  if(ok)hint.textContent=mine.some(l=>/^Approved: /.test(l.text))?"You approved this price from home.":mine.some(l=>/^offer\\b/i.test(l.text))?"You offered this price from home.":limitOf(t.instruction)?"Within your "+limitOf(t.instruction).slice(6)+" limit.":"";
  if(!ok){if(theirs)foot([{who:"Last from "+biz,text:"\\u201c"+esc(theirs.text)+"\\u201d"}]);
   buttons([{label:"Call "+biz+" again",kind:"call",run:()=>act("delegate",{task:DEMO,newConversation:true})}]);}}
 else if(live){chip.className="chip";
  const offered=owner?/^offer\\s+\\$?(\\d+)/i.exec(owner.text):null;
  $("what").textContent=[what,offered?limitOf(t.instruction)+" \\u00b7 you offered "+usd(offered[1]):limitOf(t.instruction)].filter(Boolean).join(" \\u00b7 ");
  stake.textContent=biz;
  const ai=said.findLastIndex(l=>l.who==="Ambient"&&/dollars|total/.test(l.text)),asked=said[ai],bi=said.findLastIndex(l=>l.who===biz);
  const again=asked&&bi>=0&&ai>bi&&ai>said.findLastIndex(l=>l.who!=="Ambient"&&l.who!==biz);
  chip.textContent=connected?again&&/total/.test(asked.text)?"On the phone \\u00b7 checking the total":"On the phone":"Calling";
  sub.textContent=again?"Ambient asked: \\u201c"+asked.text+"\\u201d":owner?ownerSaid(owner,biz):theirs?"\\u201c"+cap(theirs.text)+"\\u201d":connected?biz+" answered. Ambient said it is an AI.":"Ringing\\u2026 Ambient will say it is an AI first.";
  const began=Date.parse(t.createdAt||"");
  const tickCall=()=>{$("clock").textContent=connected&&Number.isFinite(began)?clock(Date.now()-began):"";};
  tickCall();tick=setInterval(tickCall,1000);}
 else{chip.className="chip idle";chip.textContent="Ready";stake.textContent="Nobody wants to make this call.";
  sub.textContent="Ambient makes it for you. It says it is an AI, and it asks you before it spends over your limit.";
  $("what").textContent="Fix the kitchen sink \\u00b7 limit $150";
  buttons([{label:"Call Joe's Plumbing",kind:"call",run:()=>act("delegate",{task:DEMO,newConversation:true})}]);
  hint.textContent="Or say \\u201cAlexa, tell Ambient to call Joe's Plumbing.\\u201d";}}
render({});
boot();
</script></body></html>`;
