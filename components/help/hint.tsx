'use client';

// <Hint id="hours.publish"><Button …/></Hint> — explains a control the first time a person uses it.
//   - Normal controls: the tap goes through, then a small card with TakTak explains what just happened.
//   - Blocking controls (they reach a platform or touch money): the first tap explains BEFORE anything is sent, and
//     "Continue" does the action. Never again after that (per person, per screen).
//   - Tips set to "light" only explain blocking controls; "off" never explains (the help drawer still lists them).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hintFor, pick } from '@/lib/help/content';
import { useI18n } from '@/lib/i18n/client';
import { Button } from '@/components/ui/button';
import { TakTak } from './taktak';
import { useHelp, useOptionalHelp } from './help-provider';

export function Hint({ id, children }: { id: string; children: ReactNode }) {
  const help = useOptionalHelp();
  const ref = useRef<HTMLSpanElement>(null);
  const bypass = useRef(false);
  const entry = hintFor(id);
  const target = () => (ref.current?.firstElementChild as HTMLElement | null) ?? ref.current;

  function onClickCapture(e: React.MouseEvent) {
    if (!help || !entry || bypass.current) { bypass.current = false; return; }
    if (help.tips === 'off' || help.seen(id) || help.tour) return;
    if (entry.blocking) {
      e.preventDefault();
      e.stopPropagation();
      const el = target();
      help.showMark(id, el, () => { bypass.current = true; (el?.closest('button,a,[role="button"]') as HTMLElement | null ?? el)?.click(); });
      return;
    }
    if (help.tips === 'full') {
      const el = target();
      setTimeout(() => help.showMark(id, el), 120);
    }
  }

  return <span ref={ref} data-help={id} onClickCapture={onClickCapture} className="contents">{children}</span>;
}

/** The card next to the control (rendered once by the console shell). */
export function CoachMark() {
  const help = useHelp();
  const { lang, t } = useI18n();
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const mark = help.mark;
  const entry = mark ? hintFor(mark.id) : null;

  useLayoutEffect(() => {
    if (!mark) { setPos(null); return; }
    const place = () => {
      const r = mark.anchor?.getBoundingClientRect();
      const w = Math.min(340, window.innerWidth - 24);
      const h = card.current?.offsetHeight ?? 180;
      if (!r || (r.width === 0 && r.height === 0)) { setPos({ top: Math.max(12, window.innerHeight / 2 - h / 2), left: Math.max(12, window.innerWidth / 2 - w / 2), above: false }); return; }
      const above = r.bottom + h + 16 > window.innerHeight && r.top - h - 16 > 0;
      setPos({ top: above ? r.top - h - 12 : r.bottom + 12, left: Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12), above });
    };
    place();
    mark.anchor?.classList.add('help-target-pulse');
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { mark.anchor?.classList.remove('help-target-pulse'); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [mark]);

  // Normal tips close by themselves after 9 s; blocking ones wait for an answer.
  useEffect(() => {
    if (!mark || entry?.blocking) return;
    const tm = setTimeout(() => help.closeMark(true), 9000);
    return () => clearTimeout(tm);
  }, [mark, entry?.blocking, help]);

  useEffect(() => {
    if (!mark) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') help.closeMark(!entry?.blocking); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [mark, entry?.blocking, help]);

  if (!mark || !entry || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[87]" onMouseDown={(e) => { if (e.target === e.currentTarget) help.closeMark(!entry.blocking); }} style={{ pointerEvents: entry.blocking ? 'auto' : 'none' }}>
      <div ref={card} role="dialog" aria-label={pick(entry.title, lang)}
        className="pointer-events-auto absolute w-[min(340px,calc(100vw-24px))] rounded-2xl border border-line bg-surface p-4 shadow-pop animate-rise"
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
        <div className="flex gap-3">
          <TakTak size={44} spinKey={mark.id} wave={entry.blocking} mood={entry.blocking ? 'think' : 'happy'} />
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold text-ink">{pick(entry.title, lang)}</div>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">{pick(entry.body, lang)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {entry.blocking ? (
            <>
              <Button variant="ghost" size="lg" onClick={() => help.closeMark(false)}>{t('Pas maintenant', 'Not now')}</Button>
              <Button variant="brand" size="lg" onClick={() => { const go = mark.onContinue; help.closeMark(true); go?.(); }}>{t('Compris, continuer', 'Got it, continue')}</Button>
            </>
          ) : (
            <Button variant="primary" size="lg" onClick={() => help.closeMark(true)}>{t('Compris', 'Got it')}</Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
