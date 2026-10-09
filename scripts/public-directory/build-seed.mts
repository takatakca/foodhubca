// Builds data/public/directory-seed.json from real sources. Run from the repo root (Node 22.6+):
//   PPPMTL_DIR=../pppmtl node --experimental-strip-types scripts/public-directory/build-seed.mts data/public/directory-seed.json
// PPPMTL_DIR = a pppmtl checkout with the multi-brand config (src/config/brands.ts) and the Clover export.
//  - brands, descriptions, dishes (Clover ids) and platform store ids: pppmtl feature/multi-brand src/config/brands.ts
//  - dish names/prices: pppmtl src/data/clover/inventory.snapshot.json (Clover export 2026-10-07)
//  - English dish names: pppmtl src/data/catalog.generated.ts + src/config/clover-item-map.ts
//  - live flags (store visible on the app): as set in brands.ts from the Uber Eats Manager / DoorDash portal reads of 2026-10-07
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PPP = path.resolve(process.env.PPPMTL_DIR || '../pppmtl') + '/';
const { BRANDS } = await import(pathToFileURL(PPP + 'src/config/brands.ts').href);
const inv = JSON.parse(fs.readFileSync(PPP + 'src/data/clover/inventory.snapshot.json', 'utf8'));
const catalogTs = fs.readFileSync(PPP + 'src/data/catalog.generated.ts', 'utf8');
const mapTs = fs.readFileSync(PPP + 'src/config/clover-item-map.ts', 'utf8');
const photoTs = fs.readFileSync(PPP + 'src/data/clover/photos.generated.ts', 'utf8');
const photoIds = new Set([...photoTs.matchAll(/"([0-9A-Z]{13})"/g)].map((m) => m[1]));

// site id -> clover id
const siteToClover = new Map<string, string>();
for (const m of mapTs.matchAll(/site:\s*"([^"]+)",\s*clover:\s*"([0-9A-Z]+)"/g)) siteToClover.set(m[1], m[2]);
// site id -> nameEn / descriptionEn / descriptionFr
const en = new Map<string, { nameEn: string; nameFr: string }>();
for (const block of catalogTs.split(/\r?\n  \{\r?\n/).slice(1)) {
  const id = /id:\s*"([^"]+)"/.exec(block)?.[1];
  const nameEn = /nameEn:\s*"((?:[^"\\]|\\.)*)"/.exec(block)?.[1];
  const nameFr = /nameFr:\s*"((?:[^"\\]|\\.)*)"/.exec(block)?.[1];
  if (id && nameEn && nameFr && siteToClover.has(id)) en.set(siteToClover.get(id)!, { nameEn, nameFr });
}
const cats = Object.fromEntries(inv.categories.map((c: { id: string; name: string }) => [c.id, c.name]));
const items = new Map<string, { id: string; name: string; price: number; description?: string; categoryIds?: string[] }>(inv.items.map((i: { id: string }) => [i.id, i]));

const SLUG: Record<string, string> = {
  ppp: 'ppp-pizzeria', ooeuf: 'ooeuf', dejeuner: 'dejeuner-montreal', pipita: 'pi-pita', pitalibanais: 'pita-libanais',
  mythos: 'mythos-and-go', nutrishake: 'nutrition-shake', bmbd: 'bin-molle-bin-dure', ocrepe: 'ocrepe',
  viennoise: 'gateaux-montreal', tacomontreal: 'taco-mexican', inntime: 'pizza-inntime', pizzaalgerie: 'pizza-algerie',
  popoulet: 'po-poulet', pouletpoulet: 'poulet-poulet', bolon: 'cafe-bolon', placeafrique: 'place-afrique',
};
const CATEGORIES: Record<string, string[]> = {
  ppp: ['pizza', 'poulet', 'poutine'], ooeuf: ['burgers', 'poutine'], dejeuner: ['burgers', 'poutine'], pipita: ['libanais'],
  pitalibanais: ['libanais'], mythos: ['grec'], nutrishake: ['sante'], bmbd: ['creme-glacee', 'desserts'], ocrepe: ['crepes', 'desserts'],
  viennoise: ['desserts'], tacomontreal: ['mexicain'], inntime: ['pizza'], pizzaalgerie: ['pizza'], popoulet: ['poulet'],
  pouletpoulet: ['poulet'], bolon: ['latino'], placeafrique: ['grillades'],
};
// Food Hub brand names (data/actual/brands.json) used for the hours / menu / order look-ups.
const FOODHUB_NAMES: Record<string, string[]> = {
  ppp: ['PPP Pizzeria'], ooeuf: ['OOeuf'], dejeuner: ['Dejeuner & Dinner'], pipita: ['Pi Pita'], pitalibanais: ['Pita Libanais'],
  mythos: ['Mythos 2 Go'], nutrishake: ['Nutrition Shake'], bmbd: ['Bin molle & Bin Dure', 'Crèmerie Bin Molle Bin Dure'],
  ocrepe: ['OCRÊPE'], viennoise: ['Gateau Montreal'], tacomontreal: ['Taco Mexican'], inntime: ['Pizza Inntime'],
  pizzaalgerie: [], popoulet: ['Po Poulet'], pouletpoulet: ['Poulet Poulet'], bolon: ['Cafe Bolon'], placeafrique: ['Place Afrique'],
};
const FEATURED = new Set(['ppp', 'ooeuf', 'pipita', 'mythos', 'bmbd', 'bolon', 'viennoise', 'nutrishake']);
// Official website (owner's choice 2026-10-08). `live` = the site answers with the brand's own page today (checked 2026-10-09).
const WEBSITE_LIVE = new Set(['pppmtl.com', 'inntime.ca']);

// PPP keeps its own home page in pppmtl, so its rails are empty there: ON2GO needs its own highlights and store links.
const PPP_DISHES = ['FYJ5QXV8R7VT2', 'PV7K48EG1460E', '4CPFQG1YBKJZC', 'KEZWKV1KF0YBW', '3KEZ2GZT59MC2', 'YDFQHHE9JCVEJ',
  'WYEF3AJ5BY34P', 'T7RZ6YCXJ1R2A', '9M2JQR3HE1VD4', '1NM1MXQ5QY48P', '81JCAM9M1V9QJ', 'BEJCK56NNWTQW'];
const PPP_LINKS = {
  ndg: [
    { platform: 'ubereats', uuid: 'dc493fba-120f-529c-a508-caef6a926de9', slug: 'ppp-pizzeria-ndg', live: true },
    { platform: 'doordash', store: '28040070', live: false, note: 'operations suspended' },
  ],
  'st-leonard': [
    { platform: 'ubereats', uuid: '627d09f0-8fb4-57f2-8ec1-6a71984ad267', slug: 'ppp-pizzeria-hochelaga', live: true },
    { platform: 'doordash', store: '33598081', live: false, note: 'inactive (POS outage)' },
  ],
};
const FORBIDDEN_STORES = new Set(['27982486']); // Po Poulet NDG on DoorDash: never linked (owner's order)

const KITCHEN_ID: Record<string, string> = { ndg: 'ndg', 'st-leonard': 'saint-leonard' };
const dishIds = new Set<string>();
const brands = BRANDS.map((b) => {
  const dishes = b.id === 'ppp' ? PPP_DISHES : [...new Set(b.menu.flatMap((r) => r.items))];
  dishes.forEach((d) => dishIds.add(d));
  const kitchens = b.id === 'ppp'
    ? [{ kitchen: 'ndg', orderLinks: PPP_LINKS.ndg }, { kitchen: 'st-leonard', orderLinks: PPP_LINKS['st-leonard'] }]
    : b.kitchens;
  const links = kitchens.map((k) => ({
    kitchen: KITCHEN_ID[k.kitchen],
    orderLinks: (k.orderLinks as Array<Record<string, unknown>>)
      .filter((l) => !FORBIDDEN_STORES.has(String(l.store ?? '')))
      .map((l) => (l.platform === 'doordash'
        ? { platform: 'doordash', storeId: String(l.store), live: Boolean(l.live) }
        : l.platform === 'ubereats'
          ? { platform: 'ubereats', storeId: String(l.uuid), slug: String(l.slug), live: Boolean(l.live) }
          : { platform: 'skip', url: String(l.url), live: Boolean(l.live) })),
  }));
  const website = b.id === 'viennoise' ? 'viennoise.ca' : b.domain;
  const isSubdomain = website.split('.').length > 2;
  return {
    id: SLUG[b.id],
    name: b.id === 'viennoise' ? 'Gâteaux Montréal' : b.name,
    alternateNames: b.id === 'viennoise' ? ['Gâteau Montréal', 'La Viennoise'] : (b.alternateNames ?? []),
    categories: CATEGORIES[b.id],
    cuisine: b.cuisine,
    description: b.id === 'viennoise'
      ? {
        fr: b.description.fr.replace('La Viennoise (Gâteaux Montréal), c’est', 'Gâteaux Montréal (La Viennoise), c’est'),
        en: b.description.en.replace(/^La Viennoise \(Gâteaux Montréal\)/, 'Gâteaux Montréal (La Viennoise)'),
      }
      : b.description,
    about: b.about,
    website: { url: `https://${website}/`, live: WEBSITE_LIVE.has(website), planned: isSubdomain },
    color: b.primary || '#b3261e',
    icon: b.icon,
    featured: FEATURED.has(b.id),
    foodhubBrandNames: FOODHUB_NAMES[b.id],
    kitchens: links,
    dishes,
  };
});

// Clover staff hints at the end of a name, e.g. "(P. FRITS)", "(CROQ. OU AIL)": not for customers.
const clean = (n: string) => n.replace(/\s*\((?:P\. FRITS|CROQ\. OU AIL)\)\s*$/, '').trim();
const dishes: Record<string, unknown> = {};
for (const id of [...dishIds].sort()) {
  const it = items.get(id);
  if (!it) throw new Error(`dish ${id} missing in the Clover snapshot`);
  const e = en.get(id);
  const category = cats[(it.categoryIds ?? [])[0]] ?? '';
  dishes[id] = {
    name: { fr: clean(e?.nameFr ?? it.name), en: clean(e?.nameEn ?? e?.nameFr ?? it.name) },
    price: it.price / 100,
    category,
    deal: /Family Combos|Double 2x Pizza|Promo Pizza/.test(category),
    photo: photoIds.has(id),
  };
}

const seed = {
  _about: 'Public directory seed for ON2GO.ca and partners (QMAPS). Public facts only: brand names, descriptions, kitchen addresses, platform store ids that appear in public store URLs, highlight dishes (Clover item ids) with counter prices. Generated 2026-10-09 from the pppmtl brand config and the Clover menu export of 2026-10-07; Food Hub replaces hours, prices and photos with live values when its database has them. Po Poulet NDG is never added (FORBIDDEN_STORE_IDS in lib/foodhub/public-directory.ts).',
  version: 1,
  updatedAt: '2026-10-09',
  timezone: 'America/Toronto',
  kitchens: [
    {
      id: 'ndg', name: { fr: 'Cuisine NDG', en: 'NDG kitchen' }, area: 'Notre-Dame-de-Grâce',
      address: { street: '6280 Av Somerled', city: 'Montréal', region: 'QC', postalCode: 'H3X 2B6', country: 'CA' },
      geo: { lat: 45.4705921, lng: -73.6353129 },
      foodhubLocationCodes: ['NDG_MAIN', 'NDG_6284'],
      defaultHours: Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d) => [d, [{ open: '16:30', close: '03:15' }]])),
      hoursSource: 'Uber Eats Manager 2026-10-07 (store hours)',
    },
    {
      id: 'saint-leonard', name: { fr: 'Cuisine Saint-Léonard', en: 'Saint-Léonard kitchen' }, area: 'Saint-Léonard',
      address: { street: '5839 Rue Jean-Talon E', city: 'Montréal', region: 'QC', postalCode: 'H1S 1M4', country: 'CA' },
      geo: null,
      foodhubLocationCodes: ['SAINT_LEONARD'],
      defaultHours: Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d) => [d, [{ open: '09:00', close: '23:00' }]])),
      hoursSource: 'Uber Eats Manager 2026-10-07 (store hours)',
    },
  ],
  brands,
  dishes,
};
fs.writeFileSync(process.argv[2], JSON.stringify(seed, null, 2) + '\n');
console.log('brands', brands.length, 'dishes', Object.keys(dishes).length, 'withPhoto', Object.values(dishes).filter((d: any) => d.photo).length, 'en names', [...dishIds].filter((d) => en.has(d)).length);
