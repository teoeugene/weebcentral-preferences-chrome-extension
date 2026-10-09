const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const WC = require('../extension/core');
const reader = require('../extension/reader-dom');
const fixture = fs.readFileSync(`${__dirname}/fixtures/reader.html`, 'utf8');
const id = '01J76XYEMXXHG63FKC2DMTNC7B';
test('Manga uses exact native MangaPlus value; other types use Long Strip', () => {
  assert.deepEqual(WC.settings(null).defaults, { Manga: 'double_page_v2', Manhwa: 'long_strip', Manhua: 'long_strip' });
});
test('all four native styles configurable independently; corrupt data falls back', () => {
  const config = WC.settings({ defaults: { Manga: 'single_page', Manhwa: 'double_page', Manhua: 'bad' } });
  assert.deepEqual(config.defaults, { Manga: 'single_page', Manhwa: 'double_page', Manhua: 'long_strip' });
  assert.equal(WC.isStyle('__proto__'), false);
});
test('series identity ignores title slug and chapter; rejects foreign URLs and invalid IDs', () => {
  assert.equal(WC.seriesFromUrl(`https://weebcentral.com/series/${id}/Different-title`), id);
  assert.equal(WC.seriesFromUrl(`https://www.weebcentral.com/series/${id.toLowerCase()}`), id);
  for (const url of [`https://evil.test/series/${id}`, `http://weebcentral.com/series/${id}`, 'https://weebcentral.com/series/random']) assert.equal(WC.seriesFromUrl(url), null);
  assert.equal(WC.seriesKey(id), `series:${id}`);
});
test('detects explicit metadata for all types; avoids title/comment keywords and ambiguous metadata', () => {
  for (const type of WC.TYPES) assert.equal(WC.typeFromHtml(`<strong>Type: </strong><a href="https://weebcentral.com/search?included_type=${type}" class="link">${type}</a>`), type);
  assert.equal(WC.typeFromHtml('<h1>Manga Manhwa Manhua</h1><p>Type: Manga</p>'), null);
  assert.equal(WC.typeFromHtml('<a href="?included_type=Manga">Manga</a><a href="?included_type=Manhwa">Manhwa</a>'), null);
});
test('overrides precede defaults even for unknown type; pause wins; unknown does not guess', () => {
  assert.equal(WC.effectiveStyle(WC.settings(), 'Manga', { style: 'single_page' }), 'single_page');
  assert.equal(WC.effectiveStyle(WC.settings(), null, { style: 'double_page' }), 'double_page');
  assert.equal(WC.effectiveStyle(WC.settings({ enabled: false }), 'Manga', { style: 'single_page' }), null);
  assert.equal(WC.effectiveStyle(WC.settings(), 'OEL', null), null);
});
test('reader extracts stable identity from actual nav structure', () => {
  const dom = new JSDOM(fixture, { url: 'https://weebcentral.com/chapters/example' });
  assert.deepEqual(reader.series(dom.window.document, dom.window.location.href), { id, title: 'Blue Box' });
  assert.equal(reader.ready(dom.window.document), true);
});
test('applies through radio model then hidden HTMX event; idempotent', async () => {
  const dom = new JSDOM(fixture);
  const document = dom.window.document;
  const hidden = document.querySelector('[name="reading_style"]');
  let reloads = 0;
  document.addEventListener('change', (event) => {
    if (event.target.matches('input[type="radio"]')) queueMicrotask(() => { hidden.value = event.target.value; });
    if (event.target === hidden) reloads++;
  });
  assert.equal(await reader.apply(document, 'double_page_v2'), true);
  assert.equal(hidden.value, 'double_page_v2');
  assert.equal(reloads, 1);
  assert.equal(await reader.apply(document, 'double_page_v2'), true);
  assert.equal(reloads, 1);
});
test('missing controls and cancelled operations do not send image reloads', async () => {
  const dom = new JSDOM(fixture);
  const document = dom.window.document;
  let reloads = 0;
  document.querySelector('[name="reading_style"]').addEventListener('change', () => reloads++);
  assert.equal(await reader.apply(document, 'single_page', () => false), false);
  assert.equal(reloads, 0);
  document.querySelector('#chapter-images').remove();
  assert.equal(await reader.apply(document, 'double_page'), false);
});
