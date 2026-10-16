'use client';

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, RefreshCw } from 'lucide-react';
import { Badge, PlatformMark, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { Input, Select, Switch } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { Section } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

type Status = { active: boolean; integration: boolean; env: string | null; providerSandbox: boolean; storeIds: string[]; warnings: string[] };
type Event = { at: string; text: string; ok?: boolean };
type TestOrder = { id: string; clientOrderId: string; displayId?: string; storeId: string; reason: string; status: 'received' | 'confirmed' | 'failed' | 'ready' | 'cancelled'; courier?: string; receivedAt: string; events: Event[];
  order?: { subtotal: number; tax: number; customerName?: string; lines: Array<{ name: string; quantity: number }> } };
type LogEntry = { at: string; kind: string; text: string; ok?: boolean; storeId?: string | null };
type Data = { status: Status; config: { brandName?: string; locationCode?: string; autoConfirm: boolean }; orders: TestOrder[]; log: LogEntry[]; paused: Record<string, boolean>; brands: string[]; locations: Array<{ code: string; name: string }> };

const STATUS_TONE: Record<TestOrder['status'], Tone> = { received: 'wait', confirmed: 'info', failed: 'stop', ready: 'go', cancelled: 'neutral' };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Settings → Platforms → DoorDash sandbox tests: the TEST orders DoorDash's sandbox sends, kept apart from real orders
 * (never in Clover, never printed, no kitchen ring, no alert, not in reports), and the DoorDash-facing certification steps.
 */
export function DoorDashSandboxTests() {
  const { t } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ tone: 'go' | 'stop'; text: string } | null>(null);
  const [itemRef, setItemRef] = useState('');
  const load = useCallback(() => api<Data>('/api/foodhub/doordash/sandbox').then(setData).catch((e) => setMsg({ tone: 'stop', text: e instanceof Error ? e.message : String(e) })), []);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setMsg(null);
    try {
      const r = await api<{ message?: string }>('/api/foodhub/doordash/sandbox', { method: 'POST', json: body });
      if (r.message) setMsg({ tone: 'go', text: r.message });
    } catch (e) { setMsg({ tone: 'stop', text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(''); await load(); }
  };

  if (!data) return null;
  const s = data.status;
  // Nothing to show while the mode is off and no test was ever received.
  if (!s.active && !data.orders.length && !data.log.length) return null;
  const store = s.storeIds[0] ?? '';

  return (
    <Section icon={<FlaskConical className="size-5" />} title={t('Essais DoorDash (bac à sable)', 'DoorDash sandbox tests')}
      subtitle={t('Les commandes d’essai du bac à sable DoorDash : jamais envoyées à Clover, jamais imprimées, aucune sonnerie en cuisine, aucune alerte, rien dans l’argent ni les rapports. Les étapes de certification DoorDash (confirmer, refuser, prête, annuler, menu, ruptures, pause) passent par les mêmes appels que pour une vraie commande, seulement vers le magasin d’essai.',
        'TEST orders from DoorDash’s sandbox: never sent to Clover, never printed, no kitchen ring, no alert, nothing in money or reports. DoorDash certification steps (confirm, reject, ready, cancel, menu, 86s, pause) use the same calls as a real order, aimed only at the test store.')}
      right={<Button size="sm" variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => void load()}>{t('Actualiser', 'Refresh')}</Button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <PlatformMark channel="doordash" size="sm" />
          <Badge tone={s.active ? 'violet' : 'neutral'}>{s.active ? t('Mode bac à sable ACTIF', 'Sandbox mode ON') : t('Mode bac à sable inactif', 'Sandbox mode off')}</Badge>
          {s.integration && <Badge tone="wait">{t('Toutes les commandes DoorDash directes = ESSAIS', 'Every direct DoorDash order = TEST')}</Badge>}
          <span className="text-ink-3">{t('Magasin(s) d’essai :', 'Test store(s):')} {s.storeIds.length ? s.storeIds.map((id) => <code key={id} className="mr-1 rounded bg-sunken px-1 font-mono text-xs">{id}{data.paused[id] ? ' (pause)' : ''}</code>) : '—'}</span>
        </div>
        {s.warnings.map((w) => <Banner key={w} tone="warn">{w}</Banner>)}
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

        <Card className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <label className="text-xs font-semibold text-ink-3">{t('Menu du magasin d’essai (marque)', 'Test store menu (brand)')}
            <Select className="mt-1" value={data.config.brandName ?? ''} onChange={(e) => void run('cfg', { action: 'config', brandName: e.target.value })}>
              <option value="">—</option>
              {data.brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </Select>
          </label>
          <label className="text-xs font-semibold text-ink-3">{t('Succursale (prix, heures, ruptures)', 'Location (prices, hours, 86s)')}
            <Select className="mt-1" value={data.config.locationCode ?? ''} onChange={(e) => void run('cfg', { action: 'config', locationCode: e.target.value })}>
              <option value="">—</option>
              {data.locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </Select>
          </label>
          <div className="pt-4"><Switch checked={data.config.autoConfirm} onChange={(v) => void run('cfg', { action: 'config', autoConfirm: v })} label={t('Confirmer automatiquement à l’arrivée', 'Confirm automatically on arrival')} /></div>
        </Card>

        {store && (
          <Card className="flex flex-wrap items-end gap-2 p-4">
            <Button size="sm" variant="outline" loading={busy === 'menu'} onClick={() => void run('menu', { action: 'push_menu', storeId: store })}>{t('Envoyer le menu au magasin d’essai', 'Send the menu to the test store')}</Button>
            <Button size="sm" variant="outline" loading={busy === 'store'} onClick={() => void run('store', { action: 'store', storeId: store, online: Boolean(data.paused[store]) })}>
              {data.paused[store] ? t('Rouvrir le magasin d’essai', 'Reopen the test store') : t('Mettre le magasin d’essai en pause', 'Pause the test store')}
            </Button>
            <div className="flex items-end gap-2">
              <Input inputSize="sm" className="w-44" placeholder={t('id article (merchant_supplied_id)', 'item id (merchant_supplied_id)')} value={itemRef} onChange={(e) => setItemRef(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!itemRef.trim()} loading={busy === 'off'} onClick={() => void run('off', { action: 'item', storeId: store, ref: itemRef, available: false })}>{t('Rupture', '86 it')}</Button>
              <Button size="sm" variant="outline" disabled={!itemRef.trim()} loading={busy === 'on'} onClick={() => void run('on', { action: 'item', storeId: store, ref: itemRef, available: true })}>{t('Remettre', 'Back on')}</Button>
            </div>
          </Card>
        )}

        <Table>
          <thead><tr><Th>{t('Essai', 'Test')}</Th><Th>{t('Reçue', 'Received')}</Th><Th>{t('Contenu', 'Content')}</Th><Th>{t('État', 'Status')}</Th><Th>{t('Étapes DoorDash', 'DoorDash steps')}</Th></tr></thead>
          <tbody>
            {data.orders.length === 0 && <Tr><Td colSpan={5} className="text-ink-3">{t('Aucune commande d’essai reçue.', 'No test order received yet.')}</Td></Tr>}
            {data.orders.map((o) => (
              <Tr key={o.id}>
                <Td><Badge tone="violet">TEST</Badge> <span className="font-mono text-xs">#{o.displayId || o.id.slice(0, 8)}</span><div className="text-[11px] text-ink-3">{o.storeId}</div></Td>
                <Td className="text-xs">{time(o.receivedAt)}</Td>
                <Td className="text-xs">{o.order ? `${o.order.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')} · ${(o.order.subtotal + o.order.tax).toFixed(2)} $` : '—'}
                  <details className="mt-1"><summary className="cursor-pointer text-ink-3">{t('Historique', 'History')} ({o.events.length})</summary>
                    <ul className="mt-1 space-y-0.5">{o.events.map((e, i) => <li key={i} className={e.ok === false ? 'text-stop-2' : 'text-ink-2'}>{time(e.at)} · {e.text}</li>)}</ul>
                  </details>
                </Td>
                <Td><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge>{o.courier && <div className="text-[11px] text-ink-3">Dasher: {o.courier}</div>}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {o.status === 'received' && <Button size="xs" variant="go" loading={busy === `c${o.id}`} onClick={() => void run(`c${o.id}`, { action: 'confirm', orderId: o.id })}>{t('Confirmer', 'Confirm')}</Button>}
                    {o.status === 'received' && <Button size="xs" variant="outline" loading={busy === `r${o.id}`} onClick={() => void run(`r${o.id}`, { action: 'reject', orderId: o.id, reasonCode: 'out_of_stock' })}>{t('Refuser (rupture)', 'Reject (out of stock)')}</Button>}
                    {o.status === 'confirmed' && <Button size="xs" variant="go" loading={busy === `p${o.id}`} onClick={() => void run(`p${o.id}`, { action: 'ready', orderId: o.id })}>{t('Prête', 'Ready')}</Button>}
                    {(o.status === 'confirmed' || o.status === 'ready') && <Button size="xs" variant="outline" loading={busy === `x${o.id}`} onClick={() => void run(`x${o.id}`, { action: 'cancel', orderId: o.id, reasonCode: 'too_busy' })}>{t('Annuler', 'Cancel')}</Button>}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>

        {data.log.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-ink-2">{t('Journal des essais', 'Test log')} ({data.log.length})</summary>
            <ul className="mt-2 space-y-1 text-xs">{data.log.map((l, i) => <li key={i} className={l.ok === false ? 'text-stop-2' : 'text-ink-2'}>{time(l.at)} · <span className="font-mono">{l.kind}</span> · {l.text}</li>)}</ul>
            <Button size="xs" variant="ghost" className="mt-2" loading={busy === 'clear'} onClick={() => { if (window.confirm(t('Vider la liste des essais DoorDash ?', 'Empty the DoorDash test list?'))) void run('clear', { action: 'clear' }); }}>{t('Vider la liste des essais', 'Empty the test list')}</Button>
          </details>
        )}
      </div>
    </Section>
  );
}
