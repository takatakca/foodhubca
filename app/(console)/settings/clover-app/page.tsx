'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, CheckCircle2, CircleAlert, CircleDashed, ClipboardList, Copy, ExternalLink, FileText, Hourglass, KeyRound, LayoutGrid, Link2, Printer, Receipt, RefreshCw, ShieldCheck, Store, Tags, TriangleAlert, Video, X } from 'lucide-react';
import { Banner } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { TechDetails } from '../tech-details';
import { Select } from '@/components/ui/form';
import { Segmented } from '@/components/ui/tabs';
import { useViewer } from '@/components/shell/viewer';
import { SettingsHead, Section } from '../settings-ui';
import { CloverBillingSection } from './billing-section';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { PUBLIC_URL_PROBLEM_TEXT, type PublicUrlProblem } from '@/lib/foodhub/public-url';
import {
  functionalDescription, LISTING_APP_NAME, LISTING_BENEFITS, LISTING_CATEGORIES, LISTING_DESCRIPTION, LISTING_PERMISSIONS, LISTING_TAGLINE,
} from '@/lib/foodhub/clover-listing';
import { PRICING_STATEMENT } from '@/lib/foodhub/pos/clover-pricing';

type Merchant = { merchantId: string; name: string | null; status: 'active' | 'pending'; billing: { status: string | null; inTrial: boolean } | null };
type AppInfo = {
  configured: boolean; appId: string | null; missing: string[]; siteUrl: string; launchPath: string; redirectUri: string; webhookUrl: string; sandbox: boolean;
  domain: { url: string; ready: boolean; problems: PublicUrlProblem[] };
  legal: { privacy: string; terms: string; support: string };
  supportEmail: string | null;
  legalStatus: { supportEmailSet: boolean; supportPhoneSet: boolean; approved: boolean };
  merchants: Merchant[];
  /** Last test order that went through every step (created, printed, paid). */
  testOrder?: { merchantId: string; posOrderId: string; at: string } | null;
};
type MinutesSummary = {
  month: string; calls: number; aiMinutes: number; wouldBillMinutes: number; reportedMinutes: number; pendingMinutes: number;
  uncertainMinutes: number; uncertainCalls: number; failedMinutes: number; noMeteredIdMinutes?: number; noMeteredIdCalls?: number; notBilledMinutes: number; estimateCad: number;
};
type PhoneMetering = {
  enabled: boolean; meteredIdSet: boolean; env: { enabled: string; meteredId: string; exempt: string };
  price: { monthlyCad: number; perMinuteCad: number; trialDays: number }; month: string; total: MinutesSummary;
};
type CloverAppStatus = {
  key: 'foodhub' | 'phone'; name: string; appId: string | null; configured: boolean; enabled: boolean; missing: string[];
  env: { appId: string; secret: string; webhookAuth: string };
  connectUrl: string; launchPath: string; webhookUrl: string; events: Array<'app' | 'inventory' | 'orders'>;
  webhookAuthSet: boolean; verification: { code: string; at: string } | null;
  installs: Array<{ merchantId: string; name: string | null; status: 'active' | 'pending'; billing: { status: string | null; inTrial: boolean; plan: string | null } | null; bothApps: boolean; minutes?: MinutesSummary | null }>;
  metering?: PhoneMetering;
};
type ChannelsData = { clover: { webhookAuthSet?: boolean; verification?: { code: string } | null; tokenMerchantIds?: string[]; app?: AppInfo; apps?: CloverAppStatus[] } };
/** `tech`: the setting names for the technician, folded under « Détails techniques » so the headline stays plain. */
type ReadyCheck = { ok: boolean; title: string; body: string; href?: string; tech?: string };

// Settings → Clover app: everything the owner needs to finish the Clover App Market listing and press Submit.
// The checks are computed from the real configuration; the texts come from lib/foodhub/clover-listing.ts.
export default function CloverAppPage() {
  const { t } = useI18n();
  const { can } = useViewer();
  const [data, setData] = useState<ChannelsData | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<'fr' | 'en'>('fr');

  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api<ChannelsData>('/api/foodhub/channels')); setErr(''); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, []);
  useEffect(() => { if (can('admin')) load(); }, [load, can]);

  const title = t('Application Clover', 'Clover app');
  if (!can('admin')) return <div><SettingsHead title={title} /><Banner tone="info">{t('Réservé au propriétaire.', 'Owner only.')}</Banner></div>;
  const app = data?.clover.app;

  const checks: ReadyCheck[] = app ? [
    { ok: app.domain.ready, title: t('Votre propre domaine en HTTPS', 'Your own domain over HTTPS'),
      body: app.domain.ready ? app.domain.url : app.domain.problems.map((p) => t(PUBLIC_URL_PROBLEM_TEXT[p].fr, PUBLIC_URL_PROBLEM_TEXT[p].en)).join(' ') },
    { ok: app.configured, title: t('Clés de l’app (App ID et secret)', 'App keys (App ID and secret)'),
      body: app.configured ? `App ID ${app.appId}` : t('Les clés de l’app ne sont pas encore sur le serveur : votre technicien les ajoute.', 'The app keys are not on the server yet: your technician adds them.'),
      tech: app.configured ? undefined : t(`Manque : ${app.missing.join(', ')}. Commande : npm run setup sur le serveur.`, `Missing: ${app.missing.join(', ')}. Command: npm run setup on the server.`) },
    { ok: Boolean(data?.clover.webhookAuthSet && data?.clover.verification), title: t('Webhook Clover vérifié', 'Clover webhook verified'),
      body: t('Clover prévient Food Hub des changements d’inventaire et d’installation, et le code de vérification est recollé.', 'Clover tells Food Hub about inventory and install changes, and the verification code is pasted back.'), href: '/settings/channels',
      tech: t('Événements Inventory et App ; réglage CLOVER_WEBHOOK_AUTH défini.', 'Inventory and App events; CLOVER_WEBHOOK_AUTH setting defined.') },
    { ok: app.legalStatus.supportEmailSet && app.legalStatus.supportPhoneSet, title: t('Courriel et téléphone de soutien', 'Support email and phone'),
      body: t('Clover exige un courriel et un téléphone de soutien sur la page de soutien.', 'Clover requires a support email and phone on the support page.'), href: app.legal.support,
      tech: t('FOODHUB_SUPPORT_EMAIL et FOODHUB_SUPPORT_PHONE. Optionnel : FOODHUB_SUPPORT_HOURS.', 'FOODHUB_SUPPORT_EMAIL and FOODHUB_SUPPORT_PHONE. Optional: FOODHUB_SUPPORT_HOURS.') },
    { ok: app.legalStatus.approved, title: t('Pages légales relues et approuvées', 'Legal pages reviewed and approved'),
      body: t('Relisez la confidentialité et les conditions (avec un conseiller) ; une fois approuvées, la bannière « projet » disparaît.', 'Review privacy and terms (with an adviser); once approved, the “draft” banner goes away.'), href: app.legal.privacy,
      tech: 'FOODHUB_LEGAL_APPROVED=true' },
    { ok: Boolean(app.testOrder), title: t('Testé de bout en bout sur une caisse', 'Tested end to end on a register'),
      body: app.testOrder
        ? t(`Commande test créée, imprimée et payée sur ${app.testOrder.merchantId} (Clover ${app.testOrder.posOrderId}), le ${new Date(app.testOrder.at).toLocaleString('fr-CA')}.`, `Test order created, printed and paid on ${app.testOrder.merchantId} (Clover ${app.testOrder.posOrderId}), ${new Date(app.testOrder.at).toLocaleString('en-CA')}.`)
        : t('Bouton « Envoyer une commande test » ci-dessous (caisse branchée par jeton API ou par l’app).', '“Send a test order” button below (register connected with an API token or through the app).') },
  ] : [];
  const ready = checks.filter((c) => c.ok).length;
  const pending = app?.merchants.filter((m) => m.status === 'pending') ?? [];

  return (
    <div>
      <SettingsHead title={title}
        intro={t('Tout pour terminer la fiche du Clover App Market et appuyer sur « Submit ». Les vérifications se font seules ; les textes se copient en un clic.', 'Everything to finish the Clover App Market listing and press “Submit”. Checks run by themselves; texts copy in one click.')}
        right={<Button variant="outline" loading={busy} onClick={load} icon={<RefreshCw className="size-4" />}>{t('Revérifier', 'Re-check')}</Button>} />
      <div className="max-w-4xl">
        {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
        {!data && !err && <div className="h-96 animate-pulse rounded-lg bg-sunken" />}
        {app && (
          <>
            {app.sandbox && <Banner tone="info" className="mb-4">{t('Environnement sandbox de Clover (CLOVER_BASE_URL) : parfait pour tester, mais la soumission se fait avec l’app de production.', 'Clover sandbox environment (CLOVER_BASE_URL): fine for testing, but you submit the production app.')}</Banner>}
            {pending.length > 0 && (
              <Banner tone="warn" className="mb-4" action={<Link href="/settings/channels" className="text-sm font-bold underline">{t('Approuver', 'Approve')}</Link>}>
                {t(`${pending.length} marchand(s) Clover attendent votre approbation : ${pending.map((m) => m.name || m.merchantId).join(', ')}. Pendant la révision de Clover, approuvez le marchand de test du réviseur.`, `${pending.length} Clover merchant(s) waiting for your approval: ${pending.map((m) => m.name || m.merchantId).join(', ')}. During Clover’s review, approve the reviewer’s test merchant.`)}
              </Banner>
            )}

            <Section icon={<ClipboardList className="size-5" />} title={t('Prêt à soumettre ?', 'Ready to submit?')}
              subtitle={t('Vérifié à partir de la configuration du serveur.', 'Checked from the server configuration.')}
              right={<Badge tone={ready === checks.length ? 'go' : 'wait'}>{ready}/{checks.length}</Badge>}>
              <ul className="divide-y divide-line">
                {checks.map((c) => (
                  <li key={c.title} className="flex flex-wrap items-start gap-3 py-4 first:pt-0 last:pb-0 sm:flex-nowrap">
                    {c.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-go" aria-hidden /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-wait-2" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="text-body font-bold">{c.title}</span><Badge tone={c.ok ? 'go' : 'wait'}>{c.ok ? t('Prêt', 'Ready') : t('À faire', 'To do')}</Badge></div>
                      <div className="text-small mt-0.5 break-words text-ink-3">{c.body}</div>
                      {c.tech && <TechDetails>{c.tech}</TechDetails>}
                    </div>
                    {c.href && <a href={c.href} className={buttonClass('outline', 'md', 'ml-8 shrink-0 sm:ml-0')}>{t('Voir', 'See')}</a>}
                  </li>
                ))}
              </ul>
            </Section>

            {/* Only once a second app is set on this server (CLOVER_PHONE_APP_ID): without it the page is unchanged. */}
            {(data?.clover.apps ?? []).filter((a) => a.enabled).length > 1 && <CloverAppsSection apps={(data?.clover.apps ?? []).filter((a) => a.enabled)} isAdmin={can('admin')} onDone={load} />}

            <CloverBillingSection />

            <OwnerTestOrder merchants={[...new Set([...(data?.clover.tokenMerchantIds ?? []), ...app.merchants.filter((m) => m.status === 'active').map((m) => m.merchantId)])]} onDone={load} />

            <Section icon={<Store className="size-5" />} title={t('À faire dans le tableau de bord Clover (vous)', 'To do in the Clover dashboard (you)')}
              subtitle={t('Food Hub ne touche jamais à votre compte Clover : ces étapes sont les vôtres.', 'Food Hub never touches your Clover account: these steps are yours.')}>
              <ol className="list-decimal space-y-2 pl-5 text-[14px] text-ink-2 marker:font-bold marker:text-ink-3">
                <li>{t('App Settings → REST Configuration : Site URL, Alternate Launch Path et Default OAuth Response = CODE (adresses ci-dessous).', 'App Settings → REST Configuration: Site URL, Alternate Launch Path and Default OAuth Response = CODE (addresses below).')}</li>
                <li>{t('Webhooks : l’adresse ci-dessous, événements Inventory et App, puis recollez le code de vérification affiché dans Plateformes et Clover.', 'Webhooks: the address below, Inventory and App events, then paste back the verification code shown in Platforms & Clover.')}</li>
                <li>{t('Permissions : collez chaque justification (section Permissions plus bas).', 'Permissions: paste each justification (Permissions section below).')}</li>
                <li>{t('App Market Listing : onglets Français (Canada), English (Canada) et English (US) — slogan, avantages, description, icône, captures, URL EULA et confidentialité, catégories.', 'App Market Listing: French (Canada), English (Canada) and English (US) tabs — tagline, benefits, description, icon, screenshots, EULA and privacy URLs, categories.')}</li>
                <li>{t('Developer Support : courriel, téléphone, site de soutien et heures.', 'Developer Support: email, phone, support website and hours.')}</li>
                <li>{t(`Pricing : forfait « Standard » 50 $/mois au Canada avec essai de 14 jours, et l’événement mesuré « Extra brand, per platform, per month » à 15 $. ${PRICING_STATEMENT.fr}`, `Pricing: “Standard” tier $50/month in Canada with a 14-day trial, and the metered event “Extra brand, per platform, per month” at $15. ${PRICING_STATEMENT.en}`)}</li>
                <li><span className="inline-flex items-center gap-1 font-semibold text-ink"><Video className="size-4" />{t('Overview : description fonctionnelle (ci-dessous) et lien de la vidéo fonctionnelle (YouTube ou Vimeo, non répertoriée).', 'Overview: functional description (below) and the functional video link (YouTube or Vimeo, unlisted).')}</span></li>
                <li>{t('Submit App → liste de contrôle → Submit for Approval. Répondez vite aux questions de Clover.', 'Submit App → checklist → Submit for Approval. Answer Clover’s questions quickly.')}</li>
              </ol>
              <p className="mt-3 flex items-start gap-2 rounded-md bg-wait-soft px-3 py-2 text-[13px] text-ink">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-wait-2" />
                {t('Canada : Clover indique que les applications de restaurant doivent être certifiées pour le module d’enregistrement des ventes (SRM) de Revenu Québec. Confirmez avec Clover (developer-relations@devrel.clover.com) avant de choisir les catégories « restaurant ».', 'Canada: Clover says restaurant apps must be certified for Revenu Québec’s sales recording module (SRM). Confirm with Clover (developer-relations@devrel.clover.com) before choosing the “restaurant” categories.')}
              </p>
            </Section>

            <Section icon={<Link2 className="size-5" />} title={t('Adresses à coller dans Clover', 'Addresses to paste in Clover')}
              subtitle={t('Construites à partir de FOODHUB_PUBLIC_URL : changez le domaine, elles suivent.', 'Built from FOODHUB_PUBLIC_URL: change the domain and they follow.')}>
              <CopyRow label="Site URL" value={app.siteUrl} />
              <CopyRow label="Alternate Launch Path" value={app.launchPath} />
              <CopyRow label={t('Webhook URL', 'Webhook URL')} value={app.webhookUrl} />
              <CopyRow label={t('Politique de confidentialité', 'Privacy policy URL')} value={app.legal.privacy} />
              <CopyRow label={t('EULA (conditions d’utilisation)', 'EULA (terms of use) URL')} value={app.legal.terms} />
              <CopyRow label={t('Site de soutien', 'Support website')} value={app.legal.support} />
            </Section>

            <Section icon={<FileText className="size-5" />} title={t('Textes de la fiche', 'Listing texts')}
              subtitle={t('Limites de Clover respectées : slogan ≤ 255 caractères, 3 à 5 avantages de ≤ 100 caractères.', 'Within Clover’s limits: tagline ≤ 255 characters, 3 to 5 benefits of ≤ 100 characters.')}
              right={<Segmented size="sm" value={lang} onChange={setLang} options={[{ key: 'fr', label: 'Français' }, { key: 'en', label: 'English' }]} />}>
              <CopyBlock label={t('Nom de l’application', 'App name')} text={LISTING_APP_NAME} />
              <CopyBlock label={t('Slogan', 'Tagline')} text={LISTING_TAGLINE[lang]} count />
              {LISTING_BENEFITS.map((b, i) => <CopyBlock key={i} label={`${t('Avantage', 'Benefit')} ${i + 1}`} text={b[lang]} count />)}
              <CopyBlock label={t('Description', 'Description')} text={LISTING_DESCRIPTION[lang]} tall />
              <CopyBlock label={t('Description fonctionnelle (Overview)', 'Functional description (Overview)')} text={functionalDescription(lang, app.supportEmail ?? undefined)} tall />
              <div className="mt-4 text-[13px] text-ink-2">
                <span className="font-bold text-ink">{t('Catégories', 'Categories')} : </span>
                {t('fonctionnelles', 'functional')} — {LISTING_CATEGORIES.functional.join(', ')} · {t('verticales', 'vertical')} — {LISTING_CATEGORIES.vertical.join(', ')}
              </div>
            </Section>

            <Section icon={<KeyRound className="size-5" />} title={t('Permissions et justifications', 'Permissions and justifications')}
              subtitle={t('Le strict nécessaire : Clover vérifie que chaque justification correspond à ce que fait l’app.', 'Only what is needed: Clover checks each justification against what the app does.')}>
              {LISTING_PERMISSIONS.map((p) => <CopyBlock key={p.name} label={`${p.name} — ${p.access}`} text={p.why[lang]} />)}
            </Section>

            <Section icon={<ShieldCheck className="size-5" />} title={t('Marchands branchés par l’app', 'Merchants connected through the app')}>
              {app.merchants.length === 0
                ? <p className="text-[14px] text-ink-3">{t('Aucun pour l’instant.', 'None yet.')}</p>
                : (
                  <ul className="divide-y divide-line">
                    {app.merchants.map((m) => (
                      <li key={m.merchantId} className="flex flex-wrap items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1"><div className="font-semibold">{m.name || m.merchantId}</div><div className="num text-[12px] text-ink-3">{m.merchantId}</div></div>
                        {m.billing?.status && <Badge tone={m.billing.status === 'ACTIVE' ? 'go' : 'wait'}>{m.billing.status.toLowerCase()}{m.billing.inTrial ? ` · ${t('essai', 'trial')}` : ''}</Badge>}
                        {m.status === 'pending' ? <Badge tone="wait" icon={<Hourglass className="size-3" />}>{t('En attente', 'Waiting')}</Badge> : <Badge tone="go" icon={<Check className="size-3" />}>{t('Approuvé', 'Approved')}</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
              <p className="mt-3 text-[13px] text-ink-3"><Link href="/settings/channels" className="font-semibold underline-offset-4 hover:underline">{t('Approuver, refuser ou débrancher dans Plateformes et Clover', 'Approve, decline or disconnect in Platforms & Clover')}<ExternalLink className="ml-1 inline size-3.5" /></Link></p>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Every Clover app this server serves, each sold on its own in the Clover App Market: TAKATAK Food Hub and the AI phone
 * app. Keys set or not (environment variable names only), addresses for the Clover dashboard, webhook state, and which
 * merchants installed each app — a merchant with both apps shares its menu, stores and orders between them.
 */
function CloverAppsSection({ apps, isAdmin, onDone }: { apps: CloverAppStatus[]; isAdmin: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const ev = (e: CloverAppStatus['events'][number]) => ({ app: 'App', inventory: 'Inventory', orders: 'Orders' }[e]);
  // Approve and disconnect are owner-only (admin), like the API; each acts on one app only, never on the other.
  async function send(method: 'POST' | 'DELETE', app: CloverAppStatus['key'], merchantId: string) {
    setBusy(`${method}:${app}:${merchantId}`);
    try {
      await api('/api/foodhub/clover-connect/merchants', { method, body: JSON.stringify({ merchantId, app }) });
      setErr('');
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const approve = (app: CloverAppStatus['key'], merchantId: string) => send('POST', app, merchantId);
  function disconnect(a: CloverAppStatus, merchantId: string) {
    if (!window.confirm(t(`Débrancher le marchand Clover ${merchantId} de ${a.name} ? Ses jetons pour cette application sont supprimés ; l’autre application n’est pas touchée.`, `Disconnect Clover merchant ${merchantId} from ${a.name}? Its tokens for this app are deleted; the other app is not touched.`))) return;
    void send('DELETE', a.key, merchantId);
  }
  return (
    <Section icon={<LayoutGrid className="size-5" />} title={t('Applications Clover de ce serveur', 'Clover apps on this server')}
      subtitle={t('Chaque application est vendue séparément dans le Clover App Market. Un marchand qui a les deux partage son menu, ses magasins et ses commandes.', 'Each app is sold separately in the Clover App Market. A merchant with both shares its menu, stores and orders.')}>
      {err && <Banner tone="stop" className="mb-3">{err}</Banner>}
      <div className="space-y-4">
        {apps.map((a) => (
          <div key={a.key} className="rounded-lg border border-line p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-bold">{a.name}</div>
                <div className="num text-[12px] text-ink-3">{a.appId ? `App ID ${a.appId}` : t('App ID non défini', 'App ID not set')}</div>
              </div>
              {a.configured ? <Badge tone="go" icon={<Check className="size-3" />}>{t('Configurée', 'Set up')}</Badge> : <Badge tone="wait">{t('Non configurée', 'Not set up')}</Badge>}
              <Badge tone={a.installs.length ? 'go' : 'wait'}>{t(`${a.installs.length} installation(s)`, `${a.installs.length} install(s)`)}</Badge>
            </div>
            {!a.configured && (
              <p className="mt-2 text-[13px] text-ink-3">
                {a.key === 'phone'
                  ? t(`Créez l’application dans le tableau de bord Clover, puis ajoutez sur le serveur : ${a.missing.join(', ')} (et ${a.env.webhookAuth}). Guide : docs/CLOVER_MULTI_APP.md. Sans ces variables, rien ne change.`, `Create the app in the Clover dashboard, then add on the server: ${a.missing.join(', ')} (and ${a.env.webhookAuth}). Guide: docs/CLOVER_MULTI_APP.md. Without these variables nothing changes.`)
                  : t(`Manque : ${a.missing.join(', ')} — npm run setup sur le serveur.`, `Missing: ${a.missing.join(', ')} — npm run setup on the server.`)}
              </p>
            )}
            {a.enabled && (
              <div className="mt-3">
                <CopyRow label="Alternate Launch Path" value={a.launchPath} />
                <CopyRow label={t(`Webhook URL — événements : ${a.events.map(ev).join(', ')}`, `Webhook URL — events: ${a.events.map(ev).join(', ')}`)} value={a.webhookUrl} />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
                  {a.webhookAuthSet ? <Badge tone="go">{a.env.webhookAuth}</Badge> : <Badge tone="wait">{t(`${a.env.webhookAuth} manquant`, `${a.env.webhookAuth} missing`)}</Badge>}
                  {a.verification
                    ? <span>{t('Code de vérification reçu :', 'Verification code received:')} <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-xs text-ink">{a.verification.code}</code></span>
                    : <span>{t('Aucun code de vérification reçu pour l’instant.', 'No verification code received yet.')}</span>}
                </div>
              </div>
            )}
            {a.installs.length > 0 && (
              <ul className="mt-3 divide-y divide-line">
                {a.installs.map((m) => (
                  <li key={m.merchantId} className="flex flex-wrap items-center gap-2 py-2">
                    <div className="min-w-0 flex-1"><div className="font-semibold">{m.name || m.merchantId}</div><div className="num text-[12px] text-ink-3">{m.merchantId}</div></div>
                    {m.bothApps && <Badge tone="go">{t('Les deux apps', 'Both apps')}</Badge>}
                    {m.billing?.status && <Badge tone={m.billing.status === 'ACTIVE' ? 'go' : 'wait'}>{m.billing.status.toLowerCase()}{m.billing.inTrial ? ` · ${t('essai', 'trial')}` : ''}{m.billing.plan ? ` · ${m.billing.plan}` : ''}</Badge>}
                    {m.minutes && m.minutes.aiMinutes > 0 && (
                      <Badge tone={m.minutes.uncertainMinutes ? 'wait' : 'go'}>
                        {a.metering?.enabled
                          ? t(`${m.minutes.reportedMinutes} min facturée(s)`, `${m.minutes.reportedMinutes} min billed`)
                          : t(`${m.minutes.wouldBillMinutes} min à facturer (essai à blanc)`, `${m.minutes.wouldBillMinutes} min would bill (dry run)`)}
                      </Badge>
                    )}
                    {m.status === 'pending'
                      ? a.key === 'foodhub' || !isAdmin
                        ? <Badge tone="wait" icon={<Hourglass className="size-3" />}>{t('En attente', 'Waiting')}</Badge>
                        : <Button size="sm" variant="outline" loading={busy === `POST:${a.key}:${m.merchantId}`} onClick={() => approve(a.key, m.merchantId)}>{t('Approuver', 'Approve')}</Button>
                      : <Badge tone="go" icon={<Check className="size-3" />}>{t('Approuvé', 'Approved')}</Badge>}
                    {isAdmin && (
                      <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} loading={busy === `DELETE:${a.key}:${m.merchantId}`} onClick={() => disconnect(a, m.merchantId)}>
                        {t('Débrancher', 'Disconnect')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {a.key === 'phone' && a.metering && <PhoneMinutes m={a.metering} />}
            {a.enabled && a.configured && <p className="mt-3 text-[13px]"><a href={a.connectUrl} className="font-semibold underline-offset-4 hover:underline">{t('Brancher un marchand à cette application', 'Connect a merchant to this app')}<ExternalLink className="ml-1 inline size-3.5" /></a></p>}
          </div>
        ))}
      </div>
    </Section>
  );
}

/** TAKATAK Phone per-minute billing: price, on / dry run, and this month's minutes (what is billed, or would be). */
function PhoneMinutes({ m }: { m: PhoneMetering }) {
  const { t } = useI18n();
  const cad = (n: number) => `${n.toFixed(2)} $`;
  const s = m.total;
  const rows: Array<[string, string]> = [
    [t('Appels terminés', 'Calls ended'), String(s.calls)],
    [t('Minutes de l’IA', 'AI minutes'), String(s.aiMinutes)],
    ...(m.enabled
      ? [[t('Envoyées à Clover', 'Sent to Clover'), `${s.reportedMinutes} min`], [t('En attente', 'Waiting'), `${s.pendingMinutes} min`]] as Array<[string, string]>
      : [[t('Seraient facturées', 'Would be billed'), `${s.wouldBillMinutes} min`]] as Array<[string, string]>),
    [t('Non facturées (essai, nos restaurants, exemptés)', 'Not billed (trial, ours, exempt)'), `${s.notBilledMinutes} min`],
    [t('Estimation du mois', 'Month estimate'), cad(s.estimateCad)],
  ];
  return (
    <div className="mt-4 rounded-lg bg-sunken p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 font-semibold">{t('Facturation à la minute', 'Per-minute billing')} · {m.month}</div>
        {m.enabled ? <Badge tone="go">{t('Activée', 'On')}</Badge> : <Badge tone="wait">{t('Essai à blanc : rien n’est envoyé', 'Dry run: nothing is sent')}</Badge>}
      </div>
      <p className="mt-1 text-[13px] text-ink-3">
        {t(
          `Prix : essai gratuit de ${m.price.trialDays} jours, puis ${cad(m.price.monthlyCad)} CA/mois + ${cad(m.price.perMinuteCad)} CA par minute où l’IA est en ligne (commande ou non). Minutes = durée de l’IA arrondie à la minute supérieure ; l’attente et la personne après un transfert ne comptent pas. Seuls les marchands ACTIFS sont facturés (jamais l’essai, nos restaurants ou ${m.env.exempt}).`,
          `Price: ${m.price.trialDays}-day free trial, then CAD ${cad(m.price.monthlyCad)}/month + CAD ${cad(m.price.perMinuteCad)} per minute the AI is on the line (order or not). Minutes = the AI's time rounded up to the minute; hold and the person after a transfer do not count. Only ACTIVE merchants are billed (never the trial, our restaurants or ${m.env.exempt}).`,
        )}
      </p>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-ink-3">{k}</dt><dd className="num font-semibold">{v}</dd></div>)}
      </dl>
      {s.uncertainCalls > 0 && (
        <Banner tone="warn" className="mt-2">
          {t(`${s.uncertainCalls} appel(s) (${s.uncertainMinutes} min) : la réponse de Clover s’est perdue. Jamais renvoyé : vérifiez l’usage du marchand dans Clover.`, `${s.uncertainCalls} call(s) (${s.uncertainMinutes} min): Clover's answer was lost. Never sent again: check the merchant's usage in Clover.`)}
        </Banner>
      )}
      {(s.noMeteredIdCalls ?? 0) > 0 && (
        <Banner tone="warn" className="mt-2">
          {t(`${s.noMeteredIdCalls} appel(s) (${s.noMeteredIdMinutes ?? 0} min) terminés sans ${m.env.meteredId} : jamais envoyés à Clover, donc non facturés.`, `${s.noMeteredIdCalls} call(s) (${s.noMeteredIdMinutes ?? 0} min) ended without ${m.env.meteredId}: never sent to Clover, so not billed.`)}
        </Banner>
      )}
      {!m.enabled && <p className="mt-2 text-[12px] text-ink-3">{t(`Pour facturer : ${m.env.meteredId} puis ${m.env.enabled}=true sur le serveur.`, `To bill: ${m.env.meteredId}, then ${m.env.enabled}=true on the server.`)}</p>}
      {m.enabled && !m.meteredIdSet && <Banner tone="stop" className="mt-2">{t(`${m.env.meteredId} manquant : aucune minute n’est envoyée.`, `${m.env.meteredId} missing: no minute is sent.`)}</Banner>}
    </div>
  );
}

type TestStep = { key: 'created' | 'printed' | 'paid'; ok: boolean; detail: { fr: string; en: string } };
type TestResult = { ok: boolean; reason?: string; error?: string; steps?: TestStep[] };

/**
 * The owner's Clover check on a real register: a TEST order created in Clover (platform order type), its kitchen ticket
 * printed, then paid for Clover's own total with the platform tender. Works for a register connected with an API token
 * (the group's own register while the App Market app is a draft) or through the app. Never stored in Food Hub.
 */
function OwnerTestOrder({ merchants, onDone }: { merchants: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const [mid, setMid] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TestResult | null>(null);
  const target = mid || merchants[0] || '';
  async function send() {
    if (!target) return;
    setBusy(true);
    try {
      const r = await fetch('/api/foodhub/clover-connect/owner-test-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ merchantId: target }) });
      const j = (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as TestResult;
      setRes(j);
      if (j.ok) onDone();
    } catch (e) {
      setRes({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  }
  const label: Record<TestStep['key'], string> = {
    created: t('Commande créée dans Clover', 'Order created in Clover'),
    printed: t('Billet envoyé à l’imprimante', 'Ticket sent to the printer'),
    paid: t('Payée avec le mode « Uber Eats »', 'Paid with the “Uber Eats” tender'),
  };
  const icon: Record<TestStep['key'], ReactNode> = { created: <Tags className="size-4" />, printed: <Printer className="size-4" />, paid: <Receipt className="size-4" /> };
  const err = res && !res.ok
    ? res.reason === 'not_approved' ? t('Cette caisse n’est pas branchée : ni jeton API, ni marchand approuvé.', 'This register is not connected: no API token and no approved merchant.')
      : res.reason === 'limited' ? t('Trois commandes test par heure au maximum. Réessayez plus tard.', 'Three test orders per hour at most. Try again later.')
        : res.reason === 'clover_refused' ? t('Clover a refusé la commande test (détail ci-dessus).', 'Clover refused the test order (details above).')
          : res.error || t('Échec.', 'Failed.')
    : null;
  return (
    <Section icon={<Receipt className="size-5" />} title={t('Envoyer une commande test à une caisse Clover', 'Send a test order to a Clover register')}
      subtitle={t('Une commande TEST est créée dans la caisse, s’imprime à la cuisine et se ferme payée — comme une vraie commande Uber Eats. Rien n’est envoyé aux plateformes ; trois essais par heure.', 'A TEST order is created in the register, prints in the kitchen and closes as paid — just like a real Uber Eats order. Nothing is sent to the platforms; three tries per hour.')}>
      {merchants.length === 0 ? (
        <p className="text-[14px] text-ink-3">{t('Aucune caisse branchée : collez le jeton API Clover dans CLOVER_ACCESS_TOKEN (avec CLOVER_MERCHANT_ID), ou branchez un marchand par l’app.', 'No register connected: put the Clover API token in CLOVER_ACCESS_TOKEN (with CLOVER_MERCHANT_ID), or connect a merchant through the app.')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {merchants.length > 1 && (
            <Select className="w-64" value={target} onChange={(e) => setMid(e.target.value)} aria-label={t('Caisse Clover', 'Clover register')}>
              {merchants.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          )}
          {merchants.length === 1 && <span className="num rounded-md bg-sunken px-2 py-1.5 font-mono text-xs text-ink">{target}</span>}
          <Button variant="brand" loading={busy} onClick={send} icon={<Receipt className="size-4" />}>{t('Envoyer une commande test', 'Send a test order')}</Button>
        </div>
      )}
      {res?.steps && res.steps.length > 0 && (
        <ul className="mt-4 space-y-1.5" aria-live="polite">
          {res.steps.map((st) => (
            <li key={st.key} className="flex items-start gap-3 rounded-lg bg-raised px-3 py-2">
              <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-white', st.ok ? 'bg-go' : 'bg-stop')}>{st.ok ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[14px] font-bold"><span className="text-ink-3">{icon[st.key]}</span>{label[st.key]}</div>
                <div className="num text-[12px] break-words text-ink-3">{t(st.detail.fr, st.detail.en)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="mt-3 flex items-start gap-2 rounded-lg bg-stop-soft px-3 py-2 text-[13px] text-ink" aria-live="polite"><CircleAlert className="mt-0.5 size-4 shrink-0 text-stop" />{err}</p>}
    </Section>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line-2 bg-surface px-2 text-xs font-semibold text-ink-2 hover:border-ink-4 hover:text-ink">
      {done ? <Check className="size-3.5 text-go-2" /> : <Copy className="size-3.5" />}{done ? t('Copié', 'Copied') : t('Copier', 'Copy')}
    </button>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</div>
      <div className="mt-1 flex min-w-0 items-center gap-2"><code className="text-small min-w-0 flex-1 rounded-md bg-sunken px-2 py-1.5 font-mono break-all text-ink">{value}</code><CopyButton text={value} /></div>
    </div>
  );
}

function CopyBlock({ label, text, count, tall }: { label: ReactNode; text: string; count?: boolean; tall?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 first:mt-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}{count && <span className="num ml-2 font-medium normal-case">{text.length} {t('caractères', 'characters')}</span>}</div>
        <CopyButton text={text} />
      </div>
      <div className={cn('mt-1 rounded-md bg-sunken px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink', tall && 'max-h-72 overflow-y-auto scrollbar-thin')}>{text}</div>
    </div>
  );
}
