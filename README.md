# WeebCentral Preferences

A Manifest V3 Chrome extension that applies a reading style by series type and remembers your choices for individual series.

| Series type | Initial default |
| --- | --- |
| Manga | **Double Page (MangaPlus)** |
| Manhwa | Long Strip |
| Manhua | Long Strip |

All three defaults can use any of WeebCentral's four native styles: Long Strip, Single Page, Double Page, or Double Page (MangaPlus).

## Install locally

1. Download or clone this repository and switch to the feature branch if the pull request has not been merged.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the repository's **`extension/` folder** (the folder containing `manifest.json`).
4. Reload any WeebCentral tabs that were already open, then pin the extension in the toolbar.

There is no build step and no account requirement. Node and npm are needed only for development/tests. A supplied extension ZIP should be extracted before using Load unpacked.

## Use

- Open a chapter. The extension finds its stable series ID and retrieves the series page's explicit Manga/Manhwa/Manhua metadata. It then selects the native reading style.
- Open the popup to edit type defaults and click **Save defaults**. Open readers update automatically.
- Change **Reading Style** in WeebCentral's own Preferences panel to save that choice for the current series automatically. It carries across chapters and browser restarts.
- Alternatively, pick a style under **Current series** in the popup and click **Save series preference**. This also works on a series page before opening its chapters.
- Select **Use type default** to remove a series override, or remove it from **Saved series overrides** in the popup.
- Turn off **Apply reading styles automatically** to pause applying styles and recording manual reader changes. Saved preferences are retained; popup edits still save.

An explicit series override wins over its type default. Unknown/unsupported types (including OEL), failed metadata requests, and changed reader markup leave the native reader unchanged unless a known series override is available. The popup explains errors and offers explicit overrides.

Only Reading Style is managed. Reading Direction, Image Fit, gaps, bookmarks, and navigation stay under WeebCentral's native controls. WeebCentral may persist the last selected style itself, so disabling/removing the extension does not undo that native setting. The first visit can briefly show the site's current style while metadata loads.

## Data and permissions

Preferences and series overrides are stored in `chrome.storage.local`, on this device; they do not sync between devices. A successful series-type lookup is cached for seven days (up to 200 series). Saved overrides work without a metadata network request, including offline when the reader page is otherwise available.

Permissions are limited to `storage` and HTTPS access to `weebcentral.com` and `www.weebcentral.com`. Site access lets the content script operate on reader/series pages and the worker fetch public series metadata. Metadata fetches omit credentials. The extension has no analytics, account access, external messaging, or remote extension code. Uninstalling it removes its Chrome storage; WeebCentral's own persisted settings are separate.

## Development and tests

Use Node.js 24 or later:

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

`npm run check` checks manifest references and JavaScript syntax. Unit tests cover settings validation, native style values, stable IDs, type detection, override precedence, unknown types, worker message validation, cache pruning, concurrent writes, offline handling, and slow metadata requests. Browser tests load the real extension in Chromium and exercise Alpine 3.14.1 / HTMX 2.0.3 (the versions observed in the site), native style changes, popup persistence, pause, unknown types, and manual choices during delayed detection.

`npm run test:live` is an optional public-site smoke check. It uses a temporary browser profile and blocks ads, tracking, and image pixels while checking the site's native image-layout response. Cloudflare can block automated browsers; such a block is a validation limitation, not a passing test. The latest check on 2026-10-09 reached a Cloudflare “Attention Required” page, so a normal Chrome session should complete the [manual checklist](docs/reader-integration.md#manual-review-checklist) before release.

GitHub Actions runs deterministic syntax, unit, and browser tests; it does not depend on live WeebCentral availability.

## Source layout

- `extension/`: loadable extension; no production dependencies.
- `extension/core.js`: validated settings, ID/type parsing and precedence.
- `extension/background.js`: local storage, public metadata lookup, message validation.
- `extension/reader-dom.js` and `content.js`: native reader adapter, asynchronous readiness, trusted manual changes.
- `extension/popup.*`: settings and saved-series management.
- `tests/`: unit tests, sanitized markup fixture and extension browser integration tests.
- [Reader implementation notes](docs/reader-integration.md): inspected source, compatibility boundaries and manual checks.

This extension is independent of WeebCentral and is not a Chrome Web Store release.
