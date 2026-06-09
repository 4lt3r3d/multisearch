// ============================================================
// MULTISEARCH — background service worker (MV3)
// Handles: context menu build, omnibox, tab firing, storage sync
// ============================================================

const STORAGE_KEY = "ms_data_v1";
const PLACEHOLDER_RE = /\{searchTerms\}|%s/g;

// ---------- default seed ----------
// Shipped on first install so the extension is usable immediately. Users can
// modify or delete any of these freely — re-installing or clearing data brings
// them back. Reverse-image engines are flagged `imageSearch: true` so they
// only appear in the right-click-on-image context.
const DEFAULT_DATA = {
  schema: 1,
  settings: {
    openInBackground: false,
    confirmMultiOver: 12
  },
  items: [
    {
      id: cryptoId(), type: "category", name: "TOP SEARCH", nick: "top", expanded: true,
      children: [
        { id: cryptoId(), type: "engine", name: "Google",       nick: "g",     query: "https://www.google.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "DuckDuckGo",   nick: "ddg",   query: "https://duckduckgo.com/?q=%s" },
        { id: cryptoId(), type: "engine", name: "Bing",         nick: "bing",  query: "https://www.bing.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "Brave Search", nick: "brave", query: "https://search.brave.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "Startpage",    nick: "start", query: "https://www.startpage.com/sp/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "Kagi",         nick: "kagi",  query: "https://kagi.com/search?q=%s" }
      ]
    },
    {
      id: cryptoId(), type: "category", name: "AI", nick: "ai", expanded: true,
      children: [
        { id: cryptoId(), type: "engine", name: "ChatGPT",    nick: "gpt",    query: "https://chatgpt.com/?q=%s" },
        { id: cryptoId(), type: "engine", name: "Claude",     nick: "claude", query: "https://claude.ai/new?q=%s" },
        { id: cryptoId(), type: "engine", name: "Perplexity", nick: "pp",     query: "https://www.perplexity.ai/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "Phind",      nick: "phind",  query: "https://www.phind.com/search?q=%s" }
      ]
    },
    {
      id: cryptoId(), type: "category", name: "VIDEO", nick: "vid", expanded: true,
      children: [
        { id: cryptoId(), type: "engine", name: "YouTube", nick: "yt", query: "https://www.youtube.com/results?search_query=%s" },
        { id: cryptoId(), type: "engine", name: "Vimeo",   nick: "vm", query: "https://vimeo.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "Twitch",  nick: "tw", query: "https://www.twitch.tv/search?term=%s" }
      ]
    },
    {
      id: cryptoId(), type: "category", name: "SOCIAL", nick: "soc", expanded: true,
      children: [
        { id: cryptoId(), type: "engine", name: "Reddit",    nick: "r",  query: "https://www.reddit.com/search/?q=%s" },
        { id: cryptoId(), type: "engine", name: "X",         nick: "x",  query: "https://x.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "TikTok",    nick: "tt", query: "https://www.tiktok.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "Instagram", nick: "ig", query: "https://www.instagram.com/explore/tags/%s/" }
      ]
    },
    {
      id: cryptoId(), type: "category", name: "SHOPPING", nick: "shop", expanded: true,
      children: [
        { id: cryptoId(), type: "engine", name: "Amazon",     nick: "az",   query: "https://www.amazon.com/s?k=%s" },
        { id: cryptoId(), type: "engine", name: "eBay",       nick: "eb",   query: "https://www.ebay.com/sch/i.html?_nkw=%s" },
        { id: cryptoId(), type: "engine", name: "Etsy",       nick: "etsy", query: "https://www.etsy.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "AliExpress", nick: "ali",  query: "https://www.aliexpress.com/wholesale?SearchText=%s" }
      ]
    },
    {
      id: cryptoId(), type: "category", name: "MUSIC", nick: "mus", expanded: true,
      children: [
        { id: cryptoId(), type: "engine", name: "Spotify",       nick: "spot", query: "https://open.spotify.com/search/%s" },
        { id: cryptoId(), type: "engine", name: "SoundCloud",    nick: "sc",   query: "https://soundcloud.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "Bandcamp",      nick: "bc",   query: "https://bandcamp.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "YouTube Music", nick: "ytm",  query: "https://music.youtube.com/search?q=%s" }
      ]
    },
    {
      id: cryptoId(), type: "category", name: "KNOWLEDGE", nick: "ref", expanded: true,
      children: [
        { id: cryptoId(), type: "engine", name: "Wikipedia",      nick: "wp", query: "https://en.wikipedia.org/wiki/Special:Search?search=%s" },
        { id: cryptoId(), type: "engine", name: "Stack Overflow", nick: "so", query: "https://stackoverflow.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "GitHub",         nick: "gh", query: "https://github.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "Wolfram Alpha",  nick: "wa", query: "https://www.wolframalpha.com/input?i=%s" }
      ]
    },
    {
      id: cryptoId(), type: "category", name: "ENTERTAINMENT", nick: "ent", expanded: true,
      children: [
        { id: cryptoId(), type: "engine", name: "IMDb",            nick: "imdb", query: "https://www.imdb.com/find/?q=%s" },
        { id: cryptoId(), type: "engine", name: "Letterboxd",      nick: "lb",   query: "https://letterboxd.com/search/%s/" },
        { id: cryptoId(), type: "engine", name: "Goodreads",       nick: "gr",   query: "https://www.goodreads.com/search?q=%s" },
        { id: cryptoId(), type: "engine", name: "Rotten Tomatoes", nick: "rt",   query: "https://www.rottentomatoes.com/search?search=%s" }
      ]
    },
    {
      id: cryptoId(), type: "category", name: "REVERSE IMAGE", nick: "ri", expanded: true,
      children: [
        { id: cryptoId(), type: "engine", name: "Google Lens",         nick: "glens",   query: "https://lens.google.com/uploadbyurl?url=%s",                       imageSearch: true },
        { id: cryptoId(), type: "engine", name: "Yandex Images",       nick: "yaimg",   query: "https://yandex.com/images/search?rpt=imageview&url=%s",            imageSearch: true },
        { id: cryptoId(), type: "engine", name: "TinEye",              nick: "tineye",  query: "https://tineye.com/search?url=%s",                                 imageSearch: true },
        { id: cryptoId(), type: "engine", name: "Bing Visual Search",  nick: "bingimg", query: "https://www.bing.com/images/searchbyimage?cbir=sbi&imgurl=%s",     imageSearch: true },
        { id: cryptoId(), type: "engine", name: "SauceNAO",            nick: "snao",    query: "https://saucenao.com/search.php?url=%s",                           imageSearch: true },
        { id: cryptoId(), type: "engine", name: "IQDB",                nick: "iqdb",    query: "https://iqdb.org/?url=%s",                                         imageSearch: true },
        { id: cryptoId(), type: "engine", name: "Ascii2d",             nick: "a2d",     query: "https://ascii2d.net/search/url/%s",                                imageSearch: true },
        { id: cryptoId(), type: "engine", name: "trace.moe",           nick: "tmoe",    query: "https://trace.moe/?url=%s",                                        imageSearch: true },
        { id: cryptoId(), type: "engine", name: "Baidu Image",         nick: "bdimg",   query: "https://graph.baidu.com/upload?image=%s",                          imageSearch: true },
        { id: cryptoId(), type: "engine", name: "Sogou Pic",           nick: "sgimg",   query: "https://pic.sogou.com/ris?query=%s",                               imageSearch: true },
        { id: cryptoId(), type: "engine", name: "KarmaDecay (Reddit)", nick: "kdecay",  query: "http://karmadecay.com/index/?kdtoolver=b1&q=%s",                   imageSearch: true }
      ]
    }
  ]
};

function cryptoId() {
  // 12-char URL-safe random
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 12);
}

// ---------- storage helpers ----------
async function loadData() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY] && stored[STORAGE_KEY].schema === 1) {
    return stored[STORAGE_KEY];
  }
  // first run — seed defaults
  await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_DATA });
  return DEFAULT_DATA;
}

async function saveData(data) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

// ---------- URL building ----------
function buildUrl(template, term) {
  const encoded = encodeURIComponent(term);
  if (PLACEHOLDER_RE.test(template)) {
    return template.replace(PLACEHOLDER_RE, encoded);
  }
  // no placeholder: append as ?q=
  const sep = template.includes("?") ? "&" : "?";
  return template + sep + "q=" + encoded;
}

// ---------- context menu construction ----------
// Wrap create in a promise that swallows duplicate-id and similar transient errors
function createMenu(opts) {
  return new Promise((resolve) => {
    try {
      chrome.contextMenus.create(opts, () => {
        if (chrome.runtime.lastError) {
          // typical: duplicate id during a rebuild race — non-fatal, ignore
          // console.debug("ctxmenu create:", chrome.runtime.lastError.message);
        }
        resolve();
      });
    } catch (_e) {
      resolve();
    }
  });
}

// mutex: prevent concurrent rebuilds (which cause duplicate-id errors)
let rebuildLock = false;
let rebuildPending = false;

async function rebuildContextMenu() {
  if (rebuildLock) {
    rebuildPending = true;
    return;
  }
  rebuildLock = true;
  try {
    await _doRebuildContextMenu();
  } finally {
    rebuildLock = false;
    if (rebuildPending) {
      rebuildPending = false;
      // run again to pick up the change that came in mid-rebuild
      rebuildContextMenu();
    }
  }
}

async function _doRebuildContextMenu() {
  await chrome.contextMenus.removeAll();
  const data = await loadData();
  const useUncatFolder = !!(data.settings && data.settings.uncategorizedFolder);

  // helper: contexts for a single engine (image vs text)
  const engineContexts = (eng) => eng.imageSearch ? ["image"] : ["selection"];

  // helper: contexts a category submenu should have based on which engine types it contains
  const computeContexts = (children) => {
    const hasText = children.some(c => c.type === "engine" && !c.imageSearch);
    const hasImg  = children.some(c => c.type === "engine" && c.imageSearch);
    const ctx = [];
    if (hasText) ctx.push("selection");
    if (hasImg)  ctx.push("image");
    return ctx;
  };

  // root parent — shown for selection, image, or plain page right-click
  await createMenu({
    id: "ms-root",
    title: "MULTISEARCH",
    contexts: ["selection", "image", "page"]
  });

  // detect engines — only on plain page right-click, not on text or image
  await createMenu({
    id: "ms-detect",
    parentId: "ms-root",
    title: "\uD83D\uDD0D DETECT ENGINES ON THIS PAGE",
    contexts: ["page"]
  });

  // walk root items
  for (const item of data.items) {
    if (item.type === "separator") continue; // separators legacy
    if (item.type === "engine") {
      if (useUncatFolder) continue; // grouped under UNCATEGORIZED below
      await createMenu({
        id: `ms-engine|${item.id}`,
        parentId: "ms-root",
        title: item.name,
        contexts: engineContexts(item)
      });
      continue;
    }
    if (item.type === "category") {
      await _addCategoryMenu(item);
    }
  }

  // virtual UNCATEGORIZED submenu (only when setting on)
  if (useUncatFolder) {
    const standalone = data.items.filter(i => i.type === "engine");
    if (standalone.length > 0) {
      const cats = computeContexts(standalone);
      if (cats.length > 0) {
        const catParentId = "ms-cat|__uncategorized__";
        await createMenu({
          id: catParentId,
          parentId: "ms-root",
          title: "[UNCATEGORIZED]",
          contexts: cats
        });
        const textOnes = standalone.filter(e => !e.imageSearch);
        const imgOnes  = standalone.filter(e =>  e.imageSearch);
        if (textOnes.length > 0) {
          await createMenu({
            id: "ms-catall-text|__uncategorized__",
            parentId: catParentId,
            title: `\u25B6 SEARCH ALL (${textOnes.length})`,
            contexts: ["selection"]
          });
        }
        if (imgOnes.length > 0) {
          await createMenu({
            id: "ms-catall-image|__uncategorized__",
            parentId: catParentId,
            title: `\u25B6 SEARCH ALL (${imgOnes.length})`,
            contexts: ["image"]
          });
        }
        await createMenu({
          id: "ms-catsep|__uncategorized__",
          parentId: catParentId,
          type: "separator",
          contexts: cats
        });
        for (const eng of standalone) {
          await createMenu({
            id: `ms-engine|${eng.id}`,
            parentId: catParentId,
            title: eng.name,
            contexts: engineContexts(eng)
          });
        }
      }
    }
  }
}

// build one category submenu, splitting search-all by text/image where applicable
async function _addCategoryMenu(item) {
  const engineChildren = item.children.filter(c => c.type === "engine");
  const textOnes = engineChildren.filter(c => !c.imageSearch);
  const imgOnes  = engineChildren.filter(c =>  c.imageSearch);
  const cats = [];
  if (textOnes.length > 0) cats.push("selection");
  if (imgOnes.length > 0)  cats.push("image");
  if (cats.length === 0) return; // nothing to show

  const catParentId = `ms-cat|${item.id}`;
  await createMenu({
    id: catParentId,
    parentId: "ms-root",
    title: `[${item.name}]`,
    contexts: cats
  });

  if (textOnes.length > 0) {
    await createMenu({
      id: `ms-catall-text|${item.id}`,
      parentId: catParentId,
      title: `\u25B6 SEARCH ALL (${textOnes.length})`,
      contexts: ["selection"]
    });
  }
  if (imgOnes.length > 0) {
    await createMenu({
      id: `ms-catall-image|${item.id}`,
      parentId: catParentId,
      title: `\u25B6 SEARCH ALL (${imgOnes.length})`,
      contexts: ["image"]
    });
  }
  await createMenu({
    id: `ms-catsep|${item.id}`,
    parentId: catParentId,
    type: "separator",
    contexts: cats
  });

  for (const child of item.children) {
    if (child.type === "engine") {
      await createMenu({
        id: `ms-engine|${child.id}`,
        parentId: catParentId,
        title: child.name,
        contexts: child.imageSearch ? ["image"] : ["selection"]
      });
    }
  }
}

// ---------- engine lookup ----------
function findEngineById(data, id) {
  for (const item of data.items) {
    if (item.type === "engine" && item.id === id) return item;
    if (item.type === "category") {
      for (const child of item.children) {
        if (child.type === "engine" && child.id === id) return child;
      }
    }
  }
  return null;
}

function findCategoryById(data, id) {
  return data.items.find(i => i.type === "category" && i.id === id) || null;
}

function findCategoryByNick(data, nick) {
  return data.items.find(i => i.type === "category" && i.nick === nick) || null;
}

function findEngineByNick(data, nick) {
  for (const item of data.items) {
    if (item.type === "engine" && item.nick === nick) return item;
    if (item.type === "category") {
      for (const child of item.children) {
        if (child.type === "engine" && child.nick === nick) return child;
      }
    }
  }
  return null;
}

// ---------- firing ----------
async function fireEngine(engine, term, openInBackground) {
  const url = buildUrl(engine.query, term);
  await chrome.tabs.create({ url, active: !openInBackground });
}

async function fireCategory(category, term, openInBackground, maxTabs) {
  let engines = category.children.filter(c => c.type === "engine");
  if (typeof maxTabs === "number" && maxTabs > 0 && engines.length > maxTabs) {
    engines = engines.slice(0, maxTabs);
  }
  // open in order, all but optionally last in background
  for (let i = 0; i < engines.length; i++) {
    const url = buildUrl(engines[i].query, term);
    const active = !openInBackground && i === engines.length - 1;
    await chrome.tabs.create({ url, active });
  }
}

// ---------- context menu click ----------
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Detect-engines item — fires regardless of selection
  if (info.menuItemId === "ms-detect") {
    if (!tab || !tab.id) return;
    const url = chrome.runtime.getURL(`popup.html?auto=1&tabId=${tab.id}`);
    chrome.windows.create({
      url,
      type: "popup",
      width: 500,
      height: 360,
      focused: true
    });
    return;
  }

  // Determine the "term" — image URL for image right-clicks, selection text otherwise
  const isImageClick = info.mediaType === "image" && !!info.srcUrl;
  const term = isImageClick ? info.srcUrl : (info.selectionText || "").trim();
  if (!term) return;

  const data = await loadData();
  const bg = data.settings.openInBackground;

  if (info.menuItemId.startsWith("ms-engine|")) {
    const id = info.menuItemId.split("|")[1];
    const engine = findEngineById(data, id);
    if (engine) await fireEngine(engine, term, bg);
  } else if (info.menuItemId.startsWith("ms-catall-text|")) {
    const id = info.menuItemId.split("|")[1];
    await _fireCategoryFiltered(data, id, term, bg, false);
  } else if (info.menuItemId.startsWith("ms-catall-image|")) {
    const id = info.menuItemId.split("|")[1];
    await _fireCategoryFiltered(data, id, term, bg, true);
  } else if (info.menuItemId.startsWith("ms-catall|")) {
    // legacy id (older builds) — infer from click context
    const id = info.menuItemId.split("|")[1];
    await _fireCategoryFiltered(data, id, term, bg, isImageClick);
  }
});

async function _fireCategoryFiltered(data, id, term, bg, imageMode) {
  let children;
  if (id === "__uncategorized__") {
    children = data.items.filter(i => i.type === "engine");
  } else {
    const cat = findCategoryById(data, id);
    if (!cat) return;
    children = cat.children;
  }
  const matched = children.filter(c => c.type === "engine" && !!c.imageSearch === imageMode);
  if (matched.length === 0) return;
  await fireCategory({ children: matched }, term, bg, data.settings.confirmMultiOver);
}

// ---------- omnibox ----------
//
// Usage: `ms <nick> <query>`
//   <nick> matches a category-nick (fires all)  OR  engine-nick (fires one)
//   no <nick> => fires default? we just suggest.
//
chrome.omnibox.setDefaultSuggestion({
  description: "MULTISEARCH \u2014 type &lt;category-nick&gt; or &lt;engine-nick&gt; then your query"
});

function parseOmnibox(input) {
  const trimmed = input.trim();
  if (!trimmed) return { nick: "", term: "" };
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { nick: trimmed, term: "" };
  return { nick: trimmed.slice(0, spaceIdx), term: trimmed.slice(spaceIdx + 1).trim() };
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

chrome.omnibox.onInputChanged.addListener(async (input, suggest) => {
  const data = await loadData();
  const { nick, term } = parseOmnibox(input);

  const suggestions = [];

  // matching categories
  for (const item of data.items) {
    if (item.type !== "category") continue;
    if (!nick || item.nick.startsWith(nick) || item.name.toLowerCase().includes(nick.toLowerCase())) {
      const count = item.children.filter(c => c.type === "engine").length;
      suggestions.push({
        content: `${item.nick} ${term}`,
        description: `<match>[${escapeXml(item.name)}]</match> <dim>fire all ${count} engines</dim> \u2014 <url>${escapeXml(term || "...")}</url>`
      });
    }
  }
  // matching engines
  for (const item of data.items) {
    const list = item.type === "engine" ? [item] : (item.type === "category" ? item.children.filter(c => c.type === "engine") : []);
    for (const eng of list) {
      if (!nick || eng.nick.startsWith(nick) || eng.name.toLowerCase().includes(nick.toLowerCase())) {
        suggestions.push({
          content: `${eng.nick} ${term}`,
          description: `<match>${escapeXml(eng.name)}</match> <dim>(${escapeXml(eng.nick)})</dim> \u2014 <url>${escapeXml(term || "...")}</url>`
        });
      }
    }
  }

  suggest(suggestions.slice(0, 8));
});

chrome.omnibox.onInputEntered.addListener(async (input, disposition) => {
  const data = await loadData();
  const { nick, term } = parseOmnibox(input);
  if (!nick) return;
  if (!term) return;

  const cat = findCategoryByNick(data, nick);
  if (cat) {
    await fireCategory(cat, term, data.settings.openInBackground, data.settings.confirmMultiOver);
    return;
  }
  const eng = findEngineByNick(data, nick);
  if (eng) {
    const url = buildUrl(eng.query, term);
    if (disposition === "currentTab") {
      await chrome.tabs.update({ url });
    } else if (disposition === "newForegroundTab") {
      await chrome.tabs.create({ url, active: true });
    } else {
      await chrome.tabs.create({ url, active: false });
    }
  }
});

// ---------- toolbar action: handled by popup.html (manifest default_popup) ----------

// ---------- lifecycle ----------
chrome.runtime.onInstalled.addListener(async () => {
  await loadData();
  await rebuildContextMenu();
});

chrome.runtime.onStartup.addListener(async () => {
  await rebuildContextMenu();
});

// rebuild when storage changes (i.e. user edits in options page)
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    await rebuildContextMenu();
  }
});

// ---------- messages from options page ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "REBUILD_MENU") {
    rebuildContextMenu().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "DETECT_ENGINES") {
    // scan the active tab for OpenSearch descriptors
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab || !tab.id) return sendResponse({ ok: false, error: "no active tab" });
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const links = Array.from(document.querySelectorAll('link[rel~="search"]'));
            const found = links.map(l => ({
              title: l.getAttribute("title") || "",
              href: l.getAttribute("href") || "",
              type: l.getAttribute("type") || ""
            })).filter(l => l.href);
            // also expose page title and url for "add from URL" fallback
            return {
              opensearch: found,
              pageTitle: document.title,
              pageUrl: location.href
            };
          }
        });
        sendResponse({ ok: true, data: result.result });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});
