'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { Badge, PlatformMark, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { Input, Select, Switch } from '@/components/ui/form';
import { Section } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

type Parsed = { kind: string; code: string | null; firstName: string | null; quantity: number | null; bagName: string | null; pricePaid: number | null; pickupLabel: string | null; storeName: string | null; warnings: string[]; problems: string[] };
type Mail = { id: string; source: string; receivedAt: string; from: string; subject: string; status: string; reason: string | null; orderId: string | null; brandName: string | null; locationCode: string | null; parsed: Parsed | null };
type Mapping = { storeName: string; brandName: string; locationCode: string; cloverMerchantId?: string | null; at: string; by: string };
type Data = {
  readiness: { imapConfigured: boolean; webhookConfigured: boolean; configured: boolean; mailbox: { host: string; port: number; user: string; mailbox: string } | null; missing: string[] };
  webhookUrl: string; allowedSenders: string[]; pollSeconds: number;
  settings: { enabled: boolean; mappings: Mapping[]; updatedAt?: string; updatedBy?: string };
  mailbox: { lastRunAt?: string; lastOkAt?: string; lastError?: string | null; lastUid?: number; fetched?: number; handled?: number };
  recent: Mail[]; attention: Mail[];
  unmapped: Array<{ storeName: string; brandName?: string; locationCode?: string }>;
  brands: string[]; locations: Array<{ code: string; name: string; address: string }>; merchants: string[];
};

const STATUS: Record<string, [Tone, string, string]> = {
  order_created: ['go', 'Commande créée', 'Order created'],
  duplicate: ['neutral', 'Déjà reçue', 'Already received'],
  cancel_applied: ['wait', 'Annulation appliquée', 'Cancellation applied'],
  cancel_pending: ['wait', 'Annulation en attente', 'Cancellation waiting'],
  attention: ['stop', 'À vérifier', 'Needs attention'],
  too_late: ['stop', 'Lu trop tard', 'Read too late'],
  ignored: ['neutral', 'Ignoré', 'Ignored'],
  error: ['stop', 'Erreur', 'Error'],
};

/** Settings → Platforms: Too Good To Go order e-mails (switch, mailbox, store-name mapping, last e-mails, attention list). */
export function TgtgEmailSection() {
  const { t, loc } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [form, setForm] = useState({ storeName: '', brandName: '', locationCode: '', cloverMerchantId: '' });
  const load = useCallback(() => api<Data>('/api/foodhub/tgtg-email').then((d) => { setData(d); setError(''); }).catch((e) => setError(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); }, [load]);
  const act = async (key: string, body: Record<string, unknown>, done?: (r: Record<string, unknown>) => string): Promise<boolean> => {
    setBusy(key); setNote('');
    try { const r = await api<Record<string, unknown>>('/api/foodhub/tgtg-email', { method: 'POST', body: JSON.stringify(body) }); if (done) setNote(done(r)); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(''); }
  };
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' }) : '—');
  if (!data) return <Section icon={<PlatformMark channel="tgtg" size="sm" />} title={t('Too Good To Go par courriel', 'Too Good To Go by e-mail')}>{error ? <Banner tone="stop">{error}</Banner> : <div className="h-24 animate-pulse rounded-lg bg-sunken" />}</Section>;
  const r = data.readiness;
  const on = data.settings.enabled && r.configured;
  const mailboxTone: Tone = !r.imapConfigured ? 'neutral' : data.mailbox.lastError ? 'stop' : data.mailbox.lastOkAt ? 'go' : 'wait';
  const pick = (u: { storeName: string; brandName?: string; locationCode?: string }) => setForm({ storeName: u.storeName, brandName: u.brandName ?? '', locationCode: u.locationCode ?? '', cloverMerchantId: '' });

  const row = (m: Mail, attention = false) => {
    const [tone, fr, en] = STATUS[m.status] ?? ['neutral', m.status, m.status];
    const p = m.parsed;
    return (
      <div key={m.id} className="rounded-md border border-line px-3 py-2 text-[13px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 flex-wrap items-center gap-2"><Badge tone={tone}>{t(fr, en)}</Badge><span className="text-ink-3">{when(m.receivedAt)}</span><span className="truncate text-ink-2" title={m.subject}>{m.subject || '—'}</span></span>
          <span className="flex items-center gap-2">
            {m.orderId && <Link href={`/orders/${m.orderId}`} className="text-xs font-semibold underline-offset-4 hover:underline">{t('Voir la commande', 'Open order')}</Link>}
            {attention && <Button size="xs" variant="outline" loading={busy === `retry:${m.id}`} onClick={() => act(`retry:${m.id}`, { action: 'retry', id: m.id }, (x) => { const res = x.result as { status?: string; reason?: string } | undefined; return `${res?.status ?? ''}${res?.reason ? ` — ${res.reason}` : ''}`; })}>{t('Relire', 'Retry')}</Button>}
            {attention && <Button size="xs" variant="ghost" loading={busy === `dismiss:${m.id}`} onClick={() => act(`dismiss:${m.id}`, { action: 'dismiss', id: m.id })}>{t('Retirer', 'Dismiss')}</Button>}
          </span>
        </div>
        {p && (p.code || p.firstName || p.storeName) && (
          <div className="mt-1 text-ink-2">
            {p.kind === 'cancel' ? t('Annulation', 'Cancellation') : t('Réservation', 'Reservation')}{p.code ? ` · ${p.code}` : ''}{p.firstName ? ` · ${p.firstName}` : ''}{p.quantity ? ` · ${p.quantity} ${t('sac(s)', 'bag(s)')}` : ''}{p.pickupLabel ? ` · ${p.pickupLabel}` : ''}{p.pricePaid != null ? ` · ${p.pricePaid.toFixed(2)} $` : ''}{p.storeName ? ` · ${p.storeName}` : ''}{m.brandName ? ` → ${m.brandName} @ ${m.locationCode}` : ''}
          </div>
        )}
        {m.reason && <div className="mt-1 text-xs text-stop-2">{m.reason}</div>}
        {p && p.warnings.length > 0 && <div className="mt-1 text-xs text-ink-3">{p.warnings.join(' · ')}</div>}
      </div>
    );
  };

  return (
    <Section icon={<PlatformMark channel="tgtg" size="sm" />} title={t('Too Good To Go par courriel', 'Too Good To Go by e-mail')}
      subtitle={t('Chaque réservation reçue par courriel devient une commande : écran cuisine, Clover (type « Too Good To Go »), billet avec le client, les sacs, l’heure de ramassage et le code TGTG ; payée avec le mode « Too Good To Go » au ramassage. Une annulation annule la commande (marquée « ANNULÉE » dans Clover, jamais supprimée).',
        'Each reservation e-mail becomes an order: kitchen screen, Clover (order type “Too Good To Go”), ticket with the customer, the bags, the pickup window and the TGTG code; paid with the “Too Good To Go” tender at pickup. A cancellation e-mail cancels the order (flagged “CANCELLED” in Clover, never deleted).')}
      right={<div className="flex items-center gap-3"><Badge tone={on ? 'go' : 'neutral'}>{on ? t('Actif', 'On') : t('Inactif', 'Off')}</Badge>
        <Switch checked={data.settings.enabled} disabled={busy === 'toggle'} onChange={(v) => act('toggle', { action: 'toggle', enabled: v })} label={t('Activer', 'Enabled')} /></div>}>
      {error && <Banner tone="stop" className="mb-3">{error}</Banner>}
      {note && <Banner tone="info" className="mb-3">{note}</Banner>}
      {!r.configured && (
        <Banner tone="info" className="mb-3">{t('Pas encore branché : ajoutez dans l’hébergeur la boîte courriel (TGTG_IMAP_HOST, TGTG_IMAP_USER, TGTG_IMAP_PASSWORD) ou le secret du webhook (TGTG_EMAIL_WEBHOOK_SECRET). Guide : docs/TGTG_EMAIL_ORDERS.md.', 'Not connected yet: add the mailbox (TGTG_IMAP_HOST, TGTG_IMAP_USER, TGTG_IMAP_PASSWORD) or the webhook secret (TGTG_EMAIL_WEBHOOK_SECRET) in the hosting settings. Guide: docs/TGTG_EMAIL_ORDERS.md.')}</Banner>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4 text-[13px]">
          <div className="mb-2 flex items-center justify-between gap-2 font-bold text-ink"><span className="flex items-center gap-2"><Mail className="size-4" />{t('Boîte courriel (IMAP)', 'Mailbox (IMAP)')}</span><Badge tone={mailboxTone}>{!r.imapConfigured ? t('Non configurée', 'Not configured') : data.mailbox.lastError ? t('Erreur', 'Error') : data.mailbox.lastOkAt ? 'OK' : t('Pas encore lue', 'Not read yet')}</Badge></div>
          {r.mailbox ? (
            <ul className="space-y-1 text-ink-2">
              <li>{r.mailbox.user} · {r.mailbox.host}:{r.mailbox.port} · {r.mailbox.mailbox}</li>
              <li>{t('Lue toutes les', 'Read every')} {data.pollSeconds} s · {t('dernière lecture réussie', 'last good read')} : {when(data.mailbox.lastOkAt)}</li>
              <li>{t('Dernier passage', 'Last run')} : {when(data.mailbox.lastRunAt)}{data.mailbox.fetched !== undefined ? ` · ${data.mailbox.fetched} ${t('vu(s)', 'seen')}, ${data.mailbox.handled ?? 0} ${t('de TGTG', 'from TGTG')}` : ''}</li>
              {data.mailbox.lastError && <li className="text-stop-2">{data.mailbox.lastError}</li>}
              <li className="text-ink-3">{t('Lecture seule : rien n’est marqué lu, déplacé ou supprimé.', 'Read-only: nothing is marked read, moved or deleted.')}</li>
            </ul>
          ) : <p className="text-ink-3">{t('Manque :', 'Missing:')} {r.missing.join(', ')}</p>}
          {r.imapConfigured && <Button className="mt-3" size="sm" variant="outline" icon={<RefreshCw className="size-4" />} loading={busy === 'poll'} onClick={() => act('poll', { action: 'poll' }, (x) => { const p = x.poll as { ok?: boolean; error?: string; reason?: string; checked?: number; handled?: number } | undefined; return p?.ok ? t(`Lu : ${p.checked ?? 0} courriel(s), ${p.handled ?? 0} de TGTG.`, `Read: ${p.checked ?? 0} e-mail(s), ${p.handled ?? 0} from TGTG.`) : (p?.error || p?.reason || ''); })}>{t('Lire maintenant', 'Read now')}</Button>}
        </Card>
        <Card className="p-4 text-[13px]">
          <div className="mb-2 font-bold text-ink">{t('Webhook (service de transfert)', 'Webhook (forwarding service)')}</div>
          <code className="block truncate rounded-md bg-sunken px-2 py-1.5 font-mono text-xs" title={data.webhookUrl}>{data.webhookUrl}</code>
          <p className="mt-2 text-ink-2">{r.webhookConfigured ? <Badge tone="go">{t('Secret défini', 'Secret set')}</Badge> : <span className="text-ink-3">{t('Secret non défini (TGTG_EMAIL_WEBHOOK_SECRET) : adresse fermée.', 'Secret not set (TGTG_EMAIL_WEBHOOK_SECRET): address closed.')}</span>}</p>
          <p className="mt-2 text-ink-3">{t('MIME brut, JSON { from, subject, text, html } ou formulaire (Mailgun, SendGrid). En-tête Authorization: Bearer <secret>.', 'Raw MIME, JSON { from, subject, text, html } or form fields (Mailgun, SendGrid). Header Authorization: Bearer <secret>.')}</p>
          <p className="mt-2 text-ink-3">{t('Expéditeurs acceptés :', 'Allowed senders:')} {data.allowedSenders.join(', ')}</p>
        </Card>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="font-bold text-ink">{t('Magasins Too Good To Go → marque et cuisine', 'Too Good To Go stores → brand and kitchen')}</div>
        <p className="mb-2 text-[13px] text-ink-3">{t('Le nom du magasin tel que TGTG l’écrit dans ses courriels (ex. « OOEUF NDG »). NDG = 6280 / 6284 Av Somerled ; Saint-Léonard = 5839 Rue Jean-Talon E. Po Poulet : Saint-Léonard seulement.', 'The store name exactly as TGTG writes it in its e-mails (e.g. “OOEUF NDG”). NDG = 6280 / 6284 Av Somerled; Saint-Léonard = 5839 Rue Jean-Talon E. Po Poulet: Saint-Léonard only.')}</p>
        {data.settings.mappings.length > 0 && (
          <div className="mb-3 space-y-1.5">{data.settings.mappings.map((m) => (
            <div key={m.storeName} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-[13px]">
              <span><strong>{m.storeName}</strong> → {m.brandName} @ {data.locations.find((l) => l.code === m.locationCode)?.name ?? m.locationCode}{m.cloverMerchantId ? ` · Clover ${m.cloverMerchantId}` : ` · ${t('aucune caisse Clover trouvée', 'no Clover register found')}`}</span>
              <span className="flex gap-2"><Button size="xs" variant="ghost" onClick={() => setForm({ storeName: m.storeName, brandName: m.brandName, locationCode: m.locationCode, cloverMerchantId: m.cloverMerchantId ?? '' })}>{t('Modifier', 'Edit')}</Button>
                <Button size="xs" variant="ghost" loading={busy === `unmap:${m.storeName}`} onClick={() => { if (window.confirm(t(`Retirer « ${m.storeName} » ?`, `Remove “${m.storeName}”?`))) act(`unmap:${m.storeName}`, { action: 'unmap', storeName: m.storeName }); }}>{t('Retirer', 'Remove')}</Button></span>
            </div>
          ))}</div>
        )}
        {data.unmapped.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]"><span className="text-ink-3">{t('Vus dans les courriels, pas encore reliés :', 'Seen in e-mails, not mapped yet:')}</span>
            {data.unmapped.map((u) => <Button key={u.storeName} size="xs" variant="outline" onClick={() => pick(u)}>{u.storeName}</Button>)}</div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input placeholder={t('Nom du magasin TGTG', 'TGTG store name')} value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} />
          <Select value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })}><option value="">{t('Marque…', 'Brand…')}</option>{data.brands.map((b) => <option key={b} value={b}>{b}</option>)}</Select>
          <Select value={form.locationCode} onChange={(e) => setForm({ ...form, locationCode: e.target.value })}><option value="">{t('Cuisine…', 'Kitchen…')}</option>{data.locations.map((l) => <option key={l.code} value={l.code}>{l.name} — {l.address}</option>)}</Select>
          <Select value={form.cloverMerchantId} onChange={(e) => setForm({ ...form, cloverMerchantId: e.target.value })}><option value="">{t('Caisse Clover : celle de la cuisine', 'Clover register: the kitchen’s')}</option>{data.merchants.map((m) => <option key={m} value={m}>{m}</option>)}</Select>
          <Button loading={busy === 'map'} disabled={!form.storeName.trim() || !form.brandName || !form.locationCode} onClick={() => act('map', { action: 'map', ...form }, (x) => (Number(x.resolved) ? t(`Enregistré — ${x.resolved} commande(s) en attente reliée(s) à la cuisine.`, `Saved — ${x.resolved} waiting order(s) linked to the kitchen.`) : t('Enregistré.', 'Saved.'))).then((done) => { if (done) setForm({ storeName: '', brandName: '', locationCode: '', cloverMerchantId: '' }); })}>{t('Relier', 'Map')}</Button>
        </div>
      </div>

      {data.attention.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="font-bold text-stop-2">{t(`À vérifier (${data.attention.length})`, `Needs attention (${data.attention.length})`)}</div>
          <p className="mb-2 text-[13px] text-ink-3">{t('Courriels TGTG que Food Hub n’a pas pu traiter seul. Rien n’est perdu : reliez le magasin ou vérifiez dans l’app TGTG, puis « Relire ».', 'TGTG e-mails Food Hub could not handle on its own. Nothing is lost: map the store or check the TGTG app, then “Retry”.')}</p>
          <div className="space-y-2">{data.attention.slice(0, 15).map((m) => row(m, true))}</div>
        </div>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 font-bold text-ink">{t('Derniers courriels lus', 'Last e-mails read')}</div>
        {data.recent.length === 0 ? <p className="text-[13px] text-ink-3">{t('Aucun pour l’instant.', 'None yet.')}</p> : <div className="space-y-2">{data.recent.slice(0, 12).map((m) => row(m))}</div>}
      </div>
    </Section>
  );
}
