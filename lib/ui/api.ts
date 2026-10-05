'use client';

// One fetch helper for every screen:
//   - JSON in / JSON out, never cached;
//   - 401 → reload (the sign-in gate sends a tablet to its PIN screen, anyone else to /login);
//   - 428 → asks for a manager PIN (ApprovalProvider) and retries with it, 403 wrongPin → asks again.
export class ApiError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> = {}) { super(message); }
}

export type ApprovalRequest = { action: string; label?: string; labelFr?: string; error?: string; wrongPin?: boolean };
type ApprovalHandler = (req: ApprovalRequest) => Promise<string | null>;
let approvalHandler: ApprovalHandler | null = null;
export function setApprovalHandler(h: ApprovalHandler | null) { approvalHandler = h; }

export async function api<T = Record<string, unknown>>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let pin: string | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(path, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(headers as Record<string, string> | undefined), ...(pin ? { 'x-approval-pin': pin } : {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as Record<string, unknown>;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/api/foodhub/auth/')) {
      window.location.reload();
      throw new ApiError('Session expirée / Session expired', 401, body);
    }
    if ((res.status === 428 || (res.status === 403 && body.needsApproval)) && approvalHandler) {
      pin = await approvalHandler({ action: String(body.action ?? ''), label: body.label as string, labelFr: body.labelFr as string, error: body.error as string, wrongPin: res.status === 403 });
      if (!pin) throw new ApiError('Annulé / Cancelled', 499, body);
      continue;
    }
    if (!res.ok || body.ok === false) throw new ApiError(String(body.error ?? `HTTP ${res.status}`), res.status, body);
    return body as T;
  }
  throw new ApiError('Trop d’essais / Too many tries', 429);
}

export function money(n: number | null | undefined, loc = 'fr-CA') {
  return new Intl.NumberFormat(loc, { style: 'currency', currency: 'CAD' }).format(Number(n || 0));
}

export function timeOf(iso?: string | null, loc = 'fr-CA', withDate = false) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(loc, withDate ? { dateStyle: 'short', timeStyle: 'short' } : { hour: '2-digit', minute: '2-digit' });
}

export function dayOf(iso?: string | null, loc = 'fr-CA') {
  if (!iso) return '—';
  return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ago(iso: string | null | undefined, lang: 'fr' | 'en' = 'fr') {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return lang === 'fr' ? `il y a ${s} s` : `${s}s ago`;
  if (s < 3600) return lang === 'fr' ? `il y a ${Math.round(s / 60)} min` : `${Math.round(s / 60)} min ago`;
  if (s < 86400) return lang === 'fr' ? `il y a ${Math.round(s / 3600)} h` : `${Math.round(s / 3600)} h ago`;
  return lang === 'fr' ? `il y a ${Math.round(s / 86400)} j` : `${Math.round(s / 86400)} d ago`;
}

/** CSV download (UTF-8 BOM for Excel; formulas neutralised). rows[0] = header. */
export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s) && typeof v === 'string') s = `'${s}`;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

export function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}
