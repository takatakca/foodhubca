// Every Clover API call goes through cloverFetch: Clover limits an app to 50 requests/s (16 per token) and 10
// concurrent requests (5 per token) and answers 429 beyond that (docs.clover.com → API usage and rate limits).
// A 429 means the request was NOT processed, so it is safe to send it again: wait for Retry-After when Clover gives
// one (capped at 5 s), otherwise 1 s then 2 s, at most twice. Any other status goes straight back to the caller.
import { timedFetch } from '../config';

const MAX_RETRIES = 2;
const MAX_WAIT_MS = 5_000;

function baseWaitMs(): number {
  const n = Number(process.env.FOODHUB_CLOVER_RETRY_MS ?? 1000);
  return Number.isFinite(n) && n >= 0 ? n : 1000;
}

/** Wait before retry `attempt` (0-based): Retry-After (seconds or HTTP date) when present, else exponential. */
export function cloverRetryDelayMs(retryAfter: string | null, attempt: number, base = baseWaitMs()): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_WAIT_MS);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.min(Math.max(0, at - Date.now()), MAX_WAIT_MS);
  }
  return Math.min(base * 2 ** attempt, MAX_WAIT_MS);
}

export async function cloverFetch(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await timedFetch(url, init);
    if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
    const wait = cloverRetryDelayMs(res.headers.get('retry-after'), attempt);
    await res.body?.cancel().catch(() => undefined);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}
