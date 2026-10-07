'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Banknote, ChefHat, KeyRound, MessageSquareText, Store, Truck, UtensilsCrossed, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { DraftRestoredBanner, SaveChip } from '@/components/ui/save-chip';
import { Hint } from '@/components/help/hint';
import { useViewer } from '@/components/shell/viewer';
import { SettingsHead } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useAutosave } from '@/lib/ui/use-autosave';
import { useUndo } from '@/lib/ui/use-undo';
import { useI18n } from '@/lib/i18n/client';

type Rule = 'off' | 'manager' | 'always';
type Policy = Record<string, Rule>;
type Actions = Record<string, { fr: string; en: string; def: Rule }>;
const GROUPS: Array<{ fr: string; en: string; icon: typeof ChefHat; keys: string[] }> = [
  { fr: 'Commandes', en: 'Orders', icon: ChefHat, keys: ['order.reject', 'order.cancel', 'order.adjust', 'order.delay', 'order.reprint'] },
  { fr: 'Clients', en: 'Customers', icon: MessageSquareText, keys: ['customer.contact'] },
  { fr: 'Nos livraisons', en: 'Own delivery', icon: Truck, keys: ['delivery.dispatch', 'delivery.cancel'] },
  { fr: 'Magasins', en: 'Stores', icon: Store, keys: ['store.pause', 'store.busy'] },
  { fr: 'Menus', en: 'Menus', icon: UtensilsCrossed, keys: ['item.86', 'menu.price', 'menu.publish'] },
  { fr: 'Argent et équipe', en: 'Money & team', icon: Banknote, keys: ['money.edit', 'team.manage'] },
];
const RULES: Rule[] = ['off', 'manager', 'always'];
/** Strict preset: staff need a manager for anything that costs money; money and team always need a PIN. */
const STRICT: Policy = {
  'order.reject': 'manager', 'order.cancel': 'manager', 'order.adjust': 'manager', 'customer.contact': 'manager', 'delivery.cancel': 'manager', 'store.pause': 'manager', 'menu.price': 'manager',
  'money.edit': 'always', 'team.manage': 'always',
};

export default function SecurityPage() {
  const { t, lang } = useI18n();
  const { viewer, can } = useViewer();
  const toast = useToast();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [actions, setActions] = useState<Actions>({});
  // What the server has for "Manage team": on "Always PIN", every save of these rules asks for a PIN (approvalGate).
  const [savedTeamRule, setSavedTeamRule] = useState<Rule>('off');
  const [err, setErr] = useState('');
  const edit = can('admin');
  const pinGated = edit && !viewer.builtin && savedTeamRule === 'always';

  // The rules are one document that saves by itself (no Save button, nothing lost). When saving asks for a PIN,
  // wait longer after the last tap so several changes go out together with one PIN.
  const validate = useCallback((p: Policy) => (Object.values(p).every((r) => RULES.includes(r)) ? [] : [t('Choisissez une règle pour chaque action', 'Pick a rule for every action')]), [t]);
  const autosave = useAutosave<Policy>({
    formKey: 'security', user: viewer.username, value: policy, enabled: edit, validate,
    debounceMs: pinGated ? 4000 : undefined, maxWaitMs: pinGated ? 20000 : undefined,
    save: async (p) => {
      const r = await api<{ policy: Policy }>('/api/foodhub/security', { method: 'PUT', json: { policy: p } });
      setSavedTeamRule(r.policy['team.manage'] ?? 'off');
      return r.policy;
    },
    onSaved: (p) => setPolicy(p),
    onRestore: (draft) => setPolicy(draft),
  });
  const undo = useUndo<Policy>(policy, (p) => setPolicy(p), { enabled: edit });
  const { markLoaded } = autosave;
  const resetUndo = undo.reset;

  const load = useCallback(() => api<{ policy: Policy; actions: Actions }>('/api/foodhub/security').then((d) => {
    setActions(d.actions); setPolicy(d.policy); setSavedTeamRule(d.policy['team.manage'] ?? 'off'); markLoaded(d.policy); resetUndo();
  }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), [markLoaded, resetUndo]);
  useEffect(() => { load(); }, [load]);

  /** Applied at once (autosave sends it), with 6 s to take it back — only the rules the preset changed. */
  function strict() {
    if (!policy) return;
    const changed = Object.keys(STRICT).filter((k) => k in policy && policy[k] !== STRICT[k]);
    if (!changed.length) { toast.info(t('Le préréglage strict est déjà en place', 'The strict preset is already in place')); return; }
    const before: Policy = Object.fromEntries(changed.map((k) => [k, policy[k]]));
    setPolicy({ ...policy, ...Object.fromEntries(changed.map((k) => [k, STRICT[k]])) });
    const n = changed.length;
    toast.undo(t(`Préréglage strict : ${n} règle${n > 1 ? 's' : ''} changée${n > 1 ? 's' : ''}`, `Strict preset: ${n} rule${n > 1 ? 's' : ''} changed`), () => setPolicy((p) => {
      if (!p) return p;
      const back = { ...p };
      for (const k of changed) if (back[k] === STRICT[k]) back[k] = before[k];
      return back;
    }));
  }

  const options = [
    { key: 'off' as Rule, label: t('Libre', 'Open') },
    { key: 'manager' as Rule, label: t('NIP gérant', 'Manager PIN') },
    { key: 'always' as Rule, label: t('Toujours un NIP', 'Always PIN') },
  ];

  return (
    <div className="pb-20">
      <SettingsHead title={t('NIP gérant', 'Manager PIN')} intro={t('Pour que les employés ne puissent pas toucher à l’argent seuls : quand une action est protégée, l’écran demande le NIP d’un gérant (ou le vôtre), et le journal garde qui a approuvé quoi. « NIP gérant » = les employés ont besoin d’un gérant, les gérants passent directement. « Toujours un NIP » = même les gérants confirment avec leur propre NIP.', 'So staff can never touch the money alone: when an action is protected, the screen asks for a manager’s PIN (or yours), and the log keeps who approved what. “Manager PIN” = staff need a manager, managers go straight through. “Always PIN” = even managers confirm with their own PIN.')}
        right={edit ? <><SaveChip autosave={autosave} undo={undo} /><Hint id="security.strict"><Button variant="outline" disabled={!policy} onClick={strict}>{t('Préréglage strict', 'Strict preset')}</Button></Hint></> : undefined} />
      <div className="max-w-4xl">
      {autosave.draftRestored && <DraftRestoredBanner onDiscard={autosave.discardDraft} />}
      {autosave.status === 'error' && autosave.error && <Banner tone="stop" className="mb-4">{autosave.error}</Banner>}
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {!edit && <Banner tone="info" className="mb-4">{t('Seul le propriétaire change ces règles.', 'Only the owner changes these rules.')}</Banner>}
      {pinGated && <Banner tone="info" className="mb-4">{t('« Gérer l’équipe et les appareils » est sur « Toujours un NIP » : un NIP est demandé quelques secondes après votre dernier changement. Annulé ? Touchez « NIP annulé — Enregistrer » quand vous êtes prêt.', '“Manage team and devices” is on “Always PIN”: a PIN is asked a few seconds after your last change. Cancelled? Tap “PIN cancelled — Save” when you are ready.')}</Banner>}
      {edit && policy && !viewer.builtin && !viewer.hasPin && Object.values(policy).includes('always') && (
        <Banner tone="warn" className="mb-4">{t('Vous n’avez pas encore de NIP : les actions « Toujours un NIP » demanderont celui d’un gérant. Créez le vôtre dans', 'You don’t have a PIN yet: “Always PIN” actions will ask for a manager’s. Create yours in')} <Link href="/settings/profile" className="font-bold underline">{t('Mon profil', 'My profile')}</Link>.</Banner>
      )}
      {!policy ? <div className="h-96 animate-pulse rounded-lg bg-sunken" /> : (
        <div className="space-y-4">
          {GROUPS.map((g) => {
            const Icon = g.icon;
            return (
              <Card key={g.en}>
                <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-sm font-extrabold"><Icon className="size-4 text-ink-3" />{t(g.fr, g.en)}</div>
                <ul className="divide-y divide-line">
                  {g.keys.filter((k) => actions[k]).map((k) => {
                    const seg = <Segmented size="sm" value={policy[k]} onChange={(v) => setPolicy((p) => (p ? { ...p, [k]: v } : p))} options={options} />;
                    return (
                      <li key={k} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-ink">{lang === 'fr' ? actions[k].fr : actions[k].en}</div>
                          <div className="mt-0.5 text-xs text-ink-3">{policy[k] === 'off' ? t('Tout le monde avec le bon rôle.', 'Anyone with the right role.') : policy[k] === 'manager' ? t('Un employé doit faire entrer le NIP d’un gérant.', 'Staff must get a manager to enter their PIN.') : t('Toujours confirmé par un NIP de gérant ou du propriétaire.', 'Always confirmed with a manager or owner PIN.')}{policy[k] !== actions[k].def ? ` · ${t('défaut :', 'default:')} ${options.find((o) => o.key === actions[k].def)?.label}` : ''}</div>
                        </div>
                        {!edit ? <span className="text-[13px] font-semibold">{options.find((o) => o.key === policy[k])?.label}</span>
                          : k === 'team.manage' ? <Hint id="security.team">{seg}</Hint> : <Hint id="security.rule">{seg}</Hint>}
                      </li>
                    );
                  })}
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
      </div>
    </div>
  );
}
