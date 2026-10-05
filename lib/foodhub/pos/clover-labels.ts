// Kitchen printing check for Clover: an item prints in the kitchen only if it carries a LABEL that is linked to a
// printer (Clover → Setup → Printers → Order receipts → labels). Items without such a label never print — that is
// why DoorDash orders that reach Clover through Clover's own integration can arrive silently.
// Food Hub lists those items and, when the owner clicks, adds the chosen kitchen label to them. Nothing is removed.
// Clover endpoints (docs.clover.com):
//   GET  /v3/merchants/{mId}/tags?expand=printers            labels and their printers
//   GET  /v3/merchants/{mId}/items?expand=tags                items and their labels (paged)
//   POST /v3/merchants/{mId}/tag_items  { elements: [{ item: { id }, tag: { id } }] }   add item ↔ label links
import { logActivity } from '../activity';
import { timedFetch } from '../config';
import { cloverBaseUrl, cloverToken } from './clover';

export interface CloverLabel { id: string; name: string; printers: number }
export interface CloverLabelReport {
  merchantId: string;
  ok: boolean;
  error?: string;
  labels: CloverLabel[];
  /** Labels linked to at least one printer. */
  kitchenLabels: CloverLabel[];
  items: number;
  /** Items (not hidden / not deleted) that no printer label covers: they never print in the kitchen. */
  unprinted: Array<{ id: string; name: string }>;
}

async function cloverGet(mid: string, token: string, path: string, qs: Record<string, string>): Promise<any> {
  const res = await timedFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/${path}?${new URLSearchParams(qs)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Clover ${path} HTTP ${res.status}`);
  return res.json();
}

export async function cloverLabelReport(mid: string): Promise<CloverLabelReport> {
  const empty: CloverLabelReport = { merchantId: mid, ok: false, labels: [], kitchenLabels: [], items: 0, unprinted: [] };
  const token = await cloverToken(mid);
  if (!token) return { ...empty, error: `No Clover API token for merchant ${mid}` };
  try {
    const tagsJson = await cloverGet(mid, token, 'tags', { expand: 'printers', limit: '500' });
    const labels: CloverLabel[] = (tagsJson?.elements ?? []).map((t: any) => ({ id: String(t.id), name: String(t.name ?? ''), printers: (t.printers?.elements ?? []).length }));
    const kitchen = new Set(labels.filter((l) => l.printers > 0).map((l) => l.id));
    const items: any[] = [];
    for (let page = 0; page < 20; page++) {
      const json = await cloverGet(mid, token, 'items', { expand: 'tags', limit: '1000', offset: String(page * 1000) });
      const rows: any[] = json?.elements ?? [];
      items.push(...rows);
      if (rows.length < 1000) break;
    }
    const live = items.filter((i) => !i.hidden && !i.deleted);
    const unprinted = live
      .filter((i) => !(i.tags?.elements ?? []).some((t: any) => kitchen.has(String(t.id))))
      .map((i) => ({ id: String(i.id), name: String(i.name ?? '') }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { merchantId: mid, ok: true, labels, kitchenLabels: labels.filter((l) => l.printers > 0), items: live.length, unprinted };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Adds a printer label to items (links only — existing labels stay). Batches of 100. */
export async function assignCloverLabel(mid: string, tagId: string, itemIds: string[], actor: string): Promise<{ ok: boolean; added: number; error?: string }> {
  const token = await cloverToken(mid);
  if (!token) return { ok: false, added: 0, error: `No Clover API token for merchant ${mid}` };
  const ids = [...new Set(itemIds.filter((i) => /^[A-Za-z0-9_-]{3,40}$/.test(i)))];
  if (!ids.length) return { ok: false, added: 0, error: 'No items to label.' };
  let added = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await timedFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/tag_items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ elements: chunk.map((id) => ({ item: { id }, tag: { id: tagId } })) }),
    });
    if (!res.ok) {
      const error = `Clover refused the labels (HTTP ${res.status}) after ${added} item(s).`;
      await logActivity({ actor, source: 'dashboard', kind: 'settings', action: 'clover_labels', status: 'failed', summary: `Kitchen printer label not added in Clover (merchant ${mid}): ${error}` });
      return { ok: false, added, error };
    }
    added += chunk.length;
  }
  await logActivity({ actor, source: 'dashboard', kind: 'settings', action: 'clover_labels', status: 'success', summary: `Kitchen printer label added to ${added} Clover item(s) (merchant ${mid}) — they now print in the kitchen.` });
  return { ok: true, added };
}

// ---- Tax rates check (read-only) ------------------------------------------------------------------------------
// Clover stores a tax rate as percent × 100 000 (14.975 % = 1 497 500). A Quebec rate entered as "0.14975" instead of
// "14.975" charges almost no tax on in-store sales — Food Hub only points it out; the owner fixes it in Clover
// (Setup → Taxes & Fees). Quebec: GST 5 % + QST 9.975 % = 14.975 % (one combined rate or two separate rates).
export interface CloverTaxRate { id: string; name: string; percent: number; isDefault: boolean }
export interface CloverTaxCheck { ok: boolean; error?: string; rates: CloverTaxRate[]; defaultPercent: number; problems: string[]; problemsFr: string[] }

export function taxProblems(rates: CloverTaxRate[]): string[] {
  const out: string[] = [];
  const defaults = rates.filter((r) => r.isDefault);
  const total = Math.round(defaults.reduce((s, r) => s + r.percent, 0) * 1000) / 1000;
  for (const r of rates) {
    if (r.percent > 0 && r.percent < 1) out.push(`"${r.name}" is ${r.percent}% — did you mean ${Math.round(r.percent * 100 * 1000) / 1000}%?`);
  }
  if (defaults.length && Math.abs(total - 14.975) > 0.001 && !out.length) out.push(`Default taxes add up to ${total}% (Quebec GST + QST = 14.975%).`);
  if (!defaults.length) out.push('No default tax rate: new items are not taxed.');
  return out;
}

/** Same checks, in French (the console is French first). */
export function taxProblemsFr(rates: CloverTaxRate[]): string[] {
  const out: string[] = [];
  const fr = (n: number) => String(n).replace('.', ',');
  const defaults = rates.filter((r) => r.isDefault);
  const total = Math.round(defaults.reduce((s, r) => s + r.percent, 0) * 1000) / 1000;
  for (const r of rates) {
    if (r.percent > 0 && r.percent < 1) out.push(`« ${r.name} » est à ${fr(r.percent)} % — vouliez-vous ${fr(Math.round(r.percent * 100 * 1000) / 1000)} % ?`);
  }
  if (defaults.length && Math.abs(total - 14.975) > 0.001 && !out.length) out.push(`Les taxes par défaut totalisent ${fr(total)} % (TPS + TVQ au Québec = 14,975 %).`);
  if (!defaults.length) out.push('Aucune taxe par défaut : les nouveaux articles ne sont pas taxés.');
  return out;
}

export async function cloverTaxCheck(mid: string): Promise<CloverTaxCheck> {
  const token = await cloverToken(mid);
  if (!token) return { ok: false, error: `No Clover API token for merchant ${mid}`, rates: [], defaultPercent: 0, problems: [], problemsFr: [] };
  try {
    const json = await cloverGet(mid, token, 'tax_rates', { limit: '100' });
    const rates: CloverTaxRate[] = (json?.elements ?? []).filter((r: any) => !r.deletedTime).map((r: any) => ({
      id: String(r.id), name: String(r.name ?? ''), percent: Math.round(Number(r.rate) || 0) / 100000, isDefault: Boolean(r.isDefault),
    }));
    const defaultPercent = Math.round(rates.filter((r) => r.isDefault).reduce((s, r) => s + r.percent, 0) * 1000) / 1000;
    return { ok: true, rates, defaultPercent, problems: taxProblems(rates), problemsFr: taxProblemsFr(rates) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), rates: [], defaultPercent: 0, problems: [], problemsFr: [] };
  }
}
