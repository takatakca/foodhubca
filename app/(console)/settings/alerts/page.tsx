'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BellRing, Bot, Crown, Mail, MessageSquareText, Monitor, MoonStar, PhoneCall, Plus, Send, Volume2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { DraftRestoredBanner, FormDraftNote, SaveChip } from '@/components/ui/save-chip';
import { Hint } from '@/components/help/hint';
import { useViewer } from '@/components/shell/viewer';
import { readAlertSettings, writeAlertSettings, type AlertSettings } from '@/components/live/incoming';
import { Section, SettingsHead } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useAutosave } from '@/lib/ui/use-autosave';
import { useUndo } from '@/lib/ui/use-undo';
import { formDraftId, useFormDraft } from '@/lib/ui/use-form-draft';
import { playSound, setLoud, setVolume, unlockAudio } from '@/lib/ui/sound';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type RuleSetting = { enabled: boolean; escalate: boolean };
type Watch = {
  enabled: boolean; smsAfterMin: number; callAfterMin: number; ownerAfterMin: number; unacceptedAfterSec: number; unseenAfterSec: number; lateAfterMin: number; courierWaitMin: number; silenceAfterMin: number;
  quietFrom: string; quietTo: string; postToChat: boolean; aiExplain: boolean; autoTextLateCustomers: boolean; supportPhones: string[]; rules: Record<string, RuleSetting>; updatedAt?: string; updatedBy?: string;
};
/** The document this screen edits (it saves by itself): the rules, without who changed them and when. */
type Rules = Omit<Watch, 'updatedAt' | 'updatedBy'>;
type Channels = { email: boolean; sms: boolean; call: boolean; chat: boolean; ai: boolean };
type Kind = { kind: string; fr: string; en: string };
type NumKey = 'smsAfterMin' | 'callAfterMin' | 'ownerAfterMin' | 'unacceptedAfterSec' | 'unseenAfterSec' | 'lateAfterMin' | 'courierWaitMin' | 'silenceAfterMin';
type Range = [min: number, max: number, unit: string];

/** What each number may be (the limits this screen always had): inside them the server keeps the value exactly as typed. */
const RANGE: Record<NumKey, Range> = {
  smsAfterMin: [1, 120, 'min'], callAfterMin: [1, 120, 'min'], ownerAfterMin: [1, 120, 'min'],
  unacceptedAfterSec: [20, 600, 's'], unseenAfterSec: [30, 900, 's'], lateAfterMin: [1, 60, 'min'], courierWaitMin: [1, 30, 'min'], silenceAfterMin: [30, 1440, 'min'],
};
const MAX_PHONES = 5;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const rulesOf = (w: Watch): Rules => { const r: Watch = { ...w }; delete r.updatedAt; delete r.updatedBy; return r; };
/** Reads a phone number like the server does (a 10-digit number gets +1). */
function e164(raw: string): string | null {
  const s = raw.trim();
  const d = s.replace(/\D/g, '');
  if (s.startsWith('+') && d.length >= 8 && d.length <= 15) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}
const showPhone = (p: string) => p.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '+1 $1 $2-$3');

export default function AlertSettingsPage() {
  const { t, lang, loc } = useI18n();
  const { viewer, can } = useViewer();
  const toast = useToast();
  const edit = can('admin');
  const [w, setW] = useState<Rules | null>(null);
  const [changed, setChanged] = useState<{ at?: string; by?: string }>({});
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  // A number typed but not added yet is kept on this device (reload, crash) until "Add".
  const newPhone = useFormDraft(formDraftId('alert-phone'), viewer.username, '', { enabled: edit });
  const [phoneErr, setPhoneErr] = useState('');

  const validate = useCallback((r: Rules) => {
    const names: Record<NumKey, [string, string]> = { smsAfterMin: ['Texto', 'Text'], callAfterMin: ['Appel', 'Call'], ownerAfterMin: ['Propriétaire', 'Owner'], unacceptedAfterSec: ['Non acceptée', 'Not accepted'], unseenAfterSec: ['Pas vue', 'Not seen'], lateAfterMin: ['En retard', 'Late'], courierWaitMin: ['Livreur', 'Courier'], silenceAfterMin: ['Plateforme silencieuse', 'Platform quiet'] };
    const out: string[] = [];
    for (const k of Object.keys(RANGE) as NumKey[]) {
      const [min, max, unit] = RANGE[k];
      if (!Number.isInteger(r[k]) || r[k] < min || r[k] > max) out.push(t(`${names[k][0]} : entre ${min} et ${max} ${unit}`, `${names[k][1]}: ${min} to ${max} ${unit}`));
    }
    if (r.callAfterMin < r.smsAfterMin) out.push(t('L’appel ne peut pas venir avant le texto', 'The call cannot come before the text'));
    if (r.ownerAfterMin < r.callAfterMin) out.push(t('Le propriétaire ne peut pas passer avant l’appel', 'The owner cannot come before the call'));
    if (!HHMM.test(r.quietFrom) || !HHMM.test(r.quietTo)) out.push(t('Heures calmes : choisissez les deux heures', 'Quiet hours: pick both times'));
    if (r.supportPhones.length > MAX_PHONES) out.push(t(`${MAX_PHONES} numéros au maximum`, `${MAX_PHONES} numbers at most`));
    for (const p of r.supportPhones) if (!e164(p)) out.push(t(`Numéro à vérifier : ${p}`, `Check this number: ${p}`));
    return out;
  }, [t]);
  // The rules save by themselves (no Save button): kept on this screen at once, sent 1.2 s after the last change.
  const autosave = useAutosave<Rules>({
    formKey: 'alert-rules', user: viewer.username, value: w, enabled: edit, validate,
    save: async (r) => {
      const d = await api<{ settings: Watch }>('/api/foodhub/watch/settings', { method: 'PUT', json: { settings: r } });
      setChanged({ at: d.settings.updatedAt, by: d.settings.updatedBy });
      return rulesOf(d.settings);
    },
    onRestore: (r) => setW(r),
    onSaved: (r) => setW(r),
  });
  const undo = useUndo<Rules>(w, (r) => setW(r), { enabled: edit });
  const { markLoaded } = autosave;
  const resetUndo = undo.reset;

  const load = useCallback(() => api<{ settings: Watch; kinds: Kind[]; channels: Channels }>('/api/foodhub/watch/settings').then((d) => {
    const r = rulesOf(d.settings);
    setW(r); setChanged({ at: d.settings.updatedAt, by: d.settings.updatedBy }); setKinds(d.kinds); setChannels(d.channels); setErr('');
    markLoaded(r); resetUndo();
  }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), [markLoaded, resetUndo]);
  useEffect(() => { load(); }, [load]);

  const set = (p: Partial<Rules>) => setW((cur) => (cur ? { ...cur, ...p } : cur));
  const setNum = (k: NumKey, v: number) => setW((cur) => (cur ? { ...cur, [k]: v } : cur));
  const setRule = (k: string, p: Partial<RuleSetting>) => setW((cur) => (cur ? { ...cur, rules: { ...cur.rules, [k]: { ...cur.rules[k], ...p } } } : cur));

  /** Turning the whole watchtower off takes effect at once, with 6 s to take it back (no "are you sure?"). */
  function setWatching(on: boolean) {
    set({ enabled: on });
    if (!on) toast.undo(t('Surveillance arrêtée : plus aucune alerte, ni texto, ni appel', 'Watchtower off: no more alerts, texts or calls'), () => set({ enabled: true }));
  }
  function addPhones() {
    if (!w) return;
    const typed = newPhone.value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (!typed.length) return;
    const bad = typed.find((p) => !e164(p));
    if (bad) { setPhoneErr(t(`Numéro à vérifier : ${bad}`, `Check this number: ${bad}`)); return; }
    const fresh = [...new Set(typed.map((p) => e164(p) as string))].filter((p) => !w.supportPhones.includes(p));
    if (!fresh.length) { setPhoneErr(t('Déjà dans la liste', 'Already in the list')); return; }
    const next = [...w.supportPhones, ...fresh];
    if (next.length > MAX_PHONES) { setPhoneErr(t(`${MAX_PHONES} numéros au maximum`, `${MAX_PHONES} numbers at most`)); return; }
    set({ supportPhones: next }); newPhone.set(''); newPhone.clear(); setPhoneErr('');
  }
  /** Removal applied at once, with 6 s to take it back. */
  function removePhone(p: string) {
    const index = w?.supportPhones.indexOf(p) ?? -1;
    setW((cur) => (cur ? { ...cur, supportPhones: cur.supportPhones.filter((x) => x !== p) } : cur));
    toast.undo(t(`${showPhone(p)} retiré`, `${showPhone(p)} removed`), () => setW((cur) => (!cur || cur.supportPhones.includes(p) ? cur : { ...cur, supportPhones: [...cur.supportPhones.slice(0, Math.max(0, index)), p, ...cur.supportPhones.slice(Math.max(0, index))] })));
  }
  async function test(channel: 'sms' | 'call' | 'email' | 'chat') {
    setBusy(`test-${channel}`);
    try {
      const r = await api<{ result: { ok: boolean; message: string } }>('/api/foodhub/watch/test', { method: 'POST', json: { channel } });
      if (r.result.ok) toast.success(t('Test envoyé', 'Test sent'), r.result.message); else toast.warn(t('Pas envoyé', 'Not sent'), r.result.message);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }

  const chip = (ok: boolean | undefined, label: string, icon: ReactNode, hint: string) => (
    <div className={cn('flex items-center gap-2.5 rounded-md border px-3 py-2.5', ok ? 'border-go/30 bg-go/5' : 'border-line-2 bg-raised')}>
      <span className={ok ? 'text-go-2' : 'text-ink-4'}>{icon}</span>
      <div className="min-w-0"><div className="text-[13px] font-bold text-ink">{label}</div><div className="truncate text-[11px] text-ink-3">{ok ? t('Branché', 'Connected') : hint}</div></div>
    </div>
  );

  return (
    <div className="pb-20">
      <SettingsHead title={t('Alertes et surveillance', 'Alerts & watchtower')} intro={t('La surveillance tourne en arrière-plan toutes les 20 secondes : commandes qui attendent, tablettes éteintes, magasins hors ligne, Clover qui n’a rien reçu, retards, annulations, argent manquant. Elle sonne à l’écran, puis texte, puis appelle — jusqu’à ce que quelqu’un réponde.', 'The watchtower runs in the background every 20 seconds: waiting orders, tablets off, stores offline, Clover not receiving, late orders, cancellations, missing money. It rings on screen, then texts, then calls — until someone answers.')}
        right={edit && w ? <SaveChip autosave={autosave} undo={undo} /> : undefined} />
      <div className="max-w-5xl">
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {autosave.draftRestored && <DraftRestoredBanner onDiscard={autosave.discardDraft} />}
      {autosave.problems.length > 0 && <Banner tone="warn" className="mb-4">{autosave.problems.slice(0, 4).join(' · ')}</Banner>}
      {autosave.status === 'error' && autosave.error && <Banner tone="stop" className="mb-4">{autosave.error}</Banner>}
      {!edit && <Banner tone="info" className="mb-4">{t('Seul le propriétaire change ces règles. Vos propres alertes (texto, appel, heures calmes) sont dans', 'Only the owner changes these rules. Your own alerts (text, call, quiet hours) are in')} <Link href="/settings/profile" className="font-bold underline">{t('Mon profil', 'My profile')}</Link>.</Banner>}

      <ThisScreen />

      {!w ? <div className="h-96 animate-pulse rounded-lg bg-sunken" /> : (
        <>
          <Section icon={<Send className="size-5" />} title={t('Canaux d’envoi', 'Delivery channels')} subtitle={t('Les clés se mettent avec « npm run setup » ou dans l’hébergeur — jamais dans le clavardage.', 'Keys go in with “npm run setup” or in the hosting settings — never in chat.')}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {chip(channels?.sms, t('Textos', 'Texts'), <MessageSquareText className="size-5" />, 'TWILIO_*')}
              {chip(channels?.call, t('Appels', 'Calls'), <PhoneCall className="size-5" />, 'TWILIO_*')}
              {chip(channels?.email, t('Courriels', 'Email'), <Mail className="size-5" />, 'RESEND_API_KEY')}
              {chip(channels?.chat, t('Clavardage équipe', 'Team chat'), <BellRing className="size-5" />, 'ALERT_WEBHOOK_URL')}
              {chip(channels?.ai, 'Claude (IA)', <Bot className="size-5" />, 'ANTHROPIC_API_KEY')}
            </div>
            <Hint id="alerts.test"><div className="mt-3 flex flex-wrap gap-2">
              <Button size="md" variant="outline" loading={busy === 'test-sms'} onClick={() => test('sms')}>{t('Me texter un test', 'Text me a test')}</Button>
              <Button size="md" variant="outline" loading={busy === 'test-call'} onClick={() => test('call')}>{t('M’appeler', 'Call me')}</Button>
              <Button size="md" variant="outline" loading={busy === 'test-email'} onClick={() => test('email')}>{t('M’écrire', 'Email me')}</Button>
              <Button size="md" variant="outline" loading={busy === 'test-chat'} onClick={() => test('chat')}>{t('Tester le clavardage', 'Test chat')}</Button>
            </div></Hint>
          </Section>

          <Section icon={<PhoneCall className="size-5" />} title={t('Escalade', 'Escalation')} subtitle={t('Une alerte « vue » (bouton Je m’en occupe) arrête l’escalade. Les gérants de garde sont ceux de la succursale concernée, avec un cellulaire.', 'An acknowledged alert (I’m on it button) stops escalating. Managers on duty are those of the location concerned, with a cell number.')}
            right={<Hint id="alerts.watch"><Switch checked={w.enabled} disabled={!edit} onChange={setWatching} label={w.enabled ? t('Surveillance active', 'Watchtower on') : t('Surveillance arrêtée', 'Watchtower off')} /></Hint>}>
            <Hint id="alerts.steps"><ol className="grid grid-cols-1 gap-2 md:grid-cols-4">
              {([
                { icon: <Volume2 className="size-4" />, label: t('Écran + bip en cuisine', 'Screen + beep in the kitchen'), field: null },
                { icon: <MessageSquareText className="size-4" />, label: t('Texto aux gérants de garde', 'Text the managers on duty'), field: 'smsAfterMin' },
                { icon: <PhoneCall className="size-4" />, label: t('Appel (urgences seulement)', 'Phone call (urgent only)'), field: 'callAfterMin' },
                { icon: <Crown className="size-4" />, label: t('Propriétaire + soutien', 'Owner + support line'), field: 'ownerAfterMin' },
              ] as Array<{ icon: ReactNode; label: string; field: NumKey | null }>).map((s, i) => (
                <li key={i} className="relative rounded-md border border-line bg-raised p-3">
                  <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-ink-3 uppercase">{s.icon}{t('Étape', 'Step')} {i + 1}</div>
                  <div className="mt-1.5 text-[13px] font-semibold text-ink">{s.label}</div>
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
                    {s.field ? <><NumField className="w-20" range={RANGE[s.field]} value={w[s.field]} disabled={!edit} onChange={(v) => setNum(s.field as NumKey, v)} />{t('min après', 'min after')}</> : t('Tout de suite', 'Right away')}
                  </div>
                </li>
              ))}
            </ol></Hint>
            <Hint id="alerts.phones"><div className="mt-4">
              <div className="text-[13px] font-semibold text-ink-2">{t('Numéros qui reçoivent toutes les urgences (soutien, agent en direct)', 'Numbers that get every critical alert (support, live agent)')}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {w.supportPhones.map((p, i) => (
                  <span key={`${i}:${p}`} className={cn('inline-flex min-h-11 items-center gap-1 rounded-full border border-line-2 bg-raised text-sm font-semibold text-ink', edit ? 'pr-0.5 pl-3' : 'px-3')}>
                    {showPhone(p)}
                    {edit && <button type="button" onClick={() => removePhone(p)} className="flex size-11 items-center justify-center rounded-full text-ink-4 hover:bg-sunken hover:text-stop" aria-label={t(`Retirer ${showPhone(p)}`, `Remove ${showPhone(p)}`)}><X className="size-4" /></button>}
                  </span>
                ))}
                {!w.supportPhones.length && <span className="text-sm text-ink-3">{t('Aucun numéro pour l’instant.', 'No number yet.')}</span>}
              </div>
              {edit && w.supportPhones.length < MAX_PHONES && (
                <div className="mt-3">
                  <FormDraftNote restored={newPhone.restored} onDiscard={newPhone.discard} />
                  <div className="flex flex-wrap items-start gap-2">
                    <Field className="w-60" error={phoneErr || undefined} hint={t(`Ex. 514 555-0123 — ${MAX_PHONES} numéros au maximum`, `E.g. 514 555-0123 — ${MAX_PHONES} numbers at most`)}>
                      <Input type="tel" inputMode="tel" autoComplete="off" value={newPhone.value} placeholder="514 555-0123" aria-label={t('Numéro à ajouter', 'Number to add')}
                        onChange={(e) => { newPhone.set(e.target.value); setPhoneErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhones(); } }} />
                    </Field>
                    <Button variant="outline" disabled={!newPhone.value.trim()} onClick={addPhones} icon={<Plus className="size-4" />}>{t('Ajouter', 'Add')}</Button>
                  </div>
                </div>
              )}
            </div></Hint>
          </Section>

          <Section icon={<BellRing className="size-5" />} title={t('Seuils des commandes', 'Order thresholds')}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t('Commande non acceptée après (s)', 'Order not accepted after (s)')} hint={t('Uber annule à 11 min 30, Skip à 5 min.', 'Uber cancels at 11:30, Skip at 5 min.')}><NumField range={RANGE.unacceptedAfterSec} value={w.unacceptedAfterSec} disabled={!edit} onChange={(v) => setNum('unacceptedAfterSec', v)} /></Field>
              <Field label={t('Pas vue en cuisine après (s)', 'Not seen in the kitchen after (s)')}><NumField range={RANGE.unseenAfterSec} value={w.unseenAfterSec} disabled={!edit} onChange={(v) => setNum('unseenAfterSec', v)} /></Field>
              <Field label={t('En retard après (min)', 'Late after (min)')} hint={t('Après l’heure promise.', 'Past the promised time.')}><NumField range={RANGE.lateAfterMin} value={w.lateAfterMin} disabled={!edit} onChange={(v) => setNum('lateAfterMin', v)} /></Field>
              <Field label={t('Livreur qui attend (min)', 'Courier waiting (min)')}><NumField range={RANGE.courierWaitMin} value={w.courierWaitMin} disabled={!edit} onChange={(v) => setNum('courierWaitMin', v)} /></Field>
              <Field label={t('Aucune commande d’une plateforme depuis (min)', 'No order from a platform for (min)')} hint={t('Pendant que ses magasins sont ouverts : un branchement est peut-être cassé.', 'While its stores are open: a connection may be broken.')}><NumField range={RANGE.silenceAfterMin} value={w.silenceAfterMin ?? 180} disabled={!edit} onChange={(v) => setNum('silenceAfterMin', v)} /></Field>
            </div>
          </Section>

          <Section icon={<MoonStar className="size-5" />} title={t('Heures calmes et extras', 'Quiet hours & extras')}>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={t('Heures calmes — de', 'Quiet hours — from')}><Input type="time" className={cn('w-32', !HHMM.test(w.quietFrom) && 'border-stop')} value={w.quietFrom} disabled={!edit} onChange={(e) => set({ quietFrom: e.target.value })} /></Field>
                  <Field label={t('à', 'to')}><Input type="time" className={cn('w-32', !HHMM.test(w.quietTo) && 'border-stop')} value={w.quietTo} disabled={!edit} onChange={(e) => set({ quietTo: e.target.value })} /></Field>
                </div>
                <p className="mt-2 text-xs text-ink-3">{t('Pendant ces heures, seules les urgences textent et appellent. Les écrans sonnent toujours.', 'During these hours only critical alerts text and call. Screens still ring.')}</p>
              </div>
              <div className="grid gap-3">
                <Switch checked={w.postToChat} disabled={!edit} onChange={(v) => set({ postToChat: v })} label={t('Publier dans le clavardage de l’équipe', 'Post to team chat')} description={t('Avertissements et urgences (Slack, Teams, Google Chat…).', 'Warnings and critical alerts (Slack, Teams, Google Chat…).')} />
                <Switch checked={w.aiExplain} disabled={!edit} onChange={(v) => set({ aiExplain: v })} label={t('Explication par l’IA', 'AI explanation')} description={t('Claude explique chaque alerte et quoi faire. L’IA conseille seulement : elle n’approuve rien, ne rembourse rien et ne ferme rien.', 'Claude explains each alert and what to do. AI only advises: it never approves, refunds or closes anything.')} />
                <Switch checked={w.autoTextLateCustomers} disabled={!edit} onChange={(v) => set({ autoTextLateCustomers: v })} label={t('Texter automatiquement les clients en retard', 'Auto-text late customers')} description={t('Seulement quand la plateforme partage un numéro. Sinon, un brouillon est proposé au gérant.', 'Only when the platform shares a number. Otherwise a draft is offered to the manager.')} />
              </div>
            </div>
          </Section>

          <Section title={t('Ce qui est surveillé', 'What is watched')} subtitle={t('« Escalader » = texto puis appel. Sinon, écran et clavardage seulement.', '“Escalate” = text then call. Otherwise screen and chat only.')}>
            <Hint id="alerts.rules"><div className="-mx-5 -my-4">
              <Table>
                <thead><tr><Th>{t('Situation', 'Situation')}</Th><Th align="center">{t('Surveiller', 'Watch')}</Th><Th align="center">{t('Escalader', 'Escalate')}</Th></tr></thead>
                <tbody>
                  {kinds.map((k) => {
                    const r = w.rules[k.kind] ?? { enabled: true, escalate: false };
                    return (
                      <Tr key={k.kind}>
                        <Td className="font-semibold">{lang === 'fr' ? k.fr : k.en}</Td>
                        <Td align="center"><div className="inline-flex"><Switch size="sm" checked={r.enabled} disabled={!edit} onChange={(v) => setRule(k.kind, { enabled: v })} /></div></Td>
                        <Td align="center"><div className="inline-flex"><Switch size="sm" checked={r.escalate && r.enabled} disabled={!edit || !r.enabled} onChange={(v) => setRule(k.kind, { escalate: v })} /></div></Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div></Hint>
          </Section>
          {changed.at && <p className="text-xs text-ink-3">{t('Modifié', 'Changed')} {new Date(changed.at).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })}{changed.by ? ` · ${changed.by}` : ''}</p>}
        </>
      )}
      </div>
    </div>
  );
}

/**
 * A number box that can be cleared and retyped freely: the rules get the number as typed, and a value out of range is
 * flagged (validate blocks the save) instead of being changed under the person's fingers.
 */
function NumField({ value, range, onChange, disabled, className, inputSize }: { value: number; range: Range; onChange: (v: number) => void; disabled?: boolean; className?: string; inputSize?: 'sm' | 'md' }) {
  const [min, max] = range;
  const [text, setText] = useState(String(value));
  // Follow the rules when they change from elsewhere (undo, a restored draft, the server), not while being typed in.
  useEffect(() => { setText((cur) => (cur.trim() !== '' && Number(cur) === value ? cur : String(value))); }, [value]);
  const bad = !Number.isInteger(value) || value < min || value > max;
  return (
    <Input type="number" inputMode="numeric" inputSize={inputSize} min={min} max={max} step={1} value={text} disabled={disabled} aria-invalid={bad || undefined}
      className={cn(className, bad && 'border-stop')}
      onChange={(e) => { const v = e.target.value; setText(v); if (v.trim() !== '' && Number.isFinite(Number(v))) onChange(Number(v)); }}
      onBlur={() => setText(String(value))} />
  );
}

/** Per-screen alert behaviour (this browser only): sound, pop-up, repeat, desktop notifications. */
function ThisScreen() {
  const { t } = useI18n();
  const [s, setS] = useState<AlertSettings | null>(null);
  const [perm, setPerm] = useState<string>('default');
  useEffect(() => { setS(readAlertSettings()); if (typeof Notification !== 'undefined') setPerm(Notification.permission); }, []);
  if (!s) return null;
  const update = (p: Partial<AlertSettings>) => { const n = { ...s, ...p }; setS(n); writeAlertSettings(n); };
  async function desktop(v: boolean) {
    if (v && typeof Notification !== 'undefined' && Notification.permission !== 'granted') { const r = await Notification.requestPermission(); setPerm(r); if (r !== 'granted') return; }
    update({ desktop: v });
  }
  return (
    <Section icon={<Monitor className="size-5" />} title={t('Cet écran', 'This screen')} subtitle={t('Réglages gardés dans ce navigateur seulement — chaque tablette ou ordinateur a les siens.', 'Saved in this browser only — each tablet or computer has its own.')}
      right={<Button size="sm" variant="outline" onClick={() => { unlockAudio(); setVolume(s.volume); setLoud(s.loud); playSound('order'); }} icon={<Volume2 className="size-4" />}>{t('Tester le bip', 'Test the beep')}</Button>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Switch checked={s.sound} onChange={(v) => update({ sound: v })} label={t('Bip pour les nouvelles commandes', 'Beep for new orders')} />
        <Switch checked={s.loud} onChange={(v) => { update({ loud: v }); setLoud(v); }} label={t('Extra fort (cuisine bruyante)', 'Extra loud (noisy kitchen)')}
          description={t('Bip perçant, joué deux fois, presque au maximum. Montez aussi le volume de la tablette au maximum et coupez « Ne pas déranger ».', 'Piercing beep, played twice, near full volume. Also turn the tablet’s own volume all the way up and switch off “Do not disturb”.')} />
        <Switch checked={s.popup} onChange={(v) => update({ popup: v })} label={t('Plein écran pour les nouvelles commandes', 'Full-screen pop-up for new orders')} description={t('Accepter / refuser en un geste.', 'Accept / reject in one tap.')} />
        <Field label={t('Répéter le bip toutes les', 'Repeat the beep every')}>
          <Select value={String(s.repeatSec)} onChange={(e) => update({ repeatSec: Number(e.target.value) })}>
            {[2, 3, 5, 10].map((n) => <option key={n} value={n}>{n} s</option>)}
          </Select>
        </Field>
        <Field label={`${t('Volume', 'Volume')} · ${Math.round(s.volume * 100)} %`}>
          <input type="range" min={0.1} max={1} step={0.05} value={s.volume} onChange={(e) => { const v = Number(e.target.value); update({ volume: v }); setVolume(v); }} className="h-9 w-full accent-[var(--color-brand)]" />
        </Field>
        <Switch checked={s.desktop && perm === 'granted'} onChange={desktop} label={t('Notifications du bureau', 'Desktop notifications')} description={perm === 'denied' ? t('Bloquées par le navigateur — autorisez-les dans les réglages du site.', 'Blocked by the browser — allow them in the site settings.') : t('Même quand l’onglet est caché.', 'Even when the tab is hidden.')} />
        <div className="flex items-center gap-2 text-xs text-ink-3"><Badge tone={perm === 'granted' ? 'go' : perm === 'denied' ? 'stop' : 'neutral'}>{perm === 'granted' ? t('autorisées', 'allowed') : perm === 'denied' ? t('bloquées', 'blocked') : t('pas encore demandées', 'not asked yet')}</Badge></div>
      </div>
    </Section>
  );
}
