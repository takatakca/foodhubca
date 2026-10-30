// Brand kit (MASTER_PLAN Phase 3 P1, start of Phase 5; docs/BRAND_KIT.md): one accent colour and one logo per brand.
// Pure functions only (no Node imports): the server validates with them before saving and before sending a kit to the
// console, and the console's brand editor reuses the contrast helpers for its live preview.
import type { CSSProperties } from 'react';

/** The only colour form accepted: `#RRGGBB` (stored lower-case). No names, no rgb(), no shorthand, nothing else. */
export const ACCENT_RE = /^#[0-9a-f]{6}$/i;
/** A logo address is at most this long (characters). */
export const LOGO_MAX_LENGTH = 500;
/** A photo of Food Hub's media library (lib/foodhub/media.ts MEDIA_NAME_RE, served by app/media/[name]). */
export const MEDIA_LOGO_RE = /^\/media\/[a-f0-9]{24}\.(jpg|png|webp)$/;
/** WCAG AA for normal text: the text drawn on the accent reaches at least this. */
export const TEXT_MIN_CONTRAST = 4.5;
/** WCAG 1.4.11 (non-text): a stripe or border must reach this against what it sits on to be seen. */
export const STRIPE_MIN_CONTRAST = 3;
/** The kitchen's dark card colour (app/globals.css .theme-kitchen --color-surface). */
export const KITCHEN_SURFACE = '#0d1730';

export type BrandKit = {
  /** `#rrggbb`, already validated. */
  accent?: string;
  /** Black or white: whichever reads best on the accent (always ≥ 4.5:1). */
  onAccent?: '#000000' | '#ffffff';
  /** An https address or /media/<name>, already validated. */
  logo?: string;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Accent colour typed by a person: '' / null = no colour; `#RRGGBB` = that colour; anything else is refused. */
export function parseAccent(input: unknown): Parsed<string | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'Brand colour: use the #RRGGBB form (e.g. #1565D8).' };
  const v = input.trim();
  if (!v) return { ok: true, value: null };
  if (!ACCENT_RE.test(v)) return { ok: false, error: 'Brand colour: use the #RRGGBB form (e.g. #1565D8).' };
  return { ok: true, value: v.toLowerCase() };
}

/**
 * Logo typed or picked by a person: '' / null = no logo; a photo of the media library (/media/<name>); or an https
 * address. Refused: javascript:, data:, http:, addresses with a user name or password, relative paths, and anything
 * longer than LOGO_MAX_LENGTH.
 */
export function parseLogo(input: unknown): Parsed<string | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'Logo: paste an https:// address or upload a file.' };
  const v = input.trim();
  if (!v) return { ok: true, value: null };
  if (v.length > LOGO_MAX_LENGTH) return { ok: false, error: `Logo: the address is longer than ${LOGO_MAX_LENGTH} characters.` };
  if (MEDIA_LOGO_RE.test(v)) return { ok: true, value: v };
  // Printable ASCII only, no quotes or angle brackets: spaces and control characters never belong in an address (the
  // URL parser would drop some of them silently). A copied address is already percent-encoded.
  if (!/^[\x21-\x7e]+$/.test(v) || /["'<>\\`]/.test(v)) return { ok: false, error: 'Logo: the address contains characters that are not allowed.' };
  let url: URL;
  try { url = new URL(v); } catch { return { ok: false, error: 'Logo: paste an https:// address or upload a file.' }; }
  if (url.protocol !== 'https:') return { ok: false, error: 'Logo: only https:// addresses are accepted.' };
  if (url.username || url.password) return { ok: false, error: 'Logo: an address with a user name or password is not accepted.' };
  if (!url.hostname || !url.hostname.includes('.')) return { ok: false, error: 'Logo: the address needs a real host name.' };
  if (url.href.length > LOGO_MAX_LENGTH) return { ok: false, error: `Logo: the address is longer than ${LOGO_MAX_LENGTH} characters.` };
  return { ok: true, value: url.href };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  if (!ACCENT_RE.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two `#rrggbb` colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The text colour for the accent: black or white, whichever contrasts more (one of them always reaches 4.58:1). */
export function onAccentColor(hex: string): '#000000' | '#ffffff' {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
}

/**
 * The console's status colours (app/globals.css `--color-go/wait/stop` and their `-2` shades on the white console, and
 * the kitchen theme's `--color-go/wait/stop`). The button fills (`--color-go-fill`, `--color-stop-fill`) sit between a
 * status colour and its -2 shade, so the look-alike check below already covers them. Green = accepted / ready, amber = waiting / to check, red = late or a
 * problem. A brand stripe in one of these reads as a status (a red stripe makes an on-time order look late).
 */
export const STATUS_COLOURS = {
  go: ['#0e9f5a', '#0b7f48', '#22c55e'],
  wait: ['#d99a00', '#8a6500', '#f5b800'],
  stop: ['#e23b3e', '#bd2427', '#f05252'],
} as const;
export type StatusTone = keyof typeof STATUS_COLOURS;
/** Under this CIEDE2000 distance, a 4 px stripe reads as the same colour family as a status (pure red #ff0000 is 9.5 from the stop red; the blues, teals, pinks and browns BrandMark uses stay above 17). */
export const STATUS_LOOKALIKE_DELTA_E = 12;

export type Lab = [number, number, number];

/** CIE L*a*b* (D65) of a `#rrggbb` colour. */
export function labOf(hex: string): Lab {
  if (!ACCENT_RE.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 255), g = channel((n >> 8) & 255), b = channel(n & 255);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 colour difference (Sharma, Wu & Dalal 2005): about 1 = just noticeable, under ~12 = the same colour family. */
export function deltaE2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1, ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1), cp2 = Math.hypot(ap2, b2);
  const hue = (b: number, a: number) => { if (b === 0 && a === 0) return 0; const h = Math.atan2(b, a) / rad; return h < 0 ? h + 360 : h; };
  const hp1 = hue(b1, ap1), hp2 = hue(b2, ap2);
  let dhp = 0;
  if (cp1 * cp2 !== 0) { dhp = hp2 - hp1; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dL = l2 - l1, dC = cp2 - cp1, dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dhp * rad) / 2);
  const lBar = (l1 + l2) / 2, cpBar = (cp1 + cp2) / 2;
  let hBar = hp1 + hp2;
  if (cp1 * cp2 !== 0) hBar = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2 : (hp1 + hp2) / 2;
  const t = 1 - 0.17 * Math.cos((hBar - 30) * rad) + 0.24 * Math.cos(2 * hBar * rad) + 0.32 * Math.cos((3 * hBar + 6) * rad) - 0.2 * Math.cos((4 * hBar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cpBar, sh = 1 + 0.015 * cpBar * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

/** The status the colour would be mistaken for (green, amber or red), or null when it reads as a brand colour. */
export function statusLookalike(hex: string): StatusTone | null {
  const lab = labOf(hex);
  let best: { tone: StatusTone; d: number } | null = null;
  for (const tone of Object.keys(STATUS_COLOURS) as StatusTone[]) {
    for (const c of STATUS_COLOURS[tone]) {
      const d = deltaE2000(lab, labOf(c));
      if (d < STATUS_LOOKALIKE_DELTA_E && (!best || d < best.d)) best = { tone, d };
    }
  }
  return best?.tone ?? null;
}

/** What the brand editor shows about a colour: text contrast on it, and whether the stripe can be seen. */
export function accentReport(hex: string) {
  const onAccent = onAccentColor(hex);
  const textContrast = contrastRatio(hex, onAccent);
  const onWhite = contrastRatio(hex, '#ffffff');
  const onKitchen = contrastRatio(hex, KITCHEN_SURFACE);
  return {
    /** Close to a status colour: the stripe could be read as "late" (red), "waiting" (amber) or "ready" (green). A warning, not a refusal: a real restaurant may well have a red logo. */
    looksLikeStatus: statusLookalike(hex),
    onAccent,
    textContrast,
    textPasses: textContrast >= TEXT_MIN_CONTRAST,
    onWhite,
    /** Too light: on the white console the stripe and the badge fade into the page. */
    tooLightOnWhite: onWhite < STRIPE_MIN_CONTRAST,
    onKitchen,
    /** Too dark: on the dark kitchen screen the stripe fades into the card. */
    tooDarkOnKitchen: onKitchen < STRIPE_MIN_CONTRAST,
  };
}

/**
 * The kit sent to the console for one saved brand. Everything is checked again here (a value saved by an older
 * version, or edited in the database by hand, never reaches a style attribute unchecked). Null = nothing to show,
 * and the brand looks exactly as it did before brand kits existed.
 */
export function brandKitOf(def: { accent?: unknown; logo?: unknown } | null | undefined): BrandKit | null {
  if (!def) return null;
  const a = parseAccent(def.accent);
  const l = parseLogo(def.logo);
  const accent = a.ok ? a.value : null;
  const logo = l.ok ? l.value : null;
  if (!accent && !logo) return null;
  return { ...(accent ? { accent, onAccent: onAccentColor(accent) } : {}), ...(logo ? { logo } : {}) };
}

/**
 * Brand name → its kit, for the console (lib/foodhub/viewer.ts viewerCatalog). Only `#rrggbb` colours and https /
 * media library logos ever leave the server; a brand without a colour or logo is left out.
 */
export function brandKitsOf(list: Array<{ name: string; accent?: unknown; logo?: unknown }>): Record<string, BrandKit> {
  const out: Record<string, BrandKit> = {};
  for (const b of list) {
    const kit = brandKitOf(b);
    if (kit && b.name !== '__proto__') out[b.name] = kit;
  }
  return out;
}

/** One brand's kit from that map (own keys only: a brand called "constructor" never picks up Object's). */
export function kitFor(kits: Record<string, BrandKit> | null | undefined, name: string | null | undefined): BrandKit | null {
  if (!kits || !name || !Object.hasOwn(kits, name)) return null;
  return kits[name] ?? null;
}

/**
 * The CSS custom properties for an element that shows a brand: `--brand-accent` and `--brand-on-accent`. Undefined
 * (no style attribute at all) when the brand has no colour. The values are re-checked against #rrggbb, so nothing
 * else can ever be written into the style attribute.
 */
export function brandVars(kit: BrandKit | null | undefined): CSSProperties | undefined {
  const accent = kit?.accent;
  if (!accent || !ACCENT_RE.test(accent)) return undefined;
  const on = kit.onAccent === '#000000' || kit.onAccent === '#ffffff' ? kit.onAccent : onAccentColor(accent);
  return { '--brand-accent': accent.toLowerCase(), '--brand-on-accent': on } as CSSProperties;
}
