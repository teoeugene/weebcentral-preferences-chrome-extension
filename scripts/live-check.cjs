// Opt-in compatibility smoke check. Uses public site HTML, native JS and image-layout
// endpoints; blocks image pixels, tracking, ads, analytics and unrelated requests.
const { chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const extension = path.resolve(__dirname, '../extension');
const url = 'https://weebcentral.com/chapters/01JS9VX7YBJ9W7GNSHBQDN8T31';
const seriesId = '01J76XYEMXXHG63FKC2DMTNC7B';
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-extension-live-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const layoutRequests = [];
    await context.route('**/*', async (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (target.protocol === 'chrome-extension:') return route.continue();
      const allowed = target.hostname === 'weebcentral.com' && (
        target.pathname.startsWith('/chapters/') || target.pathname.startsWith('/series/') ||
        target.pathname.startsWith('/static/js/') || target.pathname.startsWith('/static/css/')
      );
      if (!allowed || ['image', 'media', 'font'].includes(request.resourceType())) return route.abort();
      if (target.pathname.endsWith('/images')) layoutRequests.push(request.url());
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
      const input = document.querySelector('input[type="radio"][value="double_page_v2"]');
      const max = document.getElementById('max_page');
      return input?.checked && max && Number(max.value) === 11;
    }, null, { timeout: 30000 }).catch(async (error) => {
      console.error('Live diagnostic:', { title: await page.title(), requests: layoutRequests,
        reader: await page.evaluate(() => ({ radios: document.querySelectorAll('[x-model="reading_style"][type="radio"]').length,
          max: document.getElementById('max_page')?.value, model: document.querySelector('[name="reading_style"]')?.value })),
        extension: await worker.evaluate(() => chrome.storage.local.get(null)) });
      throw error;
    });
    assert.equal(await worker.evaluate(async (id) => (await chrome.storage.local.get(`type:${id}`))[`type:${id}`]?.type, seriesId), 'Manga');
    assert(layoutRequests.some((value) => new URL(value).searchParams.getAll('reading_style').at(-1) === 'double_page_v2'));
    await page.locator('#preference_modal').evaluate((modal) => modal.showModal());
    await page.locator('input[type="radio"][value="single_page"]').check();
    await page.waitForFunction(() => Number(document.getElementById('max_page')?.value) === 21);
    const saved = await worker.evaluate(async (id) => (await chrome.storage.local.get(`series:${id}`))[`series:${id}`], seriesId);
    assert.equal(saved.style, 'single_page');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('input[type="radio"][value="single_page"]')?.checked && Number(document.getElementById('max_page')?.value) === 21);
    console.log('Live reader PASS: Manga detected, MangaPlus renders 11 spreads, manual Single Page renders 21 pages, override survives reload.');
  } finally {
    await context?.close();
    if (profile.startsWith(path.join(os.tmpdir(), 'wc-extension-live-'))) fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
