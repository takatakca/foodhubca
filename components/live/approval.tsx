'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Modal } from '@/components/ui/overlay';
import { PinPad } from '@/components/ui/pin-pad';
import { setApprovalHandler, type ApprovalRequest } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

/** Shows the manager-PIN keypad whenever the server answers 428 (see lib/ui/api.ts). */
export function ApprovalProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const [req, setReq] = useState<ApprovalRequest | null>(null);
  const [attempt, setAttempt] = useState(0);
  const resolver = useRef<((pin: string | null) => void) | null>(null);

  useEffect(() => {
    setApprovalHandler((r) => new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setAttempt((a) => a + 1);
      setReq(r);
    }));
    return () => setApprovalHandler(null);
  }, []);

  const finish = useCallback((pin: string | null) => {
    resolver.current?.(pin);
    resolver.current = null;
    setReq(null);
  }, []);

  return (
    <>
      {children}
      {req && (
        <Modal onClose={() => finish(null)} size="sm" title={<span className="flex items-center gap-2"><ShieldCheck className="size-5 text-brand" />{t('NIP du gérant', 'Manager PIN')}</span>}
          subtitle={(lang === 'fr' ? req.labelFr : req.label) || t('Cette action demande l’accord d’un gérant.', 'This action needs a manager’s approval.')}>
          <p className="mb-4 text-center text-sm text-ink-3">{t('Un gérant entre son NIP pour approuver. Tout est noté au journal.', 'A manager enters their PIN to approve. Everything is logged.')}</p>
          <PinPad key={attempt} onDone={(pin) => finish(pin)} error={req.wrongPin ? t('NIP refusé — réessayez', 'PIN refused — try again') : null} />
        </Modal>
      )}
    </>
  );
}
