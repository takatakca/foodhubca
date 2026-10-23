import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The console's type scale (app/globals.css: text-display … text-micro) is a font-size family, not a colour: without
 * this, `cn('text-body', 'text-ink')` would keep only one of the two.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { 'font-size': [{ text: ['display', 'title', 'heading', 'body', 'small', 'micro'] }] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
