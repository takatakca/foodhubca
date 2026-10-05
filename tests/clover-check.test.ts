// Clover check: tax rates entered 100× too small (0.14975 % instead of 14.975 %) are pointed out, never changed.
import { describe, expect, it } from 'vitest';
import { taxProblems } from '../lib/foodhub/pos/clover-labels';

describe('Clover tax rates check', () => {
  it('flags a Quebec rate entered as 0.14975 %', () => {
    const p = taxProblems([{ id: 'T1', name: 'Sales Tax', percent: 0.14975, isDefault: true }]);
    expect(p[0]).toMatch(/0\.14975%.*14\.975%/);
  });
  it('accepts GST + QST, combined or separate', () => {
    expect(taxProblems([{ id: 'T1', name: 'TPS+TVQ', percent: 14.975, isDefault: true }])).toEqual([]);
    expect(taxProblems([{ id: 'T1', name: 'TPS', percent: 5, isDefault: true }, { id: 'T2', name: 'TVQ', percent: 9.975, isDefault: true }])).toEqual([]);
  });
  it('flags a wrong total and a missing default', () => {
    expect(taxProblems([{ id: 'T1', name: 'TPS', percent: 5, isDefault: true }])[0]).toMatch(/add up to 5%/);
    expect(taxProblems([{ id: 'T1', name: 'TPS', percent: 5, isDefault: false }])[0]).toMatch(/No default tax rate/);
  });
});

describe('Clover tax rates check in French', async () => {
  const { taxProblemsFr } = await import('../lib/foodhub/pos/clover-labels');
  it('says it in French with French decimals', () => {
    expect(taxProblemsFr([{ id: 'T1', name: 'Sales Tax', percent: 0.14975, isDefault: true }])[0]).toBe('« Sales Tax » est à 0,14975 % — vouliez-vous 14,975 % ?');
  });
});
