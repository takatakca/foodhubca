// The three set-up steps of the Clover welcome wizard (/welcome/clover), computed from the real configuration — a step
// is "done" only when Food Hub can see it working, never because someone clicked a box:
//   1. Platforms — a delivery platform has a configured route. A scoped setup needs a route for that merchant or kitchen.
//   2. Menu — a master menu with items was imported from this Clover merchant.
//   3. Kitchen — a kitchen tablet is enrolled and someone who can unlock it (the viewer, or a manager) has a PIN.
import { CHANNEL_KEYS, getAdapter } from './adapters';
import { isRelayStore, relayReadiness } from './adapters/relay';
import { isViaClover } from './adapters/via-clover';
import { getCatalog } from './catalog';
import { CHANNEL_LABELS } from './config';
import { listDevices } from './identity/devices';
import { cloverInjectionEnabled, cloverTokenFor, defaultCloverMerchant } from './pos/clover';
import { listCloverConnections } from './pos/clover-oauth';
import { getRepo } from './repo';
import type { ChannelStore } from './types';

export type OnboardingKey = 'platforms' | 'menu' | 'kitchen';
export interface OnboardingStep {
  key: OnboardingKey;
  done: boolean;
  detail: { fr: string; en: string };
  href: string;
}

interface OnboardingScope {
  merchantId?: string | null;
  viewerHasPin?: boolean;
  locationCodes?: readonly string[];
}

function routeMerchant(store: ChannelStore, injectionDefault: string | null): string | null {
  // The importer currently uses the explicit environment default; injection also resolves a sole approved OAuth store.
  const fallback = isViaClover(store.channel) ? process.env.CLOVER_MERCHANT_ID : injectionDefault;
  return store.cloverMerchantId || fallback || null;
}

export async function onboardingSteps(opts: OnboardingScope = {}): Promise<OnboardingStep[]> {
  const repo = getRepo();
  const viewerScope = new Set(opts.locationCodes);
  const scoped = Boolean(opts.merchantId || viewerScope.size);
  const [stores, menus, devices, users, injectionDefault, connections, catalog] = await Promise.all([
    repo.listStores().catch(() => []),
    repo.listMenus().catch(() => []),
    listDevices().catch(() => []),
    repo.listUsers().catch(() => []),
    scoped ? defaultCloverMerchant().catch(() => null) : Promise.resolve(null),
    scoped ? listCloverConnections().catch(() => []) : Promise.resolve([]),
    scoped ? getCatalog({ strict: true }).catch(() => null) : Promise.resolve(null),
  ]);

  const catalogUnavailable = scoped && !catalog;
  const disabled = new Set(catalog?.locations.filter(({ active }) => active === false).map(({ code }) => code));
  // Existing bindings can refer to older kitchen codes. Only an explicit deactivation excludes one after a successful read.
  const permittedStores = stores.filter((store) => store.locationCode && (!viewerScope.size || viewerScope.has(store.locationCode))
    && (!opts.merchantId || routeMerchant(store, injectionDefault) === opts.merchantId));
  const scopedStores = catalogUnavailable ? [] : permittedStores.filter(({ locationCode }) => !disabled.has(locationCode));
  const scopedLocations = [...viewerScope].filter((code) => !disabled.has(code));
  const kitchens = new Set(opts.merchantId ? scopedStores.map(({ locationCode }) => locationCode) : catalogUnavailable ? [] : scopedLocations);
  const connected = new Set(connections.filter((connection) => connection.status !== 'pending' && !connection.needsReconnect).map(({ merchantId }) => merchantId));
  const relay = relayReadiness();
  const scopedRoutes = scoped ? scopedStores.filter((store) => {
    const readiness = getAdapter(store.channel).readiness();
    const mid = routeMerchant(store, injectionDefault);
    const cloverReady = Boolean(mid && (cloverTokenFor(mid) || connected.has(mid)));
    if (readiness.viaClover) return cloverReady;
    if (opts.merchantId && (!cloverInjectionEnabled() || !cloverReady)) return false;
    return isRelayStore(store) ? relay.webhookReady && relay.channels.includes(store.channel) : readiness.configured;
  }) : [];
  const live = CHANNEL_KEYS.filter((channel) => {
    if (scoped) return scopedRoutes.some((store) => store.channel === channel);
    const readiness = getAdapter(channel).readiness();
    // The unrestricted console summarizes the deployment. TGTG relay alone is its default, not an onboarded partner.
    return Boolean(readiness.viaClover) || (relay.channels.includes(channel) && channel !== 'tgtg')
      || (readiness.configured && stores.some((store) => store.channel === channel));
  });
  const names = live.map((k) => CHANNEL_LABELS[k]).join(', ');
  const usesDefault = scopedRoutes.some((store) => !store.cloverMerchantId && routeMerchant(store, injectionDefault));

  const withItems = menus.filter((menu) => menu.items.length > 0 && menu.posMerchantId
    && (!opts.merchantId || menu.posMerchantId === opts.merchantId)
    && (!viewerScope.size || scopedStores.some((store) => store.brandName === menu.brandName && routeMerchant(store, injectionDefault) === menu.posMerchantId)));
  const items = withItems.reduce((n, m) => n + m.items.length, 0);

  const enrolled = devices.filter((device) => !device.revoked && (!scoped || kitchens.has(device.locationCode)));
  const tablets = enrolled.length;
  const tabletKitchens = new Set(enrolled.map(({ locationCode }) => locationCode));
  const pinHolder = Boolean(opts.viewerHasPin) || users.some((user) => user.active && user.pinHash && (user.role === 'owner' || user.role === 'manager')
    && (!scoped || !user.locations?.length || user.locations.some((location) => tabletKitchens.has(location))));
  const scopeDisabled = viewerScope.size > 0 && !scopedLocations.length;
  const mappedDisabled = !catalogUnavailable && permittedStores.length > 0 && !scopedStores.length;
  const platformsDisabled = scoped && (scopeDisabled || mappedDisabled);
  const kitchenDisabled = scopeDisabled || Boolean(opts.merchantId && mappedDisabled);
  const unmapped = scoped && !catalogUnavailable && !platformsDisabled && !scopedStores.length;
  const unavailable = { fr: 'Catalogue des cuisines temporairement indisponible. Réessayez dans un moment.', en: 'The kitchen catalog is temporarily unavailable. Try again shortly.' };
  const disabledKitchens = { fr: 'Les cuisines associées sont désactivées. Vérifiez leur état dans Entreprise.', en: 'The linked kitchens are disabled. Review their status in Business.' };
  let platforms = { fr: 'Aucune plateforme ne peut encore envoyer de commandes.', en: 'No platform can send orders yet.' };
  if (catalogUnavailable) {
    platforms = unavailable;
  } else if (platformsDisabled) {
    platforms = disabledKitchens;
  } else if (unmapped) {
    platforms = { fr: 'Associez une plateforme à une cuisine autorisée dans Restaurants → Liaisons.', en: 'Link a platform to an authorized kitchen under Stores → Mapping.' };
  } else if (live.length && scoped) {
    platforms = { fr: `Plateformes configurées : ${names}.${usesDefault ? ' Une liaison utilise la caisse Clover par défaut.' : ''}`,
      en: `Configured platforms: ${names}.${usesDefault ? ' A mapping uses the default Clover register.' : ''}` };
  } else if (live.length) {
    platforms = { fr: `Branchée(s) : ${names}.`, en: `Connected: ${names}.` };
  } else if (scoped) {
    platforms = { fr: 'Aucune plateforme n’est prête à recevoir des commandes pour cette configuration.', en: 'No platform is ready to receive orders for this setup.' };
  }

  const kitchen = tablets && pinHolder
    ? { fr: `${tablets} tablette(s) inscrite(s), NIP en place.`, en: `${tablets} tablet(s) enrolled, PIN set.` }
    : tablets
      ? { fr: `${tablets} tablette(s) inscrite(s) ; ajoutez un NIP de gérant.`, en: `${tablets} tablet(s) enrolled; add a manager PIN.` }
      : { fr: 'Ouvrez Food Hub sur la tablette de la cuisine et inscrivez-la.', en: 'Open Food Hub on the kitchen tablet and enrol it.' };
  return [
    {
      key: 'platforms', done: live.length > 0, href: platformsDisabled ? '/settings/business' : unmapped ? '/stores/mapping' : '/settings/channels', detail: platforms,
    },
    {
      key: 'menu', done: withItems.length > 0, href: '/menu',
      detail: withItems.length
        ? { fr: `${items} article(s) importé(s) de Clover dans ${withItems.length} menu(s).`, en: `${items} item(s) imported from Clover into ${withItems.length} menu(s).` }
        : { fr: 'Menus → Importer de Clover, pour chaque marque.', en: 'Menus → Import from Clover, for each brand.' },
    },
    {
      key: 'kitchen', done: tablets > 0 && pinHolder,
      href: kitchenDisabled ? '/settings/business' : tablets ? '/settings/profile' : '/settings/devices',
      detail: catalogUnavailable ? unavailable : kitchenDisabled ? disabledKitchens : kitchen,
    },
  ];
}
