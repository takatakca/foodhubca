import { brandHue, brandInitials } from '@/lib/foodhub/scope';
import { cn } from '@/lib/ui/cn';

// A brand's mark until its own logo is on file: two letters on a colour that stays the same everywhere.
// Colours avoid green, amber and red (those mean a status).
const HUES = ['#1565d8', '#5b4fe0', '#8b3fd9', '#0e7c86', '#0b84b8', '#475569', '#c2367a', '#7a5a3a'];

export function BrandMark({ name, size = 'md', className }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const dim = { xs: 'size-6 text-[10px] rounded-[6px]', sm: 'size-8 text-[11px] rounded-md', md: 'size-10 text-[13px] rounded-lg', lg: 'size-12 text-[15px] rounded-xl' }[size];
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center font-extrabold tracking-tight text-white', dim, className)} style={{ background: HUES[brandHue(name)] }}>
      {brandInitials(name)}
    </span>
  );
}
