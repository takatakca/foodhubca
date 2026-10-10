'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bike, Check, MapPin, Phone, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/form';
import type { CourierBoard, CourierStop } from '@/lib/foodhub/delivery/courier-app';
import { useI18n } from '@/lib/i18n/client';

const STORE = 'takatak.courier.t';

function readToken(): string | null {
  // The link is …/courier#t=<token>: keep it on this phone, then take it out of the address bar.
  try {
    const m = window.location.hash.match(/[#&]t=([^&]+)/);
    if (m) {
      localStorage.setItem(STORE, m[1]);
      window.history.replaceState(null, '', window.location.pathname);
      return m[1];
    }
    return localStorage.getItem(STORE);
  } catch {
    const m = window.location.hash.match(/[#&]t=([^&]+)/);
    return m ? m[1] : null;
  }
}

const maps = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

export function CourierView() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [board, setBoard] = useState<CourierBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const call = useCallback(async (tok: string, body?: Record<string, unknown>) => {
    const res = await fetch('/api/courier', {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (data.board) setBoard(data.board);
    if (!res.ok) setError(data.error || data.message || `HTTP ${res.status}`);
    else setError(null);
    return data;
  }, []);

  useEffect(() => {
    const tok = readToken();
    setToken(tok);
    if (!tok) return;
    call(tok);
    const i = setInterval(() => call(tok), 20_000);
    return () => clearInterval(i);
  }, [call]);

  async function act(stop: CourierStop, action: string, note?: string) {
    if (!token) return;
    setBusy(`${stop.deliveryId}:${action}`);
    try { await call(token, { action, deliveryId: stop.deliveryId, note }); } finally { setBusy(null); }
  }

  if (!token) {
    return <Shell><p className="text-center text-ink-3">{t('Ouvrez le lien personnel envoyé par la cuisine.', 'Open the personal link the kitchen sent you.')}</p></Shell>;
  }
  return (
    <Shell>
      {error && <div className="mb-3 rounded-md bg-stop-soft px-3 py-2 text-sm font-semibold text-stop-2">{error}</div>}
      {board && (
        <>
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-extrabold">{t('Bonjour', 'Hello')} {board.courier.name}</div>
              <div className="text-xs text-ink-3">{board.courier.locations.join(' · ')}</div>
            </div>
            <Switch checked={board.courier.onShift} disabled={busy !== null} onChange={(v) => { setBusy('shift'); void call(token, { action: 'shift', onShift: v }).finally(() => setBusy(null)); }} label={board.courier.onShift ? t('En service', 'On shift') : t('Hors service', 'Off shift')} />
          </div>
          {!board.stops.length && <div className="rounded-lg border border-dashed border-line-2 px-4 py-12 text-center text-ink-3">{board.courier.onShift ? t('Aucune course pour l’instant. Cette page se met à jour toute seule.', 'No delivery yet. This page updates by itself.') : t('Vous êtes hors service : aucune course ne vous sera envoyée.', 'You are off shift: no delivery will be sent to you.')}</div>}
          <div className="space-y-3">
            {board.stops.map((s) => <Stop key={s.deliveryId} s={s} busy={busy} act={act} />)}
          </div>
          <button type="button" onClick={() => call(token)} className="mx-auto mt-6 flex items-center gap-1.5 text-sm font-semibold text-ink-3"><RefreshCw className="size-4" />{t('Actualiser', 'Refresh')}</button>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-lg bg-canvas px-4 py-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-extrabold tracking-[0.14em]"><Bike className="size-5 text-brand" />TAKATAK</div>
      {children}
    </main>
  );
}

function Stop({ s, busy, act }: { s: CourierStop; busy: string | null; act: (s: CourierStop, action: string, note?: string) => Promise<void> }) {
  const { t } = useI18n();
  const is = (a: string) => busy === `${s.deliveryId}:${a}`;
  const label: Record<string, [string, string]> = {
    created: ['Assignée', 'Assigned'], assigned: ['Assignée', 'Assigned'], at_pickup: ['À la cuisine', 'At the kitchen'], picked_up: ['En route', 'On the way'], at_dropoff: ['Chez le client', 'At the customer'],
  };
  const [fr, en] = label[s.status] ?? [s.status, s.status];
  const beforePickup = s.status === 'created' || s.status === 'assigned' || s.status === 'at_pickup';
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-extrabold">{s.number}</span><span className="text-sm text-ink-3">{s.brand}</span>
        <Badge tone="info" className="ml-auto">{t(fr, en)}</Badge>
      </div>
      <div className="mt-3 space-y-3 text-[15px]">
        <div>
          <div className="text-xs font-bold tracking-wide text-ink-3 uppercase">{t('Ramassage', 'Pickup')}</div>
          <div className="font-semibold">{s.pickup.name}</div>
          <a className="flex items-center gap-1 text-brand underline-offset-4 hover:underline" href={maps(s.pickup.address)} target="_blank" rel="noreferrer"><MapPin className="size-4" />{s.pickup.address}</a>
          {s.pickup.phone && <a className="mt-0.5 flex items-center gap-1 text-sm text-ink-2" href={`tel:${s.pickup.phone}`}><Phone className="size-3.5" />{t('Appeler la cuisine', 'Call the kitchen')}</a>}
        </div>
        <div>
          <div className="text-xs font-bold tracking-wide text-ink-3 uppercase">{t('Livraison', 'Drop-off')}</div>
          <div className="font-semibold">{s.dropoff.name}</div>
          <a className="flex items-center gap-1 text-brand underline-offset-4 hover:underline" href={maps(s.dropoff.address)} target="_blank" rel="noreferrer"><MapPin className="size-4" />{s.dropoff.address}{s.dropoff.unit ? ` #${s.dropoff.unit}` : ''}</a>
          {s.dropoff.instructions && <div className="mt-0.5 text-sm text-ink-2">« {s.dropoff.instructions} »</div>}
          {s.dropoff.phone && <a className="mt-0.5 flex items-center gap-1 text-sm text-ink-2" href={`tel:${s.dropoff.phone}`}><Phone className="size-3.5" />{t('Appeler le client', 'Call the customer')}</a>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="neutral">{s.items} {t('article(s)', 'item(s)')}</Badge>
          {s.tip > 0 && <Badge tone="go">{t('Pourboire', 'Tip')} {s.tip.toFixed(2)} $</Badge>}
          {s.containsAlcohol && <Badge tone="wait" icon={<TriangleAlert className="size-3" />}>{t('Alcool : pièce d’identité 18+', 'Alcohol: photo ID 18+')}</Badge>}
          {!s.paid && <Badge tone="stop">{t('Pas payée : n’encaissez rien, appelez la cuisine', 'Not paid: collect nothing, call the kitchen')}</Badge>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(s.status === 'created' || s.status === 'assigned') && <Button variant="primary" size="lg" className="col-span-2" loading={is('at_pickup')} onClick={() => act(s, 'at_pickup')}>{t('Arrivé à la cuisine', 'At the kitchen')}</Button>}
        {s.status === 'at_pickup' && <Button variant="primary" size="lg" className="col-span-2" loading={is('picked_up')} onClick={() => act(s, 'picked_up')}>{t('Commande ramassée', 'Picked up')}</Button>}
        {s.status === 'picked_up' && <Button variant="outline" size="lg" loading={is('at_dropoff')} onClick={() => act(s, 'at_dropoff')}>{t('Chez le client', 'At the customer')}</Button>}
        {(s.status === 'picked_up' || s.status === 'at_dropoff') && <Button variant="go" size="lg" className={s.status === 'at_dropoff' ? 'col-span-2' : ''} loading={is('delivered')} icon={<Check className="size-4" />} onClick={() => act(s, 'delivered')}>{t('Livrée', 'Delivered')}</Button>}
        <Button variant="outline" size="md" loading={is('problem')} icon={<TriangleAlert className="size-4" />} onClick={() => { const n = window.prompt(t('Quel est le problème ?', 'What is the problem?')); if (n) void act(s, 'problem', n); }}>{t('Problème', 'Problem')}</Button>
        {beforePickup && <Button variant="ghost" size="md" loading={is('decline')} icon={<X className="size-4" />} onClick={() => { if (window.confirm(t('Refuser cette course ? La cuisine enverra quelqu’un d’autre.', 'Decline this delivery? The kitchen will send someone else.'))) void act(s, 'decline'); }}>{t('Refuser', 'Decline')}</Button>}
      </div>
    </section>
  );
}
