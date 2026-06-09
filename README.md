# MULTISEARCH

> Right-click context-menu search for Chromium browsers. Categories, multi-fire, drag-reorder, omnibox keyword, OpenSearch auto-detect, URL-based detect fallback, reverse image search on right-click, click-to-edit names and nicks, manual URL templater, full import/export. Local-first, no telemetry, no servers, no analytics.

![version](https://img.shields.io/badge/version-0.2.3-ffb000?style=flat-square)
![manifest](https://img.shields.io/badge/manifest-v3-ffb000?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-ffb000?style=flat-square)

<p align="center"><img src="ext/icons/icon128.png" width="96" alt="MULTISEARCH"></p>

## What it does

Highlight text on any page, right-click, and either fire one saved search engine or every engine in an entire category in parallel tabs. Right-click on an image and the same submenu pops up — but populated with your reverse-image-search engines, ready to throw the image URL at any (or all) of them. Type a short keyword + nick in the address bar for the same thing from the keyboard. Organize hundreds of engines under your own categories. Everything draggable. Everything exportable. Everything local.

Built and tested in [Thorium](https://thorium.rocks/). Works in Chrome, Brave, Edge, Vivaldi, Opera, and other Chromium-based browsers. Firefox is not supported (different manifest format).

## Features

### Searching

| | |
|---|---|
| **Text right-click → search** | Highlight text, right-click, pick a saved engine. Or pick a category to expand and fire any single engine or `▶ SEARCH ALL (N)` to open all of them at once in parallel tabs. |
| **Image right-click → reverse search** | Right-click any image — including thumbnails on Reddit, eBay, shopping sites, etc. — and the MULTISEARCH submenu populates with your reverse-image engines. Works on real `<img>` tags, CSS background-image styled thumbnails, lazy-loaded `data-src` images, and `<picture>` element sources. |
| **Omnibox keyword** | Type the keyword (default `ms`) + space + a nick to search from the address bar. `ms gh anthropic` searches your engine with nick `gh`. `ms dev rust async` fires every engine in your `dev` category. Live suggestions appear as you type. |

### Detection (auto-add engines from any site)

When you right-click on a page area (no text selected, no image) and pick **DETECT ENGINES ON THIS PAGE**, MULTISEARCH tries three things in order:

1. **OpenSearch tag scan** — looks for `<link rel="search">` in the page HTML and fetches the descriptor XML
2. **Common-path fallback** — tries `/opensearch.xml`, `/search.xml`, `/opensearchdescription.xml` on the page's domain (catches sites that host the file but don't advertise it in HTML, like Google)
3. **URL-based inference** — if the page URL contains search-like query parameters (`?q=`, `?st=`, `?_nkw=`, etc.), it templates the URL automatically by swapping the search term for `%s`. This works on sites like ShopGoodwill, eBay, Amazon, etc. that don't publish OpenSearch at all

Each detected engine appears as an editable card. Pick a category (or create one inline), tweak the name/nick/URL if you want, click **+ ADD**. Or just **ADD ALL** to bulk-import everything detected.

### Organization

| | |
|---|---|
| **Categories** | Group engines into named buckets. Each category gets a nick for omnibox use. |
| **Drag-reorder** | Everything draggable — engines within a category, engines between categories, categories among themselves, engines back to the root. |
| **Inline category creation** | Add a new category directly from the engine-edit dropdown without leaving your flow. |
| **Click-to-edit** | Click directly on any engine's name or nick to edit it inline. Enter saves, Escape cancels. No need to open the full edit modal for quick renames. |
| **Three sort modes** | Sort everything alphabetically with categories first, sort everything intermixed alphabetically, or keep your custom drag order. |
| **Expand / Collapse all** | Two buttons in the status bar to expand or collapse every category at once. |
| **UNCATEGORIZED folder** | Settings toggle — when enabled, all standalone (no-category) engines get bundled visually under a virtual `[UNCATEGORIZED]` folder. Off by default. |

### Maintenance

| | |
|---|---|
| **FIND BROKEN button** | Scans every engine for URLs that look corrupted (adjacent `%s` placeholders or 5+ of them — typical signs of a bad import from Chromium's internal template tokens). Jumps to the first one with a red flash so you can clean them up. |
| **Visual warning indicators** | Engines with broken URLs get a red ⚠ badge and red border. Engines flagged as reverse-image-search get an orange `IMG` badge. |
| **Import / Export** | Full JSON for backup and restore (round-trips all data including categories, settings, and flags). MERGE adds without overwriting; REPLACE wipes and replaces. |
| **Configurable omnibox keyword** | Change `ms` to any prefix you want via the editable text in the top bar. Saves a new manifest you swap in. |
| **Max-tabs safety cap** | Limit how many tabs a "SEARCH ALL" can open at once (default 8). Prevents accidentally firing 50 engines into 50 tabs. |
| **Auto-resizing popup window** | The right-click detect window auto-fits its content height — no empty space, no clipping. Uses `ResizeObserver` so it adjusts to any content change (cards added/removed, manual form opened, text wrapping). |
| **Local-first** | Everything stored in `chrome.storage.local`. No syncing to Google. No telemetry. No analytics. No servers. Data never leaves your machine unless you explicitly export it. |

## Install

### From a release (recommended)

1. Download the latest `multisearch.zip` from the [Releases](../../releases) page
2. Unzip it to a stable location (e.g. `C:\Tools\multisearch\`) — Chromium tracks the extension by its folder path, so don't put it somewhere you'll move or delete it later
3. Open `chrome://extensions` (or `thorium://extensions`)
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** → select the `ext` folder inside the unzipped directory
6. Pin the toolbar icon via the puzzle-piece menu

### What ships pre-loaded

First install comes with **44 engines across 9 categories** so the extension is useful immediately, no configuration needed:

| Category | Engines |
|---|---|
| **TOP SEARCH** | Google, DuckDuckGo, Bing, Brave Search, Startpage, Kagi |
| **AI** | ChatGPT, Claude, Perplexity, Phind |
| **VIDEO** | YouTube, Vimeo, Twitch |
| **SOCIAL** | Reddit, X (Twitter), TikTok, Instagram |
| **SHOPPING** | Amazon, eBay, Etsy, AliExpress |
| **MUSIC** | Spotify, SoundCloud, Bandcamp, YouTube Music |
| **KNOWLEDGE** | Wikipedia, Stack Overflow, GitHub, Wolfram Alpha |
| **ENTERTAINMENT** | IMDb, Letterboxd, Goodreads, Rotten Tomatoes |
| **REVERSE IMAGE** | Google Lens, Yandex Images, TinEye, Bing Visual, SauceNAO, IQDB, Ascii2d, trace.moe, Baidu Image, Sogou Pic, KarmaDecay |

Delete what you don't want, edit what you want to change, add your own anytime. Re-installing the extension brings these back; clearing data manually does not.

### From source

Same as above but use this repo directly: clone or download → load unpacked → point at the `ext/` folder.

### Reverse image starter pack (standalone)

A separate JSON file ships in this repo's [Releases](../../releases) page: `multisearch-reverse-image-pack.json`. Use it only if you already have existing data and want to add the reverse-image engines as a second category without affecting anything else. Import via Options → IMPORT → MERGE.

Fresh installs don't need this — the same 11 engines are already in your `REVERSE IMAGE` category by default.

## Quick usage

### Right-click

| Where you right-click | What happens |
|---|---|
| Highlighted text | MULTISEARCH menu shows your text engines + categories |
| An image (real `<img>`, CSS background, lazy-loaded, etc.) | MULTISEARCH menu shows your reverse-image engines |
| Empty page area | MULTISEARCH menu shows `DETECT ENGINES ON THIS PAGE` |

### Address bar (omnibox)

Type the keyword (default `ms`) + space:
- `ms gh anthropic` — searches whichever engine has nick `gh` for "anthropic"
- `ms dev react hooks` — fires every engine in the `dev` category for "react hooks"
- Live filtered suggestions appear as you type

### Manual templater (when detect fails)

Click the toolbar icon → **DETECT ENGINES** → if nothing's found, click **+ ADD MANUALLY FROM URL**. Paste a search-result URL plus the exact query you searched for. The matcher handles `%20`-encoded spaces, `+`-encoded spaces, and case-insensitive matching. Templated URL pops up as a card you can edit and add.

## Configuration

### Changing the omnibox keyword

Default is `ms`. To change:
1. In options, click the `ms` text next to **PREFIX** in the top bar
2. Type new prefix → Enter
3. The extension downloads an updated `manifest.json`
4. Replace your `ext/manifest.json` with the downloaded one
5. Reload the extension at `chrome://extensions`

(Chromium locks omnibox keywords to the manifest at install time, so a manifest swap is the only way.)

### Sort modes

Bottom of options → **SORT ▾** dropdown:
- **A→Z (CATEGORIES FIRST)** — categories sorted, then standalone engines sorted below
- **A→Z (EVERYTHING)** — categories and standalone engines intermixed alphabetically
- **CUSTOM** — whatever drag order you set (default)

### Importing browser-saved engines

Most Chromium browsers don't expose `chrome://settings/searchEngines` data to extensions (security restriction). But some browsers (Vivaldi, Brave) let you export your engines as a `.txt` file. MULTISEARCH's IMPORT modal accepts that format — paste the text, hit REPLACE or MERGE. The parser handles Chromium internal template tokens like `{google:baseURL}`, `{searchTerms}`, etc.

## Known limitations

- **No auto-import from `chrome://settings/searchEngines`** — Chromium does not expose this data to extension APIs at all. The closest substitutes are DETECT ON PAGE (works on most sites now thanks to the URL-inference fallback) and the manual URL templater. If your browser supports text export of engines, IMPORT accepts that format.
- **No cross-device sync** — by design, this is a local-first extension with no servers. Use EXPORT (JSON) → carry the file → IMPORT REPLACE on the other device to sync manually.
- **No Firefox support** — code is Chromium MV3. Would need a separate build with `browser_specific_settings`, event-page background, and AMO signing for distribution.
- **Image detection edge cases** — works on `<img>`, CSS `background-image`, lazy-loaded `data-src`, and `<picture>` sources. Doesn't currently handle canvas-rendered images, images inside iframes, or shadow-DOM-wrapped components. ~95% coverage of real-world sites.
- **Sites that override right-click** — some sites (Facebook, certain image hosts) prevent the browser context menu entirely. Nothing extensions can do about this.
- **Stock photo sites' reverse search** — Getty Images, Adobe Stock, Shutterstock, and WIPO Global Brand Database all require image *upload* (POST request with multipart/form-data) rather than accepting an image URL. Outside the scope of URL-template-based search.

## Repository layout

```
MULTISEARCH/
├── ext/                # extension source — load this folder unpacked
│   ├── manifest.json
│   ├── background.js   # service worker: context menus, omnibox, image source detection
│   ├── options.html    # full configuration UI
│   ├── options.css     # phosphor-amber brutalist styling
│   ├── options.js      # state, render, drag-drop, modals, import/export, inline edit
│   ├── popup.html      # toolbar popup & right-click detect window
│   ├── popup.css       # popup styling
│   ├── popup.js        # detect logic, OpenSearch fetch, URL inference, manual templater
│   └── icons/          # toolbar / extension icons
├── README.md
├── LICENSE             # MIT
└── .gitignore
```

## Development

- Edit files in `ext/`
- Go to `chrome://extensions` → click the circular reload arrow on the MULTISEARCH card
- Service worker logs: click the `service worker` link on the extensions card → DevTools opens
- Options page logs: F12 in the options tab
- Popup logs: right-click the toolbar icon → Inspect Popup

No build step, no bundler, no dependencies, no npm. Plain JavaScript.

## License

[MIT](LICENSE).

## Credit

Built collaboratively with [Claude](https://claude.ai).
