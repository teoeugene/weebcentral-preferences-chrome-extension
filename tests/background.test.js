const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const WC = require('../extension/core');
const id = '01J76XYEMXXHG63FKC2DMTNC7B';
function harness(fetcher = async () => ({ ok: true, text: async () => '<a href="?included_type=Manga">Manga</a>' })) {
  const data = {};
  let listener;
  let fetches = 0;
  const local = {
    get: async (keys) => keys === null ? { ...data } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]])),
    set: async (values) => { Object.assign(data, values); },
    remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../extension/background.js`, 'utf8'), {
    WC, importScripts() {}, AbortSignal, Date, Map, Object, Promise, String, Error,
    fetch: (...args) => { fetches++; return fetcher(...args); },
    chrome: { storage: { local }, runtime: { id: 'test', getURL: (name) => `chrome-extension://test/${name}`,
      onMessage: { addListener: (fn) => { listener = fn; } } } },
  });
  const sender = { id: 'test', url: 'chrome-extension://test/popup.html' };
  const send = (message, source = sender) => new Promise((resolve) => listener(message, source, resolve));
  return { data, send, fetches: () => fetches };
}
test('worker saves/removes per-series preferences and configurable defaults', async () => {
  const h = harness();
  assert.equal((await h.send({ action: 'setOverride', id, style: 'single_page', title: 'Blue Box' })).ok, true);
  assert.equal((await h.send({ action: 'resolve', id })).style, 'single_page');
  await h.send({ action: 'removeOverride', id });
  assert.equal((await h.send({ action: 'resolve', id })).style, 'double_page_v2');
  await h.send({ action: 'setSettings', settings: { defaults: { Manga: 'double_page' } } });
  assert.equal((await h.send({ action: 'resolve', id })).style, 'double_page');
});
test('worker deduplicates metadata requests and uses cache', async () => {
  const h = harness();
  await Promise.all([h.send({ action: 'resolve', id }), h.send({ action: 'resolve', id })]);
  await h.send({ action: 'resolve', id });
  assert.equal(h.fetches(), 1);
});
test('metadata failure leaves unknown styles alone but preserves override', async () => {
  const h = harness(async () => { throw new Error('Offline'); });
  const unknown = await h.send({ action: 'resolve', id });
  assert.equal(unknown.style, null);
  assert.equal(unknown.warning, 'Offline');
  await h.send({ action: 'setOverride', id, style: 'single_page' });
  assert.equal((await h.send({ action: 'resolve', id })).style, 'single_page');
  assert.equal(h.fetches(), 1, 'Saved override should not wait for another failed metadata lookup');
});
test('slow type detection cannot overwrite a newer series override', async () => {
  let finish;
  const h = harness(() => new Promise((resolve) => { finish = resolve; }));
  const result = h.send({ action: 'resolve', id });
  await new Promise((resolve) => setImmediate(resolve));
  await h.send({ action: 'setOverride', id, style: 'double_page' });
  finish({ ok: true, text: async () => '<a href="?included_type=Manga">Manga</a>' });
  assert.equal((await result).style, 'double_page');
});
test('worker rejects foreign senders, malformed IDs/styles and non-popup defaults writes', async () => {
  const h = harness();
  const reader = { id: 'test', url: `https://weebcentral.com/chapters/${id}` };
  for (const [message, sender] of [
    [{ action: 'getSettings' }, { id: 'other', url: 'https://evil.test/' }],
    [{ action: 'resolve', id: '../../evil' }, undefined],
    [{ action: 'setOverride', id, style: '__proto__' }, undefined],
    [{ action: 'setSettings', settings: {} }, reader],
  ]) assert.equal((await h.send(message, sender)).ok, false);
});
test('pause prevents native manual changes from being saved; writes for different series survive', async () => {
  const h = harness();
  await h.send({ action: 'setSettings', settings: { enabled: false } });
  await h.send({ action: 'setOverride', id, style: 'single_page' }, { id: 'test', url: `https://weebcentral.com/chapters/${id}` });
  assert.equal(h.data[WC.seriesKey(id)], undefined);
  const second = '01J76XYEMXXHG63FKC2DMTNC7C';
  await Promise.all([h.send({ action: 'setOverride', id, style: 'double_page' }), h.send({ action: 'setOverride', id: second, style: 'long_strip' })]);
  assert.equal((await h.send({ action: 'getSettings' })).overrides.length, 2);
});
test('cache pruning never removes preferences and stale metadata refetches', async () => {
  const h = harness();
  const other = '01J76XYEMXXHG63FKC2DMTNC7C';
  h.data[WC.seriesKey(other)] = { style: 'single_page' };
  for (let index = 0; index < 210; index++) h.data[`type:old-${index}`] = { type: 'Manga', at: index };
  await h.send({ action: 'resolve', id });
  assert.equal(Object.keys(h.data).filter((key) => key.startsWith('type:')).length, 200);
  assert.equal(h.data[WC.seriesKey(other)].style, 'single_page');
  h.data[`type:${id}`].at = 0;
  await h.send({ action: 'resolve', id });
  assert.equal(h.fetches(), 2);
});
