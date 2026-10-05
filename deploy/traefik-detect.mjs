// Reads `docker inspect <traefik container>` JSON on stdin and prints shell variables describing how to add a route
// to that Traefik (used by install-vps.sh when ports 80/443 already belong to a Traefik — Coolify, Dokploy, …).
//   TRAEFIK_DYNAMIC_DIR  host folder watched by Traefik's file provider ('' if none found)
//   TRAEFIK_HTTPS_EP / TRAEFIK_HTTP_EP   entrypoint names for :443 / :80
//   TRAEFIK_RESOLVER     ACME certificate resolver name
// The static configuration is read from the command-line arguments, or from a mounted traefik.yml / traefik.yaml.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const inspect = JSON.parse(readFileSync(0, 'utf8'));
const c = Array.isArray(inspect) ? inspect[0] : inspect;
const mounts = (c?.Mounts ?? []).map((m) => ({ src: String(m.Source ?? ''), dst: String(m.Destination ?? '').replace(/\/+$/, '') }));

/** Container path → host path through the container's mounts (longest match wins). */
export function toHostPath(p, list = mounts) {
  const clean = p.replace(/\/+$/, '');
  const m = list
    .filter((x) => x.dst && (clean === x.dst || clean.startsWith(x.dst + '/')))
    .sort((a, b) => b.dst.length - a.dst.length)[0];
  return m ? m.src.replace(/\/+$/, '') + clean.slice(m.dst.length) : '';
}

const args = [...(c?.Args ?? []), ...(c?.Config?.Cmd ?? [])].map(String);
const arg = (re) => { for (const a of args) { const m = a.match(re); if (m) return m[1]; } return ''; };

let dir = arg(/^--providers\.file\.directory=(.+)$/i);
let httpsEp = '', httpEp = '', resolver = arg(/^--certificates[rR]esolvers\.([^.=]+)\./);
for (const a of args) {
  const m = a.match(/^--entry[pP]oints\.([^.=]+)\.address=(.*)$/);
  if (m && /:443$/.test(m[2])) httpsEp = m[1];
  if (m && /:80$/.test(m[2])) httpEp = m[1];
}

// Static file (Dokploy and others): traefik.yml mounted into the container.
if (!dir || !httpsEp || !resolver) {
  const candidates = [];
  for (const x of mounts) {
    if (/traefik\.ya?ml$/.test(x.dst)) candidates.push(x.src);
    else if (x.src && existsSync(x.src) && statSync(x.src).isDirectory()) {
      for (const f of ['traefik.yml', 'traefik.yaml']) if (existsSync(path.join(x.src, f))) candidates.push(path.join(x.src, f));
    }
  }
  for (const file of candidates) {
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    if (!dir) dir = (text.match(/\n\s*file:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+directory:\s*["']?([^"'\n#]+)/) ?? [])[1]?.trim() ?? '';
    if (!resolver) resolver = (text.match(/certificates[rR]esolvers:\s*\n\s+["']?([A-Za-z0-9_-]+)["']?:/) ?? [])[1] ?? '';
    for (const m of text.matchAll(/\n[ \t]+["']?([A-Za-z0-9_-]+)["']?:\s*\n[ \t]+address:\s*["']?([^"'\n]*)/g)) {
      if (!httpsEp && /:443$/.test(m[2].trim())) httpsEp = m[1];
      if (!httpEp && /:80$/.test(m[2].trim())) httpEp = m[1];
    }
  }
}

let hostDir = dir ? toHostPath(dir) : '';
// Well-known panels, if the file provider could not be read.
if (!hostDir) for (const p of ['/data/coolify/proxy/dynamic', '/etc/dokploy/traefik/dynamic']) if (existsSync(p)) { hostDir = p; break; }

const q = (s) => `'${String(s).replace(/'/g, '')}'`;
console.log(`TRAEFIK_DYNAMIC_DIR=${q(hostDir)}`);
console.log(`TRAEFIK_HTTPS_EP=${q(httpsEp || 'websecure')}`);
console.log(`TRAEFIK_HTTP_EP=${q(httpEp || 'web')}`);
console.log(`TRAEFIK_RESOLVER=${q(resolver || 'letsencrypt')}`);
