// DoorDash Ads API: campaigns, ad groups, product ads, creatives, assets, targeting, keywords and reports.
// Base https://openapi.doordash.com/ads/api/v1 — Spec: https://developer.doordash.com/en-US/api/ads
// Every endpoint lists "Ads API Key Authentication" and the reference does not say which header carries the key, so the key goes
// in `Authorization: Bearer <key>` by default and DOORDASH_ADS_AUTH_HEADER (e.g. "x-api-key") changes the header name without
// code. The Ads API is built around catalogue (Sponsored Products) advertisers; a restaurant group runs its ads from DoorDash's own
// Ads Manager unless DoorDash gives it an Ads API key. Nothing here is called until DOORDASH_ADS_API_KEY is set; anything that
// spends money or changes a campaign also needs LIVE_CONNECTORS_GLOBAL_ENABLED=true.
import { callApi, liveConnectorsGloballyEnabled, missingEnv, result, stripSlash } from '../config';
import type { ChannelResult } from '../types';
import { bodyRefusal } from './guard';
import { withDoorDashRetry } from './retry';

const KEY = 'doordash' as const;
const enc = encodeURIComponent;
export const adsBase = () => stripSlash(process.env.DOORDASH_ADS_BASE_URL || 'https://openapi.doordash.com/ads/api/v1');

export type CampaignType = 'sp' | 'sb';
export interface AdsResult<T = any> extends ChannelResult { data?: T }

function adsHeaders(): Record<string, string> {
  const name = process.env.DOORDASH_ADS_AUTH_HEADER?.trim() || 'Authorization';
  const key = process.env.DOORDASH_ADS_API_KEY!;
  return { [name]: name.toLowerCase() === 'authorization' ? `Bearer ${key}` : key, 'Content-Type': 'application/json', Accept: 'application/json' };
}

async function ads<T = any>(method: string, path: string, opts: { body?: unknown; query?: Record<string, string | number | undefined>; write?: boolean } = {}): Promise<AdsResult<T>> {
  const missing = missingEnv(['DOORDASH_ADS_API_KEY']);
  if (missing.length) return result(KEY, 'blocked', 'DoorDash Ads API key missing (DOORDASH_ADS_API_KEY). The key comes from DoorDash; campaigns can also be run in DoorDash Ads Manager.');
  if (opts.write && !liveConnectorsGloballyEnabled()) return result(KEY, 'blocked', 'LIVE_CONNECTORS_GLOBAL_ENABLED is off: nothing that changes an ad campaign is sent.');
  const refused = bodyRefusal(opts.body);
  if (refused) return result(KEY, 'blocked', refused);
  const query = Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${enc(String(v))}`).join('&');
  const res = await withDoorDashRetry(() => callApi(KEY, `${adsBase()}${path}${query ? `?${query}` : ''}`, { method, headers: adsHeaders(), body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { method });
  return { ...res, data: res.ok ? (res.response as T) : undefined };
}

export interface Page { startIndex?: number; count?: number }

// -------- campaigns
export const createCampaign = (type: CampaignType, body: { name: string; description?: string; budget: { daily?: { unitAmount: number }; lifetime?: { unitAmount: number }; pacingStrategy?: string }; startDate: string; endDate?: string }) =>
  ads('POST', `/${type}/campaigns`, { body, write: true });
export const updateCampaign = (type: CampaignType, body: { campaignId: string; name?: string; description?: string; status?: 'ACTIVE' | 'PAUSED' | 'ENDED'; budget?: unknown; startDate?: string; endDate?: string }) =>
  ads('PUT', `/${type}/campaigns`, { body, write: true });
export const listCampaigns = (type: CampaignType, page: Page = {}) => ads('GET', `/${type}/campaigns`, { query: { startIndex: page.startIndex, count: page.count } });
export const getCampaign = (type: CampaignType, campaignId: string) => ads('GET', `/${type}/campaigns/${enc(campaignId)}`);
/** Budget cap-out report and recommended budget (no campaign type in the path). */
export const campaignRecommendations = (campaignId: string) => ads('GET', `/campaigns/${enc(campaignId)}/recommendations`);

// -------- ad groups
export const createAdGroup = (type: CampaignType, body: Record<string, unknown> & { campaignId: string; name: string; startDate: string; endDate: string }) => ads('POST', `/${type}/adGroups`, { body, write: true });
export const updateAdGroup = (type: CampaignType, body: Record<string, unknown> & { campaignId: string; adGroupId: string }) => ads('PUT', `/${type}/adGroups`, { body, write: true });
export function listAdGroups(type: CampaignType, f: Page & { campaignIdFilter?: string; adGroupIdFilter?: string }): Promise<AdsResult> | AdsResult {
  if (!f.campaignIdFilter && !f.adGroupIdFilter) return result(KEY, 'blocked', 'Give a campaignIdFilter or an adGroupIdFilter (DoorDash requires one).');
  return ads('GET', `/${type}/adGroups`, { query: { campaignIdFilter: f.campaignIdFilter, adGroupIdFilter: f.adGroupIdFilter, startIndex: f.startIndex, count: f.count } });
}
export const getAdGroup = (type: CampaignType, adGroupId: string) => ads('GET', `/${type}/adGroups/${enc(adGroupId)}`);

// -------- product ads
export type IdType = 'GTIN_14' | 'UPC' | 'DD_SIC';
export const createProductAd = (type: CampaignType, body: { campaignId: string; adGroupId: string; idType: IdType; productId: string; isPriority?: boolean }) => ads('POST', `/${type}/productAds`, { body, write: true });
export function listProductAds(type: CampaignType, f: Page & { campaignIdFilter?: string; adGroupIdFilter?: string }): Promise<AdsResult> | AdsResult {
  if (!f.campaignIdFilter && !f.adGroupIdFilter) return result(KEY, 'blocked', 'Give a campaignIdFilter or an adGroupIdFilter.');
  return ads('GET', `/${type}/productAds`, { query: { campaignIdFilter: f.campaignIdFilter, adGroupIdFilter: f.adGroupIdFilter, startIndex: f.startIndex, count: f.count } });
}
export const deleteProductAd = (type: CampaignType, body: { campaignId: string; adGroupId: string; idType: IdType; productId: string }) => ads('DELETE', `/${type}/productAds`, { body, write: true });

// -------- assets and creatives
export const createAsset = (body: { name: string; type: 'IMAGE' | 'VIDEO'; width: number; height: number }) => ads('POST', '/assets', { body, write: true });
export const getAsset = (assetId: string) => ads('GET', `/assets/${enc(assetId)}`);
export const registerAsset = (assetId: string) => ads('POST', `/assets/${enc(assetId)}/register`, { write: true });
export const createCreatives = (body: { campaignId: string; adGroupId: string; creatives: Array<Record<string, unknown>> }) => ads('POST', '/sb/creatives', { body, write: true });
export const listCreatives = (campaignIdFilter: string, opts: { limit?: number; searchAfter?: string } = {}) => ads('GET', '/sb/creatives', { query: { campaignIdFilter, limit: opts.limit, searchAfter: opts.searchAfter } });

// -------- targeting and discovery
export const getMerchants = () => ads('GET', '/merchants');
export const recommendedKeywords = (body: { placements: Array<{ type: 'SEARCH' }>; products: Array<{ idType: IdType; productId: string }> }) => ads('POST', '/sp/keywords', { body });
export const recommendedKeywordsForAdGroup = (adGroupId: string, body: { placements: Array<{ type: 'SEARCH' }>; products: Array<{ idType: IdType; productId: string }> }) => ads('POST', `/sp/adGroups/${enc(adGroupId)}/keywords`, { body });
export const searchResources = (body: { classificationType: 'BRAND' | 'CATEGORY'; resourceTypes: Array<'L1_BRAND' | 'L1_CATEGORY' | 'L2_CATEGORY'>; searchAfter?: string; limit?: number }) => ads('POST', '/resources/search', { body });
export function validateCatalog(products: Array<{ idType: IdType; productId: string }>): Promise<AdsResult> | AdsResult {
  if (!products.length || products.length > 100) return result(KEY, 'blocked', 'Validate between 1 and 100 products per call.');
  return ads('POST', '/sp/catalogs/validate', { body: products });
}
export const menuLabels = () => ads('GET', '/menu/labels');
export const audienceEstimate = (body: { filters: Array<{ field: string; values: string[] }> }) => ads('POST', '/targeting/audience/estimate', { body });

// -------- reports
export const REPORT_RECORD_TYPES = ['CAMPAIGN', 'ADGROUP', 'PRODUCT', 'KEYWORD', 'CATEGORY_SHARE', 'PRODUCT_SALES', 'CATALOG', 'INTEREST_INSIGHTS'] as const;
export type AdsRecordType = (typeof REPORT_RECORD_TYPES)[number];
export function createAdsReport(recordType: AdsRecordType, body: { reportName: string; startDate: string; endDate: string; fileType?: 'CSV'; segment?: 'PLACEMENT' | 'NONE'; groupBys?: string[]; timeGranularity?: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'NONE'; filters?: unknown[]; campaignTypes?: Array<'SPONSORED_PRODUCTS' | 'SPONSORED_BRAND'>; categoryProvider?: 'NIELSEN' | 'CIRCANA' }): Promise<AdsResult> | AdsResult {
  if (!(REPORT_RECORD_TYPES as readonly string[]).includes(recordType)) return result(KEY, 'blocked', `Unknown record type ${recordType}.`);
  if ((body.campaignTypes?.length ?? 0) > 1) return result(KEY, 'blocked', 'A report covers one campaign type.');
  return ads('POST', `/sp/reports/${recordType}/create`, { body });
}
export const downloadAdsReport = (reportId: string) => ads('GET', `/sp/reports/download/${enc(reportId)}`);
export const listAdsReports = (q: { startDate: string; endDate?: string; startIndex?: number; count?: number; status?: 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'ERROR'; reportNameContains?: string; sortCol?: string; sortDir?: 'ASC' | 'DESC' }) =>
  ads('GET', '/sp/reports/list', { query: q as Record<string, string | number | undefined> });
