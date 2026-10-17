// Raw e-mail (RFC 822 / MIME source, as IMAP or a forwarding service gives it) → TgtgMail.
import type { TgtgMail } from './parse';

type AddressLike = { text?: string; value?: Array<{ address?: string; name?: string }> } | Array<{ text?: string; value?: Array<{ address?: string }> }> | undefined;

function firstAddress(a: AddressLike): string {
  const one = Array.isArray(a) ? a[0] : a;
  return one?.value?.[0]?.address ?? one?.text ?? '';
}

/** "Authentication-Results: …" header lines (folded lines joined), top of the message first. */
function authResultsOf(headerLines: Array<{ key: string; line: string }> | undefined): string[] {
  return (headerLines ?? [])
    .filter((h) => h.key.toLowerCase() === 'authentication-results')
    .map((h) => h.line.replace(/\r?\n[ \t]+/g, ' ').replace(/^[^:]*:\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Parses a raw MIME message (Buffer or string). Never throws for a malformed message: the parts it could read are
 * returned. Only From is kept as the sender (Sender / Reply-To / X-Original-From are never trusted), plus the
 * Authentication-Results headers the receiving server added (parse.ts → senderVerified).
 */
export async function mailFromMime(source: Buffer | string): Promise<TgtgMail> {
  const { simpleParser } = await import('mailparser');
  const p = await simpleParser(source, { skipImageLinks: true, skipTextLinks: true });
  return {
    from: firstAddress(p.from as AddressLike),
    authResults: authResultsOf(p.headerLines as Array<{ key: string; line: string }> | undefined),
    to: firstAddress(p.to as AddressLike),
    subject: p.subject ?? '',
    text: p.text ?? '',
    html: typeof p.html === 'string' ? p.html : '',
    messageId: p.messageId ?? undefined,
    date: p.date ? p.date.toISOString() : undefined,
  };
}
