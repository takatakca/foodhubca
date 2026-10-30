// Every integration TAKATAK Food Hub has or is asking for, one row per partner: its kind, its real state and its
// official entry point. Plan: docs/INTEGRATION_PLATFORM.md; the emails: docs/PARTNER_OUTREACH.md (section `outreach`).
// Pure data + helpers, no I/O. Honesty rules:
//   - the three hub platforms (Uber Eats, DoorDash, SkipTheDishes) take their state from FOODHUB_PUBLIC_LIVE_PLATFORMS
//     (livePlatforms(), the same switch as the public pages), never from this file;
//   - only 'live' rows may be shown as available on a public page (publicIntegrations());
//   - `confirmed: false` = the entry point comes from a secondary source: check it on the partner's own site first.
// Update a row when a partner answers (the owner sends the emails; agents record the answers). Tests:
// tests/integrations-catalog.test.ts.

import type { ChannelKey } from '../types';
import { livePlatforms, type HubPlatform } from '../pricing';

export type IntegrationKind = 'marketplace' | 'courier' | 'pos' | 'payment' | 'direct';

export type IntegrationStatus =
  /** In production for our restaurants. */
  | 'live'
  /** Built and tested; the partner's certification review is under way. */
  | 'certification'
  /** Built and tested; waiting for the partner's production credentials (or behind a Food Hub switch). */
  | 'built'
  /** First email sent; waiting for the answer. */
  | 'outreach'
  /** Email ready in docs/PARTNER_OUTREACH.md, not sent yet. */
  | 'to_request';

export interface Integration {
  id: string;
  name: string;
  kind: IntegrationKind;
  /** State in this file; for the hub platforms, integrationStatus() replaces it with the live switch. */
  status: IntegrationStatus;
  /** One of the three platforms whose public state is the FOODHUB_PUBLIC_LIVE_PLATFORMS switch. */
  hubPlatform?: HubPlatform;
  /** The Food Hub channel adapter that serves it (lib/foodhub/adapters). */
  channelKey?: ChannelKey;
  /** Where the code lives today. */
  code?: string;
  /** Official entry point (form, team, program): public information only, never a person's address. */
  entry: string;
  /** Section of docs/PARTNER_OUTREACH.md holding its ready email (A1 … C7). */
  outreach?: string;
  /** True when the entry point was read on the partner's own site. */
  confirmed: boolean;
}

export const INTEGRATIONS: readonly Integration[] = [
  // Delivery marketplaces
  { id: 'uber_eats', name: 'Uber Eats', kind: 'marketplace', status: 'certification', hubPlatform: 'uber', channelKey: 'uber_eats', code: 'lib/foodhub/adapters/uber-*.ts', entry: 'Uber Eats partner manager + integration support form (developer.uber.com, Eats Marketplace)', outreach: 'A1', confirmed: true },
  { id: 'doordash', name: 'DoorDash', kind: 'marketplace', status: 'certification', hubPlatform: 'doordash', channelKey: 'doordash', code: 'lib/foodhub/adapters/doordash.ts', entry: 'Marketplace Integration Interest Form + technical account manager (developer.doordash.com)', outreach: 'A2', confirmed: true },
  { id: 'skip', name: 'SkipTheDishes', kind: 'marketplace', status: 'certification', hubPlatform: 'skip', channelKey: 'skip', code: 'lib/foodhub/adapters/skip*.ts', entry: 'partners.skipthedishes.com → account management team (custom direct integration)', outreach: 'A3', confirmed: true },
  { id: 'tgtg', name: 'Too Good To Go', kind: 'marketplace', status: 'built', channelKey: 'tgtg', code: 'lib/foodhub/adapters/partner.ts', entry: '"Get in touch" business form (toogoodtogo.com, Platform page)', outreach: 'A4', confirmed: true },
  { id: 'ritual', name: 'Ritual', kind: 'marketplace', status: 'to_request', entry: 'ritual.co/partners', outreach: 'A5', confirmed: false },
  { id: 'fantuan', name: 'Fantuan', kind: 'marketplace', status: 'to_request', entry: 'Fantuan merchant portal (merchant.fantuanorder.com)', outreach: 'A6', confirmed: false },
  { id: 'hungrypanda', name: 'HungryPanda', kind: 'marketplace', status: 'to_request', entry: 'to find: HungryPanda merchant page (Canada)', outreach: 'A7', confirmed: false },
  // Couriers (delivery of our restaurants' own orders)
  { id: 'uber_direct', name: 'Uber Direct', kind: 'courier', status: 'built', code: 'lib/foodhub/delivery/uber-direct.ts', entry: 'Uber Direct self-serve account (Developer tab) + Uber Direct sales team', outreach: 'B1', confirmed: true },
  { id: 'doordash_drive', name: 'DoorDash Drive', kind: 'courier', status: 'built', code: 'lib/foodhub/delivery/doordash-drive.ts', entry: 'developer.doordash.com (Drive) + Drive partnerships', outreach: 'B2', confirmed: true },
  { id: 'skip_delivery', name: 'Skip Delivery', kind: 'courier', status: 'built', code: 'lib/foodhub/delivery/skip-daas.ts', entry: 'Asked together with the direct integration (outreach A3)', outreach: 'A3', confirmed: true },
  { id: 'trexity', name: 'Trexity', kind: 'courier', status: 'to_request', entry: 'Trexity integration team (address in the Trexity help centre)', outreach: 'B3', confirmed: true },
  // Registers
  { id: 'clover', name: 'Clover', kind: 'pos', status: 'live', code: 'lib/foodhub/pos/clover-*.ts', entry: 'Clover Developer Relations (Clover App Market)', outreach: 'C1', confirmed: true },
  { id: 'square', name: 'Square', kind: 'pos', status: 'to_request', entry: 'Developer Dashboard → App Marketplace + squareup.com/ca/en/partnerships (App Partner)', outreach: 'C2', confirmed: true },
  { id: 'lightspeed', name: 'Lightspeed Restaurant', kind: 'pos', status: 'to_request', entry: 'Lightspeed partner program (by request; API credentials after approval)', outreach: 'C3', confirmed: false },
  { id: 'toast', name: 'Toast', kind: 'pos', status: 'to_request', entry: 'pos.toasttab.com/partners/integration-partner-application (3 steps)', outreach: 'C4', confirmed: true },
  { id: 'touchbistro', name: 'TouchBistro', kind: 'pos', status: 'to_request', entry: 'TouchBistro integrated partners team (address from a secondary source)', outreach: 'C5', confirmed: false },
  { id: 'payfacto', name: "Maître'D and Veloce (PayFacto)", kind: 'pos', status: 'to_request', entry: 'to find: PayFacto partner team (payfacto.com)', outreach: 'C6', confirmed: false },
  { id: 'moneris', name: 'Moneris Go', kind: 'payment', status: 'to_request', entry: 'Moneris Developer Portal → Client Consulting team', outreach: 'C7', confirmed: true },
  // Our own direct ordering
  { id: 'on2go_direct', name: 'ON2GO direct ordering', kind: 'direct', status: 'live', code: 'lib/foodhub/storefront/*', entry: 'Ours: Settings → Storefront, per brand', confirmed: true },
];

/** A row's real state now: the hub platforms follow the public live switch (live, else in certification). */
export function integrationStatus(row: Integration, live: HubPlatform[] = livePlatforms()): IntegrationStatus {
  if (!row.hubPlatform) return row.status;
  return live.includes(row.hubPlatform) ? 'live' : 'certification';
}

/** Every row with its real state. */
export function integrationCatalog(live: HubPlatform[] = livePlatforms()): Integration[] {
  return INTEGRATIONS.map((row) => ({ ...row, status: integrationStatus(row, live) }));
}

/** What a public page may present as available: live rows only (the others are "in certification" or not shown). */
export function publicIntegrations(live: HubPlatform[] = livePlatforms()): Integration[] {
  return integrationCatalog(live).filter((row) => row.status === 'live');
}

/** Rows waiting on the owner: an email to send (to_request) or an answer to chase (outreach). */
export function outreachQueue(live: HubPlatform[] = livePlatforms()): Integration[] {
  return integrationCatalog(live).filter((row) => row.status === 'to_request' || row.status === 'outreach');
}

/** How many rows per kind and state (for the plan and the console). */
export function integrationSummary(live: HubPlatform[] = livePlatforms()): Record<IntegrationKind, Partial<Record<IntegrationStatus, number>>> {
  const out = { marketplace: {}, courier: {}, pos: {}, payment: {}, direct: {} } as Record<IntegrationKind, Partial<Record<IntegrationStatus, number>>>;
  for (const row of integrationCatalog(live)) out[row.kind][row.status] = (out[row.kind][row.status] ?? 0) + 1;
  return out;
}
