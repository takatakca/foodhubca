import './globals.css';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { basicOwner, can, SESSION_COOKIE, verifySession, type Permission } from '@/lib/foodhub/session';
import AppShell from './app-shell';
import UserMenu from './user-menu';

// [href, label, permission needed to see the link, only for users who see every location]
type NavLink = [string, string, Permission, boolean?];
const sections: Array<[string, NavLink[]]> = [
  ['Food Hub', [
    ['/', 'Command Center', 'view'],
    ['/foodhub', 'Order Board', 'view'],
    ['/foodhub/orders', 'Orders', 'view'],
    ['/foodhub/menu', 'Menu Manager', 'menu:edit'],
    ['/foodhub/availability', '86 Board', 'items:toggle'],
    ['/foodhub/hours', 'Store Hours', 'menu:edit'],
    ['/foodhub/stores', 'Stores', 'stores:toggle'],
    ['/foodhub/tgtg', 'TGTG Bags', 'orders:act'],
  ]],
  ['Insights', [
    ['/foodhub/analytics', 'Analytics', 'analytics:view'],
    ['/foodhub/reports', 'Reports', 'analytics:view'],
    ['/foodhub/activity', 'Activity Log', 'analytics:view'],
  ]],
  ['Payouts & Money', [
    ['/finance', 'Where Is My Money', 'analytics:view', true],
    ['/finance/reconciliation', 'Orders vs Payouts', 'analytics:view', true],
    ['/finance/disputes', 'Disputes', 'analytics:view', true],
    ['/finance/payouts', 'Payouts & Deposits', 'analytics:view', true],
    ['/finance/ledger', 'Internal Ledger', 'analytics:view', true],
    ['/finance/imports', 'Statements', 'analytics:view', true],
    ['/finance/fees', 'Commission Plans', 'analytics:view', true],
  ]],
  ['Setup', [
    ['/foodhub/channels', 'Channels & Setup', 'stores:map'],
    ['/foodhub/business', 'Brands & Locations', 'admin'],
    ['/foodhub/users', 'Users & Roles', 'admin'],
    ['/go-live', 'Go-Live Checklist', 'stores:map'],
  ]],
  ['Control Tower', [
    ['/fix-tasks', 'Fix Tasks', 'analytics:view'],
    ['/store-health', 'Store Health', 'analytics:view'],
    ['/service-check', '3-Service Check', 'analytics:view'],
    ['/verification', 'AI Verification', 'analytics:view'],
    ['/qa', 'QA', 'admin'],
  ]],
];

async function currentUser(): Promise<{ name: string; role: 'owner' | 'manager' | 'operator' | 'menu' | 'analyst'; scoped?: boolean } | null> {
  // Read the request first: this keeps every page per-request (the menu depends on who is signed in).
  const h = await headers();
  const jar = await cookies();
  if (!process.env.DASHBOARD_PASSWORD && !process.env.SESSION_SECRET) return { name: 'Owner (no password set)', role: 'owner' };
  if (basicOwner(h.get('authorization'))) return { name: 'Owner', role: 'owner' };
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  return session ? { name: session.n, role: session.r, scoped: (session.l ?? []).length > 0 } : null;
}

export const viewport = { themeColor: '#101828' };

export const metadata = {
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'TAKATAK', statusBarStyle: 'black-translucent' as const },
  title: 'TAKATAK Food Hub',
  description: 'TAKATAK Food Hub — your own direct connection to Uber Eats, DoorDash, SkipTheDishes, Too Good To Go and Clover, on one screen.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <AppShell />
        <div className="shell">
          <aside className="sidebar">
            <h1>TAKATAK <br />Food Hub</h1>
            <nav>
              {sections.map(([title, links]) => {
                const visible = links.filter(([, , perm, allLocations]) => !user || (can(user.role, perm) && !(allLocations && user.scoped)));
                if (!visible.length) return null;
                return (
                  <div key={title} style={{ display: 'contents' }}>
                    <div className="nav-section">{title}</div>
                    {visible.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
                  </div>
                );
              })}
            </nav>
            {user && <UserMenu name={user.name} role={user.role} />}
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
