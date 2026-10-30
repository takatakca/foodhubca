// One release (or cancel, or conversion) at a time per direct order in this process. Shared by the payment link
// (paylink.ts) and the Interac e-Transfer (interac.ts), so a cancel on one path never interleaves with a release on
// the other. SINGLE INSTANCE: the claim written and re-read by the callers narrows the window between two server
// processes but is not an atomic compare-and-set (saveDirectOrder overwrites). "Exactly once" (one Clover order, one
// print, one courier) holds with ONE Food Hub process, which is how it is deployed (one Coolify container). Before
// running several instances, add an atomic claim to the repo (INSERT … ON CONFLICT DO NOTHING on release:<id>).
const locks = (): Map<string, Promise<unknown>> => {
  const g = globalThis as unknown as { __fhPaylinkLocks?: Map<string, Promise<unknown>> };
  g.__fhPaylinkLocks ??= new Map();
  return g.__fhPaylinkLocks;
};

export async function withOrderLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks().get(id) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks().set(id, run);
  try { return await run; } finally { if (locks().get(id) === run) locks().delete(id); }
}

/** How long a release claim blocks a cancel before it counts as a release that died half-way. */
export const CLAIM_STALE_MS = 2 * 60_000;

/** A release is running: its claim is younger than CLAIM_STALE_MS. */
export function claimFresh(block: { releaseClaim?: string; releaseClaimAt?: string } | undefined, now = Date.now()): boolean {
  return Boolean(block?.releaseClaim && block.releaseClaimAt && now - Date.parse(block.releaseClaimAt) < CLAIM_STALE_MS);
}
