export function missingEnv(required: string[]): string[] {
  return required.filter((key) => !process.env[key] || process.env[key]?.trim() === '');
}

export function liveConnectorsGloballyEnabled(): boolean {
  return process.env.LIVE_CONNECTORS_GLOBAL_ENABLED === 'true';
}

export function timeoutMs(): number {
  const raw = Number(process.env.CONNECTOR_NETWORK_TIMEOUT_MS || 15000);
  return Number.isFinite(raw) && raw > 0 ? raw : 15000;
}

/** fetch with a timeout: CONNECTOR_NETWORK_TIMEOUT_MS (default 15 s), or a shorter one for a caller with a time budget. */
export async function timedFetch(url: string, init: RequestInit = {}, opts: { timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const ms = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : timeoutMs();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Network errors that prove a request never left (no connection was made): the other side never saw it. */
const NEVER_SENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_INVALID_URL', 'UND_ERR_CONNECT_TIMEOUT']);

/**
 * A fetch that threw: true only when the request surely never reached the other side (DNS failure, connection
 * refused). A timeout (timedFetch's abort), a dropped connection or any other error may have been received and acted
 * on: its outcome is unknown.
 */
export function neverSent(e: unknown): boolean {
  const err = e as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return false;
  return NEVER_SENT_CODES.has(String(err?.cause?.code ?? err?.code ?? ''));
}
