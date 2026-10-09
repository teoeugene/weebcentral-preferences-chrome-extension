/* Shared by the popup, isolated content script, service worker, and tests. */
(function (root) {
  'use strict';
  const STYLES = Object.freeze({
    long_strip: 'Long Strip',
    single_page: 'Single Page',
    double_page: 'Double Page',
    double_page_v2: 'Double Page (MangaPlus)',
  });
  const TYPES = Object.freeze(['Manga', 'Manhwa', 'Manhua']);
  const DEFAULTS = Object.freeze({ Manga: 'double_page_v2', Manhwa: 'long_strip', Manhua: 'long_strip' });
  const isStyle = (value) => Object.hasOwn(STYLES, value);
  const isId = (value) => typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value);
  const seriesKey = (id) => `series:${id.toUpperCase()}`;
  function settings(value) {
    return {
      version: 1,
      enabled: value?.enabled !== false,
      defaults: Object.fromEntries(TYPES.map((type) => [type,
        isStyle(value?.defaults?.[type]) ? value.defaults[type] : DEFAULTS[type]])),
    };
  }
  function seriesFromUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !['weebcentral.com', 'www.weebcentral.com'].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/series\/([^/]+)(?:\/|$)/);
      return match && isId(match[1]) ? match[1].toUpperCase() : null;
    } catch { return null; }
  }
  function typeFromHtml(html) {
    // Match the site's explicit type filter link; never infer type from a title/comment.
    const values = [...html.matchAll(/<a\b[^>]*href=["'][^"']*[?&](?:amp;)?included_type=(Manga|Manhwa|Manhua)(?:[&#"'])[^>]*>\s*\1\s*<\/a>/gi)]
      .map((match) => TYPES.find((type) => type.toLowerCase() === match[1].toLowerCase()));
    const unique = [...new Set(values)];
    return unique.length === 1 ? unique[0] : null;
  }
  function effectiveStyle(config, type, override) {
    if (!config.enabled) return null;
    if (isStyle(override?.style)) return override.style;
    return TYPES.includes(type) ? config.defaults[type] : null;
  }
  const api = { STYLES, TYPES, DEFAULTS, isStyle, isId, seriesKey, settings, seriesFromUrl, typeFromHtml, effectiveStyle };
  root.WC = Object.freeze(api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
