'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, Mail, MapPin, Phone, Search } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, EmptyState } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { SettingsHead } from '../settings-ui';
import { TechDetails } from '../tech-details';
import { ago, api, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type Status = 'new' | 'contacted' | 'won' | 'lost';
type Lead = {
  id: string; at: string; restaurant: string; contact: string; email: string; phone: string; city: string; province?: string; address?: string; website?: string;
  platforms: string[]; brands?: number; message?: string; lang: 'fr' | 'en'; source: string; status: Status; notes: string; updatedAt: string; updatedBy?: string;
};
type Filter = 'open' | Status | 'all';

const STATUS_TONE: Record<Status, Tone> = { new: 'brand', contacted: 'info', won: 'go', lost: 'neutral' };
const PLATFORM: Record<string, string> = { uber: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes', tgtg: 'Too Good To Go', direct: 'Direct', phone: 'Phone' };

export default function LeadsPage() {
  const { t, lang } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [supportEmail, setSupportEmail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const [source, setSource] = useState<'all' | 'foodhub' | 'on2go.ca'>('all');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => api<{ leads: Lead[]; supportEmail: string | null }>('/api/foodhub/restaurant-leads').then((d) => { setLeads(d.leads); setSupportEmail(d.supportEmail); setLoaded(true); setErr(''); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { if (can('admin')) load(); }, [load, can]);

  const statusLabel = (s: Status) => ({ new: t('Nouvelle', 'New'), contacted: t('Contactée', 'Contacted'), won: t('Gagnée', 'Won'), lost: t('Perdue', 'Lost') })[s];
  const platformLabel = (p: string) => (p === 'direct' ? t('Commande directe', 'Direct ordering') : p === 'phone' ? t('Téléphone', 'Phone') : PLATFORM[p] ?? p);
  const count = (s: Status) => leads.filter((l) => l.status === s).length;

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return leads
      .filter((l) => (filter === 'all' ? true : filter === 'open' ? l.status === 'new' || l.status === 'contacted' : l.status === filter))
      .filter((l) => source === 'all' || l.source === source)
      .filter((l) => !s || `${l.restaurant} ${l.contact} ${l.email} ${l.phone} ${l.city} ${l.notes} ${l.source}`.toLowerCase().includes(s))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [leads, q, filter, source]);

  async function patch(id: string, p: { status?: Status; notes?: string }) {
    try {
      const r = await api<{ lead: Lead }>('/api/foodhub/restaurant-leads', { method: 'POST', json: { id, ...p } });
      setLeads((cur) => cur.map((l) => (l.id === id ? r.lead : l)));
      if (p.status) toast.success(t('Statut mis à jour', 'Status updated'), `${r.lead.restaurant} · ${statusLabel(r.lead.status)}`);
      else toast.success(t('Note enregistrée', 'Note saved'));
    } catch (e) { toast.error(t('Échec', 'Failed'), e instanceof Error ? e.message : String(e)); }
  }

  if (!can('admin')) return <div><SettingsHead title={t('Demandes de restaurants', 'Restaurant leads')} /><Banner tone="info">{t('Seul le propriétaire voit les demandes de restaurants.', 'Only the owner sees restaurant leads.')}</Banner></div>;

  return (
    <div>
      <SettingsHead title={t('Demandes de restaurants', 'Restaurant leads')} intro={t('Les demandes de configuration Food Hub et d’inscription ON2GO arrivent ici, les plus récentes en premier. La source distingue les deux parcours. Suivez les échanges, le statut et vos notes internes.', 'Food Hub setup enquiries and ON2GO listing requests arrive here, newest first. The source identifies each journey. Track conversations, status and your internal notes.')} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {loaded && !supportEmail && <Banner tone="warn" className="mb-4">{t('Aucune adresse courriel de soutien n’est réglée : pas d’alerte par courriel à l’arrivée d’une demande (la liste ici reste complète).', 'No support email address is set: no email alert when a lead arrives (this list is still complete).')}<TechDetails>FOODHUB_SUPPORT_EMAIL</TechDetails></Banner>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input inputSize="sm" type="search" className="w-64 pl-8" aria-label={t('Chercher une demande', 'Search leads')} placeholder={t('Restaurant, contact, ville, note', 'Restaurant, contact, city, note')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select selectSize="sm" aria-label={t('Source de la demande', 'Request source')} value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          <option value="all">{t('Toutes les sources', 'All sources')}</option>
          <option value="foodhub">Food Hub</option>
          <option value="on2go.ca">ON2GO</option>
        </Select>
        <Segmented size="sm" value={filter} onChange={setFilter} options={[
          { key: 'open', label: `${t('À suivre', 'To follow')} (${count('new') + count('contacted')})` },
          { key: 'new', label: `${statusLabel('new')} (${count('new')})` },
          { key: 'contacted', label: `${statusLabel('contacted')} (${count('contacted')})` },
          { key: 'won', label: `${statusLabel('won')} (${count('won')})` },
          { key: 'lost', label: `${statusLabel('lost')} (${count('lost')})` },
          { key: 'all', label: `${t('Toutes', 'All')} (${leads.length})` },
        ]} />
      </div>

      <Card>
        <ul className="divide-y divide-line">
          {rows.map((l) => {
            const expanded = open === l.id;
            return (
              <li key={l.id} className={cn('px-5 py-3.5', l.status === 'lost' && 'opacity-70')}>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-bold text-ink">
                      {l.restaurant}
                      <Badge tone={STATUS_TONE[l.status]}>{statusLabel(l.status)}</Badge>
                      <Badge>{l.lang.toUpperCase()}</Badge>
                      <Badge tone="neutral">{l.source === 'foodhub' ? 'Food Hub' : l.source === 'on2go.ca' ? 'ON2GO' : t('Autre source', 'Other source')}</Badge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-small text-ink-3">
                      <span>{l.contact}</span>
                      <a className="inline-flex min-h-6 items-center gap-1 underline-offset-2 hover:underline" href={`mailto:${l.email}`}><Mail className="size-3" />{l.email}</a>
                      <a className="inline-flex min-h-6 items-center gap-1 underline-offset-2 hover:underline" href={`tel:${l.phone}`}><Phone className="size-3" />{l.phone}</a>
                      <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{l.address ? `${l.address}, ` : ''}{l.city}{l.province ? ` · ${l.province}` : ''}</span>
                      {l.website && <a className="inline-flex min-h-6 items-center gap-1 underline-offset-2 hover:underline" href={l.website} target="_blank" rel="noopener noreferrer"><Globe className="size-3" />{l.website.replace(/^https?:\/\//, '')}</a>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {l.platforms.map((p) => <Badge key={p} tone="neutral">{platformLabel(p)}</Badge>)}
                    {l.brands ? <Badge tone="violet">{l.brands} {t(l.brands > 1 ? 'marques' : 'marque', l.brands > 1 ? 'brands' : 'brand')}</Badge> : null}
                  </div>
                  <div className="w-36 text-small text-ink-3" title={timeOf(l.at, lang === 'fr' ? 'fr-CA' : 'en-CA', true)}>{t('Reçue', 'Received')} {ago(l.at, lang)}</div>
                  <Select selectSize="sm" aria-label={t('Statut', 'Status')} value={l.status} onChange={(e) => patch(l.id, { status: e.target.value as Status })}>
                    {(['new', 'contacted', 'won', 'lost'] as Status[]).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </Select>
                  <Button size="sm" variant="outline" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : l.id)}>{expanded ? t('Fermer', 'Close') : t('Détails et notes', 'Details & notes')}</Button>
                </div>
                {expanded && <LeadDetails lead={l} onSave={(notes) => patch(l.id, { notes })} />}
              </li>
            );
          })}
        </ul>
        {rows.length === 0 && <EmptyState title={loaded ? t('Aucune demande ici', 'No leads here') : t('Chargement…', 'Loading…')} body={loaded && filter === 'open' && !q ? t('Les demandes Food Hub et ON2GO correspondant aux filtres apparaîtront ici dès leur arrivée.', 'Food Hub and ON2GO requests matching your filters will appear here as they arrive.') : undefined} />}
      </Card>
    </div>
  );
}

function LeadDetails({ lead, onSave }: { lead: Lead; onSave: (notes: string) => Promise<void> }) {
  const { t, lang } = useI18n();
  const [notes, setNotes] = useState(lead.notes);
  const [busy, setBusy] = useState(false);
  useEffect(() => setNotes(lead.notes), [lead.notes]);
  const dirty = notes !== lead.notes;
  return (
    <div className="mt-3 grid gap-4 rounded-md bg-sunken p-4 md:grid-cols-2">
      <div className="text-body">
        <h3 className="mb-1 text-small font-semibold text-ink-2">{t('Message du restaurant', 'Message from the restaurant')}</h3>
        <p className="whitespace-pre-wrap text-ink">{lead.message || <span className="text-ink-3">{t('Aucun message.', 'No message.')}</span>}</p>
        <p className="mt-3 text-small text-ink-3">
          {t('Reçue le', 'Received on')} {timeOf(lead.at, lang === 'fr' ? 'fr-CA' : 'en-CA', true)} · {t('source', 'source')} {lead.source}
          {lead.updatedBy && <> · {t('modifiée par', 'updated by')} {lead.updatedBy} {ago(lead.updatedAt, lang)}</>}
        </p>
      </div>
      <div>
        <label className="flex flex-col gap-1.5">
          <span className="text-small font-semibold text-ink-2">{t('Notes internes', 'Internal notes')}</span>
          <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Appel du 21 oct. : intéressé par Uber Eats et la commande directe…', 'Call on Oct 21: interested in Uber Eats and direct ordering…')} />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={!dirty || busy} onClick={() => setNotes(lead.notes)}>{t('Annuler', 'Cancel')}</Button>
          <Button size="sm" loading={busy} disabled={!dirty} onClick={async () => { setBusy(true); try { await onSave(notes); } finally { setBusy(false); } }}>{t('Enregistrer la note', 'Save note')}</Button>
        </div>
      </div>
    </div>
  );
}
