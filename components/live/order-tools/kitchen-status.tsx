'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Flame, Lock, Minus, Pause, Play, Plus, Snowflake, Store } from 'lucide-react';
import { PlatformMark, platformOf } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chips } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { refreshEverything } from '@/components/live/pulse';
import { api, ApiError, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import {
  kitchenStatusText, kitchenStores, PAUSE_CHOICES, PAUSE_REASONS, pauseMinutes, pauseTargets, resumeHeld, resumeTargets, stepBusyMinutes, summarizeKitchen,
  type KitchenStore, type PauseChoice, type PrepLike,
} from '@/lib/foodhub/order-tools/kitchen-status';
import { notChangedLines, outcomeOf, type ResultRow } from '@/lib/foodhub/order-tools/outcome';
import type { ChannelKey } from '@/lib/foodhub/types';
import { cn } from '@/lib/ui/cn';

type KitchenFacts = { closesInMin: number | null; brandsCloseInMin: Record<string, number | null>; forbiddenStoreIds: string[] };
type StatusResult = { results: ResultRow[]; notSent: Array<{ storeId: string; reason: string }> };

/**
 * Store status from the kitchen: one header button ("Ouvert · Normal 15 min", "Occupé · 25 min", "En pause jusqu'à
 * 18:30 (3/5)") opening a sheet — busy on/off and busy minutes ±5 (POST /api/foodhub/prep), pause by channel and brand
 * with a reason (POST /api/foodhub/order-tools/kitchen/status, manager PIN through the existing "store.pause" rule),
 * "Tout rouvrir" (the kitchen's own pauses only: holiday and platform closures stay closed). Protected and "Do not
 * touch" stores are shown locked; the route refuses them on the server too.
 */
export function KitchenStatus({ locationCode }: { locationCode: string }) {
  const { t, lang, loc } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const [stores, setStores] = useState<KitchenStore[] | null>(null);
  const [prep, setPrep] = useState<PrepLike | null>(null);
  const [facts, setFacts] = useState<KitchenFacts | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [duration, setDuration] = useState<PauseChoice>(30);
  const [channels, setChannels] = useState<ChannelKey[] | null>(null);
  const [brands, setBrands] = useState<string[] | null>(null);
  const [reason, setReason] = useState(PAUSE_REASONS[0].value);
  const allowed = can('stores:toggle');

  const load = useCallback(async () => {
    const [s, p, f] = await Promise.all([
      api<{ stores: KitchenStore[] }>('/api/foodhub/stores').catch(() => null),
      api<{ prep: Record<string, PrepLike> }>('/api/foodhub/prep').catch(() => null),
      api<KitchenFacts>(`/api/foodhub/order-tools/kitchen?locationCode=${encodeURIComponent(locationCode)}`).catch(() => null),
    ]);
    if (s) setStores(s.stores);
    if (p) setPrep(p.prep[locationCode] ?? null);
    if (f) setFacts(f);
  }, [locationCode]);
  useEffect(() => { if (!allowed) return; load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [allowed, load]);

  const k = useMemo(() => (stores && facts ? kitchenStores(stores, locationCode, facts.forbiddenStoreIds) : null), [stores, facts, locationCode]);
  const summary = k ? summarizeKitchen(prep, k) : null;
  const pickChannels = channels ?? k?.channels ?? [];
  const pickBrands = brands ?? k?.brands ?? [];
  const targets = k ? pauseTargets(k, { channels: pickChannels, brands: pickBrands }) : [];
  const resume = k ? resumeTargets(k) : [];
  const held = k ? resumeHeld(k) : new Map<string, string>();
  const locked = k?.stores.filter((s) => s.locked) ?? [];
  const closeKnown = pickBrands.map((b) => facts?.brandsCloseInMin[b]).filter((m): m is number => typeof m === 'number');
  const closesInMin = closeKnown.length ? Math.max(...closeKnown) : null;
  const minutes = pauseMinutes(duration, closesInMin);
  const p = { isBusy: false, normal: 15, busy: 25, ...(prep ?? {}) };

  if (!allowed) return null;

  async function savePrep(json: Record<string, unknown>, okText: string) {
    setBusy('prep');
    try {
      const r = await api<{ prep: PrepLike }>('/api/foodhub/prep', { method: 'POST', json: { locationCode, ...json } });
      setPrep(r.prep); toast.success(okText); refreshEverything();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(t('Changement impossible', 'Could not change it'), e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  async function setOnline(ids: string[], online: boolean) {
    if (!ids.length) return;
    setBusy(online ? 'resume' : 'pause');
    try {
      const why = PAUSE_REASONS.find((r) => r.value === reason)?.text;
      const r = await api<StatusResult>('/api/foodhub/order-tools/kitchen/status', { method: 'POST', json: online ? { locationCode, storeIds: ids, online: true } : { locationCode, storeIds: ids, online: false, minutes: minutes ?? 0, reason: why } });
      // Counted from each row's status (a skipped row is not "changed"); stores the server refused are counted too.
      const o = outcomeOf(r.results);
      const asked = r.results.length + (r.notSent?.length ?? 0);
      const lines = [...notChangedLines(o), ...(r.notSent?.length ? [t(`${r.notSent.length} non envoyé(s) : verrouillé, autre cuisine ou fermé par la plateforme / un férié`, `${r.notSent.length} not sent: locked, another kitchen, or closed by the platform / a holiday`)] : [])];
      if (o.changed.length === asked && asked > 0) toast.success(online ? t('Rouvert sur les plateformes', 'Reopened on the platforms') : t('En pause sur les plateformes', 'Paused on the platforms'), `${o.changed.length} ${t('magasin(s)', 'store(s)')}`);
      else toast.warn(t(`${o.changed.length}/${asked} magasin(s) changé(s)`, `${o.changed.length}/${asked} store(s) changed`), lines.join('\n'));
      await load(); refreshEverything();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(t('Changement impossible', 'Could not change it'), e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  const toggle = <V,>(list: V[], v: V) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const label = summary ? kitchenStatusText(summary, lang === 'fr' ? 'fr' : 'en', (iso) => timeOf(iso, loc)) : t('Statut du magasin', 'Store status');
  const durationLabel = (c: PauseChoice) => (c === 'close' ? t('Jusqu’à la fermeture', 'Until closing') : c === 60 ? '1 h' : `${c} min`);

  return (
    <>
      <Button size="lg" variant={summary?.kind === 'paused' ? 'danger' : summary?.kind === 'busy' ? 'brand' : 'outline'} onClick={() => { setOpen(true); load(); }}
        icon={summary?.kind === 'paused' ? <Pause className="size-5" /> : summary?.kind === 'busy' ? <Flame className="size-5" /> : <Store className="size-5" />}>
        {label}
      </Button>
      {open && (
        <Modal size="lg" title={t('Statut du magasin', 'Store status')} subtitle={label} onClose={() => setOpen(false)}
          footer={<Button variant="ghost" size="lg" onClick={() => setOpen(false)}>{t('Fermer', 'Close')}</Button>}>
          {!k && <div className="h-40 animate-pulse rounded-lg bg-sunken" />}
          {k && (
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 text-sm font-bold text-ink">{t('Temps de préparation', 'Prep time')}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="lg" variant={p.isBusy ? 'outline' : 'primary'} loading={busy === 'prep' && p.isBusy} onClick={() => p.isBusy && savePrep({ isBusy: false }, t('Retour au temps normal', 'Back to normal time'))} icon={<Snowflake className="size-5" />}>{t(`Normal · ${p.normal} min`, `Normal · ${p.normal} min`)}</Button>
                  <Button size="lg" variant={p.isBusy ? 'brand' : 'outline'} loading={busy === 'prep' && !p.isBusy} onClick={() => !p.isBusy && savePrep({ isBusy: true }, t('Mode occupé activé', 'Busy mode on'))} icon={<Flame className="size-5" />}>{t(`Occupé · ${p.busy} min`, `Busy · ${p.busy} min`)}</Button>
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="lg" variant="soft" aria-label={t('Moins 5 minutes', 'Minus 5 minutes')} disabled={busy === 'prep' || p.busy <= 5} onClick={() => savePrep({ busy: stepBusyMinutes(p.busy, -5) }, t('Temps occupé changé', 'Busy time changed'))} icon={<Minus className="size-5" />} />
                    <span className="num w-20 text-center text-base font-extrabold">{p.busy} min</span>
                    <Button size="lg" variant="soft" aria-label={t('Plus 5 minutes', 'Plus 5 minutes')} disabled={busy === 'prep' || p.busy >= 120} onClick={() => savePrep({ busy: stepBusyMinutes(p.busy, 5) }, t('Temps occupé changé', 'Busy time changed'))} icon={<Plus className="size-5" />} />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-bold text-ink">{t('Mettre en pause', 'Pause')}</h3>
                <Chips size="lg" value={duration} onChange={setDuration} options={PAUSE_CHOICES.map((c) => ({ value: c, label: durationLabel(c) }))} />
                {duration === 'close' && minutes === null && <p className="text-xs text-stop">{t('Heure de fermeture inconnue (ou déjà fermé) : choisissez une durée.', 'Closing time unknown (or already closed): pick a duration.')}</p>}
                <div>
                  <div className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('Plateformes', 'Platforms')}</div>
                  <div className="flex flex-wrap gap-2">
                    {k.channels.map((c) => (
                      <Toggle key={c} on={pickChannels.includes(c)} onClick={() => setChannels(toggle(pickChannels, c))}><PlatformMark channel={c} size="sm" />{platformOf(c).label}</Toggle>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('Marques', 'Brands')}</div>
                  <div className="flex flex-wrap gap-2">
                    {k.brands.map((b) => <Toggle key={b} on={pickBrands.includes(b)} onClick={() => setBrands(toggle(pickBrands, b))}>{b}</Toggle>)}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('Pourquoi ?', 'Why?')}</div>
                  <Chips size="lg" value={reason} onChange={setReason} options={PAUSE_REASONS.map((r) => ({ value: r.value, label: lang === 'fr' ? r.fr : r.en }))} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="lg" variant="danger" loading={busy === 'pause'} disabled={!targets.length || minutes === null || Boolean(busy)} onClick={() => setOnline(targets, false)} icon={<Pause className="size-5" />}>
                    {t(`Mettre en pause (${targets.length} magasin${targets.length > 1 ? 's' : ''})`, `Pause (${targets.length} store${targets.length > 1 ? 's' : ''})`)}
                  </Button>
                  {resume.length > 0 && <Button size="lg" variant="go" loading={busy === 'resume'} disabled={Boolean(busy)} onClick={() => setOnline(resume, true)} icon={<Play className="size-5" />}>{t(`Tout rouvrir (${resume.length})`, `Reopen all (${resume.length})`)}</Button>}
                </div>
                <p className="text-xs text-ink-3">{t('Chaque minute en pause = des ventes perdues. Les pauses minutées rouvrent toutes seules. Un gérant peut devoir entrer son NIP.', 'Every minute paused is lost sales. Timed pauses reopen by themselves. A manager may need to enter their PIN.')}</p>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-bold text-ink">{t('Magasins de cette cuisine', 'This kitchen’s stores')}</h3>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {k.stores.map((s) => (
                    <li key={s.id} className={cn('flex min-h-12 items-center gap-3 px-3 py-2 text-[13px]', s.locked && 'opacity-70')}>
                      <PlatformMark channel={s.channel} size="sm" />
                      <span className="flex-1 font-semibold text-ink">{s.brandName}</span>
                      {s.locked
                        ? <span className="inline-flex items-center gap-1 text-ink-3"><Lock className="size-3.5" />{s.lockReason === 'forbidden' ? t('Protégé — jamais touché', 'Protected — never touched') : t('« Ne pas toucher »', '“Do not touch”')}</span>
                        : s.online === false
                          ? (
                            <span className="text-right font-semibold text-stop">
                              {s.pausedUntil ? t(`En pause jusqu’à ${timeOf(s.pausedUntil, loc)}`, `Paused until ${timeOf(s.pausedUntil, loc)}`) : t('En pause', 'Paused')}
                              {held.has(s.id) && <span className="block text-xs font-normal text-ink-3">{held.get(s.id) === 'holiday' ? t('Fermé pour un férié — pas dans « Tout rouvrir »', 'Holiday closure — not in “Reopen all”') : t('Fermé par la plateforme — pas dans « Tout rouvrir »', 'Closed by the platform — not in “Reopen all”')}</span>}
                            </span>
                          )
                          : <span className="text-go-2">{t('Ouvert', 'Open')}</span>}
                    </li>
                  ))}
                  {k.stores.length === 0 && <li className="px-3 py-4 text-ink-3">{t('Aucun magasin de plateforme relié à cette cuisine.', 'No platform store mapped to this kitchen.')}</li>}
                </ul>
                {locked.length > 0 && <p className="mt-2 text-xs text-ink-3">{t(`${locked.length} magasin(s) verrouillé(s) : affichés seulement, jamais inclus dans une pause ou une réouverture.`, `${locked.length} locked store(s): shown only, never included in a pause or a reopen.`)}</p>}
              </section>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('inline-flex min-h-12 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors', on ? 'border-ink bg-ink text-canvas' : 'border-line-2 bg-surface text-ink-2 hover:border-ink-4 hover:text-ink')}>
      {on && <Check className="size-4" />}{children}
    </button>
  );
}
