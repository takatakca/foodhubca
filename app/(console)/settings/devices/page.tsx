'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BatteryCharging, BatteryLow, BatteryMedium, Eye, EyeOff, Lock, MonitorSmartphone, Pencil, Plus, Trash2, Volume2, VolumeX } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, EmptyState } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { SettingsHead } from '../settings-ui';
import { ago, api, ApiError } from '@/lib/ui/api';
import { playSound, unlockAudio } from '@/lib/ui/sound';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type Device = { id: string; name: string; locationCode: string; enrolledBy: string; enrolledAt: string; lastSeenAt?: string | null; soundOn?: boolean | null; visible?: boolean | null; battery?: number | null; charging?: boolean | null; signedIn?: string | null; status: 'online' | 'offline' | 'never' | 'revoked' };

export default function DevicesPage() {
  const { t, lang } = useI18n();
  const { can, locations, locName } = useViewer();
  const toast = useToast();
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [here, setHere] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [enrol, setEnrol] = useState(false);
  const [rename, setRename] = useState<Device | null>(null);
  const [remove, setRemove] = useState<Device | null>(null);

  const load = useCallback(() => api<{ devices: Device[]; thisDevice: string | null }>('/api/foodhub/devices').then((d) => { setDevices(d.devices); setHere(d.thisDevice); setLoaded(true); setErr(''); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, [load]);

  const byLoc = useMemo(() => locations.map((l) => ({ ...l, devices: devices.filter((d) => d.locationCode === l.code) })).filter((l) => l.devices.length || can('stores:map')), [locations, devices, can]);
  const offline = devices.filter((d) => d.status !== 'online').length;
  const manage = can('stores:map');

  async function lockNow() {
    try { const r = await api<{ next: string }>('/api/foodhub/auth/logout', { method: 'POST' }); window.location.href = r.next || '/kitchen/lock'; } catch { window.location.href = '/kitchen/lock'; }
  }
  async function doRemove(d: Device) {
    setRemove(null);
    try { await api(`/api/foodhub/devices/${d.id}`, { method: 'DELETE' }); toast.success(t('Tablette retirée', 'Tablet removed'), d.name); await load(); if (d.id === here) router.refresh(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div>
      <SettingsHead title={t('Tablettes de cuisine', 'Kitchen tablets')} intro={t('Une tablette enregistrée reste connectée un an et montre l’écran NIP au lieu de la connexion par courriel. Elle envoie un signe de vie toutes les 30 secondes : si elle s’éteint, perd le son ou le réseau pendant le service, la surveillance avertit les gérants — comme Uber quand votre tablette est hors ligne.', 'An enrolled tablet stays connected for a year and shows the PIN screen instead of the email sign-in. It checks in every 30 seconds: if it turns off, loses sound or network during service, the watchtower warns the managers — like Uber when your tablet is offline.')}
        right={manage && !here ? <Button onClick={() => setEnrol(true)} icon={<Plus className="size-4" />}>{t('Enregistrer cet écran', 'Enrol this screen')}</Button> : undefined} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {here && (
        <Banner tone="info" className="mb-4" action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { unlockAudio(); playSound('order'); }} icon={<Volume2 className="size-4" />}>{t('Tester le son', 'Test sound')}</Button><Button size="sm" onClick={lockNow} icon={<Lock className="size-4" />}>{t('Verrouiller (écran NIP)', 'Lock (PIN screen)')}</Button></div>}>
          {t('Cet écran est une tablette de cuisine :', 'This screen is a kitchen tablet:')} <strong>{devices.find((d) => d.id === here)?.name ?? '…'}</strong>
        </Banner>
      )}
      {loaded && offline > 0 && <Banner tone="warn" className="mb-4">{t(`${offline} tablette(s) hors ligne ou jamais vue(s).`, `${offline} tablet(s) offline or never seen.`)}</Banner>}

      <div className="space-y-5">
        {byLoc.map((l) => (
          <div key={l.code}>
            <div className="mb-2 flex items-center gap-2 text-sm font-extrabold text-ink">{shortLoc(l.name)}<span className="font-normal text-ink-3">· {l.devices.length} {t('écran(s)', 'screen(s)')}</span></div>
            {l.devices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line-2 px-5 py-6 text-center text-sm text-ink-3">{t('Aucune tablette. Ouvrez Food Hub sur la tablette de cette succursale, connectez-vous, puis « Enregistrer cet écran ».', 'No tablet. Open Food Hub on this location’s tablet, sign in, then “Enrol this screen”.')}</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {l.devices.map((d) => <DeviceCard key={d.id} d={d} here={d.id === here} manage={manage} lang={lang} onRename={() => setRename(d)} onRemove={() => setRemove(d)} />)}
              </div>
            )}
          </div>
        ))}
        {loaded && byLoc.length === 0 && <Card><EmptyState icon={<MonitorSmartphone className="size-6" />} title={t('Aucune tablette', 'No tablet')} /></Card>}
      </div>

      {enrol && <EnrolDialog locations={locations} onClose={() => setEnrol(false)} onDone={async (name) => { setEnrol(false); toast.success(t('Tablette enregistrée', 'Tablet enrolled'), name); await load(); router.refresh(); }} />}
      {rename && <RenameDialog d={rename} locations={locations} onClose={() => setRename(null)} onDone={async () => { setRename(null); await load(); }} />}
      {remove && (
        <Modal size="sm" title={t('Retirer cette tablette ?', 'Remove this tablet?')} onClose={() => setRemove(null)}
          footer={<><Button variant="ghost" onClick={() => setRemove(null)}>{t('Annuler', 'Cancel')}</Button><Button variant="danger" onClick={() => doRemove(remove)}>{t('Retirer', 'Remove')}</Button></>}>
          <p className="text-sm text-ink-2"><strong className="text-ink">{remove.name}</strong> · {shortLoc(locName(remove.locationCode))}. {t('Elle est déconnectée tout de suite et devra être enregistrée de nouveau. Utilisez ceci si une tablette est perdue ou volée.', 'It is signed out at once and must be enrolled again. Use this if a tablet is lost or stolen.')}</p>
        </Modal>
      )}
    </div>
  );
}

function DeviceCard({ d, here, manage, lang, onRename, onRemove }: { d: Device; here: boolean; manage: boolean; lang: 'fr' | 'en'; onRename: () => void; onRemove: () => void }) {
  const { t } = useI18n();
  const online = d.status === 'online';
  const Battery = d.charging ? BatteryCharging : (d.battery ?? 1) < 0.25 ? BatteryLow : BatteryMedium;
  return (
    <Card className={cn('p-4', !online && 'border-stop/40')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('grid size-10 shrink-0 place-items-center rounded-md', online ? 'bg-go/10 text-go-2' : 'bg-stop/10 text-stop')}><MonitorSmartphone className="size-5" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 truncate font-bold text-ink">{d.name}{here && <Badge tone="info">{t('cet écran', 'this screen')}</Badge>}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3"><StatusDot tone={online ? 'go' : 'stop'} pulse={online} />{online ? t('En ligne', 'Online') : d.status === 'never' ? t('Jamais vue', 'Never seen') : `${t('Hors ligne', 'Offline')} · ${ago(d.lastSeenAt, lang)}`}</div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {d.soundOn === false ? <Badge tone="stop" icon={<VolumeX className="size-3" />}>{t('Son bloqué', 'Sound blocked')}</Badge> : d.soundOn ? <Badge tone="go" icon={<Volume2 className="size-3" />}>{t('Son actif', 'Sound on')}</Badge> : null}
        {d.visible === false && <Badge tone="wait" icon={<EyeOff className="size-3" />}>{t('Écran caché', 'Screen hidden')}</Badge>}
        {d.visible && <Badge icon={<Eye className="size-3" />}>{t('Visible', 'Visible')}</Badge>}
        {typeof d.battery === 'number' && <Badge tone={d.battery < 0.2 && !d.charging ? 'stop' : 'neutral'} icon={<Battery className="size-3" />}>{Math.round(d.battery * 100)} %</Badge>}
        {d.signedIn && <Badge tone="dark">{d.signedIn}</Badge>}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[11px] text-ink-3">
        <span>{t('Par', 'By')} {d.enrolledBy} · {new Date(d.enrolledAt).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA')}</span>
        {manage && <span className="flex gap-1"><Button size="xs" variant="ghost" onClick={onRename} icon={<Pencil className="size-3" />}>{t('Renommer', 'Rename')}</Button><Button size="xs" variant="ghost" onClick={onRemove} icon={<Trash2 className="size-3" />}>{t('Retirer', 'Remove')}</Button></span>}
      </div>
    </Card>
  );
}

function EnrolDialog({ locations, onClose, onDone }: { locations: Array<{ code: string; name: string }>; onClose: () => void; onDone: (name: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [code, setCode] = useState(locations[0]?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try { unlockAudio(); const r = await api<{ device: Device }>('/api/foodhub/devices', { method: 'POST', json: { name, locationCode: code } }); onDone(r.device.name); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal size="sm" title={t('Enregistrer cet écran', 'Enrol this screen')} subtitle={t('Faites-le sur la tablette elle-même.', 'Do this on the tablet itself.')} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button loading={busy} disabled={!code} onClick={go}>{t('Enregistrer', 'Enrol')}</Button></>}>
      <div className="grid gap-3">
        <Field label={t('Nom de la tablette', 'Tablet name')}><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t('Tablette passe — NDG', 'Pass tablet — NDG')} /></Field>
        <Field label={t('Succursale', 'Location')}><Select value={code} onChange={(e) => setCode(e.target.value)}>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select></Field>
        <p className="text-xs leading-relaxed text-ink-3">{t('Ensuite, les employés de cette succursale déverrouillent l’écran avec leur NIP. Gardez la tablette branchée, le son au maximum et le navigateur ouvert sur Food Hub.', 'Then staff at this location unlock the screen with their PIN. Keep the tablet plugged in, the volume up and the browser open on Food Hub.')}</p>
        {err && <Banner tone="stop">{err}</Banner>}
      </div>
    </Modal>
  );
}

function RenameDialog({ d, locations, onClose, onDone }: { d: Device; locations: Array<{ code: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(d.name);
  const [code, setCode] = useState(d.locationCode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try { await api(`/api/foodhub/devices/${d.id}`, { method: 'PATCH', json: { name, locationCode: code } }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal size="sm" title={t('Modifier la tablette', 'Edit tablet')} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button loading={busy} onClick={go}>{t('Enregistrer', 'Save')}</Button></>}>
      <div className="grid gap-3">
        <Field label={t('Nom', 'Name')}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
        <Field label={t('Succursale', 'Location')}><Select value={code} onChange={(e) => setCode(e.target.value)}>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select></Field>
        {err && <Banner tone="stop">{err}</Banner>}
      </div>
    </Modal>
  );
}
