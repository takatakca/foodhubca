'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Modal, MultiPick, Section, useCatalog } from '../ui';

type User = { id: string; username: string; name: string; role: string; locations: string[]; active: boolean; createdAt: string; lastLoginAt?: string | null };
type Draft = { username: string; name: string; role: string; locations: string[]; password: string; active: boolean; isNew: boolean };

const ACCESS: Array<[string, string[]]> = [
  ['See orders, stores and the Command Center', ['owner', 'manager', 'operator', 'menu', 'analyst']],
  ['Accept / reject / ready orders', ['owner', 'manager', 'operator']],
  ['Pause and resume stores', ['owner', 'manager', 'operator']],
  ['86 items and options', ['owner', 'manager', 'operator', 'menu']],
  ['Edit menus, prices and hours; publish', ['owner', 'manager', 'menu']],
  ['Map stores and change settings', ['owner', 'manager']],
  ['Analytics, reports and activity log', ['owner', 'manager', 'analyst']],
  ['Users, brands and locations', ['owner']],
];

// Users & roles (Atlas "user roles and permissions"): one login per person, limited to their locations.
export default function UsersPage() {
  const { activeLocations, locName } = useCatalog();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Array<{ role: string; label: string }>>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<{ users: User[]; roles: Array<{ role: string; label: string }> }>('/api/foodhub/users').then((d) => { setUsers(d.users); setRoles(d.roles); }).catch((e) => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true); setErr('');
    try {
      await api('/api/foodhub/users', { method: 'POST', json: { username: draft.username, name: draft.name, role: draft.role, locations: draft.locations, active: draft.active, ...(draft.password ? { password: draft.password } : {}) } });
      setMsg(`${draft.isNew ? 'Created' : 'Updated'} ${draft.username}.${draft.isNew ? ' Give them the password in person — they sign in at /login.' : ''}`);
      setDraft(null); load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  function genPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint32Array(14); crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  }

  return (
    <div>
      <div className="fh-head">
        <div>
          <h1>Users & roles</h1>
          <div className="small">Give each person their own login. Store operators can be limited to their own location(s). The owner login (DASHBOARD_PASSWORD) always has full access.</div>
        </div>
        <button onClick={() => { setErr(''); setDraft({ username: '', name: '', role: 'operator', locations: [], password: genPassword(), active: true, isNew: true }); }}>Add user</button>
      </div>
      {msg && <div className="fh-banner info">{msg}</div>}

      <Section title={`Team (${users.length})`}>
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Locations</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username}>
                <td><strong>{u.name}</strong></td>
                <td className="fh-mono">{u.username}</td>
                <td className="small">{roles.find((r) => r.role === u.role)?.label ?? u.role}</td>
                <td className="small">{u.locations.length ? u.locations.map(locName).join(', ') : 'All locations'}</td>
                <td className="small">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('fr-CA') : 'never'}</td>
                <td><span className={`badge ${u.active ? 'badge-green' : 'badge-red'}`}>{u.active ? 'active' : 'disabled'}</span></td>
                <td><button className="btn-sm btn-light" onClick={() => { setErr(''); setDraft({ username: u.username, name: u.name, role: u.role, locations: u.locations, password: '', active: u.active, isNew: false }); }}>Edit</button></td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={7} className="small">Only the owner login exists. Add your managers and store staff.</td></tr>}
          </tbody>
        </table>
      </Section>

      <Section title="What each role can do">
        <div className="fh-table-wrap">
          <table>
            <thead><tr><th>Access</th>{['owner', 'manager', 'operator', 'menu', 'analyst'].map((r) => <th key={r}>{r}</th>)}</tr></thead>
            <tbody>{ACCESS.map(([label, who]) => <tr key={label}><td>{label}</td>{['owner', 'manager', 'operator', 'menu', 'analyst'].map((r) => <td key={r}>{who.includes(r) ? '✓' : '—'}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </Section>

      {draft && (
        <Modal title={draft.isNew ? 'Add user' : `Edit ${draft.username}`} onClose={() => setDraft(null)}>
          <div className="fh-col-form">
            <label>Full name<input style={{ width: '100%' }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Username<input style={{ width: '100%' }} value={draft.username} disabled={!draft.isNew} onChange={(e) => setDraft({ ...draft, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} placeholder="e.g. sara.ndg" /></label>
            <label>Role<select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>{roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</select></label>
            <div><div className="small" style={{ marginBottom: 4 }}>Locations (none selected = all)</div><MultiPick label="Locations" options={activeLocations.map((l) => [l.code, l.name])} value={draft.locations} onChange={(v) => setDraft({ ...draft, locations: v })} /></div>
            <label>{draft.isNew ? 'Password' : 'New password (leave empty to keep)'}
              <div className="fh-row"><input style={{ flex: 1 }} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="new-password" /><button className="btn-sm btn-light" onClick={() => setDraft({ ...draft, password: genPassword() })}>Generate</button></div>
            </label>
            {!draft.isNew && <label className="fh-row"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active (untick to block sign-in)</label>}
            {err && <div className="fh-banner warn">{err}</div>}
            <div className="fh-row" style={{ justifyContent: 'flex-end' }}><button className="btn-light" onClick={() => setDraft(null)}>Cancel</button><button disabled={busy || !draft.username || (draft.isNew && !draft.password)} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
