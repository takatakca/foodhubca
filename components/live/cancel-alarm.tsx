'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Check } from 'lucide-react';
import { PlatformMark, platformOf } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNow } from '@/components/ui/timer';
import { usePulse } from '@/components/live/pulse';
import { useOrderActions } from '@/components/live/order-drawer';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { ago, money } from '@/lib/ui/api';
import { loopSound, unlockAudio } from '@/lib/ui/sound';
import { useI18n } from '@/lib/i18n/client';

/**
 * "BOOM — cancelled": when the customer or the platform cancels an order, every kitchen screen turns red
 * and beeps until someone taps "Got it — stop cooking". One tap clears it on every screen and is logged.
 */
export function CancelAlarm() {
  const { pulse } = usePulse();
  const { can, locName } = useViewer();
  const { t, lang, loc } = useI18n();
  const { run, busy } = useOrderActions();
  const [gone, setGone] = useState<Record<string, true>>({});
  const stop = useRef<null | (() => void)>(null);
  useNow(30_000);

  const list = useMemo(() => (pulse?.cancelAlerts ?? []).filter((c) => !gone[c.id]), [pulse, gone]);
  const c = list[0];
  const enabled = can('orders:act');

  useEffect(() => {
    if (!enabled || !c) { stop.current?.(); stop.current = null; return; }
    if (!stop.current) stop.current = loopSound('cancel', 3000);
    return undefined;
  }, [enabled, c]);
  useEffect(() => () => { stop.current?.(); }, []);

  if (!enabled || !c) return null;
  const who = c.cancelledBy === 'customer' ? t('par le client', 'by the customer') : t('par la plateforme', 'by the platform');
  async function seen() {
    unlockAudio();
    setGone((g) => ({ ...g, [c.id]: true }));
    await run(c.id, 'ack');
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-stop/85 p-4 backdrop-blur-sm animate-fade" onPointerDown={() => unlockAudio()} role="alertdialog" aria-modal="true">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-pop animate-rise">
        <div className="flex items-center gap-4 bg-stop px-6 py-5 text-white">
          <div className="grid size-14 shrink-0 place-items-center rounded-full bg-white/15"><Ban className="size-8" /></div>
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-[0.16em] uppercase opacity-90">{t('Commande annulée', 'Order cancelled')} {who}</div>
            <div className="text-3xl font-black">#{c.displayId}</div>
          </div>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <PlatformMark channel={c.channel} size="md" />
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-ink">{c.brandName ?? platformOf(c.channel).label}</div>
              <div className="text-sm text-ink-3">{c.locationCode ? shortLoc(locName(c.locationCode)) : ''} · {c.items} {t('article(s)', 'item(s)')} · {money(c.total, loc)} · {ago(c.cancelledAt, lang)}</div>
            </div>
          </div>
          <div className="rounded-lg border-2 border-stop/30 bg-stop/5 px-4 py-3 text-[15px] font-bold text-stop">
            {c.wasCooking ? t('ARRÊTEZ de la préparer. Ne la donnez à aucun livreur.', 'STOP preparing it. Do not hand it to any courier.') : t('Ne la préparez pas.', 'Do not prepare it.')}
          </div>
          {c.reason && <div className="text-sm text-ink-2"><span className="font-semibold text-ink">{t('Raison :', 'Reason:')}</span> {reasonText(t, c.reason)}</div>}
          {c.posOrderId && <div className="text-xs text-ink-3">{c.posClosed ? t('Retirée de la caisse Clover.', 'Removed from the Clover register.') : t('Vérifiez qu’elle est retirée de Clover.', 'Check it is removed from Clover.')}</div>}
          {list.length > 1 && <div className="text-xs font-semibold text-ink-3">{t(`+ ${list.length - 1} autre(s) annulation(s)`, `+ ${list.length - 1} more cancellation(s)`)}</div>}
        </div>
        <div className="border-t border-line px-6 py-4">
          <Button size="xl" variant="danger" className="w-full" loading={busy === 'ack'} onClick={seen} icon={<Check className="size-6" />}>{t('Compris — j’arrête', 'Got it — stopping')}</Button>
        </div>
      </div>
    </div>
  );
}

const REASONS: Record<string, [string, string]> = {
  customer_cancelled: ['le client a annulé', 'the customer cancelled'], customer_request: ['demande du client', 'customer request'],
  courier_unavailable: ['aucun livreur disponible', 'no courier available'], restaurant_closed: ['restaurant fermé', 'restaurant closed'],
  timeout: ['pas acceptée à temps', 'not accepted in time'], fraud: ['fraude suspectée par la plateforme', 'suspected fraud'], out_of_stock: ['rupture de stock', 'out of stock'],
};
/** Platform reason codes in plain words ("customer_cancelled" → "le client a annulé"). */
function reasonText(t: (fr: string, en: string) => string, r: string) {
  const k = r.trim().toLowerCase();
  const x = REASONS[k];
  return x ? t(x[0], x[1]) : /^[a-z0-9_]+$/.test(k) ? k.replace(/_/g, ' ') : r;
}
