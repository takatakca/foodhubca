import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TableSkeleton } from '../components/ui/table';
import { ListSkeleton } from '../components/ui/list-skeleton';

describe('accessible table placeholders', () => {
  it('renders one loading status and preserves the exact table column count', () => {
    const html = renderToStaticMarkup(createElement('table', null,
      createElement('tbody', null, createElement(TableSkeleton, { columns: 9, rows: 3, label: 'Chargement des relevés' })),
    ));
    expect(html.match(/<tr\b/g)).toHaveLength(4);
    expect(html.match(/<td\b/g)).toHaveLength(28);
    expect(html).toContain('colSpan="9"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Chargement des relevés');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
    expect(html).toContain('motion-safe:animate-pulse');
  });

  it('bounds malformed column and row counts', () => {
    const html = renderToStaticMarkup(createElement('table', null,
      createElement('tbody', null, createElement(TableSkeleton, { columns: 0, rows: 100 })),
    ));
    expect(html.match(/<tr\b/g)).toHaveLength(13);
    expect(html).toContain('colSpan="1"');
  });

  it('renders list/card placeholders with no fictitious data', () => {
    const html = renderToStaticMarkup(createElement(ListSkeleton, { rows: 2, label: 'Loading staff' }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading staff');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
  });
});
