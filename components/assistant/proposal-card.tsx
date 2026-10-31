'use client';

// One approval card: exactly what will change and where, then Approve / Dismiss. Approve calls Food Hub's gated route
// as the signed-in person (the manager-PIN prompt appears when the policy asks for it); nothing happens before the tap.
import { useState } from 'react';
import { Check, CircleAlert, ShieldCheck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ProposalView } from '@/lib/foodhub/assistant/types';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

const STATUS_TONE = { pending: 'wait', approved: 'go', dismissed: 'neutral', failed: 'stop' } as const;

export function ProposalCard({ proposal, onChange }: { proposal: ProposalView; onChange: (p: ProposalView) => void }) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fr = lang === 'fr';
  const p = proposal;
  const statusLabel = { pending: t('À approuver', 'Waiting for you'), approved: t('Approuvé', 'Approved'), dismissed: t('Écarté', 'Dismissed'), failed: t('Non appliqué', 'Not applied') }[p.status];
  async function decide(decision: 'approve' | 'dismiss') {
    setBusy(decision); setError(null);
    try {
      const r = await api<{ proposal: ProposalView }>(`/api/foodhub/assistant/proposals/${p.id}`, { method: 'POST', json: { decision } });
      onChange(r.proposal);
    } catch (e) {
      if (e instanceof ApiError && e.status === 499) { setBusy(null); return; } // PIN prompt cancelled: still pending
      const body = e instanceof ApiError ? e.body : {};
      if (body && typeof body === 'object' && 'proposal' in body && body.proposal) onChange(body.proposal as ProposalView);
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }
  const titleId = `proposal-${p.id}`;
  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-line-2 bg-surface p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 id={titleId} className="text-body font-bold text-ink">{fr ? p.titleFr : p.titleEn}</h3>
        <Badge tone={STATUS_TONE[p.status]} size="sm">{statusLabel}</Badge>
      </div>
      <ul className="mt-2.5 space-y-2" aria-label={t('Ce qui va changer', 'What will change')}>
        {p.changes.map((c, i) => (
          <li key={i} className="rounded-lg bg-sunken px-3 py-2">
            <div className="text-small font-semibold text-ink">{fr ? c.fr : c.en}</div>
            <div className="text-micro text-ink-3">{fr ? c.whereFr : c.whereEn}</div>
            <div className="text-small mt-1 flex flex-wrap items-center gap-1.5">
              {(fr ? c.fromFr : c.fromEn) && <><span className="text-ink-3 line-through decoration-ink-4">{fr ? c.fromFr : c.fromEn}</span><span aria-hidden className="text-ink-4">→</span><span className="sr-only">{t('devient', 'becomes')}</span></>}
              <span className="font-bold text-ink">{fr ? c.toFr : c.toEn}</span>
            </div>
          </li>
        ))}
      </ul>
      {(fr ? p.notesFr : p.notesEn).length > 0 && (
        <ul className="text-micro mt-2 space-y-1 text-ink-3">
          {(fr ? p.notesFr : p.notesEn).map((n, i) => <li key={i} className="flex gap-1.5"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{n}</li>)}
        </ul>
      )}
      {p.status === 'pending' ? (
        <>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="md" className="flex-1" loading={busy === 'approve'} disabled={busy !== null} icon={<Check className="size-4" aria-hidden />} onClick={() => decide('approve')}>{t('Approuver', 'Approve')}</Button>
            <Button variant="outline" size="md" loading={busy === 'dismiss'} disabled={busy !== null} icon={<X className="size-4" aria-hidden />} onClick={() => decide('dismiss')}>{t('Écarter', 'Dismiss')}</Button>
          </div>
          <p className="text-micro mt-2 flex items-center gap-1.5 text-ink-3"><ShieldCheck className="size-3.5" aria-hidden />{t('Rien ne change avant votre approbation. Votre rôle est vérifié ; un NIP de gérant peut être demandé.', 'Nothing changes until you approve. Your role is checked; a manager PIN may be asked.')}</p>
        </>
      ) : (fr ? p.resultFr : p.resultEn) ? <p className="text-small mt-2.5 text-ink-2" role="status">{fr ? p.resultFr : p.resultEn}</p> : null}
      {error && <p className="text-small mt-2 text-stop" role="alert">{error}</p>}
    </section>
  );
}
