// Dry run: everything done inside runDry() that would leave Food Hub (a text, an email, a team-chat post, a robo-call)
// is recorded here instead of being sent. The phone call simulator (phone/sim/driver.ts) runs the real call handlers
// inside it, so the owner sees exactly what a caller would get — with nothing sent and no order fired.
// AsyncLocalStorage keeps the context through every await of the request, including an AI turn still running after
// the simulator answered ("one moment" + redirect).
import { AsyncLocalStorage } from 'node:async_hooks';

export interface DryRunSend { at: string; channel: 'sms' | 'email' | 'chat' | 'call'; to: string; purpose: string; body: string }
export interface DryRun { sent: DryRunSend[] }

const als = new AsyncLocalStorage<DryRun>();

export function dryRun(): DryRun | undefined {
  return als.getStore();
}

export function runDry<T>(ctx: DryRun, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function recordDry(ctx: DryRun, s: Omit<DryRunSend, 'at'>): void {
  ctx.sent.push({ ...s, body: s.body.slice(0, 1500), at: new Date().toISOString() });
}
