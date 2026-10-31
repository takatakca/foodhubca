// Proposal cards: what the assistant prepares instead of acting. A PROPOSE tool resolves the request against Food
// Hub's real data (menus, stores, prep settings), refuses what it must refuse (Po Poulet NDG, the person's role, kitchens
// outside their scope), and stores a card that says exactly what will change and where. Nothing is sent anywhere here:
// only the person's tap on Approve (approve.ts) calls Food Hub's existing gated routes, as that person.
import crypto from 'node:crypto';
import type { AuthUser } from '../auth';
import { getCatalog } from '../catalog';
import { CHANNEL_LABELS } from '../config';
import { getMenuSharing, groupOf, sourceOf } from '../menu/shared';
import { DEFAULT_PREP, getPrepSettings } from '../prep';
import { getRepo } from '../repo';
import { can, ROLE_LABELS, type Permission } from '../session';
import type { ChannelKey, ChannelStore, MasterMenu, MenuItem } from '../types';
import type { CampaignDraft, CampaignPlatform } from './campaign-drafts';
import { isProtectedStore, mentionsProtectedId, namesProtectedStore, REFUSAL } from './protect';
import { storeStateOf } from './snapshot';
import { moneyEn, moneyFr } from './suggest';
import type { ProposalChange, ProposalKind, ProposalStatus, ProposalView } from './types';

export type PricePlatform = 'in_store' | 'uber_eats' | 'doordash' | 'skip';

/** What Approve will do — kept server-side only (the card the browser sees never carries it). */
export type ProposalAction =
  | { kind: 'price_change'; brand: string; itemRef: string; prices: Partial<Record<PricePlatform, number>> }
  | { kind: 'item_availability'; brand: string; itemRefs: string[]; available: boolean; locationCode: string | null; minutes: number }
  | { kind: 'store_status'; storeIds: string[]; online: boolean; minutes: number; reason: string | null }
  | { kind: 'prep_time'; locationCode: string; normal?: number; busy?: number; isBusy?: boolean }
  | { kind: 'campaign_draft'; draft: CampaignDraft };

export interface ProposalRecord extends ProposalView {
  createdBy: string;
  chatId: string | null;
  action: ProposalAction;
  decidedBy?: string | null;
}

export type ProposeOutcome =
  | { ok: true; proposal: ProposalView }
  | { ok: false; refused: 'protected' | 'role' | 'scope' | 'invalid'; error: string; errorFr: string };

export const PROPOSAL_KEY = 'assistant_proposal_v1:';
/** A card older than this cannot be approved any more (data may have moved): ask again. */
export const PROPOSAL_TTL_MS = 24 * 3600_000;

export const PERM_FOR: Record<ProposalKind, Permission> = {
  price_change: 'menu:edit',
  item_availability: 'items:toggle',
  store_status: 'stores:toggle',
  prep_time: 'stores:toggle',
  campaign_draft: 'menu:edit',
};

const PLATFORM_LABEL: Record<PricePlatform, { fr: string; en: string }> = {
  in_store: { fr: 'En magasin, site web et Clover', en: 'In store, website and Clover' },
  uber_eats: { fr: 'Uber Eats', en: 'Uber Eats' },
  doordash: { fr: 'DoorDash', en: 'DoorDash' },
  skip: { fr: 'SkipTheDishes', en: 'SkipTheDishes' },
};
const STATE_LABEL: Record<string, { fr: string; en: string }> = {
  online: { fr: 'En ligne', en: 'Online' }, paused: { fr: 'En pause', en: 'Paused' }, closed: { fr: 'Fermé', en: 'Closed' }, deactivated: { fr: 'Désactivé', en: 'Deactivated' },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const lc = (s: string) => s.trim().toLowerCase();

const invalid = (en: string, fr: string): ProposeOutcome => ({ ok: false, refused: 'invalid', error: en, errorFr: fr });
const protectedRefusal = (): ProposeOutcome => ({ ok: false, refused: 'protected', error: REFUSAL.en, errorFr: REFUSAL.fr });
function roleRefusal(actor: Pick<AuthUser, 'role'>, perm: Permission): ProposeOutcome | null {
  if (can(actor.role, perm)) return null;
  const role = ROLE_LABELS[actor.role] ?? actor.role;
  return { ok: false, refused: 'role', error: `Your role (${role}) cannot do this (${perm}). Ask a manager.`, errorFr: `Votre rôle (${role}) ne permet pas cette action (${perm}). Demandez à un gérant.` };
}

// ---------- lookups ----------

export async function resolveBrand(name: string): Promise<{ brand: string } | { error: string; errorFr: string }> {
  const [catalog, menus] = await Promise.all([getCatalog(), getRepo().listMenus()]);
  const names = [...new Set([...catalog.brands.filter((b) => b.active).map((b) => b.name), ...menus.map((m) => m.brandName)])];
  const exact = names.find((b) => lc(b) === lc(name));
  if (exact) return { brand: exact };
  const near = names.filter((b) => lc(b).includes(lc(name)) || lc(name).includes(lc(b)));
  if (near.length === 1) return { brand: near[0] };
  return near.length
    ? { error: `Several brands match "${name}": ${near.join(', ')}. Ask which one.`, errorFr: `Plusieurs marques correspondent à « ${name} » : ${near.join(', ')}. Demandez laquelle.` }
    : { error: `No brand named "${name}". Brands: ${names.slice(0, 30).join(', ')}.`, errorFr: `Aucune marque « ${name} ». Marques : ${names.slice(0, 30).join(', ')}.` };
}

export async function resolveLocation(name: string, actor: Pick<AuthUser, 'locations'>): Promise<{ code: string; name: string } | { error: string; errorFr: string; scope?: boolean }> {
  const catalog = await getCatalog();
  const locs = catalog.locations.filter((l) => l.active);
  const exact = locs.find((l) => lc(l.code) === lc(name) || lc(l.name) === lc(name));
  const near = exact ? [exact] : locs.filter((l) => lc(l.code).includes(lc(name)) || lc(l.name).includes(lc(name)));
  if (near.length !== 1) {
    const list = (near.length ? near : locs).map((l) => `${l.code} (${l.name})`).join(', ');
    return { error: `${near.length ? 'Several kitchens match' : 'No kitchen matches'} "${name}": ${list}. Ask which one.`, errorFr: `${near.length ? 'Plusieurs cuisines correspondent à' : 'Aucune cuisine ne correspond à'} « ${name} » : ${list}. Demandez laquelle.` };
  }
  const loc = near[0];
  if (actor.locations.length && !actor.locations.includes(loc.code)) return { error: `${loc.name} is not one of your kitchens.`, errorFr: `${loc.name} n’est pas une de vos cuisines.`, scope: true };
  return { code: loc.code, name: loc.name };
}

/** An item by ref, by exact name (English or French), or by a unique partial name. */
export function findItem(menu: Pick<MasterMenu, 'items'>, query: string): { item: MenuItem } | { candidates: string[] } {
  const q = lc(query);
  const byRef = menu.items.find((i) => i.ref === query.trim());
  if (byRef) return { item: byRef };
  const exact = menu.items.filter((i) => lc(i.name) === q || (i.nameFr && lc(i.nameFr) === q));
  if (exact.length === 1) return { item: exact[0] };
  const near = (exact.length ? exact : menu.items.filter((i) => lc(i.name).includes(q) || (i.nameFr && lc(i.nameFr).includes(q))));
  if (near.length === 1) return { item: near[0] };
  return { candidates: near.slice(0, 12).map((i) => `${i.name} [${i.ref}]`) };
}

/** Price a customer pays today on a platform: the item's own platform price, else the base price + the platform markup. */
export function currentPrice(menu: Pick<MasterMenu, 'channelMarkupPct'>, item: Pick<MenuItem, 'price' | 'channelPrices'>, p: PricePlatform): number {
  if (p === 'in_store') return r2(Number(item.price));
  const own = item.channelPrices?.[p];
  if (typeof own === 'number') return r2(own);
  return r2(Number(item.price) * (1 + (menu.channelMarkupPct?.[p] ?? 0) / 100));
}

// ---------- storage ----------

export async function saveProposal(p: ProposalRecord): Promise<void> {
  await getRepo().setKv(`${PROPOSAL_KEY}${p.id}`, p);
}

export async function getProposal(id: string): Promise<ProposalRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return getRepo().getKv<ProposalRecord>(`${PROPOSAL_KEY}${id}`).catch(() => null);
}

export function viewOf(p: ProposalRecord): ProposalView {
  const { action: _a, createdBy: _c, chatId: _h, decidedBy: _d, ...view } = p;
  return view;
}

async function store(kind: ProposalKind, actor: AuthUser, chatId: string | null, action: ProposalAction, card: { titleFr: string; titleEn: string; changes: ProposalChange[]; notesFr?: string[]; notesEn?: string[] }): Promise<ProposeOutcome> {
  const rec: ProposalRecord = {
    id: crypto.randomUUID(), kind, status: 'pending' as ProposalStatus, titleFr: card.titleFr, titleEn: card.titleEn, changes: card.changes,
    notesFr: card.notesFr ?? [], notesEn: card.notesEn ?? [], perm: PERM_FOR[kind], createdAt: new Date().toISOString(), decidedAt: null,
    createdBy: actor.username, chatId, action,
  };
  await saveProposal(rec);
  return { ok: true, proposal: viewOf(rec) };
}

// ---------- the five proposals ----------

export interface ProposeContext { actor: AuthUser; chatId: string | null }

export async function proposePriceChange(input: { brand: string; item: string; platforms: PricePlatform[]; new_price: number; reason?: string }, ctx: ProposeContext): Promise<ProposeOutcome> {
  const role = roleRefusal(ctx.actor, 'menu:edit');
  if (role) return role;
  if (mentionsProtectedId(input)) return protectedRefusal();
  const b = await resolveBrand(input.brand);
  if ('error' in b) return invalid(b.error, b.errorFr);
  const sharing = await getMenuSharing();
  const source = sourceOf(sharing, b.brand);
  const group = groupOf(sharing, b.brand);
  const menu = await getRepo().getMenu(source);
  if (!menu) return invalid(`${b.brand} has no menu in Food Hub yet.`, `${b.brand} n’a pas encore de menu dans Food Hub.`);
  const found = findItem(menu, input.item);
  if ('candidates' in found) {
    return found.candidates.length
      ? invalid(`Several items match "${input.item}": ${found.candidates.join(', ')}. Ask which one.`, `Plusieurs articles correspondent à « ${input.item} » : ${found.candidates.join(', ')}. Demandez lequel.`)
      : invalid(`No item "${input.item}" in the ${source} menu. Use find_menu_items first.`, `Aucun article « ${input.item} » dans le menu ${source}. Utilisez find_menu_items d’abord.`);
  }
  const price = Number(input.new_price);
  if (!Number.isFinite(price) || price < 0.5 || price > 500) return invalid('The new price must be between 0.50 and 500.00 CAD.', 'Le nouveau prix doit être entre 0,50 et 500,00 $.');
  let platforms = [...new Set(input.platforms)].filter((p): p is PricePlatform => p in PLATFORM_LABEL);
  if (!platforms.length) return invalid('Choose at least one platform (in_store, uber_eats, doordash, skip).', 'Choisissez au moins une plateforme.');
  const notesFr: string[] = []; const notesEn: string[] = [];
  // Po Poulet NDG: never a DoorDash price for a menu that reaches it.
  const stores = (await getRepo().listStores()).filter((s) => group.includes(s.brandName));
  const reachesProtected = stores.some((s) => s.channel === 'doordash' && isProtectedStore(s)) || group.some((g) => namesProtectedStore({ brand: g, platforms: ['doordash'] }));
  if (reachesProtected && platforms.includes('doordash')) {
    platforms = platforms.filter((p) => p !== 'doordash');
    if (!platforms.length) return protectedRefusal();
    notesFr.push(`DoorDash retiré : ${REFUSAL.fr}`); notesEn.push(`DoorDash left out: ${REFUSAL.en}`);
  }
  const item = found.item;
  const prices: Partial<Record<PricePlatform, number>> = {};
  const changes: ProposalChange[] = [];
  const brands = group.length > 1 ? group.join(', ') : b.brand;
  for (const p of platforms) {
    const before = currentPrice(menu, item, p);
    prices[p] = r2(price);
    changes.push({ fr: item.nameFr || item.name, en: item.name, whereFr: `${PLATFORM_LABEL[p].fr} · ${brands}`, whereEn: `${PLATFORM_LABEL[p].en} · ${brands}`, fromFr: moneyFr(before), fromEn: moneyEn(before), toFr: moneyFr(price), toEn: moneyEn(price) });
    const pct = before ? Math.round(((price - before) / before) * 100) : 0;
    if (Math.abs(pct) >= 30) { notesFr.push(`Gros changement sur ${PLATFORM_LABEL[p].fr} : ${pct > 0 ? '+' : ''}${pct} %.`); notesEn.push(`Big change on ${PLATFORM_LABEL[p].en}: ${pct > 0 ? '+' : ''}${pct}%.`); }
  }
  if (group.length > 1) { notesFr.push(`Menu partagé : le prix change pour ${group.join(', ')}.`); notesEn.push(`Shared menu: the price changes for ${group.join(', ')}.`); }
  if (platforms.some((p) => p !== 'in_store')) { notesFr.push('Enregistré dans le menu Food Hub ; les plateformes reçoivent le prix à la prochaine publication (Menus → Publier).'); notesEn.push('Saved in the Food Hub menu; platforms get the price at the next publish (Menus → Publish).'); }
  if (input.reason) { notesFr.push(`Raison : ${input.reason.slice(0, 200)}`); notesEn.push(`Reason: ${input.reason.slice(0, 200)}`); }
  return store('price_change', ctx.actor, ctx.chatId, { kind: 'price_change', brand: source, itemRef: item.ref, prices }, {
    titleFr: `Changer le prix : ${item.nameFr || item.name}`, titleEn: `Change price: ${item.name}`, changes, notesFr, notesEn,
  });
}

export async function proposeItemAvailability(input: { brand: string; items: string[]; available: boolean; location?: string; minutes?: number; reason?: string }, ctx: ProposeContext): Promise<ProposeOutcome> {
  const role = roleRefusal(ctx.actor, 'items:toggle');
  if (role) return role;
  if (mentionsProtectedId(input)) return protectedRefusal();
  const b = await resolveBrand(input.brand);
  if ('error' in b) return invalid(b.error, b.errorFr);
  let loc: { code: string; name: string } | null = null;
  if (input.location) {
    const l = await resolveLocation(input.location, ctx.actor);
    if ('error' in l) return { ok: false, refused: l.scope ? 'scope' : 'invalid', error: l.error, errorFr: l.errorFr };
    loc = l;
  } else if (ctx.actor.locations.length === 1) {
    const l = await resolveLocation(ctx.actor.locations[0], ctx.actor);
    if (!('error' in l)) loc = l;
  } else if (ctx.actor.locations.length > 1) {
    return invalid(`Which kitchen? (${ctx.actor.locations.join(', ')})`, `Quelle cuisine ? (${ctx.actor.locations.join(', ')})`);
  }
  const sharing = await getMenuSharing();
  const source = sourceOf(sharing, b.brand);
  const group = groupOf(sharing, b.brand);
  const menu = await getRepo().getMenu(source);
  if (!menu) return invalid(`${b.brand} has no menu in Food Hub yet.`, `${b.brand} n’a pas encore de menu dans Food Hub.`);
  const items: MenuItem[] = [];
  for (const q of input.items.slice(0, 20)) {
    const f = findItem(menu, q);
    if ('candidates' in f) return invalid(`"${q}": ${f.candidates.length ? `several items match (${f.candidates.join(', ')})` : 'not in the menu'}. Use find_menu_items first.`, `« ${q} » : ${f.candidates.length ? `plusieurs articles (${f.candidates.join(', ')})` : 'pas dans le menu'}. Utilisez find_menu_items d’abord.`);
    if (!items.some((i) => i.ref === f.item.ref)) items.push(f.item);
  }
  if (!items.length) return invalid('Name at least one item.', 'Nommez au moins un article.');
  const stores = (await getRepo().listStores()).filter((s) => group.includes(s.brandName) && (!loc || s.locationCode === loc.code));
  if (stores.some(isProtectedStore) || group.some((g) => namesProtectedStore({ brand: g, location: loc?.code ?? null }))) return protectedRefusal();
  const minutes = input.available ? 0 : Math.max(0, Math.min(7 * 24 * 60, Math.round(Number(input.minutes) || 0)));
  const where = (fr: boolean) => `${group.join(', ')} · ${loc ? loc.name : fr ? 'toutes les cuisines' : 'every kitchen'} · ${fr ? 'toutes les plateformes' : 'every platform'}`;
  const offAt = (i: MenuItem) => !i.available || (loc ? (menu.unavailableByLocation?.[loc.code] ?? []).includes(i.ref) : Object.values(menu.unavailableByLocation ?? {}).some((refs) => refs.includes(i.ref)));
  const changes: ProposalChange[] = items.map((i) => ({
    fr: i.nameFr || i.name, en: i.name, whereFr: where(true), whereEn: where(false),
    fromFr: offAt(i) ? 'En rupture' : 'En vente', fromEn: offAt(i) ? 'Sold out' : 'Available',
    toFr: input.available ? 'En vente' : minutes ? `En rupture pendant ${minutes} min` : 'En rupture (jusqu’à remise en vente)',
    toEn: input.available ? 'Available' : minutes ? `Sold out for ${minutes} min` : 'Sold out (until turned back on)',
  }));
  const platforms = [...new Set(stores.map((s) => CHANNEL_LABELS[s.channel]))];
  const notesFr = [platforms.length ? `Envoyé à ${stores.length} magasin(s) : ${platforms.join(', ')}.` : 'Aucun magasin de plateforme relié : seul le menu Food Hub change.'];
  const notesEn = [platforms.length ? `Sent to ${stores.length} store(s): ${platforms.join(', ')}.` : 'No platform store linked: only the Food Hub menu changes.'];
  if (input.reason) { notesFr.push(`Raison : ${input.reason.slice(0, 200)}`); notesEn.push(`Reason: ${input.reason.slice(0, 200)}`); }
  const names = items.map((i) => i.name).join(', ');
  return store('item_availability', ctx.actor, ctx.chatId, { kind: 'item_availability', brand: b.brand, itemRefs: items.map((i) => i.ref), available: input.available, locationCode: loc?.code ?? null, minutes }, {
    titleFr: input.available ? `Remettre en vente : ${items.map((i) => i.nameFr || i.name).join(', ')}` : `Mettre en rupture (86) : ${items.map((i) => i.nameFr || i.name).join(', ')}`,
    titleEn: input.available ? `Bring back: ${names}` : `86 (sold out): ${names}`, changes, notesFr, notesEn,
  });
}

export async function proposeStoreStatus(input: { store_ids?: string[]; brand?: string; location?: string; platforms?: ChannelKey[]; online: boolean; minutes?: number; reason?: string }, ctx: ProposeContext): Promise<ProposeOutcome> {
  const role = roleRefusal(ctx.actor, 'stores:toggle');
  if (role) return role;
  if (mentionsProtectedId(input)) return protectedRefusal();
  let brand: string | null = null;
  if (input.brand) { const b = await resolveBrand(input.brand); if ('error' in b) return invalid(b.error, b.errorFr); brand = b.brand; }
  let loc: string | null = null;
  if (input.location) { const l = await resolveLocation(input.location, ctx.actor); if ('error' in l) return { ok: false, refused: l.scope ? 'scope' : 'invalid', error: l.error, errorFr: l.errorFr }; loc = l.code; }
  if (!input.store_ids?.length && !brand && !loc) return invalid('Say which stores: a brand, a kitchen, or store ids from get_store_status.', 'Dites quels magasins : une marque, une cuisine, ou les ids de get_store_status.');
  const all = await getRepo().listStores();
  let stores: ChannelStore[] = input.store_ids?.length ? all.filter((s) => input.store_ids!.includes(s.id)) : all;
  if (brand) stores = stores.filter((s) => s.brandName === brand);
  if (loc) stores = stores.filter((s) => s.locationCode === loc);
  if (input.platforms?.length) stores = stores.filter((s) => input.platforms!.includes(s.channel));
  const outside = stores.filter((s) => ctx.actor.locations.length && !ctx.actor.locations.includes(s.locationCode));
  stores = stores.filter((s) => !outside.includes(s));
  const isProt = (s: ChannelStore) => isProtectedStore(s) || (s.channel === 'doordash' && namesProtectedStore({ brand: s.brandName, location: s.locationCode, platforms: [s.channel] }));
  const prot = stores.filter(isProt);
  stores = stores.filter((s) => !isProt(s)).slice(0, 40);
  if (!stores.length) return prot.length ? protectedRefusal() : invalid('No store matches (or none in your kitchens).', 'Aucun magasin ne correspond (ou aucun dans vos cuisines).');
  const minutes = input.online ? 0 : Math.max(0, Math.min(24 * 60, Math.round(Number(input.minutes) || 0)));
  const changes: ProposalChange[] = stores.map((s) => {
    const st = STATE_LABEL[storeStateOf(s)] ?? { fr: storeStateOf(s), en: storeStateOf(s) };
    return {
      fr: s.brandName, en: s.brandName, whereFr: `${CHANNEL_LABELS[s.channel]} · ${s.locationCode}`, whereEn: `${CHANNEL_LABELS[s.channel]} · ${s.locationCode}`,
      fromFr: st.fr, fromEn: st.en,
      toFr: input.online ? 'En ligne' : minutes ? `En pause ${minutes} min` : 'En pause (jusqu’à reprise)',
      toEn: input.online ? 'Online' : minutes ? `Paused for ${minutes} min` : 'Paused (until resumed)',
    };
  });
  const notesFr: string[] = []; const notesEn: string[] = [];
  if (prot.length) { notesFr.push(`Laissé de côté : ${REFUSAL.fr}`); notesEn.push(`Left out: ${REFUSAL.en}`); }
  if (outside.length) { notesFr.push(`${outside.length} magasin(s) hors de vos cuisines laissé(s) de côté.`); notesEn.push(`${outside.length} store(s) outside your kitchens left out.`); }
  if (!input.online && !minutes) { notesFr.push('Pause sans fin : le magasin reste fermé jusqu’à ce que quelqu’un le rouvre.'); notesEn.push('Open-ended pause: the store stays closed until someone resumes it.'); }
  if (input.reason) { notesFr.push(`Raison : ${input.reason.slice(0, 200)}`); notesEn.push(`Reason: ${input.reason.slice(0, 200)}`); }
  return store('store_status', ctx.actor, ctx.chatId, { kind: 'store_status', storeIds: stores.map((s) => s.id), online: input.online, minutes, reason: input.reason?.slice(0, 200) ?? null }, {
    titleFr: input.online ? `Rouvrir ${stores.length} magasin(s)` : `Mettre ${stores.length} magasin(s) en pause`,
    titleEn: input.online ? `Resume ${stores.length} store(s)` : `Pause ${stores.length} store(s)`, changes, notesFr, notesEn,
  });
}

export async function proposePrepTime(input: { location: string; normal?: number; busy?: number; is_busy?: boolean; reason?: string }, ctx: ProposeContext): Promise<ProposeOutcome> {
  const role = roleRefusal(ctx.actor, 'stores:toggle');
  if (role) return role;
  if (mentionsProtectedId(input)) return protectedRefusal();
  const l = await resolveLocation(input.location, ctx.actor);
  if ('error' in l) return { ok: false, refused: l.scope ? 'scope' : 'invalid', error: l.error, errorFr: l.errorFr };
  const okMin = (n: unknown) => n === undefined || (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 120);
  if (!okMin(input.normal) || !okMin(input.busy)) return invalid('Prep minutes must be whole numbers from 1 to 120.', 'Les minutes de préparation vont de 1 à 120.');
  if (input.normal === undefined && input.busy === undefined && input.is_busy === undefined) return invalid('Nothing to change.', 'Rien à changer.');
  const cur = { ...DEFAULT_PREP, ...(await getPrepSettings())[l.code] };
  const changes: ProposalChange[] = [];
  const where = { whereFr: l.name, whereEn: l.name };
  if (input.normal !== undefined) changes.push({ fr: 'Temps de préparation normal', en: 'Normal prep time', ...where, fromFr: `${cur.normal} min`, fromEn: `${cur.normal} min`, toFr: `${input.normal} min`, toEn: `${input.normal} min` });
  if (input.busy !== undefined) changes.push({ fr: 'Temps de préparation occupé', en: 'Busy prep time', ...where, fromFr: `${cur.busy} min`, fromEn: `${cur.busy} min`, toFr: `${input.busy} min`, toEn: `${input.busy} min` });
  if (input.is_busy !== undefined) changes.push({ fr: 'Mode occupé', en: 'Busy mode', ...where, fromFr: cur.isBusy ? 'Oui' : 'Non', fromEn: cur.isBusy ? 'On' : 'Off', toFr: input.is_busy ? 'Oui' : 'Non', toEn: input.is_busy ? 'On' : 'Off' });
  const notesFr = ['Le temps en vigueur est aussi envoyé aux magasins Uber Eats de cette cuisine (quand le direct est actif).'];
  const notesEn = ['The prep time in force also goes to this kitchen’s Uber Eats stores (when live).'];
  if (input.reason) { notesFr.push(`Raison : ${input.reason.slice(0, 200)}`); notesEn.push(`Reason: ${input.reason.slice(0, 200)}`); }
  return store('prep_time', ctx.actor, ctx.chatId, { kind: 'prep_time', locationCode: l.code, ...(input.normal !== undefined ? { normal: input.normal } : {}), ...(input.busy !== undefined ? { busy: input.busy } : {}), ...(input.is_busy !== undefined ? { isBusy: input.is_busy } : {}) }, {
    titleFr: `Temps de préparation : ${l.name}`, titleEn: `Prep time: ${l.name}`, changes, notesFr, notesEn,
  });
}

export async function proposeCampaign(input: { brand: string; platform: CampaignPlatform; location?: string; title: string; offer: string; audience?: string; start?: string; end?: string; daily_budget?: number; message: string }, ctx: ProposeContext): Promise<ProposeOutcome> {
  const role = roleRefusal(ctx.actor, 'menu:edit');
  if (role) return role;
  if (mentionsProtectedId(input)) return protectedRefusal();
  const b = await resolveBrand(input.brand);
  if ('error' in b) return invalid(b.error, b.errorFr);
  let loc: string | null = null;
  if (input.location) { const l = await resolveLocation(input.location, ctx.actor); if ('error' in l) return { ok: false, refused: l.scope ? 'scope' : 'invalid', error: l.error, errorFr: l.errorFr }; loc = l.code; }
  if (namesProtectedStore({ brand: b.brand, location: loc, platforms: [input.platform] })) return protectedRefusal();
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const draft: CampaignDraft = {
    brand: b.brand, platform: input.platform, locationCode: loc, title: input.title.slice(0, 120), offer: input.offer.slice(0, 300), audience: input.audience?.slice(0, 200) ?? null,
    start: input.start && day.test(input.start) ? input.start : null, end: input.end && day.test(input.end) ? input.end : null,
    dailyBudget: typeof input.daily_budget === 'number' && input.daily_budget > 0 ? r2(Math.min(input.daily_budget, 1000)) : null, message: input.message.slice(0, 600),
  };
  const plat = input.platform === 'all' ? { fr: 'toutes les plateformes', en: 'every platform' } : input.platform === 'website' ? { fr: 'site web', en: 'website' } : { fr: CHANNEL_LABELS[input.platform], en: CHANNEL_LABELS[input.platform] };
  const changes: ProposalChange[] = [{ fr: 'Brouillon de campagne', en: 'Campaign draft', whereFr: `${plat.fr} · ${b.brand}${loc ? ` · ${loc}` : ''}`, whereEn: `${plat.en} · ${b.brand}${loc ? ` · ${loc}` : ''}`, fromFr: null, fromEn: null, toFr: `${draft.title} — ${draft.offer}`, toEn: `${draft.title} — ${draft.offer}` }];
  const notesFr = ['Brouillon seulement : rien n’est envoyé aux plateformes et aucun argent n’est dépensé.', `Message : ${draft.message}`];
  const notesEn = ['Draft only: nothing is sent to a platform and no money is spent.', `Message: ${draft.message}`];
  if (draft.dailyBudget) { notesFr.push(`Budget suggéré : ${moneyFr(draft.dailyBudget)} par jour (rien n’est facturé).`); notesEn.push(`Suggested budget: ${moneyEn(draft.dailyBudget)} a day (nothing is charged).`); }
  if (draft.start || draft.end) { notesFr.push(`Dates : ${draft.start ?? '?'} → ${draft.end ?? '?'}`); notesEn.push(`Dates: ${draft.start ?? '?'} → ${draft.end ?? '?'}`); }
  return store('campaign_draft', ctx.actor, ctx.chatId, { kind: 'campaign_draft', draft }, { titleFr: `Brouillon de campagne : ${draft.title}`, titleEn: `Campaign draft: ${draft.title}`, changes, notesFr, notesEn });
}
