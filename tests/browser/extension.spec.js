const { test, expect, chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const manga = '01J76XYEMXXHG63FKC2DMTNC7B';
const manhwa = '01J76XYEMXXHG63FKC2DMTNC7C';
const manhua = '01J76XYEMXXHG63FKC2DMTNC7D';
const unknown = '01J76XYEMXXHG63FKC2DMTNC7E';
let context, worker, extensionId, profile;
function fragment(style) {
  return `<section id="chapter-images" data-rendered-style="${style}" hx-get="/chapters/fixture/images" hx-trigger="change from:[name='reading_style']" hx-include="[name='reading_style'],[name='current_page']" hx-swap="outerHTML"><p>Layout: ${style}</p></section>`;
}
function readerPage(id) {
  const structure = fs.readFileSync(path.join(root, 'tests/fixtures/reader.html'), 'utf8').replaceAll(manga, id);
  return `<!doctype html><html><head><script src="/test-htmx.js"></script><script>
    document.addEventListener('alpine:init', () => Alpine.data('singlePageNavigation', () => ({
      reading_style: Alpine.$persist('long_strip'), page: 1,
      init() { this.$nextTick(() => htmx.ajax('GET', '/chapters/fixture/images', {
        target: '#chapter-images', swap: 'outerHTML', values: { reading_style: this.reading_style }
      })); }
    })));
  </script><script defer src="/test-persist.js"></script><script defer src="/test-alpine.js"></script></head><body>${structure.replace(' hx-get="/chapters/example/images"', '')}</body></html>`;
}
test.beforeEach(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-extension-test-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).hostname;
  await context.route('https://weebcentral.com/**', async (route) => {
    const url = new URL(route.request().url());
    const libraries = {
      '/test-htmx.js': 'htmx.org/dist/htmx.min.js',
      '/test-alpine.js': 'alpinejs/dist/cdn.min.js',
      '/test-persist.js': '@alpinejs/persist/dist/cdn.min.js',
    };
    if (libraries[url.pathname]) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(root, 'node_modules', libraries[url.pathname]), 'utf8') });
    // HTMX retains initial ajax values and adds the current hidden input. The site uses
    // the last value, as verified against its real images endpoint.
    if (url.pathname.endsWith('/images')) return route.fulfill({ contentType: 'text/html', body: fragment(url.searchParams.getAll('reading_style').at(-1) || 'long_strip') });
    if (url.pathname.startsWith('/chapters/')) return route.fulfill({ contentType: 'text/html', body: readerPage(url.searchParams.get('series') || manga) });
    if (url.pathname.startsWith('/series/')) {
      const id = url.pathname.split('/')[2];
      const type = { [manga]: 'Manga', [manhwa]: 'Manhwa', [manhua]: 'Manhua' }[id];
      return route.fulfill({ contentType: 'text/html', body: type ? `<h1>Series</h1><a href="?included_type=${type}">${type}</a>` : '<h1>Unknown</h1>' });
    }
    return route.abort();
  });
});
test.afterEach(async () => {
  await context.close();
  // Remove only the profile created by this test, after browser shutdown.
  if (profile.startsWith(path.join(os.tmpdir(), 'wc-extension-test-'))) fs.rmSync(profile, { recursive: true, force: true });
});
async function openReader(id = manga) {
  const page = await context.newPage();
  await page.goto(`https://weebcentral.com/chapters/fixture?series=${id}`);
  return page;
}
async function storage() { return worker.evaluate(async () => ({ ...await chrome.storage.local.get(null), ...await chrome.storage.sync.get(null) })); }
async function openPopup(page) {
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url?.includes('/chapters/')).id);
  const popup = await context.newPage();
  // A popup opened as a test tab would otherwise see itself as active. Only substitute this
  // query; messaging, storage, worker, content scripts, and native controls are real.
  await popup.addInitScript((id) => { chrome.tabs.query = async () => [{ id }]; }, tabId);
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#save-defaults')).toBeEnabled();
  return popup;
}
test('real extension applies MangaPlus through Alpine and HTMX without saving an auto override', async () => {
  const page = await openReader();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'double_page_v2');
  await expect(page.locator('input[type="radio"][value="double_page_v2"]')).toBeChecked();
  expect((await storage())[`series:${manga}`]).toBeUndefined();
});
test('detects Manhwa and Manhua and leaves unknown type unchanged', async () => {
  for (const id of [manhwa, manhua, unknown]) {
    const page = await openReader(id);
    await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'long_strip');
  }
  await expect.poll(async () => (await storage())[`type:${manhwa}`]?.type).toBe('Manhwa');
  expect((await storage())[`type:${manhua}`]?.type).toBe('Manhua');
  expect((await storage())[`type:${unknown}`]).toBeUndefined();
});
test('trusted reader choice is saved and restored on another chapter', async () => {
  const page = await openReader();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'double_page_v2');
  await page.locator('#preference_modal').evaluate((modal) => modal.showModal());
  await page.locator('input[value="single_page"]').check();
  await expect.poll(async () => (await storage())[`series:${manga}`]?.style).toBe('single_page');
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'single_page');
  await page.goto(`https://weebcentral.com/chapters/next?series=${manga}`);
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'single_page');
  await page.goto(`https://weebcentral.com/chapters/other?series=${manhwa}`);
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'long_strip');
  expect((await storage())[`series:${manga}`].style).toBe('single_page');
});
test('popup saves defaults and per-series overrides, removes overrides, and pauses automation', async () => {
  const page = await openReader();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'double_page_v2');
  const popup = await openPopup(page);
  await expect(popup.locator('#Manga')).toHaveValue('double_page_v2');
  await popup.screenshot({ path: path.join(root, 'test-results/popup.png') });
  await popup.locator('#Manga').selectOption('double_page');
  await popup.locator('#save-defaults').click();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'double_page');
  await popup.locator('#series-style').selectOption('single_page');
  await popup.locator('#save-series').click();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'single_page');
  await expect(popup.locator('#count')).toHaveText('1');
  await popup.locator('summary').click();
  await popup.getByRole('button', { name: 'Remove override for Blue Box' }).click();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'double_page');
  await popup.locator('#enabled').uncheck();
  await expect.poll(async () => (await storage()).settings?.enabled).toBe(false);
  await page.locator('#preference_modal').evaluate((modal) => modal.showModal());
  await page.locator('input[value="long_strip"]').check();
  expect((await storage())[`series:${manga}`]).toBeUndefined();
});
test('unknown type supports an explicit override without guessing a default', async () => {
  const page = await openReader(unknown);
  const popup = await openPopup(page);
  await expect(popup.locator('#current-title')).toContainText('Type unknown');
  await popup.locator('#series-style').selectOption('double_page_v2');
  await popup.locator('#save-series').click();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'double_page_v2');
  await page.reload();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'double_page_v2');
});
test('a manual choice during slow metadata detection wins over auto apply', async () => {
  let release;
  await context.route(`https://weebcentral.com/series/${manga}`, async (route) => {
    await new Promise((resolve) => { release = resolve; });
    await route.fulfill({ contentType: 'text/html', body: '<a href="?included_type=Manga">Manga</a>' });
  });
  const page = await openReader();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'long_strip');
  await expect.poll(() => typeof release).toBe('function');
  await page.locator('#preference_modal').evaluate((modal) => modal.showModal());
  await page.locator('input[type="radio"][value="single_page"]').check();
  await expect.poll(async () => (await storage())[`series:${manga}`]?.style).toBe('single_page');
  release();
  await expect.poll(async () => (await storage())[`type:${manga}`]?.type).toBe('Manga');
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'single_page');
});

test('sync changes from another device update an open reader; metadata stays local', async () => {
  const page = await openReader();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'double_page_v2');
  await worker.evaluate(async (id) => {
    await chrome.storage.sync.set({ [`series:${id}`]: { style: 'single_page', title: 'From another PC' } });
  }, manga);
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'single_page');
  await worker.evaluate((id) => chrome.storage.sync.remove(`series:${id}`), manga);
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'double_page_v2');
  const synced = await worker.evaluate(() => chrome.storage.sync.get(null));
  expect(Object.keys(synced).some((key) => key.startsWith('type:'))).toBe(false);
  const local = await worker.evaluate(() => chrome.storage.local.get(null));
  expect(local[`type:${manga}`].type).toBe('Manga');
});

test('older local preferences migrate automatically when the popup first opens', async () => {
  await worker.evaluate(async (id) => {
    await chrome.storage.local.set({ settings: { enabled: false }, [`series:${id}`]: { style: 'single_page', title: 'Old series' } });
    await chrome.storage.local.remove('syncMigrationV1');
  }, manga);
  const page = await openReader();
  const popup = await openPopup(page);
  await expect(popup.locator('#enabled')).not.toBeChecked();
  await expect(popup.locator('#count')).toHaveText('1');
  const synced = await worker.evaluate(() => chrome.storage.sync.get(null));
  expect(synced.settings.enabled).toBe(false);
  expect(synced[`series:${manga}`].style).toBe('single_page');
});

test('fixed manifest identity matches the previous D-folder ID and loads bundled site icons', async () => {
  expect(extensionId).toBe('ananlhfpdnnpffigcopbnnplpadbhgpn');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const dimensions = await popup.evaluate(async () => {
    const manifest = chrome.runtime.getManifest();
    return Promise.all(Object.entries(manifest.icons).map(([size, file]) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve([Number(size), image.naturalWidth, image.naturalHeight]);
      image.onerror = () => reject(new Error(`Missing icon: ${file}`));
      image.src = chrome.runtime.getURL(file);
    })));
  });
  expect(dimensions).toEqual([[16, 16, 16], [32, 32, 32], [48, 48, 48], [128, 128, 128]]);
});

test('incoming sync updates the popup while keeping an unsaved default selection', async () => {
  const page = await openReader();
  await expect(page.locator('#chapter-images')).toHaveAttribute('data-rendered-style', 'double_page_v2');
  const popup = await openPopup(page);
  await popup.locator('#Manhua').selectOption('single_page');
  await worker.evaluate(() => chrome.storage.sync.set({ settings: {
    enabled: true, defaults: { Manga: 'single_page', Manhwa: 'double_page', Manhua: 'double_page' },
  } }));
  await expect(popup.locator('#Manga')).toHaveValue('single_page');
  await expect(popup.locator('#Manhwa')).toHaveValue('double_page');
  await expect(popup.locator('#Manhua')).toHaveValue('single_page');
  await worker.evaluate((id) => chrome.storage.sync.set({ [`series:${id}`]: { style: 'double_page', title: 'Remote series' } }), manga);
  await expect(popup.locator('#count')).toHaveText('1');
  await expect(popup.locator('#series-style')).toHaveValue('double_page');
});
