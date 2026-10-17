import { badgeTexts, CLOVER_APP_MARKET_BADGE_SRC, cloverAppMarketUrl, type BadgeLang, type CloverAppListing } from '@/lib/foodhub/clover-apps';
import { cn } from '@/lib/ui/cn';

// "Get the apps on Clover" badges for the public pages (support page, legal footer, sign-in page).
// No hooks: works under server and client parents alike. The parent passes liveCloverApps() (read on the server);
// an empty list renders nothing, so the badges stay hidden until NEXT_PUBLIC_CLOVER_APPS_LIVE lists the app.
// Clover's own badge artwork is used as is (English, no recolour or crop); only its height is set.

const HEADING: Record<BadgeLang, string> = {
  fr: 'Nos applications sur Clover',
  en: 'Get the apps on Clover',
  'fr-en': 'Nos applications sur Clover · Get the apps on Clover',
};

function Badge({ app, lang, size }: { app: CloverAppListing; lang: BadgeLang; size: 'md' | 'sm' }) {
  const { label, alt } = badgeTexts(app, lang);
  // Badge is 138 × 42 at its natural size; keep its ratio.
  const [w, h] = size === 'md' ? [158, 48] : [132, 40];
  return (
    <a href={cloverAppMarketUrl(app.appId)} target="_blank" rel="noopener noreferrer" aria-label={label}
      className="inline-block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      {/* eslint-disable-next-line @next/next/no-img-element -- Clover's hosted badge, shown unmodified */}
      <img src={CLOVER_APP_MARKET_BADGE_SRC} alt={alt} width={w} height={h} loading="lazy" decoding="async"
        className={cn('block w-auto', size === 'md' ? 'h-12' : 'h-10')} />
    </a>
  );
}

export function CloverAppBadges({ apps, lang, variant = 'block', className }: {
  apps: readonly CloverAppListing[];
  lang: BadgeLang;
  /** block: heading + name + one-line description per app. compact: small footer row. */
  variant?: 'block' | 'compact';
  className?: string;
}) {
  if (apps.length === 0) return null;
  const desc = (app: CloverAppListing) => (lang === 'en' ? app.description.en : lang === 'fr' ? app.description.fr : `${app.description.fr} · ${app.description.en}`);

  if (variant === 'compact') {
    return (
      <section aria-label={HEADING[lang]} data-clover-badges="compact" className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
        <span className="text-[13px] font-semibold text-ink-3">{HEADING[lang]}</span>
        {apps.map((app) => (
          <span key={app.key} className="flex items-center gap-2">
            <span className="text-[13px] text-ink-3">{app.name}</span>
            <Badge app={app} lang={lang} size="sm" />
          </span>
        ))}
      </section>
    );
  }

  return (
    <section data-clover-badges="block" className={cn('mt-6 rounded-lg border border-line bg-surface p-4', className)}>
      <h2 className="text-lg font-bold text-ink">{HEADING[lang]}</h2>
      <ul className="mt-3 space-y-4">
        {apps.map((app) => (
          <li key={app.key} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 basis-60">
              <p className="font-semibold text-ink">{app.name}</p>
              <p className="text-[15px] leading-relaxed text-ink-2">{desc(app)}</p>
            </div>
            <Badge app={app} lang={lang} size="md" />
          </li>
        ))}
      </ul>
    </section>
  );
}
