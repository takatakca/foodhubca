'use client';

import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, ShieldAlert, Wine } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Skeleton } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import type { AlcoholSettings, LocationAlcohol, PermitType } from '@/lib/foodhub/alcohol/rules';
import { api, ApiError, dayOf, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { Section } from '../../settings-ui';
import { ExpansionHead } from '../expansion-ui';

type Decision = { allowed: boolean; reason: string; reasonFr: string };
type View = { on: boolean; settings: AlcoholSettings; now: Array<{ locationCode: string; channels: Record<string, Decision> }>; channels: Array<{ key: string; fr: string; en: string }>; permitHours: Record<PermitType, { from: string; to: string }>; warning?: string | null };

export default function AlcoholPage() {
  const { t, lang, loc } = useI18n();
  const { can, locations } = useViewer();
  const toast = useToast();
  const [v, setV] = useState<View | null>(null);
  const owner = can('admin');

  const load = useCallback(() => api<View>('/api/foodhub/alcohol').then(setV).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast]);
  useEffect(() => { load(); }, [load]);

  async function save(code: string, patch: Partial<LocationAlcohol> & { verify?: boolean }) {
    try {
      const r = await api<View>('/api/foodhub/alcohol', { method: 'PUT', json: { locationCode: code, patch } });
      setV(r);
      if (r.warning) toast.warn(t('Canaux gardés fermés', 'Channels kept closed'), r.warning);
      else toast.success(t('Enregistré', 'Saved'));
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div>
      <ExpansionHead title={t('Alcool', 'Alcohol')} intro={t('Permis RACJ par succursale. Tout est fermé au départ et rien ne s’ouvre tout seul : le propriétaire inscrit le permis, confirme l’avoir vérifié, puis ouvre chaque canal un par un.', 'RACJ permit per location. Everything starts closed and nothing opens by itself: the owner enters the permit, confirms they checked it, then opens each channel one by one.')} />
      {!v ? <Skeleton className="h-96" /> : (
        <div className="max-w-5xl">
          {!v.on && <Banner tone="warn" className="mb-4">{t('L’interrupteur « Alcool » est désactivé : l’agent téléphonique et nos livreurs ne vendent aucun alcool, et les menus des plateformes restent comme avant.', 'The "Alcohol" switch is off: the phone agent and our couriers sell no alcohol, and platform menus stay as they were.')}</Banner>}
          <Banner tone="info" className="mb-5">
            <strong>{t('Règles du Québec (RACJ) — à vérifier sur votre permis :', 'Québec rules (RACJ) — check against your permit:')}</strong>{' '}
            {t('Permis de restaurant : 8 h à 23 h pour emporter / livraison, toujours avec des aliments préparés par vous ; livraison par un tiers (DoorDash, Uber…) seulement avec une entente écrite, gardée 3 ans. Permis d’épicerie : 7 h à 23 h, et vous devez livrer vous-même — jamais par un tiers. Jamais aux moins de 18 ans : pièce d’identité avec photo à la porte.', 'Restaurant permit: 8:00–23:00 for take-out / delivery, always with food you prepared; delivery by a third party (DoorDash, Uber…) only under a written agreement, kept 3 years. Grocery permit: 7:00–23:00, and you must deliver yourself — never through a third party. Never to anyone under 18: photo ID at the door.')}
          </Banner>
          {locations.map((l) => {
            const r: LocationAlcohol = v.settings.locations[l.code] ?? { permitType: 'none', channels: {}, saleFrom: '08:00', saleTo: '23:00', requireFood: true, thirdPartyAgreement: false };
            const now = v.now.find((n) => n.locationCode === l.code);
            return (
              <Section key={l.code} icon={<Wine className="size-5" />} title={l.name}
                right={r.verifiedAt ? <Badge tone="go" icon={<BadgeCheck className="size-3.5" />}>{t('Vérifié', 'Checked')} · {r.verifiedBy} · {dayOf(r.verifiedAt, loc)}</Badge> : <Badge tone="neutral" icon={<ShieldAlert className="size-3.5" />}>{t('Non vérifié', 'Not checked')}</Badge>}>
                <LocationForm rule={r} owner={owner} permitHours={v.permitHours} onSave={(p) => save(l.code, p)} />
                <div className="mt-4">
                  <div className="mb-2 text-[13px] font-semibold">{t('Canaux', 'Channels')}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {v.channels.map((c) => {
                      const d = now?.channels[c.key];
                      return (
                        <div key={c.key} className="flex items-start justify-between gap-3 rounded-md border border-line px-3 py-2">
                          <div className="min-w-0"><div className="flex items-center gap-2 text-sm font-semibold"><StatusDot tone={d?.allowed ? 'go' : 'neutral'} />{lang === 'fr' ? c.fr : c.en}</div><div className="text-xs text-ink-3">{d ? (d.allowed ? t(`Permis maintenant (${timeOf(new Date().toISOString(), loc)})`, `Allowed now (${timeOf(new Date().toISOString(), loc)})`) : lang === 'fr' ? d.reasonFr : d.reason) : ''}</div></div>
                          <Switch size="sm" checked={Boolean(r.channels[c.key as keyof LocationAlcohol['channels']])} disabled={!owner} onChange={(on) => save(l.code, { channels: { [c.key]: on } as LocationAlcohol['channels'] })} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LocationForm({ rule, owner, permitHours, onSave }: { rule: LocationAlcohol; owner: boolean; permitHours: View['permitHours']; onSave: (p: Partial<LocationAlcohol> & { verify?: boolean }) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ permitType: rule.permitType, permitNumber: rule.permitNumber ?? '', holderName: rule.holderName ?? '', expiresOn: rule.expiresOn ?? '', saleFrom: rule.saleFrom, saleTo: rule.saleTo, thirdPartyAgreement: rule.thirdPartyAgreement });
  useEffect(() => { setF({ permitType: rule.permitType, permitNumber: rule.permitNumber ?? '', holderName: rule.holderName ?? '', expiresOn: rule.expiresOn ?? '', saleFrom: rule.saleFrom, saleTo: rule.saleTo, thirdPartyAgreement: rule.thirdPartyAgreement }); }, [rule]);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const legal = permitHours[f.permitType];
  return (
    <fieldset disabled={!owner} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('Type de permis', 'Permit type')}><Select value={f.permitType} onChange={(e) => set({ permitType: e.target.value as PermitType })}>
          <option value="none">{t('Aucun', 'None')}</option><option value="restaurant">{t('Restaurant (pour vendre)', 'Restaurant (to sell)')}</option><option value="epicerie">{t('Épicerie', 'Grocery')}</option><option value="bar">{t('Bar', 'Bar')}</option><option value="other">{t('Autre', 'Other')}</option>
        </Select></Field>
        <Field label={t('Numéro de permis', 'Permit number')}><Input value={f.permitNumber} onChange={(e) => set({ permitNumber: e.target.value })} /></Field>
        <Field label={t('Titulaire', 'Holder')}><Input value={f.holderName} onChange={(e) => set({ holderName: e.target.value })} placeholder="Quadro Holdings LTÉE" /></Field>
        <Field label={t('Expire le', 'Expires on')}><Input type="date" value={f.expiresOn} onChange={(e) => set({ expiresOn: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('Vente de', 'Sale from')} hint={t(`Permis : dès ${legal.from}`, `Permit: from ${legal.from}`)}><Input type="time" value={f.saleFrom} onChange={(e) => set({ saleFrom: e.target.value })} /></Field>
        <Field label={t('Jusqu’à', 'Until')} hint={t(`Permis : jusqu’à ${legal.to}`, `Permit: until ${legal.to}`)}><Input type="time" value={f.saleTo} onChange={(e) => set({ saleTo: e.target.value })} /></Field>
        {f.permitType === 'restaurant' && <div className="flex items-end sm:col-span-2"><Checkbox checked={f.thirdPartyAgreement} onChange={(v) => set({ thirdPartyAgreement: v })} label={t('Entente écrite signée avec l’entreprise de livraison (requise pour DoorDash, Uber, Skip et nos livreurs)', 'Written agreement signed with the delivery company (required for DoorDash, Uber, Skip and our couriers)')} /></div>}
      </div>
      {owner && <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onSave({ ...f, expiresOn: f.expiresOn || undefined })}>{t('Enregistrer', 'Save')}</Button>
        <Button size="sm" icon={<BadgeCheck className="size-4" />} disabled={f.permitType === 'none' || !f.permitNumber} onClick={() => onSave({ ...f, expiresOn: f.expiresOn || undefined, verify: true })}>{t('J’ai vérifié ce permis', 'I checked this permit')}</Button>
      </div>}
    </fieldset>
  );
}
