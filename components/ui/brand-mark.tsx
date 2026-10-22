import { brandHue, brandInitials } from '@/lib/foodhub/scope';
import { cn } from '@/lib/ui/cn';

// A brand's mark until its own logo is on file: two letters on a colour that stays the same everywhere.
// Colours avoid green, amber and red (those mean a status).
// As many as BRAND_HUES in lib/foodhub/scope.ts.
const HUES = ['#1565d8', '#5b4fe0', '#8b3fd9', '#0e7c86', '#0b84b8', '#475569', '#c2367a', '#7a5a3a', '#334e9e', '#a1477d'];

export function BrandMark({ name, size = 'md', className }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const initials = brandInitials(name);
  const long = initials.length > 2;
  // Letters never under 11 px (premium rule 1): three initials tighten their tracking instead of shrinking.
  const dim = { xs: 'size-6 text-micro rounded-[6px]', sm: long ? 'size-8 text-micro rounded-md' : 'size-8 text-small rounded-md', md: long ? 'size-10 text-small rounded-lg' : 'size-10 text-body rounded-lg', lg: 'size-12 text-body rounded-xl' }[size];
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center font-extrabold text-white', long ? 'tracking-tighter' : 'tracking-tight', dim, className)} style={{ background: HUES[brandHue(name)] }}>
      {initials}
    </span>
  );
}
