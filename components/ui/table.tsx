import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/ui/cn';

/**
 * One table (premium rule 4): 44 px rows, 13 px header, numbers right-aligned in tabular figures, a header that stays
 * while the body scrolls. `cards` turns each row into a card under 768 px (give every `Td` a `label`), so a phone never
 * scrolls sideways. `framed` draws the card border around the table when it is not already inside a Card.
 */
export function Table({ children, className, cards, framed, stickyHead = true, dense }: { children: ReactNode; className?: string; cards?: boolean; framed?: boolean; stickyHead?: boolean; dense?: boolean }) {
  return (
    <div className={cn('scrollbar-thin overflow-x-auto', framed && 'rounded-md border border-line bg-surface shadow-card', className)}>
      <table className={cn('text-body w-full border-collapse', cards && 'table-cards', stickyHead && '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-[1]', dense && 'table-dense')}>{children}</table>
    </div>
  );
}
export function Th({ className, align, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'right' | 'center' }) {
  return <th scope="col" className={cn('text-small h-11 border-b border-line bg-raised px-4 text-left font-semibold whitespace-nowrap text-ink-3 first:rounded-tl-md last:rounded-tr-md', align === 'right' && 'num text-right', align === 'center' && 'text-center', className)} {...rest} />;
}
/** `label`: the column name shown on the phone card. `primary`: the row's title cell (left-aligned, bold, on the phone). */
export function Td({ className, align, label, primary, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'right' | 'center'; label?: string; primary?: boolean }) {
  return <td data-label={label} data-primary={primary || undefined} className={cn('h-11 border-b border-line px-4 py-2.5 align-middle text-ink [.table-dense_&]:h-9 [.table-dense_&]:py-1.5', align === 'right' && 'num text-right', align === 'center' && 'text-center', className)} {...rest} />;
}
export function Tr({ className, onClick, selected, ...rest }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return <tr onClick={onClick} aria-selected={selected || undefined} className={cn('transition-colors duration-(--duration-fast) hover:bg-raised/70', onClick && 'cursor-pointer', selected && 'bg-brand-soft/60 hover:bg-brand-soft/60', className)} {...rest} />;
}

/**
 * Accessible placeholder rows for tables awaiting server data (a table whose header is already on screen; for a whole
 * table still to come, `SkeletonTable` in card.tsx). Render inside <tbody>; the screen reader hears one loading
 * status, while decorative cells keep the table's column structure and A4's 44 px rows stable.
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
            <td key={col} className="h-11 border-b border-line px-4 py-2.5 align-middle">
              <span className="block h-3.5 rounded-md bg-sunken motion-safe:animate-pulse"
                style={{ width: `${55 + ((row + col * 3) % 4) * 12}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
