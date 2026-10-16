// Do the pages we text to callers answer? The readiness check (readiness.ts) opens each one and writes the result here;
// the ON2GO menu then never texts a link whose last check failed (a 404 page by text looks worse than no text).
import { getRepo } from '../repo';

const KV = 'ivr_link_health_v1';

export interface LinkHealth { ok: boolean; status: number; at: string; error?: string }

export async function getLinkHealth(): Promise<Record<string, LinkHealth>> {
  return (await getRepo().getKv<Record<string, LinkHealth>>(KV).catch(() => null)) ?? {};
}

/** False only when the last check of this exact address failed (never checked = allowed). */
export async function linkUsable(url: string): Promise<boolean> {
  const h = (await getLinkHealth())[url];
  return !h || h.ok;
}

/** Opens a page (GET, redirects followed, 5 s). Never throws. */
export async function probeLink(url: string): Promise<LinkHealth> {
  const at = new Date().toISOString();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'FoodHub-link-check/1.0' }, signal: AbortSignal.timeout(5_000) });
    await res.body?.cancel().catch(() => undefined);
    return { ok: res.status >= 200 && res.status < 400, status: res.status, at };
  } catch (e) {
    return { ok: false, status: 0, at, error: e instanceof Error ? e.message.slice(0, 120) : String(e) };
  }
}

export async function saveLinkHealth(results: Record<string, LinkHealth>): Promise<void> {
  const cur = await getLinkHealth();
  await getRepo().setKv(KV, { ...cur, ...results }).catch(() => undefined);
}
