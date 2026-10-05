import { approvalGate } from '@/lib/foodhub/auth';
import { NextResponse } from 'next/server';
import { isChannelKey } from '@/lib/foodhub/adapters';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { approveEntry, ledger } from '@/lib/foodhub/recon/engine';
import { withFinance } from '@/lib/foodhub/recon/http';
import { parseRange } from '@/lib/foodhub/report-filter';
import { toCsv } from '@/lib/foodhub/reports';
import type { ChannelKey } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';

// Internal ledger (journal entries per payout). ?format=csv for the accountant / QuickBooks import later.
export const GET = withFinance('analytics:view', async (req) => {
  const q = new URL(req.url).searchParams;
  const channels = (q.get('channels') || '').split(',').filter(isChannelKey) as ChannelKey[];
  const entries = await ledger({ ...parseRange(q, 90), channels });
  if (q.get('format') === 'csv') {
    const rows = entries.flatMap((e, i) => e.lines.map((l) => [e.date ?? '', `TK-${String(i + 1).padStart(4, '0')}`, e.memo, l.account, l.debit ? l.debit.toFixed(2) : '', l.credit ? l.credit.toFixed(2) : '', l.memo ?? '', e.status, e.approvedBy ?? '']));
    const csv = toCsv({ key: 'store_actions', title: 'Internal ledger', filename: 'takatak-internal-ledger', columns: ['Date', 'Journal', 'Entry', 'Account', 'Debit', 'Credit', 'Line memo', 'Status', 'Approved by'], rows });
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="takatak-internal-ledger.csv"', 'Cache-Control': 'no-store' } });
  }
  return ok({ entries });
});

// Owner approval of one entry: { key }. Approval only marks the entry as reviewed — nothing is posted anywhere.
export const POST = withFinance('finance:edit', async (req, _ctx, actor) => {
  const gate = await approvalGate(req, actor, 'money.edit');
  if (gate) return gate;
  const b = await readJson(req);
  if (!b.key) return fail('key is required');
  const entries = await ledger({ from: new Date(0).toISOString(), to: new Date(Date.now() + 86400_000 * 400).toISOString() }).catch(() => []);
  const entry = entries.find((e) => e.key === b.key);
  if (!entry) return fail('Entry not found', 404);
  if (!entry.balanced) return fail('This entry does not balance — fix the statement first.', 409);
  await approveEntry(String(b.key), actor);
  return ok();
});
