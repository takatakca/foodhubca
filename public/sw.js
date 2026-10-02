// TAKATAK Food Hub service worker — makes the dashboard installable and shows a clear
// "offline" page instead of a browser error when the kitchen tablet loses Wi-Fi.
// Live data (/api/*) is never cached: orders must always be fresh.
const SHELL = 'takatak-shell-v1';
const OFFLINE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TAKATAK — offline</title><body style="margin:0;font-family:system-ui,sans-serif;background:#101828;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px">
<div><h1 style="font-size:28px;margin:0 0 8px">No internet connection</h1><p style="color:#d0d5dd;max-width:420px">Orders keep arriving on the Uber Eats, DoorDash and Skip tablets and in Clover. This screen reconnects by itself.</p>
<p style="color:#98a2b3">Reconnecting…</p><script>setInterval(()=>{if(navigator.onLine)location.reload()},5000)</script></div></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.put('/__offline', new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.open(SHELL).then((c) => c.match('/__offline'))));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
});
