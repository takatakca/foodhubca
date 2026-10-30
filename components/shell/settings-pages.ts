// The Settings pages, in groups (task 40). Plain data: the Settings hub, the Settings tabs, the menu search and the tests
// read it. `group`: business (your business), you (for you), addons (extra services), advanced (technician tools: shown
// in the full view only; every page still opens by its address).
import { BellRing, Blocks, Boxes, Building2, Contact, Handshake, MonitorSmartphone, PlugZap, Rocket, ShieldCheck, Store, Truck, UserRound, Users } from 'lucide-react';

export type SettingsGroup = 'business' | 'you' | 'addons' | 'advanced';

export const SETTINGS_GROUPS: Array<{ key: SettingsGroup; fr: string; en: string }> = [
  { key: 'business', fr: 'Votre entreprise', en: 'Your business' },
  { key: 'you', fr: 'Pour vous', en: 'For you' },
  { key: 'addons', fr: 'Services en plus', en: 'Add-ons' },
  { key: 'advanced', fr: 'Outils avancés', en: 'Advanced tools' },
];

export const SETTINGS_PAGES = [
  { href: '/settings/profile', group: 'you', icon: UserRound, perm: 'view', fr: 'Mon profil', en: 'My profile', dfr: 'Nom, courriel, cellulaire, langue, votre NIP et vos alertes.', den: 'Name, email, cell, language, your PIN and your alerts.' },
  { href: '/settings/team', group: 'business', icon: Users, perm: 'stores:map', fr: 'Équipe et NIP', en: 'Team & PINs', dfr: 'Qui a accès, à quelles succursales, avec quel rôle et quel NIP.', den: 'Who has access, to which locations, with which role and PIN.' },
  { href: '/settings/devices', group: 'business', icon: MonitorSmartphone, perm: 'view', fr: 'Tablettes', en: 'Tablets', dfr: 'Les écrans de cuisine : en ligne, son, batterie. Enregistrer ou retirer.', den: 'Kitchen screens: online, sound, battery. Enrol or remove.' },
  { href: '/settings/security', group: 'you', icon: ShieldCheck, perm: 'view', fr: 'NIP gérant', en: 'Manager PIN', dfr: 'Quelles actions demandent le NIP d’un gérant : refuser, annuler, rembourser, fermer…', den: 'Which actions need a manager PIN: reject, cancel, refund, pause…' },
  { href: '/settings/alerts', group: 'you', icon: BellRing, perm: 'view', fr: 'Alertes', en: 'Alerts', dfr: 'Quand vous texter ou vous appeler. Heures calmes, qui prévenir en premier.', den: 'When to text or call you. Quiet hours, who to tell first.' },
  { href: '/settings/channels', group: 'advanced', icon: PlugZap, perm: 'stores:map', fr: 'Plateformes et Clover', en: 'Platforms & Clover', dfr: 'Adresses webhook, secrets à donner aux plateformes, état des branchements.', den: 'Webhook URLs, secrets to give the platforms, connection status.' },
  { href: '/settings/doordash', group: 'advanced', icon: Truck, perm: 'stores:map', fr: 'DoorDash (API)', en: 'DoorDash (API)', dfr: 'Toutes les API DoorDash : lectures en direct, épuisés, heures, rapports, épicerie, Drive, publicité.', den: 'Every DoorDash API: live reads, sold out, hours, reports, retail, Drive, ads.' },
  { href: '/settings/business', group: 'business', icon: Building2, perm: 'view', fr: 'Entreprise', en: 'Business', dfr: 'Vos succursales et vos marques.', den: 'Your locations and your brands.' },
  { href: '/settings/customers', group: 'addons', icon: Contact, perm: 'analytics:view', fr: 'Clients', en: 'Customers', dfr: 'Les comptes clients des sites des marques, vérifiés par texto : nombre, derniers inscrits, journal.', den: 'The brand websites’ customer accounts, verified by text: count, latest, log.' },
  { href: '/settings/leads', group: 'business', icon: Handshake, perm: 'admin', fr: 'Demandes de restaurants', en: 'Restaurant leads', dfr: 'Les restaurants qui veulent rejoindre ON2GO (formulaire on2go.ca) : statut et notes.', den: 'Restaurants asking to join ON2GO (on2go.ca form): status and notes.' },
  { href: '/settings/clover-app', group: 'advanced', icon: Store, perm: 'admin', fr: 'App Clover', en: 'Clover app', dfr: 'Fiche App Market : textes, adresses à copier, soumission, marchands en attente.', den: 'App Market listing: texts, addresses to copy, submission, merchants waiting.' },
  { href: '/settings/expansion', group: 'addons', icon: Blocks, perm: 'view', fr: 'Services en plus', en: 'Add-ons', dfr: 'Livraison, téléphone, épicerie, alcool : interrupteurs et règles.', den: 'Delivery, phone, grocery, alcohol: switches and rules.' },
  { href: '/settings/suite', group: 'addons', icon: Boxes, perm: 'admin', fr: 'Apps connectées', en: 'Connected apps', dfr: 'Vos apps Clover (C4ISSE, LOY4LTY, TR4CKER…) : branchées ou non, commandes envoyées, échecs.', den: 'Your Clover apps (C4ISSE, LOY4LTY, TR4CKER…): connected or not, orders sent, failures.' },
  { href: '/settings/go-live', group: 'advanced', icon: Rocket, perm: 'admin', fr: 'Mise en service', en: 'Go-live', dfr: 'La liste de ce qui reste avant d’ouvrir les vannes.', den: 'What is left before switching everything on.' },
] as const satisfies ReadonlyArray<{ href: string; group: SettingsGroup; icon: unknown; perm: string; fr: string; en: string; dfr: string; den: string }>;

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

/** The Settings page an address belongs to (its own page or a sub-page), or null for the hub. */
export function settingsPageOf(path: string): SettingsPage | null {
  return SETTINGS_PAGES.find((p) => path === p.href || path.startsWith(`${p.href}/`)) ?? null;
}
