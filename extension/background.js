'use strict';
importScripts('core.js');

const inflight = new Map();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE = 200;
// All writes pass through the worker. Serialize read/modify/write and cache pruning.
let queue = Promise.resolve();
function serialized(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}
async function metadata(id) {
  const key = `type:${id}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (WC.TYPES.includes(cached?.type) && Date.now() - cached.at < CACHE_TTL) return cached.type;
  if (inflight.has(id)) return inflight.get(id);
  const request = (async () => {
    const response = await fetch(`https://weebcentral.com/series/${id}`, {
      credentials: 'omit', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Series metadata unavailable (${response.status}).`);
    const type = WC.typeFromHtml(await response.text());
    if (type) await serialized(async () => {
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter((item) => item.startsWith('type:') && item !== key)
        .sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0));
      if (keys.length >= MAX_CACHE) await chrome.storage.local.remove(keys.slice(0, keys.length - MAX_CACHE + 1));
      await chrome.storage.local.set({ [key]: { type, at: Date.now() } });
    });
    return type;
  })().finally(() => inflight.delete(id));
  inflight.set(id, request);
  return request;
}
function trusted(sender) {
  return sender.id === chrome.runtime.id && (
    sender.url === chrome.runtime.getURL('popup.html') ||
    /^https:\/\/(?:www\.)?weebcentral\.com\/(?:chapters|series)\//.test(sender.url || '')
  );
}
async function handle(message, sender) {
  if (!trusted(sender) || !message || typeof message !== 'object') throw new Error('Unsupported request.');
  const popup = sender.url === chrome.runtime.getURL('popup.html');
  if (message.action === 'getSettings') {
    const all = await chrome.storage.local.get(null);
    return { settings: WC.settings(all.settings), overrides: Object.entries(all)
      .filter(([key, value]) => key.startsWith('series:') && WC.isId(key.slice(7)) && WC.isStyle(value?.style))
      .map(([key, value]) => ({ id: key.slice(7), ...value })) };
  }
  if (message.action === 'setSettings' && popup) return serialized(async () => {
    const config = WC.settings(message.settings);
    await chrome.storage.local.set({ settings: config });
    return { settings: config };
  });
  if (!WC.isId(message.id)) throw new Error('Invalid series ID.');
  const id = message.id.toUpperCase();
  const key = WC.seriesKey(id);
  if (message.action === 'resolve') {
    const initial = await chrome.storage.local.get(['settings', key, `type:${id}`]);
    const initialConfig = WC.settings(initial.settings);
    if (!initialConfig.enabled || WC.isStyle(initial[key]?.style)) {
      // Saved overrides work immediately even when metadata is unavailable/offline.
      const cached = initial[`type:${id}`];
      const type = WC.TYPES.includes(cached?.type) && Date.now() - cached.at < CACHE_TTL ? cached.type : null;
      return { type, warning: null, enabled: initialConfig.enabled, override: initial[key] || null,
        style: WC.effectiveStyle(initialConfig, type, initial[key]) };
    }
    let type = null;
    let warning = null;
    try { type = await metadata(id); } catch (error) { warning = error.message; }
    // Read preferences after the network request so newer manual changes win.
    const saved = await chrome.storage.local.get(['settings', key]);
    const config = WC.settings(saved.settings);
    return { type, warning, enabled: config.enabled, override: saved[key] || null,
      style: WC.effectiveStyle(config, type, saved[key]) };
  }
  if (message.action === 'setOverride') return serialized(async () => {
    if (!WC.isStyle(message.style)) throw new Error('Invalid reading style.');
    const config = WC.settings((await chrome.storage.local.get('settings')).settings);
    if (!popup && !config.enabled) return { ignored: true };
    const override = { style: message.style, title: String(message.title || 'Untitled series').slice(0, 200) };
    await chrome.storage.local.set({ [key]: override });
    return { override };
  });
  if (message.action === 'removeOverride' && popup) return serialized(async () => {
    await chrome.storage.local.remove(key);
    return {};
  });
  throw new Error('Unsupported request.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then((result) => respond({ ok: true, ...result }),
    (error) => respond({ ok: false, error: error.message }));
  return true;
});
