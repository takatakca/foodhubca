// The three set-up steps of the Clover welcome wizard (/welcome/clover), computed from the real configuration — a step
// is "done" only when Food Hub can see it working, never because someone clicked a box:
//   1. Platforms — at least one delivery platform can bring orders: its keys are in and a store is mapped to it, or it
//      is linked through Clover (FOODHUB_VIA_CLOVER), or it arrives on the Order Relay.
//   2. Menu — a master menu with items was imported from this Clover merchant.
//   3. Kitchen — a kitchen tablet is enrolled and someone who can unlock it (the viewer, or a manager) has a PIN.
import { CHANNEL_KEYS, getAdapter } from './adapters';
import { relayChannels } from './adapters/relay';
import { CHANNEL_LABELS } from './config';
import { listDevices } from './identity/devices';
import { getRepo } from './repo';
import type { ChannelKey } from './types';

export type OnboardingKey = 'platforms' | 'menu' | 'kitchen';
export interface OnboardingStep {
  key: OnboardingKey;
  done: boolean;
  detail: { fr: string; en: string };
  href: string;
}

export async function onboardingSteps(opts: { merchantId?: string | null; viewerHasPin?: boolean } = {}): Promise<OnboardingStep[]> {
  const repo = getRepo();
  const [stores, menus, devices, users] = await Promise.all([
    repo.listStores().catch(() => []),
    repo.listMenus().catch(() => []),
    listDevices().catch(() => []),
    repo.listUsers().catch(() => []),
  ]);

  const relay = new Set(relayChannels());
  const live: ChannelKey[] = CHANNEL_KEYS.filter((k) => {
    const r = getAdapter(k).readiness();
    // TGTG is on the relay by default (no partner may be sending), so only a platform added on purpose counts there.
    return Boolean(r.viaClover) || (relay.has(k) && k !== 'tgtg') || (r.configured && stores.some((s) => s.channel === k));
  });
  const names = live.map((k) => CHANNEL_LABELS[k]).join(', ');

  const withItems = menus.filter((m) => m.items.length > 0 && m.posMerchantId && (!opts.merchantId || m.posMerchantId === opts.merchantId));
  const items = withItems.reduce((n, m) => n + m.items.length, 0);

  const tablets = devices.filter((d) => !d.revoked).length;
  const pinHolder = Boolean(opts.viewerHasPin) || users.some((u) => u.active && u.pinHash && (u.role === 'owner' || u.role === 'manager'));

  return [
    {
      key: 'platforms', done: live.length > 0, href: '/settings/channels',
      detail: live.length
        ? { fr: `Branchée(s) : ${names}.`, en: `Connected: ${names}.` }
        : { fr: 'Aucune plateforme ne peut encore envoyer de commandes.', en: 'No platform can send orders yet.' },
    },
    {
      key: 'menu', done: withItems.length > 0, href: '/menu',
      detail: withItems.length
        ? { fr: `${items} article(s) importé(s) de Clover dans ${withItems.length} menu(s).`, en: `${items} item(s) imported from Clover into ${withItems.length} menu(s).` }
        : { fr: 'Menus → Importer de Clover, pour chaque marque.', en: 'Menus → Import from Clover, for each brand.' },
    },
    {
      key: 'kitchen', done: tablets > 0 && pinHolder, href: tablets ? '/settings/profile' : '/settings/devices',
      detail: tablets && pinHolder
        ? { fr: `${tablets} tablette(s) inscrite(s), NIP en place.`, en: `${tablets} tablet(s) enrolled, PIN set.` }
        : tablets
          ? { fr: `${tablets} tablette(s) inscrite(s) ; ajoutez un NIP de gérant.`, en: `${tablets} tablet(s) enrolled; add a manager PIN.` }
          : { fr: 'Ouvrez Food Hub sur la tablette de la cuisine et inscrivez-la.', en: 'Open Food Hub on the kitchen tablet and enrol it.' },
    },
  ];
}
