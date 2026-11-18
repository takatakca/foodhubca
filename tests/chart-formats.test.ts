import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compactMoney, fmtChange, fmtInt, fmtMoney, fmtPct } from '../components/charts/charts';

// The chart kit's numbers follow the console's language (one format per language, never mixed): the Reports pages in
// English showed "857,02 $" before. Narrow no-break spaces (U+202F) and no-break spaces (U+00A0) are normalised here.
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('chart formats (components/charts/charts.tsx)', () => {
  it('money: French "906,38 $", English "$906.38", no cents from 1 000 up', () => {
    expect(plain(fmtMoney(906.38, 'fr-CA'))).toBe('906,38 $');
    expect(fmtMoney(906.38, 'en-CA')).toBe('$906.38');
    expect(plain(fmtMoney(1906.38, 'fr-CA'))).toBe('1 906 $');
    expect(fmtMoney(1906.38, 'en-CA')).toBe('$1,906');
    expect(plain(fmtMoney(12.5))).toBe('12,50 $'); // the default stays French
  });
  it('compact money: "1,2 k$" in French (a comma, not "1.2"), "$1.2K" in English', () => {
    expect(plain(compactMoney(1234, 'fr-CA'))).toBe('1,2 k$');
    expect(compactMoney(1234, 'en-CA')).toBe('$1.2K');
    expect(plain(compactMoney(25_400, 'fr-CA'))).toBe('25 k$');
    expect(compactMoney(25_400, 'en-CA')).toBe('$25K');
    expect(plain(compactMoney(2_500_000, 'fr-CA'))).toBe('2,5 M$');
    expect(compactMoney(2_500_000, 'en-CA')).toBe('$2.5M');
    expect(plain(compactMoney(906.4, 'fr-CA'))).toBe('906 $');
    expect(compactMoney(906.4, 'en-CA')).toBe('$906');
    expect(compactMoney(-1234, 'en-CA')).toBe('−$1.2K');
  });
  it('percentages: "69,97 %" in French, "69.97%" in English, signed on demand', () => {
    expect(plain(fmtPct(69.97, 'fr-CA'))).toBe('69,97 %');
    expect(fmtPct(69.97, 'en-CA')).toBe('69.97%');
    expect(plain(fmtPct(-12.5, 'fr-CA', true))).toBe('−12,5 %');
    expect(fmtPct(12.5, 'en-CA', true)).toBe('+12.5%');
    expect(fmtPct(0, 'en-CA', true)).toBe('0%');
    // no raw "${n}%" left on the Reports pages: in French it printed "69.97%"
    for (const f of ['page', 'sales/page', 'customers/page']) {
      const src = readFileSync(`app/(console)/insights/${f}.tsx`, 'utf8');
      expect(src, f).not.toMatch(/\$\{[^}]+\} ?%[`'"]|\}%</);
    }
  });
  it('integers and changes follow the language too', () => {
    expect(plain(fmtInt(12345, 'fr-CA'))).toBe('12 345');
    expect(fmtInt(12345, 'en-CA')).toBe('12,345');
    expect(fmtChange(4.4, 'en-CA')).toBe('+4.4%');
    expect(plain(fmtChange(4.4, 'fr-CA'))).toBe('+4,4 %');
  });
  it('the Reports and Money pages pass the console language to every money, integer and compact formatter', () => {
    const pages = ['insights/page', 'insights/sales/page', 'insights/customers/page', 'insights/operations/page',
      'money/page', 'money/disputes/page', 'money/payouts/page', 'money/tgtg/page'];
    for (const f of pages) {
      const src = readFileSync(`app/(console)/${f}.tsx`, 'utf8');
      const calls = [...src.matchAll(/\b(fmtMoney|fmtInt|compactMoney)\(([^()]|\([^()]*\))*\)/g)].map((m) => m[0]);
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, `${f}: ${c}`).toMatch(/,\s*loc\)$/);
      // a formatter handed to a chart as a value (format={fmtMoney}) would format in French whatever the language
      expect(src, f).not.toMatch(/[=?:]\s*\{?\s*(fmtMoney|fmtInt|compactMoney)\s*[}:]/);
    }
  });
});
