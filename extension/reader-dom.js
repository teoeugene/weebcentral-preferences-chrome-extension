(function (root) {
  'use strict';
  const RADIO = '#preference_modal input[type="radio"][x-model="reading_style"]';
  function series(document, url) {
    const ownId = root.WC.seriesFromUrl(url);
    if (ownId) return { id: ownId, title: document.querySelector('h1')?.textContent.trim() || 'Current series' };
    // Reader nav repeats this link above and below the images. Ignore sidebar/recommendation links.
    const links = [...document.querySelectorAll('main a[href]')];
    const link = links.find((item) => root.WC.seriesFromUrl(item.href));
    return link ? { id: root.WC.seriesFromUrl(link.href), title: link.textContent.trim() || 'Current series' } : null;
  }
  function controls(document) {
    return [...document.querySelectorAll(RADIO)].filter((input) => root.WC.isStyle(input.value));
  }
  function ready(document) {
    const images = document.querySelector('#chapter-images[hx-get]');
    return controls(document).length === 4 && !!images
      && !images.matches('.htmx-added, .htmx-settling, .htmx-swapping, .htmx-request')
      && !!document.querySelector('input[name="reading_style"][x-model="reading_style"]');
  }
  async function apply(document, style, stillCurrent = () => true) {
    const radio = controls(document).find((input) => input.value === style);
    const hidden = document.querySelector('input[name="reading_style"][x-model="reading_style"]');
    if (!radio || !hidden || !ready(document)) return false;
    if (radio.checked && hidden.value === style) return true;
    radio.checked = true;
    radio.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    // Alpine assigns name="reading_style" to its radios and updates the hidden x-model
    // on the next reactive tick. HTMX listens to named controls in the swapped fragment.
    await new Promise((resolve) => document.defaultView.setTimeout(resolve, 0));
    if (!stillCurrent() || hidden.value !== style) return false;
    // Use the hidden control only if the site's radio has no native HTMX trigger name.
    if (radio.name !== 'reading_style') hidden.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    return true;
  }
  root.WCReader = { RADIO, series, controls, ready, apply };
  if (typeof module !== 'undefined') module.exports = root.WCReader;
})(globalThis);
