'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Mail, Phone, Search, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, EmptyState } from '@/components/ui/card';
import { Checkbox, Field, Input, Switch } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Segmented } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { ROLES, SettingsHead, roleHelp, roleLabel, type Role } from '../settings-ui';
import { ago, api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type User = { username: string; name: string; role: Role; locations: string[]; email: string | null; phone: string | null; active: boolean; lastLoginAt: string | null; hasPin: boolean; hasPassword: boolean };
type Draft = { username?: string; name: string; role: Role; locations: string[]; email: string; phone: string; pin: string; clearPin: boolean; active: boolean; invite: boolean; hasPin: boolean };

const ROLE_TONE: Record<Role, 'dark' | 'brand' | 'neutral' | 'violet' | 'info'> = { owner: 'dark', manager: 'brand', operator: 'neutral', menu: 'violet', analyst: 'info' };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

export default function TeamPage() {
  const { t, lang } = useI18n();
  const { viewer, can, locations, locName } = useViewer();
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'active' | 'inactive'>('active');
  const [edit, setEdit] = useState<Draft | null>(null);

  const load = useCallback(() => api<{ users: User[] }>('/api/foodhub/users').then((d) => { setUsers(d.users); setLoaded(true); setErr(''); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { if (can('stores:map')) load(); }, [load, can]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter((u) => (show === 'active' ? u.active : !u.active)).filter((u) => !s || `${u.name} ${u.email ?? ''} ${u.phone ?? ''} ${u.username}`.toLowerCase().includes(s))
      .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name));
  }, [users, q, show]);
  const noPin = users.filter((u) => u.active && (u.role === 'manager' || u.role === 'operator') && !u.hasPin).length;

  if (!can('stores:map')) return <div><SettingsHead title={t('Équipe et NIP', 'Team & PINs')} /><Banner tone="info">{t('Seuls les gérants et le propriétaire gèrent l’équipe.', 'Only managers and the owner manage the team.')}</Banner></div>;

  const isOwner = viewer.role === 'owner';
  const newDraft = (): Draft => ({ name: '', role: 'operator', locations: isOwner ? [] : [...viewer.locations], email: '', phone: '', pin: '', clearPin: false, active: true, invite: true, hasPin: false });
  const editDraft = (u: User): Draft => ({ username: u.username, name: u.name, role: u.role, locations: u.locations, email: u.email ?? '', phone: u.phone ?? '', pin: '', clearPin: false, active: u.active, invite: false, hasPin: u.hasPin });
  const canEdit = (u: User) => isOwner || !['owner', 'manager'].includes(u.role);

  return (
    <div>
      <SettingsHead title={t('Équipe et NIP', 'Team & PINs')} intro={t('Chaque personne se connecte avec son courriel ou son cellulaire (code par texto ou courriel, aucun mot de passe). Le NIP déverrouille les tablettes de cuisine et sert à approuver les actions sensibles. Retirer quelqu’un le déconnecte partout immédiatement.', 'Everyone signs in with their email or cell (code by text or email, no password). The PIN unlocks kitchen tablets and approves sensitive actions. Removing someone signs them out everywhere at once.')}
        right={<Button onClick={() => setEdit(newDraft())} icon={<UserPlus className="size-4" />}>{t('Ajouter une personne', 'Add a person')}</Button>} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {noPin > 0 && <Banner tone="warn" className="mb-4">{t(`${noPin} personne(s) de cuisine sans NIP : elles ne peuvent pas déverrouiller une tablette.`, `${noPin} kitchen person(s) without a PIN: they cannot unlock a tablet.`)}</Banner>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input inputSize="sm" type="search" className="w-60 pl-8" placeholder={t('Nom, courriel, cellulaire', 'Name, email, cell')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented size="sm" value={show} onChange={setShow} options={[{ key: 'active', label: `${t('Actifs', 'Active')} (${users.filter((u) => u.active).length})` }, { key: 'inactive', label: `${t('Retirés', 'Removed')} (${users.filter((u) => !u.active).length})` }]} />
      </div>

      <Card>
        <ul className="divide-y divide-line">
          {rows.map((u) => (
            <li key={u.username} className={cn('flex flex-wrap items-center gap-4 px-5 py-3.5', !u.active && 'opacity-60')}>
              <div className={cn('grid size-10 shrink-0 place-items-center rounded-full text-sm font-extrabold', u.role === 'owner' ? 'bg-ink text-canvas' : u.role === 'manager' ? 'bg-brand text-white' : 'bg-sunken text-ink-2')}>{initials(u.name)}</div>
              <div className="min-w-[180px] flex-1">
                <div className="flex flex-wrap items-center gap-2 font-bold text-ink">{u.name}<Badge tone={ROLE_TONE[u.role]}>{roleLabel(t, u.role)}</Badge>{u.username === viewer.username && <Badge tone="info">{t('vous', 'you')}</Badge>}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-3">
                  {u.email && <span className="inline-flex items-center gap-1"><Mail className="size-3" />{u.email}</span>}
                  {u.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3" />{u.phone}</span>}
                  {!u.email && !u.phone && <span>{u.hasPin ? t('NIP seulement (tablette)', 'PIN only (tablet)') : u.hasPassword ? t('Ancien mot de passe — ajoutez un courriel ou un cellulaire', 'Old password — add an email or a cell') : t('Aucun moyen de connexion', 'No way to sign in')}</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">{u.locations.length ? u.locations.map((l) => <Badge key={l}>{shortLoc(locName(l))}</Badge>) : <Badge>{t('Toutes', 'All')}</Badge>}</div>
              <div className="w-28 text-xs">{u.hasPin ? <span className="inline-flex items-center gap-1 font-semibold text-go-2"><KeyRound className="size-3.5" />{t('NIP actif', 'PIN set')}</span> : <span className="inline-flex items-center gap-1 text-ink-3"><KeyRound className="size-3.5" />{t('sans NIP', 'no PIN')}</span>}</div>
              <div className="w-32 text-xs text-ink-3">{u.lastLoginAt ? `${t('Vu', 'Seen')} ${ago(u.lastLoginAt, lang)}` : t('Jamais connecté', 'Never signed in')}</div>
              <Button size="sm" variant="outline" disabled={!canEdit(u)} onClick={() => setEdit(editDraft(u))}>{t('Modifier', 'Edit')}</Button>
            </li>
          ))}
        </ul>
        {rows.length === 0 && <EmptyState title={loaded ? t('Personne ici', 'Nobody here') : t('Chargement…', 'Loading…')} body={loaded && show === 'active' && !q ? t('Ajoutez vos gérants et employés. Ils reçoivent un lien de connexion.', 'Add your managers and staff. They receive a sign-in link.') : undefined} />}
      </Card>

      {edit && <PersonDialog draft={edit} isOwner={isOwner} locations={locations} viewerLocations={viewer.locations} onClose={() => setEdit(null)} onSaved={(msg) => { toast.success(msg.title, msg.body); setEdit(null); load(); }} />}
    </div>
  );
}

function PersonDialog({ draft, isOwner, locations, viewerLocations, onClose, onSaved }: { draft: Draft; isOwner: boolean; locations: Array<{ code: string; name: string }>; viewerLocations: string[]; onClose: () => void; onSaved: (m: { title: string; body?: string }) => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isNew = !draft.username;
  const roles = ROLES.filter((r) => isOwner || !['owner', 'manager'].includes(r));
  const myLocs = isOwner || !viewerLocations.length ? locations : locations.filter((l) => viewerLocations.includes(l.code));
  const toggleLoc = (code: string) => setD({ ...d, locations: d.locations.includes(code) ? d.locations.filter((c) => c !== code) : [...d.locations, code] });

  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await api<{ user: User; invite: { ok: boolean; message: string } | null }>('/api/foodhub/users', { method: 'POST', json: {
        username: d.username, name: d.name, role: d.role, locations: d.locations, email: d.email, phone: d.phone, active: d.active, invite: d.invite,
        pin: d.pin || undefined, clearPin: d.clearPin || undefined,
      } });
      onSaved({ title: isNew ? t(`${r.user.name} ajouté(e)`, `${r.user.name} added`) : t(`${r.user.name} enregistré(e)`, `${r.user.name} saved`), body: r.invite ? (r.invite.ok ? t('Invitation envoyée.', 'Invitation sent.') : `${t('Invitation non envoyée :', 'Invitation not sent:')} ${r.invite.message}`) : undefined });
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <Modal size="lg" title={isNew ? t('Ajouter une personne', 'Add a person') : d.name} subtitle={isNew ? t('Courriel ou cellulaire pour se connecter, NIP pour les tablettes.', 'Email or cell to sign in, PIN for tablets.') : undefined} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button loading={busy} disabled={!d.name.trim()} onClick={save}>{isNew ? t('Ajouter', 'Add') : t('Enregistrer', 'Save')}</Button></>}>
      <div className="grid gap-4">
        <Field label={t('Nom complet', 'Full name')}><Input autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={60} placeholder="Sara Tremblay" /></Field>
        <div>
          <div className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('Rôle', 'Role')}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <button key={r} type="button" onClick={() => setD({ ...d, role: r })} className={cn('rounded-md border p-3 text-left transition-colors', d.role === r ? 'border-ink bg-ink text-canvas' : 'border-line-2 hover:border-ink-4')}>
                <div className="text-sm font-bold">{roleLabel(t, r)}</div>
                <div className={cn('mt-0.5 text-xs leading-snug', d.role === r ? 'text-canvas/75' : 'text-ink-3')}>{roleHelp(t, r)}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('Succursales', 'Locations')} <span className="font-normal text-ink-3">{isOwner ? t('— aucune cochée = toutes', '— none ticked = all') : ''}</span></div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">{myLocs.map((l) => <Checkbox key={l.code} checked={d.locations.includes(l.code)} onChange={() => toggleLoc(l.code)} label={shortLoc(l.name)} />)}</div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('Courriel', 'Email')}><Input type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} placeholder="sara@exemple.com" /></Field>
          <Field label={t('Cellulaire', 'Cell')}><Input type="tel" inputMode="tel" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} placeholder="514 555-0123" /></Field>
        </div>
        <div className="rounded-md border border-line bg-raised p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold"><KeyRound className="size-4" />{t('NIP', 'PIN')}</div>
            {d.hasPin && !d.clearPin && <Badge tone="go">✓ {t('NIP actif', 'PIN set')}</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Input className="w-36 text-center font-mono tracking-[0.4em]" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={d.pin} onChange={(e) => setD({ ...d, pin: e.target.value.replace(/\D/g, ''), clearPin: false })} placeholder={d.hasPin ? '••••' : ''} aria-label={t('NIP', 'PIN')} />
            <span className="text-xs text-ink-3">{d.hasPin ? t('Laisser vide pour garder le NIP actuel.', 'Leave empty to keep the current PIN.') : t('4 à 6 chiffres. La personne peut aussi le choisir elle-même dans son profil.', '4–6 digits. The person can also pick it in their profile.')}</span>
            {d.hasPin && <Checkbox checked={d.clearPin} onChange={(v) => setD({ ...d, clearPin: v, pin: '' })} label={t('Effacer le NIP', 'Clear the PIN')} />}
          </div>
        </div>
        {(d.email || d.phone) && isNew && <Switch checked={d.invite} onChange={(v) => setD({ ...d, invite: v })} label={t('Envoyer une invitation', 'Send an invitation')} description={d.email ? t('Par courriel, avec le lien de connexion.', 'By email, with the sign-in link.') : t('Par texto, avec le lien de connexion.', 'By text, with the sign-in link.')} />}
        {!isNew && <Switch checked={d.active} onChange={(v) => setD({ ...d, active: v })} label={t('Accès actif', 'Access active')} description={t('Désactiver déconnecte la personne partout, tout de suite. L’historique est gardé.', 'Turning off signs the person out everywhere, at once. History is kept.')} />}
        {err && <Banner tone="stop">{err}</Banner>}
      </div>
    </Modal>
  );
}
