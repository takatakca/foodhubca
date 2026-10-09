import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests import route handlers that use the "@/…" alias from tsconfig.json.
// The first dynamic import of a route module can take several seconds on a cold Windows run with every file in
// parallel: 20 s keeps that from failing a test that passes in a fraction of a second on its own.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 20_000 },
});
