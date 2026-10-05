'use client';

import { useState } from 'react';

/** Only same-origin paths may follow a sign-in (the URL parser treats "/\\evil.com" like "//evil.com"). */
function safeNext(next: string | null): string {
  if (!next) return '/';
  try {
    const u = new URL(next, window.location.origin);
    return u.origin === window.location.origin && u.pathname !== '/login' ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/foodhub/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username || 'owner', password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      window.location.href = safeNext(new URLSearchParams(window.location.search).get('next'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>TAKATAK</h1>
        <div className="small" style={{ marginBottom: 18 }}>Food Hub — sign in</div>
        <label className="small">Username<br /><input autoFocus autoComplete="username" value={username} placeholder="owner" onChange={(e) => setUsername(e.target.value)} /></label>
        <label className="small">Password<br /><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="fh-banner warn" style={{ margin: 0 }}>{error}</div>}
        <button type="submit" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="small">Owner: username <span className="fh-mono">owner</span> + the dashboard password. Team members: ask the owner for an account (Food Hub → Users).</div>
      </form>
    </div>
  );
}
