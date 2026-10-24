// The electronic copy of a Takatak MEV invoice: the public page /r/<token> (app/r/[token]/route.ts) and, for our own
// orders only, a text or e-mail with that link (opt-in: FOODHUB_MEV_SEND_RECEIPT=on, and only when the customer gave a
// contact with the order). Platform orders never get one: the platforms mask the customer's contact, so the paper copy
// goes in the bag. Everything shown comes from QCMEV as it rendered it; Food Hub adds nothing to the invoice itself.
import { publicBaseUrl } from '../config';
import type { DirectOrder } from '../delivery/types';
import type { MevRecord } from './types';

export const ONLINE_LINK_LABEL = 'Consulter la transaction en ligne';

export function receiptUrl(token: string): string {
  return `${publicBaseUrl().replace(/\/+$/, '')}/r/${token}`;
}

export function receiptSendOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(on|true|1|yes)$/i.test(String(env.FOODHUB_MEV_SEND_RECEIPT ?? '').trim());
}

/** Texts or e-mails the receipt link of an own order (never a platform order). Best effort; logged in the notify outbox, masked. */
export async function sendReceiptLink(o: DirectOrder, rec: MevRecord): Promise<boolean> {
  if (!receiptSendOn() || !rec.token || !rec.noTrans) return false;
  const lang = o.customer.lang === 'en' ? 'en' : 'fr';
  const url = receiptUrl(rec.token);
  const text = lang === 'en'
    ? `${o.brandName}: your invoice no. ${rec.noTrans} (order ${o.number}): ${url}`
    : `${o.brandName} : votre facture n° ${rec.noTrans} (commande ${o.number}) : ${url}`;
  const { sendEmail, sendSms } = await import('../notify');
  if (o.customer.email) {
    const r = await sendEmail({ to: o.customer.email, subject: lang === 'en' ? `Invoice ${rec.noTrans} — ${o.brandName}` : `Facture ${rec.noTrans} — ${o.brandName}`, text }, { purpose: 'mev_receipt', by: 'Food Hub' });
    if (r.ok) return true;
  }
  if (o.customer.phone) return (await sendSms({ to: o.customer.phone, body: text }, { purpose: 'mev_receipt', by: 'Food Hub' })).ok;
  return false;
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * The public page = the ELECTRONIC invoice QCMEV rendered (formImpr ELE / PEL only; null otherwise): its lines inside the
 * block exactly as given, the QR image on the "[CODE QR]" line and, right under it, the hyperlink « Consulter la
 * transaction en ligne » (Revenu Québec, « Exemple de facture »). On PEL QCMEV's text says « Copie électronique ».
 */
export function publicReceiptHtml(rec: MevRecord, meta: { brand?: string; number?: string }): string | null {
  const doc = rec.textElectronic;
  if (!(rec.format === 'ELE' || rec.format === 'PEL') || !doc?.length) return null;
  const at = doc.findIndex((l) => l.trim() === '[CODE QR]');
  const before = (at >= 0 ? doc.slice(0, at) : doc).map(esc).join('\n');
  let after = at >= 0 ? doc.slice(at + 1) : [];
  if (after[0]?.trim() === ONLINE_LINK_LABEL) after = after.slice(1);
  const qr = at >= 0 && rec.qrImage ? `<img class="qr" alt="Code QR de la transaction" src="${esc(rec.qrImage)}">` : '';
  const link = at >= 0 && rec.qrUrl ? `<p class="link"><a href="${esc(rec.qrUrl)}" rel="noopener noreferrer">${esc(ONLINE_LINK_LABEL)}</a></p>` : '';
  const lines = `${before}</pre>${qr}${link}<pre>${after.map(esc).join('\n')}`;
  const credited = rec.status === 'credited' ? '<p class="warn">NOTE DE CRÉDIT ÉMISE — cette facture a été créditée.</p>' : '';
  const offline = rec.status === 'offline' ? '<p class="muted">Facture signée hors ligne : elle sera transmise à Revenu Québec dès le retour de la connexion.</p>' : '';
  return `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Facture ${esc(rec.noTrans ?? '')}</title>
<style>:root{color-scheme:light}body{margin:0;background:#f3f4f6;color:#111;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}main{max-width:420px;margin:0 auto;padding:24px 16px}
.paper{background:#fff;border-radius:10px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.08);overflow-x:auto}pre{font:12px/1.35 'Courier New',Consolas,monospace;white-space:pre;margin:0}
.qr{display:block;width:180px;height:180px;margin:8px auto 0;image-rendering:pixelated}.link{margin:0 0 4px}p{text-align:center;margin:8px 0}a{color:#0b57d0;font-weight:600}.muted{color:#555;font-size:14px}.warn{color:#b42318;font-weight:700}</style></head>
<body><main><div class="paper"><pre>${lines}</pre>${credited}${offline}</div><p class="muted">${esc(meta.brand ?? '')}${meta.number ? ` · ${esc(meta.number)}` : ''}</p></main></body></html>`;
}
