// Screens gateway: one address for every screen of the relay host (deploy/screens/gateway). Pure rules in gateway-lib.mjs.
//   GET /s01/…  → the s01 screen's web view (http + its live websocket), path kept, headers made embeddable by Food Hub.
//   GET /healthz → "ok" (no password; for the host's health check).
// Settings: SCREENS (s01,s02,…), FOODHUB_ORIGIN (https://foodhub.on2go.ca), SCREENS_VIEW_USER / SCREENS_VIEW_PASSWORD
// (the same view sign-in as the screens, asked once for all), PORT (8080), GATEWAY_UPSTREAM ("{screen}:3000").
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { basicOk, frameAncestors, needsSlash, rewriteHeaders, screenOf, upstreamOf } from './gateway-lib.mjs';

const env = (k, d = '') => (process.env[k] ?? d).trim();
const SCREENS = env('SCREENS').split(',').map((s) => s.trim()).filter(Boolean);
const POLICY = frameAncestors(env('FOODHUB_ORIGIN'));
const USER = env('SCREENS_VIEW_USER');
const PASSWORD = env('SCREENS_VIEW_PASSWORD');
const TEMPLATE = env('GATEWAY_UPSTREAM', '{screen}:3000');
const PORT = Number(env('PORT', '8080')) || 8080;

const authOk = (req) => basicOk(req.headers.authorization, USER, PASSWORD, crypto.timingSafeEqual);
const deny = (res) => { res.writeHead(401, { 'www-authenticate': 'Basic realm="TAKATAK screens", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' }); res.end('Sign in to the screens (relay host view password).'); };

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://gateway.local');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  const screen = screenOf(url.pathname, SCREENS);
  if (!screen) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('No such screen.'); return; }
  if (!authOk(req)) return deny(res);
  if (needsSlash(url.pathname, screen)) { res.writeHead(301, { location: `/${screen}/${url.search}` }); res.end(); return; }
  const up = upstreamOf(screen, TEMPLATE);
  const fwd = http.request({ host: up.host, port: up.port, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host ?? '' } }, (r) => {
    res.writeHead(r.statusCode ?? 502, rewriteHeaders(r.headers, POLICY));
    r.pipe(res);
  });
  fwd.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); } res.end(`Screen ${screen} is not answering (is its container running?).`); });
  req.pipe(fwd);
});

// The screen's live view is a websocket: same checks, then the raw connection is passed through both ways.
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://gateway.local');
  const screen = screenOf(url.pathname, SCREENS);
  if (!screen || !authOk(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n'); return; }
  const up = upstreamOf(screen, TEMPLATE);
  const upstream = net.connect(up.port, up.host, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  const close = () => { socket.destroy(); upstream.destroy(); };
  upstream.on('error', close);
  socket.on('error', close);
});

server.listen(PORT, () => console.log(`Screens gateway on :${PORT} for ${SCREENS.length} screen(s); framed by ${POLICY}`));
