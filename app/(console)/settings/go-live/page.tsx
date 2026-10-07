'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleDashed, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { useViewer } from '@/components/shell/viewer';
import { SettingsHead } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { goLiveProgress, goLiveSteps, type ChannelsData, type CloverCheck, type Device, type Fees, type Notify, type Step, type Store, type User } from '@/lib/ui/go-live-core';

export default function GoLivePage() {
  const { t } = useI18n();
  const { locations, can } = useViewer();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [ch, w, u, d, s, f, cat, ck] = await Promise.all([
        api<ChannelsData>('/api/foodhub/channels'),
        api<{ channels: Notify }>('/api/foodhub/watch/settings'),
        api<{ users: User[] }>('/api/foodhub/users'),
        api<{ devices: Device[] }>('/api/foodhub/devices'),
        api<{ stores: Store[] }>('/api/foodhub/stores'),
        api<{ fees: Fees }>('/api/foodhub/recon/fees').catch((): { fees: Fees } => ({ fees: { confirmed: {} } })),
        api<{ locations: Array<{ code: string; name: string; phone?: string | null; active: boolean }> }>('/api/foodhub/catalog'),
        api<CloverCheck>('/api/foodhub/clover-labels').catch((): CloverCheck => ({ report: null })),
      ]);
      // The checklist itself (what each row really checks) lives in lib/ui/go-live-core.ts, unit-tested.
      const out = goLiveSteps({ channels: ch, notify: w.channels, users: u.users, devices: d.devices, stores: s.stores, fees: f.fees, catalog: cat.locations, cloverCheck: ck, locations }, t);
      setSteps(out); setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [locations, t]);
  useEffect(() => { if (can('admin')) load(); }, [load, can]);

  if (!can('admin')) return <div><SettingsHead title={t('Mise en service', 'Go-live')} /><Banner tone="info">{t('Réservé au propriétaire.', 'Owner only.')}</Banner></div>;
  // 'info' rows (the outside uptime monitor) cannot be checked from here: shown, not counted.
  const { done, total, todo, optional } = goLiveProgress(steps ?? []);
  const groups = steps ? [...new Set(steps.map((s) => s.group))] : [];

  return (
    <div>
      <SettingsHead title={t('Mise en service', 'Go-live')} intro={t('Ce qui reste avant d’ouvrir les vannes. Chaque ligne se vérifie toute seule, sauf la surveillance externe ; les clés se mettent avec npm run setup ou dans l’hébergeur, jamais dans le clavardage.', 'What is left before switching everything on. Each line checks itself, except the outside uptime monitor; keys go in with npm run setup or the hosting settings, never in chat.')}
        right={<Button variant="outline" loading={busy} onClick={load} icon={<RefreshCw className="size-4" />}>{t('Revérifier', 'Re-check')}</Button>} />
      <div className="max-w-4xl">
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {steps && (
        <Card className="mb-5 p-5">
          <div className="flex items-end justify-between gap-3">
            <div><div className="text-3xl font-extrabold text-ink num">{done}/{total}</div><div className="text-[13px] text-ink-3">{t('étapes prêtes', 'steps ready')}</div></div>
            <div className="text-right text-[13px] text-ink-3">{todo} {t('à faire', 'to do')} · {optional} {t('optionnelles', 'optional')}</div>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-go transition-all" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></div>
        </Card>
      )}
      {!steps && !err && <div className="h-96 animate-pulse rounded-lg bg-sunken" />}
      {groups.map((g) => (
        <div key={g} className="mb-5">
          <div className="mb-2 text-xs font-bold tracking-wide text-ink-3 uppercase">{g}</div>
          <Card>
            <ul className="divide-y divide-line">
              {steps!.filter((s) => s.group === g).map((s) => (
                <li key={s.key} className="flex items-start gap-3 px-5 py-3.5">
                  {s.state === 'done' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-go" /> : s.state === 'warn' ? <TriangleAlert className="mt-0.5 size-5 shrink-0 text-wait" /> : s.state === 'info' ? <Info className="mt-0.5 size-5 shrink-0 text-ink-3" /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-ink-4" />}
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-sm font-bold', s.state === 'done' ? 'text-ink-2' : 'text-ink')}>{s.title}</div>
                    <div className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{s.body}</div>
                  </div>
                  {s.state !== 'done' && (s.external
                    ? <a href={s.href} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-bold text-ink hover:bg-sunken">{s.cta}<ChevronRight className="size-4" /></a>
                    : <Link href={s.href} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-bold text-ink hover:bg-sunken">{s.cta}<ChevronRight className="size-4" /></Link>)}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ))}
      </div>
    </div>
  );
}
