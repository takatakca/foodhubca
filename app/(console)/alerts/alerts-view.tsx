'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BellOff, Bot, Check, CheckCheck, ChevronDown, Hand, MessageSquareText, RefreshCw, Send, Settings2, ShieldCheck, Sparkles } from 'lucide-react';
import { Hint } from '@/components/help/hint';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, SkeletonList } from '@/components/ui/card';
import { Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { refreshEverything, usePulse } from '@/components/live/pulse';
import { useScopedIncidents } from '@/components/live/scoped-incidents';
import { ChannelLine, EscalationLevels, type AlertChannels } from '@/components/live/alert-parts';
import { incidentStepText, plurals } from '@/components/live/words';
import { useScopeLabel } from '@/components/shell/scope-switcher';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { api, ApiError, ago, timeOf } from '@/lib/ui/api';
import { useI18n, useProduct } from '@/lib/i18n/client';
import type { Incident } from '@/lib/foodhub/watch/types';
import type { OutboxEntry } from '@/lib/foodhub/notify';
import { cn } from '@/lib/ui/cn';

type Channels = AlertChannels;
const SEV = { critical: 'bg-stop', warning: 'bg-wait', info: 'bg-info' } as const;

export function AlertsView() {
  const { t, loc } = useI18n();
  const product = useProduct();
  const { can, full } = useViewer();
  const { setSite } = usePulse();
  const label = useScopeLabel();
  const params = useSearchParams();
  const toast = useToast();
  const [tab, setTab] = useState<'open' | 'resolved' | 'messages'>('open');
  const [channels, setChannels] = useState<Channels | null>(null);
  const [messages, setMessages] = useState<OutboxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const focus = params.get('i');

  // The alerts of the console's scope: location on the server, brand and platform here (an alert for the whole location
  // always shows). The bell keeps counting every alert of the location.
  const { list, filtered, reload: load } = useScopedIncidents({ status: '', days: 3, poll: 10_000, focusId: focus });
  const seeAll = () => setSite({ kitchen: null, brand: null, channel: undefined });
  useEffect(() => { api<{ channels: Channels }>('/api/foodhub/watch/settings').then((d) => setChannels(d.channels)).catch(() => undefined); }, []);
  useEffect(() => { if (tab === 'messages') api<{ messages: OutboxEntry[] }>('/api/foodhub/messages').then((d) => setMessages(d.messages)).catch(() => undefined); }, [tab]);

  async function checkNow() {
    setBusy(true);
    try { const r = await api<{ report: { opened: number; resolved: number; open: number } }>('/api/foodhub/watch/run', { method: 'POST' }); toast.success(t('Vérification faite', 'Checked'), checkSummary(t, r.report)); await load(); refreshEverything(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const open = (list ?? []).filter((i) => i.status !== 'resolved');
  const resolved = (list ?? []).filter((i) => i.status === 'resolved');
  const shown = tab === 'open' ? open : resolved;

  return (
    <div>
      <PageHeader title={t('Alertes', 'Alerts')} subtitle={t(`${product.name} surveille commandes, tablettes, magasins, Clover et paiements jour et nuit — et vous prévient : à l’écran, par texto, par appel, puis le propriétaire.`, `${product.name} watches orders, tablets, stores, Clover and payouts day and night — and alerts you: on screen, by text, by call, then the owner.`)}
        right={<>{full && <Hint id="incident.check"><Button variant="outline" loading={busy} onClick={checkNow} icon={<RefreshCw className="size-4" />}>{t('Vérifier maintenant', 'Check now')}</Button></Hint>}<ButtonLink href="/settings/alerts" variant="primary" icon={<Settings2 className="size-4" />}>{t('Règles', 'Rules')}</ButtonLink></>} />

      {channels && <ChannelLine channels={channels} />}

      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ key: 'open', label: t('Ouvertes', 'Open'), count: open.length }, { key: 'resolved', label: t('Réglées (3 jours)', 'Fixed (3 days)'), count: resolved.length }, ...(can('stores:map') ? [{ key: 'messages' as const, label: t('Messages envoyés', 'Messages sent') }] : [])]} />

      {tab !== 'messages' && filtered && (
        <div className="text-small mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">{t(`Filtré : ${label.words}`, `Filtered: ${label.words}`)}<span aria-hidden>·</span><button type="button" onClick={seeAll} className="min-h-11 font-semibold text-brand hover:underline">{t('Voir toutes les alertes', 'See every alert')}</button></div>
      )}
      {tab !== 'messages' && (
        list === null ? <SkeletonList count={3} />
          : shown.length === 0 ? <Card>{filtered && tab === 'open'
            ? <EmptyState icon={<ShieldCheck className="size-6 text-go" />} title={t(`Aucune alerte pour ${label.words}.`, `No alert for ${label.words}.`)} action={<Button variant="outline" size="lg" onClick={seeAll}>{t('Voir toutes les alertes', 'See every alert')}</Button>} />
            : <EmptyState icon={<ShieldCheck className="size-6 text-go" />} title={tab === 'open' ? t('Tout roule. Rien à faire.', 'All good. Nothing to do.') : t('Rien de réglé récemment', 'Nothing fixed recently')} body={tab === 'open' ? t(`${product.name} continue de surveiller.`, `${product.name} keeps watching.`) : undefined} />}</Card>
            : <div className="space-y-3">{shown.map((i, k) => <IncidentCard key={i.id} i={i} focus={focus === i.id} defaultOpen={focus ? focus === i.id : k === 0} onChanged={load} />)}</div>
      )}

      {tab === 'messages' && (
        <Card>
          <div className="divide-y divide-line">
            {messages.map((m) => (
              <div key={m.id} className="text-body flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="num text-small w-32 text-ink-3">{timeOf(m.at, loc, true)}</span>
                <Badge tone="neutral">{m.channel === 'sms' ? 'SMS' : m.channel === 'call' ? t('Appel', 'Call') : m.channel === 'chat' ? 'Chat' : 'Email'}</Badge>
                <span className="text-small w-36 truncate font-mono">{m.to}</span>
                <span className="text-small text-ink-3">{m.purpose}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{m.preview ?? '—'}</span>
                <Badge tone={m.ok ? 'go' : m.skipped ? 'neutral' : 'stop'} title={m.message}>{m.ok ? t('envoyé', 'sent') : m.skipped ? t('non branché', 'not set up') : t('échec', 'failed')}</Badge>
              </div>
            ))}
            {messages.length === 0 && <EmptyState icon={<Send className="size-6" />} title={t('Aucun message envoyé', 'No message sent')} body={t('Les codes de connexion ne sont jamais conservés ici.', 'Sign-in codes are never kept here.')} action={<ButtonLink href="/settings/channels" variant="outline" size="lg">{t('Voir les canaux', 'See the channels')}</ButtonLink>} />}
          </div>
        </Card>
      )}
    </div>
  );
}

function IncidentCard({ i, focus, defaultOpen, onChanged }: { i: Incident; focus: boolean; defaultOpen: boolean; onChanged: () => void }) {
  const { t, lang, loc } = useI18n();
  const { can, locName } = useViewer();
  const toast = useToast();
  // Only the first alert (or the one a link points to) opens by itself: the others show their title and open on a tap.
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState('');
  const [texting, setTexting] = useState(false);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    try { await api('/api/foodhub/incidents', { method: 'POST', json: { id: i.id, action, ...extra } }); onChanged(); refreshEverything(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const explanation = (i.explanation ?? '').split('\n\n');
  // The actions of this alert: the first link is its primary, the others are outlined; with no link, "Réglé" is the one
  // filled button, so every alert keeps one main action.
  const links = [
    i.orderId ? { href: `/orders?open=${i.orderId}`, label: t('Ouvrir la commande', 'Open the order') } : null,
    i.storeId ? { href: '/stores', label: t('Voir le magasin', 'See the store') } : null,
    i.deviceId ? { href: '/settings/devices', label: t('Voir la tablette', 'See the tablet') } : null,
    i.kind === 'webhook_unreadable' ? { href: '/settings/channels', label: t('Voir les messages des plateformes', 'See the platform messages') } : null,
    i.kind === 'store_unmapped' ? { href: '/stores/mapping', label: t('Relier le magasin', 'Link the store') } : null,
    i.kind === 'payout_gap' ? { href: '/money/disputes', label: t('Voir les litiges', 'See disputes') } : null,
  ].filter((l): l is { href: string; label: string } => l !== null);
  const text = lang === 'fr' ? explanation[0] : explanation[1] ?? explanation[0];
  return (
    <Card className={cn('overflow-hidden', focus && 'ring-2 ring-brand', i.status === 'resolved' && 'opacity-75')}>
      <div className="flex">
        <div className={cn('w-1.5 shrink-0', SEV[i.severity])} />
        <div className="min-w-0 flex-1">
          <Hint id="incident.card"><button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="grid w-full grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 px-5 py-4 text-left sm:grid-cols-[1fr_auto_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-bold text-ink">{lang === 'fr' ? i.title : i.titleEn}</span>
                {i.status === 'acknowledged' && <Badge tone="info" icon={<Hand className="size-3" />}>{t('pris en charge par', 'on it:')} {i.ackBy}</Badge>}
                {i.status === 'snoozed' && <Badge tone="neutral" icon={<BellOff className="size-3" />}>{t('sourdine jusqu’à', 'snoozed until')} {timeOf(i.snoozedUntil, loc)}</Badge>}
                {i.status === 'resolved' && <Badge tone="go" icon={<CheckCheck className="size-3" />}>{i.resolvedBy === 'auto' ? t('réglé tout seul', 'fixed itself') : `${t('réglé par', 'fixed by')} ${i.resolvedBy}`}</Badge>}
              </div>
              <div className="text-small mt-0.5 text-ink-3">{[lang === 'fr' ? i.detail : i.detailEn ?? i.detail, i.locationCode ? shortLoc(locName(i.locationCode)) : null, ago(i.openedAt, lang)].filter(Boolean).join(' · ')}</div>
            </div>
            {/* Phone: the escalation steps go under the title (row 2); from sm they take their own column. */}
            <EscalationLevels level={i.level} resolved={i.status === 'resolved'} className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1" />
            <ChevronDown aria-hidden className={cn('col-start-2 row-start-1 size-5 text-ink-3 motion-safe:transition-transform sm:col-start-3', open && 'rotate-180')} />
          </button></Hint>
          {open && (
            <div className="border-t border-line px-5 py-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
                <div>
                  <div className="text-body flex items-start gap-2 text-ink-2">{i.steps.some((s) => s.kind === 'ai') ? <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" /> : <Bot className="mt-0.5 size-4 shrink-0 text-ink-3" />}<p className="whitespace-pre-line">{text}</p></div>
                  {i.suggestions && i.suggestions.length > 0 && lang === 'fr' && <ul className="mt-3 space-y-1">{i.suggestions.map((s) => <li key={s} className="text-body flex items-start gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{s}</li>)}</ul>}
                  {i.status !== 'resolved' && can('orders:act') && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {links.map((l, k) => <ButtonLink key={l.href} href={l.href} variant={k === 0 ? 'primary' : 'outline'}>{l.label}</ButtonLink>)}
                      {i.status !== 'acknowledged' && <Hint id="incident.ack"><Button variant="outline" loading={busy === 'ack'} onClick={() => act('ack')} icon={<Hand className="size-4" />}>{t('Je m’en occupe', 'I’m on it')}</Button></Hint>}
                      <Button variant={links.length ? 'outline' : 'go'} loading={busy === 'resolve'} onClick={() => act('resolve')} icon={<Check className="size-4" />}>{t('Réglé', 'Fixed')}</Button>
                      <Hint id="incident.snooze"><Button variant="ghost" loading={busy === 'snooze'} onClick={() => act('snooze', { minutes: 30 })} icon={<BellOff className="size-4" />}>{t('Sourdine 30 min', 'Snooze 30 min')}</Button></Hint>
                      {i.kind === 'order_late' && i.customer?.phone && <Button variant="outline" onClick={() => setTexting(true)} icon={<MessageSquareText className="size-4" />}>{t('Texter le client', 'Text the customer')}</Button>}
                    </div>
                  )}
                  {i.status === 'resolved' && can('orders:act') && <Button variant="ghost" className="mt-3" onClick={() => act('reopen')}>{t('Rouvrir', 'Reopen')}</Button>}
                </div>
                <ol className="text-small space-y-2 border-l border-line pl-4">
                  {i.steps.slice(-10).map((s, k) => (
                    <li key={k} className="relative">
                      <span className={cn('absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface', s.ok === false ? 'bg-stop' : s.kind === 'resolved' ? 'bg-go' : 'bg-ink-4')} />
                      <span className="num text-ink-3">{timeOf(s.at, loc)}</span> <span className="font-semibold">{stepLabel(t, s.kind)}</span>{s.to ? ` → ${s.to}` : ''}{s.by ? ` · ${s.by}` : ''}
                      {s.message && <div className="text-ink-3">{incidentStepText(lang, s.message)}</div>}
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
      <p className="text-small mt-2 text-ink-3">{t('Seulement si la plateforme partage un numéro texto. Un gérant peut devoir approuver. Jamais de publicité.', 'Only when the platform shares a textable number. A manager may need to approve. Never marketing.')}</p>
      <Link href={`/orders?open=${i.orderId}`} className="text-small mt-3 inline-flex min-h-11 items-center font-semibold underline">{t('Ou appeler depuis la commande', 'Or call from the order')}</Link>
    </Modal>
  );
}

/** "2 nouvelles · 1 réglée · 3 ouvertes" after a manual check. */
function checkSummary(t: (fr: string, en: string) => string, r: { opened: number; resolved: number; open: number }) {
  const a = plurals(r.opened, ['nouvelle'], ['new', 'new']);
  const b = plurals(r.resolved, ['réglée'], ['fixed', 'fixed']);
  const c = plurals(r.open, ['ouverte'], ['open', 'open']);
  return t(`${a[0]} · ${b[0]} · ${c[0]}`, `${a[1]} · ${b[1]} · ${c[1]}`);
}
