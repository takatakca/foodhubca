'use client';

export default function UserMenu({ name, role }: { name: string; role: string }) {
  async function signOut() {
    await fetch('/api/foodhub/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }
  return (
    <div className="side-user">
      <div><strong>{name}</strong><div className="small" style={{ color: '#98a2b3' }}>{role}</div></div>
      <button className="btn-sm btn-light" onClick={signOut}>Sign out</button>
    </div>
  );
}
