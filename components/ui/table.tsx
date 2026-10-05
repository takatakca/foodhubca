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
