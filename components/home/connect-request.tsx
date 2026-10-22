'use client';

// "Demander le branchement": in the simple view a client cannot connect a platform store alone (the store ids and the
// platform setup are a technician's job), so the step's button asks the team to do it. It sends the same support report
// as the help drawer ("Envoyer un rapport à l'équipe": stored, and written to the Activity Log), with the platforms
// picked here, and says plainly what happens next.
import { useState, type ReactNode } from 'react';
import { CircleCheck, Plug, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chips, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { channelName, CHANNEL_ORDER } from '@/lib/foodhub/scope';
import { flush } from '@/lib/ui/supervisor';
import { useI18n } from '@/lib/i18n/client';

const PLATFORMS = [...CHANNEL_ORDER, 'clover'] as const;
const nameOf = (p: string) => (p === 'clover' ? 'Clover' : channelName(p));

/** The text the team receives (kept under the report's 500 characters). */
export function connectRequestNote(platforms: readonly string[], note: string): string {
  const list = platforms.length ? platforms.map(nameOf).join(', ') : 'toutes mes plateformes';
  return `Brancher mes magasins : ${list}${note.trim() ? ` — ${note.trim()}` : ''}`.slice(0, 500);
}

export function ConnectRequestButton({ variant = 'primary', size = 'lg', className, children }: { variant?: 'primary' | 'outline' | 'brand'; size?: 'md' | 'lg'; className?: string; children?: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} className={className} icon={<Plug className="size-4" />} onClick={() => setOpen(true)}>{children ?? t('Demander le branchement', 'Ask us to connect my stores')}</Button>
      {open && <ConnectRequestDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ConnectRequestDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const toggle = (p: string) => setPicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  async function send() {
    setState('sending');
    setState((await flush(connectRequestNote(picked, note))) ? 'sent' : 'failed');
  }
  if (state === 'sent') {
    return (
      <Modal title={t('Demande envoyée', 'Request sent')} onClose={onClose} footer={<Button variant="primary" size="lg" onClick={onClose}>{t('Fermer', 'Close')}</Button>}>
        <div className="flex items-start gap-3 text-[15px] text-ink-2"><CircleCheck className="mt-0.5 size-6 shrink-0 text-go" /><p>{t('Merci ! L’équipe branche vos magasins et vous recontacte. Ils apparaîtront ici dès qu’ils sont reliés.', 'Thank you! The team connects your stores and gets back to you. They show here as soon as they are linked.')}</p></div>
      </Modal>
    );
  }
  return (
    <Modal title={t('Brancher mes magasins', 'Connect my stores')} subtitle={t('On s’en occupe pour vous.', 'We do it for you.')} onClose={onClose}
      footer={<><Button variant="ghost" size="lg" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button variant="primary" size="lg" loading={state === 'sending'} onClick={send} icon={<Send className="size-4" />}>{state === 'failed' ? t('Pas envoyé — réessayer', 'Not sent — retry') : t('Envoyer la demande', 'Send the request')}</Button></>}>
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-[13px] font-semibold text-ink-2">{t('Sur quelles plateformes vendez-vous ?', 'Which platforms do you sell on?')}</div>
          <Chips value={picked} onChange={toggle} options={PLATFORMS.map((p) => ({ value: p, label: nameOf(p) }))} />
          <p className="mt-2 text-xs text-ink-3">{t('Rien de coché = toutes vos plateformes.', 'Nothing ticked = all your platforms.')}</p>
        </div>
        <label className="block">
          <span className="mb-2 block text-[13px] font-semibold text-ink-2">{t('Un mot pour l’équipe (facultatif)', 'A note for the team (optional)')}</span>
          <Textarea rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Ex. : 3 marques sur Uber Eats, la 4e arrive le mois prochain.', 'E.g. 3 brands on Uber Eats, the 4th one comes next month.')} />
        </label>
        <p className="text-xs text-ink-3">{t('Ne mettez jamais de mot de passe ici.', 'Never put a password here.')}</p>
      </div>
    </Modal>
  );
}
