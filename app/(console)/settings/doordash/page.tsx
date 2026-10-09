'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Skeleton } from '@/components/ui/card';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { Section, SettingsHead } from '../settings-ui';

type Param = { name: string; type: 'store' | 'order' | 'text' | 'number' | 'bool' | 'json' | 'date' | 'select'; label: string; required?: boolean; options?: string[]; placeholder?: string; default?: string };
type Action = { id: string; group: string; label: string; labelFr: string; help: string; write: boolean; params: Param[] };
type Area = { key: string; label: string; ready: boolean; missing: string[]; note: string };
type Pick = { id: string; label: string };
type Resp = { status: Area[]; stores: Pick[]; orders: Pick[]; actions: Action[] };

/** Settings → DoorDash: every DoorDash API Food Hub can call, one card each. Reads change nothing; writes say so. */
export default function DoorDashApiPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<Resp>('/api/foodhub/doordash').then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e))); }, []);
  const groups = useMemo(() => {
    const m = new Map<string, Action[]>();
    for (const a of data?.actions ?? []) m.set(a.group, [...(m.get(a.group) ?? []), a]);
    return [...m.entries()];
  }, [data]);

  return (
    <div>
      <SettingsHead title="DoorDash" intro={t('Toutes les API DoorDash qu’un groupe de restaurants peut utiliser : lectures en direct, ruptures, heures, commandes, rapports, épicerie, Drive, publicité. Po Poulet NDG n’est jamais touché.', 'Every DoorDash API a restaurant group can use: live reads, 86s, hours, orders, reports, retail, Drive, ads. Po Poulet NDG is never touched.')} />
      {err && <Banner tone="stop">{err}</Banner>}
      {!data && !err && <Skeleton className="h-40" />}
      {data && (
        <>
          <Section title={t('État des branchements', 'Connection status')} subtitle={t('Ce qui est configuré et ce qui manque. Rien n’est envoyé à DoorDash sans ces clés.', 'What is configured and what is missing. Nothing is sent to DoorDash without these keys.')}>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {data.status.map((a) => (
                <div key={a.key} className="rounded-md border border-line p-3">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{a.label}</span><Badge tone={a.ready ? 'go' : 'wait'}>{a.ready ? t('Prêt', 'Ready') : t('À configurer', 'To set up')}</Badge></div>
                  <p className="mt-1 text-[13px] text-ink-3">{a.note}</p>
                  {a.missing.length > 0 && <p className="mt-1 font-mono text-xs text-wait-2">{a.missing.join(', ')}</p>}
                </div>
              ))}
            </div>
          </Section>
          {groups.map(([group, actions]) => (
            <Section key={group} title={group} subtitle={`${actions.length} ${t('outil(s)', 'tool(s)')}`}>
              <div className="space-y-4">
                {actions.map((a) => <ActionCard key={a.id} action={a} stores={data.stores} orders={data.orders} onError={(m) => toast.error(m)} />)}
              </div>
            </Section>
          ))}
        </>
      )}
    </div>
  );
}

function ActionCard({ action, stores, orders, onError }: { action: Action; stores: Pick[]; orders: Pick[]; onError: (m: string) => void }) {
  const { t, lang } = useI18n();
  const init = useCallback(() => Object.fromEntries(action.params.map((p) => [p.name, p.default ?? (p.type === 'bool' ? false : '')])), [action.params]);
  const [v, setV] = useState<Record<string, unknown>>(init);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; message: string; data?: unknown } | null>(null);
  async function run() {
    setBusy(true); setOut(null);
    try {
      const r = await api<{ message: string; data: unknown }>('/api/foodhub/doordash', { method: 'POST', json: { action: action.id, input: v } });
      setOut({ ok: true, message: r.message, data: r.data });
    } catch (e) {
      if (e instanceof ApiError && e.status === 499) return;
      const body = e instanceof ApiError ? e.body : {};
      setOut({ ok: false, message: e instanceof Error ? e.message : String(e), data: body.data });
      if (!(e instanceof ApiError && e.status === 409)) onError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }
  const set = (name: string, val: unknown) => setV((x) => ({ ...x, [name]: val }));
  return (
    <div className="rounded-md border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold text-ink">{lang === 'fr' ? action.labelFr : action.label} <Badge tone={action.write ? 'wait' : 'neutral'}>{action.write ? t('modifie', 'changes') : t('lecture', 'read-only')}</Badge></div>
        <Button size="sm" variant={action.write ? 'outline' : 'soft'} loading={busy} onClick={run} icon={<Play className="size-4" />}>{t('Lancer', 'Run')}</Button>
      </div>
      <p className="mt-1 text-[13px] text-ink-3">{action.help}</p>
      {action.params.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {action.params.map((p) => (
            <div key={p.name} className={p.type === 'json' ? 'md:col-span-2' : ''}>
              {p.type === 'bool' ? <Switch checked={v[p.name] === true} onChange={(x) => set(p.name, x)} label={p.label} size="sm" />
                : <Field label={`${p.label}${p.required ? ' *' : ''}`}>
                  {p.type === 'store' || p.type === 'order' ? (
                    <Select value={String(v[p.name] ?? '')} onChange={(e) => set(p.name, e.target.value)}>
                      <option value="">{t('Choisir…', 'Choose…')}</option>
                      {(p.type === 'store' ? stores : orders).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                  ) : p.type === 'select' ? (
                    <Select value={String(v[p.name] ?? '')} onChange={(e) => set(p.name, e.target.value)}>{(p.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                  ) : p.type === 'json' ? (
                    <Textarea className="font-mono text-xs" rows={4} placeholder={p.placeholder} value={String(v[p.name] ?? '')} onChange={(e) => set(p.name, e.target.value)} />
                  ) : (
                    <Input type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'} placeholder={p.placeholder} value={String(v[p.name] ?? '')} onChange={(e) => set(p.name, e.target.value)} />
                  )}
                </Field>}
            </div>
          ))}
        </div>
      )}
      {out && (
        <div className="mt-3">
          <Banner tone={out.ok ? 'go' : 'stop'}>{out.message}</Banner>
          {out.data != null && <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-sunken p-3 font-mono text-xs text-ink-2">{typeof out.data === 'string' ? out.data : JSON.stringify(out.data, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}
