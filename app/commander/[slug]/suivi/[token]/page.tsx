import type { Metadata } from 'next';
import { trackOrder } from '@/lib/foodhub/storefront/checkout';
import { clockLabel, sfLang, sfText } from '@/lib/foodhub/storefront/i18n';
import { brandForSlug, seedBrandOf } from '@/lib/foodhub/storefront/settings';
import AutoRefresh from './refresh';

export const dynamic = 'force-dynamic';

// Tracking page of an order placed on the ordering page: /commander/<slug>/suivi/<token>. The random token is the only
// key; the page shows the order number, its status, the brand and the ready time — never the customer's details.
// The link works 7 days, and only under the order's own brand page. Not indexed; refreshes every 15 seconds.
export const metadata: Metadata = { title: 'Suivi de commande · Order tracking', robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string; token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const STEPS = ['new', 'in_kitchen', 'ready', 'completed'] as const;

export default async function TrackPage({ params, searchParams }: Props) {
  const { slug, token } = await params;
  const lang = sfLang((await searchParams).lang);
  const t = sfText(lang);
  const [view, hit] = await Promise.all([trackOrder(token, { slug }), brandForSlug(slug)]);
  const color = hit ? seedBrandOf(hit.brandName)?.color ?? '#1565d8' : '#1565d8';
  const back = `/commander/${slug}${lang === 'en' ? '?lang=en' : ''}`;
  if (!view) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <div className="sf-card p-6"><p className="font-bold">{t.unknownTrack}</p></div>
        <a href={back} className="sf-btn mt-4 w-full border border-[var(--sf-line)]">{t.backToMenu}</a>
      </main>
    );
  }
  const reached = STEPS.indexOf(view.status as (typeof STEPS)[number]);
  const done = view.status === 'completed' || view.status === 'cancelled';
  return (
    <main className="mx-auto max-w-lg px-4 py-8" lang={lang === 'fr' ? 'fr-CA' : 'en-CA'} style={{ ['--sf-accent' as string]: color }}>
      {!done && <AutoRefresh seconds={15} />}
      <div className="sf-card overflow-hidden">
        <div className="sf-accent-bg px-5 py-4">
          <p className="text-sm font-semibold opacity-90">{t.track}</p>
          <h1 className="text-2xl font-extrabold">{view.brand}</h1>
        </div>
        <div className="p-5">
          <p className="text-sm sf-muted">{t.number}</p>
          <p className="text-3xl font-extrabold tracking-tight">{view.number}</p>
          <p role="status" className="mt-4 text-xl font-extrabold">{t.status[view.status] ?? view.status}</p>
          {view.readyAt && !done && <p className="mt-1 sf-muted">{t.readyAround(clockLabel(Date.parse(view.readyAt), lang))}</p>}
          {view.status !== 'cancelled' && view.status !== 'awaiting_payment' && (
            <ol className="mt-5 grid grid-cols-4 gap-2" aria-hidden>
              {STEPS.map((s, i) => <li key={s} className={`h-2 rounded-full ${i <= reached ? 'bg-[var(--sf-accent)]' : 'bg-[var(--sf-sunken)]'}`} />)}
            </ol>
          )}
          {!done && <p className="mt-5 text-xs sf-muted">{t.refresh}</p>}
        </div>
      </div>
      <a href={back} className="sf-btn mt-4 w-full border border-[var(--sf-line)]">{t.backToMenu}</a>
    </main>
  );
}
