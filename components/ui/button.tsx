'use client';

import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/ui/cn';

/**
 * One button set (premium rule 5). On a screen: one `primary` (ink) for the page's action; `brand` (blue) only to
 * publish or connect to a platform; `go` (green) only on Accepter / Prête; `danger` for a destructive confirm;
 * everything else `outline` or `ghost`. A disabled filled button turns to sunken grey with readable text (4.9:1),
 * never to a washed-out ink at 45 % (2.6:1).
 */
export type ButtonVariant = 'primary' | 'brand' | 'go' | 'danger' | 'outline' | 'ghost' | 'soft' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const FILLED_OFF = 'disabled:bg-sunken disabled:text-ink-3 disabled:shadow-none';
const VARIANT: Record<ButtonVariant, string> = {
  primary: cn('bg-ink text-canvas hover:bg-ink/90 shadow-card', FILLED_OFF),
  brand: cn('bg-brand text-white hover:bg-brand-2 shadow-card', FILLED_OFF),
  go: cn('bg-go text-white hover:bg-go-2 shadow-card', FILLED_OFF),
  danger: cn('bg-stop text-white hover:bg-stop-2 shadow-card', FILLED_OFF),
  outline: 'bg-surface text-ink border border-line-2 hover:bg-raised hover:border-ink-4 disabled:border-line disabled:text-ink-3 disabled:bg-surface',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink disabled:text-ink-4 disabled:bg-transparent',
  soft: 'bg-sunken text-ink hover:bg-line disabled:text-ink-3',
  link: 'text-ink underline-offset-4 hover:underline px-0 h-auto disabled:text-ink-3 disabled:no-underline',
};
/* Heights: 28 / 32 / 40 / 48 / 64. On a touch screen (pointer: coarse) every size is at least 44 px (touch-target). */
const SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-small gap-1 rounded-sm',
  sm: 'h-8 px-3 text-small gap-1.5 rounded-sm',
  md: 'h-10 px-4 text-body gap-2 rounded-md',
  lg: 'h-12 px-5 text-body gap-2 rounded-md',
  xl: 'h-16 px-7 text-heading gap-3 rounded-lg',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(
    'inline-flex items-center justify-center whitespace-nowrap font-semibold transition-colors duration-(--duration-fast) select-none active:translate-y-px disabled:active:translate-y-0 [&>svg]:size-4 [&>svg]:shrink-0',
    size !== 'xs' && size !== 'sm' && 'touch-target',
    VARIANT[variant], SIZE[size], extra,
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', onClick, ...rest }, ref) {
  // While loading the button keeps its colour (it is busy, not unavailable) and ignores clicks.
  return (
    <button ref={ref} type={type} className={cn(buttonClass(variant, size, className), loading && 'cursor-progress opacity-80')} disabled={disabled} aria-busy={loading || undefined} aria-disabled={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = 'outline', size = 'md', className, icon, children, ...rest }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }) {
  return <Link className={buttonClass(variant, size, className)} {...rest}>{icon}{children}</Link>;
}

/** A square icon-only button: 32 / 40 / 48 px, always with a text label for the screen reader and the tooltip. */
export function IconButton({ label, className, size = 'md', variant = 'ghost', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' | 'lg'; variant?: ButtonVariant }) {
  const dim = size === 'sm' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-10';
  return (
    <button type="button" aria-label={label} title={label} className={cn(buttonClass(variant, 'md'), 'px-0 [&>svg]:size-5', dim, className)} {...rest}>
      {children}
    </button>
  );
}
