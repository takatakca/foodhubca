import { cn } from '@/lib/ui/cn';

/**
 * GROUPE TAKATAK mark (BRAND.md), as the console's sidebar draws it: a white T in a glowing electric-blue circle.
 * Used on the public pages Clover reviewers open (welcome, legal), so they match the console. Replace with the
 * official logo files (knowledgeAI/brand/) once the owner uploads them.
 */
export function TakatakMark({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  return (
    <span aria-hidden className={cn(
      'flex shrink-0 items-center justify-center rounded-full bg-electric font-black text-white shadow-[0_0_18px_rgb(31_139_255/0.55)]',
      size === 'sm' ? 'size-8 text-[14px]' : 'size-10 text-[17px]',
      className,
    )}>T</span>
  );
}
