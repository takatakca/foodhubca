// deploy/screens/setup.sh: the relay host in one command. Run in a throwaway copy with --dry-run (nothing starts);
// `ss` is replaced by a stub so the "ports 80/443 free" check does not depend on the machine running the tests.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error no bundled types
import yaml from 'js-yaml';

const KIT = path.join(__dirname, '../deploy/screens');
const TOKEN = 'f'.repeat(48);
const hasBash = spawnSync('bash', ['--version']).status === 0;
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function kit(portsBusy = false, coolify = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'relay-setup-'));
  dirs.push(root);
  const dir = path.join(root, 'screens');
  cpSync(KIT, dir, { recursive: true });
  cpSync(path.join(KIT, '../traefik-detect.mjs'), path.join(root, 'traefik-detect.mjs'));
  for (const f of ['.env', 'screens.json', 'profiles', 'docker-compose.yml']) rmSync(path.join(dir, f), { recursive: true, force: true });
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const stub = (name: string, body: string) => { writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(path.join(bin, name), 0o755); };
  stub('ss', portsBusy ? 'echo "LISTEN 0 4096 0.0.0.0:443 0.0.0.0:*"' : 'exit 0');
  if (coolify) {
    // Coolify's proxy: Traefik with its entrypoints, resolver and file provider given on the command line.
    mkdirSync(path.join(root, 'proxy', 'dynamic'), { recursive: true });
    writeFileSync(path.join(root, 'inspect.json'), JSON.stringify([{
      Args: ['--entrypoints.http.address=:80', '--entrypoints.https.address=:443', '--providers.file.directory=/traefik/dynamic/', '--certificatesresolvers.letsencrypt.acme.httpchallenge=true'],
      Mounts: [{ Source: path.join(root, 'proxy'), Destination: '/traefik' }],
    }]));
    stub('docker', `case "$1" in compose) exit 0 ;; ps) echo "abc123 traefik:v3.1 coolify-proxy" ;; inspect) cat "${path.join(root, 'inspect.json')}" ;; esac`);
    stub('curl', 'exit 0');
    stub('ip', 'echo "3: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0"');
  }
  return { dir, root, bin };
}
function run(k: { dir: string; bin: string }, args: string[], env: Record<string, string> = {}, dry = true) {
  const r = spawnSync('bash', ['setup.sh', ...args, ...(dry ? ['--dry-run'] : [])], {
    cwd: k.dir, encoding: 'utf8', input: '',
    env: { PATH: `${k.bin}:${process.env.PATH}`, HOME: k.dir, FOODHUB_SCREENS_AGENT_TOKEN: TOKEN, ...env } as unknown as NodeJS.ProcessEnv,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const envOf = (dir: string) => Object.fromEntries(readFileSync(path.join(dir, '.env'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

describe.skipIf(!hasBash)('relay setup.sh (dry run)', () => {
  it('54 screens split over hosts: this host s19–s36, https for its domain, what to type in Food Hub', () => {
    const k = kit();
    const r = run(k, ['--screens', '54', '--only', 's19-s36', '--domain', 'Ecrans2.on2go.ca']);
    expect(r.code, r.out).toBe(0);
    const doc = yaml.load(readFileSync(path.join(k.dir, 'docker-compose.yml'), 'utf8'));
    const screens = Object.keys(doc.services).filter((s) => /^s\d{2}$/.test(s));
    expect(screens).toEqual(Array.from({ length: 18 }, (_, i) => `s${i + 19}`));
    expect(doc.services.https.command).toEqual(['caddy', 'reverse-proxy', '--from', 'ecrans2.on2go.ca', '--to', 'gateway:8080']);
    expect(r.out).toContain('0 DoorDash, 18 Uber Eats, 0 Skip');
    expect(r.out).toContain('numéro de départ : 19');
    expect(r.out).toContain('https://ecrans2.on2go.ca/');
    expect(r.out).not.toContain(TOKEN); // the token is never printed
  });

  it('writes .env once: private (600), the token, a random view password; a second run changes nothing', () => {
    const k = kit();
    expect(run(k, ['--screens', '18']).code).toBe(0);
    const env1 = envOf(k.dir);
    expect(statSync(path.join(k.dir, '.env')).mode & 0o777).toBe(0o600);
    expect(env1).toMatchObject({ FOODHUB_URL: 'https://foodhub.on2go.ca', FOODHUB_ORIGIN: 'https://foodhub.on2go.ca', FOODHUB_SCREENS_AGENT_TOKEN: TOKEN, SCREENS_VIEW_USER: 'ecrans' });
    expect(env1.SCREENS_VIEW_PASSWORD).toMatch(/^[0-9a-f]{24}$/);
    const again = run(k, ['--screens', '54'], { FOODHUB_SCREENS_AGENT_TOKEN: '' });
    expect(again.code, again.out).toBe(0);
    expect(envOf(k.dir)).toEqual(env1);
    expect(again.out).toContain('screens.json existe déjà'); // the list is kept unless --reset-list
    expect(readFileSync(path.join(k.dir, '.env'), 'utf8').match(/^FOODHUB_SCREENS_AGENT_TOKEN=/gm)).toHaveLength(1);
  });

  it('another Food Hub address goes into .env', () => {
    const k = kit();
    expect(run(k, ['--foodhub', 'https://hub.example.ca']).code).toBe(0);
    expect(envOf(k.dir)).toMatchObject({ FOODHUB_URL: 'https://hub.example.ca', FOODHUB_ORIGIN: 'https://hub.example.ca' });
  });

  it('ports 80/443 taken by something unknown: no built-in https, says where to route the domain', () => {
    const k = kit(true);
    const r = run(k, ['--domain', 'ecrans.on2go.ca']);
    expect(r.code, r.out).toBe(0);
    expect(yaml.load(readFileSync(path.join(k.dir, 'docker-compose.yml'), 'utf8')).services.https).toBeUndefined();
    expect(r.out).toContain('127.0.0.1:3100');
  });

  it('Coolify on the same server: one route file in its Traefik, gateway on the Docker bridge, started', () => {
    const k = kit(true, true);
    const r = run(k, ['--domain', 'ecrans.on2go.ca'], {}, false);
    expect(r.code, r.out).toBe(0);
    const doc = yaml.load(readFileSync(path.join(k.dir, 'docker-compose.yml'), 'utf8'));
    expect(doc.services.https).toBeUndefined();
    expect(doc.services.gateway.ports).toEqual(['172.17.0.1:3100:8080']);
    const route = readFileSync(path.join(k.root, 'proxy', 'dynamic', 'takatak-screens-ecrans-on2go-ca.yml'), 'utf8');
    const conf = yaml.load(route);
    expect(conf.http.routers['takatak-screens-ecrans-on2go-ca']).toMatchObject({ rule: 'Host(`ecrans.on2go.ca`)', entryPoints: ['https'], tls: { certResolver: 'letsencrypt' } });
    expect(conf.http.routers['takatak-screens-ecrans-on2go-ca-http']).toMatchObject({ entryPoints: ['http'], middlewares: ['takatak-screens-ecrans-on2go-ca-https'] });
    expect(conf.http.services['takatak-screens-ecrans-on2go-ca'].loadBalancer.servers).toEqual([{ url: 'http://172.17.0.1:3100' }]);
    expect(r.out).toContain('La passerelle répond');
  });

  it('refuses bad options and a missing or short token, before writing anything', () => {
    for (const args of [['--screens', '20'], ['--only', '19-36'], ['--domain', 'https://ecrans.on2go.ca'], ['--foodhub', 'http://x.ca'], ['--nope']]) {
      const k = kit();
      const r = run(k, args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(existsSync(path.join(k.dir, '.env'))).toBe(false);
    }
    const k = kit();
    const r = run(k, [], { FOODHUB_SCREENS_AGENT_TOKEN: 'short' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/24/);
    expect(existsSync(path.join(k.dir, '.env'))).toBe(false);
  });
});
