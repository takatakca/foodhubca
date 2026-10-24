import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { mevMode, setSevOfRecord } from '@/lib/foodhub/mev/config';
import { mevHealth, runMevOutbox } from '@/lib/foodhub/mev/outbox';
import { mevStatus } from '@/lib/foodhub/mev/status';
import type { SevOfRecord } from '@/lib/foodhub/mev/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Takatak MEV (QCMEV) status for Settings → Expansion → MEV: switches, kitchens, last /health, outbox counts.
// Env key names and states only, never a secret.
export const GET = withPerm('view', async () => ok(await mevStatus()));

// Owner: which system issues the invoice for one kitchen. { locationCode, sevOfRecord: none | qcmev | clover_app }
export const PUT = withPerm('admin', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const sev = String(b.sevOfRecord ?? '') as SevOfRecord;
  if (!['none', 'qcmev', 'clover_app'].includes(sev)) return fail('sevOfRecord must be none, qcmev or clover_app.');
  await setSevOfRecord(String(b.locationCode ?? ''), sev, actor);
  return ok(await mevStatus());
});

// Owner: { action: "health" } asks QCMEV now; { action: "run" } sends what is due now (the timer does it every 30 s).
export const POST = withPerm('admin', async (req) => {
  const b = await readJson(req);
  if (mevMode() === 'off') return fail('MEV is off on this server (FOODHUB_MEV).', 409);
  if (b.action === 'health') {
    await mevHealth({ force: true });
    return ok(await mevStatus());
  }
  if (b.action === 'run') return ok({ run: await runMevOutbox({ trigger: 'manual' }), ...(await mevStatus()) });
  return fail('action must be health or run.');
});
