'use client';

import { useEffect, useState } from 'react';
import { Building2, ChevronRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Badge, PlatformTag } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Banner, Card, EmptyState, PageHeader, Stat } from '@/components/ui/card';
import { useViewer } from '@/components/shell/viewer';
import type { OrganizationView } from '@/lib/foodhub/organization-view';
import { useI18n } from '@/lib/i18n/client';
import { api } from '@/lib/ui/api';

export default function OrganizationPage() {
  const { t } = useI18n();
  const { can } = useViewer();
  const [view, setView] = useState<OrganizationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Ignore an obsolete response without turning normal navigation into an api() supervisor network failure.
    let current = true;
    api<OrganizationView>('/api/foodhub/organization')
      .then((data) => { if (current) { setView(data); setError(''); setLoading(false); } })
      .catch(() => { if (current) { setError(t('Impossible de charger la structure du groupe. Réessayez.', 'Unable to load your group structure. Try again.')); setLoading(false); } });
    return () => { current = false; };
  }, [attempt, t]);
  const refresh = () => { setView(null); setLoading(true); setError(''); setAttempt((value) => value + 1); };

  return (
    <div>
      <PageHeader title={t('Votre groupe', 'Your organization')}
        subtitle={t('Les marques et succursales de votre groupe, toutes plateformes confondues.', 'Your organization’s brands and locations across all platforms.')}
        right={<Button variant="outline" onClick={refresh} disabled={loading} icon={<RefreshCw className="size-4" />}>{t('Actualiser', 'Refresh')}</Button>} />

      {error && <Banner tone="stop" className="mb-5"><div className="flex flex-wrap items-center justify-between gap-3"><span>{error}</span><Button size="sm" onClick={refresh}>{t('Réessayer', 'Try again')}</Button></div></Banner>}
      <div className="grid gap-4 sm:grid-cols-3" aria-busy={loading}>
        <Stat label={t('Marques', 'Brands')} value={view?.totals.brands ?? '—'} loading={loading} />
        <Stat label={t('Succursales', 'Locations')} value={view?.totals.locations ?? '—'} loading={loading} />
        <Stat label={t('Magasins associés', 'Mapped stores')} value={view?.totals.mappedStores ?? '—'} loading={loading}
          note={t('Liaisons enregistrées dans Food Hub', 'Mappings saved in Food Hub')} />
      </div>

      {!view && loading && <p role="status" className="mt-6 text-body text-ink-3">{t('Chargement de votre groupe…', 'Loading your organization…')}</p>}
      {view && !error && <>
        <div className="my-6 flex flex-wrap items-center justify-between gap-3 text-small text-ink-3">
          <p>{view.access.locations === 'assigned_locations' ? t('Vous voyez les succursales qui vous sont attribuées.', 'You see the locations assigned to you.') : t('Vue de toutes les succursales de votre groupe.', 'All locations in your organization.')}</p>
          {can('admin') && <ButtonLink href="/settings/business" size="sm">{t('Gérer les marques et succursales', 'Manage brands and locations')}</ButtonLink>}
        </div>

        {view.brands.length === 0 ? <Card><EmptyState icon={<Building2 />} title={t('Aucune marque dans cette vue', 'No brands in this view')}
          body={t('Ajoutez vos marques et succursales, puis associez leurs magasins. Une marque peut être présente dans plusieurs succursales.', 'Add your brands and locations, then map their stores. A brand can operate at several locations.')}
          action={can('admin') ? <ButtonLink href="/settings/business">{t('Configurer mon groupe', 'Set up my organization')}</ButtonLink> : <ButtonLink href="/stores/mapping">{t('Voir les associations', 'View store mappings')}</ButtonLink>} /></Card>
          : <Card>
            <div className="border-b border-line px-5 py-4"><h2 className="text-heading text-ink">{t('Marques et succursales', 'Brands and locations')}</h2><p className="mt-1 text-small text-ink-3">{t('Ouvrez une marque pour voir ses succursales et ses plateformes.', 'Open a brand to see its locations and platforms.')}</p></div>
            <div className="divide-y divide-line">
              {view.brands.map((brand) => <details key={brand.name} className="group">
                <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-4 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand">
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90" />
                  <span className="min-w-0 flex-1 break-words font-bold text-ink">{brand.name}</span>
                  {!brand.active && <Badge tone="wait">{t('Inactive', 'Inactive')}</Badge>}
                  <span className="text-small text-ink-3">{brand.locations.length} {t('succursale(s)', 'location(s)')} · {brand.mappedStores} {t('magasin(s)', 'store(s)')}</span>
                </summary>
                <div className="border-t border-line bg-raised px-5 py-4">
                  {brand.locations.length === 0 ? <p className="text-small text-ink-3">{t('Aucun magasin associé à cette marque. Complétez ses associations pour la retrouver par succursale.', 'No stores are mapped to this brand. Complete its mappings to see it by location.')}</p>
                    : <ul className="space-y-4">{brand.locations.map((location) => <li key={location.code} className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0"><Link href={`/stores?kitchen=${encodeURIComponent(location.code)}&brand=${encodeURIComponent(brand.name)}`} className="font-semibold text-brand underline-offset-4 hover:underline">{location.name}</Link>
                        {!location.active && <span className="ml-2 text-small text-ink-3">{t('Inactive', 'Inactive')}</span>}
                      </div>
                      <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label={t('Magasins associés par plateforme', 'Mapped stores by platform')}>{location.platforms.map((platform) => <li key={platform.channel} className="flex items-center gap-2"><PlatformTag channel={platform.channel} /><span className="num text-small text-ink-3">{platform.mappedStores}</span></li>)}</ul>
                    </li>)}</ul>}
                </div>
              </details>)}
            </div>
          </Card>}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card padding="md"><h2 className="font-bold text-ink">{t('Succursales partagées', 'Shared locations')}</h2>
            <p className="mt-1 text-small text-ink-3">{t('Une même cuisine peut servir plusieurs marques. Ses magasins restent associés à la bonne marque et à la bonne plateforme.', 'One kitchen can serve several brands. Each store stays mapped to its own brand and platform.')}</p>
            <ul className="mt-4 space-y-3">{view.locations.map((location) => <li key={location.code}><span className="font-semibold text-ink">{location.name}</span><p className="mt-1 text-small text-ink-3">{location.brands.length ? location.brands.join(' · ') : t('Aucun magasin associé', 'No mapped stores')}</p></li>)}</ul>
          </Card>
          <Card padding="md"><h2 className="font-bold text-ink">{t('Compte du groupe', 'Organization account')}</h2>
            <p className="mt-2 text-small text-ink-3">{t('Les membres, les forfaits et la facturation de votre entreprise se gèrent dans TAKATAK. La liaison de ce groupe à son compte TAKATAK reste à confirmer.', 'Your company’s members, plans and billing are managed in TAKATAK. The link between this organization and its TAKATAK account still needs confirmation.')}</p>
            {view.readiness.persistence === 'memory_only' && <p className="mt-3 text-small font-semibold text-wait-2">{t('Démonstration : les données de cette session ne sont pas conservées après un redémarrage.', 'Demo: this session’s data is not retained after a restart.')}</p>}
            <p className="mt-3 text-small text-ink-3">{t('Le nombre de magasins décrit vos associations enregistrées. Vérifiez leur connexion et leur état depuis Restaurants.', 'Store counts describe your saved mappings. Check their connection and status under Restaurants.')}</p>
            <ButtonLink href="/stores" size="sm" className="mt-4">{t('Voir mes restaurants', 'View my restaurants')}</ButtonLink>
          </Card>
        </div>
      </>}
    </div>
  );
}
