import { placeStorefrontOrder } from '@/lib/foodhub/storefront/checkout';
import { storefrontPost, storefrontPreflight } from '@/lib/foodhub/storefront/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const OPTIONS = storefrontPreflight;
export const POST = (req: Request) => storefrontPost(req, placeStorefrontOrder);
