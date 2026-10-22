// Owner-facing copy rule (premium A3): setting names (SESSION_SECRET, FOODHUB_*), commands (npm run setup) and SQL files
// belong to the technician. These helpers let a screen keep a plain headline and fold the technical text away.

/** An environment-style name (two or more upper-case words joined by "_"), a command, a SQL file or a docs path. */
const TECH = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\bnpm run\b|\b[\w-]+\.sql\b|\bdocs\/[\w./-]+/;

export function hasTech(text: string | null | undefined): boolean {
  return Boolean(text && TECH.test(text));
}

/** "Session secret (SESSION_SECRET)" → "Session secret": a title never carries a setting name. */
export function plainTitle(title: string): string {
  return title.replace(/\s*\((?:[A-Z][A-Z0-9]*_[A-Z0-9_]+(?:\s*[,+/]\s*)?)+\)/g, '').trim();
}
