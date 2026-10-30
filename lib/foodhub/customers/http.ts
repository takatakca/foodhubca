// Shared pieces of the /api/foodhub/customers/* routes: the server-to-server Bearer check (the same
// FOODHUB_WEBSITE_ORDER_SECRET the website already uses for orders), JSON in / JSON out, and the customer behind
// X-Customer-Token. The browser never calls these routes: the website's server does, and keeps the secret.
import { NextResponse } from 'next/server';
import { verifyWebsiteOrder } from '../delivery/website';
import { clientIp } from '../session';
import { resolveCustomerToken, type CustomerResolve } from './token';
import { customerTenant } from './types';

export const CUSTOMER_TOKEN_HEADER = 'x-customer-token';
/** Optional: the website says which brand it is; a token of another brand is then refused (403). */
export const CUSTOMER_TENANT_HEADER = 'x-customer-tenant';

export function jsonOk(data: Record<string, unknown> = {}, status = 200): Response {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function jsonFail(error: string, status: number, extra: Record<string, unknown> = {}): Response {
  const headers: Record<string, string> = {};
  if (status === 429 && typeof extra.retryAfterS === 'number') headers['Retry-After'] = String(extra.retryAfterS);
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers });
}

/** 401 unless the request carries the website secret. Always the first check of every customer route. */
export function requireWebsiteSecret(req: Request): Response | null {
  return verifyWebsiteOrder(req.headers) ? null : jsonFail('Token check failed.', 401);
}

/** The JSON body, {} when empty, undefined when it is not JSON. */
export async function readBody(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await req.text();
    const v = text ? JSON.parse(text) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The live customer behind X-Customer-Token (401 bad / expired token, 403 another brand website). */
export async function requireCustomer(req: Request): Promise<CustomerResolve> {
  const declared = (req.headers.get(CUSTOMER_TENANT_HEADER) || new URL(req.url).searchParams.get('tenant') || '').trim();
  const tenant = declared ? customerTenant(declared) : null;
  if (declared && !tenant) return { ok: false, status: 403, error: 'Unknown brand website (tenant).' };
  return resolveCustomerToken(req.headers.get(CUSTOMER_TOKEN_HEADER), { tenant });
}

export const requestIp = (req: Request) => clientIp(req.headers);

/** Route wrapper: the secret first, then the handler; a crash becomes a generic 500 (detail in the server log). */
export function customerRoute(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const denied = requireWebsiteSecret(req);
    if (denied) return denied;
    try {
      return await handler(req);
    } catch (error) {
      console.error(`[foodhub] customers ${req.method} ${new URL(req.url).pathname} error:`, error);
      return jsonFail('Something went wrong — see the server log.', 500);
    }
  };
}
