// Translates the TAKATAK master menu into each platform's menu format.
// Formats follow the published specs:
//   SkipTheDishes  POST https://api.flytplatform.com/menus   (JET Connect)
//   Uber Eats      PUT  /v2/eats/stores/{store_id}/menus
//   DoorDash       POST /marketplace/api/v1/menus
// Store hours, holidays and category schedules come from the PublishContext (lib/foodhub/hours.ts).
import { toCents } from '../config';
import { allDayWeek, dayKeyOf, DAYS, intersectWeeks, normalizeWeek, weekIsEmpty } from '../hours';
import type { DayKey, Holiday, Marketplace, MasterMenu, MenuCategory, MenuItem, MenuLanguage, PublishContext, WeeklyHours } from '../types';
import { label } from './language';
import type { MenuIssue } from './verify';

/** 24/7 — only used when no store hours were ever set (the menu verifier warns about it). */
export function defaultHours(): WeeklyHours {
  return allDayWeek();
}

/** Markup percentage for a platform (0 when none), clamped to a sane range. */
export function markupPct(menu: Pick<MasterMenu, 'channelMarkupPct'> | null | undefined, marketplace: Marketplace): number {
  const v = Number(menu?.channelMarkupPct?.[marketplace] ?? 0);
  return Number.isFinite(v) ? Math.min(Math.max(v, -50), 200) : 0;
}

/** Base price × (1 + markup), rounded to the cent (a 0 $ price stays 0 $). */
export function withMarkup(price: number, pct: number): number {
  const p = Number(price) || 0;
  if (!pct || p <= 0) return p;
  return Math.round(p * (100 + pct) + 1e-6) / 100;
}

/** Item price on a platform: per-item override first, otherwise the base price plus the platform markup. */
export function priceFor(item: MenuItem, marketplace: Marketplace, menu?: Pick<MasterMenu, 'channelMarkupPct'> | null): number {
  const override = item.channelPrices?.[marketplace];
  return typeof override === 'number' && override > 0 ? override : withMarkup(item.price, markupPct(menu, marketplace));
}

/** Modifier price on a platform (same markup as the items). */
export function modifierPriceFor(mod: { price: number }, marketplace: Marketplace, menu?: Pick<MasterMenu, 'channelMarkupPct'> | null): number {
  return withMarkup(mod.price, markupPct(menu, marketplace));
}

/** Items that are in a valid category, in category order. */
function liveItems(menu: MasterMenu) {
  const cats = new Set(menu.categories.map((c) => c.ref));
  return menu.items.filter((i) => cats.has(i.categoryRef));
}

/** Categories in the order the Menu Manager shows them (sortOrder), so every platform matches the editor. */
export function sortedCategories(menu: MasterMenu): MenuCategory[] {
  return [...menu.categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

const TAG_LABELS: Record<string, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', gluten_free: 'Gluten-free', spicy: 'Spicy', halal: 'Halal', alcohol: 'Contains alcohol' };
const TAG_LABELS_FR: Record<string, string> = { vegetarian: 'Végétarien', vegan: 'Végétalien', gluten_free: 'Sans gluten', spicy: 'Épicé', halal: 'Halal', alcohol: "Contient de l'alcool" };

/** Description shown on every platform: text + dietary tags + allergens + calories (English or French). */
export function platformDescription(item: MenuItem, lang: 'en' | 'fr' = 'en'): string {
  const fr = lang === 'fr';
  const extras = [
    (item.tags ?? []).map((t) => (fr ? TAG_LABELS_FR : TAG_LABELS)[t] ?? t).join(' · '),
    item.allergens?.length ? `${fr ? 'Contient' : 'Contains'}: ${item.allergens.join(', ')}` : '',
    typeof item.calories === 'number' && item.calories > 0 ? `${Math.round(item.calories)} cal` : '',
  ].filter(Boolean);
  const body = fr ? (item.descriptionFr?.trim() || item.description?.trim() || '') : (item.description?.trim() || '');
  return [body, extras.join(' — ')].filter(Boolean).join('\n').slice(0, 500);
}

/** Description in the platform's chosen language ("both" = French first, then English). */
function describe(item: MenuItem, lang: MenuLanguage = 'en'): string {
  if (lang === 'fr') return platformDescription(item, 'fr');
  if (lang === 'both' && (item.descriptionFr || item.nameFr)) {
    const fr = platformDescription(item, 'fr'); const en = platformDescription(item, 'en');
    return (fr === en ? en : `${fr}\n—\n${en}`).slice(0, 500);
  }
  return platformDescription(item, 'en');
}

function storeWeek(menu: MasterMenu, ctx?: PublishContext): WeeklyHours {
  if (ctx?.hours && !weekIsEmpty(ctx.hours)) return normalizeWeek(ctx.hours);
  if (ctx?.hours) return normalizeWeek(ctx.hours); // explicitly closed every day
  return menu.hours ? normalizeWeek(menu.hours) : defaultHours();
}

/** Categories grouped by the hours they are sold: [store-hours group, ...scheduled groups]. */
export function scheduleGroups(menu: MasterMenu, store: WeeklyHours): Array<{ key: string; hours: WeeklyHours; categories: MenuCategory[] }> {
  const groups = new Map<string, { key: string; hours: WeeklyHours; categories: MenuCategory[] }>();
  for (const c of sortedCategories(menu)) {
    const own = c.hours && !weekIsEmpty(c.hours) ? intersectWeeks(normalizeWeek(c.hours), store) : null;
    const hours = own ?? store;
    const key = own ? JSON.stringify(own) : 'store';
    if (own && weekIsEmpty(own)) continue; // category schedule never overlaps store hours → not sold
    const g = groups.get(key) ?? { key, hours, categories: [] };
    g.categories.push(c);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.key === 'store' ? -1 : b.key === 'store' ? 1 : 0));
}

// ---------------- SkipTheDishes (JET Connect) ----------------
// POST https://api.flytplatform.com/menus — items identified by PLU (we use the item ref,
// which is the Clover item id after an import), prices in cents, modifiers with pick rules.
// Scheduled categories (e.g. breakfast) become extra menus with their own availability.
export function toSkipMenu(menu: MasterMenu, restaurantRefs: string[], callbackUrl?: string, offRefs: Set<string> = new Set(), ctx?: PublishContext) {
  const items = liveItems(menu);
  const store = storeWeek(menu, ctx);
  const groups = new Map(menu.modifierGroups.map((g) => [g.ref, g]));
  const base = `takatak-${menu.brandName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}`;
  const availability = (week: WeeklyHours) => Object.fromEntries(DAYS.map((d) => [d, (week[d] ?? []).map((p) => `${p.open} - ${p.close}`)]));
  const lang = ctx?.language ?? 'en';
  const category = (c: MenuCategory) => ({
    name: label(c.name, c.nameFr, lang),
    description: '',
    items: items.filter((i) => i.categoryRef === c.ref).map((i) => ({
      name: label(i.name, i.nameFr, lang),
      description: describe(i, lang),
      plu: i.ref,
      price: toCents(priceFor(i, 'skip', menu)),
      out_of_stock: !i.available || offRefs.has(i.ref),
      ...(i.imageUrl ? { gallery: [{ url: i.imageUrl }] } : {}),
      modifiers: i.modifierGroupRefs.map((ref) => groups.get(ref)).filter(Boolean).map((g) => ({
        name: label(g!.name, g!.nameFr, lang),
        description: '',
        pick: g!.min === g!.max && g!.max > 0
          ? { pick_same_option: false, exactly: g!.max }
          : { pick_same_option: false, range: { from: Math.max(0, g!.min), to: g!.max > 0 ? g!.max : g!.modifiers.length } },
        options: g!.modifiers.map((m) => ({
          name: label(m.name, m.nameFr, lang),
          plu: m.ref,
          price: toCents(modifierPriceFor(m, 'skip', menu)),
          out_of_stock: !m.available || offRefs.has(m.ref),
        })),
      })),
    })),
  });
  return {
    restaurants: restaurantRefs,
    menus: scheduleGroups(menu, store).map((g, i) => ({
      name: i === 0 && g.key === 'store' ? menu.brandName : `${menu.brandName} — ${g.categories.map((c) => c.name).join(', ')}`,
      default_language: lang === 'fr' ? 'fr-CA' : 'en-CA',
      reference: i === 0 && g.key === 'store' ? base : `${base}-schedule-${i}`,
      type: 'DELIVERY',
      availability: availability(g.hours),
      categories: g.categories.map(category),
    })),
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
  };
}

// ---------------- Uber Eats ----------------
// PUT /v2/eats/stores/{store_id}/menus (developer.uber.com/docs/eats/references/api/v2/put-eats-stores-storeid-menu).
/**
 * Uber MultiLanguageText holds ONE translation ("Only one translation should be provided and will be displayed to all
 * users"), keyed <lang>_<country>. French and English together therefore go in one text, French first (the menu
 * language setting): "Poulet grillé / Grilled chicken".
 */
export const UBER_LOCALES = { en: 'en_ca', fr: 'fr_ca' } as const;
export const uberLocale = (lang: MenuLanguage = 'both') => (lang === 'en' ? UBER_LOCALES.en : UBER_LOCALES.fr);
const SUSPEND_FOREVER = { suspension_info: { suspension: { suspend_until: 8640000000, reason: 'Unavailable' } } };

/**
 * tax_info is a required item field whose two members are optional. Uber computes Canadian sales tax from the store's
 * own tax setup, so Food Hub sends it empty; UBER_TAX_RATE_PCT (e.g. 14.975) adds tax_rate "charged on top of the
 * price" on first-level items — only if Uber's integration support asks for it, otherwise tax could be counted twice.
 */
export function uberTaxInfo(firstLevel: boolean): { tax_rate?: number } {
  const pct = Number(process.env.UBER_TAX_RATE_PCT);
  return firstLevel && process.env.UBER_TAX_RATE_PCT && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? { tax_rate: pct } : {};
}

export function toUberMenu(menu: MasterMenu, ctx?: PublishContext, offRefs: Set<string> = new Set()) {
  const items = liveItems(menu);
  const store = storeWeek(menu, ctx);
  const lang = ctx?.language ?? 'both';
  const locale = uberLocale(lang);
  const text = (en: string, fr?: string) => ({ translations: { [locale]: label(en, fr, lang) } });
  // An option used by two groups is ONE Uber item (Uber refuses duplicate ids): the first definition wins.
  const modifierItems = new Map<string, { id: string; external_data: string; title: { translations: Record<string, string> }; price_info: { price: number }; quantity_info: Record<string, never>; tax_info: { tax_rate?: number } }>();
  for (const m of menu.modifierGroups.flatMap((g) => g.modifiers)) {
    if (modifierItems.has(`mod:${m.ref}`)) continue;
    modifierItems.set(`mod:${m.ref}`, {
      id: `mod:${m.ref}`,
      external_data: m.ref,
      title: text(m.name, m.nameFr),
      price_info: { price: toCents(modifierPriceFor(m, 'uber_eats', menu)) },
      quantity_info: {},
      tax_info: uberTaxInfo(false),
      ...(m.available && !offRefs.has(m.ref) ? {} : SUSPEND_FOREVER),
    });
  }
  const availability = (week: WeeklyHours) => DAYS.map((day) => ({
    day_of_week: day,
    time_periods: (week[day] ?? []).map((p) => ({ start_time: p.open, end_time: p.close })),
  })).filter((d) => d.time_periods.length > 0);
  // A category without items shows nothing on Uber: it is left out (and so is a scheduled menu left without categories).
  const filled = new Set(items.map((i) => i.categoryRef));
  const groups = scheduleGroups(menu, store).map((g) => ({ ...g, categories: g.categories.filter((c) => filled.has(c.ref)) })).filter((g, i) => i === 0 || g.categories.length);
  return {
    menus: groups.map((g, i) => ({
      id: i === 0 && g.key === 'store' ? 'takatak-main' : `takatak-schedule-${i}`,
      title: text(i === 0 && g.key === 'store' ? menu.brandName : `${menu.brandName} — ${g.categories.map((c) => label(c.name, c.nameFr, lang)).join(', ')}`),
      service_availability: availability(g.hours),
      category_ids: g.categories.map((c) => c.ref),
    })),
    categories: sortedCategories(menu).filter((c) => filled.has(c.ref)).map((c) => ({
      id: c.ref,
      title: text(c.name, c.nameFr),
      entities: items.filter((i) => i.categoryRef === c.ref).map((i) => ({ id: i.ref, type: 'ITEM' })),
    })),
    items: [
      ...items.map((i) => ({
        id: i.ref,
        external_data: i.ref,
        title: text(i.name, i.nameFr),
        description: { translations: { [locale]: describe(i, lang) } },
        ...(i.imageUrl ? { image_url: i.imageUrl } : {}),
        price_info: { price: toCents(priceFor(i, 'uber_eats', menu)) },
        tax_info: uberTaxInfo(true),
        modifier_group_ids: { ids: i.modifierGroupRefs },
        // energy_interval replaces the deprecated lower_range / upper_range; values are E5 (780 cal = 78000000).
        ...(typeof i.calories === 'number' && i.calories > 0 ? { nutritional_info: { calories: { energy_interval: { lower: Math.round(i.calories) * 100000, upper: Math.round(i.calories) * 100000 } } } } : {}),
        ...(i.available && !offRefs.has(i.ref) ? {} : SUSPEND_FOREVER),
      })),
      ...modifierItems.values(),
    ],
    modifier_groups: menu.modifierGroups.map((g) => ({
      id: g.ref,
      title: text(g.name, g.nameFr),
      quantity_info: { quantity: { min_permitted: g.min, max_permitted: g.max <= 0 ? g.modifiers.length : g.max } },
      modifier_options: [...new Set(g.modifiers.map((m) => `mod:${m.ref}`))].map((id) => ({ id, type: 'ITEM' })),
    })),
    display_options: { disable_item_instructions: false },
  };
}

/** The one text Uber shows for a MultiLanguageText (whatever its locale key). */
export const uberText = (t: { translations: Record<string, string> } | undefined) => Object.values(t?.translations ?? {})[0] ?? '';

export type UberMenuIssue = MenuIssue;

/**
 * Structural checks on the Uber menu body before it is sent (Uber refuses the whole PUT for one dangling id): unique
 * ids, every reference resolvable, quantity rules, prices, titles, photo URLs. Errors block that store's publish.
 */
export function checkUberMenu(body: ReturnType<typeof toUberMenu>): UberMenuIssue[] {
  const out: UberMenuIssue[] = [];
  const add = (level: UberMenuIssue['level'], code: string, message: string, ref?: string) => out.push({ level, code, message, ref });
  const items = new Map<string, (typeof body.items)[number]>();
  for (const i of body.items) {
    if (items.has(i.id)) add('error', 'uber_duplicate_id', `Two Uber items share the id ${i.id}.`, i.id.replace(/^mod:/, ''));
    items.set(i.id, i);
    const title = uberText(i.title).trim() || undefined;
    if (!title) add('error', 'uber_no_title', `An Uber item (${i.id}) has no title.`, i.id.replace(/^mod:/, ''));
    if (!(i.price_info.price >= 0)) add('error', 'uber_price', `"${title ?? i.id}" has an invalid price.`, i.id.replace(/^mod:/, ''));
    if ('image_url' in i && i.image_url && !/^https:\/\//i.test(i.image_url)) add('warning', 'uber_image_url', `"${title ?? i.id}": Uber only downloads photos from https:// links.`, i.id);
  }
  const groups = new Set(body.modifier_groups.map((g) => g.id));
  const categories = new Set(body.categories.map((c) => c.id));
  for (const g of body.modifier_groups) {
    const q = g.quantity_info.quantity;
    if (q.min_permitted > q.max_permitted) add('error', 'uber_group_min_max', `Option group "${uberText(g.title)}": at least ${q.min_permitted} but at most ${q.max_permitted}.`, g.id);
    if (q.min_permitted > g.modifier_options.length) add('error', 'uber_group_min_options', `Option group "${uberText(g.title)}" requires ${q.min_permitted} choice(s) but has ${g.modifier_options.length} option(s).`, g.id);
    for (const o of g.modifier_options) if (!items.has(o.id)) add('error', 'uber_missing_option', `Option group ${g.id} points to ${o.id}, which is not in the menu.`, g.id);
  }
  for (const i of body.items) for (const gid of ('modifier_group_ids' in i ? i.modifier_group_ids.ids : [])) if (!groups.has(gid)) add('error', 'uber_missing_group', `Item ${i.id} uses option group ${gid}, which is not in the menu.`, i.id);
  for (const c of body.categories) for (const e of c.entities) if (!items.has(e.id)) add('error', 'uber_missing_item', `Category ${c.id} lists ${e.id}, which is not in the menu.`, c.id);
  if (!body.menus.length || !body.menus.some((m) => m.category_ids.length)) add('error', 'uber_empty_menu', 'The Uber menu has no category to show.');
  for (const m of body.menus) for (const cid of m.category_ids) if (!categories.has(cid)) add('error', 'uber_missing_category', `Menu ${m.id} lists category ${cid}, which is not in the menu.`);
  return out;
}

/** Uber holiday hours body: POST /v1/eats/stores/{id}/holiday-hours (closed all day = one 00:00–00:00 period, per Uber). */
export function toUberHolidayHours(holidays: Holiday[]) {
  return {
    holiday_hours: Object.fromEntries(holidays.map((h) => [h.date, {
      open_time_periods: h.closed || !(h.slots?.length) ? [{ start_time: '00:00', end_time: '00:00' }] : h.slots!.map((s) => ({ start_time: s.open, end_time: s.close })),
    }])),
  };
}

// ---------------- DoorDash ----------------
const DD_DAY: Record<DayKey, string> = { monday: 'MON', tuesday: 'TUE', wednesday: 'WED', thursday: 'THU', friday: 'FRI', saturday: 'SAT', sunday: 'SUN' };
const sec = (t: string) => `${t}:00`;

/**
 * DoorDash open intervals from a normalized week. normalizeWeek splits an overnight slot at midnight (18:00–23:59 +
 * next day 00:00–02:00), but DoorDash deducts 20 minutes from every end_time — split that way, a late-night store
 * would stop taking orders at 23:39. DoorDash reads end_time < start_time as "into the next day", so the two halves
 * are joined again (MON 18:00:00 → 02:00:00), and a slot that really ends at midnight is sent as 23:59:59.
 */
export function doorDashIntervals(week: WeeklyHours): Array<{ day: DayKey; start_time: string; end_time: string }> {
  const joined = new Set<DayKey>(); // days whose 00:00 slot was joined to the previous day's late slot
  const joinsNext = new Set<DayKey>();
  DAYS.forEach((d, i) => {
    const slots = week[d] ?? [];
    const last = slots[slots.length - 1];
    const next = DAYS[(i + 1) % 7];
    const first = week[next]?.[0];
    if (last && last.close === '23:59' && last.open !== '00:00' && first && first.open === '00:00' && first.close !== '23:59') { joinsNext.add(d); joined.add(next); }
  });
  const out: Array<{ day: DayKey; start_time: string; end_time: string }> = [];
  DAYS.forEach((d, i) => {
    const slots = week[d] ?? [];
    slots.forEach((p, j) => {
      if (j === 0 && joined.has(d)) return;
      const isLast = j === slots.length - 1;
      const end = isLast && joinsNext.has(d) ? sec(week[DAYS[(i + 1) % 7]][0].close) : p.close === '23:59' ? '23:59:59' : sec(p.close);
      out.push({ day: d, start_time: sec(p.open), end_time: end });
    });
  });
  return out;
}

export function toDoorDashMenu(menu: MasterMenu, merchantSuppliedId: string, providerType: string, reference: string, ctx?: PublishContext, offRefs: Set<string> = new Set()) {
  const items = liveItems(menu);
  const store = storeWeek(menu, ctx);
  const groups = new Map(menu.modifierGroups.map((g) => [g.ref, g]));
  const today = ctx?.today ?? new Date().toISOString().slice(0, 10);
  const lang = ctx?.language ?? 'en';
  const inAYear = new Date(Date.parse(`${today}T12:00:00Z`) + 365 * 86400_000).toISOString().slice(0, 10);
  // Scheduled categories → item-level hours (DoorDash "item_special_hours").
  const categoryHours = new Map<string, WeeklyHours>();
  for (const g of scheduleGroups(menu, store)) if (g.key !== 'store') for (const c of g.categories) categoryHours.set(c.ref, g.hours);
  const visibleCats = new Set(scheduleGroups(menu, store).flatMap((g) => g.categories.map((c) => c.ref)));
  return {
    reference,
    store: { merchant_supplied_id: merchantSuppliedId, provider_type: providerType },
    // DoorDash: open_hours lists open intervals only — a closed day is simply omitted.
    open_hours: doorDashIntervals(store).map((p) => ({ day_index: DD_DAY[p.day], start_time: p.start_time, end_time: p.end_time })),
    // A closed special day is a full-day closure: closed with 00:00:00–23:59:59 (DoorDash store hours reference).
    special_hours: (ctx?.holidays ?? []).flatMap((h) => (h.closed || !(h.slots?.length)
      ? [{ date: h.date, closed: true, start_time: '00:00:00', end_time: '23:59:59' }]
      : h.slots!.map((s) => ({ date: h.date, closed: false, start_time: sec(s.open), end_time: sec(s.close) })))),
    menu: {
      name: menu.brandName,
      subtitle: '',
      merchant_supplied_id: `menu-${merchantSuppliedId}`,
      active: true,
      categories: sortedCategories(menu).filter((c) => visibleCats.has(c.ref)).map((c, ci) => ({
        name: label(c.name, c.nameFr, lang),
        subtitle: '',
        merchant_supplied_id: c.ref,
        active: true,
        sort_id: ci,
        items: items.filter((i) => i.categoryRef === c.ref).map((i, ii) => {
          const ch = categoryHours.get(c.ref);
          return {
            name: label(i.name, i.nameFr, lang),
            description: describe(i, lang),
            merchant_supplied_id: i.ref,
            active: i.available && !offRefs.has(i.ref),
            price: toCents(priceFor(i, 'doordash', menu)),
            sort_id: ii,
            ...((i.tags ?? []).includes('alcohol') ? { is_alcohol: true } : {}),
            ...(i.imageUrl ? { original_image_url: i.imageUrl } : {}),
            ...(ch ? { item_special_hours: doorDashIntervals(ch).map((p) => ({ day_index: DD_DAY[p.day], start_time: p.start_time, end_time: p.end_time, start_date: today, end_date: inAYear })) } : {}),
            extras: i.modifierGroupRefs.map((ref) => groups.get(ref)).filter(Boolean).map((g, gi) => ({
              name: label(g!.name, g!.nameFr, lang),
              merchant_supplied_id: g!.ref,
              active: true,
              min_num_options: g!.min,
              max_num_options: g!.max <= 0 ? g!.modifiers.length : g!.max,
              num_free_options: 0,
              sort_id: gi,
              options: g!.modifiers.map((m, mi) => ({
                name: label(m.name, m.nameFr, lang),
                merchant_supplied_id: m.ref,
                active: m.available && !offRefs.has(m.ref),
                price: toCents(modifierPriceFor(m, 'doordash', menu)),
                sort_id: mi,
              })),
            })),
          };
        }),
      })),
    },
  };
}

export { dayKeyOf };
