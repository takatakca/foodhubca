'use client';

// Avis et notes / Reviews: KPI row, filters, brand × platform table, theme chips, review cards with reply drafts
// (Propose / Copy / Mark as replied), file import with preview, DoorDash feedback report. Food Hub never posts a reply:
// a person copies the draft into the platform's own portal, store by store.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clipboard, FileUp, MessageSquareText, RefreshCw, Sparkles, Star, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader, EmptyState, PageHeader, Stat } from '@/components/ui/card';
import { Checkbox, Chips, Field, Input, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { InsightsTabs } from '../insights-tabs';
import { api, ApiError, dayOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { Review } from '@/lib/foodhub/reviews/model';
import type { ReviewGroup, ReviewStats, TrendWindow } from '@/lib/foodhub/reviews/summary';

type ReviewRow = Review & { daysLeft: number | null; needsReply: boolean };
type ThemeInfo = { key: string; fr: string; en: string; negative: boolean };
type ListResponse = {
  reviews: ReviewRow[]; total: number; summary: { overall: ReviewStats; groups: Array<ReviewGroup & { worst: ReviewRow[] }> }; trend: TrendWindow[];
  brands: string[]; platforms: Array<{ key: string; label: string }>; themes: ThemeInfo[]; aiEnabled: boolean;
};
type ImportPreview = {
  imported: boolean; needsMapping?: boolean; message?: string; messageFr?: string; headers?: string[]; platform?: string; preset?: string | null;
  counts?: { rows: number; new: number; duplicate: number; skipped: number; dropped: number; unmapped: number }; preview?: ReviewRow[]; mapping?: Record<string, number>;
};
type FeedbackReport = { id: string; from: string; to: string; status: string; message: string; messageFr?: string; at: string; rows?: number };

const PLATFORM_FR: Record<string, string> = { other: 'Autre' };
const MAPPING_FIELDS: Array<[string, string, string]> = [['date', 'Date', 'Date'], ['stars', 'Étoiles', 'Stars'], ['text', 'Commentaire', 'Comment'], ['store', 'Magasin / marque', 'Store / brand'], ['storeName', 'Nom du magasin', 'Store name'], ['order', 'Commande', 'Order']];

/** The server's French message when it gives one (errorFr / messageFr), else its English one. */
function serverText(t: (fr: string, en: string) => string, e: unknown): string {
  if (e instanceof ApiError) { const fr = e.body?.errorFr; return typeof fr === 'string' && fr ? t(fr, e.message) : e.message; }
  return e instanceof Error ? e.message : String(e);
}

function Stars({ n }: { n: number | null }) {
  const { t } = useI18n();
  if (n === null) return <span className="text-xs text-ink-3" role="img" aria-label={t('Sans note', 'No rating')}>—</span>;
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={t(`${n} étoile${n > 1 ? 's' : ''} sur 5`, `${n} out of 5 stars`)}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} aria-hidden="true" className={i <= n ? 'size-3.5 fill-wait text-wait' : 'size-3.5 text-line-2'} />)}
    </span>
  );
}

const fmtAvg = (v: number | null, loc: string) => (v === null ? '—' : v.toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 2 }));

export function ReviewsView() {
  const { t, lang, loc } = useI18n();
  const { can, locations, locName, allLocations } = useViewer();
  const toast = useToast();
  const canEdit = can('menu:edit');

  const [brand, setBrand] = useState('');
  const [platform, setPlatform] = useState('');
  const [kitchen, setKitchen] = useState('');
  const [stars, setStars] = useState('');
  const [theme, setTheme] = useState('');
  const [unanswered, setUnanswered] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (brand) p.set('brand', brand);
    if (platform) p.set('platform', platform);
    if (kitchen) p.set('kitchen', kitchen);
    if (stars) p.set('stars', stars);
    if (theme) p.set('theme', theme);
    if (unanswered) p.set('unanswered', '1');
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString();
  }, [brand, platform, kitchen, stars, theme, unanswered, from, to]);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api<ListResponse>(`/api/foodhub/reviews?${query}`));
    } catch (e) { setError(serverText(t, e)); }
  }, [query, t]);
  useEffect(() => { void load(); }, [load]);

  const replaceRow = (row: ReviewRow) => setData((d) => (d ? { ...d, reviews: d.reviews.map((r) => (r.id === row.id ? row : r)) } : d));
  const platformLabel = (key: string) => (lang === 'fr' && PLATFORM_FR[key]) || data?.platforms.find((p) => p.key === key)?.label || key;
  const themeLabel = (key: string) => { const th = data?.themes.find((x) => x.key === key); return th ? t(th.fr, th.en) : key; };

  async function act(id: string, action: 'draft' | 'replied' | 'clear') {
    setBusy(`${id}:${action}`);
    try {
      const out = await api<{ review: ReviewRow; source?: string; rejected?: string[] }>(`/api/foodhub/reviews/${encodeURIComponent(id)}`, { method: 'POST', json: { action } });
      replaceRow(out.review);
      if (action === 'draft') toast.success(out.source === 'ai' ? t('Réponse proposée', 'Reply proposed') : t('Modèle de réponse proposé', 'Template reply proposed'), out.rejected?.length ? t('Le brouillon de l’IA ne respectait pas les règles : modèle utilisé.', 'The AI draft broke a rule: template used.') : undefined);
      if (action === 'replied') { toast.success(t('Marqué comme répondu', 'Marked as replied')); void load(); }
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(t('Action impossible', 'Action failed'), serverText(t, e)); }
    finally { setBusy(null); }
  }

  /** Saves the edited draft (guarded on the server). False when it was refused: nothing is copied or marked. */
  async function saveDraft(id: string, text: string): Promise<boolean> {
    try {
      const out = await api<{ review: ReviewRow }>(`/api/foodhub/reviews/${encodeURIComponent(id)}`, { method: 'POST', json: { action: 'save', draft: text } });
      replaceRow(out.review);
      return true;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 499)) toast.error(t('Brouillon non enregistré', 'Draft not saved'), serverText(t, e));
      return false;
    }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast.success(t('Copié : collez la réponse dans le portail de la plateforme', 'Copied: paste the reply in the platform’s portal')); }
    catch { toast.error(t('Copie impossible : sélectionnez le texte', 'Could not copy: select the text')); }
  }

  async function batch() {
    setBusy('batch');
    try {
      const out = await api<{ drafted: number; remaining: number }>(`/api/foodhub/reviews/drafts?${query}`, { method: 'POST', json: {} });
      toast.success(t(`${out.drafted} réponse(s) proposée(s)`, `${out.drafted} reply draft(s)`), out.remaining ? t(`${out.remaining} restent : relancez.`, `${out.remaining} left: run again.`) : undefined);
      await load();
    } catch (e) { toast.error(t('Action impossible', 'Action failed'), serverText(t, e)); }
    finally { setBusy(null); }
  }

  const overall = data?.summary.overall;
  const trend = data?.trend ?? [];

  return (
    <div>
      <PageHeader title={t('Avis et notes', 'Reviews')}
        subtitle={t('Les avis de toutes les plateformes au même endroit : note, thèmes, réponses proposées. Food Hub ne publie jamais de réponse : copiez-la dans le portail de la plateforme, magasin par magasin.',
          'Every platform’s reviews in one place: rating, themes, proposed replies. Food Hub never posts a reply: copy it into the platform’s portal, store by store.')}
        right={<Button variant="outline" size="sm" icon={<RefreshCw className="size-4" />} onClick={() => void load()}>{t('Actualiser', 'Refresh')}</Button>} />
      <InsightsTabs />

      {error && <Banner tone="stop" className="mb-4">{error}</Banner>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={t('Note moyenne', 'Average rating')} value={overall ? `${fmtAvg(overall.avg, loc)} / 5` : '…'} icon={<Star className="size-4" />}
          note={trend.length ? trend.map((w) => `${w.days} ${t('j', 'd')} : ${fmtAvg(w.avg, loc)}${w.delta !== null ? ` (${w.delta > 0 ? '+' : ''}${w.delta.toLocaleString(loc)})` : ''}`).join(' · ') : undefined} />
        <Stat label={t('Avis', 'Reviews')} value={overall ? overall.count.toLocaleString(loc) : '…'} icon={<MessageSquareText className="size-4" />}
          note={overall ? ([5, 4, 3, 2, 1] as const).map((s) => `${s}★ ${overall.distribution[s]}`).join(' · ') : undefined} />
        <Stat label={t('Sans réponse', 'Unanswered')} value={overall ? overall.unanswered.toLocaleString(loc) : '…'} tone={overall && overall.unanswered ? 'wait' : undefined}
          note={t('Avis avec commentaire, pas encore marqués « répondu ».', 'Reviews with a comment, not marked “replied” yet.')} />
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('Marque', 'Brand')}><Select value={brand} onChange={(e) => setBrand(e.target.value)}><option value="">{t('Toutes', 'All')}</option>{(data?.brands ?? []).map((b) => <option key={b} value={b}>{b}</option>)}</Select></Field>
          <Field label={t('Plateforme', 'Platform')}><Select value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="">{t('Toutes', 'All')}</option>{(data?.platforms ?? []).map((p) => <option key={p.key} value={p.key}>{platformLabel(p.key)}</option>)}</Select></Field>
          <Field label={t('Cuisine', 'Kitchen')}><Select value={kitchen} onChange={(e) => setKitchen(e.target.value)}><option value="">{t('Toutes', 'All')}</option>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select></Field>
          <Field label={t('Étoiles', 'Stars')}><Select value={stars} onChange={(e) => setStars(e.target.value)}><option value="">{t('Toutes', 'All')}</option><option value="1,2">1–2★</option><option value="3">3★</option><option value="4,5">4–5★</option></Select></Field>
          <Field label={t('Du', 'From')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('Au', 'To')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="flex items-end pb-2"><Checkbox checked={unanswered} onChange={setUnanswered} label={t('Sans réponse seulement', 'Unanswered only')} /></div>
          {canEdit && <div className="flex items-end"><Button variant="soft" loading={busy === 'batch'} disabled={!overall?.unanswered} icon={<Sparkles className="size-4" />} onClick={() => void batch()}>{t('Proposer pour les avis sans réponse', 'Propose for unanswered reviews')}</Button></div>}
        </div>
        {data && (
          <Chips size="sm" className="mt-4" value={theme} onChange={(v) => setTheme(v === theme ? '' : v)}
            options={[{ value: '', label: t('Tous les thèmes', 'All themes') }, ...data.themes.map((th) => {
              const n = overall?.themes.find((x) => x.key === th.key)?.count ?? 0;
              return { value: th.key, label: `${t(th.fr, th.en)}${n ? ` · ${n}` : ''}` };
            })]} />
        )}
      </Card>

      <Card className="mb-4">
        <CardHeader title={t('Par marque et plateforme', 'By brand and platform')} subtitle={t('Note, nombre d’avis, tendance 30 jours et thèmes principaux, par cuisine.', 'Rating, review count, 30-day trend and top themes, per kitchen.')} />
        {!data ? <div className="h-24 animate-pulse rounded-b-lg bg-sunken" /> : data.summary.groups.length === 0 ? <EmptyState title={t('Aucun avis pour ces filtres', 'No reviews for these filters')} body={t('Importez un fichier ou les avis DoorDash ci-dessous.', 'Import a file or the DoorDash reviews below.')} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-y border-line text-left text-xs text-ink-3">
                <th className="px-5 py-2 font-semibold">{t('Marque', 'Brand')}</th><th className="px-3 py-2 font-semibold">{t('Plateforme', 'Platform')}</th><th className="px-3 py-2 font-semibold">{t('Cuisine', 'Kitchen')}</th>
                <th className="px-3 py-2 text-right font-semibold">{t('Note', 'Rating')}</th><th className="px-3 py-2 text-right font-semibold">{t('Avis', 'Reviews')}</th><th className="px-3 py-2 text-right font-semibold">30 {t('j', 'd')}</th>
                <th className="px-3 py-2 text-right font-semibold">{t('Sans réponse', 'Unanswered')}</th><th className="px-5 py-2 font-semibold">{t('Thèmes', 'Themes')}</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {data.summary.groups.map((g) => {
                  const w = g.trend.find((x) => x.days === 30);
                  return (
                    <tr key={`${g.brandName}|${g.platform}|${g.locationCode}`}>
                      <td className="px-5 py-2 font-semibold text-ink">{g.brandName ?? t('Marque inconnue', 'Unknown brand')}</td>
                      <td className="px-3 py-2">{platformLabel(g.platform)}</td>
                      <td className="px-3 py-2 text-ink-2">{g.locationCode ? shortLoc(locName(g.locationCode)) : '—'}</td>
                      <td className="num px-3 py-2 text-right font-semibold">{fmtAvg(g.avg, loc)}</td>
                      <td className="num px-3 py-2 text-right">{g.count}</td>
                      <td className="num px-3 py-2 text-right">{w && w.delta !== null ? <span className={w.delta >= 0 ? 'text-go' : 'text-stop'}>{w.delta > 0 ? '+' : ''}{w.delta.toLocaleString(loc)}</span> : '—'}</td>
                      <td className="num px-3 py-2 text-right">{g.unanswered || '—'}</td>
                      <td className="px-5 py-2"><div className="flex flex-wrap gap-1">{g.themes.slice(0, 3).map((th) => <Badge key={th.key}>{themeLabel(th.key)} · {th.count}</Badge>)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <CardHeader title={t('Avis', 'Reviews')} subtitle={data ? t(`${data.total} avis${data.total > data.reviews.length ? `, ${data.reviews.length} affichés` : ''}`, `${data.total} review(s)${data.total > data.reviews.length ? `, ${data.reviews.length} shown` : ''}`) : undefined} />
        {!data ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded bg-sunken" />)}</div> : data.reviews.length === 0 ? <EmptyState title={t('Aucun avis', 'No reviews')} /> : (
          <div className="divide-y divide-line">
            {data.reviews.map((r) => (
              <ReviewCard key={r.id} r={r} canEdit={canEdit} busy={busy} platformLabel={platformLabel} themeLabel={themeLabel} kitchen={r.locationCode ? shortLoc(locName(r.locationCode)) : null}
                onAct={(a) => void act(r.id, a)} onCopy={(text) => void copy(text)} onSave={(text) => saveDraft(r.id, text)} />
            ))}
          </div>
        )}
      </Card>

      {canEdit && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ImportCard onDone={() => void load()} />
          {allLocations && <DoorDashCard onDone={() => void load()} />}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ r, canEdit, busy, platformLabel, themeLabel, kitchen, onAct, onCopy, onSave }: {
  r: ReviewRow; canEdit: boolean; busy: string | null; platformLabel: (k: string) => string; themeLabel: (k: string) => string; kitchen: string | null;
  onAct: (a: 'draft' | 'replied' | 'clear') => void; onCopy: (text: string) => void; onSave: (text: string) => Promise<boolean>;
}) {
  const { t, loc } = useI18n();
  const stored = r.reply?.draft ?? '';
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(stored); }, [stored]);
  const replied = Boolean(r.reply?.repliedAt);
  const hasDraft = Boolean(stored) || Boolean(draft);
  /** The edited text is saved before it is copied or the review is marked replied: what is stored is what was pasted. */
  const saveIfEdited = async () => {
    if (draft === stored) return true;
    setSaving(true);
    try { return await onSave(draft); } finally { setSaving(false); }
  };
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Stars n={r.stars} />
        <span className="font-semibold text-ink">{r.brandName ?? t('Marque inconnue', 'Unknown brand')}</span>
        <Badge tone="info">{platformLabel(r.platform)}</Badge>
        {kitchen && <span className="text-xs text-ink-3">{kitchen}</span>}
        <span className="text-xs text-ink-3">{dayOf(r.at, loc)}</span>
        {r.daysLeft !== null && <Badge tone={r.daysLeft <= 1 ? 'stop' : r.daysLeft <= 3 ? 'wait' : 'neutral'}>{r.daysLeft === 0 ? t('Délai de réponse passé', 'Reply window closed') : t(`${r.daysLeft} j pour répondre`, `${r.daysLeft} d left to reply`)}</Badge>}
        {replied && <Badge tone="go" icon={<Check className="size-3" />}>{t('Répondu', 'Replied')}</Badge>}
      </div>
      {r.text ? <p className="mt-1.5 text-sm whitespace-pre-line text-ink">{r.text}</p> : <p className="mt-1.5 text-xs text-ink-3">{t('Note sans commentaire.', 'Rating without a comment.')}</p>}
      {r.themes.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.themes.map((k) => <Badge key={k} tone="violet">{themeLabel(k)}</Badge>)}</div>}
      {canEdit && r.text && (
        <div className="mt-3 rounded-md border border-line bg-sunken p-3">
          {hasDraft ? (
            <Textarea rows={3} value={draft} maxLength={600} onChange={(e) => setDraft(e.target.value)} onBlur={() => void saveIfEdited()} aria-label={t('Brouillon de réponse', 'Reply draft')} />
          ) : <p className="text-xs text-ink-3">{t('Pas encore de réponse proposée.', 'No reply proposed yet.')}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="soft" icon={<Sparkles className="size-4" />} loading={busy === `${r.id}:draft`} onClick={() => onAct('draft')}>{draft ? t('Proposer à nouveau', 'Propose again') : t('Proposer', 'Propose')}</Button>
            <Button size="sm" variant="outline" icon={<Clipboard className="size-4" />} disabled={!draft.trim() || saving} onClick={() => void saveIfEdited().then((saved) => { if (saved) onCopy(draft); })}>{t('Copier', 'Copy')}</Button>
            {!replied && <Button size="sm" variant="go" icon={<Check className="size-4" />} loading={busy === `${r.id}:replied` || saving} onClick={() => void saveIfEdited().then((saved) => { if (saved) onAct('replied'); })}>{t('Marquer comme répondu', 'Mark as replied')}</Button>}
            {(hasDraft || replied) && <Button size="sm" variant="ghost" icon={<X className="size-4" />} loading={busy === `${r.id}:clear`} onClick={() => onAct('clear')}>{t('Effacer', 'Clear')}</Button>}
            {r.reply?.draftSource && <span className="text-xs text-ink-3">{r.reply.draftSource === 'ai' ? t('Proposée par l’IA, à relire', 'Proposed by AI, review it') : r.reply.draftSource === 'edited' ? t('Modifiée', 'Edited') : t('Modèle', 'Template')}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function ImportCard({ onDone }: { onDone: () => void }) {
  const { t, loc } = useI18n();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState('');
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      if (platform) form.set('platform', platform);
      if (Object.keys(mapping).length) form.set('mapping', JSON.stringify(mapping));
      const res = await fetch(`/api/foodhub/reviews/import${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', body: form, cache: 'no-store' });
      const body = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as ImportPreview & { ok: boolean; error?: string; errorFr?: string };
      if (!res.ok || body.ok === false) throw new Error(body.errorFr ? t(body.errorFr, body.error || '') : body.error || `HTTP ${res.status}`);
      if (dryRun || body.needsMapping) { setPreview(body); return; }
      toast.success(t(`${body.counts?.new ?? 0} nouvel(s) avis importé(s)`, `${body.counts?.new ?? 0} new review(s) imported`));
      setPreview(null); setFile(null); setMapping({});
      if (fileRef.current) fileRef.current.value = '';
      onDone();
    } catch (e) { toast.error(t('Import impossible', 'Import failed'), serverText(t, e)); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader icon={<FileUp className="size-4" />} title={t('Importer des avis', 'Import reviews')}
        subtitle={t('CSV ou Excel exporté du portail (Uber Eats, Skip, Too Good To Go, Google), ou le JSON de Google Takeout. Aperçu avant d’enregistrer. Aucune donnée personnelle n’est gardée.',
          'CSV or Excel exported from the portal (Uber Eats, Skip, Too Good To Go, Google), or the Google Takeout JSON. Preview before saving. No personal data is kept.')} />
      <div className="space-y-3 px-5 pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Fichier (max 5 Mo)', 'File (max 5 MB)')}><Input ref={fileRef} type="file" accept=".csv,.xlsx,.json,text/csv,application/json" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setMapping({}); }} /></Field>
          <Field label={t('Plateforme', 'Platform')}><Select value={platform} onChange={(e) => { setPlatform(e.target.value); setPreview(null); setMapping({}); }}>
            <option value="">{t('Détecter', 'Detect')}</option><option value="uber_eats">Uber Eats</option><option value="skip">SkipTheDishes</option><option value="tgtg">Too Good To Go</option><option value="google">Google</option><option value="doordash">DoorDash</option><option value="other">{t('Autre', 'Other')}</option>
          </Select></Field>
        </div>
        {preview?.needsMapping && preview.headers && (
          <div className="rounded-md border border-line p-3">
            <p className="mb-2 text-sm text-ink-2">{preview.message ? t(preview.messageFr || preview.message, preview.message) : t('Colonnes non reconnues : choisissez-les.', 'Columns not recognized: choose them.')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {MAPPING_FIELDS.map(([k, fr, en]) => (
                <Field key={k} label={t(fr, en)}>
                  <Select value={mapping[k] ?? ''} onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value === '') delete n[k]; else n[k] = Number(e.target.value); return n; })}>
                    <option value="">—</option>{preview.headers!.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
          </div>
        )}
        {preview && !preview.needsMapping && preview.counts && (
          <div className="rounded-md border border-line p-3 text-sm">
            <div className="mb-2 flex flex-wrap gap-2">
              {preview.preset && <Badge tone="info">{preview.preset}</Badge>}
              <Badge tone="go">{t(`${preview.counts.new} nouveaux`, `${preview.counts.new} new`)}</Badge>
              <Badge>{t(`${preview.counts.duplicate} déjà là`, `${preview.counts.duplicate} already there`)}</Badge>
              {preview.counts.skipped > 0 && <Badge tone="wait">{t(`${preview.counts.skipped} ignorés`, `${preview.counts.skipped} skipped`)}</Badge>}
              {preview.counts.unmapped > 0 && <Badge tone="wait">{t(`${preview.counts.unmapped} sans marque`, `${preview.counts.unmapped} without brand`)}</Badge>}
              {preview.counts.dropped > 0 && <Badge tone="stop">{t(`${preview.counts.dropped} d’un magasin protégé, laissés de côté`, `${preview.counts.dropped} of a protected store, left out`)}</Badge>}
            </div>
            <ul className="max-h-64 divide-y divide-line overflow-y-auto">
              {(preview.preview ?? []).map((r) => (
                <li key={r.id} className="flex gap-2 py-1.5"><Stars n={r.stars} /><span className="text-xs text-ink-3">{dayOf(r.at, loc)}</span><span className="text-xs font-semibold">{r.brandName ?? '—'}</span><span className="line-clamp-1 flex-1 text-xs text-ink-2">{r.text}</span></li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!file} loading={busy && !preview} onClick={() => void send(true)}>{t('Aperçu', 'Preview')}</Button>
          <Button disabled={!file || !preview || Boolean(preview.needsMapping)} loading={busy && Boolean(preview)} onClick={() => void send(false)}>{t('Confirmer l’import', 'Confirm import')}</Button>
        </div>
      </div>
    </Card>
  );
}

function DoorDashCard({ onDone }: { onDone: () => void }) {
  const { t, loc } = useI18n();
  const toast = useToast();
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [reports, setReports] = useState<FeedbackReport[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setReports((await api<{ reports: FeedbackReport[] }>('/api/foodhub/reviews/doordash')).reports); } catch { setReports([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function request() {
    setBusy('request');
    try { await api('/api/foodhub/reviews/doordash', { method: 'POST', json: { action: 'request', from, to } }); toast.success(t('Rapport demandé à DoorDash (jusqu’à 5 minutes)', 'Report requested from DoorDash (up to 5 minutes)')); await load(); }
    catch (e) { toast.error(t('Demande impossible', 'Request failed'), serverText(t, e)); }
    finally { setBusy(null); }
  }
  async function ingest(id: string) {
    setBusy(id);
    try {
      const out = await api<{ imported: boolean; message: string; messageFr?: string; added: number }>('/api/foodhub/reviews/doordash', { method: 'POST', json: { action: 'ingest', reportId: id } });
      const said = t(out.messageFr || out.message, out.message);
      if (out.imported) { toast.success(t(`${out.added} nouvel(s) avis DoorDash`, `${out.added} new DoorDash review(s)`), said); onDone(); } else toast.info(t('Pas encore prêt', 'Not ready yet'), said);
      await load();
    } catch (e) { toast.error(t('Import impossible', 'Import failed'), serverText(t, e)); }
    finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader title={t('Avis DoorDash', 'DoorDash reviews')}
        subtitle={t('Rapport « commentaires des clients » de DoorDash. Les magasins protégés ne sont jamais demandés ni gardés. Répondez dans le portail DoorDash (7 jours).',
          'DoorDash customer feedback report. Protected stores are never requested nor kept. Reply in the DoorDash portal (7 days).')} />
      <div className="space-y-3 px-5 pb-5">
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('Du', 'From')}><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('Au', 'To')}><Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button loading={busy === 'request'} onClick={() => void request()}>{t('Demander le rapport', 'Request the report')}</Button>
        </div>
        {reports === null ? <div className="h-12 animate-pulse rounded bg-sunken" /> : reports.length === 0 ? <p className="text-sm text-ink-3">{t('Aucun rapport demandé.', 'No report requested yet.')}</p> : (
          <ul className="divide-y divide-line text-sm">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="num">{r.from} → {r.to}</span>
                <Badge tone={r.status === 'failed' ? 'stop' : r.status === 'requested' ? 'wait' : 'go'}>{r.status === 'requested' ? t('En préparation', 'Preparing') : r.status === 'failed' ? t('Échec', 'Failed') : t('Prêt', 'Ready')}</Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-3" title={t(r.messageFr || r.message, r.message)}>{dayOf(r.at, loc)} · {t(r.messageFr || r.message, r.message)}</span>
                {r.status !== 'failed' && <Button size="sm" variant="outline" loading={busy === r.id} onClick={() => void ingest(r.id)}>{t('Importer les avis', 'Import the reviews')}</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
