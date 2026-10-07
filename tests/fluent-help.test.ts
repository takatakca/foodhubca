// Fluent console: TakTak's help content and the display settings.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HINTS, PAGES, hintFor, pageHelpFor, type L } from '../lib/help/content';
import { defaultDisplay, nextTextSize, parseDisplay } from '../lib/ui/display';

const both = (l: L) => l[0].trim().length > 0 && l[1].trim().length > 0;
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

describe('help content', () => {
  it('every hint and page guide is written in French and English, short enough for a tablet card', () => {
    for (const [id, h] of Object.entries(HINTS)) {
      expect(both(h.title), id).toBe(true);
      expect(both(h.body), id).toBe(true);
      expect(Math.max(h.body[0].length, h.body[1].length), id).toBeLessThanOrEqual(280);
    }
    for (const p of PAGES) {
      expect(both(p.title) && both(p.intro), p.match).toBe(true);
      for (const s of p.steps) expect(both(s.title) && both(s.body), `${p.match} step`).toBe(true);
      for (const tip of p.tips ?? []) expect(both(tip), `${p.match} tip`).toBe(true);
    }
  });

  it('every data-help id used in the console has an entry, and every tour target exists in the source', () => {
    const files = [...walk(path.join(process.cwd(), 'app')), ...walk(path.join(process.cwd(), 'components'))];
    const used = new Set<string>();
    for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:data-help|Hint id)=["{]+"?([a-z0-9.]+)"/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(5);
    for (const id of used) expect(hintFor(id), `data-help="${id}" has no entry in lib/help/content.ts`).not.toBeNull();
    for (const p of PAGES) for (const s of p.steps) if (s.target) expect(used.has(s.target), `${p.match} tour target ${s.target} is not on any screen`).toBe(true);
  });

  it('picks the most specific page guide; prototype-named ids are not hints', () => {
    expect(pageHelpFor('/stores/hours').match).toBe('/stores/hours');
    expect(pageHelpFor('/stores').match).toBe('/stores');
    expect(pageHelpFor('/orders/abc-123').match).toBe('/orders');
    expect(pageHelpFor('/settings/team').match).toBe('/settings/team');
    expect(pageHelpFor('/settings/channels').match).toBe('/settings');
    expect(pageHelpFor('/money/fees').match).toBe('/money/fees');
    expect(pageHelpFor('/money/statements').match).toBe('/money');
    expect(pageHelpFor('/insights/reports').match).toBe('/insights/reports');
    expect(pageHelpFor('/').match).toBe('/');
    expect(pageHelpFor('/unknown-page').match).toBe('/');
    expect(hintFor('constructor')).toBeNull();
    expect(hintFor('__proto__')).toBeNull();
  });
});

describe('display settings of a screen', () => {
  it('touch screens start with bigger text and roomy controls; a mouse screen with normal text', () => {
    expect(defaultDisplay(true)).toMatchObject({ text: 'lg', density: 'comfortable', tips: 'full' });
    expect(defaultDisplay(false)).toMatchObject({ text: 'md', density: 'compact' });
  });
  it('keeps valid saved values and ignores anything else', () => {
    expect(parseDisplay(JSON.stringify({ text: 'xl', density: 'compact', tips: 'light', reduceMotion: true }), true)).toEqual({ text: 'xl', density: 'compact', tips: 'light', reduceMotion: true });
    expect(parseDisplay(JSON.stringify({ text: 'huge', density: 7 }), false)).toEqual(defaultDisplay(false));
    expect(parseDisplay('{not json', true)).toEqual(defaultDisplay(true));
    expect(parseDisplay(null, false)).toEqual(defaultDisplay(false));
  });
  it('the A button cycles A → A+ → A++ → A', () => {
    expect([nextTextSize('md'), nextTextSize('lg'), nextTextSize('xl')]).toEqual(['lg', 'xl', 'md']);
  });
});
