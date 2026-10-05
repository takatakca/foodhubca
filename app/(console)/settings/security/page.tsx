'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, ChefHat, KeyRound, MessageSquareText, Save, Store, UtensilsCrossed, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { SettingsHead } from '../settings-ui';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

type Rule = 'off' | 'manager' | 'always';
type Actions = Record<string, { fr: string; en: string; def: Rule }>;
const GROUPS: Array<{ fr: string; en: string; icon: typeof ChefHat; keys: string[] }> = [
  { fr: 'Commandes', en: 'Orders', icon: ChefHat, keys: ['order.reject', 'order.cancel', 'order.adjust', 'order.delay', 'order.reprint'] },
  { fr: 'Clients', en: 'Customers', icon: MessageSquareText, keys: ['customer.contact'] },
  { fr: 'Magasins', en: 'Stores', icon: Store, keys: ['store.pause', 'store.busy'] },
  { fr: 'Menus', en: 'Menus', icon: UtensilsCrossed, keys: ['item.86', 'menu.price', 'menu.publish'] },
  { fr: 'Argent et équipe', en: 'Money & team', icon: Banknote, keys: ['money.edit', 'team.manage'] },
];

export default function SecurityPage() {
  const { t, lang } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const [policy, setPolicy] = useState<Record<string, Rule> | null>(null);
  const [saved, setSaved] = useState<Record<string, Rule> | null>(null);
  const [actions, setActions] = useState<Actions>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const edit = can('admin');

  const load = useCallback(() => api<{ policy: Record<string, Rule>; actions: Actions }>('/api/foodhub/security').then((d) => { setPolicy(d.policy); setSaved(d.policy); setActions(d.actions); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); }, [load]);
  const dirty = useMemo(() => policy && saved && Object.keys(policy).some((k) => policy[k] !== saved[k]), [policy, saved]);

  async function save() {
    setBusy(true);
    try { const r = await api<{ policy: Record<string, Rule> }>('/api/foodhub/security', { method: 'PUT', json: { policy } }); setPolicy(r.policy); setSaved(r.policy); toast.success(t('Règles enregistrées', 'Rules saved')); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  function strict() {
    if (!policy) return;
    const next = { ...policy };
    for (const k of ['order.reject', 'order.cancel', 'order.adjust', 'customer.contact', 'store.pause', 'menu.price']) next[k] = 'manager';
    for (const k of ['money.edit', 'team.manage']) next[k] = 'always';
    setPolicy(next);
  }

  const options = [
    { key: 'off' as Rule, label: t('Libre', 'Open') },
    { key: 'manager' as Rule, label: t('NIP gérant', 'Manager PIN') },
    { key: 'always' as Rule, label: t('Toujours un NIP', 'Always PIN') },
  ];

  return (
    <div className="pb-20">
      <SettingsHead title={t('NIP gérant', 'Manager PIN')} intro={t('Pour que les employés ne puissent pas toucher à l’argent seuls : quand une action est protégée, l’écran demande le NIP d’un gérant (ou le vôtre), et le journal garde qui a approuvé quoi. « NIP gérant » = les employés ont besoin d’un gérant, les gérants passent directement. « Toujours un NIP » = même les gérants confirment avec leur propre NIP.', 'So staff can never touch the money alone: when an action is protected, the screen asks for a manager’s PIN (or yours), and the log keeps who approved what. “Manager PIN” = staff need a manager, managers go straight through. “Always PIN” = even managers confirm with their own PIN.')}
        right={edit ? <><Button variant="outline" onClick={strict}>{t('Préréglage strict', 'Strict preset')}</Button><Button loading={busy} disabled={!dirty} onClick={save} icon={<Save className="size-4" />}>{t('Enregistrer', 'Save')}</Button></> : undefined} />
      <div className="max-w-4xl">
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {!edit && <Banner tone="info" className="mb-4">{t('Seul le propriétaire change ces règles.', 'Only the owner changes these rules.')}</Banner>}
      {!policy ? <div className="h-96 animate-pulse rounded-lg bg-sunken" /> : (
        <div className="space-y-4">
          {GROUPS.map((g) => {
            const Icon = g.icon;
            return (
              <Card key={g.en}>
                <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-sm font-extrabold"><Icon className="size-4 text-ink-3" />{t(g.fr, g.en)}</div>
                <ul className="divide-y divide-line">
                  {g.keys.filter((k) => actions[k]).map((k) => (
                    <li key={k} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink">{lang === 'fr' ? actions[k].fr : actions[k].en}</div>
                        <div className="mt-0.5 text-xs text-ink-3">{policy[k] === 'off' ? t('Tout le monde avec le bon rôle.', 'Anyone with the right role.') : policy[k] === 'manager' ? t('Un employé doit faire entrer le NIP d’un gérant.', 'Staff must get a manager to enter their PIN.') : t('Toujours confirmé par un NIP de gérant ou du propriétaire.', 'Always confirmed with a manager or owner PIN.')}{policy[k] !== actions[k].def ? ` · ${t('défaut :', 'default:')} ${options.find((o) => o.key === actions[k].def)?.label}` : ''}</div>
                      </div>
                      {edit ? <Segmented size="sm" value={policy[k]} onChange={(v) => setPolicy({ ...policy, [k]: v })} options={options} /> : <span className="text-[13px] font-semibold">{options.find((o) => o.key === policy[k])?.label}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
          <Card className="flex items-start gap-3 p-5">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-ink-3" />
            <div className="text-[13px] leading-relaxed text-ink-2">
              <p>{t('Après 5 mauvais NIP, l’écran se bloque 5 minutes. Les NIP sont chiffrés (scrypt) : personne, pas même vous, ne peut les relire.', 'After 5 wrong PINs the screen locks for 5 minutes. PINs are hashed (scrypt): nobody, not even you, can read them back.')}</p>
              <p className="mt-1">{t('Les gérants et les NIP se gèrent dans', 'Managers and PINs are managed in')} <Link href="/settings/team" className="inline-flex items-center gap-1 font-bold underline"><Users className="size-3.5" />{t('Équipe', 'Team')}</Link>.</p>
            </div>
          </Card>
        </div>
      )}
      {edit && dirty && (
        <div className="fixed inset-x-0 bottom-16 z-30 flex justify-center px-4 lg:bottom-6">
          <div className="flex items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-canvas shadow-pop">
            {t('Modifications non enregistrées', 'Unsaved changes')}
            <Button size="sm" variant="brand" loading={busy} onClick={save}>{t('Enregistrer', 'Save')}</Button>
            <button type="button" className="text-xs font-semibold text-canvas/70 hover:text-canvas" onClick={() => setPolicy(saved)}>{t('Annuler', 'Discard')}</button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
