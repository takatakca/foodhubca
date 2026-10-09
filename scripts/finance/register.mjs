// Lets `node --import ./scripts/finance/register.mjs scripts/finance-report.ts` (and tests/finance.test.ts) run the
// repo's TypeScript directly (Node ≥ 22.18 strips types): resolves "@/…" and extensionless imports to .ts files, and
// falls back to small stand-ins for `fflate` and `vitest` when node_modules is not installed.
import { register } from 'node:module';

register('./resolve-hook.mjs', import.meta.url);
