'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Headset, PhoneCall, PhoneIncoming, RotateCcw, Send, ShoppingBag, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Banner, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stat } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { Drawer } from '@/components/ui/overlay';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { CALL_TONE, callStatusLabel } from '@/components/expansion/labels';
import type { PhoneCall as Call } from '@/lib/foodhub/phone/calls';
import { api, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { DirectTabs } from '../direct-tabs';

type Line = { id: string; name: string; number: string; locationCode: string; enabled: boolean };
type Row = Omit<Call, 'transcript' | 'messages'> & { transcriptLength: number };

export default function CallsPage() {
  const { t, loc } = useI18n();
  const { features, can } = useViewer();
  const [calls, setCalls] = useState<Row[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const on = features.includes('phone');

  const load = useCallback(() => {
    api<{ calls: Row[] }>('/api/foodhub/phone/calls?days=7').then((d) => { setCalls(d.calls); setErr(''); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    api<{ settings: { lines: Line[] } }>('/api/foodhub/phone').then((d) => setLines(d.settings.lines)).catch(() => undefined);
  }, []);
  useEffect(() => { if (!on) return; load(); const i = setInterval(load, 20_000); return () => clearInterval(i); }, [load, on]);

  if (!on) return <div><PageHeader eyebrow={t('Nos commandes', 'Own orders')} title={t('Commandes par téléphone (IA)', 'AI phone ordering')} /><DirectTabs /><EmptyState icon={<PhoneCall className="size-6" />} title={t('Les commandes par téléphone sont désactivées', 'Phone ordering is turned off')} body={t('Le propriétaire l’active dans Réglages → Expansion.', 'The owner turns it on in Settings → Expansion.')} /></div>;

  const today = (calls ?? []).filter((c) => new Date(c.startedAt).toDateString() === new Date().toDateString());
  const missed = (calls ?? []).filter((c) => c.status === 'handoff_missed');
  return (
    <div>
      <PageHeader eyebrow={t('Nos commandes', 'Own orders')} title={t('Appels et agent IA', 'Calls & AI agent')}
        subtitle={t('L’agent répond, prend la commande dans le menu, confirme le total et l’envoie à Clover. Il passe l’appel à un humain sur demande — il ne rembourse, n’annule et n’accorde jamais rien.', 'The agent answers, takes the order from the menu, confirms the total and sends it to Clover. It hands the call to a person on request — it never refunds, cancels or grants anything.')}
        right={can('admin') ? <ButtonLink href="/settings/expansion/phone" variant="outline" size="sm">{t('Lignes et voix', 'Lines & voice')}</ButtonLink> : undefined} />
      <DirectTabs />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {missed.length > 0 && <Banner tone="stop" className="mb-4">{t(`${missed.length} appel(s) à rappeler : personne n’a pris le transfert.`, `${missed.length} call(s) to return: nobody took the hand-off.`)}</Banner>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Appels aujourd’hui', 'Calls today')} value={calls ? String(today.length) : '—'} icon={<PhoneIncoming className="size-4" />} />
        <Stat label={t('Commandes passées', 'Orders placed')} value={calls ? String(today.filter((c) => c.orderId).length) : '—'} icon={<ShoppingBag className="size-4" />} tone="go" />
        <Stat label={t('Transférés', 'Handed off')} value={calls ? String(today.filter((c) => c.status === 'handoff' || c.status === 'handoff_missed').length) : '—'} icon={<Headset className="size-4" />} />
        <Stat label={t('Conversion', 'Conversion')} value={calls && today.length ? `${Math.round((today.filter((c) => c.orderId).length / today.length) * 100)} %` : '—'} icon={<Bot className="size-4" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title={t('Journal des appels (7 jours)', 'Call log (7 days)')} icon={<PhoneCall className="size-5" />} />
          {!calls ? <div className="p-5"><Skeleton className="h-40" /></div> : !calls.length ? <EmptyState title={t('Aucun appel encore', 'No calls yet')} body={t('Les appels sur vos lignes Twilio apparaissent ici avec la transcription.', 'Calls on your Twilio lines show up here with their transcript.')} /> : (
            <Table>
              <thead><tr><Th>{t('Heure', 'Time')}</Th><Th>{t('Ligne', 'Line')}</Th><Th>{t('Appelant', 'Caller')}</Th><Th>{t('Résultat', 'Outcome')}</Th><Th align="right">{t('Durée', 'Length')}</Th></tr></thead>
              <tbody>
                {calls.map((c) => (
                  <Tr key={c.id} className="cursor-pointer" onClick={() => setOpen(c.id)}>
                    <Td className="whitespace-nowrap">{timeOf(c.startedAt, loc, true)}</Td>
                    <Td>{c.lineName}</Td>
                    <Td className="num">{c.from}{c.lang === 'en' && <Badge tone="info" className="ml-1.5">EN</Badge>}</Td>
                    <Td><Badge tone={CALL_TONE[c.status] ?? 'neutral'}>{callStatusLabel(t, c.status)}</Badge>{c.orderNumber && <span className="ml-1.5 num text-xs font-bold">{c.orderNumber}</span>}</Td>
                    <Td align="right" className="num">{c.durationSec ? `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, '0')}` : '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        {can('menu:edit') && <TryAgent lines={lines} />}
      </div>
      {open && <CallDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CallDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, loc } = useI18n();
  const [call, setCall] = useState<Call | null>(null);
  useEffect(() => { api<{ call: Call }>(`/api/foodhub/phone/calls?id=${encodeURIComponent(id)}`).then((d) => setCall(d.call)).catch(() => undefined); }, [id]);
  return (
    <Drawer width="lg" onClose={onClose} title={call ? call.lineName : t('Appel', 'Call')} subtitle={call ? `${timeOf(call.startedAt, loc, true)} · ${call.from}` : undefined}>
      {!call ? <Skeleton className="h-60" /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CALL_TONE[call.status] ?? 'neutral'}>{callStatusLabel(t, call.status)}</Badge>
            {call.orderNumber && <Badge tone="go">{t('Commande', 'Order')} {call.orderNumber}</Badge>}
            {call.handoffReason && <Badge tone="violet">{call.handoffReason}</Badge>}
            {call.from && call.from !== 'anonymous' && call.from !== 'console' && <a href={`tel:${call.from}`} className="ml-auto text-sm font-semibold text-info-2 hover:underline">{t('Rappeler', 'Call back')}</a>}
          </div>
          {call.cart.length > 0 && <div className="rounded-md border border-line p-3 text-sm"><div className="mb-1 text-xs font-bold text-ink-3 uppercase">{t('Panier', 'Cart')}</div>{call.cart.map((l, i) => <div key={i}>{l.quantity} × {l.name}{l.modifiers.length ? ` (${l.modifiers.map((m) => m.name).join(', ')})` : ''}</div>)}</div>}
          <Transcript items={call.transcript} />
          {call.usage && <p className="text-xs text-ink-4">{t('IA', 'AI')} : {call.usage.requests} {t('requêtes', 'requests')} · {call.usage.inputTokens + call.usage.outputTokens} tokens ({call.usage.cacheReadTokens} {t('en cache', 'cached')})</p>}
        </div>
      )}
    </Drawer>
  );
}

function Transcript({ items }: { items: Call['transcript'] }) {
  return (
    <div className="space-y-2">
      {items.map((m, i) => m.who === 'system'
        ? <div key={i} className="text-center text-xs text-ink-4">— {m.text} —</div>
        : (
          <div key={i} className={cn('flex gap-2', m.who === 'caller' ? 'justify-end' : 'justify-start')}>
            {m.who === 'agent' && <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-2"><Bot className="size-3.5" /></span>}
            <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm', m.who === 'caller' ? 'rounded-br-sm bg-ink text-canvas' : 'rounded-bl-sm bg-sunken text-ink')}>{m.text}</div>
            {m.who === 'caller' && <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-ink-3"><User className="size-3.5" /></span>}
          </div>
        ))}
    </div>
  );
}

/** Type what a caller would say: same agent, menu and rules as a real call — the order is never sent. */
function TryAgent({ lines }: { lines: Line[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const [lineId, setLineId] = useState('');
  const [session, setSession] = useState<Call | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!lineId && lines[0]) setLineId(lines[0].id); }, [lines, lineId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [session?.transcript.length]);

  async function send(msg: string, fresh = false) {
    setBusy(true);
    try {
      const r = await api<{ call: Call }>('/api/foodhub/phone/simulate', { method: 'POST', json: { lineId, sessionId: fresh ? null : session?.id ?? null, text: msg } });
      setSession(r.call); setText('');
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader title={t('Essayer l’agent', 'Try the agent')} subtitle={t('Écrivez comme un client au téléphone. Rien n’est envoyé à la cuisine.', 'Type like a caller would speak. Nothing is sent to the kitchen.')} icon={<Bot className="size-5" />}
        right={session ? <Button size="xs" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setSession(null)}>{t('Recommencer', 'Restart')}</Button> : undefined} />
      <div className="flex flex-1 flex-col gap-3 px-5 pb-5">
        {!lines.length ? <Banner tone="info">{t('Ajoutez d’abord une ligne téléphonique (Réglages → Expansion → Téléphone).', 'Add a phone line first (Settings → Expansion → Phone).')}</Banner> : !session ? (
          <div className="flex flex-wrap items-end gap-2">
            <Select value={lineId} onChange={(e) => setLineId(e.target.value)} className="min-w-48 flex-1">{lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
            <Button loading={busy} icon={<PhoneIncoming className="size-4" />} onClick={() => send('', true)}>{t('Appeler', 'Call')}</Button>
          </div>
        ) : (
          <>
            <div className="scrollbar-thin max-h-[420px] min-h-48 overflow-y-auto rounded-md border border-line p-3"><Transcript items={session.transcript} /><div ref={end} /></div>
            {session.cart.length > 0 && <div className="text-xs text-ink-3">{t('Panier', 'Cart')} : {session.cart.map((l) => `${l.quantity}× ${l.name}`).join(', ')}</div>}
            {session.status === 'active'
              ? <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(text.trim()); }}><Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Bonjour, je voudrais un poulet entier…', 'Hi, I’d like a whole chicken…')} disabled={busy} /><Button type="submit" loading={busy} icon={<Send className="size-4" />} aria-label={t('Envoyer', 'Send')} /></form>
              : <Banner tone="info">{t('Appel terminé', 'Call ended')} — {callStatusLabel(t, session.status)}{session.orderNumber === 'TEST' ? ` · ${t('commande test, rien envoyé', 'test order, nothing sent')}` : ''}</Banner>}
          </>
        )}
        <p className="text-[11px] text-ink-4">{t('Utilise le vrai modèle (coût par message, comme un appel).', 'Uses the real model (billed per message, like a call).')}</p>
      </div>
    </Card>
  );
}
