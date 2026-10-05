import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests import route handlers that use the "@/…" alias from tsconfig.json.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
