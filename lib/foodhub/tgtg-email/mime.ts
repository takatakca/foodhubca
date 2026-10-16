// Raw e-mail (RFC 822 / MIME source, as IMAP or a forwarding service gives it) → TgtgMail.
import type { TgtgMail } from './parse';

type AddressLike = { text?: string; value?: Array<{ address?: string; name?: string }> } | Array<{ text?: string; value?: Array<{ address?: string }> }> | undefined;

function firstAddress(a: AddressLike): string {
  const one = Array.isArray(a) ? a[0] : a;
  return one?.value?.[0]?.address ?? one?.text ?? '';
}

/** Parses a raw MIME message (Buffer or string). Never throws for a malformed message: the parts it could read are returned. */
export async function mailFromMime(source: Buffer | string): Promise<TgtgMail> {
  const { simpleParser } = await import('mailparser');
  const p = await simpleParser(source, { skipImageLinks: true, skipTextLinks: true });
  const header = (k: string) => {
    const v = p.headers.get(k);
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && 'value' in (v as object)) return firstAddress(v as AddressLike);
    return String(v);
  };
  return {
    from: firstAddress(p.from as AddressLike),
    senders: [header('sender'), firstAddress(p.replyTo as AddressLike), header('x-original-from'), header('x-forwarded-for')].filter(Boolean),
    to: firstAddress(p.to as AddressLike),
    subject: p.subject ?? '',
    text: p.text ?? '',
    html: typeof p.html === 'string' ? p.html : '',
    messageId: p.messageId ?? undefined,
    date: p.date ? p.date.toISOString() : undefined,
  };
}
