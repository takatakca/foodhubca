import { approvalGate } from '@/lib/foodhub/auth';
import { logActivity } from '@/lib/foodhub/activity';
import { ok, readJson } from '@/lib/foodhub/http';
import { getFees, PLAN_NOTES, PLAN_NOTES_FR, PLAN_PRESETS, saveFees } from '@/lib/foodhub/recon/fees';
import { refreshCases } from '@/lib/foodhub/recon/automation';
import { withFinance } from '@/lib/foodhub/recon/http';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

export const GET = withFinance('analytics:view', async () => ok({
  fees: await getFees(), presets: PLAN_PRESETS, notes: PLAN_NOTES, notesFr: PLAN_NOTES_FR,
  stores: (await getRepo().listStores()).map((s) => ({ id: s.id, channel: s.channel, brandName: s.brandName, locationCode: s.locationCode, channelStoreId: s.channelStoreId })),
}));

export const PUT = withFinance('finance:edit', async (req, _ctx, actor) => {
  const gate = await approvalGate(req, actor, 'money.edit');
  if (gate) return gate;
  const b = await readJson(req);
  const fees = await saveFees(b.fees ?? {});
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'fees_saved', status: 'success',
    summary: `Commission plans saved: ${Object.entries(fees.channels).map(([ch, p]) => `${ch} ${p.plan} ${p.deliveryPct}%/${p.pickupPct}%${fees.confirmed[ch as keyof typeof fees.confirmed] ? ' ✓' : ''}`).join(', ')}` });
  const cases = await refreshCases(90, actor).catch(() => null);
  return ok({ fees, cases });
});
