// Actual built public form -> actual Food Hub API -> owner inbox. All contacts are synthetic.
// The caller supplies an isolated local Food Hub process/database and authenticated owner browser context.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'playwright/test';

export async function runPublicContactJourney({ page, admin, publicBase, apiBase, restartFoodHub, passed, output }) {
  const transport = new URL(apiBase);
  assert(transport.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(transport.hostname), 'Contact proof writes only to an isolated loopback server.');
  const tag = Date.now().toString(36);
  const restaurant = `Demo restaurant ${tag}`;
  const email = `contact-${tag}@example.test`;
  const attempts = [];
  let dropResponse = true;
  const match = '**/api/public/restaurant-leads';
  const forward = async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    attempts.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
    const response = await route.fetch({ url: `${apiBase}/api/public/restaurant-leads` });
    if (dropResponse) {
      assert.equal(response.status(), 202, 'The real API must store the request before the simulated response loss.');
      assert.deepEqual(await response.json(), { ok: true });
      dropResponse = false; await route.abort('failed'); return;
    }
    await route.fulfill({ response });
  };
  await page.route(match, forward);
  const read = async () => {
    const response = await admin.request.get(`${apiBase}/api/foodhub/restaurant-leads`);
    assert(response.ok(), 'The actual owner inbox API must authorize the local fixture.');
    return (await response.json()).leads.filter((lead) => lead.email === email);
  };
  try {
    await page.goto(`${publicBase}/hub/contact`, { waitUntil: 'networkidle' });
    await page.getByLabel('Nom du restaurant', { exact: false }).fill(restaurant);
    await page.getByLabel('Votre nom', { exact: false }).fill('Synthetic Owner');
    await page.getByLabel('Courriel', { exact: false }).fill(email);
    await page.getByLabel('Téléphone *', { exact: true }).fill('5145550198');
    await page.getByLabel('Ville', { exact: false }).fill('Montréal');
    await page.getByLabel('Province ou territoire', { exact: false }).selectOption('QC');
    await page.getByLabel('Uber Eats', { exact: true }).check();
    await page.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await expect(page.locator('form[aria-label] [role="alert"]')).toContainText('Nous ne pouvons pas encore confirmer');
    await expect(page.getByLabel('Nom du restaurant', { exact: false })).toHaveValue(restaurant);
    await expect(page.getByLabel('Nom du restaurant', { exact: false })).toBeDisabled();
    assert.equal((await read()).length, 1);
    if (restartFoodHub) await restartFoodHub();
    await page.getByRole('button', { name: 'Vérifier ma demande' }).click();
    await expect(page.getByRole('status')).toContainText('Votre demande est reçue.');
    assert.equal(attempts.length, 2); assert(attempts[0].key);
    assert.equal(attempts[1].key, attempts[0].key); assert.equal(attempts[1].body, attempts[0].body);
    const leads = await read(); assert.equal(leads.length, 1);
    assert.equal(leads[0].source, 'foodhub'); assert.equal(leads[0].lang, 'fr'); assert.equal(leads[0].phone, '+15145550198');
    const anonymous = await page.request.get(`${apiBase}/api/foodhub/restaurant-leads`); assert.equal(anonymous.status(), 401);
    const ownerPage = await admin.newPage();
    try {
      await ownerPage.goto(`${apiBase}/settings/leads`, { waitUntil: 'networkidle' });
      await ownerPage.getByRole('combobox', { name: /Source de la demande|Request source/ }).selectOption('foodhub');
      await ownerPage.getByRole('searchbox', { name: /Chercher une demande|Search leads/ }).fill(email);
      const row = ownerPage.locator('li').filter({ hasText: restaurant });
      await expect(row).toHaveCount(1); await expect(row.getByText('Food Hub', { exact: true })).toBeVisible();
      if (output) { fs.mkdirSync(output, { recursive: true }); await ownerPage.screenshot({ path: path.join(output, 'contact-owner-inbox.png') }); }
    } finally { await ownerPage.close(); }
    if (output) await page.screenshot({ path: path.join(output, 'contact-accepted-fr.png') });
    passed('actual Food Hub contact form recovers a lost response with the same body/key, one durable owner-inbox request and correct source/language');
    return { realApi: true, leadCount: 1, attempts: 2, identicalReplay: true, processRestart: Boolean(restartFoodHub), ownerOnlyInbox: true, externalMailClaimed: false };
  } finally { await page.unroute(match, forward); }
}
