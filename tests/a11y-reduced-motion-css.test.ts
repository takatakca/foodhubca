// Reduced motion and the new-order alarm (docs/ACCESSIBILITY.md, MASTER_PLAN Phase 3 guardrails). With less motion asked
// for (the system's prefers-reduced-motion, or the console's own "Moins d'animations" setting), every animation is cut
// to 1 ms × 1, except the alarm's ring. That exception must give back only the `ring` keyframes, and only from the `sm`
// width where `sm:animate-ring` shows the ring: on a phone the alert sheet's only animation is its entrance `rise`
// (moves and fades), which must never loop. The full in-browser proof is npm run verify:a11y (phone + desktop, both
// settings); this is the quick guard in npm test.
import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ALARM = "[data-motion='alarm']";

async function css() {
  return (await fs.readFile('app/globals.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('reduced motion: the new-order alarm exception (app/globals.css)', () => {
  it('gives back only the ring, and only from the sm width (40rem), for the system and the console setting', async () => {
    const sheet = await css();
    // Every rule whose selector names the alarm element.
    const rules = sheet.match(/[^{}]*\[data-motion='alarm'\][^{}]*\{[^}]*\}/g) ?? [];
    // Those that are the only rule of an @media block: `@media (…) { <selector> { … } }`.
    const scoped = [...sheet.matchAll(/@media([^{]*)\{\s*([^{}]*\[data-motion='alarm'\][^{}]*)\{([^}]*)\}\s*\}/g)];
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(scoped).toHaveLength(rules.length);
    for (const [, condition, , body] of scoped) {
      expect(condition).toContain('min-width: 40rem');
      expect(body).toMatch(/animation-name:\s*ring\s*!important/);
      expect(body).toMatch(/animation-iteration-count:\s*infinite\s*!important/);
    }
    // One for the system setting, one for the console's own setting (html[data-motion='reduce']).
    expect(scoped.some(([, condition, selector]) => condition.includes('prefers-reduced-motion: reduce') && selector.includes(ALARM))).toBe(true);
    expect(scoped.some(([, , selector]) => selector.includes(`html[data-motion='reduce'] ${ALARM}`))).toBe(true);
    // 40rem is Tailwind's `sm` breakpoint only while the theme leaves it alone.
    expect(sheet).not.toMatch(/--breakpoint-sm\s*:/);
  });

  it('the ring keyframes only animate a box-shadow (no movement, no fading)', async () => {
    const ring = (await css()).match(/@keyframes ring\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? '';
    expect(ring).toContain('box-shadow');
    expect(ring).not.toMatch(/transform|opacity|translate|scale/);
  });

  it('the alert dialog marks the alarm and rings only from sm, on a new order', async () => {
    const tsx = await fs.readFile('components/live/incoming.tsx', 'utf8');
    expect(tsx).toContain("data-motion={isNew ? 'alarm' : undefined}");
    expect(tsx).toContain("isNew && 'sm:animate-ring'");
  });
});
