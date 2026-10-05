'use client';

import { useState } from 'react';
import { Modal } from './overlay';
import { Button } from './button';
import { Input } from './form';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

export const REASONS: Array<{ code: string; fr: string; en: string; emoji: string }> = [
  { code: 'out_of_stock', fr: 'Article en rupture', en: 'Item out of stock', emoji: '🥡' },
  { code: 'too_busy', fr: 'Cuisine débordée', en: 'Kitchen too busy', emoji: '🔥' },
  { code: 'store_closed', fr: 'Cuisine fermée', en: 'Kitchen closed', emoji: '🔒' },
  { code: 'pos_issue', fr: 'Problème Clover / caisse', en: 'Clover / POS problem', emoji: '🧾' },
  { code: 'customer_request', fr: 'Le client a demandé', en: 'Customer asked', emoji: '🙋' },
  { code: 'other', fr: 'Autre raison', en: 'Other', emoji: '•••' },
];

/** Why are you rejecting / cancelling? Big buttons; the reason is mapped to each platform's own code. */
export function ReasonDialog({ title, note, confirmLabel, onPick, onClose, busy }: { title: string; note?: string; confirmLabel?: string; onPick: (code: string, details: string) => void; onClose: () => void; busy?: boolean }) {
  const t = useT();
  const [code, setCode] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  return (
    <Modal title={title} subtitle={note} onClose={onClose} size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('Retour', 'Back')}</Button>
        <Button variant="danger" size="lg" disabled={!code || (code === 'other' && !details.trim())} loading={busy} onClick={() => code && onPick(code, details.trim())}>{confirmLabel ?? t('Confirmer', 'Confirm')}</Button>
      </>}>
      <div className="grid grid-cols-2 gap-2">
        {REASONS.map((r) => (
          <button key={r.code} type="button" onClick={() => setCode(r.code)} aria-pressed={code === r.code}
            className={cn('flex min-h-16 items-center gap-3 rounded-lg border-2 px-3.5 py-3 text-left text-sm font-bold transition-colors', code === r.code ? 'border-stop bg-stop-soft text-ink' : 'border-line bg-surface text-ink-2 hover:border-ink-4')}>
            <span className="text-xl" aria-hidden>{r.emoji}</span>{t(r.fr, r.en)}
          </button>
        ))}
      </div>
      <Input className="mt-3" placeholder={t('Détails (optionnel — obligatoire pour « Autre »)', 'Details (optional — required for “Other”)')} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={200} />
    </Modal>
  );
}
