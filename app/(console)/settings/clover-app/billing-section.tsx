'use client';

import { useCallback, useEffect, useState } from 'react';
import { CircleDollarSign, RefreshCw, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Section } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { BILLED_PLATFORM_LABELS, EXTRA_BRAND_PLATFORM_CAD, formatCad, type BilledPlatform } from '@/lib/foodhub/pos/clover-pricing';

type BrandLine = { brand: string; platforms: BilledPlatform[]; extra: boolean; units: number };
type Why = 'ready' | 'off' | 'no_metered_id' | 'no_app_id' | 'exempt' | 'nothing_recorded' | 'zero' | 'reported' | 'failed' | 'uncertain' | 'sending' | 'not_due';
type MerchantPreview = {
  merchantId: string; name: string | null; exempt: boolean; firstBrandMarked: string | null;
  status: { text: { fr: string; en: string }; tone: 'trial' | 'active' | 'lapsed' | 'unknown'; paid: boolean; checkedAt: string | null };
  live: { firstBrand: string | null; firstBrandSource: 'owner' | 'oldest' | null; brands: BrandLine[]; units: number; monthlyCad: number };
  current: { month: string; units: number; amountCad: number; recorded: boolean };
  due: { month: string; units: number; amountCad: number; why: Why; wouldSend: boolean; request: string | null; state: string | null; at: string | null };
};
type LogEntry = { at: string; merchantId: string; month: string; event: string; units: number; amountCad: number; detail?: string };
type BillingData = {
  pricing: { fr: string; en: string };
  preview: { enabled: boolean; meteredIdSet: boolean; exemptCount: number; month: string; previousMonth: string; merchants: MerchantPreview[] };
  log: LogEntry[];
};

const WHY: Record<Why, { fr: string; en: string }> = {
  ready: { fr: 'sera envoyé à Clover au prochain passage', en: 'will be sent to Clover on the next run' },
  off: { fr: 'rien n’est envoyé : FOODHUB_CLOVER_METERED_ENABLED n’est pas à true', en: 'nothing is sent: FOODHUB_CLOVER_METERED_ENABLED is not true' },
  no_metered_id: { fr: 'rien n’est envoyé : CLOVER_METERED_EXTRA_BRAND_ID manque', en: 'nothing is sent: CLOVER_METERED_EXTRA_BRAND_ID is missing' },
  no_app_id: { fr: 'rien n’est envoyé : CLOVER_CLIENT_ID manque', en: 'nothing is sent: CLOVER_CLIENT_ID is missing' },
  exempt: { fr: 'exempté (FOODHUB_BILLING_EXEMPT_MERCHANTS) : jamais facturé', en: 'exempt (FOODHUB_BILLING_EXEMPT_MERCHANTS): never billed' },
  nothing_recorded: { fr: 'aucun compte enregistré pour ce mois : rien à envoyer', en: 'no count recorded for that month: nothing to send' },
  zero: { fr: 'aucune marque supplémentaire : rien à envoyer', en: 'no extra brand: nothing to send' },
  reported: { fr: 'déjà envoyé à Clover', en: 'already sent to Clover' },
  failed: { fr: 'refusé 3 fois par Clover : abandonné (voir le journal)', en: 'refused 3 times by Clover: given up (see the log)' },
  uncertain: { fr: 'réponse de Clover perdue : vérifiez dans Clover, jamais renvoyé seul', en: 'Clover’s answer was lost: check in Clover, never re-sent by itself' },
  sending: { fr: 'envoi en cours', en: 'being sent' },
  not_due: { fr: 'pas encore dû', en: 'not due yet' },
};
const EVENT: Record<string, { fr: string; en: string }> = {
  units_changed: { fr: 'Compte changé', en: 'Count changed' },
  reported: { fr: 'Envoyé à Clover', en: 'Sent to Clover' },
  refused: { fr: 'Refusé (réessai)', en: 'Refused (retry)' },
  failed: { fr: 'Abandonné', en: 'Given up' },
  uncertain: { fr: 'Incertain', en: 'Uncertain' },
  zero: { fr: 'Rien à facturer', en: 'Nothing to bill' },
  skipped: { fr: 'Reporté', en: 'Postponed' },
};

/**
 * Settings → Clover app → Clover billing: each merchant's Food Hub subscription in plain words, its extra brands, and
 * exactly what would be billed (dry run — loading this section never sends anything), with the billing log.
 */
export function CloverBillingSection() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<BillingData | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async (refresh = false) => {
    setBusy(refresh ? 'refresh' : 'load');
    try { setData(await api<BillingData>(`/api/foodhub/clover-billing${refresh ? '?refresh=1' : ''}`)); setErr(''); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function post(json: Record<string, unknown>, key: string) {
    setBusy(key);
    try { await api('/api/foodhub/clover-billing', { method: 'POST', json }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  const p = data?.preview;
  const money = (n: number) => formatCad(n, lang === 'fr' ? 'fr' : 'en');
  const per = t('/mois', '/month');
  return (
    <Section icon={<CircleDollarSign className="size-5" />} title={t('Facturation Clover', 'Clover billing')}
      subtitle={data ? t(data.pricing.fr, data.pricing.en) : undefined}
      right={<Button size="sm" variant="outline" loading={busy === 'refresh'} onClick={() => load(true)} icon={<RefreshCw className="size-4" />}>{t('Relire Clover', 'Ask Clover again')}</Button>}>
      {err && <Banner tone="stop" className="mb-3">{err}</Banner>}
      {!data && !err && <div className="h-24 animate-pulse rounded-lg bg-sunken" />}
      {p && (
        <>
          <Banner tone={p.enabled && p.meteredIdSet ? 'info' : 'warn'} className="mb-4"
            action={p.enabled && p.meteredIdSet ? <Button size="sm" variant="outline" loading={busy === 'run'} onClick={() => post({ action: 'run' }, 'run')} icon={<Send className="size-4" />}>{t('Lancer maintenant', 'Run now')}</Button> : undefined}>
            {p.enabled && p.meteredIdSet
              ? t(`Envoi des marques supplémentaires à Clover : activé. Le mois ${p.previousMonth} est envoyé une seule fois pendant ${p.month}.`, `Sending extra brands to Clover: on. ${p.previousMonth} is sent once during ${p.month}.`)
              : t('Aperçu seulement : rien n’est envoyé à Clover tant que FOODHUB_CLOVER_METERED_ENABLED=true et CLOVER_METERED_EXTRA_BRAND_ID ne sont pas réglés (docs/CLOVER_BILLING.md).', 'Preview only: nothing is sent to Clover until FOODHUB_CLOVER_METERED_ENABLED=true and CLOVER_METERED_EXTRA_BRAND_ID are set (docs/CLOVER_BILLING.md).')}
            {p.exemptCount > 0 && <> {t(`${p.exemptCount} marchand(s) exempté(s).`, `${p.exemptCount} exempt merchant(s).`)}</>}
          </Banner>
          {p.merchants.length === 0 && <p className="text-[14px] text-ink-3">{t('Aucun marchand approuvé par l’app Clover pour l’instant.', 'No merchant approved through the Clover app yet.')}</p>}
          <div className="space-y-4">
            {p.merchants.map((m) => (
              <div key={m.merchantId} className="rounded-lg border border-line p-4" data-testid="billing-merchant">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1"><div className="font-bold">{m.name || m.merchantId}</div><div className="num text-[12px] text-ink-3">{m.merchantId}</div></div>
                  {m.exempt && <Badge tone="go">{t('Exempté', 'Exempt')}</Badge>}
                  <Badge tone={m.status.tone === 'active' || m.status.tone === 'trial' ? 'go' : 'wait'}>{t(m.status.text.fr, m.status.text.en)}</Badge>
                </div>
                {m.live.brands.length === 0
                  ? <p className="mt-3 text-[13px] text-ink-3">{t('Aucune marque branchée sur Uber Eats, DoorDash ou SkipTheDishes.', 'No brand connected on Uber Eats, DoorDash or SkipTheDishes.')}</p>
                  : (
                    <ul className="mt-3 space-y-1 text-[13px]">
                      {m.live.brands.map((b) => (
                        <li key={b.brand} className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{b.brand}</span>
                          <span className="text-ink-3">{b.platforms.map((x) => BILLED_PLATFORM_LABELS[x]).join(', ')}</span>
                          {b.extra
                            ? <Badge tone="wait">{`${b.units} × ${money(EXTRA_BRAND_PLATFORM_CAD)} = ${money(b.units * EXTRA_BRAND_PLATFORM_CAD)}${per}`}</Badge>
                            : <Badge tone="go">{m.live.firstBrandSource === 'owner' ? t('Marque principale : incluse', 'Main brand: included') : t('Première marque : incluse', 'First brand: included')}</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                {m.live.brands.length > 1 && (
                  <label className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                    {t('Marque principale (incluse)', 'Main brand (included)')}
                    <Select className="w-56" value={m.firstBrandMarked ?? ''} disabled={busy === `primary:${m.merchantId}`}
                      onChange={(e) => post({ action: 'primary', merchantId: m.merchantId, brandName: e.target.value || null }, `primary:${m.merchantId}`)}>
                      <option value="">{t('Automatique (la plus ancienne)', 'Automatic (the oldest)')}</option>
                      {m.live.brands.map((b) => <option key={b.brand} value={b.brand}>{b.brand}</option>)}
                    </Select>
                  </label>
                )}
                <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
                  <div className="rounded-md bg-sunken px-3 py-2" data-testid="billing-current">
                    <div className="font-semibold text-ink">{t(`Ce mois-ci (${m.current.month})`, `This month (${m.current.month})`)}</div>
                    <div className="text-ink-2">{m.exempt ? t('Exempté : 0 $', 'Exempt: $0') : `${m.current.units} ${t('unité(s)', 'unit(s)')} = ${money(m.current.amountCad)}`}</div>
                    {!m.exempt && !m.status.paid && <div className="text-ink-3">{t('Pas compté pendant l’essai gratuit ou un abonnement non payé.', 'Not counted during the free trial or an unpaid subscription.')}</div>}
                  </div>
                  <div className="rounded-md bg-sunken px-3 py-2" data-testid="billing-due">
                    <div className="font-semibold text-ink">{t(`Envoi pour ${m.due.month}`, `Report for ${m.due.month}`)}</div>
                    <div className="text-ink-2">{`${m.due.units} ${t('unité(s)', 'unit(s)')} = ${money(m.due.amountCad)} — ${t(WHY[m.due.why].fr, WHY[m.due.why].en)}`}</div>
                    {m.due.request && <code className="mt-1 block truncate font-mono text-[11px] text-ink-3" title={m.due.request}>{m.due.request}</code>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <div className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{t('Journal de facturation', 'Billing log')}</div>
            {data.log.length === 0
              ? <p className="mt-1 text-[13px] text-ink-3">{t('Rien pour l’instant.', 'Nothing yet.')}</p>
              : (
                <ul className="mt-1 divide-y divide-line text-[13px]">
                  {data.log.map((e, i) => (
                    <li key={`${e.at}-${i}`} className="flex flex-wrap gap-x-3 py-1.5">
                      <span className="num text-ink-3">{new Date(e.at).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')}</span>
                      <span className="font-semibold">{t(EVENT[e.event]?.fr ?? e.event, EVENT[e.event]?.en ?? e.event)}</span>
                      <span className="num">{e.merchantId} · {e.month}</span>
                      <span>{`${e.units} ${t('unité(s)', 'unit(s)')} = ${money(e.amountCad)}`}</span>
                      {e.detail && <span className="w-full text-ink-3">{e.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </>
      )}
    </Section>
  );
}
