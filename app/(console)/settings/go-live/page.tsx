'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleDashed, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { SettingsHead } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type Readiness = { channel: string; label: string; configured: boolean; canSend: boolean; missing: string[]; viaClover?: boolean };
type CloverAppInfo = { configured: boolean; merchants: Array<{ status?: string }>; legalStatus?: { supportEmailSet: boolean; approved: boolean } };
type ChannelsData = { mode: string; liveEnabled: boolean; dashboardProtected: boolean; clover: { configured: boolean; missing: string[]; webhookAuthSet?: boolean; verification?: { code: string } | null; app?: CloverAppInfo }; channels: Readiness[] };
type Notify = { email: boolean; sms: boolean; call: boolean; chat: boolean; ai: boolean };
type User = { username: string; name: string; role: string; locations: string[]; email: string | null; phone: string | null; active: boolean; hasPin: boolean };
type Device = { id: string; locationCode: string; status: string };
type Store = { channel: string; brandName: string; locationCode: string };
type Fees = { confirmed: Record<string, boolean> };
type Step = { key: string; state: 'done' | 'todo' | 'warn'; title: string; body: string; href: string; cta: string; group: string };

type CloverCheck = { report: { ok: boolean; unprintedCount: number; items: number; kitchenLabels: unknown[] } | null; taxes?: { ok: boolean; problems: string[]; problemsFr?: string[]; defaultPercent: number } };

/** Clover register check: kitchen printing labels and tax rates (read from Clover). */
function cloverCheckSteps(ck: CloverCheck, t: (fr: string, en: string) => string): Step[] {
  const out: Step[] = [];
  const r = ck.report;
  if (r?.ok) {
    out.push({ group: t('Plateformes', 'Platforms'), key: 'clover-print', state: r.unprintedCount ? 'todo' : 'done', title: t('Impression en cuisine (Clover)', 'Kitchen printing (Clover)'),
      body: r.unprintedCount ? t(`${r.unprintedCount} article(s) sur ${r.items} n’ont pas d’étiquette d’imprimante : ils ne s’impriment pas en cuisine.`, `${r.unprintedCount} of ${r.items} item(s) have no printer label: they never print in the kitchen.`) : t('Tous les articles s’impriment en cuisine.', 'Every item prints in the kitchen.'),
      href: '/settings/channels', cta: t('Corriger', 'Fix') });
  }
  if (ck.taxes?.ok) {
    out.push({ group: t('Plateformes', 'Platforms'), key: 'clover-tax', state: ck.taxes.problems.length ? 'todo' : 'done', title: t('Taxes dans Clover', 'Taxes in Clover'),
      body: ck.taxes.problems.length ? t((ck.taxes.problemsFr ?? ck.taxes.problems).join(' '), ck.taxes.problems.join(' ')) : t(`Taxes par défaut : ${ck.taxes.defaultPercent} %.`, `Default taxes: ${ck.taxes.defaultPercent}%.`), href: '/settings/channels', cta: t('Voir', 'See') });
  }
  return out;
}

/** Clover App Market app: keys, webhook, public legal pages, merchants waiting for approval (optional group). */
function cloverAppSteps(ch: ChannelsData, t: (fr: string, en: string) => string): Step[] {
  const app = ch.clover.app;
  if (!app) return [];
  const g = t('Application Clover (App Market)', 'Clover app (App Market)');
  const pending = app.merchants.filter((m) => m.status === 'pending').length;
  const legal = app.legalStatus ?? { supportEmailSet: false, approved: false };
  const hook = Boolean(ch.clover.webhookAuthSet && ch.clover.verification);
  const legalMissing = [!legal.supportEmailSet && 'FOODHUB_SUPPORT_EMAIL', !legal.approved && 'FOODHUB_LEGAL_APPROVED=true'].filter(Boolean).join(', ');
  return [
    { group: g, key: 'clover-app', state: app.configured ? 'done' : 'warn', title: t('Clés de l’app Clover', 'Clover app keys'), body: app.configured ? t('Chaque marchand Clover se branche en un clic.', 'Each Clover merchant connects in one click.') : t('Optionnel : CLOVER_CLIENT_ID (App ID 629HFYHNVMZYR) et CLOVER_CLIENT_SECRET avec npm run setup.', 'Optional: CLOVER_CLIENT_ID (App ID 629HFYHNVMZYR) and CLOVER_CLIENT_SECRET with npm run setup.'), href: '/settings/channels', cta: t('Voir', 'See') },
    { group: g, key: 'clover-hook', state: hook ? 'done' : 'warn', title: t('Webhook Clover vérifié', 'Clover webhook verified'), body: hook ? t('Ruptures instantanées et désinstallations reçues.', 'Instant sold-outs and uninstalls received.') : t('Développeur Clover → Webhooks : l’adresse de Réglages → Plateformes, événements Inventaire et App ; recollez le code de vérification, puis CLOVER_WEBHOOK_AUTH.', 'Clover developer → Webhooks: the URL from Settings → Platforms, events Inventory and App; paste back the verification code, then CLOVER_WEBHOOK_AUTH.'), href: '/settings/channels', cta: t('Voir', 'See') },
    { group: g, key: 'legal', state: legalMissing ? 'warn' : 'done', title: t('Pages confidentialité, conditions, soutien', 'Privacy, terms and support pages'), body: legalMissing ? `${t('Brouillons publics à faire relire. Manque :', 'Public drafts to review. Missing:')} ${legalMissing}` : t('Prêtes pour la fiche Clover.', 'Ready for the Clover listing.'), href: '/legal/privacy', cta: t('Relire', 'Review') },
    ...(pending ? [{ group: g, key: 'clover-pending', state: 'todo' as const, title: t('Marchands Clover en attente', 'Clover merchants waiting'), body: t(`${pending} marchand(s) ont ouvert l’app depuis Clover et attendent votre approbation.`, `${pending} merchant(s) opened the app from Clover and are waiting for your approval.`), href: '/settings/channels', cta: t('Approuver', 'Approve') }] : []),
  ];
}

export default function GoLivePage() {
  const { t } = useI18n();
  const { locations, can } = useViewer();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [ch, w, u, d, s, f, cat, ck] = await Promise.all([
        api<ChannelsData>('/api/foodhub/channels'),
        api<{ channels: Notify }>('/api/foodhub/watch/settings'),
        api<{ users: User[] }>('/api/foodhub/users'),
        api<{ devices: Device[] }>('/api/foodhub/devices'),
        api<{ stores: Store[] }>('/api/foodhub/stores'),
        api<{ fees: Fees }>('/api/foodhub/recon/fees').catch((): { fees: Fees } => ({ fees: { confirmed: {} } })),
        api<{ locations: Array<{ code: string; name: string; phone?: string | null; active: boolean }> }>('/api/foodhub/catalog'),
        api<CloverCheck>('/api/foodhub/clover-labels').catch((): CloverCheck => ({ report: null })),
      ]);
      const noPhone = cat.locations.filter((l) => l.active && !l.phone);
      const users = u.users.filter((x) => x.active);
      const owner = users.some((x) => x.role === 'owner' && (x.email || x.phone));
      const locNoManager = locations.filter((l) => !users.some((x) => (x.role === 'manager' || x.role === 'owner') && x.phone && x.hasPin && (!x.locations.length || x.locations.includes(l.code))));
      const locNoTablet = locations.filter((l) => !d.devices.some((x) => x.locationCode === l.code));
      const tabletsOff = d.devices.filter((x) => x.status !== 'online').length;
      const staffNoPin = users.filter((x) => x.role === 'operator' && !x.hasPin).length;
      const byCh = (k: string) => s.stores.filter((x) => x.channel === k).length;
      const ready = (k: string) => ch.channels.find((x) => x.channel === k);
      const unconfirmed = ['uber_eats', 'doordash', 'skip'].filter((k) => !f.fees.confirmed[k]);
      const list = (xs: Array<{ name: string }>) => xs.map((l) => shortLoc(l.name)).join(', ');

      const out: Step[] = [
        { group: t('Fondations', 'Foundations'), key: 'db', state: ch.mode === 'memory' ? 'todo' : 'done', title: t('Base de données Supabase', 'Supabase database'), body: ch.mode === 'memory' ? t('Mode démo : rien n’est gardé au redémarrage. Lancez npm run setup avec l’URL et la clé Supabase, puis exécutez INSTALL_ALL.sql.', 'Demo mode: nothing is kept across restarts. Run npm run setup with the Supabase URL and key, then run INSTALL_ALL.sql.') : t('Branchée.', 'Connected.'), href: '/settings/channels', cta: t('Voir', 'See') },
        { group: t('Fondations', 'Foundations'), key: 'secret', state: ch.dashboardProtected ? 'done' : 'todo', title: t('Mot de passe de secours et secret de session', 'Recovery password and session secret'), body: ch.dashboardProtected ? t('DASHBOARD_PASSWORD est défini.', 'DASHBOARD_PASSWORD is set.') : t('Définissez DASHBOARD_PASSWORD et SESSION_SECRET (npm run setup). Vous les tapez vous-même — jamais dans le clavardage.', 'Set DASHBOARD_PASSWORD and SESSION_SECRET (npm run setup). You type them yourself — never in chat.'), href: '/settings/channels', cta: t('Voir', 'See') },
        { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'email', state: w.channels.email ? 'done' : 'todo', title: t('Courriels de connexion (Resend)', 'Sign-in emails (Resend)'), body: w.channels.email ? t('Les codes partent par courriel.', 'Codes are sent by email.') : t('RESEND_API_KEY + AUTH_EMAIL_FROM, avec un domaine vérifié chez Resend.', 'RESEND_API_KEY + AUTH_EMAIL_FROM, with a domain verified at Resend.'), href: '/settings/alerts', cta: t('Tester', 'Test') },
        { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'sms', state: w.channels.sms && w.channels.call ? 'done' : 'todo', title: t('Textos et appels (Twilio)', 'Texts and calls (Twilio)'), body: w.channels.sms ? (w.channels.call ? t('Textos et appels d’alerte prêts.', 'Alert texts and calls ready.') : t('Textos prêts ; ajoutez TWILIO_FROM pour les appels.', 'Texts ready; add TWILIO_FROM for calls.')) : t('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_FROM (un numéro canadien).', 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (a Canadian number).'), href: '/settings/alerts', cta: t('Tester', 'Test') },
        { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'chat', state: w.channels.chat ? 'done' : 'warn', title: t('Clavardage de l’équipe', 'Team chat'), body: w.channels.chat ? t('Les alertes sont publiées.', 'Alerts are posted.') : t('Optionnel : ALERT_WEBHOOK_URL (Slack, Teams, Google Chat).', 'Optional: ALERT_WEBHOOK_URL (Slack, Teams, Google Chat).'), href: '/settings/alerts', cta: t('Voir', 'See') },
        { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'ai', state: w.channels.ai ? 'done' : 'warn', title: t('Surveillance IA (Claude)', 'AI watchtower (Claude)'), body: w.channels.ai ? t('Claude explique les alertes et répond au copilote.', 'Claude explains alerts and answers the copilot.') : t('Optionnel : ANTHROPIC_API_KEY. Sans clé, les règles intégrées expliquent les alertes.', 'Optional: ANTHROPIC_API_KEY. Without it, built-in rules explain alerts.'), href: '/settings/alerts', cta: t('Voir', 'See') },
        { group: t('Équipe', 'Team'), key: 'owner', state: owner ? 'done' : 'todo', title: t('Votre compte propriétaire', 'Your owner account'), body: owner ? t('Connexion par code, sans mot de passe.', 'Code sign-in, no password.') : t('Créez votre compte avec votre courriel ou cellulaire, puis ne gardez le mot de passe que pour le secours.', 'Create your account with your email or cell, then keep the password for recovery only.'), href: '/settings/team', cta: t('Ajouter', 'Add') },
        { group: t('Équipe', 'Team'), key: 'managers', state: locNoManager.length ? 'todo' : 'done', title: t('Un gérant joignable par succursale', 'A reachable manager per location'), body: locNoManager.length ? `${t('Sans gérant avec cellulaire et NIP :', 'No manager with cell and PIN:')} ${list(locNoManager)}` : t('Chaque succursale a un gérant avec cellulaire et NIP.', 'Every location has a manager with a cell and a PIN.'), href: '/settings/team', cta: t('Équipe', 'Team') },
        { group: t('Équipe', 'Team'), key: 'pins', state: staffNoPin ? 'warn' : 'done', title: t('NIP des employés', 'Staff PINs'), body: staffNoPin ? t(`${staffNoPin} employé(s) sans NIP — ils ne peuvent pas déverrouiller une tablette.`, `${staffNoPin} staff without a PIN — they cannot unlock a tablet.`) : t('Tous les employés ont un NIP.', 'All staff have a PIN.'), href: '/settings/team', cta: t('Équipe', 'Team') },
        { group: t('Cuisine', 'Kitchen'), key: 'tablets', state: locNoTablet.length ? 'todo' : tabletsOff ? 'warn' : 'done', title: t('Une tablette par cuisine', 'A tablet per kitchen'), body: locNoTablet.length ? `${t('Sans tablette :', 'No tablet:')} ${list(locNoTablet)}` : tabletsOff ? t(`${tabletsOff} tablette(s) hors ligne en ce moment.`, `${tabletsOff} tablet(s) offline right now.`) : t('Toutes en ligne.', 'All online.'), href: '/settings/devices', cta: t('Tablettes', 'Tablets') },
        { group: t('Cuisine', 'Kitchen'), key: 'kphone', state: noPhone.length ? 'warn' : 'done', title: t('Téléphone de chaque cuisine', 'Each kitchen’s phone'), body: noPhone.length ? `${t('La surveillance ne peut pas appeler :', 'The watchtower cannot call:')} ${list(noPhone)}` : t('La surveillance appelle la cuisine en premier, comme Uber.', 'The watchtower calls the kitchen first, like Uber.'), href: '/settings/business', cta: t('Ajouter', 'Add') },
        { group: t('Plateformes', 'Platforms'), key: 'clover', state: ch.clover.configured ? 'done' : 'todo', title: 'Clover', body: ch.clover.configured ? t('Les commandes vont dans la caisse.', 'Orders go into the register.') : `${t('Manque :', 'Missing:')} ${ch.clover.missing.join(', ')}`, href: '/settings/channels', cta: t('Brancher', 'Connect') },
        ...(['uber_eats', 'doordash', 'skip'] as const).map((k): Step => {
          const r = ready(k);
          const n = byCh(k);
          if (r?.viaClover) return { group: t('Plateformes', 'Platforms'), key: k, state: 'done', title: r.label, body: t('Relié par Clover : les commandes arrivent dans Clover et Food Hub les lit (lecture seule).', 'Linked through Clover: orders arrive in Clover and Food Hub reads them (read-only).'), href: '/settings/channels', cta: t('Voir', 'See') };
          return { group: t('Plateformes', 'Platforms'), key: k, state: r?.configured && n ? 'done' : 'todo', title: r?.label ?? k, body: !r?.configured ? `${t('Manque :', 'Missing:')} ${r?.missing.join(', ') || '—'}` : n ? t(`${n} magasin(s) jumelé(s).`, `${n} store(s) mapped.`) : t('Branché, mais aucun magasin jumelé.', 'Connected, but no store mapped.'), href: r?.configured ? '/stores/mapping' : '/settings/channels', cta: r?.configured ? t('Jumeler', 'Map') : t('Brancher', 'Connect') };
        }),
        ...cloverCheckSteps(ck, t),
        ...cloverAppSteps(ch, t),
        { group: t('Argent', 'Money'), key: 'fees', state: unconfirmed.length ? 'warn' : 'done', title: t('Plans de commission confirmés', 'Commission plans confirmed'), body: unconfirmed.length ? `${t('À confirmer :', 'To confirm:')} ${unconfirmed.map((k) => ready(k)?.label ?? k).join(', ')}` : t('Conformes à vos contrats.', 'Match your contracts.'), href: '/money/fees', cta: t('Vérifier', 'Check') },
        { group: t('Ouverture', 'Opening'), key: 'live', state: ch.liveEnabled ? 'done' : 'todo', title: t('Mode direct', 'Live mode'), body: ch.liveEnabled ? t('Les actions partent vers les plateformes.', 'Actions are sent to the platforms.') : t('Dernière étape : LIVE_CONNECTORS_GLOBAL_ENABLED=true, quand tout le reste est vert.', 'Last step: LIVE_CONNECTORS_GLOBAL_ENABLED=true, once everything else is green.'), href: '/settings/channels', cta: t('Voir', 'See') },
      ];
      setSteps(out); setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [locations, t]);
  useEffect(() => { if (can('admin')) load(); }, [load, can]);

  if (!can('admin')) return <div><SettingsHead title={t('Mise en service', 'Go-live')} /><Banner tone="info">{t('Réservé au propriétaire.', 'Owner only.')}</Banner></div>;
  const done = steps?.filter((s) => s.state === 'done').length ?? 0;
  const total = steps?.length ?? 1;
  const groups = steps ? [...new Set(steps.map((s) => s.group))] : [];

  return (
    <div>
      <SettingsHead title={t('Mise en service', 'Go-live')} intro={t('Ce qui reste avant d’ouvrir les vannes. Chaque ligne se vérifie toute seule ; les clés se mettent avec npm run setup ou dans l’hébergeur, jamais dans le clavardage.', 'What is left before switching everything on. Each line checks itself; keys go in with npm run setup or the hosting settings, never in chat.')}
        right={<Button variant="outline" loading={busy} onClick={load} icon={<RefreshCw className="size-4" />}>{t('Revérifier', 'Re-check')}</Button>} />
      <div className="max-w-4xl">
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {steps && (
        <Card className="mb-5 p-5">
          <div className="flex items-end justify-between gap-3">
            <div><div className="text-3xl font-extrabold text-ink num">{done}/{total}</div><div className="text-[13px] text-ink-3">{t('étapes prêtes', 'steps ready')}</div></div>
            <div className="text-right text-[13px] text-ink-3">{steps.filter((s) => s.state === 'todo').length} {t('à faire', 'to do')} · {steps.filter((s) => s.state === 'warn').length} {t('optionnelles', 'optional')}</div>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-go transition-all" style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>
        </Card>
      )}
      {!steps && !err && <div className="h-96 animate-pulse rounded-lg bg-sunken" />}
      {groups.map((g) => (
        <div key={g} className="mb-5">
          <div className="mb-2 text-xs font-bold tracking-wide text-ink-3 uppercase">{g}</div>
          <Card>
            <ul className="divide-y divide-line">
              {steps!.filter((s) => s.group === g).map((s) => (
                <li key={s.key} className="flex items-start gap-3 px-5 py-3.5">
                  {s.state === 'done' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-go" /> : s.state === 'warn' ? <TriangleAlert className="mt-0.5 size-5 shrink-0 text-wait" /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-ink-4" />}
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-sm font-bold', s.state === 'done' ? 'text-ink-2' : 'text-ink')}>{s.title}</div>
                    <div className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{s.body}</div>
                  </div>
                  {s.state !== 'done' && <Link href={s.href} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-bold text-ink hover:bg-sunken">{s.cta}<ChevronRight className="size-4" /></Link>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ))}
      </div>
    </div>
  );
}
