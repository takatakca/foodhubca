// Expansion features (own-courier delivery, grocery / retail, alcohol, AI phone ordering) — each behind its own switch.
//
// Every switch is OFF until the owner turns it on in Settings → Expansion (stored in fh_kv, logged). The host can force
// a feature either way with FOODHUB_FEATURE_<KEY>=on|off (e.g. FOODHUB_FEATURE_PHONE=off to keep the phone agent
// silent on one server); the environment always wins over the stored switch.
// A switch only makes the feature visible and usable inside Food Hub. Anything that reaches a platform still needs that
// platform's own credentials and, in production, LIVE_CONNECTORS_GLOBAL_ENABLED=true (see each feature's readiness).
import { logActivity, type Actor } from '../activity';
import { UserError } from '../auth';
import { getRepo } from '../repo';

export const FEATURE_KEYS = ['delivery', 'retail', 'alcohol', 'phone'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, { fr: string; en: string; dfr: string; den: string }> = {
  delivery: {
    fr: 'Livraison par nos coursiers', en: 'Own-order delivery',
    dfr: 'Vos commandes (téléphone, Clover, site web) livrées par DoorDash Drive, avec Uber Direct en comparaison.',
    den: 'Your own orders (phone, Clover, website) delivered by DoorDash Drive, with Uber Direct as a comparison quote.',
  },
  retail: {
    fr: 'Épicerie et produits', en: 'Grocery & retail',
    dfr: 'Catalogue de produits avec code-barres, unités, poids et inventaire, partagé avec Clover.',
    den: 'Product catalogue with barcodes, units, weights and stock, shared with Clover.',
  },
  alcohol: {
    fr: 'Alcool', en: 'Alcohol',
    dfr: 'Permis RACJ par succursale, heures légales, preuve d’âge à la livraison. Bloqué partout sans permis.',
    den: 'RACJ permit per location, legal hours, age check at delivery. Blocked everywhere without a permit.',
  },
  phone: {
    fr: 'Commandes par téléphone (IA)', en: 'AI phone ordering',
    dfr: 'Un agent IA répond, prend la commande dans le menu, confirme le total et l’envoie à Clover. Passe à un humain sur demande.',
    den: 'An AI agent answers, takes the order from the menu, confirms the total and sends it to Clover. Hands off to a person on request.',
  },
};

const KV = 'expansion_features_v1';
type Stored = Partial<Record<FeatureKey, { on: boolean; by?: string; at?: string }>>;

export interface FeatureState {
  key: FeatureKey;
  on: boolean;
  /** Where the value comes from: the host environment wins over the owner's switch. */
  source: 'env' | 'switch' | 'default';
  by?: string;
  at?: string;
}

function envOverride(key: FeatureKey): boolean | null {
  const v = String(process.env[`FOODHUB_FEATURE_${key.toUpperCase()}`] ?? '').trim().toLowerCase();
  if (['on', 'true', '1', 'yes'].includes(v)) return true;
  if (['off', 'false', '0', 'no'].includes(v)) return false;
  return null;
}

export async function getFeatures(): Promise<Record<FeatureKey, FeatureState>> {
  const stored = (await getRepo().getKv<Stored>(KV).catch(() => null)) ?? {};
  const out = {} as Record<FeatureKey, FeatureState>;
  for (const key of FEATURE_KEYS) {
    const env = envOverride(key);
    const s = stored[key];
    out[key] = env !== null
      ? { key, on: env, source: 'env' }
      : s ? { key, on: Boolean(s.on), source: 'switch', by: s.by, at: s.at } : { key, on: false, source: 'default' };
  }
  return out;
}

export async function featureOn(key: FeatureKey): Promise<boolean> {
  return (await getFeatures())[key].on;
}

/** Owner switch. Refused when the host environment forces the value (the switch would do nothing). */
export async function setFeature(key: FeatureKey, on: boolean, actor: Actor): Promise<Record<FeatureKey, FeatureState>> {
  if (!FEATURE_KEYS.includes(key)) throw new Error(`Unknown feature: ${key}`);
  const env = envOverride(key);
  if (env !== null) throw new Error(`FOODHUB_FEATURE_${key.toUpperCase()} is set on the server — change it there.`);
  const repo = getRepo();
  const stored = (await repo.getKv<Stored>(KV).catch(() => null)) ?? {};
  stored[key] = { on, by: actor.name, at: new Date().toISOString() };
  await repo.setKv(KV, stored);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: on ? 'feature_on' : 'feature_off', status: 'success',
    summary: `${FEATURE_LABELS[key].en} turned ${on ? 'ON' : 'OFF'}` });
  return getFeatures();
}

/** For route handlers: a clear refusal when the feature is off. */
export async function requireFeature(key: FeatureKey): Promise<void> {
  if (!(await featureOn(key))) throw new UserError(`${FEATURE_LABELS[key].en} is turned off — the owner turns it on in Settings → Expansion.`);
}
