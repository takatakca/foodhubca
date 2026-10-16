import type { MetadataRoute } from 'next';
import { hubRobots } from '@/lib/foodhub/public-hub';

// robots.txt for foodhub.on2go.ca: the public ON2GO Hub pages and the legal pages may be crawled; the console, its API,
// payment links, courier, kitchen, ticket, media and welcome pages may not. /login stays crawlable: it says noindex.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return hubRobots();
}
