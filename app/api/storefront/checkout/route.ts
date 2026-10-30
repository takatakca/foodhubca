import { NextResponse } from 'next/server';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { allowedOrigin } from '@/lib/foodhub/public-directory';
import { placeStorefrontOrder } from '@/lib/foodhub/storefront/checkout';
import { sfText } from '@/lib/foodhub/storefront/i18n';
import { clientIp } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Checkout of the ordering page (public, proxy.ts). Our own page, or the ON2GO sites (allowedOrigin: on2go.ca,
// www/preview.on2go.ca, qmaps.ca, localhost, FOODHUB_PUBLIC_CORS_ORIGINS), enforced here:
//   - Content-Type must be application/json: a cross-site form or a "simple" fetch (text/plain) is refused (415);
//   - a browser's Origin (when sent) must be this site (FOODHUB_PUBLIC_URL or the request's own host) or an allowed
//     origin; Sec-Fetch-Site (when sent) must be same-origin unless the Origin is allowed: otherwise 403;
//   - the CORS preflight (OPTIONS) is answered only for allowed origins, so any other site's JSON fetch fails.
// The body is read as a stream and cut at 32 KB (413), whether or not Content-Length is declared. The cart is then
// validated (zod), priced again on the server and rate-limited (address, phone, page); a filled honeypot is refused.
const MAX_BYTES = 32 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };
const fr = sfText('fr');

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

/** CORS headers for an allowed ON2GO origin (none otherwise, so the browser refuses the answer). */
function cors(req: Request): Record<string, string> {
  const origin = allowedOrigin(req.headers.get('origin'));
  return origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

/** Is this request from our own page, or from an ON2GO site? (Browsers always send Origin on a POST.) */
function trustedOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin && allowedOrigin(origin)) return true;
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
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

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...cors(req), 'Access-Control-Max-Age': '600' } });
}

export async function POST(req: Request) {
  const headers = { ...NO_STORE, ...cors(req) };
  const refuse = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers });
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return refuse(fr.errors.invalid, 415);
  if (!trustedOrigin(req)) return refuse(fr.errors.forbidden, 403);
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
    return NextResponse.json(out, { status, headers: { ...headers, ...(!r.ok && r.retryAfterSec ? { 'Retry-After': String(r.retryAfterSec) } : {}) } });
  } catch (e) {
    console.error('[foodhub] storefront checkout error:', e);
    return refuse(fr.errors.generic, 500);
  }
}
