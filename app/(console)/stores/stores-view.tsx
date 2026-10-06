'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Pause, Play, Snowflake, Store as StoreIcon } from 'lucide-react';
import { Badge, PlatformTag, type Tone } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Chips, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { DraftRestoredBanner, SaveChip } from '@/components/ui/save-chip';
import { Hint } from '@/components/help/hint';
import { refreshEverything, usePulse, useRefreshOn } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { StoresTabs } from './stores-tabs';
import { api, ApiError, timeOf } from '@/lib/ui/api';
import { sameValue } from '@/lib/ui/autosave-core';
import { useAutosave } from '@/lib/ui/use-autosave';
import { useUndo } from '@/lib/ui/use-undo';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';
import type { ChannelStore, PlatformStatus } from '@/lib/foodhub/types';

type PrepSetting = { normal: number; busy: number; isBusy: boolean };
/** Body of POST /api/foodhub/prep: minutes and/or busy mode for one location. */
type PrepPatch = { locationCode: string; normal?: number | null; busy?: number | null; isBusy?: boolean };
/** The two prep times of one location, as typed (null = field emptied while typing). */
type PrepTimes = { normal: number | null; busy: number | null };
/** What the server keeps: anything outside 5–120 min it would change silently, so the screen says so instead. */
const PREP_MIN = 5;
const PREP_MAX = 120;
const minutesOf = (raw: string) => (raw.trim() === '' ? null : Number(raw));
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

  /** Prep writes finished on this screen: a refresh that overlapped one may hold the older copy, so its prep part is skipped. */
  const prepWrites = useRef(0);
  const load = useCallback(async () => {
    const writes = prepWrites.current;
    const [s, p] = await Promise.all([api<{ stores: ChannelStore[] }>('/api/foodhub/stores'), api<{ prep: Record<string, PrepSetting> }>('/api/foodhub/prep')]).catch(() => [null, null] as const);
    if (s) setStores(s.stores);
    if (p && writes === prepWrites.current) setPrep(p.prep);
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

  /**
   * Every prep write of this screen (autosave of each row, busy mode) goes one at a time: the server rewrites all the
   * locations' settings together, so two rows saving at once (⌘S, network back) could undo one another, and two manager
   * PIN requests at once would leave one waiting forever. The answer is the server's copy for that location.
   */
  const prepQueue = useRef<Promise<unknown>>(Promise.resolve());
  const sendPrep = useCallback((json: PrepPatch) => {
    const sent = prepQueue.current.then(() => api<{ prep: PrepSetting }>('/api/foodhub/prep', { method: 'POST', json }));
    prepQueue.current = sent.catch(() => undefined);
    return sent.then((r) => { prepWrites.current += 1; setPrep((all) => ({ ...all, [json.locationCode]: r.prep })); refreshEverything(); return r.prep; });
  }, []);

  /** Busy mode stays an explicit button: it changes the time the kitchen and the platforms work with right now. */
  async function setBusyMode(code: string, isBusy: boolean) {
    try {
      const prep = await sendPrep({ locationCode: code, isBusy });
      const min = isBusy ? prep.busy : prep.normal;
      toast.success(isBusy ? t('Mode occupé activé', 'Busy mode on') : t('Mode occupé arrêté', 'Busy mode off'), t(`Préparation : ${min} min`, `Prep time: ${min} min`));
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div>
      <PageHeader title={t('Magasins', 'Stores')} subtitle={t('Ouvrez, mettez en pause et réglez le temps de préparation — sur toutes les plateformes d’un coup.', 'Open, pause and set prep time — on every platform at once.')} />
      <StoresTabs />
      {stores && stores.length === 0 && (
        <Card><EmptyState icon={<StoreIcon className="size-6" />} title={t('Aucun magasin branché', 'No store connected yet')} body={t('Branchez vos magasins Uber Eats, DoorDash, Skip et TGTG pour les contrôler d’ici.', 'Connect your Uber Eats, DoorDash, Skip and TGTG stores to control them from here.')} action={can('stores:map') ? <ButtonLink href="/stores/mapping" variant="brand">{t('Brancher un magasin', 'Connect a store')}</ButtonLink> : undefined} /></Card>
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
                  <Button variant="outline" onClick={() => setPauseFor({ ids: list.filter((s) => stateOf(s).state === 'online').map((s) => s.id), label: shortLoc(l.name) })} icon={<Pause className="size-4" />} disabled={!online}>{t('Tout mettre en pause', 'Pause all')}</Button>
                  <Hint id="stores.resume"><Button variant="outline" loading={busy === list.map((s) => s.id).join(',')} onClick={() => setOnline(list.map((s) => s.id), true)} icon={<Play className="size-4" />}>{t('Tout rouvrir', 'Resume all')}</Button></Hint>
                </>}
              </div>
              <PrepRow code={l.code} p={p} editable={can('stores:toggle')} send={sendPrep} onBusyMode={setBusyMode} />
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
                          ? <Button variant="outline" onClick={() => setPauseFor({ ids: [s.id], label: `${s.brandName} · ${s.channel}` })} icon={<Pause className="size-4" />}>{t('Pause', 'Pause')}</Button>
                          : st.state !== 'deactivated' && <Hint id="stores.resume"><Button variant="go" loading={busy === s.id} onClick={() => setOnline([s.id], true)} icon={<Play className="size-4" />}>{t('Rouvrir', 'Resume')}</Button></Hint>)}
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

/**
 * One location's prep times. They save by themselves, row by row (no Save button): kept on this tablet at once,
 * sent 1.2 s after the last change, retried if the network drops; the row's chip says where it is. Busy mode stays
 * an explicit button.
 */
function PrepRow({ code, p, editable, send, onBusyMode }: { code: string; p: PrepSetting; editable: boolean; send: (json: PrepPatch) => Promise<PrepSetting>; onBusyMode: (code: string, isBusy: boolean) => Promise<void> }) {
  const { t } = useI18n();
  const { viewer } = useViewer();
  const [times, setTimes] = useState<PrepTimes | null>(null);
  const [switching, setSwitching] = useState(false);

  const validate = useCallback((v: PrepTimes) => {
    const ok = (n: number | null) => n !== null && Number.isInteger(n) && n >= PREP_MIN && n <= PREP_MAX;
    return [
      ...(ok(v.normal) ? [] : [t(`Normal : entre ${PREP_MIN} et ${PREP_MAX} min`, `Normal: ${PREP_MIN} to ${PREP_MAX} min`)]),
      ...(ok(v.busy) ? [] : [t(`Occupé : entre ${PREP_MIN} et ${PREP_MAX} min`, `Busy: ${PREP_MIN} to ${PREP_MAX} min`)]),
      ...(ok(v.normal) && ok(v.busy) && Number(v.busy) < Number(v.normal) ? [t('Occupé : au moins le temps normal', 'Busy: at least the normal time')] : []),
    ];
  }, [t]);
  const autosave = useAutosave<PrepTimes>({
    formKey: `stores-prep:${code}`, user: viewer.username, value: times, enabled: editable, validate,
    // Same call and payload as the old Save button.
    save: async (v) => {
      const prep = await send({ locationCode: code, normal: v.normal, busy: v.busy });
      return { normal: prep.normal, busy: prep.busy };
    },
    onRestore: (d) => setTimes(d),
    onSaved: (v) => setTimes(v),
  });
  // ↶ ↷ on the row's chip. The ⌘Z key stays off: several rows share this screen and one key would undo them all.
  const undo = useUndo<PrepTimes>(times, (v) => setTimes(v), { enabled: false });
  const { markLoaded } = autosave;
  const resetUndo = undo.reset;

  // First load, then every time the server copy changes (another tablet, the 30-s refresh) while the row still shows
  // the previous server copy and nothing is being sent: that copy becomes the saved starting point. What is being
  // typed here is never replaced.
  const editing = autosave.dirty || autosave.status === 'saving';
  const live = useRef({ times, editing });
  const lastServer = useRef<PrepTimes | null>(null);
  const [rebased, setRebased] = useState(0);
  useEffect(() => { live.current = { times, editing }; });
  useEffect(() => {
    const server: PrepTimes = { normal: p.normal, busy: p.busy };
    const cur = live.current;
    const before = lastServer.current;
    lastServer.current = server;
    if (cur.times !== null && (sameValue(cur.times, server) || cur.editing || !sameValue(cur.times, before))) return;
    setTimes(server); markLoaded(server); setRebased((n) => n + 1);
  }, [p.normal, p.busy, markLoaded]);
  // The undo history starts again from the server copy (in the render that shows it, so it is not an undo step).
  useEffect(() => { resetUndo(); }, [rebased, resetUndo]);

  const shown: PrepTimes = times ?? { normal: p.normal, busy: p.busy };
  const editMinutes = (k: keyof PrepTimes, raw: string) => setTimes((cur) => ({ ...(cur ?? shown), [k]: minutesOf(raw) }));

  async function toggleBusy() {
    setSwitching(true);
    try {
      // Busy mode works with the saved minutes: send what was just typed first, and wait for a save already on its way
      // (two writes at once on the server would undo one another). Never blocks busy mode during a rush.
      if (autosave.status === 'dirty' || autosave.status === 'saving') await autosave.saveNow();
      await onBusyMode(code, !p.isBusy);
    } finally { setSwitching(false); }
  }

  const field = 'h-11 w-20 text-center text-base';
  return (
    <div className="border-b border-line bg-raised px-5 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-ink-2">{t('Préparation', 'Prep time')}</span>
        <Hint id="stores.prep"><div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-ink-3">{t('normal', 'normal')}<Input type="number" inputMode="numeric" min={PREP_MIN} max={PREP_MAX} step={1} className={field} value={shown.normal ?? ''} disabled={!editable} onChange={(e) => editMinutes('normal', e.target.value)} />min</label>
          <label className="flex items-center gap-1.5 text-ink-3">{t('occupé', 'busy')}<Input type="number" inputMode="numeric" min={PREP_MIN} max={PREP_MAX} step={1} className={field} value={shown.busy ?? ''} disabled={!editable} onChange={(e) => editMinutes('busy', e.target.value)} />min</label>
        </div></Hint>
        {editable && <SaveChip autosave={autosave} undo={undo} />}
        <span className="flex-1" />
        {editable && <Hint id="stores.busy"><Button variant={p.isBusy ? 'danger' : 'outline'} loading={switching} onClick={toggleBusy} icon={p.isBusy ? <Flame className="size-4" /> : <Snowflake className="size-4" />}>{p.isBusy ? t(`Mode occupé (${p.busy} min) — arrêter`, `Busy (${p.busy} min) — stop`) : t('Activer le mode occupé', 'Turn on busy mode')}</Button></Hint>}
      </div>
      {editable && autosave.draftRestored && <DraftRestoredBanner className="mb-0 mt-3" onDiscard={autosave.discardDraft} />}
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
      footer={<><Button variant="ghost" size="lg" onClick={onClose}>{t('Retour', 'Back')}</Button><Button variant="danger" size="lg" loading={busy} onClick={() => onPause(minutes, reasons.find((r) => r.value === reason)?.text ?? '')} icon={<Pause className="size-5" />}>{minutes ? t(`Pause ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}`, `Pause ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}`) : t('Pause jusqu’à réouverture', 'Pause until resumed')}</Button></>}>
      <div className="space-y-5">
        <div><div className="mb-2 text-[13px] font-semibold text-ink-2">{t('Combien de temps ?', 'How long?')}</div><Chips size="lg" value={minutes} onChange={setMinutes} options={[{ value: 15, label: '15 min' }, { value: 30, label: '30 min' }, { value: 60, label: '1 h' }, { value: 120, label: '2 h' }, { value: 0, label: t('Jusqu’à réouverture', 'Until resumed') }]} /></div>
        <div><div className="mb-2 text-[13px] font-semibold text-ink-2">{t('Pourquoi ?', 'Why?')}</div><Chips value={reason} onChange={setReason} options={reasons.map((r) => ({ value: r.value, label: r.label }))} /></div>
        <p className="text-xs text-ink-3">{t('Chaque minute en pause = des ventes perdues. Les pauses minutées rouvrent toutes seules. Un gérant peut devoir approuver.', 'Every minute paused is lost sales. Timed pauses reopen by themselves. A manager may need to approve.')}</p>
      </div>
    </Modal>
  );
}
