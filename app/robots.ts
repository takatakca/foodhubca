import type { MetadataRoute } from 'next';
import { hubRobots } from '@/lib/foodhub/public-hub';

// robots.txt for foodhub.on2go.ca: only the API is blocked. The private pages (console, payment links, tickets…) stay
// crawlable so crawlers see their "X-Robots-Tag: noindex" (proxy.ts), and robots.txt never lists them.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return hubRobots();
}
