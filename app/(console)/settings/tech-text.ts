// Owner-facing copy rule (premium A3): setting names (SESSION_SECRET, FOODHUB_*), commands (npm run setup) and SQL files
// belong to the technician. These helpers let a screen keep a plain headline and fold the technical text away.

/** An environment-style name (two or more upper-case words joined by "_"), a command, a SQL file or a docs path. */
const TECH = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\bnpm run\b|\b[\w-]+\.sql\b|\bdocs\/[\w./-]+/;

export function hasTech(text: string | null | undefined): boolean {
  return Boolean(text && TECH.test(text));
}

/**
 * Splits a text into its plain sentences (shown to the owner) and the sentences carrying a setting name or a command
 * (folded for the technician). "Brouillons à faire relire. Manque : FOODHUB_SUPPORT_EMAIL" keeps the owner's task in
 * view; a text that is all technical gives an empty `plain`.
 */
export function splitTech(text: string | null | undefined): { plain: string; tech: string } {
  const sentences = String(text ?? '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return {
    plain: sentences.filter((s) => !hasTech(s)).join(' '),
    tech: sentences.filter((s) => hasTech(s)).join(' '),
  };
}

/** "Session secret (SESSION_SECRET)" → "Session secret": a title never carries a setting name. */
export function plainTitle(title: string): string {
  return title.replace(/\s*\((?:[A-Z][A-Z0-9]*_[A-Z0-9_]+(?:\s*[,+/]\s*)?)+\)/g, '').trim();
}
