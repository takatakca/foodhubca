import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests import route handlers that use the "@/…" alias from tsconfig.json.
// The first dynamic import of a route module can take several seconds on a cold Windows run with every file in
// parallel: 20 s keeps that from failing a test that passes in a fraction of a second on its own.
// An .mts file: Vite loads it as an ES module (a .ts file with `import` was loaded as CommonJS, with a warning).
export default defineConfig({
  resolve: { alias: { '@': path.dirname(fileURLToPath(import.meta.url)) } },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,mjs}'], exclude: ['**/node_modules/**', 'apps/**'], testTimeout: 20_000 },
});
