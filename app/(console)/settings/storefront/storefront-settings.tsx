'use client';

// Owner screen of the ordering pages: master switch, each brand (on / off, address, kitchen, ways to pay, online
// payment readiness), the share kit (links with ?src=, QR code, a plain HTML "Commander" button, Google Business
// Profile steps) and the orders by source over the last 7 days.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, QrCode, Save, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Skeleton } from '@/components/ui/card';
import { Checkbox, Input, Select, Switch } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { Section, SettingsHead } from '../settings-ui';

interface BrandRow {
  name: string; enabled: boolean; slug: string; locationCode: string; payOnline: boolean; payAtPickup: boolean; pickupMaxTotal: number; noteFr?: string; noteEn?: string;
  url: string; color: string | null; hoursSet: boolean; payReady: { ok: boolean; reason?: string };
}
interface View {
  settings: { enabled: boolean; updatedAt: string | null; updatedBy: string | null };
  switch: { on: boolean; source: 'env' | 'switch' };
  brands: BrandRow[];
  locations: Array<{ code: string; name: string }>;
  bySource: Array<{ brand: string; src: string; orders: number }>;
  publicBase: string;
  https: boolean;
  trustProxy: boolean;
}

const SOURCES = ['google', 'instagram', 'facebook', 'site', 'qr'] as const;

export default function StorefrontSettings() {
  const { t } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const [data, setData] = useState<View | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [kit, setKit] = useState('');
  const [table, setTable] = useState('');
  const editable = can('menu:edit');

  const apply = useCallback((v: View) => {
    setData(v); setEnabled(v.settings.enabled); setBrands(v.brands);
    setKit((k) => k || v.brands.find((b) => b.enabled)?.name || v.brands[0]?.name || '');
  }, []);
  useEffect(() => { api<View>('/api/foodhub/storefront/settings').then(apply).catch((e) => toast.error(e instanceof Error ? e.message : String(e))); }, [apply, toast]);

  const patch = (name: string, p: Partial<BrandRow>) => setBrands((list) => list.map((b) => (b.name === name ? { ...b, ...p } : b)));

  async function save() {
    setBusy(true);
    try {
      const body = { enabled, brands: Object.fromEntries(brands.map((b) => [b.name, { enabled: b.enabled, slug: b.slug, locationCode: b.locationCode, payOnline: b.payOnline, payAtPickup: b.payAtPickup, pickupMaxTotal: b.pickupMaxTotal, ...(b.noteFr ? { noteFr: b.noteFr } : {}), ...(b.noteEn ? { noteEn: b.noteEn } : {}) }])) };
      apply(await api<View>('/api/foodhub/storefront/settings', { method: 'PUT', json: body }));
      toast.success(t('Enregistré', 'Saved'));
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const sel = brands.find((b) => b.name === kit) ?? null;
  const live = (b: BrandRow) => Boolean(data?.switch.on) && b.enabled;
  const url = sel ? `${data?.publicBase ?? ''}/commander/${sel.slug}` : '';
  const qrSrc = sel ? `/api/foodhub/storefront/settings?qr=${encodeURIComponent(sel.slug)}${table ? `&table=${table}` : ''}` : '';
  const buttonHtml = sel ? `<a href="${url}?src=site" style="display:inline-block;padding:14px 22px;border-radius:12px;background:${sel.color ?? '#1565d8'};color:#ffffff;font:700 16px/1.2 system-ui,sans-serif;text-decoration:none">Commander</a>` : '';
  const copy = (text: string) => { navigator.clipboard?.writeText(text).then(() => toast.success(t('Copié', 'Copied'))).catch(() => toast.error(t('Copie impossible', 'Could not copy'))); };
  const bySrc = useMemo(() => data?.bySource ?? [], [data]);

  return (
    <div>
      <SettingsHead title={t('Commander direct', 'Direct ordering')}
        intro={t('Une page de commande sans commission par marque, pour emporter, à /commander/<adresse>. Le paiement se fait en ligne par Clover quand la cuisine est prête, ou au comptoir. Tout est éteint au départ.', 'A commission-free pickup ordering page per brand at /commander/<address>. Customers pay online through Clover when the kitchen is ready for it, or at the counter. Everything starts off.')}
        right={editable ? <Button icon={<Save className="size-4" />} loading={busy} onClick={save} disabled={!data}>{t('Enregistrer', 'Save')}</Button> : undefined} />
      {!data && <Skeleton className="h-64" />}
      {data && (
        <>
          {!data.trustProxy && <Banner tone="info" className="mb-4">{t('FOODHUB_TRUST_PROXY n’est pas activé : tous les clients partagent une même limite par adresse (plus large). Les limites par téléphone, par page et par serveur s’appliquent toujours.', 'FOODHUB_TRUST_PROXY is not on: every customer shares one (wider) per-address limit. The per-phone, per-page and per-server limits still apply.')}</Banner>}
          {!data.https && <Banner tone="warn" className="mb-4">{t('FOODHUB_PUBLIC_URL n’est pas une adresse https : les liens et le paiement en ligne ne fonctionneront pas.', 'FOODHUB_PUBLIC_URL is not an https address: links and online payment will not work.')}</Banner>}
          <Section icon={<Store className="size-5" />} title={t('Interrupteur général', 'Master switch')}
            subtitle={t('Éteint : aucune page de commande n’est visible (404). Allumé : seules les marques activées ci-dessous le sont.', 'Off: no ordering page is visible (404). On: only the brands turned on below are.')}
            right={<div className="flex items-center gap-2">{data.switch.source === 'env' && <Badge tone="info">{t('fixé par le serveur (FOODHUB_FEATURE_STOREFRONT)', 'set by the server (FOODHUB_FEATURE_STOREFRONT)')}</Badge>}<Switch checked={data.switch.source === 'env' ? data.switch.on : enabled} disabled={!editable || data.switch.source === 'env'} onChange={setEnabled} label={<span className="sr-only">{t('Interrupteur général', 'Master switch')}</span>} /></div>}>
            <p className="text-[13px] text-ink-3">{data.settings.updatedAt ? `${t('Dernière modification', 'Last change')} : ${new Date(data.settings.updatedAt).toLocaleString()}${data.settings.updatedBy ? ` · ${data.settings.updatedBy}` : ''}` : t('Jamais enregistré.', 'Never saved.')}</p>
          </Section>

          <Section title={t('Marques', 'Brands')} subtitle={t('Pour emporter seulement. Les prix sont ceux du restaurant (menu Food Hub), recalculés à chaque commande. Alcool jamais offert en ligne.', 'Pickup only. Prices are the restaurant prices (Food Hub menu), recomputed on every order. Alcohol is never offered online.')}>
            <ul className="divide-y divide-line">
              {brands.map((b) => (
                <li key={b.name} className="grid gap-3 py-4 lg:grid-cols-[220px_1fr]">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: b.color ?? '#1565d8' }} />
                    <div className="min-w-0">
                      <Switch checked={b.enabled} disabled={!editable} onChange={(v) => patch(b.name, { enabled: v })} label={b.name} description={live(b) ? t('En ligne', 'Live') : t('Hors ligne', 'Off')} />
                      {live(b) && <a href={`/commander/${b.slug}`} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-xs font-bold text-ink hover:underline"><ExternalLink className="size-3" />{t('Voir la page', 'Open the page')}</a>}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs font-bold text-ink-3">{t('Adresse', 'Address')} /commander/
                      <Input value={b.slug} disabled={!editable} onChange={(e) => patch(b.name, { slug: e.target.value.toLowerCase() })} />
                    </label>
                    <label className="text-xs font-bold text-ink-3">{t('Cuisine (cueillette)', 'Kitchen (pickup)')}
                      <Select value={b.locationCode} disabled={!editable} onChange={(e) => patch(b.name, { locationCode: e.target.value })}>
                        {data.locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </Select>
                    </label>
                    <div className="flex flex-wrap gap-4 sm:col-span-2">
                      <Checkbox checked={b.payOnline} disabled={!editable} onChange={(v) => patch(b.name, { payOnline: v })} label={t('Paiement en ligne (Clover)', 'Pay online (Clover)')} />
                      <Checkbox checked={b.payAtPickup} disabled={!editable} onChange={(v) => patch(b.name, { payAtPickup: v })} label={t('Paiement au comptoir', 'Pay at the counter')} />
                    </div>
                    {b.payAtPickup && (
                      <label className="text-xs font-bold text-ink-3">{t('Maximum payé au comptoir ($, taxes incluses)', 'Most paid at the counter ($, taxes in)')}
                        <Input type="number" inputMode="numeric" min={20} max={1000} step={1} value={String(b.pickupMaxTotal)} disabled={!editable}
                          onChange={(e) => patch(b.name, { pickupMaxTotal: Math.max(20, Math.min(1000, Math.round(Number(e.target.value) || 0))) })} />
                        <span className="mt-1 block font-normal">{t('Au-delà, le client paie en ligne (25 articles au plus par commande au comptoir).', 'Above it, the customer pays online (25 items at most per counter order).')}</span>
                      </label>
                    )}
                    <p className="text-[13px] sm:col-span-2">
                      {b.payOnline ? (b.payReady.ok ? <span className="font-semibold text-go-2">{t('Paiement en ligne prêt pour cette cuisine.', 'Online payment ready for this kitchen.')}</span> : <span className="text-ink-3">{t('Paiement en ligne pas prêt', 'Online payment not ready')} : {b.payReady.reason}</span>) : <span className="text-ink-3">{t('Paiement en ligne désactivé pour cette marque.', 'Online payment turned off for this brand.')}</span>}
                      {!b.hoursSet && <span className="block font-semibold text-wait-2">{t('Heures non définies (Réglages → Heures) : la page affichera « fermé ».', 'Hours not set (Settings → Hours): the page will show "closed".')}</span>}
                    </p>
                    <label className="text-xs font-bold text-ink-3">{t('Note affichée (français)', 'Note shown (French)')}<Input maxLength={280} value={b.noteFr ?? ''} disabled={!editable} onChange={(e) => patch(b.name, { noteFr: e.target.value })} /></label>
                    <label className="text-xs font-bold text-ink-3">{t('Note affichée (anglais)', 'Note shown (English)')}<Input maxLength={280} value={b.noteEn ?? ''} disabled={!editable} onChange={(e) => patch(b.name, { noteEn: e.target.value })} /></label>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section icon={<QrCode className="size-5" />} title={t('Trousse de partage', 'Share kit')} subtitle={t('Liens, code QR et bouton à coller sur un site. Le ?src= dit d’où vient chaque commande.', 'Links, QR code and a button to paste on a website. The ?src= tells where each order comes from.')}
            right={<Select value={kit} onChange={(e) => setKit(e.target.value)}>{brands.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}</Select>}>
            {sel && (
              <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
                <div className="grid gap-4 text-[13px]">
                  {!live(sel) && <Banner tone="info">{t('Cette page n’est pas encore en ligne : allumez l’interrupteur général et la marque, puis enregistrez.', 'This page is not live yet: turn on the master switch and the brand, then save.')}</Banner>}
                  <div>
                    <div className="font-bold text-ink">{t('Adresse officielle', 'Canonical address')}</div>
                    <CopyLine text={url} onCopy={copy} />
                  </div>
                  <div>
                    <div className="font-bold text-ink">{t('Liens par source', 'Links by source')}</div>
                    {SOURCES.map((s) => <CopyLine key={s} text={`${url}?src=${s}`} onCopy={copy} />)}
                  </div>
                  <div>
                    <div className="font-bold text-ink">{t('Bouton « Commander » à coller (HTML simple, sans script)', '"Commander" button to paste (plain HTML, no script)')}</div>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-sunken p-3 font-mono text-xs">{buttonHtml}</pre>
                    <Button size="sm" variant="outline" icon={<Copy className="size-3.5" />} onClick={() => copy(buttonHtml)} className="mt-2">{t('Copier le bouton', 'Copy the button')}</Button>
                  </div>
                  <div>
                    <div className="font-bold text-ink">{t('Profil d’entreprise Google', 'Google Business Profile')}</div>
                    <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-2">
                      <li>{t('Ouvrez le profil de la marque (business.google.com) → Modifier le profil.', 'Open the brand profile (business.google.com) → Edit profile.')}</li>
                      <li>{t('Coordonnées → Site Web :', 'Contact → Website:')} <code className="break-all">{url}?src=google</code></li>
                      <li>{t('Coordonnées → Lien du menu :', 'Contact → Menu link:')} <code className="break-all">{url}?src=google</code></li>
                      <li>{t('Liens de commande → Commander à l’avance / Pour emporter : ajoutez', 'Order links → Order ahead / Pickup: add')} <code className="break-all">{url}?src=google</code> {t('et choisissez-le comme lien préféré.', 'and make it the preferred link.')}</li>
                      <li>{t('Search Console : soumettez', 'Search Console: submit')} <code className="break-all">{data.publicBase}/commander/sitemap.xml</code></li>
                    </ol>
                  </div>
                </div>
                <div className="grid content-start gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrSrc} alt={t('Code QR de la page', 'QR code of the page')} className="w-full rounded-lg border border-line bg-white p-2" />
                  <label className="text-xs font-bold text-ink-3">{t('Numéro de table (facultatif)', 'Table number (optional)')}<Input inputMode="numeric" maxLength={3} value={table} onChange={(e) => setTable(e.target.value.replace(/\D/g, '').slice(0, 3))} /></label>
                  <a href={`${qrSrc}&download=1`} className="text-center text-sm font-bold text-ink hover:underline">{t('Télécharger le code QR (SVG)', 'Download the QR code (SVG)')}</a>
                </div>
              </div>
            )}
          </Section>

          <Section title={t('Commandes par source (7 derniers jours)', 'Orders by source (last 7 days)')}>
            {!bySrc.length ? <p className="text-[13px] text-ink-3">{t('Aucune commande pour le moment.', 'No orders yet.')}</p> : (
              <table className="w-full text-left text-[13px]">
                <thead><tr className="text-ink-3"><th className="py-1">{t('Marque', 'Brand')}</th><th>{t('Source', 'Source')}</th><th className="text-right">{t('Commandes', 'Orders')}</th></tr></thead>
                <tbody>{bySrc.map((r) => <tr key={`${r.brand}|${r.src}`} className="border-t border-line"><td className="py-1.5">{r.brand}</td><td>{r.src === 'direct' ? t('direct', 'direct') : r.src}</td><td className="text-right font-bold">{r.orders}</td></tr>)}</tbody>
              </table>
            )}
          </Section>
          <p className="mt-2 text-xs text-ink-4">{t('Étapes du propriétaire : docs/STOREFRONT.md.', 'Owner steps: docs/STOREFRONT.md.')}</p>
        </>
      )}
    </div>
  );
}

function CopyLine({ text, onCopy }: { text: string; onCopy: (t: string) => void }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-sunken px-2 py-1.5 font-mono text-xs">{text}</code>
      <button type="button" onClick={() => onCopy(text)} className="grid size-9 shrink-0 place-items-center rounded-md border border-line hover:bg-sunken" aria-label="Copy"><Copy className="size-3.5" /></button>
    </div>
  );
}
