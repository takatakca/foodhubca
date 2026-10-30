// Who may show a Food Hub page inside a frame (anti-clickjacking). A hidden frame on another site could otherwise make a
// signed-in manager click "Accept", "Pause" or "Refund" without knowing it. The console, its sign-in pages and its APIs
// may be framed only by Food Hub itself and by Clover (Food Hub is a Clover app). Pages made to be embedded elsewhere
// keep their own rules: the public ON2GO hub site, the storefront (/commander/, /api/storefront/), media, and payment
// links (/p/ sends its own, stricter policy).
import { isPublicSitePath } from './public-site';

export const CONSOLE_FRAME_ANCESTORS = "frame-ancestors 'self' https://*.clover.com";

const EMBEDDABLE_PREFIXES = ['/commander/', '/api/storefront/', '/media/', '/p/'];

/** The Content-Security-Policy to add to this path's response, or null to leave it as the page sets it. */
export function framePolicyFor(pathname: string): string | null {
  if (isPublicSitePath(pathname) || EMBEDDABLE_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return CONSOLE_FRAME_ANCESTORS;
}
