'use client';

import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/ui/cn';

export type ButtonVariant = 'primary' | 'brand' | 'go' | 'danger' | 'outline' | 'ghost' | 'soft' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-canvas hover:bg-ink/90 shadow-card',
  brand: 'bg-brand text-white hover:bg-brand-2 shadow-card',
  go: 'bg-go text-white hover:bg-go-2 shadow-card',
  danger: 'bg-stop text-white hover:bg-stop-2 shadow-card',
  outline: 'bg-surface text-ink border border-line-2 hover:bg-raised hover:border-ink-4',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  soft: 'bg-sunken text-ink hover:bg-line',
  link: 'text-ink underline-offset-4 hover:underline px-0 h-auto',
};
const SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1 rounded-sm',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-sm',
  md: 'h-10 px-4 text-sm gap-2 rounded-md',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-md',
  xl: 'h-16 px-7 text-lg gap-3 rounded-lg',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn('inline-flex items-center justify-center whitespace-nowrap font-semibold transition-colors select-none disabled:opacity-45 active:translate-y-px', VARIANT[variant], SIZE[size], extra);
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = 'outline', size = 'md', className, icon, children, ...rest }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }) {
  return <Link className={buttonClass(variant, size, className)} {...rest}>{icon}{children}</Link>;
}

export function IconButton({ label, className, size = 'md', variant = 'ghost', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' | 'lg'; variant?: ButtonVariant }) {
  const dim = size === 'sm' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-10';
  return (
    <button type="button" aria-label={label} title={label} className={cn(buttonClass(variant, 'md'), 'px-0', dim, className)} {...rest}>
      {children}
    </button>
  );
}
