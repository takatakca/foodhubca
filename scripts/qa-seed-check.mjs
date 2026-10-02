import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const locations = JSON.parse(fs.readFileSync(path.join(root, 'data/actual/locations.json'), 'utf8'));
const brands = JSON.parse(fs.readFileSync(path.join(root, 'data/actual/brands.json'), 'utf8'));
const stores = JSON.parse(fs.readFileSync(path.join(root, 'data/actual/platform-stores-doordash.json'), 'utf8'));
const checks = [
  ['locations >= 4', locations.length >= 4],
  ['brands >= 18', brands.length >= 18],
  ['DoorDash stores present', stores.length > 0],
  ['has active closed Z stores', stores.some(s => s.status_symbol === 'Z' && s.activation_status === 'active' && s.open_status === 'closed')],
  ['has deactivated stores', stores.some(s => s.activation_status === 'deactivated')]
];
let failed = false;
for (const [name, pass] of checks) {
  console.log(`${pass ? '✅' : '❌'} ${name}`);
  if (!pass) failed = true;
}
if (failed) process.exit(1);
console.log('Seed QA passed.');
