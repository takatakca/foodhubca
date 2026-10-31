// The assistant's tools: READ tools over Food Hub data (every channel) and PROPOSE tools that only prepare an approval
// card. One zod schema per tool is the single source of truth: it produces the JSON schema Claude sees AND validates
// every input before anything runs (streamed tool inputs are not validated by the API, so a truncated or malformed input
// becomes an error result, never a call). There is deliberately NO tool that changes anything.
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AuthUser } from '../auth';
import * as data from './data';
import { proposeCampaign, proposeItemAvailability, proposePrepTime, proposePriceChange, proposeStoreStatus } from './proposals';
import type { ProposalView } from './types';

const period = z.enum(data.PERIODS as [data.Period, ...data.Period[]]).describe('Period in Montréal time. "custom" needs from (and optionally to) as YYYY-MM-DD.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD');
const platform = z.enum(['uber_eats', 'doordash', 'skip', 'tgtg']);
const shortText = (max: number) => z.string().trim().min(1).max(max);

export const TOOL_SCHEMAS = {
  // ---------- READ ----------
  get_sales: z.object({
    period, from: day.optional(), to: day.optional(),
    group_by: z.enum(['source', 'brand', 'location', 'weekday', 'hour', 'fulfillment']).optional().describe('Default source (= platform or direct channel).'),
    brands: z.array(shortText(80)).max(20).optional(),
    sources: z.array(z.enum(data.SALES_SOURCES)).max(9).optional().describe('Limit to these channels: uber_eats, doordash, skip, tgtg, website, clover, phone, phone_ai, manual.'),
    location: shortText(40).optional().describe('Kitchen code, e.g. NDG_MAIN.'),
  }),
  get_top_items: z.object({
    period, from: day.optional(), to: day.optional(), brand: shortText(80).optional(),
    sources: z.array(z.enum(data.SALES_SOURCES)).max(9).optional(), location: shortText(40).optional(),
    limit: z.number().int().min(1).max(25).optional(), order: z.enum(['best', 'worst']).optional(),
  }),
  get_order_issues: z.object({ period, from: day.optional(), to: day.optional(), brand: shortText(80).optional(), platform: platform.optional(), location: shortText(40).optional() }),
  get_missed_orders: z.object({ period, from: day.optional(), to: day.optional(), brand: shortText(80).optional(), platform: platform.optional(), location: shortText(40).optional() }),
  get_store_status: z.object({ brand: shortText(80).optional(), location: shortText(40).optional(), platform: platform.optional(), downtime_period: period.optional().describe('Also return offline time during opening hours for this period.') }),
  get_reviews: z.object({ period: period.optional(), brand: shortText(80).optional(), platform: z.enum(['uber_eats', 'doordash', 'skip', 'google', 'tgtg']).optional(), max_stars: z.number().int().min(1).max(5).optional(), unanswered_only: z.boolean().optional() }),
  get_payouts: z.object({ period: period.optional(), platform: platform.optional() }),
  get_incidents: z.object({ status: z.enum(['open', 'all']).optional(), limit: z.number().int().min(1).max(30).optional() }),
  get_autopilot: z.object({}),
  find_menu_items: z.object({ query: z.string().trim().max(80).optional(), brand: shortText(80).optional(), sold_out_only: z.boolean().optional(), limit: z.number().int().min(1).max(40).optional() }),
  // ---------- PROPOSE (cards only) ----------
  propose_price_change: z.object({
    brand: shortText(80), item: shortText(120).describe('Item ref (from find_menu_items) or exact name.'),
    platforms: z.array(z.enum(['in_store', 'uber_eats', 'doordash', 'skip'])).min(1).max(4).describe('in_store = base price (Clover, website, phone).'),
    new_price: z.number().min(0.5).max(500).describe('New price in CAD, e.g. 13.49.'), reason: z.string().max(200).optional(),
  }),
  propose_item_availability: z.object({
    brand: shortText(80), items: z.array(shortText(120)).min(1).max(20).describe('Item refs or exact names.'), available: z.boolean().describe('false = 86 (sold out), true = back on sale.'),
    location: shortText(40).optional().describe('Kitchen code; leave out for every kitchen.'), minutes: z.number().int().min(0).max(10080).optional().describe('Timed 86; 0 or absent = until turned back on.'), reason: z.string().max(200).optional(),
  }),
  propose_store_pause: z.object({
    store_ids: z.array(shortText(80)).max(40).optional().describe('storeId values from get_store_status.'), brand: shortText(80).optional(), location: shortText(40).optional(), platforms: z.array(platform).max(4).optional(),
    online: z.boolean().describe('false = pause, true = resume.'), minutes: z.number().int().min(0).max(1440).optional().describe('Timed pause in minutes; 0 or absent = until resumed.'), reason: z.string().max(200).optional(),
  }),
  propose_prep_time: z.object({
    location: shortText(40), normal: z.number().int().min(1).max(120).optional(), busy: z.number().int().min(1).max(120).optional(),
    is_busy: z.boolean().optional().describe('Busy mode on/off (the busy prep time applies while on).'), reason: z.string().max(200).optional(),
  }),
  propose_campaign: z.object({
    brand: shortText(80), platform: z.enum(['uber_eats', 'doordash', 'skip', 'website', 'all']), location: shortText(40).optional(),
    title: shortText(120), offer: shortText(300).describe('e.g. "15% off orders over $30".'), audience: z.string().max(200).optional(),
    start: day.optional(), end: day.optional(), daily_budget: z.number().min(0).max(1000).optional().describe('Suggested daily budget in CAD (suggestion only).'), message: shortText(600).describe('Customer-facing message, French first then English.'),
  }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

const DESCRIPTIONS: Record<ToolName, string> = {
  get_sales: 'Sales and order counts for a period across EVERY channel (Uber Eats, DoorDash, Skip, Too Good To Go, website, Clover, phone), grouped by source, brand, location, weekday, hour or fulfillment, with the change vs the previous period. Use for any "how much did we sell" or "analyze my sales" question.',
  get_top_items: 'Best (or worst) selling items for a period, with quantity, sales and the split by channel.',
  get_order_issues: 'Cancellations (who, when, why, by platform), items lost to cancellations, and ops quality (missing/incorrect items, late ready, avoidable cancels, downtime) vs goals.',
  get_missed_orders: 'Orders that were never accepted: cancelled before accept, handed back to the platform, or still waiting — count, lost revenue, by platform/brand/location, examples.',
  get_store_status: 'Every platform store with its state (online / paused / closed / deactivated), pause end, auto-accept, prep times per kitchen, and optionally offline time during opening hours. Returns storeId values for propose_store_pause.',
  get_reviews: 'Customer reviews: average stars, distribution, themes, unanswered count and the latest reviews.',
  get_payouts: 'Platform payouts from imported statements (sales, commission, promotions, refunds, net) and the money to recover from the platforms (open dispute cases).',
  get_incidents: 'Open alerts from the Watchtower (late orders, tablets offline, stores paused, menu errors…).',
  get_autopilot: 'Which Autopilot automations are on and what they did last.',
  find_menu_items: 'Search the menus: item refs, names, current price per platform, availability and where it is sold out. Use before proposing a price change or an 86.',
  propose_price_change: 'PREPARE (does not apply) a price change for one item on chosen platforms. Shows the person an approval card with old → new price. Only after they tap Approve does Food Hub save it.',
  propose_item_availability: 'PREPARE (does not apply) an 86 (sold out) or back-on-sale for items at a kitchen or everywhere. The person approves the card.',
  propose_store_pause: 'PREPARE (does not apply) a pause (optionally for N minutes) or a resume of platform stores. The person approves the card.',
  propose_prep_time: 'PREPARE (does not apply) a prep-time or busy-mode change for one kitchen. The person approves the card.',
  propose_campaign: 'PREPARE a marketing campaign DRAFT (nothing is sent, no money spent). The person approves to save the draft.',
};

export const TOOL_LABELS: Record<ToolName, { fr: string; en: string }> = {
  get_sales: { fr: 'Lecture des ventes…', en: 'Reading sales…' },
  get_top_items: { fr: 'Lecture des meilleurs articles…', en: 'Reading top items…' },
  get_order_issues: { fr: 'Analyse des problèmes de commandes…', en: 'Analyzing order issues…' },
  get_missed_orders: { fr: 'Recherche des commandes manquées…', en: 'Looking for missed orders…' },
  get_store_status: { fr: 'Lecture de l’état des magasins…', en: 'Reading store status…' },
  get_reviews: { fr: 'Lecture des avis…', en: 'Reading reviews…' },
  get_payouts: { fr: 'Lecture des paiements…', en: 'Reading payouts…' },
  get_incidents: { fr: 'Lecture des alertes…', en: 'Reading alerts…' },
  get_autopilot: { fr: 'Lecture de l’autopilote…', en: 'Reading Autopilot…' },
  find_menu_items: { fr: 'Recherche dans les menus…', en: 'Searching the menus…' },
  propose_price_change: { fr: 'Préparation d’un changement de prix…', en: 'Preparing a price change…' },
  propose_item_availability: { fr: 'Préparation d’un 86…', en: 'Preparing an 86…' },
  propose_store_pause: { fr: 'Préparation d’une pause…', en: 'Preparing a pause…' },
  propose_prep_time: { fr: 'Préparation du temps de préparation…', en: 'Preparing a prep-time change…' },
  propose_campaign: { fr: 'Préparation d’un brouillon de campagne…', en: 'Preparing a campaign draft…' },
};

export const PROPOSE_TOOLS: ReadonlySet<ToolName> = new Set(['propose_price_change', 'propose_item_availability', 'propose_store_pause', 'propose_prep_time', 'propose_campaign']);

function inputSchema(s: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const json = z.toJSONSchema(s, { io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  return { ...json, type: 'object' } as Anthropic.Beta.BetaTool.InputSchema;
}

/** Tool definitions in a fixed order (a stable prefix keeps the prompt cache warm). */
export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => ({
    name, description: DESCRIPTIONS[name], input_schema: inputSchema(TOOL_SCHEMAS[name]),
    // Streamed as generated; the API then no longer validates them, so every input goes through zod in runTool.
    eager_input_streaming: true,
  }));
}

export interface ToolOutcome { content: string; isError?: boolean; proposal?: ProposalView }

const json = (v: unknown) => JSON.stringify(v).slice(0, 12_000);

/** Runs one tool for the signed-in person. READ tools return data; PROPOSE tools return a card id — never an action. */
export async function runTool(name: string, rawInput: unknown, ctx: { actor: AuthUser; chatId: string | null; now?: number }): Promise<ToolOutcome> {
  if (!(name in TOOL_SCHEMAS)) return { content: json({ error: `Unknown tool ${name}.` }), isError: true };
  const parsed = TOOL_SCHEMAS[name as ToolName].safeParse(rawInput ?? {});
  if (!parsed.success) return { content: json({ error: 'INVALID_INPUT', issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) }), isError: true };
  const input = parsed.data as never;
  const rctx = { actor: ctx.actor, now: ctx.now };
  const pctx = { actor: ctx.actor, chatId: ctx.chatId };
  try {
    switch (name as ToolName) {
      case 'get_sales': return { content: json(await data.getSales(input, rctx)) };
      case 'get_top_items': return { content: json(await data.getTopItems(input, rctx)) };
      case 'get_order_issues': return { content: json(await data.getOrderIssues(input, rctx)) };
      case 'get_missed_orders': return { content: json(await data.getMissedOrders(input, rctx)) };
      case 'get_store_status': return { content: json(await data.getStoreStatus(input, rctx)) };
      case 'get_reviews': return { content: json(await data.getReviews(input, rctx)) };
      case 'get_payouts': return { content: json(await data.getPayouts(input, rctx)) };
      case 'get_incidents': return { content: json(await data.getIncidents(input, rctx)) };
      case 'get_autopilot': return { content: json(await data.getAutopilot(input, rctx)) };
      case 'find_menu_items': return { content: json(await data.findMenuItems(input, rctx)) };
      case 'propose_price_change': return proposalOutcome(await proposePriceChange(input, pctx));
      case 'propose_item_availability': return proposalOutcome(await proposeItemAvailability(input, pctx));
      case 'propose_store_pause': return proposalOutcome(await proposeStoreStatus(input, pctx));
      case 'propose_prep_time': return proposalOutcome(await proposePrepTime(input, pctx));
      case 'propose_campaign': return proposalOutcome(await proposeCampaign(input, pctx));
    }
  } catch (e) {
    console.error(`[foodhub] assistant tool ${name} failed:`, e);
    return { content: json({ error: 'This data is not available right now.' }), isError: true };
  }
  return { content: json({ error: `Unknown tool ${name}.` }), isError: true };
}

function proposalOutcome(o: Awaited<ReturnType<typeof proposePriceChange>>): ToolOutcome {
  if (!o.ok) return { content: json({ refused: o.refused, error: o.error, errorFr: o.errorFr, instruction: 'Tell the person plainly why; do not retry the same proposal.' }), isError: true };
  return {
    content: json({ proposalId: o.proposal.id, status: 'waiting_for_approval', card: { title: o.proposal.titleEn, changes: o.proposal.changes.map((c) => `${c.en} @ ${c.whereEn}: ${c.fromEn ?? '—'} → ${c.toEn}`), notes: o.proposal.notesEn }, instruction: 'A card is now shown to the person with Approve / Dismiss. Nothing has changed yet. Do not say it is done.' }),
    proposal: o.proposal,
  };
}
