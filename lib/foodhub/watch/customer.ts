// Customer contact for an order — only what the platform itself shares. Uber Eats and DoorDash give a
// masked relay number (sometimes with an access code), so calling works; texting only works when the
// platform shares a real mobile number. Messages are short, operational and never marketing.
import { normalizePhone } from '../notify';
import type { StoredOrder } from '../types';

export interface CustomerContact {
  name: string | null;
  phone: string | null;
  /** Relay access code (Uber "phone_code", JET "phoneMaskingCode") — dialled after the number. */
  code: string | null;
  /** tel: link that also dials the access code. */
  tel: string | null;
  canSms: boolean;
}

export function customerContact(o: Pick<StoredOrder, 'raw' | 'customerName' | 'channel'>): CustomerContact {
  const raw = (o.raw ?? {}) as Record<string, any>;
  const src = raw.order ?? raw;
  const phoneRaw: string | undefined =
    src?.eater?.phone ?? src?.consumer?.phone_number ?? src?.consumer?.phone ?? src?.customer?.phoneNumber ?? src?.customer?.phone ?? src?.customer?.phone_number ?? src?.delivery?.phone ?? undefined;
  const code: string | null = String(src?.eater?.phone_code ?? src?.customer?.phoneMaskingCode ?? src?.consumer?.phone_code ?? '').replace(/[^\d]/g, '') || null;
  const phone = normalizePhone(phoneRaw);
  return {
    name: o.customerName ?? null,
    phone,
    code,
    tel: phone ? `tel:${phone}${code ? `,,${code}` : ''}` : null,
    canSms: Boolean(phone && !code),
  };
}

export function lateMessage(o: Pick<StoredOrder, 'brandName' | 'customerName'>, minutes: number) {
  const first = (o.customerName ?? '').split(' ')[0];
  const brand = o.brandName ?? 'TAKATAK';
  return {
    fr: `${brand} : ${first ? `Bonjour ${first}, ` : ''}votre commande prend environ ${minutes} minutes de plus que prévu. Toutes nos excuses — elle part dès qu’elle est prête.`,
    en: `${brand}: ${first ? `Hi ${first}, ` : ''}your order needs about ${minutes} more minutes. Sorry for the wait — it leaves as soon as it is ready.`,
  };
}
