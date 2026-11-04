import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ view: {} as Record<string, unknown> }));
vi.mock('../lib/foodhub/storefront/checkout', () => ({ trackOrder: async () => h.view }));
vi.mock('../lib/foodhub/storefront/settings', () => ({ brandForSlug: async () => null, seedBrandOf: () => null }));
vi.mock('../app/commander/[slug]/suivi/[token]/refresh', () => ({ default: () => null }));
import TrackPage from '../app/commander/[slug]/suivi/[token]/page';

beforeEach(() => {
  h.view = { brand: 'Test restaurant', number: 'W-1001', status: 'awaiting_payment', readyAt: '2026-11-04T12:30:00Z',
    payUrl: '/p/private-pay-link', interac: { recipient: 'transfer@example.test', reference: 'TRANSFER-TEST', amount: 12.5, autoDeposit: true, expiresAt: '2026-11-04T13:00:00Z' } };
});
const render = async (lang: string) => renderToStaticMarkup(await TrackPage({ params: Promise.resolve({ slug: 'restaurant', token: 'test-track' }), searchParams: Promise.resolve({ lang }) }));

describe('tracking payment instructions', () => {
  it.each(['fr', 'en'])('hides all payment and preparation instructions during manual review (%s)', async (lang) => {
    h.view = { ...h.view, status: 'in_kitchen', paymentReview: true };
    const body = await render(lang);
    expect(body).toContain(lang === 'fr' ? 'Ne payez pas de nouveau' : 'Do not pay again');
    expect(body).not.toContain('/p/private-pay-link');
    expect(body).not.toContain('transfer@example.test');
    expect(body).not.toContain('<ol');
    expect(body).not.toMatch(/Prête vers|Ready around/);
  });
  it.each(['fr', 'en'])('shows paid but awaiting confirmation without another payment (%s)', async (lang) => {
    h.view.paymentReceived = true;
    const body = await render(lang);
    expect(body).toContain(lang === 'fr' ? 'Paiement reçu' : 'Payment received');
    expect(body).not.toContain('/p/private-pay-link');
    expect(body).not.toContain('transfer@example.test');
    expect(body).not.toContain('<ol');
    expect(body).not.toMatch(/Prête vers|Ready around/);
  });
  it('keeps an ordinary unpaid existing order resumable', async () => {
    const body = await render('en');
    expect(body).toContain('/p/private-pay-link');
    expect(body).toContain('transfer@example.test');
  });
});
