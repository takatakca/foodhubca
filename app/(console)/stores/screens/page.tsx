'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Maximize2, Minimize2, MonitorPlay, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Banner, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { StoresTabs } from '../stores-tabs';
import { ago, api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

// Stores → Platform screens: the Uber Eats / DoorDash order screens running on the screen relay host (deploy/screens/),
// live inside Food Hub. The owner signs in to each platform once, inside the screen: Food Hub never asks for or keeps a
// platform password. Status comes from the relay agent's heartbeat; the Watchtower rings when a screen goes down.

type Platform = 'ubereats' | 'doordash' | 'skip' | 'other';
type Status = 'online' | 'login_required' | 'error' | 'offline' | 'never';
type Screen = {
  id: string; name: string; platform: Platform; locationCode: string; viewUrl: string; createdBy: string; createdAt: string;
  lastSeenAt?: string | null; pageTitle?: string | null; pageHost?: string | null; titleCount?: number | null; autoReloads?: number | null;
  command?: { kind: 'reload'; at: string; by: string } | null; status: Status;
};
type Form = { name: string; platform: Platform; locationCode: string; viewUrl: string };

const PLATFORMS: Array<{ value: Platform; label: string }> = [
  { value: 'ubereats', label: 'Uber Eats' }, { value: 'doordash', label: 'DoorDash' }, { value: 'skip', label: 'SkipTheDishes' }, { value: 'other', label: 'Autre / Other' },
];
const platformLabel = (p: Platform) => PLATFORMS.find((x) => x.value === p)?.label ?? p;

export default function PlatformScreensPage() {
  const { t, lang } = useI18n();
  const { can, locations, locName } = useViewer();
  const toast = useToast();
  const [screens, setScreens] = useState<Screen[]>([]);
  const [agent, setAgent] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Screen | 'new' | null>(null);
  const [remove, setRemove] = useState<Screen | null>(null);
  const [big, setBig] = useState<string | null>(null);
  const manage = can('stores:map');

  const load = useCallback(() => api<{ screens: Screen[]; agentConfigured: boolean }>('/api/foodhub/screens')
    .then((d) => { setScreens(d.screens); setAgent(d.agentConfigured); setLoaded(true); setErr(''); })
    .catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, [load]);

  async function reload(s: Screen) {
    try { await api(`/api/foodhub/screens/${s.id}`, { method: 'POST', body: JSON.stringify({ action: 'reload' }) }); toast.success(t('Rechargement demandé', 'Reload asked'), t('Le serveur relais recharge l’écran dans 20 s au plus.', 'The relay host reloads the screen within 20 s.')); await load(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
  }
  async function doRemove(s: Screen) {
    setRemove(null);
    try { await api(`/api/foodhub/screens/${s.id}`, { method: 'DELETE' }); toast.success(t('Écran retiré', 'Screen removed'), s.name); await load(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
  }

  const down = screens.filter((s) => s.status !== 'online' && s.status !== 'never').length;

  return (
    <div>
      <PageHeader title={t('Écrans des plateformes', 'Platform screens')}
        subtitle={t('Les écrans de commandes Uber Eats, DoorDash et Skip, en direct dans Food Hub. Ils tournent sur le serveur relais, branché et toujours allumé : plus de tablette qui perd le Wi-Fi ou la connexion. Vous vous connectez une seule fois, dans l’écran lui-même — Food Hub ne voit et ne garde jamais vos mots de passe.', 'The Uber Eats, DoorDash and Skip order screens, live inside Food Hub. They run on the relay host, wired and always on: no more tablet losing its Wi-Fi or its sign-in. You sign in once, inside the screen itself — Food Hub never sees or keeps your passwords.')}
        right={manage ? <Button onClick={() => setEdit('new')} icon={<Plus className="size-4" />}>{t('Ajouter un écran', 'Add a screen')}</Button> : undefined} />
      <StoresTabs />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {loaded && !agent && manage && (
        <Banner tone="warn" className="mb-4">{t('Le serveur relais n’est pas encore branché : réglez FOODHUB_SCREENS_AGENT_TOKEN (24 caractères ou plus) sur Food Hub et sur le serveur relais. Guide : docs/PLATFORM_SCREENS.md.', 'The relay host is not connected yet: set FOODHUB_SCREENS_AGENT_TOKEN (24+ characters) on Food Hub and on the relay host. Guide: docs/PLATFORM_SCREENS.md.')}</Banner>
      )}
      {loaded && down > 0 && <Banner tone="stop" className="mb-4">{t(`${down} écran(s) à vérifier : hors ligne, déconnecté(s) ou planté(s). Rechargez, ou reconnectez-vous dans l’écran.`, `${down} screen(s) need attention: offline, signed out or crashed. Reload, or sign in again inside the screen.`)}</Banner>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {screens.map((s) => (
          <ScreenTile key={s.id} s={s} lang={lang} loc={shortLoc(locName(s.locationCode))} big={big === s.id} manage={manage} canAct={can('orders:act')}
            onBig={() => setBig(big === s.id ? null : s.id)} onReload={() => reload(s)} onEdit={() => setEdit(s)} onRemove={() => setRemove(s)} />
        ))}
      </div>
      {loaded && screens.length === 0 && (
        <Card><EmptyState icon={<MonitorPlay className="size-6" />} title={t('Aucun écran', 'No screen')}
          body={t('Installez le serveur relais (docs/PLATFORM_SCREENS.md), puis ajoutez chaque écran avec son adresse.', 'Set up the relay host (docs/PLATFORM_SCREENS.md), then add each screen with its address.')} /></Card>
      )}

      {edit && <ScreenDialog screen={edit === 'new' ? null : edit} locations={locations} onClose={() => setEdit(null)}
        onDone={async (name) => { setEdit(null); toast.success(t('Écran enregistré', 'Screen saved'), name); await load(); }} />}
      {remove && (
        <Modal size="sm" title={t('Retirer cet écran ?', 'Remove this screen?')} onClose={() => setRemove(null)}
          footer={<><Button variant="ghost" size="lg" onClick={() => setRemove(null)}>{t('Annuler', 'Cancel')}</Button><Button variant="danger" size="lg" onClick={() => doRemove(remove)}>{t('Retirer', 'Remove')}</Button></>}>
          <p className="text-sm text-ink-2"><strong className="text-ink">{remove.name}</strong> · {platformLabel(remove.platform)}. {t('Il disparaît de Food Hub et la surveillance ne le suit plus. L’écran continue de tourner sur le serveur relais.', 'It leaves Food Hub and the watchtower stops following it. The screen keeps running on the relay host.')}</p>
        </Modal>
      )}
    </div>
  );
}

function statusText(s: Screen, t: (fr: string, en: string) => string, lang: 'fr' | 'en') {
  switch (s.status) {
    case 'online': return { tone: 'go' as const, text: t('En ligne', 'Online') };
    case 'login_required': return { tone: 'stop' as const, text: t('Connexion requise', 'Sign-in needed') };
    case 'error': return { tone: 'stop' as const, text: t('Page plantée', 'Page crashed') };
    case 'offline': return { tone: 'stop' as const, text: `${t('Hors ligne', 'Offline')} · ${ago(s.lastSeenAt, lang)}` };
    default: return { tone: 'neutral' as const, text: t('Jamais vu', 'Never seen') };
  }
}

function ScreenTile({ s, lang, loc, big, manage, canAct, onBig, onReload, onEdit, onRemove }: {
  s: Screen; lang: 'fr' | 'en'; loc: string; big: boolean; manage: boolean; canAct: boolean;
  onBig: () => void; onReload: () => void; onEdit: () => void; onRemove: () => void;
}) {
  const { t } = useI18n();
  const st = statusText(s, t, lang);
  return (
    <Card className={cn('overflow-hidden p-0', big && 'xl:col-span-2', st.tone === 'stop' && 'border-stop/40')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-bold text-ink">
            <Badge tone="dark">{platformLabel(s.platform)}</Badge>{s.name}
            {typeof s.titleCount === 'number' && s.titleCount > 0 && <Badge tone="wait">{s.titleCount} {t('en attente', 'waiting')}</Badge>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            <StatusDot tone={st.tone} pulse={s.status === 'online'} />{st.text}<span>· {loc}</span>
            {s.pageHost && <span>· {s.pageHost}</span>}
            {s.command && <span>· {t('rechargement en cours…', 'reload pending…')}</span>}
            {!!s.autoReloads && <span>· {s.autoReloads} {t('recharg. auto', 'auto reloads')}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {canAct && <Button variant="ghost" onClick={onReload} disabled={!!s.command} icon={<RefreshCw className="size-4" />}>{t('Recharger', 'Reload')}</Button>}
          <Button variant="ghost" onClick={onBig} icon={big ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}>{big ? t('Réduire', 'Smaller') : t('Agrandir', 'Bigger')}</Button>
          <a className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-semibold text-ink-2 hover:bg-line/40" href={s.viewUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />{t('Plein écran', 'Full screen')}</a>
          {manage && <IconButton label={t('Modifier', 'Edit')} onClick={onEdit}><Pencil className="size-4" /></IconButton>}
          {manage && <IconButton label={t('Retirer', 'Remove')} onClick={onRemove}><Trash2 className="size-4" /></IconButton>}
        </div>
      </div>
      {/* The relay host's own page (KasmVNC / noVNC). It needs scripts and its own storage, so it is not sandboxed;
          it is a separate origin, so it cannot read Food Hub. */}
      <iframe title={`${platformLabel(s.platform)} — ${s.name}`} src={s.viewUrl} referrerPolicy="no-referrer"
        allow="clipboard-read; clipboard-write; fullscreen; autoplay" className={cn('block w-full bg-black', big ? 'h-[78vh]' : 'h-[480px]')} />
    </Card>
  );
}

function ScreenDialog({ screen, locations, onClose, onDone }: { screen: Screen | null; locations: Array<{ code: string; name: string }>; onClose: () => void; onDone: (name: string) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState<Form>(() => ({
    name: screen?.name ?? '', platform: screen?.platform ?? 'ubereats', locationCode: screen?.locationCode ?? locations[0]?.code ?? '', viewUrl: screen?.viewUrl ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  async function go() {
    setBusy(true); setErr('');
    try {
      const r = await api<{ screen: Screen }>(screen ? `/api/foodhub/screens/${screen.id}` : '/api/foodhub/screens', { method: screen ? 'PATCH' : 'POST', body: JSON.stringify(f) });
      onDone(r.screen.name);
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={screen ? t('Modifier l’écran', 'Edit screen') : t('Ajouter un écran', 'Add a screen')} onClose={onClose}
      footer={<><Button variant="ghost" size="lg" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button size="lg" loading={busy} onClick={go}>{t('Enregistrer', 'Save')}</Button></>}>
      <div className="space-y-3">
        {err && <Banner tone="stop">{err}</Banner>}
        <Field label={t('Plateforme', 'Platform')}>
          <Select value={f.platform} onChange={(e) => set('platform', e.target.value as Platform)}>{PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
        </Field>
        <Field label={t('Nom', 'Name')} hint={t('Ex. « Uber Eats — Po Poulet Saint-Léonard »', 'E.g. “Uber Eats — Po Poulet Saint-Léonard”')}>
          <Input value={f.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('Succursale', 'Location')}>
          <Select value={f.locationCode} onChange={(e) => set('locationCode', e.target.value)}>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select>
        </Field>
        <Field label={t('Adresse de l’écran (serveur relais)', 'Screen address (relay host)')}
          hint={t('L’adresse https de cet écran sur le serveur relais, ex. https://ecrans.exemple.ca/uber-stleonard/. Jamais de mot de passe dans l’adresse.', 'This screen’s https address on the relay host, e.g. https://screens.example.ca/uber-stleonard/. Never a password in the address.')}>
          <Input value={f.viewUrl} inputMode="url" placeholder="https://" onChange={(e) => set('viewUrl', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
