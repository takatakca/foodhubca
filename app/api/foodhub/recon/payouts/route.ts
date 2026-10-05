import { approvalGate } from '@/lib/foodhub/auth';
import { isChannelKey } from '@/lib/foodhub/adapters';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { payoutBatches, recordDeposit } from '@/lib/foodhub/recon/engine';
import { withFinance } from '@/lib/foodhub/recon/http';
import { parseRange } from '@/lib/foodhub/report-filter';
import type { ChannelKey } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';

export const GET = withFinance('analytics:view', async (req) => {
  const q = new URL(req.url).searchParams;
  const channels = (q.get('channels') || '').split(',').filter(isChannelKey) as ChannelKey[];
  return ok({ payouts: await payoutBatches({ ...parseRange(q, 90), channels }) });
});

// Bank deposit for one payout: { key, amount, date, note? }
export const POST = withFinance('finance:edit', async (req, _ctx, actor) => {
  const gate = await approvalGate(req, actor, 'money.edit');
  if (gate) return gate;
  const b = await readJson(req);
  if (!b.key) return fail('key is required');
  await recordDeposit(String(b.key), { amount: Number(b.amount), date: String(b.date || ''), note: b.note ? String(b.note) : undefined }, actor);
  return ok();
});
