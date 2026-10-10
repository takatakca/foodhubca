import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tsFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep) && path.extname(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  const fallback = { fflate: 'fflate-shim.mjs', vitest: 'vitest-lite.mjs' }[specifier];
  if (fallback) {
    try { return await next(specifier, context); } catch { return { url: pathToFileURL(path.join(ROOT, 'scripts', 'finance', fallback)).href, shortCircuit: true }; }
  }
  let base = null;
  if (specifier.startsWith('@/')) base = path.join(ROOT, specifier.slice(2));
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:') && !path.extname(specifier)) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const file = tsFile(base);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return next(specifier, context);
}
