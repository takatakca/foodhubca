// Which Revenu Québec document an 80 mm ticket may print (pure: shared by the ticket pages and the server claim).
//
// Revenu Québec, « Modes d'impression » (Important): an invoice or a credit note is printed or sent ONCE; any other copy
// is a reproduction (RPR) or a merchant copy (DUP) made by the certified SEV. So each document has a key and is printed
// once (lib/foodhub/mev/print-claim.ts); a second copy is asked from Takatak MEV with « Réimprimer (RPR) ».
import type { MevRecord } from './types';

export type PrintCopy = 'FAC' | 'RPR' | 'DUP';

export function copyOf(v: string | null | undefined): PrintCopy {
  return v === 'RPR' || v === 'DUP' ? v : 'FAC';
}

/** The document a ticket would print: the original of the current receipt, or the newest RPR / DUP of it. */
export function printableDoc(mev: MevRecord | null | undefined, copy: PrintCopy): { key: string; lines: string[]; qrImage?: string } | null {
  if (!mev) return null;
  if (copy === 'FAC') {
    if (!(mev.status === 'accepted' || mev.status === 'offline') || !mev.text80mm?.length) return null;
    // Electronic only (ELE) or not printed (NON): there is no paper original.
    if (mev.format === 'ELE' || mev.format === 'NON') return null;
    return { key: mev.saleKey, lines: mev.text80mm, ...(mev.qrImage ? { qrImage: mev.qrImage } : {}) };
  }
  const p = [...(mev.prints ?? [])].reverse().find((x) => x.mode === copy && (x.status === 'accepted' || x.status === 'offline') && x.text80mm?.length);
  return p ? { key: p.printKey, lines: p.text80mm as string[], ...(p.qrImage ? { qrImage: p.qrImage } : {}) } : null;
}

/** When that document was printed already (from the order's record; the server claim is the authority). */
export function printedAt(mev: MevRecord | null | undefined, key: string | null | undefined): string | null {
  return (key && mev?.printed?.[key]) || null;
}
