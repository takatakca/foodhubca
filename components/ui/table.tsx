import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/ui/cn';

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('scrollbar-thin overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ className, align, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'right' | 'center' }) {
  return <th className={cn('h-9 border-b border-line bg-raised px-3 text-left text-xs font-semibold whitespace-nowrap text-ink-3', align === 'right' && 'text-right', align === 'center' && 'text-center', className)} {...rest} />;
}
export function Td({ className, align, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'right' | 'center' }) {
  return <td className={cn('border-b border-line px-3 py-2.5 align-middle text-ink', align === 'right' && 'num text-right', align === 'center' && 'text-center', className)} {...rest} />;
}
export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-raised/70', className)} {...rest} />;
}

/**
 * Accessible placeholder rows for tables awaiting server data.
 * Render inside <tbody>; the screen reader hears one loading status,
 * while decorative cells keep the table's column structure stable.
 */
export function TableSkeleton({ columns, rows = 4, label = 'Chargement… / Loading…' }: {
  columns: number;
  rows?: number;
  label?: string;
}) {
  const n = Number.isFinite(columns) ? Math.max(1, Math.min(20, Math.trunc(columns))) : 1;
  const count = Number.isFinite(rows) ? Math.max(1, Math.min(12, Math.trunc(rows))) : 4;
  return (
    <>
      <tr><td colSpan={n} className="p-0"><span className="sr-only" role="status">{label}</span></td></tr>
      {Array.from({ length: count }, (_, row) => (
        <tr key={row} aria-hidden="true" className="pointer-events-none">
          {Array.from({ length: n }, (_, col) => (
            <td key={col} className="border-b border-line px-3 py-4">
              <span className="block h-3.5 rounded-md bg-sunken motion-safe:animate-pulse"
                style={{ width: `${55 + ((row + col * 3) % 4) * 12}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
