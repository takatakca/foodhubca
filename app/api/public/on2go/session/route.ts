// on2go.ca sign-in through TAKATAK (contract C3): the browser posts the one-time launch code it received from
// takatak-v1; Food Hub exchanges it with its service token and answers with the customer and a signed customer token
// for the "on2go" brand website. Public (proxy.ts), POST only, CORS for the ON2GO sites only (allowedOrigin), per-IP
// limit. lib/foodhub/customers/takatak-bridge.ts holds the logic; docs/CUSTOMER_IDENTITY.md the contract.
import { NextResponse } from 'next/server';
import { allowedOrigin } from '@/lib/foodhub/public-directory';
import { readBody, requestIp } from '@/lib/foodhub/customers/http';
import { signInWithTakatak } from '@/lib/foodhub/customers/takatak-bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cors(req: Request): Record<string, string> {
  const origin = allowedOrigin(req.headers.get('origin'));
  return origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

export async function POST(req: Request) {
  const headers = { ...cors(req), 'Cache-Control': 'no-store' };
  // A browser on another site never gets an answer it can read; a request without Origin (server, curl) is allowed.
  const origin = req.headers.get('origin');
  if (origin && !allowedOrigin(origin)) return NextResponse.json({ ok: false, error: 'Origin not allowed.' }, { status: 403, headers });
  if (Number(req.headers.get('content-length') ?? '0') > 2048) return NextResponse.json({ ok: false, error: 'Request too large.' }, { status: 413, headers });
  const body = await readBody(req);
  if (!body) return NextResponse.json({ ok: false, error: 'JSON body required.' }, { status: 400, headers });
  try {
    const r = await signInWithTakatak(body, requestIp(req));
    if (!r.ok) {
      const extra: Record<string, string> = r.status === 429 && r.retryAfterS ? { 'Retry-After': String(r.retryAfterS) } : {};
      return NextResponse.json({ ok: false, error: r.error }, { status: r.status, headers: { ...headers, ...extra } });
    }
    return NextResponse.json({ ok: true, token: r.token, expiresAt: r.expiresAt, customer: r.customer, created: r.created }, { status: 200, headers });
  } catch (error) {
    console.error('[foodhub] on2go session error:', error);
    return NextResponse.json({ ok: false, error: 'Something went wrong — see the server log.' }, { status: 500, headers });
  }
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...cors(req), 'Access-Control-Max-Age': '600' } });
}
