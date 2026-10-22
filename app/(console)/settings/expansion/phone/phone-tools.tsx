'use client';

// AI phone tools in Settings → Expansion → AI phone: the readiness list ("Ready for test calls?") and the call simulator
// (a whole call through the real phone handlers, nothing sent — lib/foodhub/phone/sim/driver.ts).
import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Link2, PhoneOutgoing, Play, RotateCcw } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Skeleton } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import type { PhoneReadiness, ReadinessCheck } from '@/lib/foodhub/phone/readiness';
import type { SimResult } from '@/lib/foodhub/phone/sim/driver';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { Section } from '../../settings-ui';
import { TechDetails } from '../../tech-details';

const LEVEL_TONE: Record<ReadinessCheck['level'], Tone> = { ok: 'go', warn: 'wait', stop: 'stop', info: 'info' };

export function PhoneReadinessPanel({ owner }: { owner: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [r, setR] = useState<PhoneReadiness | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api<PhoneReadiness>('/api/foodhub/phone/readiness').then(setR).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast]);
  useEffect(() => { load(); }, [load]);
  async function post(kind: 'probe' | 'resetAi') {
    setBusy(kind);
    try { setR(await api<PhoneReadiness>('/api/foodhub/phone/readiness', { method: 'POST', json: { [kind]: true } })); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }
  const paused = r?.checks.some((c) => c.id === 'ai_breaker');
  const levelWord: Record<ReadinessCheck['level'], string> = { ok: t('Prêt', 'Ready'), warn: t('À vérifier', 'To check'), stop: t('À régler', 'To fix'), info: t('Info', 'Info') };
  return (
    <Section icon={<ClipboardCheck className="size-5" />} title={t('Prêt pour les appels de test ?', 'Ready for test calls?')}
      subtitle={t('Tout ce dont les deux assistants ont besoin, vérifié sur ce serveur. Rien n’est envoyé.', 'Everything both assistants need, checked on this server. Nothing is sent.')}
      right={owner ? (
        <div className="flex flex-wrap gap-2">
          {paused && <Button size="sm" variant="outline" icon={<RotateCcw className="size-4" />} loading={busy === 'resetAi'} onClick={() => post('resetAi')}>{t('Relancer l’IA', 'Resume the AI')}</Button>}
          <Button size="sm" variant="outline" icon={<Link2 className="size-4" />} loading={busy === 'probe'} onClick={() => post('probe')}>{t('Vérifier les liens', 'Check the links')}</Button>
        </div>
      ) : undefined}>
      {!r ? <Skeleton className="h-40" /> : (
        <div className="space-y-2">
          <Banner tone={r.ready ? 'go' : 'stop'}>{r.ready ? t('Aucun blocage : vous pouvez faire des appels de test.', 'Nothing blocking: you can make test calls.') : t('Réglez les points « À régler » avant les appels de test.', 'Fix the items marked “To fix” before test calls.')}</Banner>
          {/* Each line says its state in a word (never colour alone); setting names fold under « Détails techniques ». */}
          <ul className="space-y-1.5">
            {r.checks.map((c) => (
              <li key={c.id} className="flex min-w-0 items-start gap-2 rounded-md bg-sunken px-3 py-2 text-[13px]">
                <Badge size="sm" tone={LEVEL_TONE[c.level]} className="mt-0.5 shrink-0">{levelWord[c.level]}</Badge>
                <div className="min-w-0 flex-1"><span className="break-words">{lang === 'fr' ? c.fr : c.en}</span>{c.tech && <TechDetails className="mt-0">{c.tech}</TechDetails>}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

/** One input per line: words as the caller says them; "#123", "2" or "*" = keys pressed; an empty line = silence. */
function parseInputs(text: string): Array<{ speech?: string; digits?: string }> {
  return text.split('\n').map((l) => l.trim()).map((l) => {
    if (!l || l === '-') return {};
    if (/^#/.test(l)) return { digits: l.slice(1).replace(/\s+/g, '') };
    if (/^[0-9*#]{1,12}$/.test(l)) return { digits: l };
    return { speech: l };
  });
}

export function CallSimulatorPanel({ lines }: { lines: Array<{ id?: string; name: string; enabled: boolean }> }) {
  const { t } = useI18n();
  const toast = useToast();
  const [target, setTarget] = useState('ivr');
  const [dial, setDial] = useState<'answered' | 'nobody'>('answered');
  const [text, setText] = useState('Bonjour, je voudrais commander un poulet entier\n');
  const [res, setRes] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { setRes(await api<SimResult>('/api/foodhub/phone/sim', { method: 'POST', json: { target, dial, inputs: parseInputs(text) } })); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const endLabel: Record<SimResult['ended'], string> = {
    listen: t('en écoute', 'listening'), redirect: t('en attente', 'waiting'), dial: t('transfert (répondu)', 'transfer (answered)'), voicemail: t('boîte vocale', 'voicemail'), hangup: t('raccroché', 'hung up'),
    none: t('fin', 'end'), max_steps: t('trop d’étapes', 'too many steps'), no_more_input: t('en attente du client', 'waiting for the caller'),
  };
  return (
    <Section icon={<PhoneOutgoing className="size-5" />} title={t('Simulateur d’appel (aucun envoi)', 'Call simulator (nothing sent)')}
      subtitle={t('Un appel complet dans les vrais traitements Twilio. Les textos, courriels et messages d’équipe sont seulement affichés ; aucune commande ne va à Clover, en cuisine ou à un lien de paiement. Seule l’IA est appelée.', 'A whole call through the real Twilio handlers. Texts, emails and team messages are only shown; no order reaches Clover, the kitchen or a payment link. Only the AI is called.')}>
      <div className="grid min-w-0 [&>*]:min-w-0 gap-3 md:grid-cols-3">
        <Field label={t('Numéro appelé', 'Number called')}>
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="ivr">{t('Menu ON2GO', 'ON2GO menu')}</option>
            {lines.filter((l) => l.id).map((l) => <option key={l.id} value={l.id}>{l.name}{l.enabled ? '' : ` (${t('éteinte', 'off')})`}</option>)}
          </Select>
        </Field>
        <Field label={t('Transfert à une personne', 'Hand-off to a person')}>
          <Select value={dial} onChange={(e) => setDial(e.target.value as 'answered' | 'nobody')}><option value="answered">{t('Quelqu’un répond', 'Someone answers')}</option><option value="nobody">{t('Personne ne répond', 'Nobody answers')}</option></Select>
        </Field>
        <div className="flex items-end"><Button icon={<Play className="size-4" />} loading={busy} onClick={run}>{t('Lancer l’appel', 'Run the call')}</Button></div>
      </div>
      <Field className="mt-3" label={t('Ce que dit le client (une ligne par tour ; « #123 » ou « 2 » = touches ; ligne vide = silence)', 'What the caller says (one line per turn; "#123" or "2" = keys; empty line = silence)')}>
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {res && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]"><Badge tone="info">{endLabel[res.ended]}</Badge><span className="text-ink-3">{res.steps.length} {t('étapes', 'steps')}</span></div>
          <ol className="space-y-2">
            {res.steps.map((s, i) => (
              <li key={i} className="rounded-md border border-line p-3 text-[13px]">
                <div className="text-ink-3">{t('Client', 'Caller')} : <span className="font-semibold text-ink-2">{s.caller}</span></div>
                {s.said.map((x, j) => <p key={j} className="mt-1">🔊 {x}</p>)}
                <div className="mt-1 text-xs text-ink-3">{s.next === 'listen' && s.listen ? `${t('écoute', 'listens')} · ${s.listen.language} · ${s.listen.model}${s.listen.hints ? ' · hints' : ''}` : s.next === 'dial' ? `${t('transfert au', 'transfer to')} ${s.dial ?? ''}` : s.next}</div>
              </li>
            ))}
          </ol>
          {res.sent.length > 0 && (
            <div>
              <div className="mb-1 text-[13px] font-semibold">{t('Ce qui aurait été envoyé', 'What would have been sent')}</div>
              <ul className="space-y-1.5">{res.sent.map((x, i) => <li key={i} className="rounded-md bg-sunken px-3 py-2 text-xs"><Badge tone="neutral">{x.channel}</Badge> <span className="text-ink-3">{x.to} · {x.purpose}</span><div className="mt-1 whitespace-pre-wrap">{x.body}</div></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
