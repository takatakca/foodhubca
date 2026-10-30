import { nowIso } from '@/lib/foodhub/config';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { validOrderId, verifyCloverDevice } from '@/lib/foodhub/mev/clover-device';
import { cloverRegisterEnabled, getRegisterSale, registerSaleId, saveRegisterSale } from '@/lib/foodhub/mev/clover-register';
import { claimOrderPrint } from '@/lib/foodhub/mev/print-claim';
import { copyOf } from '@/lib/foodhub/mev/printable';

export const dynamic = 'force-dynamic';

// The device asks to print { order, copy: FAC | RPR | DUP }. Granted once per document (« Modes d'impression »: an
// invoice is printed once; another paper is a reproduction RPR, asked from Takatak MEV with ../copy).
export async function POST(req: Request) {
  if (!cloverRegisterEnabled()) return fail('Not found.', 404);
  const auth = await verifyCloverDevice(req);
  if (!auth.ok) return fail(auth.error, auth.status);
  const b = await readJson(req);
  if (!validOrderId(b.order)) return fail('order must be a Clover order id.', 400);
  const id = registerSaleId(auth.merchantId, b.order);
  const sale = await getRegisterSale(id);
  if (!sale) return fail('No invoice for this order yet.', 404);
  const r = await claimOrderPrint(sale.mev, copyOf(typeof b.copy === 'string' ? b.copy : null), `Clover ${auth.merchantId}`);
  if (r.granted && sale.mev) {
    const cur = (await getRegisterSale(id)) ?? sale;
    if (cur.mev) await saveRegisterSale({ ...cur, mev: { ...cur.mev, printed: { ...(cur.mev.printed ?? {}), [r.key]: r.at }, updatedAt: nowIso() } });
  }
  return ok(r);
}
