'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bike, Link2, Plus, Save, Trash2 } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Banner, Skeleton } from '@/components/ui/card';
import { Checkbox, Field, Input, Switch } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import type { OwnCourier, OwnFleetSettings } from '@/lib/foodhub/delivery/own-fleet';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { Section } from '../../settings-ui';
import { CopyValue, ExpansionHead } from '../expansion-ui';

type Row = Partial<OwnCourier> & { running?: number };
type View = { settings: Omit<OwnFleetSettings, 'couriers'> & { couriers: Row[] } };

/** Our own couriers: the third fleet next to DoorDash Drive and Uber Direct (docs/ON2GO_HUB_ECOSYSTEM.md § 5). */
export default function CouriersPage() {
  const { t } = useI18n();
  const { can, locations } = useViewer();
  const toast = useToast();
  const owner = can('admin');
  const [s, setS] = useState<View['settings'] | null>(null);
  const [busy, setBusy] = useState('');
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);

  const load = useCallback(() => api<View>('/api/foodhub/couriers').then((d) => setS(d.settings)).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast]);
  useEffect(() => { load(); }, [load]);
  const setRow = (i: number, p: Row) => setS((x) => (x ? { ...x, couriers: x.couriers.map((c, idx) => (idx === i ? { ...c, ...p } : c)) } : x));

  async function save() {
    if (!s) return;
    setBusy('save');
    try {
      const d = await api<View>('/api/foodhub/couriers', { method: 'PUT', json: { enabled: s.enabled, costPerDelivery: s.costPerDelivery, couriers: s.couriers } });
      setS(d.settings); toast.success(t('Livreurs enregistrés', 'Couriers saved'));
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const d = await api<View & { link?: string }>('/api/foodhub/couriers', { method: 'POST', json: body });
      setS(d.settings);
      if (d.link) setLink({ id: String(body.id), url: d.link });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  return (
    <div>
      <ExpansionHead title={t('Nos livreurs', 'Our couriers')}
        intro={t('La 3ᵉ flotte, à côté de DoorDash Drive et Uber Direct. Chaque livreur reçoit un lien personnel (sans mot de passe) qui ouvre sa page sur son téléphone : courses, adresses, « Ramassée », « Livrée ». Quand un livreur est en service, la répartition compare son coût avec Drive / Uber Direct et prend le moins cher. Un livreur n’encaisse jamais.', 'The 3rd fleet, next to DoorDash Drive and Uber Direct. Each courier gets a personal link (no password) that opens his page on his phone: deliveries, addresses, "Picked up", "Delivered". When a courier is on shift, dispatch compares his cost with Drive / Uber Direct and takes the cheapest. A courier never collects money.')}
        right={owner && s ? <Button icon={<Save className="size-4" />} loading={busy === 'save'} onClick={save}>{t('Enregistrer', 'Save')}</Button> : undefined} />
      {!s ? <Skeleton className="h-96" /> : (
        <div className="max-w-5xl">
          <Section icon={<Bike className="size-5" />} title={t('La flotte', 'The fleet')}>
            <fieldset disabled={!owner} className="grid gap-3 sm:grid-cols-2">
              <Switch checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label={t('Offrir nos livreurs à la répartition', 'Offer our couriers to dispatch')} description={t('Éteint : rien ne change, seuls Drive / Uber Direct sont demandés.', 'Off: nothing changes, only Drive / Uber Direct are asked.')} />
              <Field label={t('Coût d’une course pour nous ($)', 'What one delivery costs us ($)')} hint={t('Paie par course, essence… Comparé au prix de Drive / Uber Direct.', 'Pay per delivery, gas… Compared with the Drive / Uber Direct price.')}><Input inputMode="decimal" value={String(s.costPerDelivery)} onChange={(e) => setS({ ...s, costPerDelivery: Number(e.target.value.replace(',', '.')) || 0 })} /></Field>
            </fieldset>
          </Section>

          <Section icon={<Bike className="size-5" />} title={t('Livreurs', 'Couriers')}
            right={owner ? <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => setS({ ...s, couriers: [...s.couriers, { name: '', phone: '', locations: locations.slice(0, 1).map((l) => l.code), active: true, onShift: false }] })}>{t('Ajouter un livreur', 'Add a courier')}</Button> : undefined}>
            {!s.couriers.length && <Banner tone="info">{t('Aucun livreur. Ajoutez-en un, enregistrez, puis « Nouveau lien » et envoyez-le-lui par texto.', 'No courier yet. Add one, save, then "New link" and text it to him.')}</Banner>}
            <div className="space-y-3">
              {s.couriers.map((c, i) => (
                <fieldset key={c.id ?? `new-${i}`} disabled={!owner} className="rounded-md border border-line p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <StatusDot tone={c.active && c.onShift ? 'go' : 'neutral'} />
                    <span className="font-bold">{c.name || t('Nouveau livreur', 'New courier')}</span>
                    {!c.id && <Badge tone="info">{t('non enregistré', 'not saved')}</Badge>}
                    {(c.running ?? 0) > 0 && <Badge tone="brand">{c.running} {t('course(s) en cours', 'running')}</Badge>}
                    {c.lastSeenAt && <span className="text-xs text-ink-3">{t('vu', 'seen')} {new Date(c.lastSeenAt).toLocaleString()}</span>}
                    <div className="ml-auto flex items-center gap-3">
                      <Switch checked={Boolean(c.onShift)} onChange={(v) => (c.id ? post({ action: 'shift', id: c.id, onShift: v }, `shift-${c.id}`) : setRow(i, { onShift: v }))} label={t('En service', 'On shift')} />
                      <Switch checked={c.active !== false} onChange={(v) => setRow(i, { active: v })} label={t('Actif', 'Active')} />
                      <IconButton label={t('Retirer', 'Remove')} size="sm" onClick={() => setS({ ...s, couriers: s.couriers.filter((_, idx) => idx !== i) })}><Trash2 className="size-4" /></IconButton>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t('Nom', 'Name')}><Input value={c.name ?? ''} onChange={(e) => setRow(i, { name: e.target.value })} /></Field>
                    <Field label={t('Téléphone', 'Phone')}><Input type="tel" value={c.phone ?? ''} onChange={(e) => setRow(i, { phone: e.target.value })} placeholder="+1514…" /></Field>
                  </div>
                  <div className="mt-3">
                    <div className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('Cuisines desservies', 'Kitchens served')}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">{locations.map((l) => <Checkbox key={l.code} checked={(c.locations ?? []).includes(l.code)} label={l.name} onChange={(v) => setRow(i, { locations: v ? [...(c.locations ?? []), l.code] : (c.locations ?? []).filter((x) => x !== l.code) })} />)}</div>
                  </div>
                  {c.id && (
                    <div className="mt-3 space-y-2">
                      <Button size="sm" variant="outline" icon={<Link2 className="size-4" />} loading={busy === `link-${c.id}`} onClick={() => post({ action: 'link', id: c.id }, `link-${c.id}`)}>{t('Nouveau lien (les anciens cessent de marcher)', 'New link (older ones stop working)')}</Button>
                      {link?.id === c.id && <CopyValue label={t('Envoyez ce lien au livreur, à lui seulement', 'Send this link to the courier, to him only')} value={link.url} />}
                    </div>
                  )}
                </fieldset>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
