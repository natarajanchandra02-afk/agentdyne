/**
 * GET /embed/[agentId]
 * Serves the embeddable widget JS at /embed/[agentId]
 *
 * Add to next.config.js rewrites:
 *   { source: "/embed/:id.js", destination: "/embed/:id" }
 */

export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) {
    return new Response("/* Invalid agent id */", { status: 400, headers: { "Content-Type": "application/javascript" } })
  }

  const supabase = await createClient()

  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, status, embed_enabled, embed_config")
    .eq("id", agentId)
    .single()

  if (!agent || agent.status !== "active" || !agent.embed_enabled) {
    return new Response(`/* Agent "${agentId}" is not available for embedding */`, {
      status: 404, headers: { "Content-Type": "application/javascript" },
    })
  }

  const cfg      = (agent.embed_config ?? {}) as Record<string, unknown>
  const name     = (agent.name as string).replace(/'/g, "\\'")
  const color    = (cfg.primaryColor ?? "#6366f1") as string
  const position = (cfg.position     ?? "bottom-right") as string
  const ph       = ((cfg.placeholder ?? `Chat with ${name}`) as string).replace(/'/g, "\\'")
  const baseUrl  = process.env.NEXT_PUBLIC_APP_URL ?? "https://agentdyne.com"

  const r = position.includes("right") ? "24px" : "auto"
  const l = position.includes("left")  ? "24px" : "auto"
  const b = position.includes("bottom") ? "24px" : "auto"

  const js = `(function(){"use strict";
var AID='${agentId}',API='${baseUrl}',CLR='${color}',PH='${ph}';
var S=document.createElement('style');
S.textContent='.adw-w{position:fixed;bottom:${b};right:${r};left:${l};z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,sans-serif}'+
'.adw-b{width:56px;height:56px;border-radius:50%;background:'+CLR+';border:none;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .2s}'+
'.adw-b:hover{transform:scale(1.06)}.adw-b svg{width:24px;height:24px;fill:white}'+
'.adw-c{position:fixed;right:${r === "auto" ? "auto" : "24px"};left:${l === "auto" ? "auto" : "24px"};bottom:96px;width:380px;max-height:580px;background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden;z-index:2147483646}'+
'@media(max-width:480px){.adw-c{width:calc(100vw - 32px);right:16px;left:auto}}'+
'.adw-c.open{display:flex}'+
'.adw-h{padding:14px 18px;background:'+CLR+';color:#fff;flex-shrink:0}'+
'.adw-hn{font-size:14px;font-weight:700;margin:0;line-height:1.2}'+
'.adw-hs{font-size:11px;opacity:.8;margin:2px 0 0}'+
'.adw-m{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:160px}'+
'.adw-msg{max-width:85%;padding:10px 13px;border-radius:12px;font-size:13px;line-height:1.5;word-break:break-word}'+
'.adw-msg.u{background:'+CLR+';color:#fff;align-self:flex-end;border-bottom-right-radius:4px}'+
'.adw-msg.b{background:#f4f4f5;color:#1a1a1a;align-self:flex-start;border-bottom-left-radius:4px}'+
'.adw-cur{display:inline-block;width:2px;height:13px;background:'+CLR+';animation:adwblink .7s infinite;vertical-align:middle;margin-left:2px}'+
'@keyframes adwblink{0%,100%{opacity:1}50%{opacity:0}}'+
'.adw-f{padding:10px 14px;border-top:1px solid #e5e7eb;display:flex;gap:8px;align-items:flex-end;flex-shrink:0}'+
'.adw-i{flex:1;border:1.5px solid #e5e7eb;border-radius:10px;padding:9px 13px;font-size:13px;resize:none;outline:none;min-height:40px;max-height:100px;font-family:inherit}'+
'.adw-i:focus{border-color:'+CLR+'}'+
'.adw-s{width:38px;height:38px;border-radius:10px;background:'+CLR+';border:none;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s}'+
'.adw-s:disabled{opacity:.45;cursor:not-allowed}'+
'.adw-pw{text-align:center;padding:5px;font-size:11px;color:#a1a1aa;flex-shrink:0}'+
'.adw-pw a{color:'+CLR+';text-decoration:none}';
document.head.appendChild(S);
var W=document.createElement('div');W.className='adw-w';
W.innerHTML='<div class="adw-c" id="adwC"><div class="adw-h"><p class="adw-hn">${name}</p><p class="adw-hs">Powered by AgentDyne</p></div><div class="adw-m" id="adwM"><div class="adw-msg b">Hi! How can I help you today?</div></div><div class="adw-f"><textarea class="adw-i" id="adwI" rows="1" placeholder="'+PH+'"></textarea><button class="adw-s" id="adwS" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div><div class="adw-pw"><a href="${baseUrl}" target="_blank" rel="noopener">Build with AgentDyne</a></div></div><button class="adw-b" id="adwB" aria-label="Chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>';
document.body.appendChild(W);
var chat=document.getElementById('adwC'),btn=document.getElementById('adwB'),msgs=document.getElementById('adwM'),inp=document.getElementById('adwI'),snd=document.getElementById('adwS'),open=false,busy=false;
btn.addEventListener('click',function(){open=!open;chat.classList.toggle('open',open);if(open)inp.focus();});
inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
inp.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px';});
snd.addEventListener('click',send);
function addMsg(t,role,streaming){var d=document.createElement('div');d.className='adw-msg '+role;if(streaming)d.innerHTML='<span class="adw-cur"></span>';else d.textContent=t;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d;}
function send(){var t=inp.value.trim();if(!t||busy)return;inp.value='';inp.style.height='auto';busy=true;snd.disabled=true;addMsg(t,'u');var bot=addMsg('','b',true),cur=bot.querySelector('.adw-cur'),full='';
fetch(API+'/api/agents/'+AID+'/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:t,stream:true})}).then(function(r){var rdr=r.body.getReader(),dec=new TextDecoder();
function read(){rdr.read().then(function(c){if(c.done){if(cur)cur.remove();busy=false;snd.disabled=false;return;}
var lines=dec.decode(c.value,{stream:true}).split('\\n');
lines.forEach(function(line){if(!line.startsWith('data: '))return;try{var ev=JSON.parse(line.slice(6));
if(ev.type==='delta'&&ev.delta){full+=ev.delta;bot.textContent=full;if(cur)bot.appendChild(cur);msgs.scrollTop=msgs.scrollHeight;}
if(ev.type==='done'){if(cur)cur.remove();busy=false;snd.disabled=false;}
if(ev.type==='error'){bot.textContent='Something went wrong. Please try again.';if(cur)cur.remove();busy=false;snd.disabled=false;}}catch(e){}});
return read();});}return read();}).catch(function(){bot.textContent='Connection error.';if(cur)cur.remove();busy=false;snd.disabled=false;});}
})();`.replace(/\s+/g, " ").trim()

  return new Response(js, {
    headers: {
      "Content-Type":  "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
