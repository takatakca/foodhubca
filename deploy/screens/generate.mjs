#!/usr/bin/env node
// Usage (on the relay host, in deploy/screens):  node generate.mjs [screens.json] [--only s01-s18] [--out docker-compose.yml] [--env .env.example]
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
const r = generate(input, { source, androidImage });
if ('errors' in r) { console.error(`${source} is refused:`); for (const e of r.errors) console.error(`  - ${e}`); process.exit(1); }
writeFileSync(out, r.yaml);
writeFileSync(envOut, r.env);
console.log(`${out}: ${r.counts.web} web screen(s), ${r.counts.android} Android screen(s). .env names in ${envOut}.`);
for (const s of r.screens) console.log(`  ${s.name} (${s.platform}, ${s.mode})`);
