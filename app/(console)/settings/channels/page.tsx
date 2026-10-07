'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Inbox, PlugZap, Printer, RefreshCw, RotateCcw } from 'lucide-react';
import { Badge, PlatformMark, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { Select } from '@/components/ui/form';
import { useViewer } from '@/components/shell/viewer';
import { Section, SettingsHead } from '../settings-ui';
import { api, money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

type Channel = {
  channel: string; label: string; configured: boolean; canSend: boolean; missing: string[]; note: string; noteFr?: string; viaClover?: boolean; webhookUrl: string;
  extraWebhooks: Array<{ label: string; url: string }>;
  handoff: Array<{ label: string; envKey: string; set: boolean; value?: string }>;
};
type CloverMerchant = { merchantId: string; name: string | null; connectedAt: string; refreshedAt: string | null; accessExpiresAt: string | null; refreshExpiresAt: string | null; needsReconnect: boolean; status: 'active' | 'pending' };
type CloverApp = { configured: boolean; appId: string | null; missing: string[]; siteUrl: string; launchPath: string; redirectUri: string; connectUrl: string; merchants: CloverMerchant[]; legal?: { privacy: string; terms: string; support: string } };
type Job = { id: string; kind: string; channel: string; status: string; createdAt: string; reference?: string | null; result?: { message?: string } | null; request?: { body?: unknown } | null };
/** Order inbox record that failed, or never finished, processing (lib/foodhub/inbox.ts InboxView). */
type InboxItem = { id: string; channel: string; externalOrderId: string; displayId: string | null; brandName: string | null; total: number | null; items: number | null; status: string; stuck: boolean; receivedAt: string; attempts: number; error: string | null; lastReplay: { at: string; by: string } | null; deadline: string | null; pastDeadline: boolean };
type ReplayResult = { ok: boolean; status: string; orderId?: string | null; duplicate?: boolean; error?: string | null; already?: boolean };
type Data = {
  mode: string; publicUrl: string; liveEnabled: boolean; dashboardProtected: boolean;
  clover: { configured: boolean; injectionEnabled: boolean; missing: string[]; note: string; noteFr?: string; webhookUrl: string; webhookAuthSet: boolean; verification: { code: string; at: string } | null; recordPayments: boolean; orderTypes: boolean; inventorySync: boolean; app?: CloverApp };
  channels: Channel[]; jobs: Job[]; unparsed: Job[]; inbox?: InboxItem[];
  relay?: { webhookReady: boolean; callbackReady: boolean; channels: string[]; webhookUrl: string; revealed: boolean };
};

function CopyBtn({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line-2 bg-surface px-2 text-xs font-semibold text-ink-2 hover:border-ink-4 hover:text-ink">
      {done ? <Check className="size-3.5 text-go-2" /> : <Copy className="size-3.5" />}{done ? t('Copié', 'Copied') : t('Copier', 'Copy')}
    </button>
  );
}
function UrlRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</div>
      <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-md bg-sunken px-2 py-1.5 font-mono text-xs text-ink" title={value}>{value}</code><CopyBtn text={value} /></div>
    </div>
  );
}

type TaxCheck = { ok: boolean; error?: string; rates: Array<{ id: string; name: string; percent: number; isDefault: boolean }>; defaultPercent: number; problems: string[]; problemsFr?: string[] };
type LabelReport = { merchantId: string; ok: boolean; error?: string; kitchenLabels: Array<{ id: string; name: string; printers: number }>; items: number; unprinted: Array<{ id: string; name: string }>; unprintedCount: number };

/** Clover kitchen printing check: items without a printer label never print (e.g. DoorDash orders through Clover). */
function CloverPrinting() {
  const { t } = useI18n();
  const { can } = useViewer();
  const [data, setData] = useState<{ merchants: string[]; report: LabelReport | null; taxes?: TaxCheck } | null>(null);
  const [mid, setMid] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'go' | 'stop'; text: string } | null>(null);
  const check = async (m = mid) => {
    setBusy(true); setMsg(null);
    try {
      const d = await api<{ merchants: string[]; report: LabelReport | null; taxes?: TaxCheck }>(`/api/foodhub/clover-labels${m ? `?merchantId=${encodeURIComponent(m)}` : ''}`);
      setData(d); setMid(d.report?.merchantId ?? ''); setTag(d.report?.kitchenLabels[0]?.id ?? '');
    } catch (e) { setMsg({ tone: 'stop', text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  };
  const assign = async () => {
    const r = data?.report;
    if (!r || !tag) return;
    const label = r.kitchenLabels.find((l) => l.id === tag)?.name ?? '';
    if (!window.confirm(t(`Ajouter l’étiquette « ${label} » aux ${r.unprintedCount} articles dans Clover ?`, `Add the "${label}" label to the ${r.unprintedCount} items in Clover?`))) return;
    setBusy(true);
    try {
      const res = await api<{ added: number; label: string }>('/api/foodhub/clover-labels', { method: 'POST', json: { merchantId: r.merchantId, tagId: tag, all: true } });
      setMsg({ tone: 'go', text: t(`${res.added} article(s) s’imprimeront maintenant à la cuisine (« ${res.label} »).`, `${res.added} item(s) now print in the kitchen ("${res.label}").`) });
      await check(r.merchantId);
    } catch (e) { setMsg({ tone: 'stop', text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  };
  const r = data?.report;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-bold text-ink"><Printer className="size-4" />{t('Vérification Clover : impression en cuisine et taxes', 'Clover check: kitchen printing and taxes')}</div>
          <div className="text-[13px] text-ink-3">{t('Un article s’imprime en cuisine seulement s’il a une étiquette reliée à une imprimante dans Clover. Les taxes sont seulement vérifiées : corrigez-les dans Clover → Configuration → Taxes et frais.', 'An item prints in the kitchen only if it has a label linked to a printer in Clover. Taxes are only checked: fix them in Clover → Setup → Taxes & Fees.')}</div>
        </div>
        <div className="flex items-center gap-2">
          {data && data.merchants.length > 1 && <Select selectSize="sm" value={mid} onChange={(e) => { setMid(e.target.value); void check(e.target.value); }}>{data.merchants.map((m) => <option key={m} value={m}>{m}</option>)}</Select>}
          <Button variant="outline" loading={busy && !r} onClick={() => check()}>{t('Vérifier', 'Check')}</Button>
        </div>
      </div>
      {msg && <Banner tone={msg.tone} className="mt-3">{msg.text}</Banner>}
      {data && !r && <Banner tone="info" className="mt-3">{t('Aucun marchand Clover branché.', 'No Clover merchant connected.')}</Banner>}
      {r && !r.ok && <Banner tone="stop" className="mt-3">{r.error}</Banner>}
      {data?.taxes?.ok && (
        <div className="mt-3 text-[13px]">
          {data.taxes.problems.length
            ? <Banner tone="stop"><strong>{t('Taxes Clover à vérifier :', 'Clover taxes to check:')}</strong> {t((data.taxes.problemsFr ?? data.taxes.problems).join(' '), data.taxes.problems.join(' '))} <span className="text-ink-3">({data.taxes.rates.map((x) => `${x.name} ${x.percent}%${x.isDefault ? ' ✓' : ''}`).join(' · ')})</span></Banner>
            : <Banner tone="go">{t(`Taxes par défaut : ${data.taxes.defaultPercent} % (TPS + TVQ).`, `Default taxes: ${data.taxes.defaultPercent}% (GST + QST).`)}</Banner>}
        </div>
      )}
      {r?.ok && (
        <div className="mt-3 space-y-2 text-[13px]">
          {r.kitchenLabels.length === 0 && <Banner tone="warn">{t('Aucune étiquette n’est reliée à une imprimante. Dans Clover : Configuration → Imprimantes → Reçus de commande → étiquettes.', 'No label is linked to a printer. In Clover: Setup → Printers → Order receipts → labels.')}</Banner>}
          {r.unprintedCount === 0
            ? <Banner tone="go">{t(`Les ${r.items} articles s’impriment en cuisine.`, `All ${r.items} items print in the kitchen.`)}</Banner>
            : <Banner tone="warn">{t(`${r.unprintedCount} article(s) sur ${r.items} ne s’impriment pas en cuisine :`, `${r.unprintedCount} of ${r.items} item(s) never print in the kitchen:`)} {r.unprinted.slice(0, 12).map((i) => i.name).join(', ')}{r.unprintedCount > 12 ? '…' : ''}</Banner>}
          {r.unprintedCount > 0 && r.kitchenLabels.length > 0 && can('admin') && (
            <div className="flex flex-wrap items-center gap-2">
              <Select selectSize="sm" value={tag} onChange={(e) => setTag(e.target.value)}>{r.kitchenLabels.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.printers} {t('imprimante(s)', 'printer(s)')})</option>)}</Select>
              <Button loading={busy} onClick={assign}>{t(`Ajouter l’étiquette aux ${r.unprintedCount} articles`, `Add the label to the ${r.unprintedCount} items`)}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChannelsSettingsPage() {
  const { t, loc } = useI18n();
  const { can } = useViewer();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'go' | 'stop'; text: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const okMid = q.get('clover_connected'); const err = q.get('clover_error');
    if (okMid) setFlash({ tone: 'go', text: `Clover ${okMid} ✓` });
    else if (err) setFlash({ tone: 'stop', text: err });
  }, []);
  const disconnect = async (mid: string) => {
    if (!window.confirm(`Disconnect Clover merchant ${mid}?`)) return;
    try { await api('/api/foodhub/clover-connect/merchants', { method: 'DELETE', body: JSON.stringify({ merchantId: mid }) }); await load(revealed); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const approve = async (mid: string) => {
    try { await api('/api/foodhub/clover-connect/merchants', { method: 'POST', body: JSON.stringify({ merchantId: mid }) }); await load(revealed); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  // Order inbox: the owner re-runs a saved order that failed. The server never creates the same order twice.
  const [replaying, setReplaying] = useState('');
  const [replayMsg, setReplayMsg] = useState<{ tone: 'go' | 'stop'; text: string } | null>(null);
  const replay = async (item: InboxItem) => {
    // Past the platform's answer window the platform may have cancelled it or sent it to its tablet: a Clover ticket now could cook it twice.
    if (item.pastDeadline && !window.confirm(t('Le délai de réponse de la plateforme est dépassé : elle a pu annuler cette commande ou l’envoyer à sa tablette. Rejouer seulement si la plateforme l’attend encore. Continuer ?', 'The platform’s answer window has passed: it may have cancelled this order or sent it to its tablet. Replay only if the platform still shows it waiting. Continue?'))) return;
    setReplaying(item.id); setReplayMsg(null);
    try {
      const { result } = await api<{ result: ReplayResult }>('/api/foodhub/channels/inbox', { method: 'POST', body: JSON.stringify({ id: item.id }) });
      const ref = `#${item.displayId || item.externalOrderId}`;
      setReplayMsg(!result.ok ? { tone: 'stop', text: `${t('Échec du rejeu de', 'Replay failed for')} ${ref} : ${result.error ?? ''}` }
        : result.already || result.duplicate ? { tone: 'go', text: `${ref} ${t('était déjà dans Food Hub — rien n’a été traité deux fois.', 'was already in Food Hub — nothing was processed twice.')}` }
        : { tone: 'go', text: `${ref} ${t('rejouée : elle suit maintenant le circuit normal (Clover, cuisine, plateforme).', 'replayed: it now follows the normal flow (Clover, kitchen, platform).')}` });
      await load(revealed);
    } catch (e) { setReplayMsg({ tone: 'stop', text: e instanceof Error ? e.message : String(e) }); }
    finally { setReplaying(''); }
  };
  const load = useCallback((reveal = false) => { setBusy(true); return api<Data>(`/api/foodhub/channels${reveal ? '?reveal=1' : ''}`).then((d) => { setData(d); setRevealed(reveal); setError(''); }).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); }, []);
  useEffect(() => { if (can('stores:map')) load(); }, [load, can]);

  if (!can('stores:map')) return <div><SettingsHead title={t('Plateformes et Clover', 'Platforms & Clover')} /><Banner tone="info">{t('Réservé aux gérants et au propriétaire.', 'Managers and owner only.')}</Banner></div>;
  if (!data) return <div><SettingsHead title={t('Plateformes et Clover', 'Platforms & Clover')} />{error ? <Banner tone="stop">{error}</Banner> : <div className="h-96 animate-pulse rounded-lg bg-sunken" />}</div>;

  const state = (c: Channel): [Tone, string] => c.channel === 'tgtg'
    ? (c.configured ? ['info', t('Réception seulement', 'Inbound only')] : ['neutral', t('Optionnel', 'Optional')])
    : c.viaClover ? ['info', t('Relié par Clover', 'Linked through Clover')]
    : c.canSend ? ['go', t('En direct', 'Live')] : c.configured ? ['wait', t('Prêt, pas en direct', 'Ready, not live')] : ['stop', t('À configurer', 'Needs setup')];

  return (
    <div>
      <SettingsHead title={t('Plateformes et Clover', 'Platforms & Clover')} intro={<>{t('Vos branchements directs — aucun agrégateur. Donnez à chaque plateforme les adresses et secrets ci-dessous. Les clés d’API se mettent avec', 'Your own direct connections — no aggregator. Give each platform the URLs and secrets below. API keys go in with')} <code className="rounded bg-sunken px-1 text-xs">npm run setup</code> {t('ou dans l’hébergeur, jamais dans le clavardage.', 'or the hosting settings, never in chat.')}</>}
        right={<>{can('admin') && <Button variant="outline" onClick={() => load(!revealed)} icon={revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}>{revealed ? t('Cacher les secrets', 'Hide secrets') : t('Afficher les secrets', 'Show secrets')}</Button>}<Button variant="ghost" loading={busy} onClick={() => load(revealed)} icon={<RefreshCw className="size-4" />}>{t('Actualiser', 'Refresh')}</Button></>} />
      {error && <Banner tone="stop" className="mb-4">{error}</Banner>}
      {flash && <Banner tone={flash.tone} className="mb-4">{flash.tone === 'go' ? t('Marchand Clover branché : ', 'Clover merchant connected: ') : ''}{flash.text}</Banner>}
      {data.mode === 'memory' && <Banner tone="warn" className="mb-4">{t('Mode démo (mémoire) : rien n’est gardé au redémarrage. Branchez Supabase pour la production.', 'Demo mode (memory): nothing is kept across restarts. Connect Supabase for production.')}</Banner>}
      {!data.liveEnabled && <Banner tone="warn" className="mb-4">{t('Mode sécurité (LIVE_CONNECTORS_GLOBAL_ENABLED=false) : les commandes arrivent, mais rien n’est envoyé aux plateformes tant que ce n’est pas activé.', 'Safe mode (LIVE_CONNECTORS_GLOBAL_ENABLED=false): orders still arrive, but nothing is sent to the platforms until you switch it on.')}</Banner>}
      {!data.dashboardProtected && <Banner tone="warn" className="mb-4">{t('Aucun DASHBOARD_PASSWORD : définissez-en un avant la mise en service (compte de secours et signature des sessions).', 'No DASHBOARD_PASSWORD: set one before going live (recovery login and session signing).')}</Banner>}

      {((data.inbox?.length ?? 0) > 0 || replayMsg) && (
        <Section icon={<Inbox className="size-5" />} title={`${t('Commandes à rejouer', 'Orders to replay')} (${data.inbox?.length ?? 0})`}
          subtitle={t('Gardées dès leur arrivée, mais pas traitées (une erreur, ou le serveur s’est arrêté avant). Rien n’est perdu : celles restées en attente sont reprises à chaque synchro (5 essais, tant que la plateforme attend encore la réponse), et « Rejouer » relance une commande tout de suite. Une commande déjà dans Food Hub n’est jamais créée deux fois.',
            'Saved the moment they arrived, but not processed (an error, or the server stopped first). Nothing is lost: the ones left waiting are retried at each sync (5 tries, while the platform still waits for an answer), and “Replay” runs an order again right away. An order already in Food Hub is never created twice.')}>
          {replayMsg && <Banner tone={replayMsg.tone} className="mb-3">{replayMsg.text}</Banner>}
          {(data.inbox?.length ?? 0) === 0 ? <p className="text-sm text-ink-3">{t('Plus rien à rejouer.', 'Nothing left to replay.')}</p> : (
            <Table>
              <thead><tr><Th>{t('Reçue', 'Received')}</Th><Th>{t('Commande', 'Order')}</Th><Th>{t('Statut', 'Status')}</Th><Th>{t('Détail', 'Detail')}</Th><Th /></tr></thead>
              <tbody>{data.inbox!.map((i) => (
                <Tr key={i.id}>
                  <Td className="whitespace-nowrap text-ink-3">{new Date(i.receivedAt).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' })}</Td>
                  <Td>
                    <div className="flex items-center gap-2"><PlatformMark channel={i.channel} size="xs" /><span className="font-semibold text-ink">#{i.displayId || i.externalOrderId}</span></div>
                    <div className="text-xs text-ink-3">{[i.brandName, i.total !== null ? money(i.total, loc) : null, i.items !== null ? `${i.items} ${t('article(s)', 'item(s)')}` : null].filter(Boolean).join(' · ')}</div>
                  </Td>
                  <Td>{i.stuck ? <Badge tone="wait">{t('Pas traitée', 'Not processed')}</Badge> : <Badge tone="stop">{t('Échec', 'Failed')}</Badge>}</Td>
                  <Td className="max-w-md text-xs text-ink-2">
                    {i.error || (i.stuck ? t('Le serveur s’est arrêté avant le traitement — reprise à la prochaine synchro.', 'The server stopped before processing — retried at the next sync.') : '')}
                    {i.pastDeadline && <div className="font-semibold text-ink">{t('Délai de la plateforme dépassé : vérifiez sa tablette ou son portail avant de rejouer.', 'Past the platform’s answer window: check its tablet or portal before replaying.')}</div>}
                    {i.attempts > 0 && <div className="text-ink-3">{i.attempts} {t('reprise(s) automatique(s)', 'automatic retry(ies)')}</div>}
                    {i.lastReplay && <div className="text-ink-3">{t('Dernier rejeu :', 'Last replay:')} {i.lastReplay.by}, {new Date(i.lastReplay.at).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' })}</div>}
                  </Td>
                  <Td><div className="flex justify-end">{can('admin')
                    ? <Button variant="outline" size="sm" loading={replaying === i.id} disabled={Boolean(replaying)} onClick={() => replay(i)} icon={<RotateCcw className="size-4" />}>{t('Rejouer', 'Replay')}</Button>
                    : <span className="text-xs text-ink-3">{t('Propriétaire seulement', 'Owner only')}</span>}</div></Td>
                </Tr>
              ))}</tbody>
            </Table>
          )}
        </Section>
      )}

      <Section icon={<PlatformMark channel="clover" size="sm" />} title={t('Clover (caisse)', 'Clover POS')} subtitle={t(data.clover.noteFr ?? data.clover.note, data.clover.note) + (!data.clover.injectionEnabled ? ` ${t('Injection désactivée (FOODHUB_POS_INJECTION=off).', 'Injection is OFF (FOODHUB_POS_INJECTION=off).')}` : '')}
        right={data.clover.configured ? <Badge tone="go">{t('Branché', 'Connected')}</Badge> : <Badge tone="wait">{t('Pas configuré', 'Not configured')}</Badge>}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <ul className="space-y-2 text-[13px] text-ink-2">
            <li className="flex gap-2"><Badge tone={data.clover.recordPayments ? 'go' : 'neutral'}>{data.clover.recordPayments ? 'ON' : 'OFF'}</Badge>{t('Commandes livraison enregistrées payées, avec un mode de paiement par plateforme ; annulées avant la sortie = retirées de la caisse.', 'Delivery orders recorded as paid, with a tender per platform; cancelled before leaving = removed from the register.')}</li>
            <li className="flex gap-2"><Badge tone={data.clover.orderTypes ? 'go' : 'neutral'}>{data.clover.orderTypes ? 'ON' : 'OFF'}</Badge>{t('Type de commande par plateforme sur chaque commande Clover.', 'Order type per platform on every Clover order.')}</li>
            <li className="flex gap-2"><Badge tone={data.clover.inventorySync ? 'go' : 'neutral'}>{data.clover.inventorySync ? 'ON' : 'OFF'}</Badge>{t('Rupture dans Clover → 86 sur toutes les plateformes ; changements de prix signalés.', 'Out of stock in Clover → 86 on every platform; price changes flagged.')}</li>
          </ul>
          <div>
            <UrlRow label={t('Adresse webhook Clover (événements : Inventaire)', 'Clover webhook URL (events: Inventory)')} value={data.clover.webhookUrl} />
            <div className="mt-3 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{t('Code de vérification', 'Verification code')}</div>
            <div className="mt-1 text-[13px]">{data.clover.verification ? <><code className="rounded bg-sunken px-1.5 py-0.5 font-mono">{data.clover.verification.code}</code> <span className="text-ink-3">— {t('collez-le dans le tableau de bord développeur Clover', 'paste it in the Clover developer dashboard')} ({new Date(data.clover.verification.at).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })})</span></> : <span className="text-ink-3">{t('Apparaît ici après avoir enregistré l’adresse dans Clover.', 'Appears here after you save the URL in Clover.')}</span>}</div>
            <div className="mt-3 text-[13px]">X-Clover-Auth : {data.clover.webhookAuthSet ? <Badge tone="go">{t('défini', 'set')}</Badge> : <span className="text-ink-3">{t('copiez le code d’authentification de Clover dans CLOVER_WEBHOOK_AUTH (npm run setup).', 'copy Clover’s auth code into CLOVER_WEBHOOK_AUTH (npm run setup).')}</span>}</div>
          </div>
        </div>
        {data.clover.app && (
          <div className="mt-5 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-bold text-ink">{t('Application Clover « TAKATAK Food Hub »', 'Clover app “TAKATAK Food Hub”')}</div>
                <div className="text-[13px] text-ink-3">{data.clover.app.configured
                  ? t('Chaque marchand Clover se branche en un clic (ou en ouvrant l’app depuis Clover). Les jetons se renouvellent seuls.', 'Each Clover merchant connects in one click (or by opening the app from Clover). Tokens renew by themselves.')
                  : t('Ajoutez l’App ID et l’App Secret de Clover (CLOVER_CLIENT_ID / CLOVER_CLIENT_SECRET) avec npm run setup.', 'Add Clover’s App ID and App Secret (CLOVER_CLIENT_ID / CLOVER_CLIENT_SECRET) with npm run setup.')}</div>
              </div>
              {data.clover.app.configured && <a href={data.clover.app.connectUrl} className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-surface hover:opacity-90"><PlugZap className="size-4" />{t('Brancher un marchand Clover', 'Connect a Clover merchant')}</a>}
            </div>
            <div className="mt-2 grid grid-cols-1 gap-x-5 lg:grid-cols-2">
              <UrlRow label={t('Site URL (développeur Clover → REST Configuration)', 'Site URL (Clover developer → REST Configuration)')} value={data.clover.app.siteUrl} />
              <UrlRow label={t('Alternate Launch Path', 'Alternate Launch Path')} value={data.clover.app.launchPath} />
            </div>
            {data.clover.app.appId && <div className="mt-2 text-[13px] text-ink-3">App ID : <code className="rounded bg-sunken px-1 font-mono">{data.clover.app.appId}</code></div>}
            {data.clover.app.legal && (
              <div className="mt-2 grid grid-cols-1 gap-x-5 lg:grid-cols-3">
                <UrlRow label={t('Politique de confidentialité', 'Privacy policy')} value={data.clover.app.legal.privacy} />
                <UrlRow label={t('Conditions (CLUF)', 'Terms (EULA)')} value={data.clover.app.legal.terms} />
                <UrlRow label={t('Page de soutien', 'Support page')} value={data.clover.app.legal.support} />
              </div>
            )}
            {data.clover.app.merchants.some((m) => m.status === 'pending') && <Banner tone="warn" className="mt-3">{t('Un marchand a ouvert l’app depuis Clover et attend votre approbation. Rien ne lui est envoyé avant que vous l’approuviez.', 'A merchant opened the app from Clover and is waiting for your approval. Nothing is sent to it until you approve it.')}</Banner>}
            {data.clover.app.merchants.length > 0 && (
              <Table className="mt-3">
                <thead><tr><Th>{t('Marchand', 'Merchant')}</Th><Th>{t('Branché le', 'Connected')}</Th><Th>{t('État', 'Status')}</Th><Th /></tr></thead>
                <tbody>
                  {data.clover.app.merchants.map((m) => (
                    <Tr key={m.merchantId}>
                      <Td><div className="font-semibold text-ink">{m.name || m.merchantId}</div><div className="font-mono text-xs text-ink-3">{m.merchantId}</div></Td>
                      <Td>{new Date(m.connectedAt).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })}</Td>
                      <Td>{m.status === 'pending' ? <Badge tone="wait">{t('En attente', 'Pending')}</Badge> : m.needsReconnect ? <Badge tone="stop">{t('À rebrancher', 'Reconnect')}</Badge> : <Badge tone="go">{t('Actif', 'Active')}</Badge>}</Td>
                      <Td><div className="flex justify-end gap-1">{can('admin') && m.status === 'pending' && <Button variant="outline" onClick={() => approve(m.merchantId)}>{t('Approuver', 'Approve')}</Button>}{can('admin') && <Button variant="ghost" onClick={() => disconnect(m.merchantId)}>{m.status === 'pending' ? t('Refuser', 'Decline') : t('Débrancher', 'Disconnect')}</Button>}</div></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        )}
        {data.clover.configured && <CloverPrinting />}
      </Section>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.channels.map((c) => {
          const [tone, label] = state(c);
          return (
            <Card key={c.channel} className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5"><PlatformMark channel={c.channel} size="md" /><span className="font-extrabold text-ink">{c.label}</span></div>
                <Badge tone={tone}>{label}</Badge>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{t(c.noteFr ?? c.note, c.note)}</p>
              {c.missing.length > 0 && <p className="mt-2 text-xs text-ink-3">{t('Manque :', 'Missing:')} {c.missing.map((m) => <code key={m} className="mr-1 rounded bg-sunken px-1 font-mono">{m}</code>)}</p>}
              <UrlRow label={c.extraWebhooks.length ? t('Webhook des commandes', 'Order webhook URL') : t('Adresse webhook', 'Webhook URL')} value={c.webhookUrl} />
              {c.extraWebhooks.map((w) => <UrlRow key={w.url} label={w.label} value={w.url} />)}
              {c.handoff.map((h) => (
                <div key={h.envKey} className="mt-2">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{h.label}</div>
                  {!h.set ? <Badge tone="stop" className="mt-1">{t('Pas généré — lancez npm run setup', 'Not generated — run npm run setup')}</Badge>
                    : h.value ? <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-md bg-sunken px-2 py-1.5 font-mono text-xs">{h.value}</code><CopyBtn text={h.value} /></div>
                    : <div className="mt-1 font-mono text-xs text-ink-3">•••••••• <span className="font-sans">({t('Afficher les secrets', 'Show secrets')})</span></div>}
                </div>
              ))}
            </Card>
          );
        })}
      </div>


      {data.relay && (
        <Section icon={<PlugZap className="size-5" />} title={t('Relais de commandes Food Hub', 'Food Hub Order Relay')}
          subtitle={t('Pour un partenaire qui envoie ses commandes (ex. flux Too Good To Go) : il les envoie à cette adresse et Food Hub les traite comme les autres (ticket Clover, écran cuisine, alertes). Format compatible UrbanPiper « Order Relay ». Magasins à relier sous l’identifiant relay:<id>.',
            'For a partner that pushes its orders (e.g. a Too Good To Go feed): it posts them to this address and Food Hub handles them like any other (Clover ticket, kitchen screen, alerts). UrbanPiper "Order Relay" compatible format. Map its stores as relay:<id>.')}>
          <Card className="space-y-3 p-4">
            <UrlRow label={t('Adresse du relais (avec le jeton)', 'Relay address (with token)')} value={data.relay.webhookUrl} />
            {!data.relay.revealed && <p className="text-xs text-ink-3">{t('Cliquez « Afficher les secrets » pour voir le jeton complet.', 'Click “Show secrets” to see the full token.')}</p>}
            <p className="text-sm text-ink-2">
              {t('Plateformes acceptées par le relais : ', 'Platforms accepted on the relay: ')}<strong>{data.relay.channels.join(', ') || '—'}</strong>
              {' · '}
              {data.relay.callbackReady
                ? t('Accepter / Prête / Refuser sont renvoyés à l’adresse de retour du partenaire.', 'Accept / Ready / Reject are sent back to the partner’s callback address.')
                : t('Accepter / Prête restent dans Food Hub et Refuser est bloqué — annulez chez le partenaire (aucune adresse de retour : FOODHUB_RELAY_CALLBACK_URL).', 'Accept / Ready stay in Food Hub and Reject is blocked — cancel on the partner side (no callback address: FOODHUB_RELAY_CALLBACK_URL).')}
            </p>
          </Card>
        </Section>
      )}

      <Section icon={<PlugZap className="size-5" />} title={t('Derniers envois aux plateformes', 'Recent platform jobs')} subtitle={t('Menus, ruptures, pauses, acceptations : chaque action envoyée et sa réponse. Rien n’est affiché comme fait si la plateforme ne l’a pas reçu.', 'Menus, 86s, pauses, accepts: every action sent and its answer. Nothing is shown as done if the platform did not get it.')}>
        {data.jobs.length === 0 ? <p className="text-sm text-ink-3">{t('Aucune action pour l’instant.', 'No action yet.')}</p> : (
          <div className="-mx-5 -my-4">
            <Table>
              <thead><tr><Th>{t('Quand', 'When')}</Th><Th>{t('Action', 'Kind')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Statut', 'Status')}</Th><Th>{t('Détail', 'Detail')}</Th></tr></thead>
              <tbody>{data.jobs.map((j) => (
                <Tr key={j.id}>
                  <Td className="whitespace-nowrap text-ink-3">{new Date(j.createdAt).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' })}</Td>
                  <Td className="font-mono text-xs">{j.kind}</Td>
                  <Td>{j.channel ? <PlatformMark channel={j.channel} size="xs" /> : '—'}</Td>
                  <Td><Badge tone={j.status === 'error' ? 'stop' : j.status === 'done' ? 'go' : 'wait'}>{j.status === 'error' ? t('Erreur', 'Error') : j.status === 'done' ? t('Reçu', 'Received') : t('En file', 'Queued')}</Badge></Td>
                  <Td className="max-w-md text-xs text-ink-2">{j.result?.message || ''}{j.reference ? ` · ref ${j.reference}` : ''}</Td>
                </Tr>
              ))}</tbody>
            </Table>
          </div>
        )}
      </Section>

      {data.unparsed.length > 0 && (
        <Section title={`${t('Messages illisibles', 'Unparsed webhook payloads')} (${data.unparsed.length})`} subtitle={t('Arrivés mais pas reconnus comme commande. Rien n’est perdu — envoyez-en un à votre développeur pour finaliser le lecteur.', 'These arrived but did not match a known order shape. Nothing was lost — send one to your developer to finalize the parser.')}>
          <div className="space-y-2">{data.unparsed.slice(0, 5).map((j) => <pre key={j.id} className="scrollbar-thin max-h-52 overflow-auto rounded-md bg-ink p-3 font-mono text-[11px] text-canvas">{JSON.stringify(j.request?.body, null, 2)}</pre>)}</div>
        </Section>
      )}
      <p className="text-xs text-ink-3">{t('Adresse publique :', 'Public URL:')} <code className="font-mono">{data.publicUrl}</code></p>
    </div>
  );
}
