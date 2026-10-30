'use client';

// Business → Brands → "Couleur et logo": one brand's kit (docs/BRAND_KIT.md). Live preview on the white console and on
// the dark kitchen screen, the text colour picked for the accent (black or white, WCAG AA 4.5:1), a warning when the
// colour is too light to be seen on white, and one when it looks like a status colour (green, amber, red). The server
// checks everything again (lib/foodhub/brand-kit.ts).
import { useId, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { ACCENT_RE, accentReport, brandKitOf, brandVars, parseLogo, type BrandKit, type StatusTone } from '@/lib/foodhub/brand-kit';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

export type BrandRecord = { name: string; active: boolean; accent?: string | null; logo?: string | null };

const ratio = (n: number) => `${n.toFixed(1).replace('.', ',')}:1`;

export function BrandKitDialog({ brand, onClose, onSaved }: { brand: BrandRecord; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = useI18n();
  const [accent, setAccent] = useState(brand.accent ?? '');
  const [logo, setLogo] = useState(brand.logo ?? '');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const accentOk = !accent.trim() || ACCENT_RE.test(accent.trim());
  const logoCheck = parseLogo(logo);
  const kit: BrandKit | null = brandKitOf({ accent: accentOk ? accent.trim() : null, logo: logoCheck.ok ? logoCheck.value : null });
  const report = kit?.accent ? accentReport(kit.accent) : null;
  const num = (n: number) => (lang === 'fr' ? ratio(n) : `${n.toFixed(1)}:1`);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/foodhub/media', { method: 'POST', body: fd, cache: 'no-store' });
      const body = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as { ok?: boolean; name?: string; error?: string };
      if (!res.ok || !body.ok || !body.name) throw new Error(body.error || `HTTP ${res.status}`);
      // Served by Food Hub itself (app/media/[name]); stored as a path so it works on any address of this server.
      setLogo(`/media/${body.name}`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setUploading(false); }
  }

  async function save() {
    setBusy(true); setErr('');
    try {
      await api('/api/foodhub/catalog', { method: 'POST', json: { brand: { name: brand.name, active: brand.active, accent: accent.trim() || null, logo: logo.trim() || null } } });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <Modal title={t(`Couleur et logo : ${brand.name}`, `Colour and logo: ${brand.name}`)} size="lg" onClose={onClose}
      subtitle={t('Montrés sur les cartes de commande, la fenêtre de nouvelle commande, l’en-tête du menu et l’accueil.', 'Shown on order cards, the new-order pop-up, the menu header and the overview.')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button loading={busy} disabled={!accentOk || !logoCheck.ok || uploading} onClick={save}>{t('Enregistrer', 'Save')}</Button></>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid content-start gap-4">
          <AccentField value={accent} ok={accentOk} pickerValue={kit?.accent ?? '#1565d8'} onChange={setAccent} />
          <Field label={t('Logo', 'Logo')} error={logoCheck.ok ? undefined : t('Collez une adresse https:// ou téléversez un fichier.', 'Paste an https:// address or upload a file.')}
            hint={t('Votre vrai logo (jamais une image générée par IA). PNG, JPG ou WebP, 5 Mo au plus. Un fichier téléversé est servi par Food Hub.', 'Your real logo (never an AI-generated image). PNG, JPG or WebP, 5 MB at most. An uploaded file is served by Food Hub.')}>
            <Input value={logo} invalid={!logoCheck.ok} maxLength={500} spellCheck={false} inputMode="url" placeholder="https://…/logo.png" onChange={(e) => setLogo(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <label className={cn('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-line-2 bg-surface px-3 text-small font-semibold text-ink hover:bg-sunken', uploading && 'pointer-events-none opacity-60')}>
              <ImageUp className="size-4" aria-hidden />{uploading ? t('Envoi…', 'Uploading…') : t('Téléverser un fichier', 'Upload a file')}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {logo && <Button size="sm" variant="ghost" onClick={() => setLogo('')}>{t('Retirer le logo', 'Remove the logo')}</Button>}
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div className="text-small font-semibold text-ink-2">{t('Aperçu', 'Preview')}</div>
          <Preview name={brand.name} kit={kit} label={t('Console', 'Console')} />
          <div className="theme-kitchen rounded-md bg-canvas p-2 text-ink"><Preview name={brand.name} kit={kit} label={t('Écran cuisine', 'Kitchen screen')} /></div>
          {report && (
            <p className="text-small text-ink-3">
              {t(`Texte sur la couleur : ${report.onAccent === '#ffffff' ? 'blanc' : 'noir'}, contraste ${num(report.textContrast)}`, `Text on the colour: ${report.onAccent === '#ffffff' ? 'white' : 'black'}, contrast ${num(report.textContrast)}`)}
              {report.textPasses ? t(' (WCAG AA ✓).', ' (WCAG AA ✓).') : t(' (sous AA).', ' (below AA).')}
            </p>
          )}
          {report?.tooLightOnWhite && <Banner tone="warn">{t(`Couleur trop pâle sur fond blanc (${num(report.onWhite)}) : la bande et le badge se verront mal dans la console. Choisissez une teinte plus foncée.`, `Colour too light on white (${num(report.onWhite)}): the stripe and the badge will be hard to see in the console. Pick a darker shade.`)}</Banner>}
          {report?.looksLikeStatus && <StatusWarning tone={report.looksLikeStatus} />}
          {report?.tooDarkOnKitchen &&<Banner tone="info">{t(`Sur l’écran sombre de la cuisine, cette couleur se voit peu (${num(report.onKitchen)}). Le nom de la marque reste lisible.`, `On the dark kitchen screen this colour shows little (${num(report.onKitchen)}). The brand name stays readable.`)}</Banner>}
          {!kit && <p className="text-small text-ink-3">{t('Sans couleur ni logo, la marque garde son look actuel partout.', 'With no colour and no logo, the brand keeps its current look everywhere.')}</p>}
        </div>
      </div>
      {err && <Banner tone="stop" className="mt-4">{err}</Banner>}
    </Modal>
  );
}

/**
 * The colour field. The visible label names the typed #RRGGBB box (htmlFor), and the hint or the error is tied to it
 * (aria-describedby); the colour picker beside it keeps its own name. Clicking the label goes to the typed box.
 */
export function AccentField({ value, ok, pickerValue, onChange }: { value: string; ok: boolean; pickerValue: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-semibold text-ink-2">{t('Couleur de la marque', 'Brand colour')}</label>
      <span className="flex items-center gap-2">
        <input type="color" aria-label={t('Choisir la couleur', 'Pick the colour')} value={pickerValue} onChange={(e) => onChange(e.target.value)} className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-surface p-1" />
        <Input id={id} aria-describedby={msgId} value={value} invalid={!ok} maxLength={7} spellCheck={false} autoComplete="off" placeholder="#1565D8" onChange={(e) => onChange(e.target.value)} className="font-mono" />
        {value && <Button size="sm" variant="ghost" onClick={() => onChange('')}>{t('Retirer', 'Remove')}</Button>}
      </span>
      {ok
        ? <span id={msgId} className="text-small text-ink-3">{t('Vide = pas de couleur : la marque garde son look actuel.', 'Empty = no colour: the brand keeps its current look.')}</span>
        : <span id={msgId} className="text-small font-medium text-stop" role="alert">{t('Écrivez la couleur sous la forme #RRGGBB (ex. #1565D8).', 'Write the colour as #RRGGBB (e.g. #1565D8).')}</span>}
    </div>
  );
}

/** The colour is close to a status colour: say which one and what it means on the cards. Saving stays allowed. */
export function StatusWarning({ tone }: { tone: StatusTone }) {
  const { t } = useI18n();
  const text = {
    stop: t('Cette couleur ressemble au rouge qui signale une commande en retard ou un problème : la bande pourrait faire croire qu’une commande est en retard. Choisissez une autre teinte si votre marque le permet.', 'This colour looks like the red that marks a late order or a problem: the stripe could make an order look late. Pick another shade if your brand allows it.'),
    wait: t('Cette couleur ressemble au jaune ambré qui signale une commande qui attend ou à vérifier : la bande pourrait se lire comme un statut. Choisissez une autre teinte si votre marque le permet.', 'This colour looks like the amber that marks an order waiting or to check: the stripe could be read as a status. Pick another shade if your brand allows it.'),
    go: t('Cette couleur ressemble au vert qui signale une commande acceptée ou prête : la bande pourrait se lire comme un statut. Choisissez une autre teinte si votre marque le permet.', 'This colour looks like the green that marks an accepted or ready order: the stripe could be read as a status. Pick another shade if your brand allows it.'),
  }[tone];
  return <Banner tone="warn">{text}</Banner>;
}

/** A small order card as the board shows it: stripe in the accent, the brand's mark, its name on a badge. */
function Preview({ name, kit, label }: { name: string; kit: BrandKit | null; label: string }) {
  return (
    <div style={brandVars(kit)} className={cn('rounded-md border border-line bg-surface p-3 shadow-card', kit?.accent && 'brand-stripe')}>
      <div className="mb-2 text-micro font-semibold text-ink-3">{label}</div>
      <div className="flex items-center gap-2.5">
        <BrandMark name={name} kit={kit} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 font-extrabold text-ink"><span>#1042</span><span className="truncate text-small font-semibold text-ink-3">{name}</span></div>
          <div className="text-small text-ink-3">2× Poutine · 1× Frites</div>
        </div>
        {kit?.accent && <span className="shrink-0 rounded-sm bg-(--brand-accent) px-2 py-0.5 text-micro font-bold text-(--brand-on-accent)">{name.slice(0, 14)}</span>}
      </div>
    </div>
  );
}
