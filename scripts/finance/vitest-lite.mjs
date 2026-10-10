// Minimal stand-in for `vitest` (describe / it / expect with the matchers the finance tests use), so
// `node --import ./scripts/finance/register.mjs tests/finance.test.ts` runs them where `npm ci` has not been run.
// CI runs the same file with the real vitest.
import assert from 'node:assert/strict';

const queue = [];
const prefix = [];
let failures = 0; let passed = 0;

export function describe(name, fn) { prefix.push(name); fn(); prefix.pop(); }
export function it(name, fn) { queue.push({ name: [...prefix, name].join(' › '), fn }); }
export const test = it;

function matchers(actual, negate = false) {
  const check = (ok, msg) => { if (negate ? ok : !ok) throw new assert.AssertionError({ message: negate ? `not: ${msg}` : msg }); };
  const m = {
    toBe: (e) => check(Object.is(actual, e), `expected ${JSON.stringify(actual)} to be ${JSON.stringify(e)}`),
    toEqual: (e) => { let ok = true; try { assert.deepStrictEqual(actual, e); } catch { ok = false; } check(ok, `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(e)}`); },
    toBeCloseTo: (e, digits = 2) => check(Math.abs(actual - e) < 10 ** -digits / 2, `expected ${actual} to be close to ${e}`),
    toBeNull: () => check(actual === null, `expected ${JSON.stringify(actual)} to be null`),
    toBeTruthy: () => check(Boolean(actual), `expected ${JSON.stringify(actual)} to be truthy`),
    toBeFalsy: () => check(!actual, `expected ${JSON.stringify(actual)} to be falsy`),
    toContain: (e) => check(actual.includes(e), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(e)}`),
    toHaveLength: (n) => check(actual.length === n, `expected length ${actual.length} to be ${n}`),
    toBeGreaterThan: (n) => check(actual > n, `expected ${actual} > ${n}`),
    toMatch: (re) => check(re.test(actual), `expected ${JSON.stringify(actual)} to match ${re}`),
  };
  return m;
}
export function expect(actual) { const m = matchers(actual); m.not = matchers(actual, true); return m; }

setTimeout(async () => {
  for (const t of queue) {
    try { await t.fn(); passed++; console.log(`  ✓ ${t.name}`); } catch (e) { failures++; console.log(`  ✗ ${t.name}\n    ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
}, 0);
