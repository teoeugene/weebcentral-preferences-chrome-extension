const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const WC = require('../extension/core');
const id = '01J76XYEMXXHG63FKC2DMTNC7B';
function harness(fetcher = async () => ({ ok: true, text: async () => '<a href="?included_type=Manga">Manga</a>' }), options = {}) {
  const data = { ...options.syncData };
  const localData = { ...options.localData };
  let listener;
  let fetches = 0;
  let failSync;
  let writes = 0;
  function area(values, sync = false) {
    return {
      MAX_ITEMS: options.maxItems ?? 512, QUOTA_BYTES_PER_ITEM: 8192, QUOTA_BYTES: options.maxBytes ?? 102400,
      get: async (keys) => keys === null ? { ...values } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, values[key]])),
      set: async (entries) => { if (sync && failSync) throw new Error(failSync); if (sync) writes++; Object.assign(values, entries); },
      remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
    };
  }
  vm.runInNewContext(fs.readFileSync(__dirname + '/../extension/background.js', 'utf8'), {
    WC, importScripts() {}, AbortSignal, Date, Map, Object, Promise, String, Error, TextEncoder, JSON,
    fetch: (...args) => { fetches++; return fetcher(...args); },
    chrome: { storage: { local: area(localData), sync: area(data, true) }, runtime: { id: 'test', getURL: (name) => 'chrome-extension://test/' + name,
      onMessage: { addListener: (fn) => { listener = fn; } } } },
  });
  const sender = { id: 'test', url: 'chrome-extension://test/popup.html' };
  const send = (message, source = sender) => new Promise((resolve) => listener(message, source, resolve));
  return { data, localData, send, fetches: () => fetches, writes: () => writes, failSync: (message) => { failSync = message; } };
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
  for (let index = 0; index < 210; index++) h.localData[`type:old-${index}`] = { type: 'Manga', at: index };
  await h.send({ action: 'resolve', id });
  assert.equal(Object.keys(h.localData).filter((key) => key.startsWith('type:')).length, 200);
  assert.equal(h.data[WC.seriesKey(other)].style, 'single_page');
  h.localData[`type:${id}`].at = 0;
  await h.send({ action: 'resolve', id });
  assert.equal(h.fetches(), 2);
});

test('legacy local preferences migrate once without overwriting cloud preferences or syncing cache', async () => {
  const second = '01J76XYEMXXHG63FKC2DMTNC7C';
  const h = harness(undefined, { localData: {
    settings: { enabled: false }, [WC.seriesKey(id)]: { style: 'single_page', title: 'Legacy' },
    [WC.seriesKey(second)]: { style: 'double_page', title: 'Other' }, [`type:${id}`]: { type: 'Manga', at: Date.now() },
  }, syncData: { settings: { enabled: true }, [WC.seriesKey(id)]: { style: 'double_page_v2', title: 'Cloud' } } });
  const result = await h.send({ action: 'getSettings' });
  assert.equal(result.settings.enabled, true);
  assert.equal(h.data[WC.seriesKey(id)].style, 'double_page_v2');
  assert.equal(h.data[WC.seriesKey(second)].style, 'double_page');
  assert.equal(h.data[`type:${id}`], undefined);
  assert.equal(h.localData.syncMigrationV1, true);
  assert.equal(h.localData[WC.seriesKey(id)].style, 'single_page', 'Recovery copy is retained');
  await h.send({ action: 'removeOverride', id });
  assert.equal((await h.send({ action: 'getSettings' })).overrides.some((value) => value.id === id), false);
});
test('sync quota failures keep saved data intact and return a useful error', async () => {
  const h = harness(undefined, { maxItems: 1 });
  await h.send({ action: 'setSettings', settings: { defaults: { Manga: 'single_page' } } });
  const result = await h.send({ action: 'setOverride', id, style: 'double_page' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Sync is full/);
  assert.equal(h.data.settings.defaults.Manga, 'single_page');
  assert.equal(h.data[WC.seriesKey(id)], undefined);
});
test('migration quota failure keeps legacy overrides usable and deletions can free capacity', async () => {
  const second = '01J76XYEMXXHG63FKC2DMTNC7C';
  const h = harness(undefined, { maxItems: 1, localData: {
    [WC.seriesKey(id)]: { style: 'single_page' }, [WC.seriesKey(second)]: { style: 'double_page' },
  } });
  const pending = await h.send({ action: 'getSettings' });
  assert.equal(pending.overrides.length, 2);
  assert.match(pending.warning, /still only on this device/);
  assert.equal(h.localData.syncMigrationV1, undefined);
  assert.equal((await h.send({ action: 'resolve', id })).style, 'single_page');
  await h.send({ action: 'removeOverride', id });
  const result = await h.send({ action: 'getSettings' });
  assert.equal(result.warning, null);
  assert.equal(result.overrides.length, 1);
  assert.equal(h.localData.syncMigrationV1, true);
});
test('repeated saves avoid consuming sync writes; rate-limit errors do not claim success', async () => {
  const h = harness();
  const message = { action: 'setOverride', id, style: 'single_page', title: 'Title' };
  await h.send(message);
  await h.send(message);
  assert.equal(h.writes(), 1);
  h.failSync('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded');
  const result = await h.send({ ...message, style: 'double_page' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Wait a minute/);
  assert.equal(h.data[WC.seriesKey(id)].style, 'single_page');
});
test('remote updates and deletions are read from sync; old migration backup cannot resurrect them', async () => {
  const h = harness(undefined, { localData: { syncMigrationV1: true, [WC.seriesKey(id)]: { style: 'single_page' } } });
  h.data[WC.seriesKey(id)] = { style: 'double_page' };
  assert.equal((await h.send({ action: 'resolve', id })).style, 'double_page');
  delete h.data[WC.seriesKey(id)];
  assert.equal((await h.send({ action: 'resolve', id })).style, 'double_page_v2');
});

test('sync byte limits count multibyte titles and keep the previous override on failure', async () => {
  const h = harness(undefined, { maxBytes: 150 });
  await h.send({ action: 'setOverride', id, style: 'single_page', title: 'Readable title' });
  const result = await h.send({ action: 'setOverride', id, style: 'double_page', title: '🙂'.repeat(40) });
  assert.equal(result.ok, false);
  assert.match(result.error, /Sync is full/);
  assert.equal(h.data[WC.seriesKey(id)].style, 'single_page');
});
