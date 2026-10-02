import type { MetadataRoute } from 'next';

// Installable kitchen / office app (TAKATAK "Prime"): Add to Home Screen on an iPad or Android tablet.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TAKATAK Food Hub',
    short_name: 'TAKATAK',
    description: 'Uber Eats, DoorDash, SkipTheDishes, Too Good To Go and Clover on one screen.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#101828',
    theme_color: '#101828',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
