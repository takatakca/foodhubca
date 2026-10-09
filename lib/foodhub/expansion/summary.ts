// One read for the Overview tiles and Settings → Expansion: which features are on, what each still needs (credentials,
// platform approvals, rules), and today's numbers. Reads only Food Hub's own data — no platform call.
import { ALCOHOL_CHANNELS, getAlcoholSettings, permitExpired } from '../alcohol/rules';
import { getCatalog } from '../catalog';
import { round2 } from '../config';
import { fleetReadiness } from '../delivery/dispatch';
import { getDeliverySettings, listDeliveries, listDirectOrders } from '../delivery/store';
import { ACTIVE } from '../delivery/types';
import { aiConfigured, callConfigured, smsConfigured } from '../notify';
import { phoneModel } from '../phone/agent';
import { listCalls } from '../phone/calls';
import { getPhoneSettings } from '../phone/settings';
import { listProducts, lowStock } from '../retail/catalog';
import { RETAIL_PLATFORMS } from '../retail/platforms';
import { startOfLocalDayMs } from '../time';
import { FEATURE_KEYS, FEATURE_LABELS, getFeatures, type FeatureKey } from './features';

export interface FeatureCheck { ok: boolean; fr: string; en: string; href?: string }

export async function expansionSummary(scope?: string[]) {
  const inScope = (code?: string | null) => !scope?.length || (code ? scope.includes(code) : false);
  const since = new Date(startOfLocalDayMs()).toISOString();
  const [features, catalog, dSettings, orders, deliveries, calls, phone, alcohol, products] = await Promise.all([
    getFeatures(), getCatalog(), getDeliverySettings(), listDirectOrders({ since, limit: 2000 }), listDeliveries({ since: new Date(Date.now() - 2 * 86400_000).toISOString(), limit: 2000 }),
    listCalls({ since, limit: 1000 }), getPhoneSettings(), getAlcoholSettings(), listProducts(),
  ]);
  const myOrders = orders.filter((o) => inScope(o.locationCode));
  const orderIds = new Set(myOrders.map((o) => o.id));
  const todayDeliveries = deliveries.filter((d) => orderIds.has(d.orderId));
  const fleets = fleetReadiness();
  const activeLocations = catalog.locations.filter((l) => l.active && inScope(l.code));
  // The courier calls the kitchen it picks up from: only kitchens that deliver their own orders need a phone here
  // (every active kitchen while none does yet).
  const delivering = activeLocations.filter((l) => dSettings.locations[l.code]?.enabled);
  const noPhone = (delivering.length ? delivering : activeLocations).filter((l) => !l.phone).map((l) => l.name);

  const checks: Record<FeatureKey, FeatureCheck[]> = {
    delivery: [
      { ok: fleets[0].configured, fr: `DoorDash Drive : ${fleets[0].configured ? `branché (${fleets[0].environment === 'sandbox' ? 'bac à sable' : 'production'})` : 'clés manquantes'}`, en: `DoorDash Drive: ${fleets[0].configured ? `connected (${fleets[0].environment})` : 'keys missing'}`, href: '/settings/expansion/delivery' },
      { ok: fleets[1].configured, fr: `Uber Direct (comparaison) : ${fleets[1].configured ? 'branché' : 'optionnel — non branché'}`, en: `Uber Direct (comparison): ${fleets[1].configured ? 'connected' : 'optional — not connected'}`, href: '/settings/expansion/delivery' },
      { ok: Object.values(dSettings.locations).some((r) => r.enabled), fr: 'Au moins une cuisine livre elle-même', en: 'At least one kitchen delivers its own orders', href: '/settings/expansion/delivery' },
      { ok: !noPhone.length, fr: noPhone.length ? `Téléphone de la cuisine manquant : ${noPhone.join(', ')} (le livreur l’appelle)` : 'Chaque cuisine qui livre a un téléphone (le livreur l’appelle)', en: noPhone.length ? `Kitchen phone missing: ${noPhone.join(', ')} (the courier calls it)` : 'Every delivering kitchen has a phone (the courier calls it)', href: '/settings/business' },
      { ok: smsConfigured(), fr: 'Textos (lien de suivi au client)', en: 'Texts (tracking link to the customer)', href: '/settings/alerts' },
    ],
    retail: [
      { ok: products.length > 0, fr: `${products.length} produit(s) au catalogue`, en: `${products.length} product(s) in the catalogue`, href: '/menu/retail' },
      { ok: false, fr: 'DoorDash Marketplace Retail : approbation de DoorDash requise', en: 'DoorDash Marketplace Retail: needs DoorDash approval', href: '/menu/retail' },
      { ok: false, fr: 'Uber Eats épicerie : approbation d’Uber requise', en: 'Uber Eats grocery: needs Uber approval', href: '/menu/retail' },
    ],
    alcohol: [
      ...activeLocations.map((l): FeatureCheck => {
        const r = alcohol.locations[l.code];
        const ok = Boolean(r && r.permitType !== 'none' && r.permitNumber && r.verifiedAt && !permitExpired(r));
        const open = r ? ALCOHOL_CHANNELS.filter((c) => r.channels[c]).length : 0;
        return { ok, fr: `${l.name} : ${ok ? `permis vérifié, ${open} canal(aux) ouvert(s)` : 'aucun permis vérifié — alcool bloqué'}`, en: `${l.name}: ${ok ? `permit checked, ${open} channel(s) open` : 'no checked permit — alcohol blocked'}`, href: '/settings/expansion/alcohol' };
      }),
    ],
    phone: [
      { ok: aiConfigured(), fr: `IA (Claude) : ${aiConfigured() ? `prête (${phoneModel()})` : 'ANTHROPIC_API_KEY manquante'}`, en: `AI (Claude): ${aiConfigured() ? `ready (${phoneModel()})` : 'ANTHROPIC_API_KEY missing'}`, href: '/settings/alerts' },
      { ok: callConfigured(), fr: 'Twilio Voice (numéro et jeton)', en: 'Twilio Voice (number and token)', href: '/settings/expansion/phone' },
      { ok: phone.lines.some((l) => l.enabled), fr: `${phone.lines.filter((l) => l.enabled).length} ligne(s) active(s)`, en: `${phone.lines.filter((l) => l.enabled).length} line(s) on`, href: '/settings/expansion/phone' },
    ],
  };

  const courierCost = round2(todayDeliveries.filter((d) => d.status !== 'cancelled').reduce((s, d) => s + (d.fee ?? 0), 0));
  const feesCharged = round2(myOrders.filter((o) => o.fulfillment === 'delivery' && o.status !== 'cancelled').reduce((s, o) => s + o.deliveryFee, 0));
  return {
    features: FEATURE_KEYS.map((k) => ({ ...features[k], label: FEATURE_LABELS[k], checks: checks[k] })),
    today: {
      orders: myOrders.filter((o) => o.status !== 'cancelled').length,
      sales: round2(myOrders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0)),
      byPhone: myOrders.filter((o) => o.source === 'phone_ai' && o.status !== 'cancelled').length,
      attention: myOrders.filter((o) => o.attention && o.status !== 'cancelled' && o.status !== 'completed').length,
      deliveriesActive: deliveries.filter((d) => orderIds.has(d.orderId) && ACTIVE.includes(d.status)).length,
      delivered: todayDeliveries.filter((d) => d.status === 'delivered').length,
      courierCost, feesCharged,
      calls: calls.filter((c) => !c.simulated && inScope(c.locationCode)).length,
      callsOrdered: calls.filter((c) => !c.simulated && c.orderId && inScope(c.locationCode)).length,
      callsMissed: calls.filter((c) => !c.simulated && c.status === 'handoff_missed' && inScope(c.locationCode)).length,
      products: products.length,
      lowStock: products.filter((p) => activeLocations.some((l) => lowStock(p, l.code))).length,
      alcoholLocations: activeLocations.filter((l) => checks.alcohol.find((c) => c.fr.startsWith(l.name))?.ok).length,
    },
    fleets,
    retailPlatforms: Object.values(RETAIL_PLATFORMS),
  };
}

export type ExpansionSummary = Awaited<ReturnType<typeof expansionSummary>>;
