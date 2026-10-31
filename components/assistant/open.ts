'use client';

// Opening the assistant from anywhere (a nudge's « Examiner » / "Investigate this", a page button):
//   openAssistant('Why so many cancellations?')
// The console shell already opens the panel on the `takatak:copilot` event; the question waits here until the panel
// reads it (or goes straight in when the panel is already open, through `takatak:assistant-ask`).
let pending: string | null = null;

export const ASK_EVENT = 'takatak:assistant-ask';
export const OPEN_EVENT = 'takatak:copilot';

export function openAssistant(question?: string): void {
  if (typeof window === 'undefined') return;
  const q = question?.trim() || null;
  pending = q;
  window.dispatchEvent(new Event(OPEN_EVENT));
  if (q) window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { question: q } }));
}

/** The question waiting for the panel (read once). */
export function takePendingQuestion(): string | null {
  const q = pending;
  pending = null;
  return q;
}
