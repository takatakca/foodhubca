import type { Lang } from '@/lib/foodhub/pricing';
import type { HubContext, HubPageKey } from '@/lib/foodhub/public-hub';
import { RestaurantLanding } from './restaurant-landing';
import { RestaurantDetails } from './restaurant-details';
import { RestaurantContact } from './restaurant-contact';

/** Public restaurant pages are server-rendered and share one editorial identity. */
export function HubPage({ page, lang, ctx, contactInterest }: { page: HubPageKey; lang: Lang; ctx: HubContext; contactInterest?: 'phone' }) {
  return page === 'landing'
    ? <RestaurantLanding lang={lang} ctx={ctx} />
    : page === 'contact' ? <RestaurantContact lang={lang} ctx={ctx} interest={contactInterest} />
    : <RestaurantDetails page={page} lang={lang} ctx={ctx} />;
}
