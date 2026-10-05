'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Flame, Pause, Play, Snowflake, Store as StoreIcon } from 'lucide-react';
import { Badge, PlatformTag, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Chips, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { refreshEverything, usePulse, useRefreshOn } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { StoresTabs } from './stores-tabs';
import { api, ApiError, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';
import type { ChannelStore, PlatformStatus } from '@/lib/foodhub/types';

type PrepSetting = { normal: number; busy: number; isBusy: boolean };
type Result = { channel: string; brandName: string; locationCode: string; result: { ok: boolean; status: string; message: string } };

export function stateOf(s: ChannelStore): { state: string; tone: Tone; ps?: PlatformStatus } {
  const ps = s.meta?.platformStatus as PlatformStatus | undefined;
  const state = ps?.state ?? (s.online ? 'online' : 'paused');
  const tone: Tone = state === 'online' ? 'go' : state === 'paused' ? 'wait' : state === 'deactivated' ? 'stop' : 'neutral';
  return { state, tone, ps };
}
export function stateText(t: T, state: string) {
  return ({ online: t('En ligne', 'Online'), paused: t('En pause', 'Paused'), closed: t('Fermé (heures)', 'Closed (hours)'), deactivated: t('Désactivé', 'Deactivated'), unknown: t('Inconnu', 'Unknown') } as Record<string, string>)[state] ?? state;
}

export function StoresView() {
  const { t, loc } = useI18n();
  const { locations, can } = useViewer();
  const { scope } = usePulse();
  const toast = useToast();
  const [stores, setStores] = useState<ChannelStore[] | null>(null);
  const [prep, setPrep] = useState<Record<string, PrepSetting>>({});
  const [pauseFor, setPauseFor] = useState<{ ids: string[]; label: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([api<{ stores: ChannelStore[] }>('/api/foodhub/stores'), api<{ prep: Record<string, PrepSetting> }>('/api/foodhub/prep')]).catch(() => [null, null] as const);
    if (s) setStores(s.stores);
    if (p) setPrep(p.prep);
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  useRefreshOn(load);

  const shownLocs = locations.filter((l) => !scope.length || scope.includes(l.code));

  async function setOnline(ids: string[], online: boolean, minutes = 0, reason?: string) {
    setBusy(ids.join(','));
    try {
      const r = await api<{ results: Result[] }>('/api/foodhub/stores/status', { method: 'POST', json: { storeIds: ids, online, minutes, reason } });
      const bad = r.results.filter((x) => !x.result.ok);
      if (bad.length) toast.error(t(`${bad.length} plateforme(s) ont refusé`, `${bad.length} platform(s) refused`), bad.map((b) => `${b.channel}: ${b.result.message}`).join('\n'));
      else toast.success(online ? t('Rouvert sur les plateformes', 'Reopened on the platforms') : t('Mis en pause sur les plateformes', 'Paused on the platforms'), `${r.results.length} ${t('magasin(s)', 'store(s)')}`);
      setPauseFor(null);
      await load(); refreshEverything();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  async function savePrep(code: string, patch: Partial<PrepSetting>) {
    try { const r = await api<{ prep: PrepSetting }>('/api/foodhub/prep', { method: 'POST', json: { locationCode: code, ...patch } }); setPrep((p) => ({ ...p, [code]: r.prep })); refreshEverything(); toast.success(t('Temps de préparation enregistré', 'Prep time saved')); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div>
      <PageHeader title={t('Magasins', 'Stores')} subtitle={t('Ouvrez, mettez en pause et réglez le temps de préparation — sur toutes les plateformes d’un coup.', 'Open, pause and set prep time — on every platform at once.')} />
      <StoresTabs />
      {stores && stores.length === 0 && (
        <Card><EmptyState icon={<StoreIcon className="size-6" />} title={t('Aucun magasin branché', 'No store connected yet')} body={t('Branchez vos magasins Uber Eats, DoorDash, Skip et TGTG pour les contrôler d’ici.', 'Connect your Uber Eats, DoorDash, Skip and TGTG stores to control them from here.')} action={can('stores:map') ? <Button variant="brand" onClick={() => { window.location.href = '/stores/mapping'; }}>{t('Brancher un magasin', 'Connect a store')}</Button> : undefined} /></Card>
      )}
      <div className="space-y-5">
        {shownLocs.map((l) => {
          const list = (stores ?? []).filter((s) => s.locationCode === l.code).sort((a, b) => a.brandName.localeCompare(b.brandName) || a.channel.localeCompare(b.channel));
          const p: PrepSetting = Object.assign({ normal: 15, busy: 25, isBusy: false }, prep[l.code]);
          if (!stores) return <div key={l.code} className="h-48 animate-pulse rounded-lg bg-sunken" />;
          const online = list.filter((s) => stateOf(s).state === 'online').length;
          return (
            <Card key={l.code}>
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
                <div className="min-w-0 flex-1"><h2 className="text-lg font-extrabold">{shortLoc(l.name)}</h2><div className="text-[13px] text-ink-3">{l.address} · {online}/{list.length} {t('en ligne', 'online')}</div></div>
                {list.length > 0 && can('stores:toggle') && <>
                  <Button variant="outline" size="sm" onClick={() => setPauseFor({ ids: list.filter((s) => stateOf(s).state === 'online').map((s) => s.id), label: shortLoc(l.name) })} icon={<Pause className="size-4" />} disabled={!online}>{t('Tout mettre en pause', 'Pause all')}</Button>
                  <Button variant="outline" size="sm" loading={busy === list.map((s) => s.id).join(',')} onClick={() => setOnline(list.map((s) => s.id), true)} icon={<Play className="size-4" />}>{t('Tout rouvrir', 'Resume all')}</Button>
                </>}
              </div>
              <PrepRow code={l.code} p={p} editable={can('stores:toggle')} onSave={savePrep} />
              {list.length === 0 ? <div className="px-5 py-6 text-sm text-ink-3">{t('Aucun magasin branché ici.', 'No store connected here.')}</div> : (
                <div className="divide-y divide-line">
                  {list.map((s) => {
                    const st = stateOf(s);
                    return (
                      <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                        <div className="w-44 min-w-0"><div className="truncate text-sm font-bold">{s.brandName}</div><PlatformTag channel={s.channel} className="text-xs font-medium text-ink-3" /></div>
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <Badge tone={st.tone}>{stateText(t, st.state)}</Badge>
                          {st.ps?.source === 'dashboard' && st.state !== 'online' && <span className="text-xs text-ink-3">{t('par TAKATAK', 'from TAKATAK')}</span>}
                          {st.ps?.source && st.ps.source !== 'dashboard' && st.state !== 'online' && <span className="text-xs font-semibold text-wait-2">{t('par la plateforme', 'by the platform')}</span>}
                          {s.pausedUntil && !s.online && <span className="text-xs text-ink-3">{t('jusqu’à', 'until')} {timeOf(s.pausedUntil, loc)}</span>}
                          {st.ps?.detail && <span className="truncate text-xs text-ink-3" title={st.ps.detail}>{st.ps.detail}</span>}
                          {st.ps?.error && <Badge tone="stop" title={st.ps.error}>{t('lecture impossible', 'cannot read')}</Badge>}
                          {!s.autoAccept && <Badge tone="neutral">{t('acceptation manuelle', 'manual accept')}</Badge>}
                        </div>
                        {can('stores:toggle') && (st.state === 'online'
                          ? <Button size="sm" variant="outline" onClick={() => setPauseFor({ ids: [s.id], label: `${s.brandName} · ${s.channel}` })} icon={<Pause className="size-4" />}>{t('Pause', 'Pause')}</Button>
                          : st.state !== 'deactivated' && <Button size="sm" variant="go" loading={busy === s.id} onClick={() => setOnline([s.id], true)} icon={<Play className="size-4" />}>{t('Rouvrir', 'Resume')}</Button>)}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {pauseFor && <PauseDialog label={pauseFor.label} count={pauseFor.ids.length} busy={busy !== null} onClose={() => setPauseFor(null)} onPause={(m, r) => setOnline(pauseFor.ids, false, m, r)} />}
    </div>
  );
}

function PrepRow({ code, p, editable, onSave }: { code: string; p: PrepSetting; editable: boolean; onSave: (code: string, patch: Partial<PrepSetting>) => void }) {
  const { t } = useI18n();
  const [normal, setNormal] = useState(p.normal);
  const [busyMin, setBusyMin] = useState(p.busy);
  useEffect(() => { setNormal(p.normal); setBusyMin(p.busy); }, [p.normal, p.busy]);
  const changed = normal !== p.normal || busyMin !== p.busy;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-raised px-5 py-3 text-sm">
      <span className="font-semibold text-ink-2">{t('Préparation', 'Prep time')}</span>
      <label className="flex items-center gap-1.5 text-ink-3">{t('normal', 'normal')}<Input inputSize="sm" type="number" min={5} max={120} className="w-16" value={normal} disabled={!editable} onChange={(e) => setNormal(Number(e.target.value))} />min</label>
      <label className="flex items-center gap-1.5 text-ink-3">{t('occupé', 'busy')}<Input inputSize="sm" type="number" min={5} max={120} className="w-16" value={busyMin} disabled={!editable} onChange={(e) => setBusyMin(Number(e.target.value))} />min</label>
      {editable && changed && <Button size="xs" onClick={() => onSave(code, { normal, busy: busyMin })}>{t('Enregistrer', 'Save')}</Button>}
      <span className="flex-1" />
      {editable && <Button size="sm" variant={p.isBusy ? 'danger' : 'outline'} onClick={() => onSave(code, { isBusy: !p.isBusy })} icon={p.isBusy ? <Flame className="size-4" /> : <Snowflake className="size-4" />}>{p.isBusy ? t(`Mode occupé (${p.busy} min) — arrêter`, `Busy (${p.busy} min) — stop`) : t('Activer le mode occupé', 'Turn on busy mode')}</Button>}
    </div>
  );
}

function PauseDialog({ label, count, busy, onClose, onPause }: { label: string; count: number; busy: boolean; onClose: () => void; onPause: (minutes: number, reason: string) => void }) {
  const { t } = useI18n();
  const [minutes, setMinutes] = useState(30);
  const [reason, setReason] = useState('busy');
  const reasons = useMemo(() => [
    { value: 'busy', label: t('Trop occupé', 'Too busy'), text: 'Kitchen too busy' },
    { value: 'stock', label: t('Rupture', 'Out of stock'), text: 'Out of stock' },
    { value: 'tech', label: t('Problème technique', 'Technical issue'), text: 'Technical issue' },
    { value: 'closed', label: t('Fermeture', 'Closing'), text: 'Closed' },
  ], [t]);
  return (
    <Modal title={t('Mettre en pause', 'Pause')} subtitle={`${label} · ${count} ${t('magasin(s) sur toutes les plateformes', 'store(s) on every platform')}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Retour', 'Back')}</Button><Button variant="danger" size="lg" loading={busy} onClick={() => onPause(minutes, reasons.find((r) => r.value === reason)?.text ?? '')} icon={<Pause className="size-5" />}>{minutes ? t(`Pause ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}`, `Pause ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}`) : t('Pause jusqu’à réouverture', 'Pause until resumed')}</Button></>}>
      <div className="space-y-5">
        <div><div className="mb-2 text-[13px] font-semibold text-ink-2">{t('Combien de temps ?', 'How long?')}</div><Chips size="lg" value={minutes} onChange={setMinutes} options={[{ value: 15, label: '15 min' }, { value: 30, label: '30 min' }, { value: 60, label: '1 h' }, { value: 120, label: '2 h' }, { value: 0, label: t('Jusqu’à réouverture', 'Until resumed') }]} /></div>
        <div><div className="mb-2 text-[13px] font-semibold text-ink-2">{t('Pourquoi ?', 'Why?')}</div><Chips value={reason} onChange={setReason} options={reasons.map((r) => ({ value: r.value, label: r.label }))} /></div>
        <p className="text-xs text-ink-3">{t('Chaque minute en pause = des ventes perdues. Les pauses minutées rouvrent toutes seules. Un gérant peut devoir approuver.', 'Every minute paused is lost sales. Timed pauses reopen by themselves. A manager may need to approve.')}</p>
      </div>
    </Modal>
  );
}
