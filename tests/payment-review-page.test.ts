import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ state: 'review', lang: 'fr', found: true, opened: 0, checked: 0, lookupUnknown: false, openError: false }));
vi.mock('../lib/foodhub/delivery/paylink', () => ({
  orderForToken: async () => h.found ? ({ number: 'W-1001', brandName: 'Demo restaurant', customer: { name: 'Client Test' }, fulfillment: 'pickup', lines: [{ quantity: 1, name: 'Pita', total: 12 }], deliveryFee: 0, tip: 0, total: 13.8, paylink: { lang: h.lang, lastCheckAt: null } }) : null,
  payLinkState: () => h.state,
  payTotal: (order: { total: number }) => order.total,
  checkPayLink: async () => { h.checked++; return { state: h.lookupUnknown ? 'unknown' : h.state }; },
  openPayLink: async () => { h.opened++; return { ok: false, state: h.openError ? 'error' : h.state }; },
}));
import { GET, POST } from '../app/p/[token]/route';
const ctx = () => ({ params: Promise.resolve({ token: 'synthetic-payment-token-only' }) });
beforeEach(() => { h.state = 'review'; h.lang = 'fr'; h.found = true; h.opened = 0; h.checked = 0; h.lookupUnknown = false; h.openError = false; });
describe('public payment review state', () => {
  it.each(['fr', 'en', 'es'])('shows manual review without another pay button or charge assurances (%s)', async (lang) => {
    h.lang = lang;
    const response = await GET(new Request('https://hub.example.test/p/token?r=ok'), ctx());
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('role="status"');
    expect(body).not.toContain('<form');
    expect(body).not.toContain('http-equiv="refresh"');
    expect(body).not.toMatch(/Nothing was charged|Aucun montant|No se le cobró|is being prepared|en préparation/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(h.checked).toBe(0);
  });
  it('refuses a stale pay-form submission before creating another session', async () => {
    const response = await POST(new Request('https://hub.example.test/p/token', { method: 'POST' }), ctx());
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('<form');
    expect(h.opened).toBe(0);
  });
  it.each(['paid', 'cancelled', 'expired'])('does not imply preparation or no charge from state alone: %s', async (state) => {
    h.state = state; h.lang = 'en';
    const response = await GET(new Request('https://hub.example.test/p/token'), ctx());
    const body = await response.text();
    expect(body).not.toContain('<form');
    expect(body).not.toMatch(/Nothing was charged|is being prepared/);
  });
  it.each(['fr', 'en', 'es'])('offers only a status read when payment creation cannot safely continue (%s)', async (lang) => {
    h.state = 'pending'; h.lang = lang; h.openError = true;
    const response = await POST(new Request('https://hub.example.test/p/token', { method: 'POST' }), ctx());
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toContain('href="?r=ok"');
    expect(body).not.toContain('<form');
    expect(h.opened).toBe(1);
  });
  it('keeps an unreadable payment return from offering another charge', async () => {
    h.state = 'pending'; h.lang = 'en'; h.lookupUnknown = true;
    const response = await GET(new Request('https://hub.example.test/p/token?r=ok'), ctx());
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toContain('Do not pay again');
    expect(body).toContain('href="?r=ok"');
    expect(body).not.toContain('<form');
    expect(body).not.toContain('http-equiv="refresh"');
  });
  it.each(['fail', 'cancel'])('does not encourage another charge from the untrusted return query: %s', async (result) => {
    h.state = 'pending'; h.lang = 'en';
    const body = await (await GET(new Request(`https://hub.example.test/p/token?r=${result}`), ctx())).text();
    expect(body).toContain('href="?r=ok"');
    expect(body).not.toContain('<form');
    expect(body).not.toMatch(/another card|Payment cancelled\./);
  });
});
