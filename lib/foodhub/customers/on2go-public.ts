// The browser-safe customer API of on2go.ca (/api/public/on2go/*). on2go.ca is a static site: it cannot hold the
// brand-website secret that guards /api/foodhub/customers/*, so these routes take the place of that secret with:
//   - CORS and preflight for the ON2GO sites only (allowedOrigin); a request from another site's page is refused;
//   - the brand website fixed to "on2go" (never read from the request);
//   - the customer token in `Authorization: Bearer cust.…`, accepted only when it was signed for "on2go";
//   - per-IP windows on top of task 72's own limits (per phone, per brand website, wrong-code lockout).
import { NextResponse } from 'next/server';
import { allowedOrigin } from '../public-directory';
import { clientIp } from '../session';
import { resolveCustomerToken, type CustomerResolve } from './token';
import { ON2GO_TENANT } from './types';

export const ON2GO_PUBLIC_LIMITS = {
  /** Texts asked from one IP (each also counts against the phone's 3 per 10 min). */
  start: { max: 6, windowMs: 10 * 60_000 },
  /** Code checks from one IP (the wrong-code lockout still applies per phone). */
  check: { max: 20, windowMs: 10 * 60_000 },
} as const;
export type On2goLimit = keyof typeof ON2GO_PUBLIC_LIMITS;

const windows = new Map<string, number[]>();
export function resetOn2goPublicLimits(): void { windows.clear(); }

/** In-memory per-IP window for one action (one container; the per-phone limits are the durable ones). */
export function allowOn2go(action: On2goLimit, ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfterS: number } {
  const { max, windowMs } = ON2GO_PUBLIC_LIMITS[action];
  const key = `${action}|${ip || 'unknown'}`;
  const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return { ok: false, retryAfterS: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
  recent.push(now);
  windows.set(key, recent);
  return { ok: true };
}

export function on2goCors(req: Request, methods: string): Record<string, string> {
  const origin = allowedOrigin(req.headers.get('origin'));
  return origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': `${methods}, OPTIONS`, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

/** JSON answer with the CORS headers and no caching. */
export function on2goJson(req: Request, methods: string, body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}): Response {
  return NextResponse.json(body, { status, headers: { ...on2goCors(req, methods), 'Cache-Control': 'no-store', ...extra } });
}

export function on2goPreflight(req: Request, methods: string): Response {
  return new Response(null, { status: 204, headers: { ...on2goCors(req, methods), 'Access-Control-Max-Age': '600' } });
}

/** A page on another site is refused; a request without Origin (server, curl, tests) passes on to the other checks. */
export function originRefused(req: Request, methods: string): Response | null {
  const origin = req.headers.get('origin');
  return origin && !allowedOrigin(origin) ? on2goJson(req, methods, { ok: false, error: 'Origin not allowed.' }, 403) : null;
}

/** The JSON body (2 KB at most), {} when empty, undefined when it is not a JSON object. */
export async function readSmallJson(req: Request): Promise<Record<string, unknown> | undefined> {
  if (Number(req.headers.get('content-length') ?? '0') > 2048) return undefined;
  try {
    const text = await req.text();
    if (text.length > 2048) return undefined;
    const v = text ? JSON.parse(text) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** `Authorization: Bearer cust.…` → the live customer, only for a token signed for on2go (403 for another brand's token). */
export async function on2goCustomer(req: Request): Promise<CustomerResolve> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return resolveCustomerToken(token, { tenant: ON2GO_TENANT });
}

export const on2goIp = (req: Request) => clientIp(req.headers);

/** Route wrapper: origin check first, then the handler; a crash is a generic 500 (detail in the server log). */
export function on2goRoute(methods: string, handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const refused = originRefused(req, methods);
    if (refused) return refused;
    try {
      return await handler(req);
    } catch (error) {
      console.error(`[foodhub] on2go ${req.method} ${new URL(req.url).pathname} error:`, error);
      return on2goJson(req, methods, { ok: false, error: 'Something went wrong — see the server log.' }, 500);
    }
  };
}
