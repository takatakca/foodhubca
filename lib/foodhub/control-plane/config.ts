// The existing V1 master API is application-scoped Bearer auth, not the historical HMAC foundation.
import crypto from 'node:crypto';

export interface MerchantBinding { localVendorId: string; masterMerchantId: string; locationCodes: string[]; key: string }
export interface ControlPlaneConfig { url: string; apiKey: string; instanceTenantId: string; merchants: MerchantBinding[]; fingerprint: string }
export interface ControlPlaneReadiness { configured: boolean; problem: string | null; keySet: boolean; legacyKeySet: boolean; merchants: number }
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/;
const LOCATION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export function configuredControlPlane(env: NodeJS.ProcessEnv = process.env): { config: ControlPlaneConfig | null; readiness: ControlPlaneReadiness } {
  const apiKey = (env.TAKATAK_FOODHUB_API_KEY ?? '').trim();
  const state: ControlPlaneReadiness = { configured: false, problem: null, keySet: apiKey.length >= 32, legacyKeySet: !!env.TAKATAK_ON2GO_HUB_KEY?.trim(), merchants: 0 };
  const refuse = (problem: string | null) => ({ config: null, readiness: { ...state, problem } });
  const rawUrl = (env.TAKATAK_CONTROL_PLANE_URL ?? '').trim();
  if (!rawUrl && !apiKey && !env.FOODHUB_CONTROL_PLANE_MERCHANTS) return refuse(state.legacyKeySet ? 'legacy_key_only' : null);
  if (!rawUrl || apiKey.length < 32) return refuse('connection_not_configured');
  let url: string;
  try {
    const u = new URL(rawUrl);
    if (u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname) || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)))) return refuse('invalid_url');
    url = u.origin;
  } catch { return refuse('invalid_url'); }
  const instanceTenantId = String(env.FOODHUB_TENANT_ID ?? '').trim().toLowerCase();
  if (!SLUG.test(instanceTenantId)) return refuse('explicit_instance_required');
  const raw = env.FOODHUB_CONTROL_PLANE_MERCHANTS ?? '';
  if (!raw || raw.length > 16_384) return refuse('merchant_mapping_required');
  try {
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('invalid_mapping');
    const b = body as Record<string, unknown>;
    if (Object.keys(b).some((k) => !['instanceTenantId', 'merchants'].includes(k)) || b.instanceTenantId !== instanceTenantId || !Array.isArray(b.merchants) || b.merchants.length < 1 || b.merchants.length > 32) return refuse('invalid_mapping');
    const merchants: MerchantBinding[] = [];
    const vendors = new Set<string>();const locations = new Set<string>();
    for (const rawMerchant of b.merchants) {
      if (!rawMerchant || typeof rawMerchant !== 'object' || Array.isArray(rawMerchant)) return refuse('invalid_mapping');
      const m = rawMerchant as Record<string, unknown>;
      if (Object.keys(m).some((k) => !['localVendorId', 'masterMerchantId', 'locationCodes'].includes(k)) || typeof m.localVendorId !== 'string' || !LOCAL.test(m.localVendorId)
        || typeof m.masterMerchantId !== 'string' || !UUID.test(m.masterMerchantId) || !Array.isArray(m.locationCodes) || !m.locationCodes.length || m.locationCodes.length > 100
        || m.locationCodes.some((l) => typeof l !== 'string' || !LOCATION.test(l))) return refuse('invalid_mapping');
      if (vendors.has(m.localVendorId)) return refuse('ambiguous_mapping');vendors.add(m.localVendorId);
      const codes = m.locationCodes as string[];
      for (const code of codes) { if (locations.has(code)) return refuse('ambiguous_mapping');locations.add(code); }
      const masterMerchantId = m.masterMerchantId.toLowerCase();
      const key = digest(JSON.stringify([url, instanceTenantId, m.localVendorId, masterMerchantId, [...codes].sort()]));
      merchants.push({ localVendorId: m.localVendorId, masterMerchantId, locationCodes: [...codes].sort(), key });
    }
    merchants.sort((a, b) => a.localVendorId.localeCompare(b.localVendorId));
    return { config: { url, apiKey, instanceTenantId, merchants, fingerprint: digest(JSON.stringify([url, instanceTenantId, merchants.map((m) => m.key)])) },
      readiness: { ...state, configured: true, merchants: merchants.length } };
  } catch { return refuse('invalid_mapping'); }
}
