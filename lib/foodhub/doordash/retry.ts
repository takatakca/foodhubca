// DoorDash's documented error handling (menu integration guide, API reference):
//   400 / 401 / 403 / 404  the request itself is wrong: fix it, never retry (a retry fails the same way);
//   429                    too many requests: try again after 1 minute;
//   500 / 502 / 503 / 504  DoorDash side: retry with exponential backoff.
// POST is never retried after a 5xx: DoorDash may have created the thing (a second menu POST creates a duplicate menu).
import type { ChannelResult } from '../types';

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sleeper: Sleep = realSleep;
/** Tests replace the clock; call with no argument to restore it. */
export function setDoorDashSleep(fn?: Sleep) { sleeper = fn ?? realSleep; }

/** Milliseconds to wait after a 429 (DoorDash: "retry after 1 minute"). */
export const RATE_LIMIT_WAIT_MS = 60_000;
/** Backoff before retry n (0-based) after a 5xx: 400 ms, 1.2 s. At most 2 retries, so a request never hangs for long. */
export const BACKOFF_MS = [400, 1_200];

export type RetryClass = 'never' | 'rate_limit' | 'backoff';

/** How a failed status should be handled. */
export function retryClass(status: number | undefined, method: string): RetryClass {
  if (status === 429) return 'rate_limit';
  if (status === undefined || status === 0) return method.toUpperCase() === 'POST' ? 'never' : 'backoff'; // network error
  if (status >= 500 && status !== 501) return method.toUpperCase() === 'POST' ? 'never' : 'backoff';
  return 'never';
}

export interface RetryOptions {
  method?: string;
  /** Background jobs may wait the full minute after a 429; a request a person waits for must not. */
  waitOn429?: boolean;
  /** A POST that is safe to repeat (DoorDash says so for the Checkout API session: retry 5xx up to 3 times). */
  retryPost?: boolean;
  sleep?: Sleep;
}

/** Runs one DoorDash call with DoorDash's retry rules. Never throws (the run function never does). */
export async function withDoorDashRetry(run: () => Promise<ChannelResult>, opts: RetryOptions = {}): Promise<ChannelResult> {
  const method = opts.method ?? 'GET';
  const sleep = opts.sleep ?? sleeper;
  let res = await run();
  let backoffs = 0;
  let waited429 = 0;
  while (!res.ok) {
    const cls = retryClass(res.httpStatus, opts.retryPost && method.toUpperCase() === 'POST' ? 'PUT' : method);
    if (cls === 'never') return res;
    if (cls === 'rate_limit') {
      if (!opts.waitOn429 || waited429 >= 1) return { ...res, retryAfterMs: RATE_LIMIT_WAIT_MS, message: `${res.message} — DoorDash is rate limiting this app: try again in about 1 minute.` };
      waited429++;
      await sleep(RATE_LIMIT_WAIT_MS);
    } else {
      if (backoffs >= BACKOFF_MS.length) return res;
      await sleep(BACKOFF_MS[backoffs++]);
    }
    res = await run();
  }
  return res;
}
