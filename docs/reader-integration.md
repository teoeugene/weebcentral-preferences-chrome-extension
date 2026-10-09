# Reader integration and review notes

## Inspected implementation (2026-10-09)

Public source was inspected directly from:

- [Blue Box chapter 193](https://weebcentral.com/chapters/01JS9VX7YBJ9W7GNSHBQDN8T31).
- [Blue Box series metadata](https://weebcentral.com/series/01J76XYEMXXHG63FKC2DMTNC7B/Blue-Box).
- [Native MangaPlus image fragment](https://weebcentral.com/chapters/01JS9VX7YBJ9W7GNSHBQDN8T31/images?reading_style=double_page_v2&current_page=1).
- The site's `/static/js/library.min.js` and `/static/js/script.min.js`.

The reader's `main[x-data="singlePageNavigation"]` defines `reading_style` with Alpine's `$persist('long_strip')`. Its Preferences modal contains radios with `x-model="reading_style"`:

| Label | Native value |
| --- | --- |
| Long Strip | `long_strip` |
| Single Page | `single_page` |
| Double Page | `double_page` |
| Double Page (MangaPlus) | `double_page_v2` |

Alpine assigns `name="reading_style"` to the radio group during initialization. The page also has a hidden named `reading_style` input with the same model. The initial empty `#chapter-images` section is replaced asynchronously using `htmx.ajax`, which sends `reading_style` and `current_page` to the chapter's `/images` endpoint. The returned fragment uses:

```html
hx-trigger="change from:[name='reading_style']"
hx-include="[name='reading_style'],[name='current_page']"
hx-swap="outerHTML"
```

The server produces the actual layouts. For inspected chapter 193, MangaPlus returns 11 spreads instead of 21 single pages. HTMX can send repeated `reading_style` parameters from its initial values and current named controls; a direct request verified that the site's endpoint uses the last value. Browser fixtures reproduce that behavior.

The series page's explicit Type field links to `/search?included_type=Manga` (or Manhwa/Manhua). Detection uses the type-filter link, not title keywords, image shape, publication language, or an assumed country. Reader nav links contain the stable 26-character series ID; title slugs and chapter IDs are not storage keys.

## Adapter behavior

The isolated content script waits for all four known native controls and an initialized, settled HTMX image fragment, then selects the desired radio and dispatches a normal `change` event. Alpine updates its model and HTMX reloads the native layout. A hidden-input fallback handles radios without Alpine's native trigger name. No page-world bridge, guessed persistence keys, injected scripts, replacement images, or custom spread renderer are needed.

Only trusted user radio changes are saved as overrides. Extension-generated events cannot create accidental overrides. Pending auto-apply is cancelled when the user makes a choice or settings change. Generation checks ignore stale metadata responses. The worker serializes writes and stores overrides under separate `series:<ID>` keys so simultaneous series writes do not clobber one another. Known overrides and paused automation bypass metadata fetches.

Missing controls time out after ten seconds. Metadata requests time out after eight seconds. Unknown types are not guessed; explicit overrides remain available. Requests that fail or produce unrecognized metadata are not cached. Successful type metadata is cached for seven days, with bounded pruning that never deletes preferences.

## Validation boundary

Deterministic browser tests use a real loaded MV3 extension, its worker and storage, plus native Alpine/HTMX versions observed on the site. A sanitized fixture retains the reader control and image-fragment structure; it does not copy chapter pixels, ads, tracking, or the entire site. The popup-as-test-tab substitutes only its active-tab query so it targets the reader as an action popup would.

Public HTML, library source and image-fragment requests succeeded during source inspection. The separate automated live browser smoke check was blocked by Cloudflare before reaching the reader. Therefore, fixture integration passing does not establish that every current live chapter or authenticated/resume flow has passed a real-user check.

## Manual review checklist

1. Load `extension/` unpacked in normal Chrome and reload WeebCentral.
2. Open Blue Box chapter 193: confirm Manga detection, MangaPlus selected and 11 rendered spreads. Advance/back through spreads with the native buttons.
3. Change the native style to Single Page: confirm 21 pages and a saved popup override. Open another Blue Box chapter and restart Chrome; confirm it is restored.
4. Open a known Manhwa and Manhua: confirm their own metadata selects Long Strip, independently of the Blue Box override.
5. Change each type default in the popup: confirm automatic readers update while series overrides stay in effect.
6. Remove Blue Box's override: confirm the Manga default returns. Pause automation, make a native choice and confirm no new override is saved. Re-enable it.
7. Check an unsupported type or metadata failure: confirm the reader remains usable and an explicit override works.
8. Check a bookmark/deep-link resume and `is_prev` chapter navigation: the site owns current-page/spread semantics and may clamp resumed pages when switching layouts.

If site selectors, model names, HTMX triggers, or supported native values change, update the adapter and fixtures after inspecting the new live source.
