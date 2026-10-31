// One tap on Approve: the stored card (never what the browser sends) is turned into a call to Food Hub's EXISTING gated
// route, made as the signed-in person — same cookie / Basic credentials, same manager-PIN header — so the route's own
// role check, kitchen scope, manager-PIN policy (428), menu locks and "live connectors off" rule all apply unchanged.
// The assistant never executes on its own: this file only runs from POST /api/foodhub/assistant/proposals/[id].
// Every decision is logged as "Assistant (approved by <person>)" next to the route's own log line.
import { NextResponse } from 'next/server';
import { logActivity } from '../activity';
import { actorLabel, type AuthUser } from '../auth';
import { fail, ok } from '../http';
import { getMenuSharing, groupOf } from '../menu/shared';
import { getRepo } from '../repo';
import { can } from '../session';
import { saveCampaignDraft } from './campaign-drafts';
import { getProposal, PROPOSAL_TTL_MS, saveProposal, viewOf, type ProposalAction, type ProposalRecord } from './proposals';
import { isProtectedStore, mentionsProtectedId, namesProtectedStore, REFUSAL } from './protect';

export const ASSISTANT_ACTOR_PREFIX = 'Assistant (approved by';
export const assistantActorName = (actor: AuthUser) => `${ASSISTANT_ACTOR_PREFIX} ${actorLabel(actor)})`;

export interface GatedRequest { path: '/api/foodhub/menu' | '/api/foodhub/availability' | '/api/foodhub/stores/status' | '/api/foodhub/prep'; method: 'POST' | 'PUT'; body: Record<string, unknown> }
type RouteHandler = (req: Request, ctx: unknown) => Promise<Response>;

/** The existing gated routes the assistant may call — and only these. */
const ROUTES: Record<GatedRequest['path'], () => Promise<Record<string, unknown>>> = {
  '/api/foodhub/menu': () => import('@/app/api/foodhub/menu/route'),
  '/api/foodhub/availability': () => import('@/app/api/foodhub/availability/route'),
  '/api/foodhub/stores/status': () => import('@/app/api/foodhub/stores/status/route'),
  '/api/foodhub/prep': () => import('@/app/api/foodhub/prep/route'),
};

/** Credentials and client details forwarded so the gated route sees the same person (and the same manager PIN). */
const FORWARD = ['cookie', 'authorization', 'x-approval-pin', 'x-forwarded-for', 'x-real-ip', 'user-agent', 'accept-language'];

/** Calls a gated route handler in-process with the caller's own credentials. */
export async function callGatedRoute(original: Request, spec: GatedRequest): Promise<Response> {
  const mod = await ROUTES[spec.path]();
  const handler = mod[spec.method] as RouteHandler | undefined;
  if (typeof handler !== 'function') return fail(`${spec.method} ${spec.path} is not available.`, 500);
  const headers = new Headers({ 'content-type': 'application/json', 'x-foodhub-via': 'assistant' });
  for (const h of FORWARD) { const v = original.headers.get(h); if (v) headers.set(h, v); }
  const url = new URL(spec.path, original.url);
  return handler(new Request(url, { method: spec.method, headers, body: JSON.stringify(spec.body) }), { params: Promise.resolve({}) });
}

/** Why this action must not run (Po Poulet NDG), checked again at Approve time against today's mappings. Null = fine. */
export async function protectedReason(action: ProposalAction): Promise<string | null> {
  if (mentionsProtectedId(action)) return REFUSAL.en;
  const stores = await getRepo().listStores();
  if (action.kind === 'store_status') return stores.some((s) => action.storeIds.includes(s.id) && (isProtectedStore(s) || (s.channel === 'doordash' && namesProtectedStore({ brand: s.brandName, location: s.locationCode, platforms: ['doordash'] })))) ? REFUSAL.en : null;
  if (action.kind === 'campaign_draft') return namesProtectedStore({ brand: action.draft.brand, location: action.draft.locationCode, platforms: [action.draft.platform] }) ? REFUSAL.en : null;
  if (action.kind === 'prep_time') return null;
  const group = groupOf(await getMenuSharing(), action.brand);
  if (action.kind === 'price_change') {
    if (action.prices.doordash === undefined) return null;
    return stores.some((s) => group.includes(s.brandName) && s.channel === 'doordash' && isProtectedStore(s)) || group.some((g) => namesProtectedStore({ brand: g, platforms: ['doordash'] })) ? REFUSAL.en : null;
  }
  return stores.some((s) => group.includes(s.brandName) && (!action.locationCode || s.locationCode === action.locationCode) && isProtectedStore(s))
    || group.some((g) => namesProtectedStore({ brand: g, location: action.locationCode })) ? REFUSAL.en : null;
}

/** The gated request for a stored action (the menu is read fresh, so Approve never saves a stale copy). */
export async function gatedRequestFor(action: Exclude<ProposalAction, { kind: 'campaign_draft' }>): Promise<GatedRequest | { error: string }> {
  switch (action.kind) {
    case 'price_change': {
      const menu = await getRepo().getMenu(action.brand);
      const item = menu?.items.find((i) => i.ref === action.itemRef);
      if (!menu || !item) return { error: 'This item is no longer in the menu. Ask the assistant again.' };
      const items = menu.items.map((i) => {
        if (i.ref !== action.itemRef) return i;
        const next = { ...i, channelPrices: { ...(i.channelPrices ?? {}) } };
        for (const [p, price] of Object.entries(action.prices)) {
          if (price === undefined) continue;
          if (p === 'in_store') next.price = price; else next.channelPrices[p as 'uber_eats' | 'doordash' | 'skip'] = price;
        }
        if (!Object.keys(next.channelPrices).length) delete (next as { channelPrices?: unknown }).channelPrices;
        return next;
      });
      return { path: '/api/foodhub/menu', method: 'PUT', body: { menu: { ...menu, items } } };
    }
    case 'item_availability':
      return { path: '/api/foodhub/availability', method: 'POST', body: { brand: action.brand, itemRefs: action.itemRefs, available: action.available, ...(action.locationCode ? { locationCode: action.locationCode } : {}), ...(action.minutes ? { minutes: action.minutes } : {}) } };
    case 'store_status':
      return { path: '/api/foodhub/stores/status', method: 'POST', body: { storeIds: action.storeIds, online: action.online, ...(action.minutes ? { minutes: action.minutes } : {}), ...(action.reason ? { reason: action.reason } : {}) } };
    case 'prep_time':
      return { path: '/api/foodhub/prep', method: 'POST', body: { locationCode: action.locationCode, ...(action.normal !== undefined ? { normal: action.normal } : {}), ...(action.busy !== undefined ? { busy: action.busy } : {}), ...(action.isBusy !== undefined ? { isBusy: action.isBusy } : {}) } };
  }
}

type FanRow = { result?: { ok?: boolean; status?: string } };
/** Honest result line: what really reached a platform, what was not sent (never "done" when nothing went out). */
export function resultLine(kind: ProposalRecord['kind'], body: Record<string, unknown>): { fr: string; en: string } {
  const rows: FanRow[] | null = Array.isArray(body.results) ? (body.results as FanRow[]) : null;
  if (rows) {
    const okN = rows.filter((r) => r.result?.ok).length;
    const blocked = rows.filter((r) => r.result?.status === 'blocked').length;
    const failed = rows.length - okN - blocked;
    if (!rows.length) return { fr: 'Enregistré dans Food Hub (aucun magasin de plateforme relié).', en: 'Saved in Food Hub (no platform store linked).' };
    return {
      fr: `${okN} magasin(s) mis à jour${blocked ? `, ${blocked} non envoyé(s) (connexions directes arrêtées ou magasin verrouillé)` : ''}${failed ? `, ${failed} en erreur` : ''}.`,
      en: `${okN} store(s) updated${blocked ? `, ${blocked} not sent (live connectors off or store locked)` : ''}${failed ? `, ${failed} failed` : ''}.`,
    };
  }
  if (kind === 'price_change') return { fr: 'Prix enregistré dans le menu Food Hub. Publiez le menu pour l’envoyer aux plateformes.', en: 'Price saved in the Food Hub menu. Publish the menu to send it to the platforms.' };
  if (kind === 'prep_time') return { fr: 'Temps de préparation enregistré.', en: 'Prep time saved.' };
  return { fr: 'Fait.', en: 'Done.' };
}

async function finish(rec: ProposalRecord, actor: AuthUser, status: 'approved' | 'failed' | 'dismissed', result: { fr: string; en: string } | null, detail: Record<string, unknown> = {}): Promise<ProposalRecord> {
  const next: ProposalRecord = { ...rec, status, decidedAt: new Date().toISOString(), decidedBy: actor.username, resultFr: result?.fr ?? null, resultEn: result?.en ?? null };
  await saveProposal(next);
  await logActivity({
    actor: assistantActorName(actor), source: actor.source, kind: 'approval', action: status === 'dismissed' ? 'assistant_dismiss' : 'assistant_approve',
    status: status === 'approved' ? 'success' : status === 'failed' ? 'failed' : 'info',
    summary: `${status === 'dismissed' ? 'Dismissed' : status === 'approved' ? 'Approved' : 'Approval failed'}: ${rec.titleEn}${result ? ` — ${result.en}` : ''}`,
    detail: { proposalId: rec.id, kind: rec.kind, ...detail },
  });
  return next;
}

/** Approve or dismiss one card. Only its author may decide, once, within 24 h; the role is checked again here. */
export async function decideProposal(req: Request, actor: AuthUser, id: string, decision: 'approve' | 'dismiss', call: typeof callGatedRoute = callGatedRoute): Promise<Response> {
  const rec = await getProposal(id);
  if (!rec || rec.createdBy !== actor.username) return fail('Proposal not found. / Proposition introuvable.', 404);
  if (rec.status !== 'pending') return fail(`This proposal was already ${rec.status}. / Cette proposition est déjà traitée.`, 409);
  if (decision === 'dismiss') return ok({ proposal: viewOf(await finish(rec, actor, 'dismissed', null)) });
  if (Date.now() - Date.parse(rec.createdAt) > PROPOSAL_TTL_MS) return fail('This proposal is more than 24 h old: ask the assistant again. / Proposition de plus de 24 h : redemandez.', 410);
  if (!can(actor.role, rec.perm)) return fail(`Your role (${actor.role}) cannot do this. / Votre rôle ne permet pas cette action.`, 403);
  const blocked = await protectedReason(rec.action);
  if (blocked) {
    await finish(rec, actor, 'failed', { fr: REFUSAL.fr, en: REFUSAL.en }, { refused: 'protected' });
    return fail(`${REFUSAL.en} / ${REFUSAL.fr}`, 403);
  }
  if (rec.action.kind === 'campaign_draft') {
    const saved = await saveCampaignDraft(rec.action.draft, { username: actor.username, name: actorLabel(actor), source: actor.source });
    const done = await finish(rec, actor, 'approved', { fr: 'Brouillon enregistré. Rien n’a été envoyé aux plateformes.', en: 'Draft saved. Nothing was sent to the platforms.' }, { draftId: saved.id });
    return ok({ proposal: viewOf(done) });
  }
  const spec = await gatedRequestFor(rec.action);
  if ('error' in spec) {
    await finish(rec, actor, 'failed', { fr: 'L’article n’est plus dans le menu. Redemandez à l’assistant.', en: spec.error });
    return fail(spec.error, 409);
  }
  const res = await call(req, spec);
  const body = (await res.clone().json().catch(() => ({}))) as Record<string, unknown>;
  // Manager PIN needed (or wrong PIN): hand the route's own answer back; the panel asks for the PIN and retries.
  // The card stays pending, nothing was done.
  if (res.status === 428 || (res.status === 403 && body.needsApproval) || res.status === 429) return NextResponse.json(body, { status: res.status });
  if (!res.ok || body.ok === false) {
    const msg = String(body.error ?? `HTTP ${res.status}`);
    const done = await finish(rec, actor, 'failed', { fr: `Refusé par Food Hub : ${msg}`, en: `Refused by Food Hub: ${msg}` }, { route: spec.path, status: res.status });
    return NextResponse.json({ ok: false, error: msg, proposal: viewOf(done) }, { status: res.status >= 400 ? res.status : 400 });
  }
  const done = await finish(rec, actor, 'approved', resultLine(rec.kind, body), { route: spec.path });
  return ok({ proposal: viewOf(done) });
}
