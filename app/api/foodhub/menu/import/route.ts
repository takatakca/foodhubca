import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { locationsForMerchant } from '@/lib/foodhub/clover-sync';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { importMenuFromClover, knownCloverMerchants } from '@/lib/foodhub/pos/clover';
import { getRepo } from '@/lib/foodhub/repo';
import type { MasterMenu, MenuItem } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';

/** The master menu remembers which Clover merchant it was imported from (optional, read by order injection). */
type MenuWithMerchant = MasterMenu & { posMerchantId?: string };

/** Clover merchants a menu can be imported from: CLOVER_MERCHANT_ID (default) + the keys of CLOVER_MERCHANT_TOKENS. */
function importableMerchants(): string[] {
  return knownCloverMerchants([]);
}

// Merchant picker for the Menu Manager: { merchants: [{ id, isDefault, locations }], defaultMerchantId }.
export const GET = withPerm('menu:edit', async () => {
  const def = process.env.CLOVER_MERCHANT_ID || null;
  const merchants = await Promise.all(importableMerchants().map(async (id) => ({ id, isDefault: id === def, locations: await locationsForMerchant(id) })));
  return ok({ merchants, defaultMerchantId: def });
});

// Pull the brand's menu from Clover inventory (keeps Clover item ids for order injection).
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (!b.brand) return fail('brand is required');
  const merchantId = b.merchantId ? String(b.merchantId) : process.env.CLOVER_MERCHANT_ID;
  if (!merchantId) return fail('No Clover merchant id. Set CLOVER_MERCHANT_ID or pass a merchant id.');
  if (!importableMerchants().includes(merchantId)) return fail(`Unknown Clover merchant ${merchantId}. Use CLOVER_MERCHANT_ID or one of CLOVER_MERCHANT_TOKENS.`);
  const repo = getRepo();
  const imported = await importMenuFromClover(String(b.brand), merchantId);
  const existing = (await repo.getMenu(String(b.brand))) as MenuWithMerchant | null;
  // Keep what the owner set in Food Hub (platform prices, descriptions, photos, tags, allergens, category
  // schedules, 86 state) AND everything created in Food Hub that does not come from Clover (items without a
  // Clover link, their categories, custom option groups); Clover stays the source of names, prices and modifiers.
  const before = new Map((existing?.items ?? []).map((i) => [i.ref, i]));
  const catHours = new Map((existing?.categories ?? []).map((c) => [c.ref, c.hours]));
  const importedItemRefs = new Set(imported.items.map((i) => i.ref));
  const importedCatRefs = new Set(imported.categories.map((c) => c.ref));
  const importedGroupRefs = new Set(imported.modifierGroups.map((g) => g.ref));
  // Owner-created items: no Clover link and not part of this import. (A Clover item Clover no longer has is dropped.)
  const keptItems: MenuItem[] = (existing?.items ?? []).filter((i) => !i.posItemRef && !importedItemRefs.has(i.ref));
  // Option groups created in Food Hub carry no Clover modifier ids; Clover groups missing from the import are gone from Clover.
  const keptGroups = (existing?.modifierGroups ?? []).filter((g) => !importedGroupRefs.has(g.ref) && !g.modifiers.some((m) => m.posModifierRef));
  const customGroupRefs = new Set(keptGroups.map((g) => g.ref));
  const groupRefs = new Set([...importedGroupRefs, ...customGroupRefs]);
  // Categories: keep those not used by Clover items before (owner-made) and any still holding a kept item.
  const cloverCatRefs = new Set((existing?.items ?? []).filter((i) => i.posItemRef).map((i) => i.categoryRef));
  const keptCats = (existing?.categories ?? []).filter((c) => !importedCatRefs.has(c.ref) && (!cloverCatRefs.has(c.ref) || keptItems.some((i) => i.categoryRef === c.ref)));
  const merged: MenuWithMerchant = {
    ...imported,
    posMerchantId: merchantId,
    hours: existing?.hours,
    unavailableByLocation: existing?.unavailableByLocation,
    unavailableUntil: existing?.unavailableUntil,
    categories: [
      ...imported.categories.map((c) => {
        const prevCat = (existing?.categories ?? []).find((x) => x.ref === c.ref);
        return { ...c, ...(catHours.get(c.ref) ? { hours: catHours.get(c.ref) } : {}), ...(prevCat?.nameFr ? { nameFr: prevCat.nameFr } : {}) };
      }),
      ...keptCats,
    ],
    items: [
      ...imported.items.map((i) => {
        const prev = before.get(i.ref);
        if (!prev) return i;
        // Owner-entered description wins (Clover's alternateName is usually the French/kitchen name);
        // custom option groups attached in Food Hub stay on the Clover item.
        const modifierGroupRefs = [...new Set([...i.modifierGroupRefs, ...prev.modifierGroupRefs.filter((r) => customGroupRefs.has(r))])];
        return { ...i, modifierGroupRefs, channelPrices: prev.channelPrices, description: prev.description || i.description, imageUrl: i.imageUrl || prev.imageUrl, tags: prev.tags, allergens: prev.allergens, calories: prev.calories, nameFr: prev.nameFr, descriptionFr: prev.descriptionFr };
      }),
      // Kept items may only point at groups that still exist.
      ...keptItems.map((i) => ({ ...i, modifierGroupRefs: i.modifierGroupRefs.filter((r) => groupRefs.has(r)) })),
    ],
    modifierGroups: [
      // Keep French names typed in Food Hub for option groups and options.
      ...imported.modifierGroups.map((g) => {
        const prevG = (existing?.modifierGroups ?? []).find((x) => x.ref === g.ref);
        if (!prevG) return g;
        return { ...g, nameFr: prevG.nameFr, modifiers: g.modifiers.map((m) => ({ ...m, nameFr: prevG.modifiers.find((x) => x.ref === m.ref)?.nameFr })) };
      }),
      ...keptGroups,
    ],
  };
  const saved = await repo.saveMenu(merged);
  const kept = keptItems.length + keptCats.length + keptGroups.length;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: 'menu_import', status: 'success', brandName: String(b.brand), summary: `Menu imported from Clover (${merchantId}) for ${b.brand}: ${saved.items.length} items${kept ? ` — ${keptItems.length} Food Hub item(s), ${keptCats.length} categor${keptCats.length === 1 ? 'y' : 'ies'}, ${keptGroups.length} option group(s) kept` : ''}` });
  return ok({ menu: saved, merchantId, imported: { categories: imported.categories.length, items: imported.items.length, modifierGroups: imported.modifierGroups.length }, kept: { categories: keptCats.length, items: keptItems.length, modifierGroups: keptGroups.length } });
});
