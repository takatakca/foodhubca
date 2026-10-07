'use client';

// The one truthful save indicator of an autosaved screen (no Save button): it only says "Saved" after the server
// answered ok, and always says what to do when something is not saved yet.
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, CloudOff, Loader2, Pencil, Redo2, RotateCcw, Undo2, X } from 'lucide-react';
import type { Autosave } from '@/lib/ui/use-autosave';
import type { Undo } from '@/lib/ui/use-undo';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => { const i = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(i); }, [ms]);
}

export function SaveChip({ autosave, undo, className }: { autosave: Pick<Autosave<unknown>, 'status' | 'problems' | 'error' | 'lastSavedAt' | 'saveNow'>; undo?: Undo; className?: string }) {
  const { t, loc } = useI18n();
  useTick(15_000);
  const { status, problems, error, lastSavedAt, saveNow } = autosave;
  const at = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) : null;
  const base = 'inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold';
  let chip;
  switch (status) {
    case 'saving':
      chip = <span className={cn(base, 'text-ink-3')} role="status"><Loader2 className="size-4 animate-spin" />{t('Enregistrement…', 'Saving…')}</span>; break;
    case 'dirty':
      chip = <span className={cn(base, 'text-ink-3')} role="status"><Pencil className="size-4" />{t('Modifications… gardées ici', 'Editing… kept on this screen')}</span>; break;
    case 'invalid':
      chip = <span className={cn(base, 'bg-wait-soft text-wait-2')} role="status" title={problems.join('\n')}><AlertTriangle className="size-4" />{t('À corriger', 'Fix')} : {problems[0]}</span>; break;
    case 'offline':
      chip = <span className={cn(base, 'bg-stop-soft text-stop-2')} role="status"><CloudOff className="size-4" />{t('Hors ligne — gardé ici, envoyé au retour du réseau', 'Offline — kept here, sent when the network is back')}</span>; break;
    case 'error':
      chip = <button type="button" onClick={() => void saveNow()} className={cn(base, 'bg-stop text-white hover:bg-stop-2')} title={error ?? ''}><RotateCcw className="size-4" />{t('Pas enregistré — Réessayer', 'Not saved — Retry')}</button>; break;
    case 'cancelled':
      chip = <button type="button" onClick={() => void saveNow()} className={cn(base, 'bg-ink text-canvas hover:bg-ink/90')}><X className="size-4" />{t('NIP annulé — Enregistrer', 'PIN cancelled — Save')}</button>; break;
    case 'saved':
      chip = <span className={cn(base, 'text-go-2')} role="status"><Check className="size-4" />{t('Enregistré', 'Saved')}{at ? ` · ${at}` : ''}</span>; break;
    default:
      chip = <span className={cn(base, 'text-ink-4')} role="status"><Check className="size-4" />{t('À jour — enregistrement automatique', 'Up to date — saves automatically')}</span>;
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} data-help="autosave.chip">
      {chip}
      {undo && (undo.canUndo || undo.canRedo) && (
        <span className="flex items-center">
          <button type="button" onClick={undo.undo} disabled={!undo.canUndo} className="flex size-10 items-center justify-center rounded-md text-ink-2 hover:bg-sunken disabled:opacity-30" aria-label={t('Annuler la dernière modification', 'Undo last change')} title={t('Annuler (⌘Z)', 'Undo (⌘Z)')}><Undo2 className="size-5" /></button>
          <button type="button" onClick={undo.redo} disabled={!undo.canRedo} className="flex size-10 items-center justify-center rounded-md text-ink-2 hover:bg-sunken disabled:opacity-30" aria-label={t('Rétablir', 'Redo')} title={t('Rétablir (⇧⌘Z)', 'Redo (⇧⌘Z)')}><Redo2 className="size-5" /></button>
        </span>
      )}
    </div>
  );
}

/** Shown when a local draft (from a crash, a closed tab or a lost connection) was put back on the screen. */
export function DraftRestoredBanner({ onDiscard, className }: { onDiscard: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-sm text-info-2', className)} role="status">
      <span className="flex-1 font-semibold">{t('Vos changements non enregistrés ont été récupérés sur cet écran et vont être enregistrés.', 'Your unsaved changes were recovered on this screen and are being saved.')}</span>
      <button type="button" onClick={onDiscard} className="min-h-10 rounded-md px-3 font-bold hover:bg-info/10">{t('Revenir à la version enregistrée', 'Go back to the saved version')}</button>
    </div>
  );
}

/**
 * Shown at the top of a pop-up form (useFormDraft) when what was typed last time was kept: nothing was sent yet,
 * the person finishes and presses the form's button, or starts over.
 */
export function FormDraftNote({ restored, onDiscard, className }: { restored: boolean; onDiscard: () => void; className?: string }) {
  const { t } = useI18n();
  if (!restored) return null;
  return (
    <div className={cn('mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm text-info-2', className)} role="status" data-testid="form-draft-note">
      <span className="flex-1 font-semibold">{t('Repris là où vous étiez — rien n’a encore été envoyé.', 'Picked up where you left off — nothing was sent yet.')}</span>
      <button type="button" onClick={onDiscard} className="min-h-10 rounded-md px-3 font-bold hover:bg-info/10">{t('Recommencer', 'Start over')}</button>
    </div>
  );
}
