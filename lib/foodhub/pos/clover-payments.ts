// How a Clover order was paid (tender labels), for the MEV receipt of a pay-at-pickup order (mev/hooks.ts).
// GET /v3/merchants/{mId}/orders/{orderId}/payments?expand=tender — successful payments only. Read-only: nothing here
// takes, changes or refunds money.
import { cloverBaseUrl, cloverToken } from './clover';
import { cloverFetch } from './clover-http';

/** The tender labels of the order's successful payments ([] = none yet), or null when Clover cannot be read. */
export async function cloverOrderTenders(mid: string | null | undefined, orderId: string | null | undefined): Promise<string[] | null> {
  if (!mid || !orderId) return null;
  const token = await cloverToken(mid);
  if (!token) return null;
  try {
    const res = await cloverFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/orders/${encodeURIComponent(orderId)}/payments?expand=tender&limit=50`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const rows: any[] = (await res.json().catch(() => null))?.elements ?? [];
    return rows
      // Some answers list the merchant's payments: keep only this order's, and only the ones that went through.
      .filter((p) => (!p?.order?.id || p.order.id === orderId) && (!p?.result || p.result === 'SUCCESS'))
      .map((p) => String(p?.tender?.label ?? p?.tender?.labelKey ?? '').trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}
