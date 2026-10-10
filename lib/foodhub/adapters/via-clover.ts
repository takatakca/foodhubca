// Platforms linked to Clover DIRECTLY (Clover → Online ordering → Partners), e.g. DoorDash through Clover's own
// DoorDash integration. Set FOODHUB_VIA_CLOVER=doordash (comma-separated for several).
// For those platforms Food Hub has no API of its own: their orders are read from Clover (read-only "via Clover",
// see pos/clover-platform-orders.ts), and every action that would need the platform's API is refused with a clear
// message — never shown as done — because it is done in Clover or in the platform's own portal.
import { CHANNEL_LABELS, result } from '../config';
import type { ChannelAdapter, ChannelKey } from '../types';

export function viaCloverChannels(): Set<ChannelKey> {
  const keys = String(process.env.FOODHUB_VIA_CLOVER || '').split(/[\s,;]+/).map((k) => k.trim().replace('-', '_')).filter(Boolean);
  return new Set(keys.filter((k): k is ChannelKey => ['uber_eats', 'doordash', 'skip', 'tgtg'].includes(k)));
}

export function isViaClover(channel: ChannelKey): boolean {
  return viaCloverChannels().has(channel);
}

export function viaCloverAdapter(base: ChannelAdapter): ChannelAdapter {
  const label = CHANNEL_LABELS[base.key];
  const refuse = (what: string, whatFr: string) => async () => result(base.key, 'blocked',
    `${label} is linked through Clover: ${what} in Clover or the ${label} portal (not sent by Food Hub). · ${label} est relié par Clover : ${whatFr} dans Clover ou le portail ${label} (rien n’est envoyé par Food Hub).`);
  return {
    ...base,
    readiness() {
      const r = base.readiness();
      return {
        ...r,
        configured: true,
        canSend: false,
        viaClover: true,
        missing: [],
        note: `Linked through Clover: ${label} orders arrive in Clover by Clover's own integration and Food Hub reads them (read-only "via Clover"). Menu, prices, sold-out items and pauses for ${label} are done in Clover / the ${label} portal.`,
        noteFr: `Relié par Clover : les commandes ${label} arrivent dans Clover par l’intégration de Clover et Food Hub les lit (en lecture seule, « via Clover »). Menu, prix, ruptures et pauses ${label} se font dans Clover / le portail ${label}.`,
      };
    },
    acceptOrder: refuse('accept orders', 'acceptez les commandes'),
    denyOrder: refuse('reject orders', 'refusez les commandes'),
    markReady: refuse('mark orders ready', 'marquez les commandes prêtes'),
    cancelOrder: refuse('cancel orders', 'annulez les commandes'),
    publishMenu: refuse('the menu comes from Clover — edit it', 'le menu vient de Clover — modifiez-le'),
    setItemAvailability: refuse('mark items out of stock', 'mettez les articles en rupture'),
    setStoreOnline: refuse('pause or reopen the store', 'mettez en pause ou rouvrez le magasin'),
    // Picked-up notices to the platform belong to Food Hub's own connection: linked through Clover, nothing is sent.
    ...(base.completeOrder ? { completeOrder: async () => result(base.key, 'skipped', `${label} is linked through Clover: nothing sent to the platform.`) } : {}),
  };
}
