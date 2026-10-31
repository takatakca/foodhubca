'use client';

// The Food Hub Assistant panel (left-docked, like the DoorDash Merchant Portal assistant):
//   - on each page it posts a summary and « Que voulez-vous faire ensuite ? » with 3–4 numbered next steps, plus the
//     page's notable signals as « Examiner » (Investigate this) chips;
//   - chat over every channel (Claude with read tools when set up, built-in answers otherwise), streamed;
//   - changes come back as approval cards (Approve / Dismiss) — never applied by the assistant;
//   - new chat, all chats (history per person), collapse, close; voice input (fr-CA by default, en-CA) where available.
// Non-modal: the page stays usable next to it. Keyboard: Enter sends, Shift+Enter new line, Esc collapses.
// Colours come from the theme tokens, so the kitchen screen's dark theme applies; the kitchen gets no summary or nudges.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowUp, ChevronLeft, CircleAlert, Languages, MessagesSquare, Mic, PanelLeftClose, Sparkles, Square, SquarePen, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PROMPT_CHIPS, type ChatSummary, type PageBrief, type ProposalView, type StreamEvent } from '@/lib/foodhub/assistant/types';
import { api } from '@/lib/ui/api';
import { cn } from '@/lib/ui/cn';
import { isKitchenRoute } from '@/lib/ui/kitchen-theme';
import { useI18n } from '@/lib/i18n/client';
import { ASK_EVENT, takePendingQuestion } from './open';
import { getAssistantPageContext } from './page-context';
import { ProposalCard } from './proposal-card';
import { useVoiceInput, type VoiceLang } from './voice';

type UiMessage = { id: string; role: 'user' | 'assistant'; text: string; proposals: ProposalView[]; suggestions?: PageBrief; error?: string; streaming?: boolean; source?: 'claude' | 'rules' };
type Item = { kind: 'brief'; key: string; route: string; brief: PageBrief; title: { fr: string; en: string } } | { kind: 'msg'; key: string; msg: UiMessage };

const INTRO_KEY = 'takatak.assistant.intro.v1';
let seq = 0;
const tmpId = () => `tmp-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return document.documentElement.dataset.motion === 'reduce' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Reads an NDJSON stream line by line. */
async function readNdjson(body: ReadableStream<Uint8Array>, onEvent: (e: StreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { onEvent(JSON.parse(line) as StreamEvent); } catch { /* skip a broken line */ } }
    }
  }
  if (buf.trim()) { try { onEvent(JSON.parse(buf) as StreamEvent); } catch { /* ignore */ } }
}

/** **bold** inside a line. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>));
}

/** Light markdown: paragraphs, bullet and numbered lists, **bold**. A numbered list right after "what next?" becomes tappable. */
function RichText({ text, onAsk }: { text: string; onAsk?: (q: string) => void }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0; let lastPara = '';
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const num = /^(\d+)[.)]\s+(.*)$/;
    const bullet = /^[-•*]\s+(.*)$/;
    if (num.test(line)) {
      const its: string[] = [];
      while (i < lines.length && num.test(lines[i].trim())) { its.push(lines[i].trim().replace(num, '$2')); i++; }
      const tappable = Boolean(onAsk) && /(ensuite|next)\s*\??\s*:?\s*$/i.test(lastPara);
      blocks.push(
        <ol key={`o${i}`} className="my-1.5 space-y-1.5">
          {its.map((t, k) => (
            <li key={k} className="flex gap-2">
              <span className="num text-small mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand-2" aria-hidden>{k + 1}</span>
              {tappable ? <button type="button" onClick={() => onAsk?.(t.replace(/\*\*/g, ''))} className="text-left font-semibold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">{inline(t)}</button> : <span>{inline(t)}</span>}
            </li>
          ))}
        </ol>,
      );
      lastPara = '';
      continue;
    }
    if (bullet.test(line)) {
      const its: string[] = [];
      while (i < lines.length && bullet.test(lines[i].trim())) { its.push(lines[i].trim().replace(bullet, '$1')); i++; }
      blocks.push(<ul key={`u${i}`} className="my-1.5 list-disc space-y-1 pl-5">{its.map((t, k) => <li key={k}>{inline(t)}</li>)}</ul>);
      lastPara = '';
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !num.test(lines[i].trim()) && !bullet.test(lines[i].trim())) { para.push(lines[i].trim()); i++; }
    lastPara = para.join(' ');
    blocks.push(<p key={`p${i}`} className="my-1.5">{inline(lastPara)}</p>);
  }
  return <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{blocks}</div>;
}

function BriefCard({ item, onAsk, fr }: { item: Extract<Item, { kind: 'brief' }>; onAsk: (q: string) => void; fr: boolean }) {
  const b = item.brief;
  return (
    <section className="rounded-xl border border-line bg-surface p-3.5" aria-label={fr ? `Résumé : ${item.title.fr}` : `Summary: ${item.title.en}`}>
      <div className="eyebrow mb-1.5 flex items-center gap-1.5 text-ink-3"><Sparkles className="size-3.5 text-brand" aria-hidden />{fr ? item.title.fr : item.title.en}</div>
      <p className="text-body text-ink">{fr ? b.summaryFr : b.summaryEn}</p>
      {b.signals.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {b.signals.map((s) => (
            <li key={s.id} className={cn('flex items-center justify-between gap-2 rounded-lg px-3 py-2', s.severity === 'critical' ? 'bg-stop-soft' : s.severity === 'warning' ? 'bg-wait-soft' : 'bg-info-soft')}>
              <span className="text-small flex items-start gap-1.5 text-ink"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{fr ? s.fr : s.en}</span>
              <button type="button" onClick={() => onAsk(fr ? s.questionFr : s.questionEn)} className="text-small h-9 shrink-0 rounded-md border border-line-2 bg-surface px-2.5 font-semibold text-ink hover:border-ink">{fr ? 'Examiner' : 'Investigate this'}</button>
            </li>
          ))}
        </ul>
      )}
      {b.steps.length > 0 && (
        <>
          <p className="text-small mt-3 font-semibold text-ink-2">{fr ? 'Que voulez-vous faire ensuite ?' : 'What do you want to do next?'}</p>
          <ol className="mt-1.5 space-y-1.5">
            {b.steps.map((s, k) => (
              <li key={k}>
                <button type="button" onClick={() => onAsk(fr ? s.askFr : s.askEn)} className="text-small flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-left font-semibold text-ink hover:border-ink-4">
                  <span className="num flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-micro font-bold text-brand-2" aria-hidden>{k + 1}</span>{fr ? s.fr : s.en}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {b.source === 'claude' && <div className="mt-2"><Badge tone="brand" size="sm">Claude</Badge></div>}
    </section>
  );
}

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const fr = lang === 'fr';
  const pathname = usePathname();
  const kitchen = isKitchenRoute(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<'chat' | 'chats'>('chat');
  const [chatId, setChatId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [toolLabel, setToolLabel] = useState<{ fr: string; en: string } | null>(null);
  const [q, setQ] = useState('');
  const [ai, setAi] = useState<boolean | null>(null);
  const [intro, setIntro] = useState(false);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [rot, setRot] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [voiceLang, setVoiceLang] = useState<VoiceLang>(lang === 'en' ? 'en-CA' : 'fr-CA');
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const chatIdRef = useRef<string | null>(null);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);

  // Focus: into the input when the panel opens or expands, back to where it was when the panel closes.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { abortRef.current?.abort(); if (before && before !== document.body && before.isConnected) before.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { if (!collapsed && view === 'chat') inputRef.current?.focus({ preventScroll: true }); }, [collapsed, view]);
  useEffect(() => { try { setIntro(localStorage.getItem(INTRO_KEY) !== '1'); } catch { setIntro(false); } }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'end' }); }, [items, toolLabel]);
  const hasUserMessages = items.some((x) => x.kind === 'msg' && x.msg.role === 'user');

  // Rotating prompt chips (still when less motion is asked, when typing or while answering).
  useEffect(() => {
    if (hasUserMessages || q || busy || collapsed || reducedMotion()) return;
    const id = window.setInterval(() => setRot((r) => (r + 1) % PROMPT_CHIPS.length), 6000);
    return () => window.clearInterval(id);
  }, [hasUserMessages, q, busy, collapsed]);

  // Page awareness: on every page (while the panel is open and not the kitchen), the summary + next steps.
  useEffect(() => {
    if (collapsed || view !== 'chat') return;
    if (kitchen) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const r = await fetch('/api/foodhub/assistant/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route: pathname, lang, extra: getAssistantPageContext(pathname), ai: true }), signal: ctrl.signal, cache: 'no-store' });
        if (r.status === 401) { window.location.reload(); return; }
        const body = await r.json().catch(() => null) as { ok?: boolean; brief?: PageBrief; aiConfigured?: boolean; snapshot?: { titleFr: string; titleEn: string } } | null;
        if (!body?.ok || !body.brief) return;
        setAi(Boolean(body.aiConfigured));
        const item: Item = { kind: 'brief', key: `b-${pathname}-${Date.now()}`, route: pathname, brief: body.brief, title: { fr: body.snapshot?.titleFr ?? '', en: body.snapshot?.titleEn ?? '' } };
        setItems((cur) => {
          const last = cur[cur.length - 1];
          if (last?.kind === 'brief') return [...cur.slice(0, -1), item];
          return [...cur, item];
        });
      } catch { /* the summary is a bonus: the chat still works */ }
    }, 350);
    return () => { ctrl.abort(); window.clearTimeout(timer); };
  }, [pathname, lang, collapsed, view, kitchen, nonce]);

  const patchMsg = useCallback((id: string, f: (m: UiMessage) => UiMessage) => {
    setItems((cur) => cur.map((x) => (x.kind === 'msg' && x.msg.id === id ? { ...x, msg: f(x.msg) } : x)));
  }, []);

  const ask = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setView('chat'); setCollapsed(false); setQ(''); setBusy(true);
    const userMsg: UiMessage = { id: tmpId(), role: 'user', text, proposals: [] };
    const aiId = tmpId();
    setItems((cur) => [...cur, { kind: 'msg', key: userMsg.id, msg: userMsg }, { kind: 'msg', key: aiId, msg: { id: aiId, role: 'assistant', text: '', proposals: [], streaming: true } }]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/foodhub/assistant/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: ctrl.signal,
        body: JSON.stringify({ question: text, chatId: chatIdRef.current, route: pathname, extra: getAssistantPageContext(pathname), lang }),
      });
      if (res.status === 401) { window.location.reload(); return; }
      if (!res.ok || !res.body) { const b = await res.json().catch(() => ({})) as { error?: string }; throw new Error(b.error ?? `HTTP ${res.status}`); }
      await readNdjson(res.body, (e) => {
        if (e.type === 'start') { setChatId(e.chatId); chatIdRef.current = e.chatId; setAi(e.aiConfigured); patchMsg(aiId, (m) => ({ ...m, source: e.source })); }
        else if (e.type === 'text') { setToolLabel(null); patchMsg(aiId, (m) => ({ ...m, text: m.text + e.delta })); }
        else if (e.type === 'tool') setToolLabel({ fr: e.fr, en: e.en });
        else if (e.type === 'proposal') patchMsg(aiId, (m) => ({ ...m, proposals: [...m.proposals, e.proposal] }));
        else if (e.type === 'brief') patchMsg(aiId, (m) => ({ ...m, suggestions: e.brief }));
        else if (e.type === 'error') patchMsg(aiId, (m) => ({ ...m, error: fr ? e.messageFr : e.message }));
      });
    } catch (e) {
      const stopped = ctrl.signal.aborted;
      patchMsg(aiId, (m) => ({ ...m, error: stopped ? t('Réponse arrêtée.', 'Answer stopped.') : e instanceof Error ? e.message : String(e) }));
    } finally {
      busyRef.current = false;
      setBusy(false); setToolLabel(null);
      patchMsg(aiId, (m) => ({ ...m, streaming: false }));
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [fr, lang, pathname, patchMsg, t]);

  // A question from a nudge or another screen (openAssistant): asked as soon as the panel is here.
  useEffect(() => {
    const pending = takePendingQuestion();
    if (pending) void ask(pending);
    const onAsk = (e: Event) => { takePendingQuestion(); const qq = (e as CustomEvent<{ question?: string }>).detail?.question; if (qq) void ask(qq); };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on mount; `ask` reads fresh values through refs
  }, []);

  const voice = useVoiceInput({ onText: (text, final) => { setQ(text); if (final && text) inputRef.current?.focus(); } });

  function newChat() {
    abortRef.current?.abort();
    setChatId(null); chatIdRef.current = null; setItems([]); setView('chat'); setNonce((n) => n + 1);
  }
  async function openChats() {
    setView('chats'); setChats(null); setChatsError(null);
    try { setChats((await api<{ chats: ChatSummary[] }>('/api/foodhub/assistant/chats')).chats); } catch (e) { setChatsError(e instanceof Error ? e.message : String(e)); }
  }
  async function openChat(id: string) {
    abortRef.current?.abort();
    try {
      const r = await api<{ chat: { id: string; messages: Array<{ id: string; role: 'user' | 'assistant'; text: string; proposals?: ProposalView[]; source?: 'claude' | 'rules' }> } }>(`/api/foodhub/assistant/chats?id=${encodeURIComponent(id)}`);
      setChatId(r.chat.id); chatIdRef.current = r.chat.id;
      setItems(r.chat.messages.map((m) => ({ kind: 'msg', key: m.id, msg: { id: m.id, role: m.role, text: m.text, proposals: m.proposals ?? [], source: m.source } })));
      setView('chat');
    } catch (e) { setChatsError(e instanceof Error ? e.message : String(e)); }
  }
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { e.stopPropagation(); setCollapsed(true); }
  }
  const updateProposal = (msgId: string) => (p: ProposalView) => patchMsg(msgId, (m) => ({ ...m, proposals: m.proposals.map((x) => (x.id === p.id ? p : x)) }));

  if (collapsed) {
    return (
      <button type="button" onClick={() => setCollapsed(false)} aria-expanded={false} aria-label={t('Ouvrir l’assistant', 'Open Assistant')}
        className="text-body fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 z-[60] flex h-12 items-center gap-2 rounded-full bg-rail px-4 font-semibold text-white shadow-pop hover:bg-rail-2 lg:bottom-6">
        <Sparkles className="size-5 text-electric" aria-hidden />{t('Assistant', 'Assistant')}
        {busy && <span className="size-2 rounded-full bg-electric motion-safe:animate-pulse-soft" aria-hidden />}
      </button>
    );
  }

  const chipStart = rot % PROMPT_CHIPS.length;
  const chips = [0, 1, 2].map((k) => PROMPT_CHIPS[(chipStart + k) % PROMPT_CHIPS.length]);
  const iconBtn = 'flex size-11 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink';

  return (
    <aside role="complementary" aria-label={t('Assistant Food Hub', 'Food Hub Assistant')} onKeyDown={onKeyDown}
      className="fixed inset-y-0 left-0 z-[60] flex h-dvh w-full flex-col border-r border-line bg-canvas text-ink shadow-pop motion-safe:animate-fade sm:w-[420px]">
      <header className="flex items-center gap-1 border-b border-line bg-surface px-3 py-2">
        {view === 'chats'
          ? <button type="button" onClick={() => setView('chat')} className={iconBtn} aria-label={t('Retour à la conversation', 'Back to the chat')}><ChevronLeft className="size-5" aria-hidden /></button>
          : <Sparkles className="ml-1.5 size-5 shrink-0 text-brand" aria-hidden />}
        <h2 className="text-title ml-1 flex-1 truncate text-ink">{view === 'chats' ? t('Toutes les conversations', 'All chats') : t('Assistant', 'Assistant')} {view === 'chat' && <Badge tone="info" size="sm">{t('bêta', 'beta')}</Badge>}</h2>
        <button type="button" onClick={newChat} className={iconBtn} aria-label={t('Nouvelle conversation', 'Start new chat')} title={t('Nouvelle conversation', 'Start new chat')}><SquarePen className="size-5" aria-hidden /></button>
        <button type="button" onClick={openChats} className={iconBtn} aria-label={t('Toutes les conversations', 'All chats')} title={t('Toutes les conversations', 'All chats')}><MessagesSquare className="size-5" aria-hidden /></button>
        <button type="button" onClick={() => setCollapsed(true)} className={iconBtn} aria-label={t('Réduire', 'Collapse')} title={t('Réduire', 'Collapse')}><PanelLeftClose className="size-5" aria-hidden /></button>
        <button type="button" onClick={onClose} className={iconBtn} aria-label={t('Fermer', 'Close')} title={t('Fermer', 'Close')}><X className="size-5" aria-hidden /></button>
      </header>

      {view === 'chats' ? (
        <div className="scrollbar-thin flex-1 overflow-y-auto p-3">
          {chatsError && <p className="text-small text-stop" role="alert">{chatsError}</p>}
          {!chats && !chatsError && <p className="text-small text-ink-3" role="status">{t('Chargement…', 'Loading…')}</p>}
          {chats && !chats.length && <p className="text-small text-ink-3">{t('Aucune conversation pour l’instant.', 'No chats yet.')}</p>}
          {chats && chats.length > 0 && (
            <ul className="space-y-1.5">
              {chats.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => openChat(c.id)} aria-current={c.id === chatId ? 'true' : undefined}
                    className={cn('flex min-h-12 w-full flex-col items-start rounded-lg border px-3 py-2 text-left hover:border-ink-4', c.id === chatId ? 'border-ink bg-surface' : 'border-line bg-surface')}>
                    <span className="text-body font-semibold text-ink">{c.title}</span>
                    <span className="text-micro text-ink-3">{new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(c.updatedAt))} · {c.messages} {t('messages', 'messages')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-3">
          <div role="log" aria-live="polite" aria-relevant="additions" aria-busy={busy} className="space-y-3">
            {intro && (
              <section className="rounded-xl bg-rail p-4 text-white" aria-label={t('Présentation', 'Introduction')}>
                <p className="text-body font-semibold">{t('Je trouve ce qui freine vos magasins et je prépare les correctifs. Vous approuvez d’un geste : rien ne change sans vous.', 'I find what’s holding your stores back and prepare the fix. You approve in one tap: nothing changes without you.')}</p>
                <p className="text-small mt-1.5 text-white/75">{t('Uber Eats, DoorDash, Skip, Too Good To Go, vos sites web, le téléphone et Clover, au même endroit.', 'Uber Eats, DoorDash, Skip, Too Good To Go, your websites, phone orders and Clover, in one place.')}</p>
                <button type="button" onClick={() => { setIntro(false); try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* ignore */ } }} className="text-small mt-3 h-10 rounded-md bg-white/15 px-3 font-semibold hover:bg-white/25">{t('Compris', 'Got it')}</button>
              </section>
            )}
            {kitchen && <p className="text-small rounded-lg bg-sunken px-3 py-2 text-ink-2">{t('Écran cuisine : pas de résumé ici, mais vous pouvez poser une question.', 'Kitchen screen: no summary here, but you can still ask a question.')}</p>}
            {items.map((it) => it.kind === 'brief'
              ? <BriefCard key={it.key} item={it} onAsk={ask} fr={fr} />
              : (
                <div key={it.key} className={cn('flex', it.msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {it.msg.role === 'user'
                    ? <div className="text-body max-w-[88%] whitespace-pre-line rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-canvas">{it.msg.text}</div>
                    : (
                      <div className="w-full max-w-full space-y-2.5">
                        {(it.msg.text || it.msg.streaming) && (
                          <div className="text-body rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-ink">
                            {it.msg.text ? <RichText text={it.msg.text} onAsk={busy ? undefined : ask} /> : <span className="flex gap-1 py-1" aria-label={t('Réponse en cours', 'Answering')}><span className="size-2 rounded-full bg-ink-4 motion-safe:animate-bounce" /><span className="size-2 rounded-full bg-ink-4 motion-safe:animate-bounce [animation-delay:.1s]" /><span className="size-2 rounded-full bg-ink-4 motion-safe:animate-bounce [animation-delay:.2s]" /></span>}
                            {it.msg.source && !it.msg.streaming && <div className="mt-1.5"><Badge tone={it.msg.source === 'claude' ? 'brand' : 'neutral'} size="sm">{it.msg.source === 'claude' ? 'Claude' : t('Réponse intégrée', 'Built-in answer')}</Badge></div>}
                          </div>
                        )}
                        {it.msg.proposals.map((p) => <ProposalCard key={p.id} proposal={p} onChange={updateProposal(it.msg.id)} />)}
                        {it.msg.suggestions && it.msg.suggestions.steps.length > 0 && <BriefCard item={{ kind: 'brief', key: `${it.key}-s`, route: pathname, brief: { ...it.msg.suggestions, summaryFr: t('Suggestions intégrées pour cette page.', 'Built-in suggestions for this page.'), summaryEn: 'Built-in suggestions for this page.' }, title: { fr: 'Suggestions', en: 'Suggestions' } }} onAsk={ask} fr={fr} />}
                        {it.msg.error && <p className="text-small flex items-start gap-1.5 text-stop" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{it.msg.error}</p>}
                      </div>
                    )}
                </div>
              ))}
          </div>
          <div role="status" aria-live="polite" className="text-small mt-2 min-h-5 text-ink-3">{toolLabel ? (fr ? toolLabel.fr : toolLabel.en) : ''}</div>
          <div ref={endRef} />
        </div>
      )}

      {view === 'chat' && (
        <footer className="safe-bottom border-t border-line bg-surface px-3 pt-2.5 pb-2">
          {!hasUserMessages && (
            <div className="mb-2 flex flex-wrap gap-1.5" aria-label={t('Suggestions', 'Suggestions')}>
              {chips.map((c) => <button key={c.en} type="button" onClick={() => ask(fr ? c.fr : c.en)} className="text-small h-9 rounded-full border border-line-2 bg-canvas px-3 font-semibold text-ink hover:border-ink">{fr ? c.fr : c.en}</button>)}
            </div>
          )}
          <form className="flex items-end gap-1.5" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
            <label htmlFor="assistant-input" className="sr-only">{t('Votre question', 'Your question')}</label>
            <textarea id="assistant-input" ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} rows={1} maxLength={2000}
              placeholder={t('Posez n’importe quelle question…', 'Ask anything...')}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(q); } }}
              className="text-body max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-line-2 bg-canvas px-3 py-2.5 text-ink outline-none focus:border-ink" />
            {voice.supported && (
              <>
                <button type="button" onClick={() => setVoiceLang((v) => (v === 'fr-CA' ? 'en-CA' : 'fr-CA'))} className="text-micro flex h-11 w-9 shrink-0 flex-col items-center justify-center rounded-md font-bold text-ink-3 hover:bg-sunken hover:text-ink"
                  aria-label={voiceLang === 'fr-CA' ? t('Langue de la dictée : français. Passer à l’anglais', 'Voice language: French. Switch to English') : t('Langue de la dictée : anglais. Passer au français', 'Voice language: English. Switch to French')}>
                  <Languages className="size-4" aria-hidden />{voiceLang === 'fr-CA' ? 'FR' : 'EN'}
                </button>
                <button type="button" onClick={() => (voice.recording ? voice.stop() : voice.start(voiceLang))} aria-pressed={voice.recording}
                  aria-label={voice.recording ? t('Arrêter la dictée', 'Stop recording') : t('Dicter la question', 'Record your question')}
                  className={cn('flex size-11 shrink-0 items-center justify-center rounded-lg border', voice.recording ? 'border-stop bg-stop-soft text-stop' : 'border-line-2 text-ink-2 hover:border-ink')}>
                  <Mic className="size-5" aria-hidden />
                </button>
              </>
            )}
            {busy
              ? <button type="button" onClick={() => abortRef.current?.abort()} className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-ink text-canvas" aria-label={t('Arrêter la réponse', 'Stop the answer')}><Square className="size-4" aria-hidden /></button>
              : <button type="submit" disabled={!q.trim()} className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-ink text-canvas disabled:opacity-40" aria-label={t('Envoyer', 'Send')}><ArrowUp className="size-5" aria-hidden /></button>}
          </form>
          <p className="sr-only" role="status" aria-live="polite">{voice.recording ? t('Dictée en cours…', 'Recording…') : voice.error === 'denied' ? t('Micro refusé par le navigateur.', 'Microphone blocked by the browser.') : ''}</p>
          {voice.error === 'denied' && <p className="text-micro mt-1 text-stop">{t('Micro refusé par le navigateur : tapez votre question.', 'Microphone blocked by the browser: type your question.')}</p>}
          {ai === false && <p className="text-micro mt-1.5 text-ink-3">{t('IA non configurée : réponses et suggestions intégrées seulement.', 'AI is not set up: built-in answers and suggestions only.')}</p>}
          <p className="text-micro mt-1 text-center text-ink-4">{t('Utilise l’IA, peut contenir des inexactitudes.', 'Uses AI, may contain inaccuracies.')}</p>
        </footer>
      )}
    </aside>
  );
}
