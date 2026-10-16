'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Ban, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { refreshEverything } from '@/components/live/pulse';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';
import type { LineRef } from '@/lib/foodhub/order-tools/line-refs';
import { startOfLocalDayMs } from '@/lib/foodhub/time';
import type { StoredOrder } from '@/lib/foodhub/types';
import { cn } from '@/lib/ui/cn';

type Refs = { brand: string | null; locationCode: string | null; hasMenu: boolean; closesInMin: number | null; lines: LineRef[] };
type Target = { ref: string; name: string; kind: 'item' | 'option' };
type Choice = 'close' | 'four' | 'today' | 'forever';
type Answer = { okCount: number; blockedCount: number; errorCount: number; results: Array<{ channel?: string; result: { ok: boolean; status?: string; message: string } }> };

/** Minutes each choice means. "Aujourd'hui" = until close; without hours set, until local midnight. */
export function quick86Minutes(choice: Choice, closesInMin: number | null, now = Date.now()): number | null {
  if (choice === 'forever') return 0;
  if (choice === 'four') return 240;
  if (closesInMin && closesInMin > 0) return closesInMin;
  if (choice === 'today') return Math.max(1, Math.ceil((startOfLocalDayMs(now) + 24 * 3600_000 - now) / 60_000));
  return null;
}

/** Honest toast headline from the availability route's counts. */
function headline(t: T, a: Answer): { kind: 'success' | 'warn' | 'error'; title: string } {
  if (a.okCount && !a.errorCount && !a.blockedCount) return { kind: 'success', title: t(`En rupture sur ${a.okCount} magasin(s)`, `Out of stock on ${a.okCount} store(s)`) };
  if (a.okCount) return { kind: 'warn', title: t(`En rupture sur ${a.okCount} magasin(s) — ${a.blockedCount + a.errorCount} non changé(s)`, `Out of stock on ${a.okCount} store(s) — ${a.blockedCount + a.errorCount} not changed`) };
  if (a.blockedCount && !a.errorCount) return { kind: 'warn', title: t('Rien n’a changé sur les plateformes (magasins verrouillés)', 'Nothing changed on the platforms (stores locked)') };
  if (!a.results.length) return { kind: 'warn', title: t('Noté dans Food Hub — aucun magasin de plateforme relié ici', 'Saved in Food Hub — no platform store mapped here') };
  return { kind: 'error', title: t('Les plateformes ont refusé la rupture', 'The platforms refused the 86') };
}

/** "Rupture" next to each line and option of a platform order: 86 it everywhere at this kitchen in two taps. */
export function Quick86({ order }: { order: Pick<StoredOrder, 'id' | 'lines' | 'brandName' | 'locationCode'> }) {
  const { t } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState<Refs | null>(null);
  const [err, setErr] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState<Choice | null>(null);
  const allowed = can('items:toggle') && Boolean(order.brandName && order.locationCode);

  const load = useCallback(async () => {
    try { setRefs(await api<Refs>(`/api/foodhub/order-tools/${order.id}/line-refs`)); setErr(''); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [order.id]);
  useEffect(() => { if (open && !refs) load(); }, [open, refs, load]);

  async function send(choice: Choice) {
    if (!target || !refs?.brand) return;
    const minutes = quick86Minutes(choice, refs.closesInMin);
    if (minutes === null) return;
    setBusy(choice);
    try {
      const a = await api<Answer>('/api/foodhub/availability', { method: 'POST', json: { brand: refs.brand, itemRefs: [target.ref], available: false, minutes, locationCode: refs.locationCode } });
      const h = headline(t, a);
      const body = a.results.filter((r) => !r.result.ok).map((r) => `${r.channel ?? ''}: ${r.result.message}`).join('\n') || target.name;
      toast[h.kind](h.title, body);
      setTarget(null);
      refreshEverything();
    } catch (e) {
      // 499 = the manager PIN pad was cancelled: nothing to say.
      if (!(e instanceof ApiError && e.status === 499)) toast.error(t('Rupture impossible', 'Could not 86'), e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  if (!allowed) return null;
  return (
    <div className="rounded-lg border border-line bg-surface">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-2 px-4 text-left text-sm font-bold text-ink hover:bg-sunken">
        <Ban className="size-4 text-stop" />
        <span className="flex-1">{t('Rupture depuis la commande', 'Out of stock from this order')}</span>
        {open ? <ChevronUp className="size-4 text-ink-3" /> : <ChevronDown className="size-4 text-ink-3" />}
      </button>
      {open && (
        <div className="border-t border-line">
          {err && <p className="px-4 py-3 text-[13px] text-stop">{err}</p>}
          {!refs && !err && <div className="m-4 h-12 animate-pulse rounded-md bg-sunken" />}
          {refs && (
            <ul className="divide-y divide-line">
              {refs.lines.map((l) => (
                <li key={l.index} className="px-4 py-2">
                  <Row name={l.name} refValue={l.itemRef} onPick={(ref) => setTarget({ ref, name: l.name, kind: 'item' })} t={t} />
                  {l.modifierRefs.map((m, j) => (
                    <div key={j} className="pl-5"><Row name={`+ ${m.name}`} refValue={m.ref} onPick={(ref) => setTarget({ ref, name: m.name, kind: 'option' })} t={t} small /></div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {target && refs && (
        <Modal title={t(`Rupture : ${target.name}`, `Out of stock: ${target.name}`)} onClose={() => setTarget(null)}
          subtitle={t(`${target.kind === 'item' ? 'Article' : 'Option'} retiré sur toutes les plateformes de cette cuisine. Un gérant peut devoir approuver.`, `${target.kind === 'item' ? 'Item' : 'Option'} removed on every platform at this kitchen. A manager may need to approve.`)}
          footer={<Button variant="ghost" size="lg" onClick={() => setTarget(null)}>{t('Retour', 'Back')}</Button>}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {([
              ['close', t('Jusqu’à la fermeture', 'Until closing')],
              ['four', t('4 h', '4 h')],
              ['today', t('Aujourd’hui', 'Today')],
              ['forever', t('Indéfiniment', 'Until I turn it back on')],
            ] as Array<[Choice, string]>).map(([c, label]) => {
              const m = quick86Minutes(c, refs.closesInMin);
              return (
                <Button key={c} variant={c === 'forever' ? 'outline' : 'danger'} size="lg" className="w-full" disabled={m === null || Boolean(busy)} loading={busy === c} onClick={() => send(c)}>
                  {label}{m && c !== 'four' ? <span className="num text-xs font-normal opacity-80">· {m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`}</span> : null}
                </Button>
              );
            })}
          </div>
          {refs.closesInMin === null && <p className="mt-3 text-xs text-ink-3">{t('Heures de fermeture inconnues ou déjà fermé : « Jusqu’à la fermeture » est désactivé.', 'Closing time unknown or already closed: “Until closing” is off.')}</p>}
        </Modal>
      )}
    </div>
  );
}

function Row({ name, refValue, onPick, t, small }: { name: string; refValue?: string; onPick: (ref: string) => void; t: T; small?: boolean }) {
  return (
    <div className="flex min-h-12 items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className={cn('truncate', small ? 'text-[13px] text-ink-2' : 'font-semibold text-ink')}>{name}</div>
        {!refValue && (
          <div className="text-[11px] text-ink-3">
            {t('Introuvable dans le menu : utilisez Ruptures (86)', 'Not found in the menu: use Out of stock (86)')} · <Link href="/menu/86" className="font-semibold underline underline-offset-2">{t('Ouvrir', 'Open')}</Link>
          </div>
        )}
      </div>
      <Button size="lg" variant="soft" className="min-w-28 text-stop" disabled={!refValue} onClick={() => refValue && onPick(refValue)} icon={<Ban className="size-4" />}>{t('Rupture', '86')}</Button>
    </div>
  );
}
