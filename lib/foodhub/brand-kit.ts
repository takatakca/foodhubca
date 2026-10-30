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

/** What the brand editor shows about a colour: text contrast on it, and whether the stripe can be seen. */
export function accentReport(hex: string) {
  const onAccent = onAccentColor(hex);
  const textContrast = contrastRatio(hex, onAccent);
  const onWhite = contrastRatio(hex, '#ffffff');
  const onKitchen = contrastRatio(hex, KITCHEN_SURFACE);
  return {
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
