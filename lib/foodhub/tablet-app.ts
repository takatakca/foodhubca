// Where the kitchen tablet app's APK is downloaded (the /tablette page). GitHub Actions builds it
// (.github/workflows/android-tablet.yml) and attaches foodhub-tablet.apk to a GitHub Release tagged tablet-v<version>.
// The page asks GitHub's public API for the newest such release (cached 10 minutes, 4 s timeout); when GitHub cannot be
// reached it falls back to "the latest release" link. FOODHUB_TABLET_APK_URL overrides both (an APK hosted elsewhere).
export const TABLET_REPO = 'takatakca/foodhubca';
export const TABLET_APK_NAME = 'foodhub-tablet.apk';
export const TABLET_TAG_PREFIX = 'tablet-v';
export const TABLET_RELEASES_PAGE = `https://github.com/${TABLET_REPO}/releases`;

export interface TabletRelease {
  tag: string;
  version: string;
  url: string;
  publishedAt: string | null;
  sizeBytes: number | null;
}

type GhAsset = { name?: unknown; browser_download_url?: unknown; size?: unknown };
type GhRelease = { tag_name?: unknown; draft?: unknown; published_at?: unknown; assets?: unknown };

/** The newest published (not draft) tablet-v* release that carries foodhub-tablet.apk. Pure. */
export function pickTabletRelease(releases: unknown): TabletRelease | null {
  if (!Array.isArray(releases)) return null;
  const found: TabletRelease[] = [];
  for (const r of releases as GhRelease[]) {
    const tag = typeof r?.tag_name === 'string' ? r.tag_name : '';
    if (!tag.startsWith(TABLET_TAG_PREFIX) || r.draft === true) continue;
    const asset = (Array.isArray(r.assets) ? (r.assets as GhAsset[]) : []).find((a) => a?.name === TABLET_APK_NAME && typeof a.browser_download_url === 'string');
    if (!asset || !String(asset.browser_download_url).startsWith('https://github.com/')) continue;
    found.push({
      tag, version: tag.slice(TABLET_TAG_PREFIX.length), url: String(asset.browser_download_url),
      publishedAt: typeof r.published_at === 'string' ? r.published_at : null,
      sizeBytes: typeof asset.size === 'number' && asset.size > 0 ? asset.size : null,
    });
  }
  found.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  return found[0] ?? null;
}

/** Link used when GitHub's API cannot be read: GitHub serves the latest release's asset at this address. */
export function fallbackApkUrl(): string {
  return `https://github.com/${TABLET_REPO}/releases/latest/download/${TABLET_APK_NAME}`;
}

export type TabletDownload =
  | { kind: 'override'; url: string }
  | { kind: 'release'; url: string; release: TabletRelease }
  | { kind: 'none' }
  | { kind: 'unknown'; url: string };

let cache: { at: number; value: TabletDownload } | null = null;
const TTL_MS = 10 * 60_000;

export async function tabletDownload(fetcher: typeof fetch = fetch, now = Date.now()): Promise<TabletDownload> {
  const override = (process.env.FOODHUB_TABLET_APK_URL || '').trim();
  if (/^https:\/\//.test(override)) return { kind: 'override', url: override };
  if (cache && now - cache.at < TTL_MS) return cache.value;
  let value: TabletDownload;
  try {
    const res = await fetcher(`https://api.github.com/repos/${TABLET_REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'takatak-foodhub' }, signal: AbortSignal.timeout(4000), cache: 'no-store',
    });
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    const release = pickTabletRelease(await res.json());
    value = release ? { kind: 'release', url: release.url, release } : { kind: 'none' };
  } catch {
    value = { kind: 'unknown', url: fallbackApkUrl() };
  }
  // A failed lookup is retried after a minute, a good answer is kept 10 minutes.
  cache = { at: value.kind === 'unknown' ? now - TTL_MS + 60_000 : now, value };
  return value;
}

export function _resetTabletDownloadCache() { cache = null; }
