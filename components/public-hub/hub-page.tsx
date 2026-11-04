import type { Lang } from '@/lib/foodhub/pricing';
import type { HubContext, HubPageKey } from '@/lib/foodhub/public-hub';
import { RestaurantLanding } from './restaurant-landing';
import { RestaurantDetails } from './restaurant-details';

/** Public restaurant pages are server-rendered and share one editorial identity. */
export function HubPage({ page, lang, ctx }: { page: HubPageKey; lang: Lang; ctx: HubContext }) {
  return page === 'landing'
    ? <RestaurantLanding lang={lang} ctx={ctx} />
    : <RestaurantDetails page={page} lang={lang} ctx={ctx} />;
}
