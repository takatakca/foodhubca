// ESLint flat config (Next.js 16 removed `next lint`; run `npm run lint` → `eslint .`).
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**', 'public/sw.js']),
  {
    rules: {
      // Platform API payloads (Uber Eats, DoorDash, JET Connect, Clover) are typed loosely at the edges;
      // tightening them is tracked as follow-up work, so this stays a warning rather than a release blocker.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Dashboard screens reset local state synchronously inside effects (filters, pagination); harmless
      // here, flagged as a warning so new code is nudged toward derived state.
      'react-hooks/set-state-in-effect': 'warn',
      // Menu photos are operator-supplied external URLs; next/image would need a remotePatterns allow-list
      // per platform CDN, so the plain <img> is intentional.
      '@next/next/no-img-element': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
]);
