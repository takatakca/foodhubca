'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Bot, Crown, Mail, MessageSquareText, Monitor, MoonStar, PhoneCall, Save, Send, Volume2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { readAlertSettings, writeAlertSettings, type AlertSettings } from '@/components/live/incoming';
import { Section, SettingsHead } from '../settings-ui';
import { api, ApiError } from '@/lib/ui/api';
import { playSound, setVolume, unlockAudio } from '@/lib/ui/sound';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type RuleSetting = { enabled: boolean; escalate: boolean };
type Watch = {
  enabled: boolean; smsAfterMin: number; callAfterMin: number; ownerAfterMin: number; unacceptedAfterSec: number; unseenAfterSec: number; lateAfterMin: number; courierWaitMin: number;
  quietFrom: string; quietTo: string; postToChat: boolean; aiExplain: boolean; autoTextLateCustomers: boolean; supportPhones: string[]; rules: Record<string, RuleSetting>; updatedAt?: string; updatedBy?: string;
};
type Channels = { email: boolean; sms: boolean; call: boolean; chat: boolean; ai: boolean };
type Kind = { kind: string; fr: string; en: string };

export default function AlertSettingsPage() {
  const { t, lang, loc } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const edit = can('admin');
  const [w, setW] = useState<Watch | null>(null);
  const [saved, setSaved] = useState('');
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [phones, setPhones] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => api<{ settings: Watch; kinds: Kind[]; channels: Channels }>('/api/foodhub/watch/settings').then((d) => {
    setW(d.settings); setSaved(JSON.stringify(d.settings)); setKinds(d.kinds); setChannels(d.channels); setPhones(d.settings.supportPhones.join(', ')); setErr('');
  }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); }, [load]);

  const draft = useMemo(() => (w ? { ...w, supportPhones: phones.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) } : null), [w, phones]);
  const dirty = Boolean(draft && JSON.stringify(draft) !== saved);
  const set = (p: Partial<Watch>) => setW((cur) => (cur ? { ...cur, ...p } : cur));
  const setRule = (k: string, p: Partial<RuleSetting>) => setW((cur) => (cur ? { ...cur, rules: { ...cur.rules, [k]: { ...cur.rules[k], ...p } } } : cur));

  async function save() {
    if (!draft) return;
    setBusy('save');
    try { const r = await api<{ settings: Watch }>('/api/foodhub/watch/settings', { method: 'PUT', json: { settings: draft } }); setW(r.settings); setSaved(JSON.stringify(r.settings)); setPhones(r.settings.supportPhones.join(', ')); toast.success(t('Règles d’alerte enregistrées', 'Alert rules saved')); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }
  async function test(channel: 'sms' | 'call' | 'email' | 'chat') {
    setBusy(`test-${channel}`);
    try {
      const r = await api<{ result: { ok: boolean; message: string } }>('/api/foodhub/watch/test', { method: 'POST', json: { channel } });
      if (r.result.ok) toast.success(t('Test envoyé', 'Test sent'), r.result.message); else toast.warn(t('Pas envoyé', 'Not sent'), r.result.message);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }

  const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Number(v) || min));
  const chip = (ok: boolean | undefined, label: string, icon: React.ReactNode, hint: string) => (
    <div className={cn('flex items-center gap-2.5 rounded-md border px-3 py-2.5', ok ? 'border-go/30 bg-go/5' : 'border-line-2 bg-raised')}>
      <span className={ok ? 'text-go-2' : 'text-ink-4'}>{icon}</span>
      <div className="min-w-0"><div className="text-[13px] font-bold text-ink">{label}</div><div className="truncate text-[11px] text-ink-3">{ok ? t('Branché', 'Connected') : hint}</div></div>
    </div>
  );

  return (
    <div className="pb-20">
      <SettingsHead title={t('Alertes et surveillance', 'Alerts & watchtower')} intro={t('La surveillance tourne en arrière-plan toutes les 20 secondes : commandes qui attendent, tablettes éteintes, magasins hors ligne, Clover qui n’a rien reçu, retards, annulations, argent manquant. Elle sonne à l’écran, puis texte, puis appelle — jusqu’à ce que quelqu’un réponde.', 'The watchtower runs in the background every 20 seconds: waiting orders, tablets off, stores offline, Clover not receiving, late orders, cancellations, missing money. It rings on screen, then texts, then calls — until someone answers.')}
        right={edit && w ? <Button loading={busy === 'save'} disabled={!dirty} onClick={save} icon={<Save className="size-4" />}>{t('Enregistrer', 'Save')}</Button> : undefined} />
      <div className="max-w-5xl">
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
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
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="xs" variant="outline" loading={busy === 'test-sms'} onClick={() => test('sms')}>{t('Me texter un test', 'Text me a test')}</Button>
              <Button size="xs" variant="outline" loading={busy === 'test-call'} onClick={() => test('call')}>{t('M’appeler', 'Call me')}</Button>
              <Button size="xs" variant="outline" loading={busy === 'test-email'} onClick={() => test('email')}>{t('M’écrire', 'Email me')}</Button>
              <Button size="xs" variant="outline" loading={busy === 'test-chat'} onClick={() => test('chat')}>{t('Tester le clavardage', 'Test chat')}</Button>
            </div>
          </Section>

          <Section icon={<PhoneCall className="size-5" />} title={t('Escalade', 'Escalation')} subtitle={t('Une alerte « vue » (bouton Je m’en occupe) arrête l’escalade. Les gérants de garde sont ceux de la succursale concernée, avec un cellulaire.', 'An acknowledged alert (I’m on it button) stops escalating. Managers on duty are those of the location concerned, with a cell number.')}
            right={<Switch checked={w.enabled} disabled={!edit} onChange={(v) => set({ enabled: v })} label={w.enabled ? t('Surveillance active', 'Watchtower on') : t('Surveillance arrêtée', 'Watchtower off')} />}>
            <ol className="grid grid-cols-1 gap-2 md:grid-cols-4">
              {[
                { icon: <Volume2 className="size-4" />, at: '0', label: t('Écran + bip en cuisine', 'Screen + beep in the kitchen'), field: null },
                { icon: <MessageSquareText className="size-4" />, at: String(w.smsAfterMin), label: t('Texto aux gérants de garde', 'Text the managers on duty'), field: 'smsAfterMin' as const },
                { icon: <PhoneCall className="size-4" />, at: String(w.callAfterMin), label: t('Appel (urgences seulement)', 'Phone call (urgent only)'), field: 'callAfterMin' as const },
                { icon: <Crown className="size-4" />, at: String(w.ownerAfterMin), label: t('Propriétaire + soutien', 'Owner + support line'), field: 'ownerAfterMin' as const },
              ].map((s, i) => (
                <li key={i} className="relative rounded-md border border-line bg-raised p-3">
                  <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-ink-3 uppercase">{s.icon}{t('Étape', 'Step')} {i + 1}</div>
                  <div className="mt-1.5 text-[13px] font-semibold text-ink">{s.label}</div>
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
                    {s.field ? <><Input inputSize="sm" type="number" min={1} max={120} className="w-16" value={s.at} disabled={!edit} onChange={(e) => set({ [s.field!]: num(e.target.value, 1, 120) } as Partial<Watch>)} />{t('min après', 'min after')}</> : t('Tout de suite', 'Right away')}
                  </div>
                </li>
              ))}
            </ol>
            <Field label={t('Numéros qui reçoivent toutes les urgences (soutien, agent en direct)', 'Numbers that get every critical alert (support, live agent)')} hint={t('Séparés par des virgules, ex. +15145550123', 'Comma separated, e.g. +15145550123')} className="mt-4">
              <Input value={phones} disabled={!edit} onChange={(e) => setPhones(e.target.value)} placeholder="+15145550123" />
            </Field>
          </Section>

          <Section icon={<BellRing className="size-5" />} title={t('Seuils des commandes', 'Order thresholds')}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t('Commande non acceptée après (s)', 'Order not accepted after (s)')} hint={t('Uber annule à 11 min 30, Skip à 5 min.', 'Uber cancels at 11:30, Skip at 5 min.')}><Input type="number" min={15} max={600} value={w.unacceptedAfterSec} disabled={!edit} onChange={(e) => set({ unacceptedAfterSec: num(e.target.value, 15, 600) })} /></Field>
              <Field label={t('Pas vue en cuisine après (s)', 'Not seen in the kitchen after (s)')}><Input type="number" min={30} max={900} value={w.unseenAfterSec} disabled={!edit} onChange={(e) => set({ unseenAfterSec: num(e.target.value, 30, 900) })} /></Field>
              <Field label={t('En retard après (min)', 'Late after (min)')} hint={t('Après l’heure promise.', 'Past the promised time.')}><Input type="number" min={1} max={60} value={w.lateAfterMin} disabled={!edit} onChange={(e) => set({ lateAfterMin: num(e.target.value, 1, 60) })} /></Field>
              <Field label={t('Livreur qui attend (min)', 'Courier waiting (min)')}><Input type="number" min={1} max={30} value={w.courierWaitMin} disabled={!edit} onChange={(e) => set({ courierWaitMin: num(e.target.value, 1, 30) })} /></Field>
            </div>
          </Section>

          <Section icon={<MoonStar className="size-5" />} title={t('Heures calmes et extras', 'Quiet hours & extras')}>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={t('Heures calmes — de', 'Quiet hours — from')}><Input type="time" className="w-32" value={w.quietFrom} disabled={!edit} onChange={(e) => set({ quietFrom: e.target.value })} /></Field>
                  <Field label={t('à', 'to')}><Input type="time" className="w-32" value={w.quietTo} disabled={!edit} onChange={(e) => set({ quietTo: e.target.value })} /></Field>
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
            <div className="-mx-5 -my-4">
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
            </div>
          </Section>
          {w.updatedAt && <p className="text-xs text-ink-3">{t('Modifié', 'Changed')} {new Date(w.updatedAt).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })}{w.updatedBy ? ` · ${w.updatedBy}` : ''}</p>}
        </>
      )}

      {edit && dirty && (
        <div className="fixed inset-x-0 bottom-16 z-30 flex justify-center px-4 lg:bottom-6">
          <div className="flex items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-canvas shadow-pop">
            {t('Modifications non enregistrées', 'Unsaved changes')}
            <Button size="sm" variant="brand" loading={busy === 'save'} onClick={save}>{t('Enregistrer', 'Save')}</Button>
            <button type="button" className="text-xs font-semibold text-canvas/70 hover:text-canvas" onClick={load}>{t('Annuler', 'Discard')}</button>
          </div>
        </div>
      )}
      </div>
    </div>
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
      right={<Button size="sm" variant="outline" onClick={() => { unlockAudio(); setVolume(s.volume); playSound('order'); }} icon={<Volume2 className="size-4" />}>{t('Tester le bip', 'Test the beep')}</Button>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Switch checked={s.sound} onChange={(v) => update({ sound: v })} label={t('Bip pour les nouvelles commandes', 'Beep for new orders')} />
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
