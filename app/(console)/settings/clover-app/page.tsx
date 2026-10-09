'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, CheckCircle2, CircleDashed, ClipboardList, Copy, ExternalLink, FileText, Hourglass, KeyRound, Link2, RefreshCw, ShieldCheck, Store, TriangleAlert, Video } from 'lucide-react';
import { Banner } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/tabs';
import { useViewer } from '@/components/shell/viewer';
import { SettingsHead, Section } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { PUBLIC_URL_PROBLEM_TEXT, type PublicUrlProblem } from '@/lib/foodhub/public-url';
import {
  functionalDescription, LISTING_APP_NAME, LISTING_BENEFITS, LISTING_CATEGORIES, LISTING_DESCRIPTION, LISTING_PERMISSIONS, LISTING_TAGLINE,
} from '@/lib/foodhub/clover-listing';

type Merchant = { merchantId: string; name: string | null; status: 'active' | 'pending'; billing: { status: string | null; inTrial: boolean } | null };
type AppInfo = {
  configured: boolean; appId: string | null; missing: string[]; siteUrl: string; launchPath: string; redirectUri: string; webhookUrl: string; sandbox: boolean;
  domain: { url: string; ready: boolean; problems: PublicUrlProblem[] };
  legal: { privacy: string; terms: string; support: string };
  supportEmail: string | null;
  legalStatus: { supportEmailSet: boolean; supportPhoneSet: boolean; approved: boolean };
  merchants: Merchant[];
};
type ChannelsData = { clover: { webhookAuthSet?: boolean; verification?: { code: string } | null; app?: AppInfo } };
type ReadyCheck = { ok: boolean; title: string; body: string; href?: string };

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
      body: app.configured ? `App ID ${app.appId}` : t(`Manque : ${app.missing.join(', ')} — npm run setup sur le serveur.`, `Missing: ${app.missing.join(', ')} — npm run setup on the server.`) },
    { ok: Boolean(data?.clover.webhookAuthSet && data?.clover.verification), title: t('Webhook Clover vérifié', 'Clover webhook verified'),
      body: t('Événements Inventaire et App ; code de vérification recollé ; CLOVER_WEBHOOK_AUTH défini.', 'Inventory and App events; verification code pasted back; CLOVER_WEBHOOK_AUTH set.'), href: '/settings/channels' },
    { ok: app.legalStatus.supportEmailSet && app.legalStatus.supportPhoneSet, title: t('Courriel et téléphone de soutien', 'Support email and phone'),
      body: t('FOODHUB_SUPPORT_EMAIL et FOODHUB_SUPPORT_PHONE (Clover exige les deux). Optionnel : FOODHUB_SUPPORT_HOURS.', 'FOODHUB_SUPPORT_EMAIL and FOODHUB_SUPPORT_PHONE (Clover requires both). Optional: FOODHUB_SUPPORT_HOURS.'), href: app.legal.support },
    { ok: app.legalStatus.approved, title: t('Pages légales relues et approuvées', 'Legal pages reviewed and approved'),
      body: t('Relisez confidentialité et conditions (avec un conseiller), puis FOODHUB_LEGAL_APPROVED=true : la bannière « projet » disparaît.', 'Review privacy and terms (with an adviser), then FOODHUB_LEGAL_APPROVED=true: the “draft” banner goes away.'), href: app.legal.privacy },
    { ok: app.merchants.some((m) => m.status === 'active'), title: t('Testé de bout en bout sur un marchand', 'Tested end to end on a merchant'),
      body: t('Ouvrez l’app depuis Clover sur votre marchand, puis « Envoyer une commande test » sur la page d’accueil.', 'Open the app from Clover on your merchant, then “Send a test order” on the welcome page.') },
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
                  <li key={c.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    {c.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-go" /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-wait-2" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{c.title}</div>
                      <div className="text-[13px] break-words text-ink-3">{c.body}</div>
                    </div>
                    {c.href && <a href={c.href} className="shrink-0 text-[13px] font-semibold text-ink-2 underline-offset-4 hover:underline">{t('Voir', 'See')}</a>}
                  </li>
                ))}
              </ul>
            </Section>

            <Section icon={<Store className="size-5" />} title={t('À faire dans le tableau de bord Clover (vous)', 'To do in the Clover dashboard (you)')}
              subtitle={t('Food Hub ne touche jamais à votre compte Clover : ces étapes sont les vôtres.', 'Food Hub never touches your Clover account: these steps are yours.')}>
              <ol className="list-decimal space-y-2 pl-5 text-[14px] text-ink-2 marker:font-bold marker:text-ink-3">
                <li>{t('App Settings → REST Configuration : Site URL, Alternate Launch Path et Default OAuth Response = CODE (adresses ci-dessous).', 'App Settings → REST Configuration: Site URL, Alternate Launch Path and Default OAuth Response = CODE (addresses below).')}</li>
                <li>{t('Webhooks : l’adresse ci-dessous, événements Inventory et App, puis recollez le code de vérification affiché dans Plateformes et Clover.', 'Webhooks: the address below, Inventory and App events, then paste back the verification code shown in Platforms & Clover.')}</li>
                <li>{t('Permissions : collez chaque justification (section Permissions plus bas).', 'Permissions: paste each justification (Permissions section below).')}</li>
                <li>{t('App Market Listing : onglets Français (Canada), English (Canada) et English (US) — slogan, avantages, description, icône, captures, URL EULA et confidentialité, catégories.', 'App Market Listing: French (Canada), English (Canada) and English (US) tabs — tagline, benefits, description, icon, screenshots, EULA and privacy URLs, categories.')}</li>
                <li>{t('Developer Support : courriel, téléphone, site de soutien et heures.', 'Developer Support: email, phone, support website and hours.')}</li>
                <li>{t('Pricing : forfait gratuit (0,00 $) au Canada et aux États-Unis.', 'Pricing: free plan ($0.00) in Canada and the United States.')}</li>
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
      <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-md bg-sunken px-2 py-1.5 font-mono text-xs text-ink" title={value}>{value}</code><CopyButton text={value} /></div>
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
