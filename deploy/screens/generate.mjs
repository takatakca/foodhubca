#!/usr/bin/env node
// Usage (on the relay host, in deploy/screens):  node generate.mjs [screens.json] [--only s01-s18] [--domain ecrans.on2go.ca] [--gateway-host 172.17.0.1] [--out docker-compose.yml] [--env .env.example]
// The easy way is ./setup.sh, which runs this for you.
// Reads the list, refuses anything that carries a sign-in secret, writes the compose file and the .env template.
import { readFileSync, writeFileSync } from 'node:fs';
import { generate, pickRange } from './generate-lib.mjs';

const args = process.argv.slice(2);
const opts = {}; const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i] ?? '';
  else positional.push(args[i]);
}
const source = positional[0] ?? 'screens.json';
const out = opts.out || 'docker-compose.yml';
const envOut = opts.env || '.env.example';
const androidImage = opts['android-image'] || undefined;

let input;
try { input = JSON.parse(readFileSync(source, 'utf8')); } catch (e) { console.error(`Cannot read ${source}: ${e instanceof Error ? e.message : e}`); process.exit(2); }
// --only s19-s36: this host runs that share of the list (several hosts for 54 screens).
if (opts.only) {
  const picked = pickRange(input, opts.only);
  if (!picked) { console.error(`--only must look like s01-s18 (got "${opts.only}").`); process.exit(2); }
  input = picked;
}
// --domain ecrans.on2go.ca: add the built-in https front (Caddy) for that name.
// --gateway-host 172.17.0.1: the gateway listens on the Docker bridge so Coolify's Traefik can reach it (setup.sh).
const r = generate(input, { source, androidImage, domain: opts.domain || undefined, gatewayHost: opts['gateway-host'] || undefined });
if ('errors' in r) { console.error(`${source} is refused:`); for (const e of r.errors) console.error(`  - ${e}`); process.exit(1); }
writeFileSync(out, r.yaml);
writeFileSync(envOut, r.env);
console.log(`${out}: ${r.counts.web} web screen(s), ${r.counts.android} Android screen(s)${opts.domain && r.counts.web ? `, https://${opts.domain.toLowerCase()}/` : ''}. .env names in ${envOut}.`);
for (const s of r.screens) console.log(`  ${s.name} (${s.platform}, ${s.mode})`);
