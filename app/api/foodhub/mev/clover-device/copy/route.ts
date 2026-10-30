import { fail, ok, readJson } from '@/lib/foodhub/http';
import { validOrderId, verifyCloverDevice } from '@/lib/foodhub/mev/clover-device';
import { cloverRegisterEnabled, registerSaleId } from '@/lib/foodhub/mev/clover-register';
import { requestMevPrint } from '@/lib/foodhub/mev/hooks';

export const dynamic = 'force-dynamic';

// The device asks Takatak MEV for a reproduction (RPR) or a merchant copy (DUP) of the current invoice: { order, mode }.
// Both are transmitted to Revenu Québec by QCMEV; the device polls ../receipt and prints the newest copy once (../print).
export async function POST(req: Request) {
  if (!cloverRegisterEnabled()) return fail('Not found.', 404);
  const auth = await verifyCloverDevice(req);
  if (!auth.ok) return fail(auth.error, auth.status);
  const b = await readJson(req);
  if (!validOrderId(b.order)) return fail('order must be a Clover order id.', 400);
  if (b.mode !== 'RPR' && b.mode !== 'DUP') return fail('mode must be RPR or DUP.', 400);
  const r = await requestMevPrint('pos', registerSaleId(auth.merchantId, b.order), b.mode, { username: `clover:${auth.merchantId}`, name: 'Clover register', source: 'dashboard' });
  return r.ok ? ok(r) : fail(r.message, 409);
}
