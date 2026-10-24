// Money for MEV receipts: integer cents only, each tax rounded half-up on its own (the way Clover's Hosted Checkout
// rounds, pos/clover-checkout.ts hcoTaxCents): TPS = round(base × 5 %), TVQ = round(base × 9.975 %),
// apresTax = avantTax + TPS + TVQ exactly. Integer arithmetic: 0.5 cent never drifts with floating point.
import { splitQuebecTax } from '../finance/model';
import type { MevTaxCode } from './types';

/** Dollars (Food Hub's order amounts) → whole cents. */
export function cents(dollars: number | null | undefined): number {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** round(n / d) with halves away from zero, for integers (d > 0). */
export function roundHalfUpDiv(n: number, d: number): number {
  const sign = n < 0 ? -1 : 1;
  const a = Math.abs(n);
  return sign * Math.floor((2 * a + d) / (2 * d));
}

/** GST 5 % and QST 9.975 % of a taxable base, each rounded on its own. Negative bases (credit notes) mirror. */
export function quebecTaxCents(baseCents: number): { gstCents: number; qstCents: number } {
  return { gstCents: roundHalfUpDiv(baseCents * 5, 100), qstCents: roundHalfUpDiv(baseCents * 9975, 100_000) };
}

/** GST / QST of the lines by tax code: FP = both, F = GST only, P = QST only, NON = none. */
export function taxByCode(parts: Array<{ cents: number; taxCode: MevTaxCode }>): { gstBase: number; qstBase: number; gstCents: number; qstCents: number } {
  const gstBase = parts.filter((p) => p.taxCode === 'FP' || p.taxCode === 'F').reduce((s, p) => s + p.cents, 0);
  const qstBase = parts.filter((p) => p.taxCode === 'FP' || p.taxCode === 'P').reduce((s, p) => s + p.cents, 0);
  return { gstBase, qstBase, gstCents: quebecTaxCents(gstBase).gstCents, qstCents: quebecTaxCents(qstBase).qstCents };
}

/**
 * A platform charges one combined tax: Food Hub computes the split from the base. When that differs from the
 * platform's own tax by more than 1 cent, the platform's tax is split instead (finance/model.ts splitQuebecTax) and
 * flagged taxGap, so the receipt matches what the customer was charged.
 */
export function reconcileTax(computed: { gstCents: number; qstCents: number }, platformTaxCents: number | null): { gstCents: number; qstCents: number; taxGap: boolean } {
  if (platformTaxCents === null || !Number.isFinite(platformTaxCents)) return { ...computed, taxGap: false };
  if (Math.abs(computed.gstCents + computed.qstCents - platformTaxCents) <= 1) return { ...computed, taxGap: false };
  const split = splitQuebecTax(platformTaxCents / 100);
  const gstCents = Math.round(split.gst * 100);
  return { gstCents, qstCents: platformTaxCents - gstCents, taxGap: true };
}

/** "2", "0.5", "1.25": a quantity as the decimal string MEV-WEB expects (at most 3 decimals). */
export function qty(n: number): string {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  return String(v);
}
