// Which delivery platform a Clover label names (order type, tender, title, note). Pure: shared by the live Clover
// import (clover-platform-orders.ts) and the offline finance report, which must not count platform orders that
// Food Hub / UrbanPiper recorded in Clover as in-store sales.
import type { ChannelKey } from '../types';

// Order types and tenders are labels the merchant set up for a platform: short forms ("Uber", "Skip") are safe there.
const PLATFORM_PATTERNS: Array<[ChannelKey, RegExp]> = [
  ['doordash', /door\s*dash/i],
  ['uber_eats', /uber\s*eats|\buber\b/i],
  ['skip', /skip\s*the\s*dishes|\bskip\b/i],
  ['tgtg', /too\s*good\s*to\s*go|\btgtg\b/i],
];
// Titles and notes are free text typed at the register ("skip the pickles", a customer named Uber): full names only.
const FREE_TEXT_PATTERNS: Array<[ChannelKey, RegExp]> = [
  ['doordash', /door\s*dash/i],
  ['uber_eats', /uber\s*eats/i],
  ['skip', /skip\s*the\s*dishes/i],
  ['tgtg', /too\s*good\s*to\s*go/i],
];

/** Which platform a label names, if any ("DoorDash", "UBER EATS", "SkipTheDishes"…). `freeText` = an order title or note. */
export function platformFromLabel(label: unknown, freeText = false): ChannelKey | null {
  const s = String(label ?? '').trim();
  if (!s) return null;
  for (const [ch, re] of freeText ? FREE_TEXT_PATTERNS : PLATFORM_PATTERNS) if (re.test(s)) return ch;
  return null;
}

/** True when a tender label is a delivery platform (those payments are never in-store sales). */
export function isPlatformTender(label: unknown): boolean {
  return platformFromLabel(label) !== null;
}
