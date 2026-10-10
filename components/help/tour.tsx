'use client';

// Guided tour of the current screen: dims the page, lights up one control at a time, TakTak explains in two lines.
// Big Back / Next buttons (no swiping), Esc or "Skip" ends it. A step whose control is not on screen is shown in the
// middle of the screen instead of failing; a step whose control this person never sees is skipped.
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { pick } from '@/lib/help/content';
import { useI18n } from '@/lib/i18n/client';
import { Button } from '@/components/ui/button';
import { TakTak } from './taktak';
import { useHelp } from './help-provider';

export function Tour() {
  const help = useHelp();
  const { lang, t } = useI18n();
  const tour = help.tour;
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Steps whose control is not on this screen for this person (no permission, empty list) are left out, so the tour
  // never describes a button someone cannot see. Measured once when the tour starts, before the first paint.
  const [present, setPresent] = useState<Set<string> | null>(null);
  const page = tour?.page;
  useLayoutEffect(() => {
    if (!page) { setPresent(null); return; }
    setPresent(new Set(page.steps.map((s) => s.target).filter((x): x is string => !!x && !!document.querySelector(`[data-help="${x}"]`))));
  }, [page]);
  const shown = tour ? tour.page.steps.filter((s) => !s.target || !present || present.has(s.target)) : [];
  const steps = tour ? (shown.length ? shown : [{ title: tour.page.title, body: tour.page.intro }]) : [];
  const step = tour ? steps[Math.min(tour.step, steps.length - 1)] : null;
  const target = step && 'target' in step ? step.target : undefined;

  useLayoutEffect(() => {
    if (!tour) return;
    const find = () => {
      const el = target ? (document.querySelector(`[data-help="${target}"]`)?.firstElementChild as HTMLElement | null) ?? (document.querySelector(`[data-help="${target}"]`) as HTMLElement | null) : null;
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 && r.height > 0 ? r : null);
    };
    const el = target ? document.querySelector(`[data-help="${target}"]`)?.firstElementChild as HTMLElement | null : null;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    find();
    const tm = setTimeout(find, 350);
    window.addEventListener('resize', find);
    window.addEventListener('scroll', find, true);
    return () => { clearTimeout(tm); window.removeEventListener('resize', find); window.removeEventListener('scroll', find, true); };
  }, [tour, target]);

  useEffect(() => {
    if (!tour) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') help.endTour(false);
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft' && tour.step > 0) help.setTourStep(tour.step - 1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!tour || !step || typeof document === 'undefined') return null;
  const last = tour.step >= steps.length - 1;
  function next() { if (!tour) return; if (last) help.endTour(true); else help.setTourStep(tour.step + 1); }
  const pad = 8;
  const cardW = Math.min(380, typeof window !== 'undefined' ? window.innerWidth - 24 : 380);
  const below = rect ? rect.bottom + 230 < window.innerHeight : true;
  const cardStyle = rect
    ? { top: below ? rect.bottom + pad + 12 : Math.max(12, rect.top - pad - 220), left: Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), window.innerWidth - cardW - 12) }
    : { top: Math.max(24, window.innerHeight / 2 - 120), left: window.innerWidth / 2 - cardW / 2 };

  return createPortal(
    <div className="fixed inset-0 z-[86]" role="dialog" aria-label={pick(step.title, lang)}>
      {rect
        ? <div className="pointer-events-none absolute rounded-xl transition-all duration-300" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgb(18 18 17 / 0.62), 0 0 0 3px #1f8bff' }} />
        : <div className="absolute inset-0 bg-ink/60" />}
      <div className="absolute rounded-2xl border border-line bg-surface p-5 shadow-pop animate-rise" style={{ ...cardStyle, width: cardW }}>
        <div className="flex items-start gap-3">
          <TakTak size={52} spinKey={tour.step} wave={tour.step === 0} mood={last ? 'party' : 'happy'} />
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-wide text-brand uppercase">{pick(tour.page.title, lang)} · {tour.step + 1}/{steps.length}</div>
            <div className="mt-0.5 text-lg font-extrabold text-ink">{pick(step.title, lang)}</div>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{pick(step.body, lang)}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={() => help.endTour(false)} className="min-h-11 rounded-md px-3 text-sm font-semibold text-ink-3 hover:bg-sunken">{t('Passer', 'Skip')}</button>
          <span className="flex-1" />
          {tour.step > 0 && <Button variant="outline" size="lg" onClick={() => help.setTourStep(tour.step - 1)}>{t('Retour', 'Back')}</Button>}
          <Button variant="brand" size="lg" onClick={next}>{last ? t('Terminé', 'Done') : t('Suivant', 'Next')}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
