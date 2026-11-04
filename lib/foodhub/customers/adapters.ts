// Server-only read-only balances. The browser never selects a merchant, phone or customerRef.
import crypto from 'node:crypto';
import { normalizePhone } from '../notify';
import { signSuite } from '../suite/sign';
import { getCustomer } from './store';
import { allowedCustomerTenants, type MasterCustomer } from './types';

export type CustomerProgram = { scope: 'merchant'; name?: string };
type Unavailable = { connected: false; reason: string; code?: 'not_configured' | 'unverified_customer' | 'not_linked' | 'unavailable'; program?: CustomerProgram };
export type LoyaltyInfo = Unavailable | { connected: true; points: number; tier?: string; program: CustomerProgram };
export type GiftCardsInfo = Unavailable | { connected: true; cards: Array<{ last4: string; balance: number }>; program: CustomerProgram };
export const SUITE_BALANCE_TIMEOUT_MS = 3500;
export const SUITE_BALANCE_RESPONSE_MAX = 16_384;
const TENANT = /^[a-z0-9][a-z0-9-]{1,39}$/;
const MERCHANT = /^[A-Z0-9]{8,20}$/;
type AppKey = 'loy4lty' | 'rew4rd';
type AdapterConfig = { url: string; secret: string; merchants: Map<string, string> };

/** One explicit merchant program per website. Invalid maps never partially authorize requests. */
export function customerSuiteMerchants(raw = process.env.FOODHUB_CUSTOMER_SUITE_MERCHANTS): Map<string, string> | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const pairs = Object.entries(data);
    if (!pairs.length || pairs.length > 32 || pairs.some(([tenant, mid]) => !TENANT.test(tenant) || typeof mid !== 'string' || !MERCHANT.test(mid))) return null;
    return new Map(pairs as Array<[string, string]>);
  } catch { return null; }
}

function adapterConfig(app: AppKey, env: NodeJS.ProcessEnv = process.env): AdapterConfig | null {
  const raw = (env[`FOODHUB_SUITE_${app.toUpperCase()}_URL`] ?? '').trim();
  const secret = (env[`FOODHUB_SUITE_${app.toUpperCase()}_SECRET`] ?? '').trim();
  const merchants = customerSuiteMerchants(env.FOODHUB_CUSTOMER_SUITE_MERCHANTS);
  if (!raw || secret.length < 32 || !merchants) return null;
  try {
    const u = new URL(raw);
    if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) return null;
    return { url: new URL(app === 'loy4lty' ? '/api/loyalty/customer-balance' : '/api/cards/customer-balances', u).toString(), secret, merchants };
  } catch { return null; }
}

// Configured is a setting, not proof that an app answered or a customer has a linked account.
export const loyaltyConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => !!adapterConfig('loy4lty', env);
export const giftCardsConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => !!adapterConfig('rew4rd', env);
function notConfigured(app: AppKey): Unavailable {
  const name = app === 'loy4lty' ? 'LOY4LTY' : 'REW4RDS';
  const legacy = app === 'loy4lty' ? 'FOODHUB_LOYALTY_URL' : 'FOODHUB_GIFTCARDS_URL';
  return { connected: false, reason: `${name} not connected yet${process.env[legacy]?.trim() ? ` (${legacy} is set; the signed suite connection and merchant mapping are required)` : ''}` };
}

/** Recheck deletion/revocation and persisted phone; a forged plain object is not customer authority. */
async function verifiedCustomer(customer: MasterCustomer, tenant: string): Promise<MasterCustomer | null> {
  if (!customer || !TENANT.test(tenant) || !allowedCustomerTenants().includes(tenant) || !customer.id) return null;
  const live = await getCustomer(customer.id);
  if (!live || live.deletedAt || !live.phone || normalizePhone(live.phone) !== live.phone || live.phone !== customer.phone
    || live.tokenVersion !== customer.tokenVersion || !Array.isArray(live.tenants) || !live.tenants.includes(tenant)
    || !Array.isArray(customer.tenants) || !customer.tenants.includes(tenant)) return null;
  const verifiedAt = Date.parse(live.verifiedAt);
  return Number.isFinite(verifiedAt) && verifiedAt <= Date.now() ? live : null;
}
const unverified = (): Unavailable => ({ connected: false, code: 'unverified_customer', reason: 'A verified customer account is required.' });
const unavailable = (): Unavailable => ({ connected: false, code: 'unavailable', reason: 'This restaurant program is temporarily unavailable.' });

async function readResponse(res: Response): Promise<unknown> {
  if (!res.ok || Number(res.headers.get('content-length') ?? 0) > SUITE_BALANCE_RESPONSE_MAX || !res.body) throw new Error('balance unavailable');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > SUITE_BALANCE_RESPONSE_MAX) { await reader.cancel(); throw new Error('balance unavailable'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const record = (raw: unknown): Record<string, unknown> | null => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
function programFrom(raw: unknown): CustomerProgram | null {
  const p = record(raw);
  if (!p || p.scope !== 'merchant' || (p.name !== undefined && (typeof p.name !== 'string' || p.name.length > 120))) return null;
  const name = typeof p.name === 'string' ? p.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return { scope: 'merchant', ...(name ? { name } : {}) };
}

async function requestBalance(app: AppKey, config: AdapterConfig, customer: MasterCustomer, tenant: string): Promise<{ data: Record<string, unknown>; program: CustomerProgram } | null> {
  const merchantId = config.merchants.get(tenant);
  if (!merchantId) return null;
  // Existing suite enrollment/card identity. Food Hub's salted platform customerKey is deliberately not joined.
  const customerRef = crypto.createHash('sha256').update(`${merchantId}:${customer.phone}`).digest('hex').slice(0, 32);
  const requestId = crypto.randomUUID();
  const body = JSON.stringify({ version: 1, app, purpose: 'customer.balance.read', requestId, tenant, merchantId, customerRef });
  const res = await fetch(config.url, { method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(SUITE_BALANCE_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'X-Takatak-App': 'foodhub', 'X-Takatak-Signature': signSuite(config.secret, body) }, body });
  const data = record(await readResponse(res));
  if (!data || data.ok !== true || data.version !== 1 || data.app !== app || data.requestId !== requestId || data.tenant !== tenant || data.merchantId !== merchantId || data.customerRef !== customerRef) return null;
  const program = programFrom(data.program);
  return program ? { data, program } : null;
}

export async function loyaltyFor(customer: MasterCustomer, tenant: string): Promise<LoyaltyInfo> {
  const config = adapterConfig('loy4lty');
  if (!config) return notConfigured('loy4lty');
  try {
    const live = await verifiedCustomer(customer, tenant);
    if (!live) return unverified();
    if (!config.merchants.has(tenant)) return { connected: false, code: 'not_configured', reason: 'No restaurant program is connected to this website.' };
    const result = await requestBalance('loy4lty', config, live, tenant);
    if (!result) return unavailable();
    if (result.data.membership === 'not_linked') return { connected: false, code: 'not_linked', reason: 'No loyalty membership is linked to this restaurant program.', program: result.program };
    if (result.data.membership !== 'linked' || !Number.isSafeInteger(result.data.points) || (result.data.points as number) < 0) return unavailable();
    return { connected: true, points: result.data.points as number, program: result.program };
  } catch { return unavailable(); }
}
export async function giftCardsFor(customer: MasterCustomer, tenant: string): Promise<GiftCardsInfo> {
  const config = adapterConfig('rew4rd');
  if (!config) return notConfigured('rew4rd');
  try {
    const live = await verifiedCustomer(customer, tenant);
    if (!live) return unverified();
    if (!config.merchants.has(tenant)) return { connected: false, code: 'not_configured', reason: 'No restaurant program is connected to this website.' };
    const result = await requestBalance('rew4rd', config, live, tenant);
    if (!result || !Array.isArray(result.data.cards) || result.data.cards.length > 100) return unavailable();
    const cards: Array<{ last4: string; balance: number }> = [];
    for (const raw of result.data.cards) {
      const card = record(raw);
      if (!card || typeof card.last4 !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{4}$/.test(card.last4) || !Number.isSafeInteger(card.balanceCents) || (card.balanceCents as number) < 0) return unavailable();
      cards.push({ last4: card.last4, balance: (card.balanceCents as number) / 100 });
    }
    return { connected: true, cards, program: result.program };
  } catch { return unavailable(); }
}
