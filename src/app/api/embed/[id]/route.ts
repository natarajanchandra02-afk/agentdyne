export const runtime = "edge"

/**
 * GET /api/embed/[id] — Serves the public embed widget JS (P1)
 * This is the JS file referenced by <script src="agentdyne.com/embed/{id}.js">
 *
 * The script:
 *   1. Reads data-* attributes from the <script> tag
 *   2. Injects a floating chat button + iframe into the host page
 *   3. Opens/closes the widget on click
 *   4. Handles all theming via inline CSS
 *
 * Zero dependencies — pure vanilla JS, ~3KB minified.
 */

import { NextRequest } from "next/server"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://agentdyne.com"

  // Parse query params for customization
  const url = new URL(req.url)
  const theme    = url.searchParams.get("theme")    ?? "light"
  const position = url.searchParams.get("position") ?? "bottom-right"
  const color    = url.searchParams.get("color")    ?? "#6366f1"

  const js = `
(function() {
  'use strict';

  // Find the script tag that loaded this file
  var scripts = document.querySelectorAll('script[data-agent="${agentId}"]');
  var scriptTag = scripts[scripts.length - 1];
  if (!scriptTag) return;

  var agentId  = scriptTag.getAttribute('data-agent')  || '${agentId}';
  var token    = scriptTag.getAttribute('data-token')   || '';
  var theme    = scriptTag.getAttribute('data-theme')   || '${theme}';
  var position = scriptTag.getAttribute('data-position')|| '${position}';
  var color    = scriptTag.getAttribute('data-color')   || '${color}';
  var baseUrl  = '${baseUrl}';

  var isDark   = theme === 'dark';
  var isRight  = position.includes('right');
  var isBottom = position.includes('bottom');

  var hSide  = isRight  ? 'right:20px'  : 'left:20px';
  var vSide  = isBottom ? 'bottom:20px' : 'top:20px';
  var widgetV = isBottom ? 'bottom:80px' : 'top:80px';

  // Inject styles
  var style = document.createElement('style');
  style.textContent = [
    '#agentdyne-btn{position:fixed;' + hSide + ';' + vSide + ';z-index:99999;width:56px;height:56px;border-radius:50%;background:' + color + ';border:none;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.18);display:flex;align-items:center;justify-content:center;transition:transform 0.2s,box-shadow 0.2s;}',
    '#agentdyne-btn:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(0,0,0,0.22);}',
    '#agentdyne-btn svg{width:26px;height:26px;fill:white;}',
    '#agentdyne-widget{position:fixed;' + hSide + ';' + widgetV + ';z-index:99998;width:380px;height:580px;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,0.18);border:none;transition:opacity 0.2s,transform 0.2s;transform-origin:' + (isRight ? 'right' : 'left') + ' ' + (isBottom ? 'bottom' : 'top') + ';}',
    '#agentdyne-widget.hidden{opacity:0;pointer-events:none;transform:scale(0.92);}',
    '#agentdyne-badge{position:fixed;' + hSide + ';' + vSide + ';z-index:100000;background:#ef4444;color:#fff;font-size:10px;font-weight:700;min-width:16px;height:16px;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 4px;pointer-events:none;top:' + (isBottom ? 'auto' : '16px') + ';bottom:' + (isBottom ? '64px' : 'auto') + ';' + (isRight ? 'right:14px' : 'left:14px') + ';}',
    '@media(max-width:420px){#agentdyne-widget{width:calc(100vw - 16px);right:8px;left:8px;' + hSide.replace(':20px', ':8px') + ';}}',
  ].join('');
  document.head.appendChild(style);

  // Chat icon SVG
  var chatIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  var closeIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  // Create button
  var btn = document.createElement('button');
  btn.id = 'agentdyne-btn';
  btn.setAttribute('aria-label', 'Open AgentDyne chat');
  btn.innerHTML = chatIcon;
  document.body.appendChild(btn);

  // Create widget iframe
  var iframe = document.createElement('iframe');
  iframe.id = 'agentdyne-widget';
  iframe.className = 'hidden';
  iframe.src = baseUrl + '/embed/widget/' + agentId + '?token=' + encodeURIComponent(token);
  iframe.title = 'AgentDyne Chat Widget';
  iframe.allow = 'microphone';
  document.body.appendChild(iframe);

  // Toggle
  var open = false;
  btn.addEventListener('click', function() {
    open = !open;
    btn.innerHTML = open ? closeIcon : chatIcon;
    btn.setAttribute('aria-label', open ? 'Close chat' : 'Open AgentDyne chat');
    if (open) {
      iframe.classList.remove('hidden');
    } else {
      iframe.classList.add('hidden');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && open) btn.click();
  });

  console.log('[AgentDyne] Widget loaded for agent:', agentId);
})();
`.trim()

  return new Response(js, {
    headers: {
      "Content-Type":  "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
