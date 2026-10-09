import type { MetadataRoute } from 'next';

// Installable app (Add to Home Screen on iPad / Android): opens straight on the kitchen screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TAKATAK',
    short_name: 'TAKATAK',
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
