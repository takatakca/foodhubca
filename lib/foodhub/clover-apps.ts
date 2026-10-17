// Our two Clover App Market apps and their public "Install From Clover App Market" badges.
// Both apps were submitted on 2026-10-17 and wait for Clover's review: their market pages answer "not found" until
// Clover approves them, so every badge stays hidden until the owner lists the app in NEXT_PUBLIC_CLOVER_APPS_LIVE
// (comma list, e.g. "foodhub,phone"; empty or unset = no badge anywhere).
//
// The switch is read when the page is served, not when it is built: the Docker build runs `next build` with an empty
// environment (`env -i`, see Dockerfile), so a build-time value would never reach the image. Setting the variable in
// Coolify and pressing Deploy (or Restart) is enough. The computed key below keeps Next.js from inlining the value
// at build time.

export type CloverAppKey = 'foodhub' | 'phone';
export type BadgeLang = 'fr' | 'en' | 'fr-en';

export interface CloverAppListing {
  key: CloverAppKey;
  /** Clover App Market app ID (public, shown in the market URL). */
  appId: string;
  name: string;
  description: { fr: string; en: string };
}

export const CLOVER_APPS_LIVE_ENV = 'NEXT_PUBLIC_CLOVER_APPS_LIVE';

/** Clover's official badge, hotlinked unmodified (never copied into this repository). */
export const CLOVER_APP_MARKET_BADGE_SRC = 'https://www.clover.com/assets/images/clover-app-market-button.svg';

export const CLOVER_APPS: readonly CloverAppListing[] = [
  {
    key: 'foodhub',
    appId: '629HFYHNVMZYR',
    name: 'TAKATAK Food Hub',
    description: {
      fr: 'Les commandes de toutes vos plateformes de livraison arrivent directement dans votre caisse Clover.',
      en: 'Orders from all your delivery platforms, straight into your Clover register.',
    },
  },
  {
    key: 'phone',
    appId: '20FK28P20HJC6',
    name: 'TAKATAK Phone AI',
    description: {
      fr: 'Une IA répond à vos appels, prend la commande et envoie au client un lien de paiement Clover par texto.',
      en: 'AI answers your phone orders and texts the customer a Clover pay link.',
    },
  },
];

export function cloverAppMarketUrl(appId: string): string {
  return `https://www.clover.com/appmarket/apps/${encodeURIComponent(appId)}`;
}

/** The apps whose badge may be shown, in the fixed order of CLOVER_APPS. Unknown names are ignored. */
export function liveCloverApps(raw: string | undefined = process.env[CLOVER_APPS_LIVE_ENV]): CloverAppListing[] {
  const wanted = new Set((raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return CLOVER_APPS.filter((app) => wanted.has(app.key));
}

export function badgeTexts(app: CloverAppListing, lang: BadgeLang): { label: string; alt: string } {
  const fr = { label: `Installer ${app.name} depuis le Clover App Market`, alt: 'Installer depuis le Clover App Market' };
  const en = { label: `Install ${app.name} from the Clover App Market`, alt: 'Install From Clover App Market' };
  if (lang === 'fr') return fr;
  if (lang === 'en') return en;
  return { label: `${fr.label} · ${en.label}`, alt: en.alt };
}
