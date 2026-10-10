// Finance A–Z analysis on normalized lines: dedupe across overlapping exports, order counts, which lines feed the
// P&L, payout batches vs bank deposits, the refunds / error-charge register and money still held by a platform.
import { PLATFORM_LABEL, r2, type BankLine, type FinanceLine, type PayoutRecord, type Platform } from './model';

const DAY = 86400_000;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / DAY);

export interface Params {
  /** Days a platform has to pay an order before the money counts as "held / not paid". */
  unpaidAfterDays: number;
  /** Bank deposit accepted from N days before to M days after the statement payout date. */
  bankWindow: [number, number];
  /** Amount tolerance when matching a payout to a bank deposit ($). */
  tolerance: number;
  /** Days to dispute an error charge / refund, per platform (from the Rules tab). */
  disputeDays: Record<Platform, number>;
  asOf: string;
}

/** Drops lines that two overlapping exports both contain (same stable key), keeping the first file's copy. */
export function dedupe<T extends { key: string }>(lines: T[]): { kept: T[]; duplicates: number } {
  const seen = new Set<string>(); const kept: T[] = [];
  for (const l of lines) { if (seen.has(l.key)) continue; seen.add(l.key); kept.push(l); }
  return { kept, duplicates: lines.length - kept.length };
}

/**
 * - Summary lines (payout totals) feed the P&L only for a platform-month without any detail line.
 * - Each distinct order is counted once (orderCount = 1 on its first line); cancelled orders likewise.
 */
export function finalize(lines: FinanceLine[]): FinanceLine[] {
  const detailMonths = new Set(lines.filter((l) => l.level === 'detail' && l.type !== 'payout').map((l) => `${l.platform}|${l.month}`));
  for (const l of lines) {
    if (l.level === 'reference') { l.inPnl = false; continue; }
    if (l.level === 'summary') {
      l.inPnl = l.type !== 'payout' ? !detailMonths.has(`${l.platform}|${l.month}`) : false;
      // A payout summary with a breakdown can stand in for missing detail (sales, fees…), never the transfer itself.
      if (l.type === 'payout' && !detailMonths.has(`${l.platform}|${l.month}`) && (l.itemSales || l.commission)) {
        l.inPnl = true; l.notes.push('No per-order export for this month: P&L uses the payout summary');
      }
    }
  }
  const sorted = [...lines].sort((a, b) => a.platform.localeCompare(b.platform) || (a.orderDate ?? a.payoutDate ?? '').localeCompare(b.orderDate ?? b.payoutDate ?? '') || a.source.localeCompare(b.source) || a.row - b.row);
  const counted = new Set<string>(); const cancelled = new Set<string>();
  for (const l of sorted) {
    if (!l.inPnl || l.level !== 'detail') continue;
    const ref = l.orderRef || l.orderRef2;
    if (!ref || !['order', 'cancellation', 'refund'].includes(l.type)) continue;
    const k = `${l.platform}|${ref.toLowerCase()}`;
    // A later refund / error line on the same order is not a new order.
    if (l.type !== 'refund' && !counted.has(k)) { counted.add(k); l.orderCount = 1; }
    if ((l.type === 'cancellation' || l.status === 'cancelled') && !cancelled.has(k)) { cancelled.add(k); l.cancelledCount = 1; }
  }
  return sorted;
}

// ---------------------------------------------------------------- payouts × bank

export function payoutRecords(lines: FinanceLine[]): PayoutRecord[] {
  const recs = new Map<string, PayoutRecord>();
  const keyOf = (l: FinanceLine) => `${l.platform}|${l.payoutRef || (l.payoutDate ?? '').slice(0, 10) || 'unpaid'}|${l.platform === 'doordash' && !l.payoutRef ? l.storeId || l.storeName : ''}`;
  for (const l of lines) {
    if (l.platform === 'clover' && l.level === 'detail') continue; // Clover card batches come from the deposits file
    const payoutSummary = l.level === 'summary' && l.type === 'payout';
    const detail = l.level === 'detail' && l.type !== 'payout' && l.type !== 'platform_in_clover';
    if (!payoutSummary && !detail) continue; // statement totals and reference lines are not payouts
    const k = keyOf(l);
    const rec = recs.get(k) ?? {
      key: k, platform: l.platform, payoutRef: l.payoutRef, payoutDate: l.payoutDate, storeId: l.storeId, storeName: l.storeName, brand: l.brand, location: l.location,
      linesNet: null, lines: 0, summaryAmount: null, status: '', account: '', amount: 0, bank: null, gap: null, match: 'bank_not_loaded' as PayoutRecord['match'],
    };
    if (l.level === 'summary' && l.type === 'payout') {
      rec.summaryAmount = r2((rec.summaryAmount ?? 0) + l.net);
      rec.status = rec.status || l.status;
      rec.account = rec.account || l.tender;
    } else if (l.level === 'detail' && l.type !== 'payout') {
      rec.linesNet = r2((rec.linesNet ?? 0) + l.net);
      rec.lines++;
      // Uber prints the payout status on every order line ("Paid", "Pending", "Rejected by Bank"): the worst one wins.
      if (l.payoutStatus && (!rec.status || /reject|fail|return/i.test(l.payoutStatus))) rec.status = l.payoutStatus;
    }
    if (rec.storeName !== l.storeName && l.storeName) rec.storeName = rec.storeName ? 'several stores' : l.storeName;
    if (rec.brand !== l.brand) rec.brand = rec.brand && rec.brand !== l.brand ? 'several' : l.brand;
    if (rec.location !== l.location) rec.location = rec.location && rec.location !== l.location ? 'several' : l.location;
    if (!rec.payoutDate && l.payoutDate) rec.payoutDate = l.payoutDate;
    recs.set(k, rec);
  }
  for (const r of recs.values()) {
    r.amount = r.summaryAmount ?? r.linesNet ?? 0;
    if (!r.payoutDate && !r.payoutRef) r.match = 'unpaid';
    if (/ongoing|pending/i.test(r.status) && !r.payoutDate) r.match = 'unpaid';
    if (/fail|return|hold|held|bounce|reject|cancel|no payout/i.test(r.status)) r.match = 'failed';
  }
  return [...recs.values()].sort((a, b) => a.platform.localeCompare(b.platform) || (a.payoutDate ?? '9999').localeCompare(b.payoutDate ?? '9999'));
}

/** Greedy match: same platform (when the bank description names it), amount within tolerance, date inside the window; closest date wins. */
export function matchBank(recs: PayoutRecord[], bank: BankLine[], p: Params): { unmatchedBank: BankLine[] } {
  const deposits = bank.filter((b) => b.amount > 0 && b.date);
  const used = new Set<string>();
  const bankFrom = deposits.map((b) => b.date!).sort()[0];
  const bankTo = deposits.map((b) => b.date!).sort().pop();
  for (const r of recs) {
    if (r.match === 'unpaid' || r.match === 'failed' || !r.payoutDate || !(r.amount > 0)) continue;
    // Not loaded = the whole matching window falls outside the bank statements' dates.
    if (!bankFrom || !bankTo || dayDiff(bankFrom, r.payoutDate) > p.bankWindow[1] || dayDiff(bankTo, r.payoutDate) < p.bankWindow[0]) { r.match = 'bank_not_loaded'; continue; }
    const cands = deposits.filter((b) => !used.has(b.key) && (!b.platformGuess || b.platformGuess === r.platform)
      && dayDiff(b.date!, r.payoutDate!) >= p.bankWindow[0] && dayDiff(b.date!, r.payoutDate!) <= p.bankWindow[1]);
    const exact = cands.filter((b) => Math.abs(b.amount - r.amount) <= p.tolerance).sort((a, b) => Math.abs(dayDiff(a.date!, r.payoutDate!)) - Math.abs(dayDiff(b.date!, r.payoutDate!)) || (a.platformGuess ? -1 : 1));
    const hit = exact[0];
    if (hit) {
      used.add(hit.key);
      r.bank = { date: hit.date, amount: hit.amount, description: hit.description, account: hit.account, key: hit.key };
      r.gap = r2(hit.amount - r.amount); r.match = 'matched';
      continue;
    }
    // No exact amount: a deposit that names the same platform in the window is shown as "amount differs" (not consumed).
    const near = cands.filter((b) => b.platformGuess === r.platform).sort((a, b) => Math.abs(a.amount - r.amount) - Math.abs(b.amount - r.amount))[0];
    if (near) { r.bank = { date: near.date, amount: near.amount, description: near.description, account: near.account, key: near.key }; r.gap = r2(near.amount - r.amount); r.match = 'amount_differs'; }
    else r.match = 'not_in_bank';
  }
  for (const r of recs) if (r.match === 'amount_differs' && r.bank && used.has(r.bank.key)) { r.bank = null; r.gap = null; r.match = 'not_in_bank'; }
  // Deposits that name a platform but match no payout (missing statement lines, or a different grouping).
  return { unmatchedBank: deposits.filter((b) => !used.has(b.key) && b.platformGuess) };
}

// ---------------------------------------------------------------- disputes / refunds register

export interface DisputeRow {
  key: string; platform: Platform; brand: string; location: string; store: string; orderDate: string | null; orderRef: string;
  kind: string; amount: number; description: string; windowDays: number; deadline: string | null; daysLeft: number | null; source: string;
  /** Status already known (portal scan: "open", "reversed …"). */
  defaultStatus: string;
}

export function disputeRows(lines: FinanceLine[], p: Params): DisputeRow[] {
  const out: DisputeRow[] = [];
  for (const l of lines) {
    const ref = l.level === 'reference' && (l.type === 'error_charge' || l.type === 'cancellation');
    // Order-level lines only: a monthly statement total is not something to dispute line by line.
    if ((!l.inPnl && !ref) || l.level === 'summary' || (l.platform === 'clover' && l.type !== 'refund')) continue;
    const charge = r2(l.errorCharges + l.refunds + Math.min(0, l.adjustments));
    const credit = r2(Math.max(0, l.adjustments) + Math.max(0, l.errorCharges) + Math.max(0, l.refunds));
    const cancelled = l.type === 'cancellation' || l.status === 'cancelled';
    if (!charge && !cancelled && !(credit && (l.type === 'error_charge' || l.type === 'adjustment'))) continue;
    const kind = cancelled ? 'Cancelled order' : l.errorCharges < 0 ? 'Error charge' : l.refunds < 0 ? 'Refund charged to you' : charge < 0 ? 'Negative adjustment' : 'Credit / reversal (dispute won?)';
    const windowDays = p.disputeDays[l.platform] ?? 0;
    const base = l.orderDate ?? l.payoutDate;
    const deadline = base && windowDays ? new Date(Date.parse(`${base.slice(0, 10)}T00:00:00Z`) + windowDays * DAY).toISOString().slice(0, 10) : null;
    out.push({
      key: l.key, platform: l.platform, brand: l.brand, location: l.location, store: l.storeName || l.storeId, orderDate: base, orderRef: l.orderRef || l.orderRef2,
      kind, amount: charge || (cancelled ? l.net : credit), description: l.description, windowDays, deadline, daysLeft: deadline ? dayDiff(deadline, p.asOf) : null, source: `${l.source}#${l.row}`,
      defaultStatus: !ref ? '' : /revers|credit/i.test(l.status) ? 'Won' : /open/i.test(l.status) ? 'To review' : '',
    });
  }
  return out.sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
}

// ---------------------------------------------------------------- money held

export interface HeldRow {
  id: string; platform: string; where: string; what: string; amount: number | null; since: string | null; evidence: string; action: string; who: string;
}

/** Statement money not (yet) received: lines with no payout past the delay, failed payouts, payouts absent from the bank. */
export function heldFromData(lines: FinanceLine[], recs: PayoutRecord[], p: Params): HeldRow[] {
  const out: HeldRow[] = [];
  const unpaid = new Map<string, { amount: number; since: string; lines: number; store: string; platform: Platform }>();
  for (const l of lines) {
    if (!l.inPnl || l.level !== 'detail' || l.platform === 'clover' || l.payoutDate || l.payoutRef) continue;
    const d = l.orderDate; if (!d || dayDiff(p.asOf, d) < p.unpaidAfterDays) continue;
    const k = `${l.platform}|${l.storeName || l.storeId}`;
    const u = unpaid.get(k) ?? { amount: 0, since: d, lines: 0, store: l.storeName || l.storeId, platform: l.platform };
    u.amount = r2(u.amount + l.net); u.lines++; if (d < u.since) u.since = d;
    unpaid.set(k, u);
  }
  for (const [k, u] of unpaid) {
    if (Math.abs(u.amount) < 0.01) continue;
    out.push({ id: `unpaid:${k}`, platform: PLATFORM_LABEL[u.platform], where: u.store || '(store not named)', what: `${u.lines} statement line(s) older than ${p.unpaidAfterDays} days with no payout date/reference`, amount: u.amount, since: u.since, evidence: 'Statement export (no payout date)', action: 'Check the platform Payouts page; if on hold, fix bank details / verification and ask support to release', who: 'Owner' });
  }
  for (const r of recs) {
    if (r.match === 'failed') out.push({ id: `failed:${r.key}`, platform: PLATFORM_LABEL[r.platform], where: r.storeName || r.storeId || r.account, what: `Payout ${r.payoutRef || r.payoutDate} status "${r.status}"`, amount: r.amount, since: r.payoutDate, evidence: 'Payout summary export', action: 'Update / verify bank account, then ask the platform to re-send the payout', who: 'Owner' });
    if (r.match === 'amount_differs' && r.gap !== null && r.gap < 0) out.push({ id: `short:${r.key}`, platform: PLATFORM_LABEL[r.platform], where: r.storeName || r.storeId || r.account, what: `Payout ${r.payoutRef || r.payoutDate}: bank deposit ${r.bank?.amount.toFixed(2)} is ${(-r.gap).toFixed(2)} less than the statement (${r.amount.toFixed(2)})`, amount: -r.gap, since: r.payoutDate, evidence: 'Statement payout vs bank CSV', action: 'Check whether two payouts were combined or a deduction was taken after the statement; ask the platform for the payout breakdown', who: 'Owner' });
    if (r.match === 'not_in_bank') out.push({ id: `nobank:${r.key}`, platform: PLATFORM_LABEL[r.platform], where: r.storeName || r.storeId || r.account, what: `Payout ${r.payoutRef || r.payoutDate} (${r.amount.toFixed(2)}) not found in the bank statements loaded`, amount: r.amount, since: r.payoutDate, evidence: 'Statement payout vs bank CSV', action: 'Check which bank account the platform paid (last 4 on the payout); ask the platform for the trace if it never arrived', who: 'Owner' });
  }
  return out;
}
