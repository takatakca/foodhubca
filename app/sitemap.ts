import type { MetadataRoute } from 'next';
import { hubSitemap } from '@/lib/foodhub/public-hub';

// sitemap.xml: the ON2GO.ca pages in French and English (with their language links) and the 3 legal pages.
// No lastModified: a made-up date would only teach crawlers to ignore it.
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  return hubSitemap();
}
