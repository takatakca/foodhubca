// Browser interactions against the actual built ON2GO and Food Hub applications.
// The caller owns isolated providers/database, real request forwarding and response-loss injection.
import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from 'playwright/test';

const checkoutResponse = (page, status) => page.waitForResponse((response) => response.url().includes('/api/storefront/checkout') && response.request().method() === 'POST' && response.status() === status);
const checkoutRequest = (page) => page.waitForRequest((request) => request.url().includes('/api/storefront/checkout') && request.method() === 'POST');

export async function runOrderingJourney({ page, passed, readOrders, modifyMenu, dropNextCheckoutResponse, phone = '+15145559911', output, origin = 'https://on2go.ca' }) {
  assert.equal(typeof readOrders, 'function', 'Actual order reads are required.');
  assert.equal(typeof modifyMenu, 'function', 'A real menu-price mutation hook is required.');
  assert.equal(typeof dropNextCheckoutResponse, 'function', 'The caller must drop a real committed response, not mock checkout.');
  const before = await readOrders();
  assert(Array.isArray(before), 'readOrders must return the actual local order list.');
  const baseline = before.length;
  await page.goto(`${origin}/restaurants/pi-pita/`, { waitUntil: 'networkidle' });
  await page.locator('#commander .ord-add:not(:disabled)').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^(Régulier|Regular)(\s|$)/i).check();
  await dialog.getByLabel(/^(Fromage|Cheese)(\s|$)/i).check();
  await dialog.getByRole('button', { name: /^Ajouter ·/ }).click();
  await expect(page.locator('.ord-lines')).toContainText(/Fromage|Cheese/);
  await page.getByRole('button', { name: 'Passer la commande', exact: true }).click();
  await page.locator('.checkout-review input[name="name"]').fill('Client Test Local');
  await page.locator('.checkout-review input[name="phone"]').fill(phone);
  const quoted = page.waitForResponse((response) => response.url().includes('/api/storefront/quote') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Vérifier ma commande', exact: true }).click();
  const firstResponse = await quoted;
  assert.equal(firstResponse.status(), 200);
  const firstQuote = await firstResponse.json();
  assert.equal(firstQuote.ok, true);
  assert.match(firstQuote.quoteId, /^[a-f0-9]{64}$/);
  assert(firstQuote.tax > 0 && firstQuote.total > firstQuote.subtotal);
  await expect(page.locator('.ord-review')).toContainText(firstQuote.taxes.label.fr);
  assert.equal((await readOrders()).length, baseline, 'Review must not create an order.');
  passed('actual ON2GO modifier/cart form obtains a real server-priced quote and Canadian taxes before placement');

  await modifyMenu();
  const changed = checkoutResponse(page, 409);
  await page.getByRole('button', { name: /^Confirmer la commande ·/ }).click();
  const changedQuote = await (await changed).json();
  assert.equal(changedQuote.reason, 'quote_changed');
  assert(changedQuote.quote && changedQuote.quote.total !== firstQuote.total);
  await expect(page.getByRole('button', { name: /^Confirmer le nouveau total ·/ })).toBeVisible();
  assert.equal((await readOrders()).length, baseline, 'Changed prices require another customer confirmation.');
  passed('a real menu-price change is refused before ordering and ON2GO requires explicit confirmation of the new total');
  if (output) await page.screenshot({ path: path.join(output, 'ordering-reviewed-price-desktop.png'), fullPage: true });

  await dropNextCheckoutResponse();
  const placement = checkoutRequest(page);
  await page.getByRole('button', { name: /^Confirmer le nouveau total ·/ }).click();
  const sent = (await placement).postDataJSON();
  await expect(page.getByRole('button', { name: 'Réessayer la même demande', exact: true })).toBeVisible();
  await expect.poll(async () => (await readOrders()).length).toBe(baseline + 1);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('on2go_pending_pi-pita_v1')));
  assert.deepEqual(saved.request, sent, 'The exact approved request must be retained, including its key.');
  assert.equal(sent.quoteId, changedQuote.quote.quoteId);
  assert.match(sent.idempotencyKey, /^[A-Za-z0-9_-]{16,128}$/);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Réessayer la même demande', exact: true })).toBeVisible();
  const replay = checkoutRequest(page);
  await page.getByRole('button', { name: 'Réessayer la même demande', exact: true }).click();
  assert.deepEqual((await replay).postDataJSON(), sent, 'Reload/retry must not rotate the key, price, choices or customer intent.');
  await page.waitForURL((url) => url.pathname === '/suivi/');
  await expect(page.locator('.track-status')).toBeVisible();
  assert.equal((await readOrders()).length, baseline + 1, 'Retry must return the existing order.');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('on2go_pending_pi-pita_v1')), null);
  passed('dropped real checkout response survives reload, replays the same request/key and resolves to one persisted order with actual tracking');
  if (output) {
    await page.screenshot({ path: path.join(output, 'ordering-tracking-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'ordering-tracking-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });
  }
  return { oldTotal: firstQuote.total, confirmedTotal: changedQuote.quote.total, ordersAdded: 1 };
}

/** Optional native parity proof after the caller has enabled the supplied public storefront slug. */
export async function runNativeOrderingJourney({ page, passed, readOrders, dropNextCheckoutResponse, slug = 'pi-pita', phone = '+15145559911', output, origin = 'https://foodhub.on2go.ca' }) {
  const baseline = (await readOrders()).length;
  await page.goto(`${origin}/commander/${slug}?lang=fr&src=instagram`, { waitUntil: 'networkidle' });
  await page.locator('main section li button:not(:disabled)').first().click();
  const item = page.getByRole('dialog');
  await item.getByLabel(/^(Régulier|Regular)(\s|$)/i).check();
  await item.getByLabel(/^(Fromage|Cheese)(\s|$)/i).check();
  await item.getByRole('button', { name: /^Ajouter/ }).click();
  const decline = page.getByRole('button', { name: 'Non merci', exact: true });
  if (await decline.isVisible()) await decline.click();
  await page.getByRole('button', { name: /^Voir le panier/ }).click();
  const cart = page.getByRole('dialog');
  await cart.locator('input[name="name"]').fill('Client Test Local');
  await cart.locator('input[name="phone"]').fill(phone);
  const quoted = page.waitForResponse((response) => response.url().includes('/api/storefront/quote') && response.request().method() === 'POST');
  await cart.getByRole('button', { name: 'Vérifier ma commande', exact: true }).click();
  const response = await quoted;
  assert.equal(response.status(), 200);
  const quote = await response.json();
  assert(quote.ok && quote.tax > 0);
  assert.equal((await readOrders()).length, baseline);
  await dropNextCheckoutResponse();
  const placement = checkoutRequest(page);
  await cart.getByRole('button', { name: /^Confirmer la commande ·/ }).click();
  const sent = (await placement).postDataJSON();
  assert.equal(sent.src, 'instagram');
  assert.equal(sent.slug, slug);
  await expect(page.getByRole('button', { name: 'Réessayer la même demande', exact: true })).toBeVisible();
  await expect.poll(async () => (await readOrders()).length).toBe(baseline + 1);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Réessayer la même demande', exact: true })).toBeVisible();
  const replay = checkoutRequest(page);
  await page.getByRole('button', { name: 'Réessayer la même demande', exact: true }).click();
  assert.deepEqual((await replay).postDataJSON(), sent);
  await page.waitForURL((url) => url.pathname.startsWith(`/commander/${slug}/suivi/`));
  assert.equal((await readOrders()).length, baseline + 1);
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), `sf_pending:${slug}`), null);
  passed('native Food Hub storefront obtains a real quote and recovers the exact attributed request after a dropped response/reload without a second order');
  if (output) await page.screenshot({ path: path.join(output, 'native-ordering-tracking-desktop.png'), fullPage: true });
  return { total: quote.total, ordersAdded: 1 };
}
