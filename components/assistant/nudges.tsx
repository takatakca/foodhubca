'use client';

// Floating nudges: when the page has a notable signal (cancellation spike, menu errors, store paused, tablet off…), a
// small chip « Examiner » / "Investigate this" opens the assistant with that question. Ready to mount once in the console
// shell (one line, next to <CopilotDrawer/>): <AssistantNudges hidden={copilotOpen} />. Until then the same signals
// show inside the panel's page summary. Kitchen screen: never shown. Refreshes every 2 minutes and on page change.
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';
import type { PageSignal } from '@/lib/foodhub/assistant/types';
import { useI18n } from '@/lib/i18n/client';
import { isKitchenRoute } from '@/lib/ui/kitchen-theme';
import { cn } from '@/lib/ui/cn';
import { openAssistant } from './open';

const DISMISSED = 'takatak.assistant.nudges.dismissed';

function dismissedIds(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(DISMISSED) ?? '[]') as string[]); } catch { return new Set(); }
}

export function AssistantNudges({ hidden = false }: { hidden?: boolean }) {
  const { lang, t } = useI18n();
  const fr = lang === 'fr';
  const pathname = usePathname();
  const [signal, setSignal] = useState<PageSignal | null>(null);
  const kitchen = isKitchenRoute(pathname);

  useEffect(() => {
    if (kitchen || hidden) { setSignal(null); return; }
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch('/api/foodhub/assistant/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route: pathname, lang }), cache: 'no-store' });
        const body = await r.json().catch(() => null) as { ok?: boolean; brief?: { signals: PageSignal[] } } | null;
        if (stop || !body?.ok) return;
        const off = dismissedIds();
        setSignal(body.brief?.signals.find((s) => !off.has(`${pathname}|${s.id}`)) ?? null);
      } catch { /* a nudge is a bonus */ }
    };
    void load();
    const id = window.setInterval(load, 120_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [pathname, lang, kitchen, hidden]);

  if (!signal || hidden || kitchen) return null;
  const dismiss = () => {
    try { const off = dismissedIds(); off.add(`${pathname}|${signal.id}`); sessionStorage.setItem(DISMISSED, JSON.stringify([...off])); } catch { /* ignore */ }
    setSignal(null);
  };
  return (
    <div role="status" className={cn('fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 flex max-w-sm items-center gap-2 rounded-xl border border-line bg-surface py-2 pr-1 pl-3 shadow-pop motion-safe:animate-rise lg:bottom-6')}>
      <Sparkles className="size-4 shrink-0 text-brand" aria-hidden />
      <span className="text-small text-ink">{fr ? signal.fr : signal.en}</span>
      <button type="button" onClick={() => openAssistant(fr ? signal.questionFr : signal.questionEn)} className="text-small h-9 shrink-0 rounded-md bg-ink px-2.5 font-semibold text-canvas">{fr ? 'Examiner' : 'Investigate this'}</button>
      <button type="button" onClick={dismiss} className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink" aria-label={t('Masquer', 'Dismiss')}><X className="size-4" aria-hidden /></button>
    </div>
  );
}
