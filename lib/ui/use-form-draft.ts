'use client';

// Pop-up and one-shot forms (a team member, a deposit, a dispute, a store link, a day of Too Good To Go bags…):
// what was typed survives closing the pop-up by mistake, a reload, a crash or a dead battery.
//   - Every change is kept on this device at once (per person and per form, never shown to someone else).
//   - Opening the same form again brings it back, with a note and a "Discard" button.
//   - Nothing is sent anywhere until the person presses the form's own button; a successful save forgets the draft.
//   - Drafts expire with the other drafts (autosave-core) and are cleared on sign-out.
import { useCallback, useEffect, useState } from 'react';
import { clearDraft, readDraft, sameValue, writeDraft } from '@/lib/ui/autosave-core';

const store = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };

/** Draft id of a form: one per screen and per record ('team:new', 'team:marie', 'deposit:new'). */
export const formDraftId = (form: string, record?: string | null) => `form:${form}:${record || 'new'}`;

export interface FormDraft<T> {
  value: T;
  set: (next: T | ((prev: T) => T)) => void;
  /** A kept draft was put back when the form opened. */
  restored: boolean;
  /** Something typed is not saved yet (closing keeps it). */
  dirty: boolean;
  /** After a successful save: forget the draft. */
  clear: () => void;
  /** Throw the draft away and go back to the starting values. */
  discard: () => void;
}

/**
 * @param form   formDraftId(...) — stable while the form is open
 * @param user   the signed-in person (drafts are per person on a shared tablet); '' disables drafts
 * @param initial the starting values (from the record being edited, or empty)
 */
export function useFormDraft<T>(form: string, user: string, initial: T, opts: { enabled?: boolean } = {}): FormDraft<T> {
  const enabled = opts.enabled !== false && !!user;
  const id = `${user}\u0000${form}`;
  // base = the starting (or last saved) values; loaded = which form/person the state belongs to.
  const [st, setSt] = useState<{ loaded: string | null; base: T; value: T; restored: boolean }>({ loaded: null, base: initial, value: initial, restored: false });

  // Restore after mount (never during render: the server render has no drafts). `initial` is read once per form on
  // purpose: a parent re-render with a new object must never wipe what is being typed.
  useEffect(() => {
    const d = enabled ? readDraft<T>(store(), user, form) : null;
    const restore = !!d && !sameValue(d.value, initial);
    if (d && !restore) clearDraft(store(), user, form);
    setSt({ loaded: id, base: initial, value: restore ? (d as { value: T }).value : initial, restored: restore });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled]);

  // Every change: kept on this device at once, or forgotten when it is back to the starting values.
  useEffect(() => {
    if (!enabled || st.loaded !== id) return;
    if (sameValue(st.value, st.base)) clearDraft(store(), user, form);
    else writeDraft(store(), user, form, st.value);
  }, [st, id, enabled, user, form]);

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setSt((s) => ({ ...s, value: typeof next === 'function' ? (next as (p: T) => T)(s.value) : next }));
  }, []);
  /** Saved: what is on screen becomes the starting point, the draft is gone. */
  const clear = useCallback(() => { clearDraft(store(), user, form); setSt((s) => ({ ...s, base: s.value, restored: false })); }, [user, form]);
  const discard = useCallback(() => { clearDraft(store(), user, form); setSt((s) => ({ ...s, value: s.base, restored: false })); }, [user, form]);

  return { value: st.value, set, restored: st.restored, dirty: !sameValue(st.value, st.base), clear, discard };
}
