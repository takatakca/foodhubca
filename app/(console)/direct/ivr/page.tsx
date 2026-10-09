'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, Inbox, PhoneForwarded, PhoneIncoming, Search, User, Voicemail } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Banner, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stat } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { Drawer } from '@/components/ui/overlay';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import type { IvrCall, IvrTicket, PlatformRef } from '@/lib/foodhub/phone/ivr/records';
import { PLATFORM_NAME } from '@/lib/foodhub/phone/ivr/tree';
import { api, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { DirectTabs } from '../direct-tabs';

type Row = Omit<IvrCall, 'transcript' | 'messages'> & { transcriptLength: number };
type T = (fr: string, en: string) => string;

const OUTCOME: Record<string, { tone: Tone; fr: string; en: string }> = {
  resolved: { tone: 'go', fr: 'Réglé par l’IA', en: 'Solved by AI' },
  order_agent: { tone: 'go', fr: 'Agent de commande', en: 'Ordering agent' },
  platform_transfer: { tone: 'violet', fr: 'Transféré à la plateforme', en: 'Sent to platform' },
  platform_link: { tone: 'violet', fr: 'Lien plateforme texté', en: 'Platform link texted' },
  handoff: { tone: 'info', fr: 'Transféré à l’équipe', en: 'Handed to team' },
  handoff_missed: { tone: 'stop', fr: 'Personne n’a répondu', en: 'Nobody answered' },
  voicemail: { tone: 'wait', fr: 'Message vocal', en: 'Voicemail' },
  ticket: { tone: 'wait', fr: 'Billet ouvert', en: 'Ticket opened' },
  hangup: { tone: 'neutral', fr: 'Raccroché', en: 'Hung up' },
  error: { tone: 'stop', fr: 'Erreur', en: 'Error' },
};
const CATEGORY: Record<string, [string, string]> = {
  online_order: ['Commande en ligne', 'Online order'], card_charge: ['Frais sur carte', 'Card charge'], billing: ['Facturation', 'Billing'],
  merchant_lead: ['Nouveau marchand', 'Merchant lead'], courier_lead: ['Nouveau livreur', 'Courier lead'], customer_service: ['Service à la clientèle', 'Customer service'],
  callback: ['À rappeler', 'Call back'], voicemail: ['Message vocal', 'Voicemail'], platform: ['Commande plateforme', 'Platform order'], other: ['Autre', 'Other'],
};

function Outcome({ value, t }: { value?: string; t: T }) {
  const o = OUTCOME[value ?? ''];
  return o ? <Badge tone={o.tone}>{t(o.fr, o.en)}</Badge> : <Badge tone="info">{t('En cours', 'Live')}</Badge>;
}

const dur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—');

export default function IvrCallsPage() {
  const { t, loc } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const [calls, setCalls] = useState<Row[] | null>(null);
  const [refs, setRefs] = useState<PlatformRef[]>([]);
  const [tickets, setTickets] = useState<IvrTicket[]>([]);
  const [q, setQ] = useState('');
  const [days, setDays] = useState(14);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api<{ calls: Row[]; refs: PlatformRef[]; tickets: IvrTicket[] }>(`/api/foodhub/phone/ivr/calls?days=${days}&q=${encodeURIComponent(q.trim())}`)
      .then((d) => { setCalls(d.calls); setRefs(d.refs); setTickets(d.tickets); setErr(''); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [days, q]);
  useEffect(() => { const h = setTimeout(load, 250); const i = setInterval(load, 30_000); return () => { clearTimeout(h); clearInterval(i); }; }, [load]);
  // A link from the voicemail email opens that call.
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('id'); if (id) setOpen(id); }, []);

  async function closeTicket(id: string, status: 'done' | 'open') {
    try { await api('/api/foodhub/phone/ivr/calls', { method: 'PATCH', json: { ticketId: id, status } }); load(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  const today = (calls ?? []).filter((c) => new Date(c.startedAt).toDateString() === new Date().toDateString());
  const openTickets = tickets.filter((x) => x.status === 'open');
  return (
    <div>
      <PageHeader eyebrow={t('Nos commandes', 'Own orders')} title={t('Ligne ON2GO', 'ON2GO line')}
        subtitle={t('Chaque appel du menu téléphonique : le chemin suivi, les numéros de commande notés, la plateforme, les billets, les messages vocaux. Cherchez par numéro de téléphone ou de commande.', 'Every call on the phone menu: the path taken, order numbers noted, the platform, tickets, voicemails. Search by phone or order number.')}
        right={can('admin') ? <ButtonLink href="/settings/expansion/phone/ivr" variant="outline" size="sm">{t('Menu téléphonique', 'Phone menu')}</ButtonLink> : undefined} />
      <DirectTabs />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Appels aujourd’hui', 'Calls today')} value={calls ? String(today.length) : '—'} icon={<PhoneIncoming className="size-4" />} />
        <Stat label={t('Vers une plateforme', 'To a platform')} value={calls ? String(today.filter((c) => c.outcome === 'platform_transfer' || c.outcome === 'platform_link').length) : '—'} icon={<PhoneForwarded className="size-4" />} />
        <Stat label={t('Billets ouverts', 'Open tickets')} value={String(openTickets.length)} icon={<Inbox className="size-4" />} tone={openTickets.length ? 'wait' : undefined} />
        <Stat label={t('Messages vocaux', 'Voicemails')} value={calls ? String(today.filter((c) => c.voicemail).length) : '—'} icon={<Voicemail className="size-4" />} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" /><Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Téléphone (4 chiffres ou plus) ou numéro de commande', 'Phone (4+ digits) or order number')} /></div>
        <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-36">{[1, 7, 14, 30, 90].map((d) => <option key={d} value={d}>{d} {t('jours', 'days')}</option>)}</Select>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title={t('Appels', 'Calls')} icon={<PhoneIncoming className="size-5" />} />
          {!calls ? <div className="p-5"><Skeleton className="h-40" /></div> : !calls.length ? <EmptyState title={q ? t('Rien trouvé', 'Nothing found') : t('Aucun appel encore', 'No calls yet')} body={t('Les appels de la ligne ON2GO apparaissent ici.', 'Calls on the ON2GO line show up here.')} /> : (
            <Table>
              <thead><tr><Th>{t('Heure', 'Time')}</Th><Th>{t('Appelant', 'Caller')}</Th><Th>{t('Sujet', 'About')}</Th><Th>{t('Résultat', 'Outcome')}</Th><Th align="right">{t('Durée', 'Length')}</Th></tr></thead>
              <tbody>
                {calls.map((c) => {
                  const last = c.path.filter((p) => !p.node.startsWith('lang_')).at(-1)?.node;
                  return (
                    <Tr key={c.id} className="cursor-pointer" onClick={() => setOpen(c.id)}>
                      <Td className="whitespace-nowrap">{timeOf(c.startedAt, loc, true)}</Td>
                      <Td className="num">{c.from}{c.lang !== 'fr' && <Badge tone="info" className="ml-1.5">{c.lang.toUpperCase()}</Badge>}</Td>
                      <Td><span className="font-mono text-xs">{last ?? '—'}</span>{c.platform && <Badge tone="violet" className="ml-1.5">{PLATFORM_NAME[c.platform]}</Badge>}{c.orderIds.length > 0 && <span className="ml-1.5 num text-xs font-bold">{c.orderIds.join(', ')}</span>}</Td>
                      <Td><Outcome value={c.status === 'active' ? undefined : c.outcome} t={t} /></Td>
                      <Td align="right" className="num">{dur(c.durationSec)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title={t('Billets ouverts', 'Open tickets')} icon={<Inbox className="size-5" />} subtitle={t('Pistes, demandes et messages à suivre.', 'Leads, requests and messages to follow up.')} />
            <div className="space-y-2 px-5 pb-5">
              {!openTickets.length ? <p className="text-sm text-ink-3">{t('Rien à suivre.', 'Nothing to follow up.')}</p> : openTickets.map((x) => (
                <div key={x.id} className="rounded-md border border-line p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="wait">{t(...(CATEGORY[x.category] ?? CATEGORY.other))}</Badge><span className="text-xs text-ink-3">{timeOf(x.at, loc, true)} · {x.from}</span>
                    <Button size="xs" variant="ghost" className="ml-auto" icon={<CheckCircle2 className="size-3.5" />} onClick={() => closeTicket(x.id, 'done')}>{t('Fait', 'Done')}</Button></div>
                  <button type="button" className="text-left hover:underline" onClick={() => setOpen(x.callId)}>{x.summary}{x.orderRef ? ` · ${x.orderRef}` : ''}</button>
                </div>
              ))}
            </div>
          </Card>
          {refs.length > 0 && (
            <Card>
              <CardHeader title={t('Commandes de plateformes signalées', 'Platform orders reported')} icon={<PhoneForwarded className="size-5" />} />
              <Table>
                <thead><tr><Th>{t('Heure', 'Time')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Commande', 'Order')}</Th><Th>{t('Suite', 'Next')}</Th></tr></thead>
                <tbody>{refs.map((r) => (
                  <Tr key={r.id} className="cursor-pointer" onClick={() => setOpen(r.callId)}>
                    <Td className="whitespace-nowrap">{timeOf(r.at, loc, true)}</Td><Td>{PLATFORM_NAME[r.platform]}</Td><Td className="num font-bold">{r.orderId || '—'}</Td>
                    <Td>{r.next === 'transfer' ? t('Transféré', 'Transferred') : r.next === 'sms_link' ? t('Lien texté', 'Link texted') : '—'}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            </Card>
          )}
        </div>
      </div>
      {open && <IvrCallDrawer id={open} onClose={() => setOpen(null)} onTicket={closeTicket} />}
    </div>
  );
}

function IvrCallDrawer({ id, onClose, onTicket }: { id: string; onClose: () => void; onTicket: (id: string, s: 'done' | 'open') => void }) {
  const { t, loc } = useI18n();
  const [d, setD] = useState<{ call: IvrCall; refs: PlatformRef[]; tickets: IvrTicket[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<{ call: IvrCall; refs: PlatformRef[]; tickets: IvrTicket[] }>(`/api/foodhub/phone/ivr/calls?id=${encodeURIComponent(id)}&days=90`).then(setD).catch((e) => setErr(e instanceof Error ? e.message : String(e))); }, [id]);
  const call = d?.call;
  return (
    <Drawer width="lg" onClose={onClose} title={t('Appel ligne ON2GO', 'ON2GO line call')} subtitle={call ? `${timeOf(call.startedAt, loc, true)} · ${call.from}` : undefined}>
      {err ? <div className="p-5"><Banner tone="stop">{err}</Banner></div> : !call || !d ? <div className="p-5"><Skeleton className="h-60" /></div> : (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Outcome value={call.status === 'active' ? undefined : call.outcome} t={t} />
            <Badge tone="info">{call.lang.toUpperCase()}</Badge>
            {call.brand && <Badge>{call.brand}</Badge>}
            {call.from && call.from !== 'anonymous' && <a href={`tel:${call.from}`} className="ml-auto text-sm font-semibold text-info-2 hover:underline">{t('Rappeler', 'Call back')}</a>}
          </div>
          <div className="text-xs text-ink-3">{t('Chemin', 'Path')} : <span className="font-mono">{call.path.map((p) => p.node).join(' → ') || '—'}</span></div>
          {d.refs.map((r) => (
            <div key={r.id} className="rounded-md border border-line p-3 text-sm">
              <div className="mb-1 text-xs font-bold text-ink-3 uppercase">{t('Commande de plateforme', 'Platform order')}</div>
              {PLATFORM_NAME[r.platform]} · <span className="num font-bold">{r.orderId || t('(sans numéro)', '(no number)')}</span> · {r.next === 'transfer' ? `${t('transféré à', 'transferred to')} ${r.transferredTo}` : r.next === 'sms_link' ? t('lien d’aide texté', 'help link texted') : '—'}{r.note ? ` · ${r.note}` : ''}
            </div>
          ))}
          {d.tickets.map((x) => (
            <div key={x.id} className="rounded-md border border-line p-3 text-sm">
              <div className="mb-1 flex items-center gap-2"><Badge tone={x.status === 'open' ? 'wait' : 'go'}>{t(...(CATEGORY[x.category] ?? CATEGORY.other))}</Badge>
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onTicket(x.id, x.status === 'open' ? 'done' : 'open')}>{x.status === 'open' ? t('Marquer fait', 'Mark done') : t('Rouvrir', 'Reopen')}</Button></div>
              {x.summary}{x.orderRef ? ` · ${x.orderRef}` : ''}
            </div>
          ))}
          {call.voicemail && (
            <div className="rounded-md border border-line p-3 text-sm">
              <div className="mb-2 text-xs font-bold text-ink-3 uppercase">{t('Message vocal', 'Voicemail')} · {call.voicemail.durationSec ?? '?'} s</div>
              {call.voicemail.recordingUrl && <audio controls preload="none" className="mb-2 w-full" src={`/api/foodhub/phone/ivr/recording?id=${encodeURIComponent(call.id)}`} />}
              <div className="text-ink-2">{call.voicemail.transcript || t('(pas de transcription)', '(no transcript)')}</div>
            </div>
          )}
          <div className="space-y-2">
            {call.transcript.map((m, i) => m.who === 'system'
              ? <div key={i} className="text-center text-xs text-ink-4">— {m.text} —</div>
              : (
                <div key={i} className={cn('flex gap-2', m.who === 'caller' ? 'justify-end' : 'justify-start')}>
                  {m.who === 'agent' && <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-2"><Bot className="size-3.5" /></span>}
                  <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm', m.who === 'caller' ? 'rounded-br-sm bg-ink text-canvas' : 'rounded-bl-sm bg-sunken text-ink')}>{m.text}</div>
                  {m.who === 'caller' && <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-ink-3"><User className="size-3.5" /></span>}
                </div>
              ))}
          </div>
          {call.usage && <p className="text-xs text-ink-4">{t('IA', 'AI')} : {call.usage.requests} {t('requêtes', 'requests')} · {call.usage.inputTokens + call.usage.outputTokens} tokens</p>}
        </div>
      )}
    </Drawer>
  );
}
