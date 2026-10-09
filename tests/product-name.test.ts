// The product's name on screen (Food Hub → ON2GO Hub, docs/ON2GO_HUB_ECOSYSTEM.md § 1): unchanged by default, one
// server variable flips every console text, the Clover App Market listing name never follows it.
import { afterEach, describe, expect, it } from 'vitest';
import { translator } from '../lib/i18n/index';
import { CLOVER_APP_NAME, cleanProductName, DEFAULT_PRODUCT_NAME, productInfo, withProductName } from '../lib/foodhub/product';

const saved = process.env.FOODHUB_PRODUCT_NAME;
afterEach(() => { if (saved === undefined) delete process.env.FOODHUB_PRODUCT_NAME; else process.env.FOODHUB_PRODUCT_NAME = saved; });

describe('product name', () => {
  it('defaults to Food Hub: every text is exactly as before', () => {
    delete process.env.FOODHUB_PRODUCT_NAME;
    const p = productInfo();
    expect(p).toEqual({ name: 'Food Hub', fullName: 'TAKATAK Food Hub', shortName: 'TAKATAK', isDefault: true });
    const t = translator('fr', p);
    expect(t('Food Hub ne touche jamais à votre compte Clover', 'x')).toBe('Food Hub ne touche jamais à votre compte Clover');
    expect(translator('en')('a', 'Paid orders Food Hub never received')).toBe('Paid orders Food Hub never received');
  });

  it('reads FOODHUB_PRODUCT_NAME at call time and renames the console texts', () => {
    process.env.FOODHUB_PRODUCT_NAME = '  ON2GO   Hub ';
    const p = productInfo();
    expect(p).toEqual({ name: 'ON2GO Hub', fullName: 'ON2GO Hub', shortName: 'ON2GO Hub', isDefault: false });
    const fr = translator('fr', p);
    const en = translator('en', p);
    expect(fr('Payées mais absentes de Food Hub', 'Paid orders not in Food Hub')).toBe('Payées mais absentes de ON2GO Hub');
    expect(en('x', 'Every message is saved before Food Hub answers. Food Hub Order Relay.')).toBe('Every message is saved before ON2GO Hub answers. ON2GO Hub Order Relay.');
    expect(en('x', 'TAKATAK Food Hub added you')).toBe('ON2GO Hub added you');
    // Internal names are not screen names.
    expect(en('x', 'FOODHUB_RELAY_CALLBACK_URL')).toBe('FOODHUB_RELAY_CALLBACK_URL');
  });

  it('never renames the Clover App Market app', () => {
    const p = productInfo('ON2GO Hub');
    expect(withProductName('Application Clover « TAKATAK Food Hub »', p)).toBe(`Application Clover « ${CLOVER_APP_NAME} »`);
    expect(withProductName('Clover app “TAKATAK Food Hub” — Food Hub reads it', p)).toBe(`Clover app “${CLOVER_APP_NAME}” — ON2GO Hub reads it`);
  });

  it('refuses names that are empty, too long or look like markup', () => {
    expect(cleanProductName('')).toBe(DEFAULT_PRODUCT_NAME);
    expect(cleanProductName('x')).toBe(DEFAULT_PRODUCT_NAME);
    expect(cleanProductName('<script>')).toBe(DEFAULT_PRODUCT_NAME);
    expect(cleanProductName('A'.repeat(41))).toBe(DEFAULT_PRODUCT_NAME);
    expect(cleanProductName('ON2GO Hub')).toBe('ON2GO Hub');
    expect(productInfo('Food Hub').isDefault).toBe(true);
  });
});
