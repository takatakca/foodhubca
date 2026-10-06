'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, KeyRound, Languages, Mail, MessageSquareText, PhoneCall, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/card';
import { Field, Input, Switch } from '@/components/ui/form';
import { Segmented } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { DraftRestoredBanner, SaveChip } from '@/components/ui/save-chip';
import { Hint } from '@/components/help/hint';
import { useViewer, shortLoc } from '@/components/shell/viewer';
import { Section, SettingsHead, roleLabel } from '../settings-ui';
import { api, ApiError } from '@/lib/ui/api';
import { useAutosave } from '@/lib/ui/use-autosave';
import { useUndo } from '@/lib/ui/use-undo';
import { useI18n } from '@/lib/i18n/client';

type Prefs = { lang?: 'fr' | 'en'; alertSms?: boolean; alertCall?: boolean; alertEmail?: boolean; quietFrom?: string; quietTo?: string; onDuty?: boolean };
type Me = { username: string; name: string; role: string; locations: string[]; builtin: boolean; email: string | null; phone: string | null; hasPin: boolean; prefs: Prefs; device: { id: string; name: string; locationCode: string } | null };
type Channels = { email: boolean; sms: boolean; call: boolean; chat: boolean; ai: boolean };
type Doc = { name: string; email: string; phone: string; prefs: Prefs };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ProfilePage() {
  const { t, setLang } = useI18n();
  const { viewer, locName } = useViewer();
  const toast = useToast();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [prefs, setPrefs] = useState<Prefs>({});
  const [pin, setPin] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  // Name, contact, language and alerts are one document that saves by itself (no Save button, nothing lost).
  const doc = useMemo<Doc | null>(() => (me && !me.builtin ? { ...form, prefs } : null), [me, form, prefs]);
  const validate = useCallback((d: Doc) => [
    ...(!d.name.trim() ? [t('Le nom ne peut pas être vide', 'Name cannot be empty')] : []),
    ...(d.email.trim() && !EMAIL.test(d.email.trim()) ? [t('Courriel invalide', 'Invalid email')] : []),
    ...(d.phone.trim() && d.phone.replace(/\D/g, '').length < 10 ? [t('Cellulaire incomplet', 'Cell number incomplete')] : []),
    ...(!d.email.trim() && !d.phone.trim() ? [t('Gardez un courriel ou un cellulaire pour vous connecter', 'Keep an email or a cell to sign in')] : []),
  ], [t]);
  const autosave = useAutosave<Doc>({
    formKey: 'profile', user: viewer.username, value: doc, enabled: Boolean(me && !me.builtin), validate,
    save: async (d) => {
      await api('/api/foodhub/auth/me', { method: 'PATCH', json: { name: d.name.trim(), email: d.email.trim(), phone: d.phone.trim(), prefs: d.prefs } });
      setMe((m) => (m ? { ...m, name: d.name.trim(), email: d.email.trim() || null, phone: d.phone.trim() || null, prefs: d.prefs } : m));
      if (d.name.trim() !== viewer.name) router.refresh();
    },
    onRestore: (d) => { setForm({ name: d.name, email: d.email, phone: d.phone }); setPrefs(d.prefs); },
  });
  const undo = useUndo<Doc>(doc, (d) => { setForm({ name: d.name, email: d.email, phone: d.phone }); setPrefs(d.prefs); }, { enabled: Boolean(me && !me.builtin) });
  const { markLoaded } = autosave;
  const resetUndo = undo.reset;

  const load = useCallback(async () => {
    try {
      const [m, w] = await Promise.all([api<{ user: Me }>('/api/foodhub/auth/me'), api<{ channels: Channels }>('/api/foodhub/watch/settings').catch(() => null)]);
      const f = { name: m.user.name, email: m.user.email ?? '', phone: m.user.phone ?? '' };
      setMe(m.user); setForm(f); setPrefs(m.user.prefs ?? {}); setChannels(w?.channels ?? null);
      if (!m.user.builtin) { markLoaded({ ...f, prefs: m.user.prefs ?? {} }); resetUndo(); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [markLoaded, resetUndo]);
  useEffect(() => { load(); }, [load]);
  async function savePin() {
    if (pin.a !== pin.b) { setErr(t('Les deux NIP ne sont pas pareils.', 'The two PINs do not match.')); return; }
    setBusy('pin'); setErr('');
    try { await api('/api/foodhub/auth/my-pin', { method: 'POST', json: { pin: pin.a } }); setPin({ a: '', b: '' }); toast.success(t('NIP enregistré', 'PIN saved'), t('Utilisez-le pour déverrouiller les tablettes et approuver.', 'Use it to unlock tablets and approve.')); await load(); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }
  async function test(channel: 'sms' | 'call' | 'email' | 'chat') {
    setBusy(`test-${channel}`);
    try {
      const r = await api<{ result: { ok: boolean; message: string } }>('/api/foodhub/watch/test', { method: 'POST', json: { channel } });
      if (r.result.ok) toast.success(t('Test envoyé', 'Test sent'), r.result.message); else toast.warn(t('Pas envoyé', 'Not sent'), r.result.message);
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }
  function chooseLang(l: 'fr' | 'en') {
    setLang(l); setPrefs((p) => ({ ...p, lang: l }));
  }

  if (!me) return <div><SettingsHead title={t('Mon profil', 'My profile')} />{err ? <Banner tone="stop">{err}</Banner> : <div className="h-80 animate-pulse rounded-lg bg-sunken" />}</div>;

  const senior = me.role === 'owner' || me.role === 'manager';
  return (
    <div>
      <SettingsHead title={t('Mon profil', 'My profile')} intro={t('Vous vous connectez avec votre courriel ou votre cellulaire : un code à 6 chiffres arrive, pas de mot de passe. Votre NIP sert à déverrouiller les tablettes de cuisine et à approuver les actions des employés.', 'You sign in with your email or cell: a 6-digit code arrives, no password. Your PIN unlocks kitchen tablets and approves staff actions.')} />
      <div className="max-w-3xl">
      {!me.builtin && <div className="mb-3 flex justify-end"><SaveChip autosave={autosave} undo={undo} /></div>}
      {autosave.draftRestored && <DraftRestoredBanner onDiscard={autosave.discardDraft} />}
      {autosave.status === 'error' && autosave.error && <Banner tone="stop" className="mb-4">{autosave.error}</Banner>}
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {me.builtin && <Banner tone="warn" className="mb-4">{t('Vous utilisez le compte de secours du propriétaire (mot de passe). Créez votre propre compte propriétaire avec votre courriel ou cellulaire dans', 'You are using the owner recovery login (password). Create your own owner account with your email or cell in')} <Link href="/settings/team" className="font-bold underline">{t('Équipe', 'Team')}</Link>{t(', puis connectez-vous avec.', ', then sign in with it.')}</Banner>}

      <Section icon={<UserRound className="size-5" />} title={t('Identité', 'Identity')} right={<div className="flex flex-wrap gap-1.5"><Badge tone="dark">{roleLabel(t, me.role)}</Badge>{me.locations.length ? me.locations.map((l) => <Badge key={l}>{shortLoc(locName(l))}</Badge>) : <Badge>{t('Toutes les succursales', 'All locations')}</Badge>}</div>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('Nom', 'Name')} className="sm:col-span-2"><Input value={form.name} disabled={me.builtin} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} /></Field>
          <Field label={t('Courriel', 'Email')} hint={t('Pour la connexion et les rapports.', 'For sign-in and reports.')}><Input type="email" autoComplete="email" value={form.email} disabled={me.builtin} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="vous@exemple.com" /></Field>
          <Field label={t('Cellulaire', 'Cell')} hint={t('Pour la connexion par texto et les alertes.', 'For SMS sign-in and alerts.')}><Input type="tel" autoComplete="tel" inputMode="tel" value={form.phone} disabled={me.builtin} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="514 555-0123" /></Field>
        </div>
      </Section>

      <Section icon={<Languages className="size-5" />} title={t('Langue', 'Language')} subtitle={t('L’écran, les textos et les appels d’alerte suivent ce choix.', 'Screens, alert texts and calls follow this choice.')} right={<Segmented value={prefs.lang ?? 'fr'} onChange={chooseLang} options={[{ key: 'fr', label: 'Français' }, { key: 'en', label: 'English' }]} />}>
        <p className="text-[13px] text-ink-3">{t('Chaque personne choisit sa langue. Les tablettes de cuisine gardent celle de la personne connectée.', 'Each person picks their own language. Kitchen tablets follow the person signed in.')}</p>
      </Section>

      {!me.builtin && (
        <Section icon={<KeyRound className="size-5" />} title={t('Mon NIP', 'My PIN')} subtitle={t('4 à 6 chiffres, unique dans l’équipe. Ne le donnez à personne : chaque action approuvée porte votre nom.', '4–6 digits, unique in the team. Never share it: every approved action carries your name.')} right={me.hasPin ? <Badge tone="go">✓ {t('NIP actif', 'PIN set')}</Badge> : <Badge tone="wait">{t('Aucun NIP', 'No PIN')}</Badge>}>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={me.hasPin ? t('Nouveau NIP', 'New PIN') : t('NIP', 'PIN')}><Input className="w-36 text-center font-mono tracking-[0.4em]" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin.a} onChange={(e) => setPin({ ...pin, a: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('Encore une fois', 'Once more')}><Input className="w-36 text-center font-mono tracking-[0.4em]" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin.b} onChange={(e) => setPin({ ...pin, b: e.target.value.replace(/\D/g, '') })} /></Field>
            <Button disabled={pin.a.length < 4 || pin.b.length < 4} loading={busy === 'pin'} onClick={savePin}>{me.hasPin ? t('Changer le NIP', 'Change PIN') : t('Créer mon NIP', 'Create my PIN')}</Button>
          </div>
        </Section>
      )}

      {!me.builtin && (
        <Hint id="profile.alerts"><div><Section icon={<BellRing className="size-5" />} title={t('Mes alertes', 'My alerts')} subtitle={senior ? t('Quand une commande attend, qu’une tablette s’éteint ou qu’un magasin tombe, la surveillance texte puis appelle les gérants de garde, puis le propriétaire.', 'When an order waits, a tablet goes off or a store drops, the watchtower texts then calls the managers on duty, then the owner.') : t('Les alertes urgentes vont aux gérants. Vous pouvez quand même recevoir des textos.', 'Urgent alerts go to managers. You can still receive texts.')}>
          <div className="grid gap-4">
            {senior && <Switch checked={prefs.onDuty !== false} onChange={(v) => setPrefs({ ...prefs, onDuty: v })} label={t('Je suis de garde', 'I am on duty')} description={t('Désactivé = vous n’êtes jamais texté ni appelé (vacances, congé).', 'Off = you are never texted or called (holidays, day off).')} />}
            <Switch checked={!!prefs.alertSms} onChange={(v) => setPrefs({ ...prefs, alertSms: v })} label={t('Texto (SMS)', 'Text message (SMS)')} description={me.phone ? me.phone : t('Ajoutez votre cellulaire ci-dessus.', 'Add your cell above.')} disabled={!me.phone} />
            {senior && <Switch checked={!!prefs.alertCall} onChange={(v) => setPrefs({ ...prefs, alertCall: v })} label={t('Appel téléphonique pour l’urgent', 'Phone call for urgent alerts')} description={t('Une voix lit l’alerte deux fois — comme Uber quand la tablette est éteinte.', 'A voice reads the alert twice — like Uber when the tablet is off.')} disabled={!me.phone} />}
            <Switch checked={!!prefs.alertEmail} onChange={(v) => setPrefs({ ...prefs, alertEmail: v })} label={t('Courriel (résumé)', 'Email (summary)')} description={me.email ?? t('Ajoutez votre courriel ci-dessus.', 'Add your email above.')} disabled={!me.email} />
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('Mes heures calmes — de', 'My quiet hours — from')}><Input type="time" className="w-32" value={prefs.quietFrom ?? ''} onChange={(e) => setPrefs({ ...prefs, quietFrom: e.target.value })} /></Field>
              <Field label={t('à', 'to')}><Input type="time" className="w-32" value={prefs.quietTo ?? ''} onChange={(e) => setPrefs({ ...prefs, quietTo: e.target.value })} /></Field>
              <span className="pb-2.5 text-xs text-ink-3">{t('Seul le critique passe pendant vos heures calmes.', 'Only critical alerts get through in your quiet hours.')}</span>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!me.phone} loading={busy === 'test-sms'} onClick={() => test('sms')} icon={<MessageSquareText className="size-4" />}>{t('Tester le texto', 'Test text')}</Button>
              {senior && <Button size="sm" variant="outline" disabled={!me.phone} loading={busy === 'test-call'} onClick={() => test('call')} icon={<PhoneCall className="size-4" />}>{t('Tester l’appel', 'Test call')}</Button>}
              <Button size="sm" variant="outline" disabled={!me.email} loading={busy === 'test-email'} onClick={() => test('email')} icon={<Mail className="size-4" />}>{t('Tester le courriel', 'Test email')}</Button>
            </div>
          </div>
          {channels && (!channels.sms || !channels.call || !channels.email) && (
            <p className="mt-3 text-xs text-ink-3">{t('Pas encore branché :', 'Not connected yet:')} {[!channels.sms && t('textos (Twilio)', 'texts (Twilio)'), !channels.call && t('appels (Twilio)', 'calls (Twilio)'), !channels.email && t('courriels (Resend)', 'email (Resend)')].filter(Boolean).join(', ')}. {t('Les messages sont gardés dans le journal en attendant.', 'Messages are kept in the log until then.')}</p>
          )}
        </Section></div></Hint>
      )}

      {me.device && <Banner tone="info">{t('Cet écran est la tablette', 'This screen is the tablet')} <strong>{me.device.name}</strong> · {shortLoc(locName(me.device.locationCode))}. <Link href="/settings/devices" className="font-bold underline">{t('Tablettes', 'Tablets')}</Link></Banner>}
      </div>
    </div>
  );
}
