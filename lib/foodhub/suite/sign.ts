// Signatures between Food Hub and the TAKATAK Suite apps, both directions (same scheme as Stripe's):
//   X-Takatak-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<payload>")>
// payload = the raw request body (POST) or the path with its query string (GET). Refused when older than 5 minutes.
import crypto from 'node:crypto';

export const SIGNATURE_HEADER = 'x-takatak-signature';
export const APP_HEADER = 'x-takatak-app';
export const TOLERANCE_S = 300;

const mac = (secret: string, t: number, payload: string) => crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');

export function signSuite(secret: string, payload: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${mac(secret, t, payload)}`;
}

export function verifySuite(secret: string, header: string | null | undefined, payload: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]).filter((p) => p.length === 2));
  const t = Number(parts.t);
  const v1 = parts.v1 ?? '';
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(Math.floor(now / 1000) - t) > TOLERANCE_S) return false;
  const want = Buffer.from(mac(secret, t, payload), 'hex');
  const got = Buffer.from(v1, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
