// Screens wall layouts (docs/ORDER_SCREENS_RESCUE.md): 1, 2, 4, 8, 12, 16, 20 or 24 screens at a time (pages beyond), tabs, or a
// custom board where each screen is dragged and resized on a 12 × 12 grid. Saved per device. Pure, so it is tested.

export const GRID_VIEWS = [1, 2, 4, 8, 12, 16, 20, 24] as const;
export type GridView = (typeof GRID_VIEWS)[number];
export type WallView = `${GridView}` | 'tabs' | 'custom' | 'list';
export const WALL_VIEWS: WallView[] = ['1', '2', '4', '8', '12', '16', '20', '24', 'tabs', 'custom', 'list'];

/** A screen on the custom board, in grid cells (12 columns × 12 rows). */
export interface CustomTile { id: string; x: number; y: number; w: number; h: number }
export const BOARD = 12;
export const MIN_TILE = 2;

export interface WallState {
  view: WallView;
  page: number;
  /** Order of the screens in the grid views and the tabs (ids). */
  order: string[];
  tab: string | null;
  /** The custom board; the last tile is drawn on top. */
  custom: CustomTile[];
}

export const DEFAULT_WALL: WallState = { view: '4', page: 0, order: [], tab: null, custom: [] };

/** Columns × rows for each grid view: 2 side by side, 4 = 2 × 2, 8 = 4 × 2, 12 = 4 × 3, 16 = 4 × 4, 20 = 5 × 4, 24 = 6 × 4. */
export function gridShape(view: GridView): { cols: number; rows: number } {
  switch (view) {
    case 1: return { cols: 1, rows: 1 };
    case 2: return { cols: 2, rows: 1 };
    case 4: return { cols: 2, rows: 2 };
    case 8: return { cols: 4, rows: 2 };
    case 12: return { cols: 4, rows: 3 };
    case 16: return { cols: 4, rows: 4 };
    case 20: return { cols: 5, rows: 4 };
    default: return { cols: 6, rows: 4 };
  }
}

/** Saved order first (only ids that still exist), then the screens not in it yet, in the order given. */
export function orderIds(ids: string[], saved: string[]): string[] {
  const known = new Set(ids);
  const kept = saved.filter((id, i) => known.has(id) && saved.indexOf(id) === i);
  const seen = new Set(kept);
  return [...kept, ...ids.filter((id) => !seen.has(id))];
}

/** The page a screen is on in a grid view (to jump to a screen with orders waiting). */
export function pageOf(order: string[], id: string, per: number): number {
  const i = order.indexOf(id);
  return i < 0 ? 0 : Math.floor(i / per);
}

/** Drag `from` onto `to`: `from` takes `to`'s place, the others shift. */
export function moveId(order: string[], from: string, to: string): string[] {
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  if (i < 0 || j < 0 || i === j) return order;
  const next = order.slice();
  next.splice(i, 1);
  next.splice(j, 0, from);
  return next;
}

export const pageCount = (n: number, per: number) => Math.max(1, Math.ceil(n / per));
export const clampPage = (page: number, n: number, per: number) => Math.min(Math.max(0, Math.floor(page) || 0), pageCount(n, per) - 1);
export function pageSlice<T>(items: T[], per: number, page: number): T[] {
  const p = clampPage(page, items.length, per);
  return items.slice(p * per, p * per + per);
}

/** Keep a tile inside the board, at least MIN_TILE × MIN_TILE. */
export function clampTile(t: CustomTile): CustomTile {
  const w = Math.min(BOARD, Math.max(MIN_TILE, Math.round(t.w)));
  const h = Math.min(BOARD, Math.max(MIN_TILE, Math.round(t.h)));
  return { id: t.id, w, h, x: Math.min(BOARD - w, Math.max(0, Math.round(t.x))), y: Math.min(BOARD - h, Math.max(0, Math.round(t.y))) };
}

/** A first custom board: every screen in an even grid (the owner then drags and resizes). */
export function defaultCustom(ids: string[]): CustomTile[] {
  const n = Math.min(ids.length, 36);
  if (!n) return [];
  // Columns that divide the 12-column board, so the screens fill it edge to edge.
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 6;
  const rows = Math.ceil(n / cols);
  const w = BOARD / cols;
  const h = Math.max(MIN_TILE, Math.floor(BOARD / Math.min(rows, 6)));
  return ids.slice(0, n).map((id, i) => clampTile({ id, x: (i % cols) * w, y: (Math.floor(i / cols) % 6) * h, w, h }));
}

/** Move or resize a tile by whole cells; it comes to the front. */
export function changeTile(tiles: CustomTile[], id: string, d: { dx?: number; dy?: number; dw?: number; dh?: number }): CustomTile[] {
  const t = tiles.find((x) => x.id === id);
  if (!t) return tiles;
  const next = clampTile({ id, x: t.x + (d.dx ?? 0), y: t.y + (d.dy ?? 0), w: t.w + (d.dw ?? 0), h: t.h + (d.dh ?? 0) });
  return [...tiles.filter((x) => x.id !== id), next];
}

/** Put a screen on the custom board (centre, 4 × 4), or take it off. */
export function addTile(tiles: CustomTile[], id: string): CustomTile[] {
  if (tiles.some((t) => t.id === id)) return tiles;
  return [...tiles, clampTile({ id, x: 4, y: 4, w: 4, h: 4 })];
}
export const removeTile = (tiles: CustomTile[], id: string) => tiles.filter((t) => t.id !== id);

const isView = (v: unknown): v is WallView => WALL_VIEWS.includes(v as WallView);

/** Read what this device saved; anything odd falls back to the defaults. */
export function parseWall(raw: string | null | undefined): WallState {
  try {
    const v = JSON.parse(raw ?? '');
    if (!v || typeof v !== 'object') return DEFAULT_WALL;
    const ids = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, 100) : []);
    const custom = Array.isArray(v.custom)
      ? v.custom.filter((t: unknown): t is CustomTile => !!t && typeof t === 'object' && typeof (t as CustomTile).id === 'string'
        && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((t as unknown as Record<string, number>)[k]))).slice(0, 100).map(clampTile)
      : [];
    return {
      view: isView(v.view) ? v.view : DEFAULT_WALL.view,
      page: Number.isFinite(v.page) ? Math.max(0, Math.floor(v.page)) : 0,
      order: ids(v.order),
      tab: typeof v.tab === 'string' ? v.tab : null,
      custom,
    };
  } catch { return DEFAULT_WALL; }
}
