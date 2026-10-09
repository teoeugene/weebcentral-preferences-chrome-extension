'use strict';
const byId = (id) => document.getElementById(id);
let config;
let current;
let tabId;
let busy = false;
let dirtySeries = false;
const dirtyDefaults = new Set();
let syncRefreshTimer;
for (const id of [...WC.TYPES, 'series-style']) {
  const select = byId(id);
  if (id === 'series-style') select.add(new Option('Use type default', 'auto'));
  for (const [value, label] of Object.entries(WC.STYLES)) select.add(new Option(label, value));
}
for (const type of WC.TYPES) byId(type).addEventListener('change', () => dirtyDefaults.add(type));
byId('series-style').addEventListener('change', () => { dirtySeries = true; });
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Could not save preferences.');
  return response;
}
function feedback(text) { byId('feedback').textContent = text; }
function setBusy(value) {
  busy = value;
  for (const id of ['enabled', ...WC.TYPES, 'save-defaults']) byId(id).disabled = value || !config;
  for (const id of ['series-style', 'save-series']) byId(id).disabled = value || !current;
  for (const button of byId('overrides').querySelectorAll('button')) button.disabled = value;
}
async function renderOverrides() {
  const result = await send({ action: 'getSettings' });
  byId('sync-warning').textContent = result.warning || '';
  byId('sync-warning').hidden = !result.warning;
  byId('count').textContent = String(result.overrides.length);
  byId('overrides').replaceChildren();
  for (const item of result.overrides.sort((a, b) => a.title.localeCompare(b.title))) {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.textContent = `${item.title} · ${WC.STYLES[item.style]}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Use type default';
    button.setAttribute('aria-label', `Remove override for ${item.title}`);
    button.addEventListener('click', () => run(async () => {
      await send({ action: 'removeOverride', id: item.id });
      if (current?.id === item.id) { byId('series-style').value = 'auto'; dirtySeries = false; }
      await renderOverrides();
      feedback('Series override removed.');
    }));
    li.append(title, button);
    byId('overrides').append(li);
  }
}
async function currentStatus() {
  if (!tabId) return;
  try {
    const status = await chrome.tabs.sendMessage(tabId, { action: 'status' });
    current = status?.series || null;
    if (current) {
      byId('current-title').textContent = `${current.title} · ${status.type || 'Type unknown'}`;
      byId('current-detail').textContent = status.detail || 'Uses the series override or type default.';
      if (!dirtySeries) byId('series-style').value = WC.isStyle(status.override?.style) ? status.override.style : 'auto';
    }
  } catch {
    byId('current-detail').textContent = 'If this tab was open during installation, reload it first.';
  }
}
async function run(task) {
  if (busy) return;
  setBusy(true);
  feedback('Saving…');
  try { await task(); } catch (error) { feedback(error.message); }
  finally { setBusy(false); }
}
byId('save-defaults').addEventListener('click', () => run(async () => {
  const result = await send({ action: 'setSettings', settings: {
    enabled: byId('enabled').checked,
    defaults: Object.fromEntries(WC.TYPES.map((type) => [type, byId(type).value])),
  } });
  config = result.settings;
  dirtyDefaults.clear();
  feedback('Defaults saved. Open readers update automatically.');
}));
byId('enabled').addEventListener('change', () => run(async () => {
  config = (await send({ action: 'setSettings', settings: { ...config, enabled: byId('enabled').checked } })).settings;
  feedback(config.enabled ? 'Automatic styles enabled.' : 'Automatic styles paused.');
}));
byId('save-series').addEventListener('click', () => run(async () => {
  const style = byId('series-style').value;
  await send(style === 'auto' ? { action: 'removeOverride', id: current.id } :
    { action: 'setOverride', id: current.id, title: current.title, style });
  dirtySeries = false;
  await renderOverrides();
  feedback(style === 'auto' ? 'Using the type default.' : 'Series preference saved.');
}));
function refreshSyncedPreferences() {
  clearTimeout(syncRefreshTimer);
  syncRefreshTimer = setTimeout(async () => {
    if (busy) { refreshSyncedPreferences(); return; }
    try {
      const result = await send({ action: 'getSettings' });
      config = result.settings;
      byId('enabled').checked = config.enabled;
      for (const type of WC.TYPES) if (!dirtyDefaults.has(type)) byId(type).value = config.defaults[type];
      await currentStatus();
      await renderOverrides();
      setBusy(false);
    } catch (error) { feedback(error.message); }
  }, 50);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some((key) => key === 'settings' || key.startsWith('series:'))) refreshSyncedPreferences();
});
(async () => {
  setBusy(true);
  try {
    config = (await send({ action: 'getSettings' })).settings;
    byId('enabled').checked = config.enabled;
    for (const type of WC.TYPES) byId(type).value = config.defaults[type];
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    await currentStatus();
    await renderOverrides();
  } catch (error) { feedback(error.message); }
  finally { setBusy(false); }
})();
