import { NextResponse } from 'next/server';
import { withPerm } from '@/lib/foodhub/auth';
import { fail } from '@/lib/foodhub/http';
import { sendCloverTestOrder } from '@/lib/foodhub/pos/clover-test-order';

export const dynamic = 'force-dynamic';

// Settings → Clover app → "Send a test order" (owner only, signed in). Same check as the welcome page's button, for any
// register Food Hub can reach: approved through the Clover app, or connected with an API token in the environment
// (CLOVER_ACCESS_TOKEN / CLOVER_MERCHANT_TOKENS). Not under the public /clover-connect/test-order prefix (proxy.ts).
export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const body = (await req.json().catch(() => ({}))) as { merchantId?: string };
  const mid = String(body.merchantId || '').trim();
  if (!/^[A-Z0-9]{8,20}$/i.test(mid)) return fail('merchantId is required.');
  const r = await sendCloverTestOrder(mid, Date.now(), { tokenMerchant: true, actor: actor.name || actor.username });
  const status = r.ok ? 200 : r.reason === 'not_approved' ? 403 : r.reason === 'limited' ? 429 : 502;
  return NextResponse.json(r, { status });
});
