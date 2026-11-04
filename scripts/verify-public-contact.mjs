// Built public UI verification. Every write is intercepted/blocked; this does not prove actual backend storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium, expect } from 'playwright/test';
import AxeBuilder from '@axe-core/playwright';
const base = process.env.CONTACT_REVIEW_BASE || 'http://127.0.0.1:4809';
const output = process.env.CONTACT_REVIEW_OUTPUT || path.join(os.tmpdir(), `foodhub-contact-review-${Date.now()}`);
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'This proof only targets a local built app.');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
const results = []; const errors = [];
const repetitions = Number(process.env.CONTACT_REVIEW_REPEATS || 5);
assert(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 50, 'Choose 1–50 repeated Phone AI journeys.');
const record = (name) => { results.push(name); console.log(`PASS ${name}`); };
async function newPage(lang = 'en', width = 1440, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: lang === 'fr' ? 'fr-CA' : 'en-CA', ...options });
  await context.route('**/*', async (route) => { if (new URL(route.request().url()).origin !== new URL(base).origin || !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) await route.abort(); else await route.continue(); });
  const page = await context.newPage(); page.on('pageerror', (error) => { const item = { message: error.message, url: page.url() }; errors.push(item); console.error('PAGE_ERROR', JSON.stringify(item)); });
  await page.goto(`${base}${lang === 'fr' ? '/hub/contact' : '/en/hub/contact'}`, { waitUntil: 'networkidle' });
  if (options.javaScriptEnabled !== false) await expect(page.getByRole('button', { name: lang === 'fr' ? 'Envoyer ma demande' : 'Send my request' })).toBeEnabled();
  return { page, context };
}
async function fill(page) {
  await page.locator('[name="restaurant"]').fill('Demo restaurant');
  await page.locator('[name="contact"]').fill('Synthetic Owner');
  await page.locator('[name="email"]').fill('owner@example.test');
  await page.locator('[name="phone"]').fill('5145550199');
  await page.locator('[name="city"]').fill('Montréal');
}
try {
  for (const lang of ['fr', 'en']) for (const width of [1440, 390]) {
    const { page, context } = await newPage(lang, width);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow.');
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    assert.deepEqual(axe.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) })), []);
    await page.screenshot({ path: path.join(output, `contact-${lang}-${width}.png`), fullPage: true });
    await expect(page.locator(`a[href="${lang === 'fr' ? 'https://on2go.ca/' : 'https://on2go.ca/en/'}"]`)).toBeVisible();
    record(`contact ${lang}/${width}: accessible labels, no overflow, zero WCAG A/AA violations and locale-matched diner link`);
    await context.close();
  }
  {
    const { page, context } = await newPage(); const attempts = [];
    await page.route('**/api/public/restaurant-leads', async (route) => {
      attempts.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
      if (attempts.length === 1) await route.abort('failed');
      else await route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' });
    });
    await fill(page); await page.getByRole('button', { name: 'Send my request' }).click();
    await expect(page.locator('form[aria-label] [role="alert"]')).toContainText('cannot confirm');
    await expect(page.locator('[name="email"]')).toHaveValue('owner@example.test'); await expect(page.locator('[name="email"]')).toBeDisabled();
    await page.getByRole('button', { name: 'Check my request' }).click();
    await expect(page.getByRole('status')).toContainText('Your request has been received.');
    assert.equal(attempts.length, 2); assert.equal(attempts[0].body, attempts[1].body); assert.equal(attempts[0].key, attempts[1].key);
    const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.entries(sessionStorage) }));
    assert(!JSON.stringify(stored).includes('owner@example.test')); assert(!JSON.stringify(stored).includes('5145550199'));
    record('lost response preserves exact request/key, locks edits, confirms only on valid acknowledgement and persists no contact details');
    await context.close();
  }
  {
    const { page, context } = await newPage('fr');
    await page.route('**/api/public/restaurant-leads', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false,"errors":{"email":"invalid"}}' }));
    await fill(page); await page.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await expect(page.locator('[name="email"]')).toBeFocused(); await expect(page.locator('[name="email"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#enquiry-email-error')).toHaveText('Vérifiez ce champ.');
    await expect(page.locator('[name="email"]')).toBeEnabled(); await expect(page.locator('[name="restaurant"]')).toHaveValue('Demo restaurant');
    record('server field errors retain input, restore editing and focus a labelled French error'); await context.close();
  }
  {
    const { page, context } = await newPage();
    await page.route('**/api/public/restaurant-leads', (route) => route.fulfill({ status: 429, headers: { 'content-type': 'application/json', 'retry-after': '1' }, body: '{"ok":false}' }));
    await fill(page); await page.getByRole('button', { name: 'Send my request' }).click();
    await expect(page.locator('form[aria-label] [role="alert"]')).toContainText('wait'); await expect(page.getByRole('button', { name: 'Send my request' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Send my request' })).toBeEnabled({ timeout: 5000 });
    record('rate response honors Retry-After and re-enables the intact form'); await context.close();
  }
  for (const status of [202, 503]) {
    const { page, context } = await newPage();
    await page.route('**/api/public/restaurant-leads', (route) => route.fulfill({ status, contentType: 'text/html', body: '<html>Unavailable</html>' }));
    await fill(page); await page.getByRole('button', { name: 'Send my request' }).click();
    await expect(page.locator('form[aria-label] [role="alert"]')).toContainText('cannot confirm'); await expect(page.getByRole('status')).toHaveCount(0);
    record(`${status} without a valid JSON acknowledgement never claims receipt`); await context.close();
  }
  {
    const { page, context } = await newPage();
    await page.goto(`${base}/en/hub/contact?interest=phone`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Send my request' })).toBeEnabled();
    await expect(page.locator('[name="platforms"][value="phone"]')).toBeChecked();
    await page.locator('a[href="/hub/contact?interest=phone"]').click();
    await expect(page.locator('[name="platforms"][value="phone"]')).toBeChecked();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Parlons');
    record('Phone AI inquiry context remains visible and selected across the language switch'); await context.close();
  }
  {
    const { page, context } = await newPage('en', 390, { javaScriptEnabled: false });
    await expect(page.getByRole('button', { name: 'Send my request' })).toBeDisabled();
    await expect(page.locator('noscript p')).toContainText('To send your request, email us at the address provided.');
    await expect(page.locator('noscript p')).toBeVisible();
    await expect(page.locator('noscript a[href^="mailto:"]')).toBeVisible();
    record('without JavaScript, the email fallback remains usable and the form cannot submit the wrong media type'); await context.close();
  }
  {
    const { page, context } = await newPage();
    await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
    await page.reload({ waitUntil: 'networkidle' });
    let key;
    await page.route('**/api/public/restaurant-leads', async (route) => { key = route.request().headers()['idempotency-key']; await route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' }); });
    await fill(page); await page.getByRole('button', { name: 'Send my request' }).click();
    await expect(page.getByRole('status')).toContainText('Your request has been received.');
    assert.match(key, /^[a-f0-9]{32}$/);
    record('the secure nonce fallback works in browsers without crypto.randomUUID'); await context.close();
  }
  for (let i = 0; i < repetitions; i++) {
    const { page, context } = await newPage('en', [1280, 1440, 390][i % 3]);
    await page.goto(`${base}/en/hub/contact?interest=phone`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Send my request' })).toBeEnabled();
    await expect(page.locator('[name="platforms"][value="phone"]')).toBeChecked();
    await page.locator('a[href="/hub/contact?interest=phone"]').click();
    await expect(page.getByRole('button', { name: 'Envoyer ma demande' })).toBeEnabled();
    await expect(page.locator('[name="platforms"][value="phone"]')).toBeChecked();
    await page.locator('a[href="/en/hub/contact?interest=phone"]').click();
    await expect(page.getByRole('button', { name: 'Send my request' })).toBeEnabled();
    await expect(page.locator('[name="platforms"][value="phone"]')).toBeChecked();
    await context.close();
    record(`unmodified Phone AI/query/language journey ${i + 1}/${repetitions}`);
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: results.length, repeatedPhoneJourneys: repetitions, results, pageErrors: errors, transport: 'client error/acknowledgement fixtures only; no real leads/emails', applicationJavaScript: 'unmodified server assets', productionVerified: false }, null, 2));
  console.log(`${results.length} contact browser checks passed.`);
} finally { await browser.close(); }
