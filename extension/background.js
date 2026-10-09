'use strict';
importScripts('core.js');

const inflight = new Map();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE = 200;
const MIGRATION_KEY = 'syncMigrationV1';
let migrationPromise;
// Serialize writes on this device. Separate sync keys prevent cross-series overwrites.
let queue = Promise.resolve();
function serialized(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}
function preferenceEntries(all) {
  const result = {};
  if (Object.hasOwn(all, 'settings')) result.settings = WC.settings(all.settings);
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('series:') && WC.isId(key.slice(7)) && WC.isStyle(value?.style)) {
      result[key] = { style: value.style, title: String(value.title || 'Untitled series').slice(0, 200) };
    }
  }
  return result;
}
async function writeSync(values) {
  if (!Object.keys(values).length) return;
  const before = await chrome.storage.sync.get(null);
  const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value)));
  if (!Object.keys(changed).length) return;
  const after = { ...before, ...changed };
  const encoder = new TextEncoder();
  const bytes = ([key, value]) => key.length + encoder.encode(JSON.stringify(value)).length;
  const entries = Object.entries(after);
  if (entries.length > chrome.storage.sync.MAX_ITEMS || entries.some((entry) => bytes(entry) > chrome.storage.sync.QUOTA_BYTES_PER_ITEM)
    || entries.reduce((total, entry) => total + bytes(entry), 0) > chrome.storage.sync.QUOTA_BYTES) {
    throw new Error('Chrome Sync is full. Remove some saved series overrides and try again.');
  }
  try { await chrome.storage.sync.set(changed); }
  catch (error) {
    if (/QUOTA_BYTES|MAX_ITEMS/.test(error.message)) throw new Error('Chrome Sync is full. Remove some saved series overrides and try again.');
    if (/MAX_WRITE|rate|throttl/i.test(error.message)) throw new Error('Too many changes for Chrome Sync. Wait a minute and try again.');
    throw error;
  }
}
async function ensureMigration() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = serialized(async () => {
    const local = await chrome.storage.local.get(null);
    if (local[MIGRATION_KEY]) return { warning: null };
    const legacy = preferenceEntries(local);
    const synced = await chrome.storage.sync.get(null);
    // Existing cloud preferences win. Never overwrite a preference from another device.
    const missing = Object.fromEntries(Object.entries(legacy).filter(([key]) => !Object.hasOwn(synced, key)));
    try {
      await writeSync(missing);
      await chrome.storage.local.set({ [MIGRATION_KEY]: true });
      // Keep the old local values as a recovery copy, but never read them again after success.
      return { warning: null };
    } catch (error) {
      // Retry on a future request. Keep legacy choices usable and visible if migration fails.
      return { warning: `Some older preferences are still only on this device. ${error.message}` };
    }
  }).finally(() => { migrationPromise = null; });
  return migrationPromise;
}
async function preferences() {
  const [local, synced] = await Promise.all([chrome.storage.local.get(null), chrome.storage.sync.get(null)]);
  return local[MIGRATION_KEY] ? synced : { ...preferenceEntries(local), ...synced };
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
  const migration = await ensureMigration();
  if (message.action === 'getSettings') {
    const all = await preferences();
    return { settings: WC.settings(all.settings), warning: migration.warning, overrides: Object.entries(preferenceEntries(all))
      .filter(([key]) => key.startsWith('series:')).map(([key, value]) => ({ id: key.slice(7), ...value })) };
  }
  if (message.action === 'setSettings' && popup) return serialized(async () => {
    const config = WC.settings(message.settings);
    await writeSync({ settings: config });
    return { settings: config };
  });
  if (!WC.isId(message.id)) throw new Error('Invalid series ID.');
  const id = message.id.toUpperCase();
  const key = WC.seriesKey(id);
  if (message.action === 'resolve') {
    const initial = await preferences();
    const initialConfig = WC.settings(initial.settings);
    if (!initialConfig.enabled || WC.isStyle(initial[key]?.style)) {
      const cached = (await chrome.storage.local.get(`type:${id}`))[`type:${id}`];
      const type = WC.TYPES.includes(cached?.type) && Date.now() - cached.at < CACHE_TTL ? cached.type : null;
      return { type, warning: migration.warning, enabled: initialConfig.enabled, override: initial[key] || null,
        style: WC.effectiveStyle(initialConfig, type, initial[key]) };
    }
    let type = null;
    let warning = migration.warning;
    try { type = await metadata(id); } catch (error) { warning = error.message; }
    const saved = await preferences();
    const config = WC.settings(saved.settings);
    return { type, warning, enabled: config.enabled, override: saved[key] || null,
      style: WC.effectiveStyle(config, type, saved[key]) };
  }
  if (message.action === 'setOverride') return serialized(async () => {
    if (!WC.isStyle(message.style)) throw new Error('Invalid reading style.');
    const config = WC.settings((await preferences()).settings);
    if (!popup && !config.enabled) return { ignored: true };
    const override = { style: message.style, title: String(message.title || 'Untitled series').slice(0, 200) };
    await writeSync({ [key]: override });
    return { override };
  });
  if (message.action === 'removeOverride' && popup) return serialized(async () => {
    await chrome.storage.sync.remove(key);
    // Also remove the legacy copy so failed migration cannot resurrect a deleted override.
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
