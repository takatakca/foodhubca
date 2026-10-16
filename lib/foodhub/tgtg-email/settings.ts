// Too Good To Go order e-mails: settings (on/off, store-name mapping), env readiness and the e-mail log.
//
// Store mapping: the store name TGTG writes in its e-mails ("OOEUF NDG") → a Food Hub brand + kitchen. Saving a mapping
// creates the matching Too Good To Go store under Stores (channel tgtg, id "email:<name>"), so the order pipeline finds
// its brand, kitchen and Clover register exactly as for every other platform order.
import crypto from 'node:crypto';
import rawBrands from '../../../data/actual/brands.json';
import rawLocations from '../../../data/actual/locations.json';
import { logActivity, type Actor } from '../activity';
import { matchBrandLocation, normName, type LocationRef } from '../brand-match';
import { nowIso } from '../config';
import { getRepo } from '../repo';
import type { ChannelStore } from '../types';
import type { TgtgMail, TgtgMailParse } from './parse';

export const SETTINGS_KEY = 'tgtg_email_settings';
export const STATUS_KEY = 'tgtg_email_mailbox_status';
export const MAILS = 'tgtg_emails';
export const STORE_PREFIX = 'email:';

export interface TgtgStoreMapping {
  /** As TGTG writes it in the e-mails. */
  storeName: string;
  brandName: string;
  locationCode: string;
  cloverMerchantId?: string | null;
  at: string;
  by: string;
}

export interface TgtgEmailSettings {
  /** The owner's switch (Settings → Platforms). Default on once a mailbox or the webhook secret is configured. */
  enabled: boolean;
  mappings: TgtgStoreMapping[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface MailboxStatus {
  lastRunAt?: string;
  lastOkAt?: string;
  lastError?: string | null;
  /** IMAP cursor: UIDVALIDITY of the mailbox and the last UID read. */
  uidValidity?: string;
  lastUid?: number;
  fetched?: number;
  handled?: number;
}

export type MailStatus = 'order_created' | 'duplicate' | 'cancel_applied' | 'cancel_pending' | 'attention' | 'too_late' | 'ignored' | 'error';

/** One e-mail Food Hub read (last parsed e-mails, attention list). Kept so a fixed mapping / reader can retry it. */
export interface TgtgMailRecord {
  id: string;
  source: 'imap' | 'webhook' | 'retry';
  receivedAt: string;
  messageId?: string;
  from: string;
  subject: string;
  date?: string;
  status: MailStatus;
  reason?: string;
  parse?: TgtgMailParse;
  orderId?: string | null;
  brandName?: string | null;
  locationCode?: string | null;
  /** The e-mail itself (text trimmed), for a retry. */
  mail: Pick<TgtgMail, 'from' | 'authResults' | 'subject' | 'text' | 'html' | 'messageId' | 'date'>;
  dismissedAt?: string;
  dismissedBy?: string;
}

const isSet = (k: string) => Boolean(process.env[k]?.trim());

/** IMAP mailbox env. Off when host, user or password is missing. */
export function imapConfig(): { host: string; port: number; secure: boolean; user: string; password: string; mailbox: string } | null {
  if (!isSet('TGTG_IMAP_HOST') || !isSet('TGTG_IMAP_USER') || !isSet('TGTG_IMAP_PASSWORD')) return null;
  const port = Number(process.env.TGTG_IMAP_PORT || 993);
  return {
    host: process.env.TGTG_IMAP_HOST!.trim(),
    port: Number.isFinite(port) && port > 0 ? port : 993,
    // 993 = TLS from the start; 143 = STARTTLS (imapflow upgrades when the server offers it). TGTG_IMAP_SECURE overrides.
    secure: process.env.TGTG_IMAP_SECURE ? !/^(false|0|no|off)$/i.test(process.env.TGTG_IMAP_SECURE) : port !== 143,
    user: process.env.TGTG_IMAP_USER!.trim(),
    password: process.env.TGTG_IMAP_PASSWORD!,
    mailbox: process.env.TGTG_IMAP_MAILBOX?.trim() || 'INBOX',
  };
}

export function webhookSecretSet(): boolean {
  return isSet('TGTG_EMAIL_WEBHOOK_SECRET');
}

/** What the environment allows (the owner's switch comes on top). */
export function tgtgEmailReadiness() {
  const imap = imapConfig();
  return {
    imapConfigured: Boolean(imap),
    webhookConfigured: webhookSecretSet(),
    configured: Boolean(imap) || webhookSecretSet(),
    mailbox: imap ? { host: imap.host, port: imap.port, user: maskUser(imap.user), mailbox: imap.mailbox } : null,
    missing: imap ? [] : ['TGTG_IMAP_HOST', 'TGTG_IMAP_USER', 'TGTG_IMAP_PASSWORD'].filter((k) => !isSet(k)),
    webhookPath: '/api/foodhub/webhooks/tgtg-email',
  };
}

/** "orders@example.com" → "or…@example.com" (the screen never shows the whole mailbox login). */
export function maskUser(user: string): string {
  const [name, domain] = user.split('@');
  if (!domain) return `${user.slice(0, 2)}…`;
  return `${name.slice(0, 2)}…@${domain}`;
}

export async function getTgtgEmailSettings(): Promise<TgtgEmailSettings> {
  const s = await getRepo().getKv<TgtgEmailSettings>(SETTINGS_KEY).catch(() => null);
  return { enabled: s?.enabled ?? true, mappings: Array.isArray(s?.mappings) ? s!.mappings : [], updatedAt: s?.updatedAt, updatedBy: s?.updatedBy };
}

/** On = configured in the environment AND switched on by the owner. */
export async function tgtgEmailActive(): Promise<boolean> {
  return tgtgEmailReadiness().configured && (await getTgtgEmailSettings()).enabled;
}

export async function setTgtgEmailEnabled(enabled: boolean, actor: Actor): Promise<TgtgEmailSettings> {
  const s = await getTgtgEmailSettings();
  const next = { ...s, enabled, updatedAt: nowIso(), updatedBy: actor.name };
  await getRepo().setKv(SETTINGS_KEY, next);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'tgtg_email_switch', status: 'success', channel: 'tgtg', summary: `Too Good To Go order e-mails switched ${enabled ? 'ON' : 'OFF'}` });
  return next;
}

/** Same key for "OOEUF NDG", "Ooeuf  ndg" and "OOEUF – NDG". */
export function storeKey(storeName: string): string {
  return normName(storeName);
}

export function tgtgEmailStoreId(storeName: string): string {
  return `${STORE_PREFIX}${storeKey(storeName)}`;
}

/** Store id of an order whose TGTG store name is not mapped: no store ever has it, so nothing routes the order. */
export const UNMAPPED_PREFIX = 'email-unmapped:';
export function tgtgUnmappedStoreId(storeName: string): string {
  return `${UNMAPPED_PREFIX}${storeKey(storeName)}`;
}

export function findMapping(settings: TgtgEmailSettings, storeName: string | undefined): TgtgStoreMapping | null {
  if (!storeName) return null;
  const k = storeKey(storeName);
  return settings.mappings.find((m) => storeKey(m.storeName) === k) ?? null;
}

export const LOCATIONS = rawLocations as Array<LocationRef & { name: string }>;
export const BRANDS = (rawBrands as string[]).filter((b) => b !== 'Too Good To Go');

/** Owner order: Po Poulet is sold only at Saint-Léonard. */
export function mappingProblem(brandName: string, locationCode: string): string | null {
  if (!BRANDS.includes(brandName)) return `Unknown brand "${brandName}".`;
  if (!LOCATIONS.some((l) => l.code === locationCode)) return `Unknown kitchen "${locationCode}".`;
  if (/^po\s*poulet$/i.test(brandName.trim()) && locationCode !== 'SAINT_LEONARD') return 'Po Poulet is sold only at Saint-Léonard (5839 Rue Jean-Talon E).';
  return null;
}

/**
 * A suggestion for an unmapped TGTG store name (the owner confirms): brand from the name, kitchen from the civic number
 * in the address (6280 / 6284 Av Somerled, 5839 Rue Jean-Talon E…), else from the neighbourhood ("NDG" → NDG MAIN).
 */
export function suggestTgtgMapping(storeName: string, address = ''): { brandName?: string; locationCode?: string } {
  const s = matchBrandLocation(storeName, address, BRANDS, LOCATIONS);
  let loc = s.suggestedLocation;
  if (!loc && /\bndg\b|notre[\s-]*dame[\s-]*de[\s-]*gr[aâ]ce|somerled/i.test(`${storeName} ${address}`)) loc = 'NDG_MAIN';
  if (!loc && /jean[\s-]*talon/i.test(`${storeName} ${address}`)) loc = 'SAINT_LEONARD';
  if (s.suggestedBrand && /^po\s*poulet$/i.test(s.suggestedBrand)) loc = 'SAINT_LEONARD';
  return { brandName: s.suggestedBrand, locationCode: loc };
}

/** The Clover register of a kitchen: the one already used by another store of that kitchen (same brand first). */
async function cloverMerchantFor(brandName: string, locationCode: string): Promise<string | null> {
  const stores = (await getRepo().listStores()).filter((s) => s.locationCode === locationCode && s.cloverMerchantId);
  return stores.find((s) => s.brandName === brandName)?.cloverMerchantId ?? stores[0]?.cloverMerchantId ?? null;
}

/** Saves (or replaces) a mapping and the Too Good To Go store the pipeline routes with. */
export async function saveTgtgMapping(input: { storeName: string; brandName: string; locationCode: string; cloverMerchantId?: string | null }, actor: Actor): Promise<{ mapping: TgtgStoreMapping; store: ChannelStore }> {
  const storeName = input.storeName.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!storeKey(storeName)) throw new Error('Enter the store name exactly as Too Good To Go writes it in its e-mails.');
  const problem = mappingProblem(input.brandName, input.locationCode);
  if (problem) throw new Error(problem);
  const repo = getRepo();
  const s = await getTgtgEmailSettings();
  const cloverMerchantId = input.cloverMerchantId?.trim() || (await cloverMerchantFor(input.brandName, input.locationCode));
  const mapping: TgtgStoreMapping = { storeName, brandName: input.brandName, locationCode: input.locationCode, cloverMerchantId, at: nowIso(), by: actor.name };
  const mappings = [...s.mappings.filter((m) => storeKey(m.storeName) !== storeKey(storeName)), mapping].sort((a, b) => a.storeName.localeCompare(b.storeName));
  await repo.setKv(SETTINGS_KEY, { ...s, mappings, updatedAt: nowIso(), updatedBy: actor.name });
  const channelStoreId = tgtgEmailStoreId(storeName);
  const prev = await repo.findStore('tgtg', channelStoreId);
  const store = await repo.upsertStore({
    ...(prev ? { id: prev.id } : {}),
    channel: 'tgtg', channelStoreId, brandName: input.brandName, locationCode: input.locationCode, cloverMerchantId: cloverMerchantId ?? null,
    // A TGTG reservation is already confirmed and paid in the TGTG app: nothing to accept, the kitchen just prepares it.
    autoAccept: true, online: prev?.online ?? true, meta: { ...(prev?.meta ?? {}), source: 'tgtg_email', storeName },
  });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'tgtg_email_mapping', status: 'success', channel: 'tgtg', brandName: input.brandName, locationCode: input.locationCode, storeId: store.id,
    summary: `Too Good To Go e-mails: "${storeName}" → ${input.brandName} @ ${input.locationCode}${cloverMerchantId ? ` (Clover ${cloverMerchantId})` : ' (no Clover register found for this kitchen yet)'}` });
  return { mapping, store };
}

export async function removeTgtgMapping(storeName: string, actor: Actor): Promise<void> {
  const repo = getRepo();
  const s = await getTgtgEmailSettings();
  await repo.setKv(SETTINGS_KEY, { ...s, mappings: s.mappings.filter((m) => storeKey(m.storeName) !== storeKey(storeName)), updatedAt: nowIso(), updatedBy: actor.name });
  // New e-mails from that name are no longer routed to it (ingest: no mapping → an id no store has, nothing sent to
  // Clover, nothing accepted) and wait in the attention list. The store itself stays, with its Clover register, only so
  // the orders it already sent can still be paid or flagged cancelled in that register; it never accepts on its own.
  const store = await repo.findStore('tgtg', tgtgEmailStoreId(storeName));
  if (store) await repo.updateStore(store.id, { autoAccept: false, meta: { ...store.meta, unmappedAt: nowIso() } });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'tgtg_email_unmap', status: 'success', channel: 'tgtg', summary: `Too Good To Go e-mails: mapping for "${storeName}" removed` });
}

// ---------------------------------------------------------------- e-mail log

/** Stable id of an e-mail: its Message-ID, else a hash of what it says. */
export function mailId(mail: Pick<TgtgMail, 'messageId' | 'from' | 'subject' | 'date' | 'text' | 'html'>): string {
  const basis = mail.messageId?.trim().toLowerCase() || `${mail.from}|${mail.subject}|${mail.date ?? ''}|${(mail.text || mail.html || '').slice(0, 4000)}`;
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

export async function getMailRecord(id: string): Promise<TgtgMailRecord | null> {
  return (await getRepo().getDoc<TgtgMailRecord>(MAILS, id))?.data ?? null;
}

export async function saveMailRecord(r: TgtgMailRecord): Promise<void> {
  // Bodies are trimmed: enough to read again, never a mailbox archive.
  const mail = { ...r.mail, text: r.mail.text?.slice(0, 20_000), html: r.mail.html?.slice(0, 60_000) };
  await getRepo().putDocs(MAILS, [{ id: r.id, at: r.receivedAt, key: r.status, data: { ...r, mail } }]);
}

export async function listMailRecords(limit = 50): Promise<TgtgMailRecord[]> {
  return (await getRepo().listDocs<TgtgMailRecord>(MAILS, { limit })).map((d) => d.data);
}

/** E-mails that need a person: unreadable, a store nobody mapped, or read after the pickup window. */
export async function listAttention(limit = 50): Promise<TgtgMailRecord[]> {
  return (await getRepo().listDocs<TgtgMailRecord>(MAILS, { keys: ['attention', 'too_late', 'error'], limit })).map((d) => d.data).filter((r) => !r.dismissedAt);
}

export async function dismissMailRecord(id: string, actor: Actor): Promise<TgtgMailRecord | null> {
  const r = await getMailRecord(id);
  if (!r) return null;
  const next = { ...r, dismissedAt: nowIso(), dismissedBy: actor.name };
  await saveMailRecord(next);
  return next;
}

export async function getMailboxStatus(): Promise<MailboxStatus> {
  return (await getRepo().getKv<MailboxStatus>(STATUS_KEY).catch(() => null)) ?? {};
}

export async function setMailboxStatus(patch: MailboxStatus): Promise<MailboxStatus> {
  const next = { ...(await getMailboxStatus()), ...patch };
  await getRepo().setKv(STATUS_KEY, next);
  return next;
}
