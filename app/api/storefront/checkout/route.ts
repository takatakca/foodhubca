import { NextResponse } from 'next/server';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { placeStorefrontOrder } from '@/lib/foodhub/storefront/checkout';
import { sfText } from '@/lib/foodhub/storefront/i18n';
import { clientIp } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Checkout of the ordering page (public, proxy.ts). Same-origin only, enforced here:
//   - Content-Type must be application/json: a cross-site form or a "simple" fetch (text/plain) is refused (415), and a
//     cross-site JSON fetch needs a CORS preflight that this route never answers;
//   - a browser's Origin (when sent) must be this site (FOODHUB_PUBLIC_URL or the request's own host), and
//     Sec-Fetch-Site (when sent) must be same-origin: otherwise 403.
// The body is read as a stream and cut at 32 KB (413), whether or not Content-Length is declared. The cart is then
// validated (zod), priced again on the server and rate-limited (address, phone, page); a filled honeypot is refused.
const MAX_BYTES = 32 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };
const fr = sfText('fr');
const refuse = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

/** Is this request from our own page? (Browsers always send Origin on a POST; other clients are not a CSRF risk.) */
function sameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const from = hostOf(origin);
  if (!from) return false;
  const ours = new Set([hostOf(publicBaseUrl()), hostOf(req.url), req.headers.get('x-forwarded-host')?.split(',')[0].trim().toLowerCase(), req.headers.get('host')?.toLowerCase()].filter(Boolean));
  return ours.has(from);
}

/** The body as text, or null past `max` bytes (stops reading there). */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(req: Request) {
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return refuse(fr.errors.invalid, 415);
  if (!sameOrigin(req)) return refuse(fr.errors.forbidden, 403);
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) return refuse(fr.errors.tooBig, 413);
  let raw: string | null;
  try { raw = await readCapped(req, MAX_BYTES); } catch { return refuse(fr.errors.invalid, 400); }
  if (raw === null) return refuse(fr.errors.tooBig, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return refuse(fr.errors.invalid, 400); }
  try {
    const r = await placeStorefrontOrder(body, clientIp(req.headers));
    const { status, ...out } = r;
    return NextResponse.json(out, { status, headers: { ...NO_STORE, ...(!r.ok && r.retryAfterSec ? { 'Retry-After': String(r.retryAfterSec) } : {}) } });
  } catch (e) {
    console.error('[foodhub] storefront checkout error:', e);
    return refuse(fr.errors.generic, 500);
  }
}
