import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChannelLine, EscalationLevels } from '@/components/live/alert-parts';
import { CollapsibleFilters } from '@/components/live/collapsible-filters';

const html = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(node);
type FilterProps = Omit<Parameters<typeof CollapsibleFilters>[0], 'children'>;
const filters = (p: FilterProps) => createElement(CollapsibleFilters, p as Parameters<typeof CollapsibleFilters>[0], createElement('div', null, 'FILTERS'));

describe('A1 parts: Alerts and order filters', () => {
  it('fills the escalation steps already taken, none once resolved', () => {
    const open = html(createElement(EscalationLevels, { level: 1 }));
    expect(open).toContain('aria-label="Escalade : étape 2 sur 4"');
    expect(open.match(/<li /g)).toHaveLength(4);
    expect(open.match(/bg-ink text-canvas/g)).toHaveLength(1);
    expect(open.match(/bg-stop-fill text-on-stop/g)).toHaveLength(1); // red step, text >= 4.5:1 in both themes
    expect(open).not.toMatch(/text-\[1[01]px\]/);
    const done = html(createElement(EscalationLevels, { level: 3, resolved: true }));
    expect(done).not.toContain('bg-stop-fill text-on-stop');
  });

  it('shows the alert channels as one status line with a link to their settings', () => {
    const line = html(createElement(ChannelLine, { channels: { sms: true, call: true, chat: false, email: true, ai: false } }));
    expect(line).toContain('Canaux d’alerte');
    expect(line).toContain('href="/settings/channels"');
    expect(line).toContain('Brancher les canaux');
    expect(line.match(/à brancher/g)).toHaveLength(2);
    // No pill borders: the channels are a status, not filters.
    expect(line).not.toContain('rounded-full border');
    const all = html(createElement(ChannelLine, { channels: { sms: true, call: true, chat: true, email: true, ai: true } }));
    expect(all).toContain('Réglages des canaux');
    expect(all).not.toContain('à brancher');
  });

  it('folds the filters behind one 44 px "Filtres" button on a phone, always shown from 768 px', () => {
    const closed = html(filters({ active: 2, lead: createElement('input', { 'aria-label': 'search' }) }));
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('h-11');
    expect(closed).toMatch(/class="hidden md:block"[^>]*>|<div id="[^"]+" class="hidden md:block">/);
    expect(closed).toContain('FILTERS');
    expect(closed).toContain('>2<');
    // The count is read as words ("2 actifs") by screen readers: an aria-label on a plain span is not announced.
    expect(closed).toMatch(/class="sr-only">, 2 (actifs|on)</);
    const open = html(filters({ defaultOpen: true }));
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('data-open="true"');
    expect(open).not.toMatch(/>\d<\/span>/);
  });
});
