'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BellOff, Bot, Check, CheckCheck, ChevronDown, Hand, Mail, MessageSquare, MessageSquareText, Phone, RefreshCw, Settings2, ShieldCheck, Sparkles, Smartphone } from 'lucide-react';
import { Hint } from '@/components/help/hint';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { refreshEverything, useRefreshOn } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { api, ApiError, ago, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { Incident } from '@/lib/foodhub/watch/types';
import type { OutboxEntry } from '@/lib/foodhub/notify';
import { cn } from '@/lib/ui/cn';

type Channels = { email: boolean; sms: boolean; call: boolean; chat: boolean; ai: boolean };
const SEV = { critical: 'bg-stop', warning: 'bg-wait', info: 'bg-info' } as const;

export function AlertsView() {
  const { t, loc } = useI18n();
  const { can } = useViewer();
  const params = useSearchParams();
  const toast = useToast();
  const [tab, setTab] = useState<'open' | 'resolved' | 'messages'>('open');
  const [list, setList] = useState<Incident[] | null>(null);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [messages, setMessages] = useState<OutboxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const focus = params.get('i');

  const load = useCallback(async () => {
    const d = await api<{ incidents: Incident[] }>(`/api/foodhub/incidents?days=3`).catch(() => null);
    if (d) setList(d.incidents);
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 10_000); return () => clearInterval(i); }, [load]);
  useRefreshOn(load);
  useEffect(() => { api<{ channels: Channels }>('/api/foodhub/watch/settings').then((d) => setChannels(d.channels)).catch(() => undefined); }, []);
  useEffect(() => { if (tab === 'messages') api<{ messages: OutboxEntry[] }>('/api/foodhub/messages').then((d) => setMessages(d.messages)).catch(() => undefined); }, [tab]);

  async function checkNow() {
    setBusy(true);
    try { const r = await api<{ report: { opened: number; resolved: number; open: number } }>('/api/foodhub/watch/run', { method: 'POST' }); toast.success(t('Vérification faite', 'Checked'), t(`${r.report.opened} nouvelle(s) · ${r.report.resolved} réglée(s) · ${r.report.open} ouverte(s)`, `${r.report.opened} new · ${r.report.resolved} fixed · ${r.report.open} open`)); await load(); refreshEverything(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const open = (list ?? []).filter((i) => i.status !== 'resolved');
  const resolved = (list ?? []).filter((i) => i.status === 'resolved');
  const shown = tab === 'open' ? open : resolved;

  return (
    <div>
      <PageHeader title={t('Alertes', 'Alerts')} subtitle={t('Le Watchtower surveille commandes, tablettes, magasins, Clover et paiements jour et nuit — et vous prévient : à l’écran, par texto, par appel, puis le propriétaire.', 'The Watchtower watches orders, tablets, stores, Clover and payouts day and night — and alerts you: on screen, by text, by call, then the owner.')}
        right={<><Hint id="incident.check"><Button variant="outline" loading={busy} onClick={checkNow} icon={<RefreshCw className="size-4" />}>{t('Vérifier maintenant', 'Check now')}</Button></Hint><ButtonLink href="/settings/alerts" variant="primary" icon={<Settings2 className="size-4" />}>{t('Règles', 'Rules')}</ButtonLink></>} />

      {channels && (
        <div className="mb-5 flex flex-wrap gap-2">
          {([['sms', t('Textos', 'SMS'), Smartphone], ['call', t('Appels', 'Calls'), Phone], ['chat', t('Clavardage équipe', 'Team chat'), MessageSquare], ['email', t('Courriel', 'Email'), Mail], ['ai', 'Claude', Sparkles]] as const).map(([k, label, Icon]) => (
            <span key={k} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold', channels[k] ? 'border-go/30 bg-go-soft text-go-2' : 'border-line bg-surface text-ink-3')} title={channels[k] ? t('branché', 'connected') : t('pas branché — voir Réglages → Canaux', 'not connected — see Settings → Channels')}>
              <Icon className="size-4" />{label}{channels[k] ? <Check className="size-3.5" /> : <span className="text-xs font-normal">· {t('à brancher', 'not set')}</span>}
            </span>
          ))}
        </div>
      )}

      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ key: 'open', label: t('Ouvertes', 'Open'), count: open.length }, { key: 'resolved', label: t('Réglées (3 jours)', 'Fixed (3 days)'), count: resolved.length }, ...(can('stores:map') ? [{ key: 'messages' as const, label: t('Messages envoyés', 'Messages sent') }] : [])]} />

      {tab !== 'messages' && (
        list === null ? <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-sunken" />)}</div>
          : shown.length === 0 ? <Card><EmptyState icon={<ShieldCheck className="size-6 text-go" />} title={tab === 'open' ? t('Tout roule', 'All good') : t('Rien de réglé récemment', 'Nothing fixed recently')} body={tab === 'open' ? t('Aucune alerte ouverte. Le Watchtower continue de surveiller.', 'No open alert. The Watchtower keeps watching.') : undefined} /></Card>
            : <div className="space-y-3">{shown.map((i) => <IncidentCard key={i.id} i={i} focus={focus === i.id} onChanged={load} />)}</div>
      )}

      {tab === 'messages' && (
        <Card>
          <div className="divide-y divide-line">
            {messages.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="w-28 text-xs text-ink-3">{timeOf(m.at, loc, true)}</span>
                <Badge tone="neutral">{m.channel === 'sms' ? 'SMS' : m.channel === 'call' ? t('Appel', 'Call') : m.channel === 'chat' ? 'Chat' : 'Email'}</Badge>
                <span className="w-36 truncate font-mono text-xs">{m.to}</span>
                <span className="text-xs text-ink-3">{m.purpose}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{m.preview ?? '—'}</span>
                <Badge tone={m.ok ? 'go' : m.skipped ? 'neutral' : 'stop'} title={m.message}>{m.ok ? t('envoyé', 'sent') : m.skipped ? t('non branché', 'not set up') : t('échec', 'failed')}</Badge>
              </div>
            ))}
            {messages.length === 0 && <EmptyState title={t('Aucun message envoyé', 'No message sent')} body={t('Les codes de connexion ne sont jamais conservés ici.', 'Sign-in codes are never kept here.')} />}
          </div>
        </Card>
      )}
    </div>
  );
}

function IncidentCard({ i, focus, onChanged }: { i: Incident; focus: boolean; onChanged: () => void }) {
  const { t, lang, loc } = useI18n();
  const { can, locName } = useViewer();
  const toast = useToast();
  const [open, setOpen] = useState(focus || i.severity === 'critical');
  const [busy, setBusy] = useState('');
  const [texting, setTexting] = useState(false);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    try { await api('/api/foodhub/incidents', { method: 'POST', json: { id: i.id, action, ...extra } }); onChanged(); refreshEverything(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const levels = [t('Écran', 'Screen'), 'SMS', t('Appel', 'Call'), t('Propriétaire', 'Owner')];
  const explanation = (i.explanation ?? '').split('\n\n');
  const text = lang === 'fr' ? explanation[0] : explanation[1] ?? explanation[0];
  return (
    <Card className={cn('overflow-hidden', focus && 'ring-2 ring-brand', i.status === 'resolved' && 'opacity-75')}>
      <div className="flex">
        <div className={cn('w-1.5 shrink-0', SEV[i.severity])} />
        <div className="min-w-0 flex-1">
          <Hint id="incident.card"><button type="button" onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-start gap-3 px-5 py-4 text-left">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{lang === 'fr' ? i.title : i.titleEn}</span>
                {i.status === 'acknowledged' && <Badge tone="info" icon={<Hand className="size-3" />}>{t('pris en charge par', 'on it:')} {i.ackBy}</Badge>}
                {i.status === 'snoozed' && <Badge tone="neutral" icon={<BellOff className="size-3" />}>{t('sourdine jusqu’à', 'snoozed until')} {timeOf(i.snoozedUntil, loc)}</Badge>}
                {i.status === 'resolved' && <Badge tone="go" icon={<CheckCheck className="size-3" />}>{i.resolvedBy === 'auto' ? t('réglé tout seul', 'fixed itself') : `${t('réglé par', 'fixed by')} ${i.resolvedBy}`}</Badge>}
              </div>
              <div className="mt-0.5 text-[13px] text-ink-3">{[lang === 'fr' ? i.detail : i.detailEn ?? i.detail, i.locationCode ? shortLoc(locName(i.locationCode)) : null, ago(i.openedAt, lang)].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="flex items-center gap-1" title={t('Escalade', 'Escalation')}>
              {levels.map((l, k) => <span key={l} className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', k <= i.level && i.status !== 'resolved' ? (k === 0 ? 'bg-ink text-canvas' : 'bg-stop text-white') : 'bg-sunken text-ink-4')}>{l}</span>)}
            </div>
            <ChevronDown className={cn('size-5 text-ink-3 transition-transform', open && 'rotate-180')} />
          </button></Hint>
          {open && (
            <div className="border-t border-line px-5 py-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
                <div>
                  <div className="flex items-start gap-2 text-sm text-ink-2">{i.steps.some((s) => s.kind === 'ai') ? <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" /> : <Bot className="mt-0.5 size-4 shrink-0 text-ink-3" />}<p className="whitespace-pre-line">{text}</p></div>
                  {i.suggestions && i.suggestions.length > 0 && lang === 'fr' && <ul className="mt-3 space-y-1">{i.suggestions.map((s) => <li key={s} className="flex items-start gap-2 text-sm"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{s}</li>)}</ul>}
                  {i.status !== 'resolved' && can('orders:act') && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {i.orderId && <ButtonLink href={`/orders?open=${i.orderId}`} variant="primary" size="sm">{t('Ouvrir la commande', 'Open the order')}</ButtonLink>}
                      {i.storeId && <ButtonLink href="/stores" variant="primary" size="sm">{t('Voir le magasin', 'See the store')}</ButtonLink>}
                      {i.deviceId && <ButtonLink href="/settings/devices" variant="primary" size="sm">{t('Voir la tablette', 'See the tablet')}</ButtonLink>}
                      {i.kind === 'webhook_unreadable' && <ButtonLink href="/settings/channels" variant="primary" size="sm">{t('Ouvrir la boîte de réception', 'Open the webhook inbox')}</ButtonLink>}
                      {i.kind === 'store_unmapped' && <ButtonLink href="/stores/mapping" variant="primary" size="sm">{t('Relier le magasin', 'Link the store')}</ButtonLink>}
                      {i.kind === 'payout_gap' && <ButtonLink href="/money/disputes" variant="primary" size="sm">{t('Voir les litiges', 'See disputes')}</ButtonLink>}
                      {i.status !== 'acknowledged' && <Hint id="incident.ack"><Button size="sm" variant="outline" loading={busy === 'ack'} onClick={() => act('ack')} icon={<Hand className="size-4" />}>{t('Je m’en occupe', 'I’m on it')}</Button></Hint>}
                      <Button size="sm" variant="go" loading={busy === 'resolve'} onClick={() => act('resolve')} icon={<Check className="size-4" />}>{t('Réglé', 'Fixed')}</Button>
                      <Hint id="incident.snooze"><Button size="sm" variant="ghost" loading={busy === 'snooze'} onClick={() => act('snooze', { minutes: 30 })} icon={<BellOff className="size-4" />}>{t('Sourdine 30 min', 'Snooze 30 min')}</Button></Hint>
                      {i.kind === 'order_late' && i.customer?.phone && <Button size="sm" variant="outline" onClick={() => setTexting(true)} icon={<MessageSquareText className="size-4" />}>{t('Texter le client', 'Text the customer')}</Button>}
                    </div>
                  )}
                  {i.status === 'resolved' && can('orders:act') && <Button size="sm" variant="ghost" className="mt-3" onClick={() => act('reopen')}>{t('Rouvrir', 'Reopen')}</Button>}
                </div>
                <ol className="space-y-2 border-l border-line pl-4 text-[13px]">
                  {i.steps.slice(-10).map((s, k) => (
                    <li key={k} className="relative">
                      <span className={cn('absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface', s.ok === false ? 'bg-stop' : s.kind === 'resolved' ? 'bg-go' : 'bg-ink-4')} />
                      <span className="num text-xs text-ink-3">{timeOf(s.at, loc)}</span> <span className="font-semibold">{stepLabel(t, s.kind)}</span>{s.to ? ` → ${s.to}` : ''}{s.by ? ` · ${s.by}` : ''}
                      {s.message && <div className="text-xs text-ink-3">{stepMessage(t, s.message)}</div>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
      {texting && <TextDialog i={i} onClose={() => setTexting(false)} onSent={() => { setTexting(false); onChanged(); }} />}
    </Card>
  );
}

function stepLabel(t: (a: string, b: string) => string, k: string) {
  return ({ opened: t('Ouverte', 'Opened'), screen: t('À l’écran', 'On screen'), sms: 'SMS', call: t('Appel', 'Call'), chat: 'Chat', email: 'Email', owner: t('Propriétaire', 'Owner'), ack: t('Prise en charge', 'Acknowledged'), snooze: t('Sourdine', 'Snoozed'), resolved: t('Réglée', 'Fixed'), reopened: t('Rouverte', 'Reopened'), note: 'Note', customer_sms: t('Texto client', 'Customer text'), ai: 'Claude' } as Record<string, string>)[k] ?? k;
}

function TextDialog({ i, onClose, onSent }: { i: Incident; onClose: () => void; onSent: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [text, setText] = useState((lang === 'fr' ? i.customer?.draftFr : i.customer?.draftEn) ?? '');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { await api('/api/foodhub/incidents', { method: 'POST', json: { id: i.id, action: 'customer_sms', text } }); toast.success(t('Texto envoyé', 'Text sent')); onSent(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={t('Prévenir le client', 'Let the customer know')} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button loading={busy} disabled={!text.trim()} onClick={send}>{t('Envoyer', 'Send')}</Button></>}>
      <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={320} />
      <p className="mt-2 text-xs text-ink-3">{t('Seulement si la plateforme partage un numéro texto. Un gérant peut devoir approuver. Jamais de publicité.', 'Only when the platform shares a textable number. A manager may need to approve. Never marketing.')}</p>
      <Link href={`/orders?open=${i.orderId}`} className="mt-3 inline-block text-[13px] font-semibold underline">{t('Ou appeler depuis la commande', 'Or call from the order')}</Link>
    </Modal>
  );
}

const STEP_MSG: Record<string, [string, string]> = { Sent: ['Envoyé', 'Sent'], Calling: ['Appel lancé', 'Calling'], Posted: ['Publié', 'Posted'] };
function stepMessage(t: (fr: string, en: string) => string, m: string) { const x = STEP_MSG[m]; return x ? t(x[0], x[1]) : m; }
