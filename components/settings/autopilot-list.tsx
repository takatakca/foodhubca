'use client';

// Settings → Autopilot, the list itself (no data fetching, so it renders the same in a test): one card per automation
// with its switch (or where it is switched), its rule in plain words, the last run, what it did last and the undo.
import Link from 'next/link';
import { Bot, CircleSlash, Clock, History, RotateCcw, Undo2 } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/form';
import type { T } from '@/lib/i18n';
import type { AutomationView, PendingAction } from '@/lib/foodhub/autopilot';
import { cn } from '@/lib/ui/cn';

export type AutopilotItem = AutomationView;

/** "il y a 5 min" / "5 min ago" (a date alone, as the daily reconciliation keeps it, shows as the day). */
export function whenText(at: string | null | undefined, lang: 'fr' | 'en', now = Date.now()): string {
  if (!at) return lang === 'fr' ? 'jamais encore' : 'not yet';
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return new Date(`${at}T12:00:00`).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'long' });
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (!Number.isFinite(s)) return '—';
  if (s < 60) return lang === 'fr' ? 'à l’instant' : 'just now';
  if (s < 3600) return lang === 'fr' ? `il y a ${Math.round(s / 60)} min` : `${Math.round(s / 60)} min ago`;
  if (s < 86400) return lang === 'fr' ? `il y a ${Math.round(s / 3600)} h` : `${Math.round(s / 3600)} h ago`;
  return lang === 'fr' ? `il y a ${Math.round(s / 86400)} j` : `${Math.round(s / 86400)} d ago`;
}

function stateTone(a: AutopilotItem): Tone {
  if (a.control === 'always') return 'info';
  return a.on ? 'go' : 'neutral';
}

function AutomationCard({ a, t, lang, canEdit, busy, onToggle, onUndo, now }: {
  a: AutopilotItem; t: T; lang: 'fr' | 'en'; canEdit: boolean; busy?: string | null; now?: number;
  onToggle: (id: string, on: boolean) => void; onUndo: (p: PendingAction) => void;
}) {
  const name = t(a.fr, a.en);
  const did = a.lastDid ? (lang === 'fr' ? a.lastDid.fr : a.lastDid.en) : null;
  return (
    <li className="min-w-0 px-5 py-4" data-automation={a.id}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-body font-extrabold break-words text-ink">{name}</h3>
            <Badge size="sm" tone={stateTone(a)}>{t(a.stateFr, a.stateEn)}</Badge>
            {a.isNew && !a.on && <Badge size="sm" tone="neutral">{t('Arrêtée par défaut', 'Off by default')}</Badge>}
          </div>
          <p className="text-small mt-1 break-words text-ink-2">{t(a.ruleFr, a.ruleEn)}</p>
        </div>
        <div className="shrink-0">
          {a.control === 'here' ? (
            <Switch checked={a.on} disabled={!canEdit || busy === a.id} onChange={(v) => onToggle(a.id, v)}
              label={a.on ? t('Activée', 'On') : t('Arrêtée', 'Off')} />
          ) : a.control === 'always' ? (
            <span className="text-small inline-flex items-center gap-1 font-semibold text-ink-3"><Bot className="size-4" aria-hidden />{t('Sans interrupteur', 'No switch')}</span>
          ) : a.href ? (
            <Link href={a.href} className="text-small inline-flex min-h-11 items-center font-bold text-brand-2 underline">{t('Changer', 'Change')}</Link>
          ) : null}
        </div>
      </div>
      <dl className="text-small mt-3 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-ink-3 sm:grid-cols-2">
        <div className="flex min-w-0 items-start gap-1.5"><Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden /><dt className="shrink-0">{t('Dernier passage :', 'Last run:')}</dt><dd className="min-w-0 font-semibold text-ink-2">{whenText(a.lastRunAt, lang, now)}</dd></div>
        <div className="flex min-w-0 items-start gap-1.5"><History className="mt-0.5 size-3.5 shrink-0" aria-hidden /><dt className="shrink-0">{t('A fait :', 'Last did:')}</dt>
          <dd className={cn('min-w-0 break-words font-semibold', a.lastDid?.status === 'failed' ? 'text-stop-2' : 'text-ink-2')}>{did ? `${did} · ${whenText(a.lastDid!.at, lang, now)}` : t('rien encore', 'nothing yet')}</dd></div>
      </dl>
      {a.control === 'elsewhere' && a.whereFr && <p className="text-small mt-2 text-ink-3">{t('Interrupteur :', 'Switch:')} {a.href ? <Link href={a.href} className="font-semibold underline">{t(a.whereFr, a.whereEn ?? a.whereFr)}</Link> : t(a.whereFr, a.whereEn ?? a.whereFr)}</p>}
      {a.control === 'server' && a.whereFr && (
        <details className="group mt-2 min-w-0">
          <summary className="text-small inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-semibold text-ink-3 hover:text-ink [&::-webkit-details-marker]:hidden">{t(a.whereFr, a.whereEn ?? a.whereFr)}</summary>
          {a.tech && <div className="text-small mt-1 rounded-md bg-sunken px-3 py-2 font-mono break-all text-ink-2">{a.tech}</div>}
        </details>
      )}
      {a.isNew && a.switchedBy && <p className="text-micro mt-1 text-ink-4">{a.on ? t('Activée par', 'Turned on by') : t('Arrêtée par', 'Turned off by')} {a.switchedBy} · {whenText(a.switchedAt, lang, now)}</p>}
      {a.pending.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label={t('En attente', 'Waiting')}>
          {a.pending.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-sunken px-3 py-2">
              <span className="text-small min-w-0 break-words font-semibold text-ink-2">{t(p.fr, p.en)}</span>
              <Button size="xs" variant="outline" disabled={!canEdit || busy === p.id} icon={p.kind === 'cancel_publish' ? <Undo2 className="size-3.5" /> : <CircleSlash className="size-3.5" />} onClick={() => onUndo(p)}>
                {p.kind === 'cancel_publish' ? t('Annuler', 'Cancel') : t('Arrêter', 'Stop')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {a.undoHref && a.undoFr && <p className="text-small mt-2 inline-flex items-center gap-1 text-ink-3"><RotateCcw className="size-3.5" aria-hidden /><Link href={a.undoHref} className="underline">{t(a.undoFr, a.undoEn ?? a.undoFr)}</Link></p>}
    </li>
  );
}

/** The two groups: the new automations (switched here, off by default), then what already ran by itself. */
export function AutopilotList({ items, t, lang, canEdit, busy, onToggle, onUndo, now }: {
  items: AutopilotItem[]; t: T; lang: 'fr' | 'en'; canEdit: boolean; busy?: string | null; now?: number;
  onToggle: (id: string, on: boolean) => void; onUndo: (p: PendingAction) => void;
}) {
  const groups = [
    { key: 'new', title: t('À activer vous-même', 'Turn on yourself'), sub: t('Nouvelles, arrêtées tant que vous ne les activez pas.', 'New, off until you turn them on.'), list: items.filter((a) => a.isNew) },
    { key: 'running', title: t('Ce que Food Hub fait déjà tout seul', 'What Food Hub already does by itself'), sub: t('Leur interrupteur reste là où il était ; cette page le lit.', 'Their switch stays where it was; this page reads it.'), list: items.filter((a) => !a.isNew) },
  ];
  return (
    <div className="space-y-6">
      {groups.filter((g) => g.list.length).map((g) => (
        <section key={g.key} className="min-w-0 rounded-md border border-line bg-surface shadow-card" aria-label={g.title}>
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-heading text-ink">{g.title}</h2>
            <p className="text-small mt-0.5 text-ink-3">{g.sub}</p>
          </div>
          <ul className="divide-y divide-line">
            {g.list.map((a) => <AutomationCard key={a.id} a={a} t={t} lang={lang} canEdit={canEdit} busy={busy} onToggle={onToggle} onUndo={onUndo} now={now} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
