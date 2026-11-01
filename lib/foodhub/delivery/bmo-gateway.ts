/**
 * BMO Interac Request Money: fail-closed sandbox-only bank boundary.
 * The approved BMO API OpenAPI 4.3.1 will supply the exact endpoint, OAuth
 * consent flow, banking fields and response validation in a later adapter.
 * Production bank calls are deliberately forbidden.
 * — signé : INTER-ACT (ChatGPT) · 2026-11-01
 */
import { createHash, randomUUID } from 'node:crypto';

export type BmoEnvironment = 'sandbox' | 'preproduction' | 'production';
export type BmoPaymentState = 'completed' | 'rejected' | 'cancelled' | 'processing' | 'unknown';
export interface BmoOrderFingerprint { merchantKey: string; orderId: string; amountCents: number }
export interface BmoStatusObservation {
  messageId: string; orderReference: string; amountCents: number;
  currency: string; statusCode: string; providerPaymentId?: string;
}
export interface BmoTransportConfig {
  environment: BmoEnvironment;
  baseUrl: string;
  /** EXACT trusted BMO sandbox/preprod HTTPS origin(s), verified against BMO's onboarding documents. */
  allowedApiOrigins: readonly string[];
  apiKey: string;
  accessToken: string;
  timeoutMs?: number;
}

const STATUS: Record<string, BmoPaymentState> = {
  ACCC: 'completed', RJCT: 'rejected', CANC: 'cancelled',
  ACTC: 'processing', ACSP: 'processing', ACSC: 'processing',
};
const ORDER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_JSON_RESPONSE_BYTES = 128 * 1024;

export function bmoStatus(code: string): BmoPaymentState {
  return typeof code === 'string' ? STATUS[code.trim().toUpperCase()] ?? 'unknown' : 'unknown';
}
function identifier(value: string, name: string): string {
  if (typeof value !== 'string' || !ORDER_ID.test(value)) {
    throw new Error(name + ' must be a safe 1–64 character identifier');
  }
  return value;
}
function credential(value: string, name: string): string {
  // Prevent line breaks and header injection. No value is ever included in an error.
  if (typeof value !== 'string' || !value || /[^\x21-\x7e]/.test(value)) {
    throw new Error(name + ' must be nonempty printable ASCII without spaces');
  }
  return value;
}
export function assertBmoOrder(order: BmoOrderFingerprint): void {
  if (!order || typeof order !== 'object') throw new Error('BMO order required');
  identifier(order.merchantKey, 'merchantKey');
  identifier(order.orderId, 'orderId');
  if (!Number.isSafeInteger(order.amountCents) || order.amountCents <= 0) {
    throw new Error('amountCents must be positive integer CAD cents');
  }
}
/**
 * Stable per merchant, order AND fixed amount. A change of charge amount is a
 * different payment fingerprint and cannot reuse an in-flight bank request.
 */
export function bmoMessageId(order: BmoOrderFingerprint): string {
  assertBmoOrder(order);
  return 'FH' + createHash('sha256')
    .update(JSON.stringify([order.merchantKey, order.orderId, order.amountCents]))
    .digest('hex').slice(0, 33);
}
/** Proof predicate only. Additional entitlement/account mapping is required in the BMO adapter. */
export function bmoMayRelease(
  order: BmoOrderFingerprint,
  originalMessageId: string,
  response: BmoStatusObservation,
): boolean {
  assertBmoOrder(order);
  if (!response || typeof response !== 'object') return false;
  return bmoStatus(response.statusCode) === 'completed'
    && typeof originalMessageId === 'string'
    && response.messageId === originalMessageId
    && originalMessageId === bmoMessageId(order)
    && response.orderReference === order.orderId
    && response.currency === 'CAD'
    && response.amountCents === order.amountCents
    && typeof response.providerPaymentId === 'string'
    && response.providerPaymentId.trim().length > 0;
}
/** Validate BMO returned link at creation AND immediately before SMS. */
export function bmoPaymentLink(candidate: string, allowedHostnames: readonly string[]): string {
  if (typeof candidate !== 'string' || candidate.length > 2048 ||
      /[\u0000-\u001f\u007f]/.test(candidate)) throw new Error('Invalid BMO payment URL');
  if (!Array.isArray(allowedHostnames) || !allowedHostnames.length) {
    throw new Error('BMO payment hostname allowlist required');
  }
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error('Invalid BMO payment URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !url.hostname) throw new Error('Unsafe BMO payment URL');
  if (!allowedHostnames.some((host) => typeof host === 'string' &&
      host.toLowerCase() === url.hostname.toLowerCase())) {
    throw new Error('Unapproved BMO payment hostname');
  }
  return url.toString();
}
function safeEndpoint(config: BmoTransportConfig, path: string): string {
  // A URL supplied by configuration cannot be assumed safe with bearer credentials.
  // Explicit origin pinning makes a wrong/malicious baseUrl fail before fetch().
  if (!Array.isArray(config.allowedApiOrigins) || config.allowedApiOrigins.length === 0)
    throw new Error('Verified BMO API origin allowlist is required');
  let base: URL;
  try { base = new URL(config.baseUrl); } catch { throw new Error('Invalid BMO API origin'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search ||
      base.hash || base.port || base.pathname !== '/' || !base.hostname) {
    throw new Error('BMO API base URL must be a clean HTTPS origin');
  }
  if (!config.allowedApiOrigins.some((origin) => {
    if (typeof origin !== 'string' || origin !== base.origin) return false;
    try {
      const pinned = new URL(origin);
      return pinned.protocol === 'https:' && pinned.origin === origin &&
        pinned.pathname === '/' && !pinned.search && !pinned.hash;
    } catch { return false; }
  })) throw new Error('Unapproved BMO API origin');
  // Endpoints are constant paths from the bank's approved OpenAPI; forbid
  // customer-controlled paths, percent-encoding, query, dot-segments and redirects.
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9/_-]*$/.test(path) ||
      path.startsWith('//') || path.split('/').some((s) => s === '.' || s === '..')) {
    throw new Error('Invalid BMO API endpoint');
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error('Off-origin BMO API URL');
  return url.toString();
}
async function boundedJson(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.includes('application/json') && !type.includes('+json')) {
    throw new Error('Unexpected BMO API response type');
  }
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > MAX_JSON_RESPONSE_BYTES) {
    throw new Error('BMO JSON response too large');
  }
  if (!response.body) throw new Error('Empty BMO JSON response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > MAX_JSON_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('BMO JSON response too large');
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
  catch { throw new Error('Invalid BMO JSON response'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid BMO JSON response');
  return parsed;
}
/**
 * JSON transport ONLY; not a bank schema adapter. Never use an unchecked
 * response as payment evidence. The 3-legged OAuth token and API key are
 * server secrets provided only after BMO approval.
 */
export async function bmoRequest<T>(
  config: BmoTransportConfig, method: 'GET' | 'POST',
  path: string, payload?: unknown, fetchImpl: typeof fetch = fetch,
): Promise<T> {
  if (config.environment !== 'sandbox' && config.environment !== 'preproduction')
    throw new Error('BMO production or unknown environment disabled');
  const url = safeEndpoint(config, path);
  const apiKey = credential(config.apiKey, 'BMO API key');
  const token = credential(config.accessToken, 'BMO OAuth token');
  if (method !== 'GET' && method !== 'POST') throw new Error('Unsupported BMO method');
  if (method === 'GET' && payload !== undefined) throw new Error('GET payload forbidden');
  const timeout = config.timeoutMs ?? 12_000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30_000)
    throw new Error('Invalid timeout');
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: 'Bearer ' + token, 'x-api-key': apiKey,
        'x-fapi-interaction-id': randomUUID(), 'x-request-id': randomUUID(),
        Accept: 'application/json',
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch {
    // The bank may have accepted a POST before the connection failed.
    throw new Error('BMO outcome uncertain (network/timeout); reconcile before retry');
  }
  if (!response.ok) {
    // Do not include response body, request URL, or secret-containing details.
    throw new Error('BMO returned HTTP ' + response.status + '; reconcile before resubmission');
  }
  return await boundedJson(response) as T;
}
