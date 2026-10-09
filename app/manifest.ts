import type { MetadataRoute } from 'next';
import { productInfo } from '@/lib/foodhub/product';

// The product name (FOODHUB_PRODUCT_NAME) is read at request time, not frozen in the build.
export const dynamic = 'force-dynamic';

// Installable app (Add to Home Screen on iPad / Android): opens straight on the kitchen screen.
export default function manifest(): MetadataRoute.Manifest {
  const p = productInfo();
  return {
    name: p.shortName,
    short_name: p.shortName,
    description: 'Commandes Uber Eats, DoorDash, SkipTheDishes, Too Good To Go et Clover sur un seul écran.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#060D1F',
    theme_color: '#060D1F',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
