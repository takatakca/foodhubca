// Reads the Too Good To Go e-mails from a mailbox (IMAP), from the existing heartbeat (cron/watch, live pulse, server
// timer). The mailbox is opened READ-ONLY: nothing is marked read, moved or deleted, so a person can still use it.
// A cursor (UIDVALIDITY + last UID) remembers how far Food Hub read; each e-mail is also recorded by Message-ID, so a
// reset cursor never creates an order twice. Only e-mails from an allowed sender (TGTG_EMAIL_FROM_ALLOW) are
// downloaded: the other mail in the box is never read beyond its envelope.
import { senderAllowed } from './parse';
import { mailFromMime } from './mime';
import { ingestTgtgMail } from './ingest';
import { getMailboxStatus, getTgtgEmailSettings, imapConfig, setMailboxStatus } from './settings';
import { getRepo } from '../repo';

type Addr = { address?: string };
type Envelope = { from?: Addr[]; sender?: Addr[]; replyTo?: Addr[]; subject?: string };

/** The part of imapflow's client this poller uses (a fake one in tests). */
export interface ImapLike {
  mailbox: false | { uidValidity?: bigint | number | string; uidNext?: number };
  connect(): Promise<void>;
  getMailboxLock(path: string, options?: { readOnly?: boolean }): Promise<{ release(): void }>;
  search(query: Record<string, unknown>, options: { uid: true }): Promise<number[] | false | undefined>;
  fetchOne(seq: string, query: Record<string, unknown>, options: { uid: true }): Promise<{ uid?: number; envelope?: Envelope; source?: Buffer } | false | undefined>;
  logout(): Promise<void>;
  close?(): void;
}

const TICK_KEY = 'tgtg_email_tick';
/** At most this many e-mails per run (the rest on the next one). */
const MAX_PER_RUN = 40;

export function pollSeconds(): number {
  const v = Number(process.env.TGTG_IMAP_POLL_S);
  return Number.isFinite(v) && v >= 20 ? v : 60;
}

/** First run (or a mailbox that changed): how far back to look. */
function lookbackHours(): number {
  const v = Number(process.env.TGTG_IMAP_LOOKBACK_H);
  return Number.isFinite(v) && v > 0 && v <= 168 ? v : 12;
}

async function newClient(): Promise<ImapLike> {
  const cfg = imapConfig()!;
  const { ImapFlow } = await import('imapflow');
  return new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.password },
    logger: false, disableAutoIdle: true, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000,
  }) as unknown as ImapLike;
}

export interface PollResult { ran: boolean; ok?: boolean; reason?: string; error?: string; checked?: number; handled?: number; statuses?: Record<string, number> }

/** One read of the mailbox. Never throws: the error is kept on the mailbox status (Settings → Platforms). */
export async function pollTgtgMailbox(opts: { now?: number; client?: ImapLike } = {}): Promise<PollResult> {
  const cfg = imapConfig();
  if (!cfg) return { ran: false, reason: 'mailbox not configured (TGTG_IMAP_HOST / TGTG_IMAP_USER / TGTG_IMAP_PASSWORD)' };
  if (!(await getTgtgEmailSettings()).enabled) return { ran: false, reason: 'switched off in Settings → Platforms' };
  const now = opts.now ?? Date.now();
  const status = await getMailboxStatus();
  await setMailboxStatus({ lastRunAt: new Date(now).toISOString() });
  const statuses: Record<string, number> = {};
  let checked = 0;
  let handled = 0;
  let client: ImapLike | null = null;
  try {
    client = opts.client ?? (await newClient());
    await client.connect();
    const lock = await client.getMailboxLock(cfg.mailbox, { readOnly: true });
    try {
      const box = client.mailbox;
      const uidValidity = box && box.uidValidity !== undefined ? String(box.uidValidity) : '';
      const sameBox = Boolean(uidValidity && status.uidValidity === uidValidity && status.lastUid);
      const since = new Date(now - lookbackHours() * 3600_000);
      const found = sameBox
        ? await client.search({ uid: `${status.lastUid! + 1}:*` }, { uid: true })
        : await client.search({ since }, { uid: true });
      const uids = [...new Set(Array.isArray(found) ? found : [])].filter((u) => !sameBox || u > status.lastUid!).sort((a, b) => a - b).slice(0, MAX_PER_RUN);
      let lastUid = sameBox ? status.lastUid! : 0;
      for (const uid of uids) {
        checked++;
        const head = await client.fetchOne(String(uid), { envelope: true, uid: true }, { uid: true });
        const env = head ? head.envelope : undefined;
        const from = env?.from?.[0]?.address ?? '';
        const senders = [...(env?.sender ?? []), ...(env?.replyTo ?? [])].map((a) => a.address ?? '').filter(Boolean);
        if (senderAllowed({ from, senders })) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (msg && msg.source) {
            // A database failure throws here: the cursor stays before this e-mail, so the next run reads it again.
            const r = await ingestTgtgMail(await mailFromMime(msg.source), 'imap', { now });
            statuses[r.status] = (statuses[r.status] ?? 0) + 1;
            handled++;
          }
        }
        lastUid = Math.max(lastUid, uid);
        await setMailboxStatus({ uidValidity, lastUid });
      }
      await setMailboxStatus({ uidValidity, lastUid: lastUid || status.lastUid || 0, lastOkAt: new Date(now).toISOString(), lastError: null, fetched: checked, handled });
    } finally {
      lock.release();
    }
    return { ran: true, ok: true, checked, handled, statuses };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Never the password: imapflow errors carry the server's answer only.
    await setMailboxStatus({ lastError: message.slice(0, 300) }).catch(() => undefined);
    return { ran: true, ok: false, error: message, checked, handled, statuses };
  } finally {
    if (client) await client.logout().catch(() => client?.close?.());
  }
}

/** Heartbeat (cron/watch, live pulse, server timer): at most every TGTG_IMAP_POLL_S (default 60 s), one run at a time. */
export async function tickTgtgEmail(now = Date.now()): Promise<PollResult> {
  if (!imapConfig()) return { ran: false, reason: 'mailbox not configured' };
  const g = globalThis as { __foodhubTgtgMailTick?: boolean };
  if (g.__foodhubTgtgMailTick) return { ran: false, reason: 'already running' };
  g.__foodhubTgtgMailTick = true;
  try {
    const repo = getRepo();
    const last = await repo.getKv<number>(TICK_KEY).catch(() => null);
    if (last && now - last < pollSeconds() * 1000) return { ran: false, reason: 'throttled' };
    await repo.setKv(TICK_KEY, now);
    return await pollTgtgMailbox({ now });
  } catch (e) {
    console.error('[foodhub] Too Good To Go mailbox tick failed', e instanceof Error ? e.message : e);
    return { ran: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    g.__foodhubTgtgMailTick = false;
  }
}
