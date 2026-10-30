import { fail, ok } from '@/lib/foodhub/http';
import { deviceReceipt, registerSaleForDevice, validOrderId, verifyCloverDevice } from '@/lib/foodhub/mev/clover-device';
import { cloverRegisterEnabled } from '@/lib/foodhub/mev/clover-register';
import { settleMevKicks } from '@/lib/foodhub/mev/outbox';

export const dynamic = 'force-dynamic';

// TAKATAK MEV device app → the Revenu Québec invoice of one register sale (?order=<Clover order id>), to print.
// Credential: the merchant's own Clover token (lib/foodhub/mev/clover-device.ts). The app polls until `status` is
// accepted or offline (both printable: offline = « PROBLÈME DE COMMUNICATION », QCMEV transmits later).
export async function GET(req: Request) {
  if (!cloverRegisterEnabled()) return fail('Not found.', 404);
  const auth = await verifyCloverDevice(req);
  if (!auth.ok) return fail(auth.error, auth.status);
  const order = new URL(req.url).searchParams.get('order');
  if (!validOrderId(order)) return fail('order must be a Clover order id.', 400);
  const sale = await registerSaleForDevice(auth.merchantId, auth.token, order);
  if (sale === 'not_register') return ok({ receipt: { status: 'not_register', reason: 'This order is invoiced another way (platform, online or Food Hub order).' } });
  // A sale recorded just now: give the send a moment so the first answer can already carry the invoice.
  if (sale && !sale.mev) await Promise.race([settleMevKicks(), new Promise((r) => setTimeout(r, 4000))]);
  const { getRegisterSale } = await import('@/lib/foodhub/mev/clover-register');
  return ok({ receipt: deviceReceipt(sale ? await getRegisterSale(sale.id) : null) });
}
