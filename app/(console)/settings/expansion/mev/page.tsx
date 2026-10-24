'use client';

// Settings → Add-ons → MEV invoices: is Takatak MEV (QCMEV) issuing the Revenu Québec invoices, for which kitchens, and
// is anything waiting. Plain words, French first. Server switches are shown by name only, never their values.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Skeleton } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import type { MevStatus } from '@/lib/foodhub/mev/status';
import type { SevOfRecord } from '@/lib/foodhub/mev/types';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { Section } from '../../settings-ui';
import { ExpansionHead, ReadyItem } from '../expansion-ui';
import { TechDetails } from '../../tech-details';

export default function MevSettingsPage() {
  const { t, lang } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const [s, setS] = useState<MevStatus | null>(null);
  const [busy, setBusy] = useState('');
  const owner = can('admin');

  const load = useCallback(() => api<MevStatus>('/api/foodhub/mev').then(setS).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast]);
  useEffect(() => { load(); }, [load]);

  async function post(action: 'health' | 'run') {
    setBusy(action);
    try { setS(await api<MevStatus>('/api/foodhub/mev', { method: 'POST', json: { action } })); toast.success(action === 'health' ? t('Vérifié', 'Checked') : t('Envoi lancé', 'Sending started')); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  async function setSev(locationCode: string, sevOfRecord: SevOfRecord) {
    setBusy(locationCode);
    try { setS(await api<MevStatus>('/api/foodhub/mev', { method: 'PUT', json: { locationCode, sevOfRecord } })); toast.success(t('Enregistré', 'Saved')); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  const r = s?.readiness;
  const h = s?.health?.health;
  const why = (k?: string) => (k && s?.why[k] ? (lang === 'fr' ? s.why[k][0] : s.why[k][1]) : '');
  const modeText = r ? ({ off: t('Éteint', 'Off'), shadow: t('Essai à blanc (rien n’est envoyé)', 'Shadow (nothing is sent)'), simulator: t('Simulateur (ventes d’essai)', 'Simulator (training sales)'), on: t('Production (factures réelles)', 'Production (real invoices)') } as const)[r.mode] : '';

  return (
    <div>
      <ExpansionHead title={t('Factures Revenu Québec (MEV)', 'Revenu Québec invoices (MEV)')}
        intro={t('Takatak MEV numérote, signe et transmet chaque facture à Revenu Québec. Food Hub lui envoie les ventes et imprime la facture reçue, telle quelle, avec son code QR. Rien n’est envoyé tant que les quatre interrupteurs ne disent pas oui.', 'Takatak MEV numbers, signs and sends each invoice to Revenu Québec. Food Hub sends it the sales and prints the invoice it gets back, as is, with its QR code. Nothing is sent until all four switches say yes.')} />
      {!s && <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-48" /></div>}
      {s && r && (
        <>
          {r.mode === 'simulator' && <Banner tone="info" className="mb-4">{t('Mode simulateur : les ventes partent comme ventes d’essai (formation). Aucune facture réelle.', 'Simulator mode: sales go out as training sales. No real invoice.')}</Banner>}
          {r.mode === 'on' && !(h?.environment === 'PROD' && h.certified) && <Banner tone="stop" className="mb-4">{t('Production demandée, mais Takatak MEV ne se dit pas en production certifiée : rien n’est envoyé.', 'Production asked, but Takatak MEV does not report certified production: nothing is sent.')}</Banner>}
          <Section title={t('Les interrupteurs', 'The switches')} subtitle={t('Les quatre doivent dire oui pour qu’une cuisine envoie ses ventes.', 'All four must say yes for a kitchen to send its sales.')}
            right={owner && r.mode !== 'off' ? <div className="flex flex-wrap gap-2"><Button variant="outline" loading={busy === 'health'} icon={<RefreshCw className="size-4" />} onClick={() => post('health')}>{t('Vérifier Takatak MEV', 'Check Takatak MEV')}</Button><Button variant="ghost" loading={busy === 'run'} icon={<Send className="size-4" />} onClick={() => post('run')}>{t('Envoyer maintenant', 'Send now')}</Button></div> : undefined}>
            <div className="grid gap-2 sm:grid-cols-2">
              <ReadyItem ok={r.mode !== 'off'} label={`${t('Serveur', 'Server')} : ${modeText}`} tech="FOODHUB_MEV" />
              <ReadyItem ok={r.urlSet && r.secretSet} label={r.secretWeak ? t('Clé trop courte (32 caractères minimum)', 'Key too short (32 characters minimum)') : t('Adresse et clé de Takatak MEV', 'Takatak MEV address and key')} tech="FOODHUB_MEV_URL, FOODHUB_MEV_SECRET" />
              <ReadyItem ok={r.allowlist.length > 0} label={r.allowlist.length ? `${t('Cuisines permises', 'Allowed kitchens')} : ${r.allowlist.join(', ')}` : t('Aucune cuisine permise', 'No kitchen allowed')} tech="FOODHUB_MEV_LOCATIONS" />
              <ReadyItem ok={Boolean(h)} label={h ? `${t('Takatak MEV répond', 'Takatak MEV answers')} : ${h.environment || '?'} · ${h.certified ? t('certifié', 'certified') : t('pas certifié', 'not certified')}${h.mevReachable ? '' : ` · ${t('Revenu Québec injoignable (hors ligne)', 'Revenu Québec unreachable (offline)')}`}` : `${t('Takatak MEV pas encore joint', 'Takatak MEV not reached yet')}${s.health?.error ? ` (${s.health.error})` : ''}`} />
            </div>
            <p className="text-small mt-3 text-ink-3">{t('L’interrupteur du propriétaire est dans Réglages → Services en plus → Interrupteurs.', 'The owner switch is in Settings → Add-ons → Switches.')} {t('Déclencheur', 'Trigger')} : {r.trigger === 'ready' ? t('commande prête', 'order ready') : t('commande acceptée', 'order accepted')}.</p>
            <TechDetails className="mt-2">{`FOODHUB_MEV_TRIGGER=${r.trigger} · FOODHUB_MEV_TIMEOUT_MS=${r.timeoutMs} · FOODHUB_MEV_RETRY_S=${r.retryS.join(',')} · FOODHUB_MEV_CLOVER_NOTE=${r.cloverNote ? 'on' : 'off'} · docs/MEV_INTEGRATION.md`}</TechDetails>
          </Section>

          <Section title={t('Qui fait la facture, cuisine par cuisine', 'Who makes the invoice, kitchen by kitchen')} subtitle={t('« Takatak MEV » : Food Hub envoie les ventes. « App MEV de Clover » ou « Aucun » : Food Hub n’envoie rien pour cette cuisine.', '“Takatak MEV”: Food Hub sends the sales. “Clover MEV app” or “None”: Food Hub sends nothing for this kitchen.')}>
            <div className="divide-y divide-line">
              {s.locations.map((l) => (
                <div key={l.code} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-ink">{l.name}</div>
                    <div className="text-small text-ink-3">{l.active ? t('Envoie ses ventes à Takatak MEV', 'Sends its sales to Takatak MEV') : why(l.why)}{l.qcmev ? ` · ${t('appareil', 'device')} ${l.qcmev.deviceReady ? '✓' : '✗'} · ${t('certificat', 'certificate')} ${l.qcmev.certReady ? '✓' : '✗'} · ${t('utilisateur', 'user')} ${l.qcmev.usersReady ? '✓' : '✗'}` : ''}</div>
                  </div>
                  <Badge tone={l.active ? 'go' : 'neutral'}>{l.active ? t('Actif', 'On') : t('Inactif', 'Off')}</Badge>
                  <Select aria-label={`${t('Système de facturation', 'Invoicing system')} — ${l.name}`} value={l.sevOfRecord} disabled={!owner || busy === l.code} onChange={(e) => setSev(l.code, e.target.value as SevOfRecord)} className="w-48">
                    <option value="none">{t('Aucun', 'None')}</option>
                    <option value="qcmev">Takatak MEV</option>
                    <option value="clover_app">{t('App MEV de Clover', 'Clover MEV app')}</option>
                  </Select>
                </div>
              ))}
            </div>
          </Section>

          {s.outbox && (
            <Section title={t('File des factures (24 h)', 'Invoice queue (24 h)')} subtitle={t('Rien n’est perdu : une facture qui n’est pas partie attend ici et repart toute seule. La loi donne 48 heures.', 'Nothing is lost: an invoice that did not go out waits here and goes again by itself. The law allows 48 hours.')}>
              <div className="flex flex-wrap gap-2">
                <Badge tone="go">{s.outbox.done} {t('émises', 'issued')}</Badge>
                <Badge tone={s.outbox.pending ? 'wait' : 'neutral'}>{s.outbox.pending} {t('en attente', 'waiting')}</Badge>
                <Badge tone={s.outbox.offline ? 'info' : 'neutral'}>{s.outbox.offline} {t('hors ligne', 'offline')}</Badge>
                <Badge tone={s.outbox.needsHuman ? 'stop' : 'neutral'}>{s.outbox.needsHuman} {t('à vérifier', 'to check')}</Badge>
                {s.outbox.shadow > 0 && <Badge tone="neutral">{s.outbox.shadow} {t('essais à blanc', 'shadow')}</Badge>}
              </div>
              {s.outbox.oldestPendingAt && <p className="text-small mt-2 text-ink-3">{t('Plus ancienne en attente', 'Oldest waiting')} : {new Date(s.outbox.oldestPendingAt).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')}</p>}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
