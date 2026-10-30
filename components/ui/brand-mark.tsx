'use client';

import { useState } from 'react';
import { useBrandKit } from '@/components/shell/viewer';
import { brandVars, type BrandKit } from '@/lib/foodhub/brand-kit';
import { brandHue, brandInitials } from '@/lib/foodhub/scope';
import { cn } from '@/lib/ui/cn';

// A brand's mark: its own logo when one is on file (Business → Brands, docs/BRAND_KIT.md), else two letters on its
// own colour, else two letters on a colour that stays the same everywhere (the look before brand kits).
// Colours avoid green, amber and red (those mean a status).
// As many as BRAND_HUES in lib/foodhub/scope.ts.
const HUES = ['#1565d8', '#5b4fe0', '#8b3fd9', '#0e7c86', '#0b84b8', '#475569', '#c2367a', '#7a5a3a', '#334e9e', '#a1477d'];

/** `kit`: pass one to preview a kit that is not saved yet (the brand editor); left out = the brand's saved kit. */
export function BrandMark({ name, size = 'md', className, kit: kitProp }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string; kit?: BrandKit | null }) {
  const saved = useBrandKit(name);
  const kit = kitProp === undefined ? saved : kitProp;
  const [broken, setBroken] = useState<string | null>(null);
  const initials = brandInitials(name);
  const long = initials.length > 2;
  // Letters never under 11 px (premium rule 1): three initials tighten their tracking instead of shrinking.
  const dim = { xs: 'size-6 text-micro rounded-[6px]', sm: long ? 'size-8 text-micro rounded-md' : 'size-8 text-small rounded-md', md: long ? 'size-10 text-small rounded-lg' : 'size-10 text-body rounded-lg', lg: 'size-12 text-body rounded-xl' }[size];
  if (kit?.logo && broken !== kit.logo) {
    // A logo sits on white (logos are drawn for a light page), framed so it holds on the dark kitchen screen too.
    return (
      <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-line', dim, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a brand's own logo: an https address or a media library photo (validated on save) */}
        <img src={kit.logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-contain p-0.5" onError={() => setBroken(kit.logo ?? null)} />
      </span>
    );
  }
  const vars = brandVars(kit);
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center font-extrabold', vars ? 'bg-(--brand-accent) text-(--brand-on-accent)' : 'text-white', long ? 'tracking-tighter' : 'tracking-tight', dim, className)} style={vars ?? { background: HUES[brandHue(name)] }}>
      {initials}
    </span>
  );
}
