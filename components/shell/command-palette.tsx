'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { PlatformMark } from '@/components/ui/badge';
import { ALERTS, NAV, navVisible } from './nav';
import { useViewer } from './viewer';
import { api, money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type Hit = { key: string; label: string; sub?: string; href: string; channel?: string };

/** ⌘K / Ctrl+K: jump to any page or find an order by number, customer or Clover id. */
export function CommandPalette() {
  const { t, loc } = useI18n();
  const { can, allLocations, features } = useViewer();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState<Hit[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); } };
    const o = () => setOpen(true);
    window.addEventListener('keydown', k);
    window.addEventListener('takatak:palette', o);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('takatak:palette', o); };
  }, []);
  useEffect(() => { if (open) { setQ(''); setOrders([]); setI(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setOrders([]); return; }
    const h = setTimeout(() => {
      api<{ orders: Array<{ id: string; channel: string; displayId?: string; externalOrderId: string; brandName?: string; total: number; customerName?: string; status: string }> }>(`/api/foodhub/orders?q=${encodeURIComponent(q.trim())}&limit=8&since=${new Date(Date.now() - 30 * 86400_000).toISOString()}`)
        .then((d) => setOrders(d.orders.map((o) => ({ key: o.id, label: `#${o.displayId || o.externalOrderId.slice(0, 8)} · ${o.brandName ?? ''}`, sub: `${o.customerName ?? ''} · ${money(o.total, loc)}`, href: `/orders?open=${o.id}`, channel: o.channel }))))
        .catch(() => setOrders([]));
    }, 200);
    return () => clearTimeout(h);
  }, [q, open, loc]);

  const pages: Hit[] = useMemo(() => {
    const extra = [
      { href: '/settings/team', label: t('Équipe et NIP', 'Team & PINs'), perm: 'stores:map' },
      { href: '/settings/devices', label: t('Tablettes de cuisine', 'Kitchen tablets'), perm: 'stores:map' },
      { href: '/settings/security', label: t('Règles NIP gérant', 'Manager PIN rules'), perm: 'admin' },
      { href: '/settings/alerts', label: t('Règles d’alerte', 'Alert rules'), perm: 'view' },
      { href: '/settings/channels', label: t('Canaux et branchements', 'Channels & setup'), perm: 'stores:map' },
      { href: '/menu/86', label: t('Ruptures (86)', '86 board'), perm: 'items:toggle' },
      { href: '/stores/hours', label: t('Heures d’ouverture', 'Store hours'), perm: 'menu:edit' },
      { href: '/insights/reports', label: t('Rapports', 'Reports'), perm: 'analytics:view' },
      { href: '/money/disputes', label: t('Litiges', 'Disputes'), perm: 'analytics:view' },
    ];
    const groups = [...NAV, ALERTS].filter((n) => navVisible(n, can, allLocations, features));
    const kids = groups.flatMap((n) => (n.children ?? []).filter((c) => c.href !== n.href && navVisible(c, can, allLocations, features)).map((c) => ({ href: c.href, label: c.label(t) })));
    const seen = new Set<string>();
    const all = [...groups.map((n) => ({ href: n.href, label: n.label(t) })), ...kids, ...extra.filter((e) => can(e.perm))].filter((p) => !seen.has(p.href) && seen.add(p.href));
    const s = q.trim().toLowerCase();
    return all.filter((p) => !s || p.label.toLowerCase().includes(s)).map((p) => ({ key: p.href, label: p.label, href: p.href, sub: p.href }));
  }, [q, t, can, allLocations, features]);
  const hits = [...orders, ...pages];
  const go = (h?: Hit) => { if (!h) return; setOpen(false); router.push(h.href); };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-ink/40 p-4 pt-[12vh] animate-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-pop animate-rise">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 text-ink-3" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder={t('No de commande, client, page…', 'Order #, customer, page…')}
            onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } if (e.key === 'Enter') go(hits[i]); if (e.key === 'Escape') setOpen(false); }}
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-ink-4" />
        </div>
        <ul className="scrollbar-thin max-h-[50vh] overflow-y-auto p-1.5">
          {hits.map((h, k) => (
            <li key={h.key}>
              <button type="button" onMouseEnter={() => setI(k)} onClick={() => go(h)} className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left', k === i && 'bg-sunken')}>
                {h.channel ? <PlatformMark channel={h.channel} size="sm" /> : <span className="size-6" />}
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{h.label}</span>{h.sub && <span className="block truncate text-xs text-ink-3">{h.sub}</span>}</span>
                {k === i && <CornerDownLeft className="size-4 text-ink-3" />}
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-3">{t('Rien trouvé.', 'Nothing found.')}</li>}
        </ul>
      </div>
    </div>
  );
}
