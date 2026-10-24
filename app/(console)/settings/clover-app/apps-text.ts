// Settings → Clover app → « Applications Clover de ce serveur »: the words the owner reads for each app (premium A3).
// The setting names, the guide's path and the set-up command are for the technician: they go in `tech`, shown under
// « Détails techniques », never in the sentence or the badge.
import type { T } from '@/lib/i18n';

export type CloverAppSetup = { key: 'foodhub' | 'phone'; missing: string[]; env: { webhookAuth: string }; webhookAuthSet: boolean };

/** The app is not set up on this server: what the owner does, and what the technician sets. */
export function cloverAppSetupText(t: T, a: CloverAppSetup): { plain: string; tech: string } {
  if (a.key === 'phone') {
    return {
      plain: t('Créez l’application dans le tableau de bord Clover, puis demandez à votre technicien de poser ses clés sur le serveur. Sans elles, rien ne change.',
        'Create the app in the Clover dashboard, then ask your technician to put its keys on the server. Without them, nothing changes.'),
      tech: `${[...a.missing, a.env.webhookAuth].filter(Boolean).join(', ')} · docs/CLOVER_MULTI_APP.md`,
    };
  }
  return {
    plain: t('Les clés de l’application ne sont pas encore sur le serveur : votre technicien les pose.', 'The app keys are not on the server yet: your technician sets them.'),
    tech: `${a.missing.join(', ')} · npm run setup`,
  };
}

/** TAKATAK Phone per-minute billing: the server settings behind « Facturation à la minute » (for the technician). */
export function meteringTech(env: { enabled: string; meteredId: string; exempt: string }): string {
  return `${env.meteredId} · ${env.enabled}=true · ${env.exempt}`;
}

/** The webhook signing key: a word for the badge; the setting name only when it is missing (for the technician). */
export function webhookKeyBadge(t: T, a: CloverAppSetup): { ok: boolean; word: string; tech?: string } {
  return a.webhookAuthSet
    ? { ok: true, word: t('Clé du webhook en place', 'Webhook key set') }
    : { ok: false, word: t('Clé du webhook manquante', 'Webhook key missing'), tech: a.env.webhookAuth };
}
