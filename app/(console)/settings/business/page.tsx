'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Building2, MapPin, Plus, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/card';
import { Field, Input, Switch } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { FormDraftNote } from '@/components/ui/save-chip';
import { useToast } from '@/components/ui/toast';
import { Hint } from '@/components/help/hint';
import { useViewer } from '@/components/shell/viewer';
import { Section, SettingsHead } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { sameValue } from '@/lib/ui/autosave-core';
import { formDraftId, useFormDraft } from '@/lib/ui/use-form-draft';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type Loc = { code: string; name: string; address: string; city?: string; postalCode?: string; phone?: string | null; active: boolean };
type Brand = { name: string; active: boolean };
type LocForm = { code: string; name: string; address: string; city: string; postalCode: string; phone: string; active: boolean };
/** The location form being opened: new (code typed in the form) or an existing location (code fixed). */
type LocDraft = { isNew: boolean; form: LocForm };
const NO_LOC_CHANGE: Partial<LocForm> = {};

export default function BusinessPage() {
  const { t } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const router = useRouter();
  const edit = can('admin');
  const [locs, setLocs] = useState<Loc[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loc, setLoc] = useState<LocDraft | null>(null);
  const [newBrand, setNewBrand] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => api<{ locations: Loc[]; brands: Brand[] }>('/api/foodhub/catalog').then((d) => { setLocs(d.locations); setBrands(d.brands); setErr(''); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); }, [load]);

  async function saveBrand(name: string, active: boolean, undoing = false) {
    try {
      await api('/api/foodhub/catalog', { method: 'POST', json: { brand: { name, active } } });
      // Deactivating is applied at once, with 6 s to take it back (reactivating restores it exactly).
      if (!active) toast.undo(t(`Marque désactivée : ${name}`, `Brand deactivated: ${name}`), () => void saveBrand(name, true, true), { body: t('Cachée des nouveaux écrans ; l’historique est gardé.', 'Hidden from new screens; history is kept.') });
      else toast.success(undoing ? t('Marque réactivée', 'Brand reactivated') : t('Marque enregistrée', 'Brand saved'), name);
      if (active && !undoing && name === newBrand.trim()) setNewBrand('');
      await load(); router.refresh();
    }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div>
      <SettingsHead title={t('Entreprise', 'Business')} intro={t('Quadro Holdings LTÉE. Les succursales et marques ici alimentent la grille des magasins, le jumelage, les heures, l’équipe et les rapports. Chaque marque doit être sur DoorDash, Uber Eats et SkipTheDishes dans chaque succursale où elle cuisine ; Too Good To Go est un canal en plus.', 'Quadro Holdings LTEE. Locations and brands here drive the store grid, mapping, hours, team and reports. Every brand must be on DoorDash, Uber Eats and SkipTheDishes at each location where it cooks; Too Good To Go is an extra channel.')} />
      <div className="max-w-5xl">
      {err && !loc && <Banner tone="stop" className="mb-4">{err}</Banner>}

      <Section icon={<Building2 className="size-5" />} title={`${t('Succursales', 'Locations')} (${locs.filter((l) => l.active).length})`}
        right={edit ? <Hint id="business.add"><Button size="sm" onClick={() => setLoc({ isNew: true, form: { code: '', name: '', address: '', city: 'Montréal', postalCode: '', phone: '', active: true } })} icon={<Plus className="size-4" />}>{t('Ajouter', 'Add')}</Button></Hint> : undefined}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {locs.map((l) => (
            <div key={l.code} className={cn('flex items-start justify-between gap-3 rounded-md border border-line p-4', !l.active && 'opacity-60')}>
              <div className="flex min-w-0 gap-3">
                <MapPin className="mt-0.5 size-5 shrink-0 text-brand" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-bold text-ink">{l.name}{!l.active && <Badge tone="stop">{t('inactive', 'inactive')}</Badge>}</div>
                  <div className="text-[13px] text-ink-3">{l.address}{l.city ? `, ${l.city}` : ''}{l.postalCode ? ` ${l.postalCode}` : ''}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2"><code className="rounded bg-sunken px-1.5 font-mono text-[11px] text-ink-2">{l.code}</code>{l.phone ? <span className="text-xs text-ink-3">☎ {l.phone}</span> : <span className="text-xs text-wait-2">{t('pas de téléphone de cuisine', 'no kitchen phone')}</span>}</div>
                </div>
              </div>
              {edit && <Button size="xs" variant="ghost" onClick={() => setLoc({ isNew: false, form: { code: l.code, name: l.name, address: l.address, city: l.city ?? '', postalCode: l.postalCode ?? '', phone: l.phone ?? '', active: l.active } })}>{t('Modifier', 'Edit')}</Button>}
            </div>
          ))}
        </div>
      </Section>

      <Section icon={<Tag className="size-5" />} title={`${t('Marques', 'Brands')} (${brands.filter((b) => b.active).length} ${t('actives', 'active')})`} subtitle={t('Désactiver cache la marque des nouveaux écrans ; l’historique est gardé.', 'Deactivating hides the brand from new screens; history is kept.')}
        right={edit ? <Hint id="business.brand"><form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newBrand.trim()) saveBrand(newBrand.trim(), true); }}><Input inputSize="sm" className="w-48" placeholder={t('Nouvelle marque', 'New brand')} value={newBrand} onChange={(e) => setNewBrand(e.target.value)} /><Button size="sm" type="submit" disabled={!newBrand.trim()} icon={<Plus className="size-4" />}>{t('Ajouter', 'Add')}</Button></form></Hint> : undefined}>
        <Hint id="business.brands"><div className="flex flex-wrap gap-2">
          {brands.map((b) => (
            <span key={b.name} className={cn('inline-flex items-center gap-2 rounded-full border py-1 pr-1 pl-3 text-[13px] font-semibold', b.active ? 'border-line-2 bg-surface text-ink' : 'border-dashed border-line-2 bg-raised text-ink-3 line-through')}>
              {b.name}
              {edit && <button type="button" onClick={() => saveBrand(b.name, !b.active)} className="rounded-full px-2 py-0.5 text-[11px] font-bold text-ink-3 no-underline hover:bg-sunken hover:text-ink">{b.active ? t('Désactiver', 'Deactivate') : t('Réactiver', 'Activate')}</button>}
            </span>
          ))}
        </div></Hint>
      </Section>

      {loc && <LocationDialog draft={loc} onClose={() => setLoc(null)} onSaved={async (code) => { toast.success(t('Succursale enregistrée', 'Location saved'), code); setLoc(null); await load(); router.refresh(); }} />}
      </div>
    </div>
  );
}

function LocationDialog({ draft, onClose, onSaved }: { draft: LocDraft; onClose: () => void; onSaved: (code: string) => void }) {
  const { t } = useI18n();
  const { viewer } = useViewer();
  const toast = useToast();
  // What is typed is kept on this device (one draft per location, 'new' for one being added) until "Save" succeeds.
  // Only the changed fields are kept, so the rest follows the location (a stale draft never undoes another change).
  const f = useFormDraft<Partial<LocForm>>(formDraftId('location', draft.isNew ? null : draft.form.code), viewer.username, NO_LOC_CHANGE);
  const loc = { ...draft.form, ...f.value, isNew: draft.isNew };
  const dirty = (Object.keys(f.value) as Array<keyof LocForm>).some((k) => !sameValue(f.value[k], draft.form[k]));
  const set = (p: Partial<LocForm>) => f.set((prev) => {
    const next: Partial<LocForm> = { ...prev, ...p };
    for (const k of Object.keys(p) as Array<keyof LocForm>) if (sameValue(next[k], draft.form[k])) delete next[k];
    return next;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /** X, backdrop, Esc or Cancel: nothing is sent; what was typed waits for the next opening. */
  function close() {
    if (dirty) toast.info(t('Gardé — rouvrez pour terminer', 'Kept — reopen to finish'));
    onClose();
  }
  async function saveLocation() {
    setBusy(true); setErr('');
    try { await api('/api/foodhub/catalog', { method: 'POST', json: { location: loc } }); f.clear(); onSaved(loc.code); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <Modal title={loc.isNew ? t('Ajouter une succursale', 'Add location') : `${t('Modifier', 'Edit')} ${loc.code}`} onClose={close}
      footer={<><Button variant="ghost" onClick={close}>{t('Annuler', 'Cancel')}</Button><Button loading={busy} disabled={!loc.code || !loc.name} onClick={saveLocation}>{t('Enregistrer', 'Save')}</Button></>}>
      <FormDraftNote restored={f.restored && dirty} onDiscard={f.discard} />
      <div className="grid gap-3">
        <Field label={t('Code (A–Z, 0–9, _)', 'Code (A–Z, 0–9, _)')}><Input value={loc.code} disabled={!loc.isNew} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} placeholder="VERDUN" /></Field>
        <Field label={t('Nom', 'Name')}><Input value={loc.name} onChange={(e) => set({ name: e.target.value })} placeholder="VERDUN — 1234 Wellington" /></Field>
        <Field label={t('Adresse', 'Street address')}><Input value={loc.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label={t('Ville', 'City')}><Input value={loc.city} onChange={(e) => set({ city: e.target.value })} /></Field>
          <Field label={t('Code postal', 'Postal code')}><Input value={loc.postalCode} onChange={(e) => set({ postalCode: e.target.value.toUpperCase() })} /></Field>
        </div>
        <Field label={t('Téléphone de la cuisine', 'Kitchen phone')} hint={t('Si une tablette s’éteint ou qu’une commande attend, la surveillance appelle ce numéro en premier — comme Uber.', 'If a tablet goes off or an order waits, the watchtower calls this number first — like Uber.')}><Hint id="business.phone"><Input type="tel" inputMode="tel" value={loc.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="514 555-0100" /></Hint></Field>
        <Switch checked={loc.active} onChange={(v) => set({ active: v })} label={t('Active', 'Active')} />
        {err && <Banner tone="stop">{err}</Banner>}
      </div>
    </Modal>
  );
}
