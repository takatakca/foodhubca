import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getHours } from '@/lib/foodhub/hours';
import { publicMenu } from '@/lib/foodhub/storefront/catalog';
import { cleanSrc } from '@/lib/foodhub/storefront/cart';
import { sfLang } from '@/lib/foodhub/storefront/i18n';
import { jsonLdScript, storefrontJsonLd, storefrontMetadata } from '@/lib/foodhub/storefront/seo';
import { brandForSlug } from '@/lib/foodhub/storefront/settings';
import OrderClient from './order-client';

export const dynamic = 'force-dynamic';

// The public ordering page of one brand: /commander/<slug> (French), ?lang=en (English), ?src=google|instagram|… for
// attribution, ?src=qr&table=12 from a table QR code. 404 while the switch or the brand is off.
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const lang = sfLang(one((await searchParams).lang));
  const menu = await publicMenu(slug);
  if (!menu) return { title: lang === 'fr' ? 'Page introuvable' : 'Page not found', robots: { index: false, follow: false } };
  return storefrontMetadata(menu, lang);
}

export default async function CommanderPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const lang = sfLang(one(sp.lang));
  const menu = await publicMenu(slug);
  if (!menu) notFound();
  const hit = await brandForSlug(slug);
  const table = String(one(sp.table) ?? '').match(/^\d{1,3}$/)?.[0];
  const src = cleanSrc(one(sp.src) === 'qr' && table ? `table-${table}` : one(sp.src));
  const ld = hit ? storefrontJsonLd(menu, { hours: await getHours(), brandName: hit.brandName, locationCode: hit.cfg.locationCode, lang }) : null;
  return (
    <>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />}
      <OrderClient menu={menu} lang={lang} src={src ?? null} />
    </>
  );
}
