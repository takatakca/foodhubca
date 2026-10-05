import '@fontsource-variable/manrope';
import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { I18nProvider } from '@/lib/i18n/client';
import { getLang } from '@/lib/i18n/server';

export const viewport: Viewport = { themeColor: '#121211', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export const metadata: Metadata = {
  title: 'TAKATAK',
  description: 'TAKATAK Food Hub — Uber Eats, DoorDash, SkipTheDishes, Too Good To Go et Clover sur un seul écran.',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'TAKATAK', statusBarStyle: 'black-translucent' },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang === 'fr' ? 'fr-CA' : 'en-CA'}>
      <body>
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
