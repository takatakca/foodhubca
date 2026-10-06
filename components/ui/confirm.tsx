'use client';

// A confirm sheet instead of the browser's window.confirm(): big buttons, plain words, says what will happen,
// works the same on a tablet, a phone and a desktop.  const ok = await confirm({ title, body, confirmLabel, tone }).
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/components/ui/overlay';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/client';

export type ConfirmOptions = { title: string; body?: ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: 'danger' | 'primary' };
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
const ConfirmCtx = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<Pending | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => {
    ref.current?.resolve(false);
    const p = { ...o, resolve };
    ref.current = p;
    setPending(p);
  }), []);
  const close = (ok: boolean) => { ref.current?.resolve(ok); ref.current = null; setPending(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {pending && (
        <Modal title={pending.title} size="sm" onClose={() => close(false)}
          footer={<>
            <Button variant="ghost" size="lg" onClick={() => close(false)}>{pending.cancelLabel ?? t('Annuler', 'Cancel')}</Button>
            <Button variant={pending.tone === 'danger' ? 'danger' : 'primary'} size="lg" autoFocus onClick={() => close(true)}>{pending.confirmLabel ?? t('Continuer', 'Continue')}</Button>
          </>}>
          {pending.body ? <div className="text-[15px] leading-relaxed text-ink-2">{pending.body}</div> : null}
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const c = useContext(ConfirmCtx);
  if (!c) throw new Error('useConfirm outside ConfirmProvider');
  return c;
}
