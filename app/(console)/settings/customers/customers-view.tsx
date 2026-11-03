'use client';

// Read-only screen: how many customer accounts the brand websites verified by text, the last 20 (phone masked), whether
// the verification can text at all, and the customer entries of the activity log. Nothing here edits a customer:
// customers manage their own account on the website (profile, addresses, favourites, delete).
import { useEffect, useState } from 'react';
import { Contact, MessageSquareText, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Banner, EmptyState, Skeleton, Stat } from '@/components/ui/card';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { Section, SettingsHead } from '../settings-ui';

interface View {
  count: { total: number; deleted: number };
  verify: { ok: boolean; provider: string; reason?: string };
  tenants: Array<{ slug: string; name: string }>;
  adapters: { loyalty: boolean; giftCards: boolean };
  recent: Array<{ id: string; phone: string; name: string | null; email: string | null; lang: 'fr' | 'en'; tenants: string[]; marketingConsent: boolean; addresses: number; favourites: number; createdAt: string; verifiedAt: string }>;
  activity: Array<{ at: string; action: string; status: string; summary: string; actor: string }>;
}

export default function CustomersView() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<View | null>(null);
  useEffect(() => { api<View>('/api/foodhub/customers/admin').then(setData).catch((e) => toast.error(e instanceof Error ? e.message : String(e))); }, [toast]);
  const when = (iso: string) => new Date(iso).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div>
      <SettingsHead title={t('Clients', 'Customers')}
        intro={t('Les comptes clients des sites des marques (pppmtl.com en premier). Un compte = un cellulaire vérifié par texto. Food Hub est le seul registre : le site ne garde aucune base de clients. Lecture seule ici ; le client gère son compte sur le site.', 'The customer accounts of the brand websites (pppmtl.com first). One account = one cell number verified by text. Food Hub is the only register: the website keeps no customer database. Read-only here; customers manage their account on the website.')} />
      {!data && <Skeleton className="h-64" />}
      {data && (
        <>
          {!data.verify.ok && <Banner tone="warn" className="mb-4">{t('La vérification par texto ne peut pas envoyer de code :', 'Phone verification cannot text a code:')} {data.verify.reason}</Banner>}
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Stat label={t('Comptes clients', 'Customer accounts')} value={data.count.total} note={data.count.deleted ? t(`${data.count.deleted} supprimé(s), anonymisé(s)`, `${data.count.deleted} deleted, anonymised`) : undefined} icon={<Contact className="size-4" />} tone="brand" />
            <Stat label={t('Codes par texto', 'Codes by text')} value={data.verify.provider} note={data.verify.ok ? t('prêt', 'ready') : t('pas prêt', 'not ready')} tone={data.verify.ok ? 'go' : 'stop'} icon={<MessageSquareText className="size-4" />} />
            <Stat label={t('Sites autorisés', 'Allowed websites')} value={data.tenants.map((x) => x.name).join(', ')} note="FOODHUB_CUSTOMER_TENANTS" icon={<ShieldCheck className="size-4" />} />
          </div>

          <Section title={t('Derniers comptes', 'Latest accounts')} subtitle={t('Les 20 plus récents. Numéro masqué ; aucun code, aucun jeton ici.', 'The 20 most recent. Number masked; no code and no token here.')}>
            {!data.recent.length ? <EmptyState title={t('Aucun compte encore', 'No account yet')} body={t('Le premier client qui vérifie son cellulaire sur le site apparaîtra ici.', 'The first customer who verifies their cell on the website will show here.')} /> : (
              <Table>
                <thead><tr><Th>{t('Cellulaire', 'Cell')}</Th><Th>{t('Nom', 'Name')}</Th><Th>{t('Langue', 'Language')}</Th><Th>{t('Sites', 'Websites')}</Th><Th align="right">{t('Adresses', 'Addresses')}</Th><Th align="right">{t('Favoris', 'Favourites')}</Th><Th>{t('Créé', 'Created')}</Th><Th>{t('Dernière vérification', 'Last verified')}</Th></tr></thead>
                <tbody>
                  {data.recent.map((c) => (
                    <Tr key={c.id}>
                      <Td className="font-mono text-[13px]">{c.phone}</Td>
                      <Td>{c.name ?? <span className="text-ink-3">—</span>}{c.marketingConsent && <Badge tone="go" className="ml-2">{t('infolettre', 'newsletter')}</Badge>}</Td>
                      <Td>{c.lang.toUpperCase()}</Td>
                      <Td>{c.tenants.join(', ')}</Td>
                      <Td align="right">{c.addresses}</Td>
                      <Td align="right">{c.favourites}</Td>
                      <Td className="whitespace-nowrap text-[13px] text-ink-3">{when(c.createdAt)}</Td>
                      <Td className="whitespace-nowrap text-[13px] text-ink-3">{when(c.verifiedAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>

          <Section title={t('Journal', 'Log')} subtitle={t('Comptes créés, vérifiés, supprimés (aussi sous Rapports → Journal, filtre « Clients »).', 'Accounts created, verified, deleted (also under Reports → Log, filter "Customers").')}>
            {!data.activity.length ? <p className="text-[13px] text-ink-3">{t('Rien encore.', 'Nothing yet.')}</p> : (
              <ul className="divide-y divide-line">
                {data.activity.map((a, i) => (
                  <li key={`${a.at}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-[13px]">
                    <span className="whitespace-nowrap text-ink-3">{when(a.at)}</span>
                    <Badge tone={a.action === 'customer_deleted' ? 'stop' : a.action === 'customer_created' ? 'go' : 'info'}>{a.action.replace('customer_', '')}</Badge>
                    <span className="min-w-0 flex-1">{a.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t('Fidélité et cartes-cadeaux', 'Loyalty and gift cards')} subtitle={t('LOY4LTY et REW4RDS ne sont pas encore branchés : le site affiche « pas encore » plutôt qu’un faux zéro. La clé sera le cellulaire vérifié.', 'LOY4LTY and REW4RDS are not connected yet: the website shows "not yet" rather than a fake zero. The key will be the verified cell number.')}>
            <div className="flex flex-wrap gap-2">
              <Badge tone={data.adapters.loyalty ? 'wait' : 'neutral'}>LOY4LTY · {data.adapters.loyalty ? t('adresse définie, adaptateur à venir', 'URL set, adapter to come') : t('pas branché', 'not connected')}</Badge>
              <Badge tone={data.adapters.giftCards ? 'wait' : 'neutral'}>REW4RDS · {data.adapters.giftCards ? t('adresse définie, adaptateur à venir', 'URL set, adapter to come') : t('pas branché', 'not connected')}</Badge>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
