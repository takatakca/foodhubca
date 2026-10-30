// TAKATAK Suite directory: which suite apps each restaurant (Clover merchant) has. Each app tells Food Hub when a
// merchant connects ("<app>.installed", with the app's public address) or uninstalls ("<app>.uninstalled"); apps read
// the directory for their Suite page and app switcher (GET /api/suite/v1/directory?merchant=…). docs/TAKATAK_SUITE.md § 6.
// An app can only speak for itself (the event type starts with its own key, checked in /api/suite/v1/events).
// Nothing personal: a merchant ID, an app key, an https address, a date.
import { getRepo } from '../repo';
import { SUITE_APPS } from './apps';

export const DIRECTORY = 'suite_directory';
const MERCHANT_ID = /^[A-Z0-9]{8,20}$/;

export interface DirectoryEntry { app: string; merchantId: string; installed: boolean; url: string | null; at: string }

function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.username || u.password || (u.protocol !== 'https:' && !(u.protocol === 'http:' && local))) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}

/** "<app>.installed" / "<app>.uninstalled" from that app → the directory. Other event types are ignored (false). */
export async function recordDirectoryEvent(appKey: string, type: string, data: unknown): Promise<boolean> {
  const m = /^([a-z0-9]+)\.(installed|uninstalled)$/.exec(type);
  if (!m || m[1] !== appKey) return false;
  const d = (data ?? {}) as { cloverMerchantId?: unknown; appUrl?: unknown };
  const merchantId = String(d.cloverMerchantId ?? '');
  if (!MERCHANT_ID.test(merchantId)) return false;
  const repo = getRepo();
  const id = `${merchantId}:${appKey}`;
  const prev = await repo.getDoc<DirectoryEntry>(DIRECTORY, id);
  const at = new Date().toISOString();
  const entry: DirectoryEntry = m[2] === 'installed'
    ? { app: appKey, merchantId, installed: true, url: cleanUrl(d.appUrl) ?? prev?.data.url ?? null, at }
    : { app: appKey, merchantId, installed: false, url: prev?.data.url ?? null, at };
  await repo.putDocs<DirectoryEntry>(DIRECTORY, [{ id, key: merchantId, at, data: entry }]);
  return true;
}

/** Every suite app for one restaurant: installed or not, its address when known. */
export async function merchantApps(merchantId: string): Promise<Array<{ key: string; name: string; installed: boolean; url: string | null; at: string | null }>> {
  const docs = MERCHANT_ID.test(merchantId) ? await getRepo().listDocs<DirectoryEntry>(DIRECTORY, { keys: [merchantId], limit: 50 }) : [];
  const by = new Map(docs.map((d) => [d.data.app, d.data]));
  return SUITE_APPS.map((a) => {
    const e = by.get(a.key);
    return { key: a.key, name: a.name, installed: e?.installed === true, url: e?.installed ? e.url : null, at: e?.at ?? null };
  });
}

/** Settings → Connected apps: how many restaurants have each app. */
export async function installCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const d of await getRepo().listDocs<DirectoryEntry>(DIRECTORY, { limit: 5000 })) if (d.data.installed) out[d.data.app] = (out[d.data.app] ?? 0) + 1;
  return out;
}
