import '@fontsource-variable/manrope';
import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { I18nProvider } from '@/lib/i18n/client';
import { getLang } from '@/lib/i18n/server';
import { productInfo } from '@/lib/foodhub/product';
import { DISPLAY_BOOT_SCRIPT } from '@/lib/ui/display';

export const viewport: Viewport = { themeColor: '#121211', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

// Read at request time: the product name (FOODHUB_PRODUCT_NAME) can change without a rebuild.
export function generateMetadata(): Metadata {
  const p = productInfo();
  return {
    title: p.shortName,
    description: `${p.fullName} — Uber Eats, DoorDash, SkipTheDishes, Too Good To Go et Clover sur un seul écran.`,
    icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
    appleWebApp: { capable: true, title: p.shortName, statusBarStyle: 'black-translucent' },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang === 'fr' ? 'fr-CA' : 'en-CA'} suppressHydrationWarning>
      <head>
        {/* Text size / density of this screen, applied before the first paint (lib/ui/display.tsx). */}
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_BOOT_SCRIPT }} />
      </head>
      <body>
        <I18nProvider lang={lang} product={productInfo()}>{children}</I18nProvider>
      </body>
    </html>
  );
}
