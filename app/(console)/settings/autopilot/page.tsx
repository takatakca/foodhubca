'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Banner, Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { AutopilotList, type AutopilotItem } from '@/components/settings/autopilot-list';
import type { PendingAction } from '@/lib/foodhub/autopilot';
import { SettingsHead } from '../settings-ui';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

type Data = { automations: AutopilotItem[]; canEdit: boolean };

const errText = (e: unknown, lang: 'fr' | 'en') => (e instanceof ApiError && lang === 'fr' && typeof e.body.errorFr === 'string' ? e.body.errorFr : e instanceof Error ? e.message : String(e));

export default function AutopilotPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api<Data>('/api/foodhub/autopilot').then((d) => { setData(d); setErr(''); }).catch((e) => setErr(errText(e, lang))), [lang]);
  useEffect(() => {
    load();
    // Last runs move on by themselves: refresh every minute while the page is open.
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  async function toggle(id: string, on: boolean) {
    setBusy(id);
    try {
      await api('/api/foodhub/autopilot', { method: 'PUT', json: { id, on } });
      toast.success(on ? t('Activée — chaque geste est écrit au journal sous « Autopilot »', 'On — every action is logged as “Autopilot”') : t('Arrêtée — Food Hub refait comme avant', 'Off — Food Hub works as before'));
      await load();
    } catch (e) {
      toast.error(t('Pas changé', 'Not changed'), errText(e, lang));
    } finally {
      setBusy(null);
    }
  }

  async function undo(p: PendingAction) {
    setBusy(p.id);
    try {
      await api('/api/foodhub/autopilot', { method: 'POST', json: { action: p.kind, id: p.id } });
      toast.success(p.kind === 'cancel_publish' ? t('Publication annulée', 'Publish cancelled') : t('Nouveaux essais arrêtés', 'Retries stopped'));
      await load();
    } catch (e) {
      toast.error(t('Pas fait', 'Not done'), errText(e, lang));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pb-20">
      <SettingsHead title={t('Pilote automatique', 'Autopilot')}
        intro={t('Tout ce que Food Hub fait tout seul, avec sa règle en mots simples, son dernier passage et ce qu’il a fait. Les nouveautés restent arrêtées tant qu’un gérant ou le propriétaire ne les active pas, et chacun de leurs gestes est écrit au journal d’activité sous « Autopilot ».',
          'Everything Food Hub does by itself, with its rule in plain words, its last run and what it did. The new ones stay off until a manager or the owner turns them on, and every action they take is written to the activity log as “Autopilot”.')} />
      <div className="max-w-4xl">
        {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
        {data && !data.canEdit && <Banner tone="info" className="mb-4">{t('Seul un gérant de toutes les succursales ou le propriétaire peut changer ces interrupteurs.', 'Only a manager of every location or the owner can change these switches.')}</Banner>}
        {!data ? <div className="h-96 animate-pulse rounded-lg bg-sunken" /> : (
          <>
            <AutopilotList items={data.automations} t={t} lang={lang} canEdit={data.canEdit} busy={busy} onToggle={toggle} onUndo={undo} />
            <Card className="mt-6 flex items-start gap-3 p-5">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden />
              <div className="text-small leading-relaxed text-ink-2">
                <p>{t('Règles fixes : aucune IA ne décide ici. Le pilote automatique n’approuve rien, n’affiche aucun message ni avis en votre nom, ne supprime rien et ne règle aucune question d’argent. Po Poulet NDG (DoorDash) et tout magasin protégé ne sont jamais mis en pause, rouverts, publiés ou mis en 86 par une automatisation.',
                  'Fixed rules: no AI decides anything here. Autopilot never approves, posts a message or reply for you, deletes anything or settles money. Po Poulet NDG (DoorDash) and every protected store are never paused, resumed, published or 86’d by an automation.')}</p>
                <p className="mt-1">{t('Tout est dans le', 'Everything is in the')} <Link href="/insights/activity" className="font-bold underline">{t('journal d’activité', 'activity log')}</Link>.</p>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
