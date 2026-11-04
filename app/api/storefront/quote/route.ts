import { storefrontPost, storefrontPreflight } from '@/lib/foodhub/storefront/http';
import { quoteStorefrontCart } from '@/lib/foodhub/storefront/quote';

export const dynamic = 'force-dynamic';
export const OPTIONS = storefrontPreflight;
export const POST = (req: Request) => storefrontPost(req, (body) => quoteStorefrontCart(body), 'quote');
