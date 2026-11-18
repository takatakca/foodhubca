import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KitchenLock } from '../app/kitchen/lock/lock-view';

// The kitchen lock screen's clock is the tablet's: the server renders a placeholder (its time zone and second differ
// from the tablet's, which made React hydration error #418 on every load, found by the 2026-11-18 diagnostic crawl).
describe('kitchen lock clock (app/kitchen/lock/lock-view.tsx)', () => {
  it('renders a placeholder on the server, never the server time', () => {
    const html = renderToString(createElement(KitchenLock, { next: '/kitchen' }));
    expect(html).toContain('--:--');
    expect(html).not.toMatch(/\b\d{1,2}[:h ]\d{2}\b(?! *\$)/);
  });
});
