import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'supabase/**', 'next-env.d.ts', 'scripts/**'],
  },
  {
    rules: {
      // Platform payloads are untyped JSON: `any` is used deliberately at those edges.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // Loading data on mount / when filters change is the intended pattern in this console.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
