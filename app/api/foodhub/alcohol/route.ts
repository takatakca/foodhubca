import { approvalGate, withPerm } from '@/lib/foodhub/auth';
import { ALCOHOL_CHANNELS, ALCOHOL_CHANNEL_LABELS, alcoholDecision, getAlcoholSettings, PERMIT_HOURS, saveLocationAlcohol } from '@/lib/foodhub/alcohol/rules';
import { getCatalog } from '@/lib/foodhub/catalog';
import { featureOn } from '@/lib/foodhub/expansion/features';
import { fail, ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

async function view() {
  const [settings, on, catalog] = await Promise.all([getAlcoholSettings(), featureOn('alcohol'), getCatalog()]);
  const locations = catalog.locations.filter((l) => l.active);
  // What is allowed right now, per location × channel (the same decision every channel uses).
  const now = locations.map((l) => ({
    locationCode: l.code,
    channels: Object.fromEntries(ALCOHOL_CHANNELS.map((c) => {
      const d = alcoholDecision(settings, on, l.code, c);
      return [c, { allowed: d.allowed, reason: d.reason, reasonFr: d.reasonFr }];
    })),
  }));
  return { on, settings, now, channels: ALCOHOL_CHANNELS.map((c) => ({ key: c, ...ALCOHOL_CHANNEL_LABELS[c] })), permitHours: PERMIT_HOURS };
}

// Alcohol permits and channels per location. Read: anyone; change: owner only (a legal matter), confirmed with a PIN rule.
export const GET = withPerm('view', async () => ok(await view()));

export const PUT = withPerm('admin', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const code = String(b.locationCode ?? '');
  if (!/^[A-Z0-9_]{2,30}$/.test(code)) return fail('Choose a location.');
  const gate = await approvalGate(req, actor, 'team.manage', code, 'alcohol permit and channels');
  if (gate) return gate;
  const r = await saveLocationAlcohol(code, b.patch ?? {}, actor);
  return ok({ ...(await view()), warning: r.warning ?? null });
});
