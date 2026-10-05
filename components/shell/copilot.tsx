'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { Drawer } from '@/components/ui/overlay';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type Msg = { who: 'me' | 'ai'; text: string; source?: string };

/** Ask the business anything — answers come from today's live data (Claude when configured). */
export function CopilotDrawer({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  const suggestions = lang === 'fr'
    ? ['Qu’est-ce qui ne va pas en ce moment ?', 'Combien on a vendu aujourd’hui ?', 'Des commandes en retard ?', 'Les tablettes sont-elles en ligne ?', 'Combien d’argent à récupérer ?']
    : ['What is wrong right now?', 'How much did we sell today?', 'Any late orders?', 'Are the tablets online?', 'How much money to recover?'];
  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setMsgs((m) => [...m, { who: 'me', text: question.trim() }]);
    setQ(''); setBusy(true);
    try {
      const r = await api<{ answer: string; source: string }>('/api/foodhub/copilot', { method: 'POST', json: { question, lang } });
      setMsgs((m) => [...m, { who: 'ai', text: r.answer, source: r.source }]);
    } catch (e) {
      setMsgs((m) => [...m, { who: 'ai', text: e instanceof Error ? e.message : String(e) }]);
    } finally { setBusy(false); }
  }
  return (
    <Drawer onClose={onClose} width="md" title={<span className="flex items-center gap-2"><Sparkles className="size-5 text-brand" />{t('Copilote', 'Co-pilot')}</span>}
      subtitle={t('Répond avec les données en direct. Ne fait aucune action à votre place.', 'Answers from live data. Never takes actions for you.')}
      footer={
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={1} placeholder={t('Posez une question…', 'Ask a question…')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } }}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-line-2 bg-surface px-3 py-2.5 text-sm outline-none focus:border-ink" />
          <button type="submit" disabled={!q.trim() || busy} className="flex size-11 items-center justify-center rounded-lg bg-ink text-canvas disabled:opacity-40" aria-label={t('Envoyer', 'Send')}><ArrowUp className="size-5" /></button>
        </form>
      }>
      <div className="space-y-3 p-5">
        {msgs.length === 0 && (
          <div>
            <div className="mb-3 text-sm text-ink-3">{t('Essayez :', 'Try:')}</div>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => <button key={s} type="button" onClick={() => ask(s)} className="rounded-lg border border-line bg-surface px-3.5 py-2.5 text-left text-sm font-semibold text-ink hover:border-ink-4">{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn('flex', m.who === 'me' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[88%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line', m.who === 'me' ? 'rounded-br-md bg-ink text-canvas' : 'rounded-bl-md border border-line bg-surface text-ink')}>
              {m.text}
              {m.source && <div className="mt-1.5"><Badge tone={m.source === 'claude' ? 'brand' : 'neutral'}>{m.source === 'claude' ? 'Claude' : t('Réponse intégrée', 'Built-in answer')}</Badge></div>}
            </div>
          </div>
        ))}
        {busy && <div className="flex gap-1 px-2"><span className="size-2 animate-bounce rounded-full bg-ink-4" /><span className="size-2 animate-bounce rounded-full bg-ink-4 [animation-delay:.1s]" /><span className="size-2 animate-bounce rounded-full bg-ink-4 [animation-delay:.2s]" /></div>}
        <div ref={end} />
      </div>
    </Drawer>
  );
}
