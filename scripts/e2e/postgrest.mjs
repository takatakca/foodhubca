// Food Hub on a real Postgres for the crash-replay check (`npm run verify:crash`, docs/CRASH_REPLAY_E2E.md).
// CI runs postgres:16 + PostgREST (the REST server Supabase itself runs); these two helpers make that pair look like a
// Supabase project to the app, with no new dependency:
//   - serviceRoleJwt(secret): the "service_role" key — an HS256 JWT signed with PostgREST's PGRST_JWT_SECRET;
//   - startRestProxy({ target, port }): supabase-js calls <url>/rest/v1/<table>, PostgREST serves /<table>, so this
//     tiny proxy strips /rest/v1 (and refuses every other Supabase path: auth, storage… are not used by the server).
// CLI (used by .github/workflows/ci.yml):  PGRST_JWT_SECRET=… node scripts/e2e/postgrest.mjs service-jwt
import crypto from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** A Supabase-style service_role key for this PostgREST (HS256, role service_role). */
export function serviceRoleJwt(secret, { ttlS = 6 * 3600, now = Date.now() } = {}) {
  if (!secret || String(secret).length < 32) throw new Error('PGRST_JWT_SECRET must be at least 32 characters');
  const iat = Math.floor(now / 1000);
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ role: 'service_role', iss: 'foodhub-crash-e2e', iat, exp: iat + ttlS });
  const sig = crypto.createHmac('sha256', String(secret)).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** Listens on 127.0.0.1:`port` and forwards /rest/v1/* to `target` (PostgREST root) without the prefix. */
export function startRestProxy({ target, port }) {
  const to = new URL(target);
  const server = http.createServer((req, res) => {
    const m = /^\/rest\/v1(\/.*)?$/.exec(req.url.split('?')[0]);
    if (!m) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: `not served by the crash-check proxy: ${req.url}` })); return; }
    const rest = req.url.slice('/rest/v1'.length) || '/';
    const headers = { ...req.headers, host: to.host };
    const up = http.request({ hostname: to.hostname, port: to.port || 80, method: req.method, path: `${to.pathname.replace(/\/$/, '')}${rest.startsWith('/') ? rest : `/${rest}`}`, headers }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    up.on('error', (e) => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: `PostgREST unreachable: ${e.message}` })); });
    req.pipe(up);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== 'service-jwt') { console.error('usage: PGRST_JWT_SECRET=… node scripts/e2e/postgrest.mjs service-jwt'); process.exit(2); }
  process.stdout.write(serviceRoleJwt(process.env.PGRST_JWT_SECRET));
}
