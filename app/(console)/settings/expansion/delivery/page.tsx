'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, MapPin, Save, Truck } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Skeleton } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import type { DeliverySettings, LocationDeliveryRule } from '@/lib/foodhub/delivery/types';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { Section } from '../../settings-ui';
import { CopyValue, ExpansionHead } from '../expansion-ui';

type Fleet = { fleet: string; label: string; configured: boolean; canSend: boolean; environment: 'sandbox' | 'production'; missing: string[]; note: string; noteFr: string; webhookPath: string };
type Resp = { settings: DeliverySettings; fleets: Fleet[]; baseUrl: string; secrets: { driveWebhook: string; websiteOrder: string } | null };
const DEFAULT_RULE: LocationDeliveryRule = { enabled: false, autoDispatch: false, leadMinutes: 10, maxDistanceKm: 8, postalPrefixes: [], maxAutoFee: 15 };

export default function DeliverySettingsPage() {
  const { t, lang } = useI18n();
  const { can, locations } = useViewer();
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [s, setS] = useState<DeliverySettings | null>(null);
  const [prefixes, setPrefixes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const edit = can('stores:map');

  const load = useCallback((reveal = false) => api<Resp>(`/api/foodhub/delivery/settings${reveal ? '?reveal=1' : ''}`).then((d) => {
    setData(d); setS(d.settings);
    setPrefixes(Object.fromEntries(Object.entries(d.settings.locations).map(([k, r]) => [k, r.postalPrefixes.join(', ')])));
    if (reveal && !d.secrets) toast.info(t('Seul le propriétaire voit les secrets (avec DASHBOARD_PASSWORD).', 'Only the owner sees secrets (with DASHBOARD_PASSWORD).'));
  }).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast, t]);
  useEffect(() => { load(); }, [load]);

  const rule = (code: string) => s?.locations[code] ?? DEFAULT_RULE;
  const setRule = (code: string, p: Partial<LocationDeliveryRule>) => setS((x) => (x ? { ...x, locations: { ...x.locations, [code]: { ...(x.locations[code] ?? DEFAULT_RULE), ...p } } } : x));

  async function save() {
    if (!s) return;
    setBusy(true);
    try {
      const locs = Object.fromEntries(Object.entries(s.locations).map(([k, r]) => [k, { ...r, postalPrefixes: (prefixes[k] ?? '').split(/[\s,;]+/).filter(Boolean) }]));
      const r = await api<Resp>('/api/foodhub/delivery/settings', { method: 'PUT', json: { settings: { ...s, locations: locs } } });
      setS(r.settings); toast.success(t('Règles de livraison enregistrées', 'Delivery rules saved'));
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const drive = data?.fleets.find((f) => f.fleet === 'doordash_drive');
  return (
    <div>
      <ExpansionHead title={t('Livraison par nos coursiers', 'Own-order delivery')}
        intro={t('DoorDash Drive envoie un livreur pour nos propres commandes (téléphone, site web, Clover « Livraison »). Uber Direct sert de comparaison et de relève.', 'DoorDash Drive sends a courier for our own orders (phone, website, Clover "Delivery"). Uber Direct is the comparison quote and fallback.')}
        right={edit && s ? <Button icon={<Save className="size-4" />} loading={busy} onClick={save}>{t('Enregistrer', 'Save')}</Button> : undefined} />
      {!data || !s ? <Skeleton className="h-96" /> : (
        <div className="max-w-5xl">
          <Section icon={<Truck className="size-5" />} title={t('Services de livraison', 'Courier services')} subtitle={t('Les clés se mettent avec npm run setup ou dans les variables du serveur — jamais ici.', 'Keys go in with npm run setup or the server variables — never here.')}>
            <div className="grid gap-3 md:grid-cols-2">
              {data.fleets.map((f) => (
                <div key={f.fleet} className="rounded-md border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2"><StatusDot tone={f.canSend ? 'go' : f.configured ? 'wait' : 'neutral'} /><span className="font-bold">{f.label}</span>{f.configured && <Badge tone={f.environment === 'sandbox' ? 'info' : 'go'}>{f.environment === 'sandbox' ? t('bac à sable', 'sandbox') : 'production'}</Badge>}{f.fleet === s.primaryFleet && <Badge tone="dark">{t('principal', 'primary')}</Badge>}</div>
                  <p className="mt-1 text-[13px] text-ink-3">{lang === 'fr' ? f.noteFr : f.note}</p>
                  <div className="mt-3 space-y-2">
                    <CopyValue label={t('Adresse webhook à donner', 'Webhook URL to give')} value={`${data.baseUrl}${f.webhookPath}`} />
                    {f.fleet === 'doordash_drive' && <>
                      <div className="grid grid-cols-2 gap-2"><CopyValue label={t('Type d’authentification', 'Authentication type')} value="Basic" mono={false} /><CopyValue label={t('Nom de l’en-tête', 'Header name')} value="Authorization" mono={false} /></div>
                      {data.secrets ? <CopyValue label={t('Jeton (Authorization)', 'Token (Authorization)')} value={data.secrets.driveWebhook || t('(non généré)', '(not generated)')} /> : can('admin') && <Button size="xs" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => load(true)}>{t('Afficher le jeton', 'Show the token')}</Button>}
                    </>}
                    {f.fleet === 'uber_direct' && <p className="text-xs text-ink-3">{t('Clé de signature : UBER_DIRECT_WEBHOOK_SECRET (copiée depuis Uber Direct → Webhooks).', 'Signing key: UBER_DIRECT_WEBHOOK_SECRET (copied from Uber Direct → Webhooks).')}</p>}
                  </div>
                </div>
              ))}
            </div>
            {drive?.configured && drive.environment === 'sandbox' && <Banner tone="info" className="mt-3">{t('Pour passer en production, DoorDash exige des livraisons d’essai réussies : adresse, valeur de commande, nom du commerce, pourboire, instructions, articles et une annulation. Food Hub envoie tout ça à chaque livraison.', 'To go to production DoorDash requires successful test deliveries: address, order value, business name, tip, instructions, items and a cancellation. Food Hub sends all of it on every delivery.')}</Banner>}
          </Section>

          <Section title={t('Règles générales', 'General rules')}>
            <fieldset disabled={!edit} className="grid gap-4 md:grid-cols-2">
              <Field label={t('Service principal', 'Primary service')}><Select value={s.primaryFleet} onChange={(e) => setS({ ...s, primaryFleet: e.target.value as DeliverySettings['primaryFleet'] })}><option value="doordash_drive">DoorDash Drive</option><option value="uber_direct">Uber Direct</option></Select></Field>
              <Field label={t('Si non livrable', 'If undeliverable')}><Select value={s.undeliverable} onChange={(e) => setS({ ...s, undeliverable: e.target.value as DeliverySettings['undeliverable'] })}><option value="return_to_pickup">{t('Retour à la cuisine', 'Back to the kitchen')}</option><option value="dispose">{t('Laisser / jeter', 'Leave / dispose')}</option></Select></Field>
              <Field label={t('Frais de livraison facturés au client ($)', 'Delivery fee charged to the customer ($)')}><Input inputMode="decimal" value={s.customerFee} onChange={(e) => setS({ ...s, customerFee: e.target.value as unknown as number })} /></Field>
              <Field label={t('Pourboire par défaut au livreur ($)', 'Default courier tip ($)')} hint={t('DoorDash compte les livraisons avec pourboire.', 'DoorDash counts deliveries with a tip.')}><Input inputMode="decimal" value={s.defaultTip} onChange={(e) => setS({ ...s, defaultTip: e.target.value as unknown as number })} /></Field>
              <Switch checked={s.compareQuotes} onChange={(v) => setS({ ...s, compareQuotes: v })} label={t('Comparer les prix (DoorDash vs Uber) et prendre le moins cher', 'Compare prices (DoorDash vs Uber) and take the cheaper')} />
              <Switch checked={s.smsTracking} onChange={(v) => setS({ ...s, smsTracking: v })} label={t('Texter le lien de suivi au client', 'Text the tracking link to the customer')} />
              <Switch checked={s.readCloverDeliveryOrders} onChange={(v) => setS({ ...s, readCloverDeliveryOrders: v })} label={t('Lire les commandes Clover de type « Livraison »', 'Read Clover orders of type "Delivery"')} />
              <Switch checked={s.allowUnpaidDispatch} onChange={(v) => setS({ ...s, allowUnpaidDispatch: v })} label={t('Envoyer un livreur même si la commande n’est pas payée', 'Send a courier even if the order is not paid')} description={t('Déconseillé : les livreurs n’encaissent jamais.', 'Not recommended: couriers never collect money.')} />
            </fieldset>
          </Section>

          <Section icon={<MapPin className="size-5" />} title={t('Par cuisine', 'Per kitchen')} subtitle={t('Envoi automatique : Food Hub demande le livreur à « heure prête − N minutes ». Au-delà du plafond de prix, une personne décide.', 'Auto-dispatch: Food Hub asks for the courier at "ready time − N minutes". Above the price limit, a person decides.')}>
            <div className="space-y-3">
              {locations.map((l) => {
                const r = rule(l.code);
                return (
                  <fieldset key={l.code} disabled={!edit} className="rounded-md border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="font-bold">{l.name}</div>
                      <div className="flex flex-wrap gap-4"><Switch checked={r.enabled} onChange={(v) => setRule(l.code, { enabled: v })} label={t('Livre ses commandes', 'Delivers its orders')} /><Switch checked={r.autoDispatch} disabled={!r.enabled} onChange={(v) => setRule(l.code, { autoDispatch: v })} label={t('Envoi automatique', 'Auto-dispatch')} /></div>
                    </div>
                    {r.enabled && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label={t('Minutes avant « prête »', 'Minutes before "ready"')}><Input inputMode="numeric" value={r.leadMinutes} onChange={(e) => setRule(l.code, { leadMinutes: e.target.value as unknown as number })} /></Field>
                        <Field label={t('Plafond auto ($)', 'Auto price limit ($)')}><Input inputMode="decimal" value={r.maxAutoFee} onChange={(e) => setRule(l.code, { maxAutoFee: e.target.value as unknown as number })} /></Field>
                        <Field label={t('Distance max (km)', 'Max distance (km)')}><Input inputMode="decimal" value={r.maxDistanceKm} onChange={(e) => setRule(l.code, { maxDistanceKm: e.target.value as unknown as number })} /></Field>
                        <Field label={t('Codes postaux servis', 'Postal codes served')} hint={t('Ex. H4A, H4B — vide = tous', 'e.g. H4A, H4B — empty = any')}><Input value={prefixes[l.code] ?? ''} onChange={(e) => setPrefixes((p) => ({ ...p, [l.code]: e.target.value.toUpperCase() }))} /></Field>
                        <Field label={t('Latitude cuisine', 'Kitchen latitude')}><Input inputMode="decimal" value={r.lat ?? ''} onChange={(e) => setRule(l.code, { lat: e.target.value === '' ? undefined : (e.target.value as unknown as number) })} placeholder="45.4688" /></Field>
                        <Field label={t('Longitude cuisine', 'Kitchen longitude')}><Input inputMode="decimal" value={r.lng ?? ''} onChange={(e) => setRule(l.code, { lng: e.target.value === '' ? undefined : (e.target.value as unknown as number) })} placeholder="-73.6177" /></Field>
                        <Field label={t('Instructions au livreur (cueillette)', 'Pickup instructions for the courier')} className="sm:col-span-2"><Input value={r.pickupInstructions ?? ''} onChange={(e) => setRule(l.code, { pickupInstructions: e.target.value })} placeholder={t('Porte de côté, comptoir Po Poulet', 'Side door, Po Poulet counter')} /></Field>
                      </div>
                    )}
                  </fieldset>
                );
              })}
            </div>
          </Section>

          <Section title={t('Commandes du site web', 'Website orders')} subtitle={t('Votre site envoie chaque commande à Food Hub (même circuit : Clover, texto, livreur).', 'Your website sends each order to Food Hub (same path: Clover, text, courier).')}>
            <div className="space-y-2">
              <CopyValue label="POST" value={`${data.baseUrl}/api/foodhub/webhooks/website-order`} />
              {data.secrets ? <CopyValue label="Authorization: Bearer" value={data.secrets.websiteOrder || t('(non généré)', '(not generated)')} /> : can('admin') && <Button size="xs" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => load(true)}>{t('Afficher le jeton', 'Show the token')}</Button>}
              <p className="text-xs text-ink-3">{t('Format : docs/EXPANSION_FEATURES.md (section Site web).', 'Format: docs/EXPANSION_FEATURES.md (Website section).')}</p>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
