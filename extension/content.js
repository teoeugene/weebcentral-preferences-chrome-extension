(function () {
  'use strict';
  let current = null;
  let generation = 0;
  let timer;
  let manualRevision = 0;
  let status = { series: null, type: null, state: 'loading', detail: 'Looking for series metadata…' };
  async function send(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || 'Extension unavailable. Reload this tab.');
    return result;
  }
  async function refresh() {
    const token = ++generation;
    const revision = manualRevision;
    const next = WCReader.series(document, location.href);
    current = next;
    status = { series: next, type: null, state: 'loading', detail: 'Detecting series type…' };
    if (!next) {
      status.state = 'unsupported';
      status.detail = 'Open a WeebCentral series or chapter.';
      return;
    }
    try {
      const resolved = await send({ action: 'resolve', id: next.id });
      if (token !== generation || revision !== manualRevision) return;
      status = { series: next, ...resolved, state: 'ready', detail: '' };
      if (!resolved.enabled) { status.state = 'paused'; status.detail = 'Automatic styles are paused.'; return; }
      if (!location.pathname.startsWith('/chapters/')) {
        status.detail = 'Preference will apply when you open a chapter.';
        return;
      }
      if (!resolved.style) {
        status.state = 'unknown';
        status.detail = resolved.warning || 'Type not detected. Choose a series override; the reader is unchanged.';
        return;
      }
      // HTMX initially inserts the fragment asynchronously. Retry for at most 10 seconds.
      for (let attempt = 0; attempt < 100; attempt++) {
        if (token !== generation || revision !== manualRevision) return;
        if (WCReader.ready(document)) {
          const applied = await WCReader.apply(document, resolved.style,
            () => token === generation && revision === manualRevision);
          if (token !== generation || revision !== manualRevision) return;
          status.state = applied ? 'applied' : 'error';
          status.detail = applied ? `Using ${WC.STYLES[resolved.style]}.` : 'Native reader controls did not update. Reload to retry.';
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      status.state = 'error';
      status.detail = 'Native reader controls are unavailable. Reload to retry.';
    } catch (error) {
      if (token === generation) { status.state = 'error'; status.detail = error.message; }
    }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 50); }
  document.addEventListener('change', (event) => {
    if (!event.isTrusted || !event.target.matches(WCReader.RADIO) || !WC.isStyle(event.target.value)) return;
    const series = WCReader.series(document, location.href);
    if (!series) return;
    // Cancel any pending auto-apply immediately, including a slow metadata response.
    manualRevision++;
    send({ action: 'setOverride', id: series.id, title: series.title, style: event.target.value })
      .then(schedule).catch((error) => { status.state = 'error'; status.detail = error.message; });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.settings || (current && changes[WC.seriesKey(current.id)]))) {
      // Cancel an in-flight apply before scheduling the replacement.
      generation++;
      schedule();
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.action === 'status') respond(status);
    if (message.action === 'refresh') { schedule(); respond({ ok: true }); }
  });
  // Normal chapter links navigate the document. Also support HTMX replacements and history navigation.
  const observer = new MutationObserver(() => {
    const next = WCReader.series(document, location.href);
    if (next?.id !== current?.id) { generation++; schedule(); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  refresh();
})();
