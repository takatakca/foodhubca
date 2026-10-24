import { getDirectOrder } from '@/lib/foodhub/delivery/store';
import { orderRefForToken } from '@/lib/foodhub/mev/outbox';
import { publicReceiptHtml } from '@/lib/foodhub/mev/receipt';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// The electronic copy of a Takatak MEV invoice: https://<FOODHUB_PUBLIC_URL>/r/<token> (public: the secret token is the
// credential, proxy.ts). Shows the lines QCMEV rendered, the QR and « Consulter la transaction en ligne » under it.
// No customer name, phone or address is ever on this page.
const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

const notFound = () => new Response('<!doctype html><meta charset="utf-8"><title>Facture</title><p style="font:16px system-ui;padding:24px">Ce lien de facture n’est pas valide. / This invoice link is not valid.</p>', { status: 404, headers: HEADERS });

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ref = await orderRefForToken(token);
  if (!ref) return notFound();
  if (ref.model === 'direct') {
    const d = await getDirectOrder(ref.id);
    if (!d?.mev || d.mev.token !== token) return notFound();
    return new Response(publicReceiptHtml(d.mev, { brand: d.brandName, number: d.number }), { status: 200, headers: HEADERS });
  }
  const o = await getRepo().getOrder(ref.id);
  const mev = o?.timeline?.mev;
  if (!o || !mev || mev.token !== token) return notFound();
  return new Response(publicReceiptHtml(mev, { brand: o.brandName, number: o.displayId ? `#${o.displayId}` : undefined }), { status: 200, headers: HEADERS });
}
