// ============================================================
// MULTISEARCH // OPTIONS LOGIC
// ============================================================

const STORAGE_KEY = "ms_data_v1";
const PLACEHOLDER_RE = /\{searchTerms\}|%s/g;

// ----- state -----
let state = null;       // the data object
let dragCtx = null;     // { id, type, fromCatId|null }

// ----- helpers -----
function uid() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 12);
}
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "dataset") for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = dv;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") n.innerHTML = v;
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    n.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

function findItem(id, items = state.items, parent = null) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return { item: items[i], parent, parentArr: items, index: i };
    if (items[i].type === "category") {
      const found = findItem(id, items[i].children, items[i]);
      if (found) return found;
    }
  }
  return null;
}

function removeItem(id) {
  const f = findItem(id);
  if (f) f.parentArr.splice(f.index, 1);
  return f;
}

function insertItem(item, targetParentId, index) {
  // The virtual UNCATEGORIZED folder is rendered as a category but is actually
  // just the root-level engine bucket. Treat it as null.
  if (targetParentId === "__uncategorized__") targetParentId = null;

  let arr;
  if (targetParentId == null) {
    arr = state.items;
  } else {
    const cat = state.items.find(i => i.id === targetParentId && i.type === "category");
    if (!cat) return;
    arr = cat.children;
  }
  if (index < 0 || index > arr.length) index = arr.length;
  arr.splice(index, 0, item);
}

function highlightPlaceholder(url) {
  return url.replace(PLACEHOLDER_RE, m => `<span class="placeholder">${m}</span>`);
}

function isValidQuery(url) {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return PLACEHOLDER_RE.test(url) || true; // we still accept without placeholder; we'll append ?q=
}

// ----- storage -----
async function load() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY] && stored[STORAGE_KEY].schema === 1) {
    state = stored[STORAGE_KEY];
  } else {
    // background may not have run yet — minimal fallback
    state = { schema: 1, settings: { openInBackground: false, confirmMultiOver: 8 }, items: [] };
    await persist();
  }
  // v0.1.6 migration: strip separators (feature removed)
  let cleaned = false;
  state.items = state.items.filter(it => {
    if (it.type === "separator") { cleaned = true; return false; }
    if (it.type === "category" && Array.isArray(it.children)) {
      const before = it.children.length;
      it.children = it.children.filter(c => c.type !== "separator");
      if (it.children.length !== before) cleaned = true;
    }
    return true;
  });
  if (cleaned) await persist();
  setSync(true);
}

async function persist() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
    setSync(true);
  } catch (e) {
    setSync(false, e.message);
  }
}

function setSync(ok, msg) {
  const stat = $("#sync-status");
  if (ok) {
    stat.textContent = "STORAGE OK";
    stat.classList.remove("err");
  } else {
    stat.textContent = "STORAGE ERR" + (msg ? `: ${msg}` : "");
    stat.classList.add("err");
  }
}

// ============================================================
// RENDER
// ============================================================
function render() {
  const tree = $("#tree");
  tree.innerHTML = "";

  let cats = 0, engs = 0;
  const useUncatFolder = !!state.settings.uncategorizedFolder;
  const standalone = [];

  for (const item of state.items) {
    if (item.type === "category") {
      cats++;
      for (const c of item.children) {
        if (c.type === "engine") engs++;
      }
      tree.appendChild(renderCategory(item));
    } else if (item.type === "engine") {
      engs++;
      if (useUncatFolder) {
        standalone.push(item);
      } else {
        tree.appendChild(renderEngine(item, null));
      }
    }
  }

  // Virtual UNCATEGORIZED folder at the end (only when setting is on)
  if (useUncatFolder && standalone.length > 0) {
    const expandedKey = state.settings.uncategorizedExpanded;
    const virtualCat = {
      id: "__uncategorized__",
      type: "category",
      name: "UNCATEGORIZED",
      nick: "uncat",
      expanded: expandedKey !== false,
      children: standalone,
      virtual: true
    };
    tree.appendChild(renderCategory(virtualCat));
  }

  $("#stat-cats").textContent = String(cats).padStart(2, "0");
  $("#stat-engs").textContent = String(engs).padStart(2, "0");
  const kw = state.settings.omniboxPrefix || chrome.runtime.getManifest().omnibox?.keyword || "ms";
  $("#prefix-value").textContent = kw;
  $("#version").textContent = "v" + (chrome.runtime.getManifest().version);
  updatePrefixMismatchIndicator();
}

function renderCategory(cat) {
  const engCount = cat.children.filter(c => c.type === "engine").length;
  const isVirtual = cat.virtual === true;

  const headChildren = [
    isVirtual
      ? el("span", { class: "drag-handle drag-handle-disabled", title: "Virtual folder \u2014 can't reorder" })
      : el("span", { class: "drag-handle" }),
    el("button", { class: "cat-toggle", title: "Collapse/expand", onClick: () => toggleCategory(cat.id) }, cat.expanded === false ? "\u25B8" : "\u25BE"),
    el("div", { class: "cat-label" + (isVirtual ? " cat-label-virtual" : "") },
      el("span", { class: "cat-name" }, cat.name),
      el("span", { class: "cat-nick" }, cat.nick)
    ),
    el("span", { class: "cat-count" }, `${engCount} ENG`)
  ];

  let actions;
  if (isVirtual) {
    actions = el("div", { class: "cat-actions" },
      el("button", { class: "btn btn-icon", title: "Add standalone engine", onClick: () => openEngineModal(null, null) }, "+ENGINE"),
      el("button", { class: "btn btn-icon", title: "Sort engines A\u2192Z", onClick: () => sortUncategorized() }, "SORT")
    );
  } else {
    actions = el("div", { class: "cat-actions" },
      el("button", { class: "btn btn-icon", title: "Add engine to category", onClick: () => openEngineModal(null, cat.id) }, "+ENGINE"),
      el("button", { class: "btn btn-icon", title: "Sort engines A\u2192Z", onClick: () => sortCategory(cat.id) }, "SORT"),
      el("button", { class: "btn btn-icon", title: "Edit category", onClick: () => openCategoryModal(cat) }, "EDIT"),
      el("button", { class: "btn btn-icon btn-danger", title: "Delete category", onClick: () => deleteCategory(cat.id) }, "DEL")
    );
  }
  headChildren.push(actions);

  const headOpts = { class: "cat-head" + (cat.expanded === false ? " collapsed" : "") + (isVirtual ? " cat-head-virtual" : "") };
  if (!isVirtual) {
    headOpts.draggable = "true";
    headOpts.dataset = { id: cat.id, type: "category" };
    headOpts.onDragStart = onCatDragStart;
    headOpts.onDragEnd = onDragEnd;
  }
  const headEl = el("div", headOpts, ...headChildren);

  const bodyEl = el("div", {
    class: "cat-body" + (cat.expanded === false ? " collapsed" : ""),
    dataset: { catId: cat.id },
    onDragOver: onChildDragOver,
    onDragLeave: onChildDragLeave,
    onDrop: onChildDrop
  });

  if (cat.children.length === 0) {
    bodyEl.appendChild(el("div", { class: "cat-body-empty" }, "\u2014 EMPTY \u2014 drop engines here or click +ENGINE \u2014"));
  } else {
    for (const child of cat.children) {
      if (child.type === "engine") bodyEl.appendChild(renderEngine(child, cat.id));
    }
  }

  const wrapOpts = { class: "cat" + (isVirtual ? " cat-virtual" : ""), dataset: { id: cat.id, type: "category" } };
  return el("div", wrapOpts, headEl, bodyEl);
}

function renderEngine(eng, catId) {
  // Detect "definitely mangled" URLs — too aggressive a check creates false
  // positives, since real URLs legitimately use %s multiple times (path + query,
  // display titles, tracking params, etc.). We only flag two signals that are
  // almost never legitimate:
  //   1) Adjacent %s tokens (e.g. %s%s%s%s) — real URLs always have structural
  //      characters between placeholders. Adjacency is the fingerprint of a
  //      regex replacing several touching {...} tokens during a bad import.
  //   2) 5+ total %s placeholders — even aggressive multi-use URLs rarely
  //      exceed 3-4.
  const phCount = (eng.query.match(/%s/g) || []).length;
  const hasAdjacent = /%s%s/.test(eng.query);
  const isBroken = hasAdjacent || phCount >= 5;
  const brokenReason = hasAdjacent
    ? "Adjacent %s placeholders detected \u2014 almost certainly a corrupted import."
    : `URL has ${phCount} %s placeholders \u2014 very unusual, likely a corrupted import.`;

  const nameTextSpan = el("span", { class: "eng-name-text inline-editable", title: "Click to edit name" }, eng.name);
  const nameChildren = [nameTextSpan];
  if (eng.imageSearch) {
    nameChildren.push(el("span", { class: "eng-img-badge", title: "Reverse image search engine" }, "IMG"));
  }
  if (isBroken) {
    nameChildren.push(el("span", { class: "eng-broken-badge", title: brokenReason }, "\u26A0"));
  }

  const nickSpan = el("span", { class: "eng-nick inline-editable", title: "Click to edit nick (address-bar shortcut)" }, eng.nick);

  // wire inline-edit
  makeInlineEditable(nameTextSpan, {
    maxLen: 60,
    onSave: async (v) => { eng.name = v; await persist(); }
  });
  makeInlineEditable(nickSpan, {
    maxLen: 16,
    sanitize: (v) => v.trim().toLowerCase().replace(/[^-a-z0-9._]/g, ""),
    validate: (v) => /^[-a-z0-9._]+$/.test(v),
    onSave: async (v) => { eng.nick = v; await persist(); }
  });

  return el("div", {
    class: "eng" + (eng.imageSearch ? " eng-image" : "") + (isBroken ? " eng-broken" : ""),
    draggable: "true",
    dataset: { id: eng.id, type: "engine", catId: catId || "" },
    onDragStart: onEngDragStart, onDragEnd: onDragEnd,
    onDragOver: onRowDragOver, onDragLeave: onRowDragLeave, onDrop: onRowDrop
  },
    el("span", { class: "drag-handle" }),
    el("span", { class: "eng-name", title: eng.name }, ...nameChildren),
    nickSpan,
    el("span", { class: "eng-query", title: eng.query, html: highlightPlaceholder(escapeHtml(eng.query)) }),
    el("div", { class: "eng-actions" },
      el("button", { class: "btn btn-icon", title: "Edit", onClick: () => openEngineModal(eng, catId) }, "EDIT"),
      el("button", { class: "btn btn-icon btn-danger", title: "Delete", onClick: () => deleteEngine(eng.id) }, "DEL")
    )
  );
}

// ============================================================
// Inline-editable text spans (click on the text to edit it).
// Used for engine name + nick directly in the row.
// ============================================================
function makeInlineEditable(span, opts) {
  // opts = { maxLen, sanitize?: (v)=>v, validate?: (v)=>bool, onSave: async (v) }
  span.addEventListener("click", (e) => {
    // don't trigger while dragging or if the row is being dragged
    if (span._editing) return;
    e.stopPropagation();
    span._editing = true;

    const original = span.textContent;
    const input = document.createElement("input");
    input.type = "text";
    input.value = original;
    input.className = "inline-edit-input";
    if (opts.maxLen) input.maxLength = opts.maxLen;
    // Match span's visual footprint reasonably
    input.style.minWidth = Math.max(60, span.offsetWidth) + "px";

    span.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      let v = input.value;
      if (opts.sanitize) v = opts.sanitize(v);
      const ok = !opts.validate || opts.validate(v);
      if (save && v && v !== original && ok) {
        try {
          await opts.onSave(v);
          toast("SAVED");
        } catch (err) {
          toast("SAVE FAILED", true);
        }
      } else if (save && v && !ok) {
        toast("INVALID VALUE", true);
      }
      render(); // rebuild rows from state — restores layout
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
    // prevent drag from interfering
    input.addEventListener("mousedown", (ev) => ev.stopPropagation());
  });

  // suppress drag start from the editable span so click works cleanly
  span.addEventListener("mousedown", (ev) => ev.stopPropagation());
}

function renderSeparator(sep, catId) {
  return el("div", {
    class: "sep-row", draggable: "true",
    dataset: { id: sep.id, type: "separator", catId: catId || "" },
    onDragStart: onSepDragStart, onDragEnd: onDragEnd,
    onDragOver: onRowDragOver, onDragLeave: onRowDragLeave, onDrop: onRowDrop
  },
    el("span", { class: "drag-handle" }),
    el("span", { class: "sep-line" }),
    el("span", { class: "sep-label" }, "— SEPARATOR —"),
    el("span", { class: "sep-line" }),
    el("div", { class: "eng-actions" },
      el("button", { class: "btn btn-icon btn-danger", title: "Delete", onClick: () => deleteEngine(sep.id) }, "DEL")
    )
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[c]);
}

// ============================================================
// CRUD
// ============================================================
async function toggleCategory(id) {
  if (id === "__uncategorized__") {
    // virtual folder — persist via a settings flag
    const current = state.settings.uncategorizedExpanded !== false;
    state.settings.uncategorizedExpanded = !current;
    await persist();
    render();
    return;
  }
  const f = findItem(id);
  if (!f) return;
  f.item.expanded = !(f.item.expanded !== false);
  await persist();
  render();
}

async function sortUncategorized() {
  if (!confirm("Sort uncategorized engines A\u2192Z?\nDrag order will be overwritten.")) return;
  // pull all root-level engines, sort them, splice back into state.items in their original positions among categories
  // simplest: just sort the engines in-place by stable-extracting them, sorting, then re-inserting at original positions
  const engineIndices = [];
  for (let i = 0; i < state.items.length; i++) {
    if (state.items[i].type === "engine") engineIndices.push(i);
  }
  const engines = engineIndices.map(i => state.items[i]);
  engines.sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));
  for (let k = 0; k < engineIndices.length; k++) {
    state.items[engineIndices[k]] = engines[k];
  }
  await persist();
  render();
  toast("UNCATEGORIZED SORTED A\u2192Z");
}

async function expandAllCategories() {
  for (const item of state.items) {
    if (item.type === "category") item.expanded = true;
  }
  state.settings.uncategorizedExpanded = true;
  await persist();
  render();
  toast("EXPANDED ALL");
}

async function collapseAllCategories() {
  for (const item of state.items) {
    if (item.type === "category") item.expanded = false;
  }
  state.settings.uncategorizedExpanded = false;
  await persist();
  render();
  toast("COLLAPSED ALL");
}

// Find engines whose query URL is almost certainly mangled (adjacent %s tokens
// or 5+ total placeholders). Multiple %s alone is NOT broken — see comment in
// renderEngine for the rationale.
function findBrokenEngines() {
  const broken = [];
  const isBroken = (q) => /%s%s/.test(q) || (q.match(/%s/g) || []).length >= 5;
  const visit = (eng, parentCat) => {
    if (isBroken(eng.query)) broken.push({ engine: eng, parent: parentCat });
  };
  for (const item of state.items) {
    if (item.type === "engine") visit(item, null);
    else if (item.type === "category") {
      for (const c of item.children) if (c.type === "engine") visit(c, item);
    }
  }
  if (broken.length === 0) {
    toast("NO BROKEN ENGINES \u2014 ALL CLEAN");
    return;
  }
  // expand parents so they're visible
  for (const b of broken) {
    if (b.parent) b.parent.expanded = true;
  }
  // if any standalone-engines are broken AND uncategorized folder is on, expand that too
  if (broken.some(b => !b.parent)) {
    state.settings.uncategorizedExpanded = true;
  }
  render();
  // scroll to the first broken one and flash it
  setTimeout(() => {
    const first = broken[0];
    const node = document.querySelector(`.eng[data-id="${first.engine.id}"]`);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.classList.add("eng-broken-flash");
      setTimeout(() => node.classList.remove("eng-broken-flash"), 2500);
    }
  }, 100);
  toast(`FOUND ${broken.length} BROKEN \u2014 SCROLLED TO FIRST`);
}

async function deleteCategory(id) {
  const f = findItem(id);
  if (!f) return;
  const engCount = f.item.children.filter(c => c.type === "engine").length;
  if (engCount > 0) {
    if (!confirm(`Category [${f.item.name}] contains ${engCount} engine(s). Delete anyway?`)) return;
  }
  removeItem(id);
  await persist();
  render();
  toast(`DELETED [${f.item.name}]`);
}

async function deleteEngine(id) {
  const f = findItem(id);
  if (!f) return;
  removeItem(id);
  await persist();
  render();
  toast("DELETED");
}

async function addSeparator(catId) {
  const sep = { id: uid(), type: "separator" };
  if (catId) {
    const cat = state.items.find(i => i.id === catId);
    if (cat) cat.children.push(sep);
  } else {
    state.items.push(sep);
  }
  await persist();
  render();
}

// ----- sort -----
function itemSorter(a, b) {
  // separators sink to the bottom
  if (a.type === "separator" && b.type !== "separator") return 1;
  if (b.type === "separator" && a.type !== "separator") return -1;
  if (a.type === "separator" && b.type === "separator") return 0;
  return (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
}

async function sortRoot(mode) {
  if (mode === "custom") {
    toast("CUSTOM \u2014 DRAG TO REORDER");
    return;
  }

  let comparator;
  let label;
  if (mode === "cat-priority") {
    label = "Categories first (sorted), then uncategorized engines (sorted)";
    comparator = (a, b) => {
      // categories before standalone engines
      if (a.type === "category" && b.type !== "category") return -1;
      if (b.type === "category" && a.type !== "category") return 1;
      // same bucket → alphabetical
      return (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
    };
  } else if (mode === "everything") {
    label = "Everything intermixed alphabetically";
    comparator = (a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
  } else {
    return;
  }

  if (!confirm(`Sort root items?\n${label}.\nCurrent drag order will be overwritten.`)) return;

  state.items.sort(comparator);
  await persist();
  render();
  toast(mode === "cat-priority" ? "SORTED \u2014 CATEGORIES FIRST" : "SORTED \u2014 EVERYTHING");
}

async function sortCategory(catId) {
  const cat = state.items.find(i => i.id === catId && i.type === "category");
  if (!cat) return;
  if (!confirm(`Sort engines in [${cat.name}] A\u2192Z?\nSeparators will sink to the bottom.\nCurrent drag order is overwritten.`)) return;
  cat.children.sort(itemSorter);
  await persist();
  render();
  toast(`SORTED [${cat.name}] A\u2192Z`);
}

// ----- txt format parser -----
// Accepts blocks like:
//   site name: google
//   nick: g
//   query: https://...?q=%s
// Separated by blank lines (or just back-to-back; we resync on each "site name:").
// Cleans Chrome-internal template tokens.
const CHROME_BASE_URLS = {
  "google:baseURL":      "https://www.google.com/",
  "google:baseSearchURL": "https://www.google.com/search?",
  "google:baseSuggestURL": "https://www.google.com/complete/search?",
  "bing:baseURL":        "https://www.bing.com/",
  "yahoo:baseURL":       "https://search.yahoo.com/",
  "duckduckgo:baseURL":  "https://duckduckgo.com/",
  "ecosia:baseURL":      "https://www.ecosia.org/",
  "startpage:baseURL":   "https://www.startpage.com/",
  "qwant:baseURL":       "https://www.qwant.com/",
  "yandex:baseURL":      "https://yandex.com/",
  "baidu:baseURL":       "https://www.baidu.com/",
  "naver:baseURL":       "https://search.naver.com/",
  "brave:baseURL":       "https://search.brave.com/",
  "mojeek:baseURL":      "https://www.mojeek.com/"
};

function cleanQueryUrl(rawUrl) {
  let u = rawUrl;
  // normalize {searchTerms?} → {searchTerms}
  u = u.replace(/\{searchTerms\??\}/g, "{searchTerms}");
  // substitute known base URLs
  for (const [k, v] of Object.entries(CHROME_BASE_URLS)) {
    u = u.split("{" + k + "}").join(v);
  }
  // standard fillers
  u = u.replace(/\{inputEncoding\}/g, "UTF-8");
  u = u.replace(/\{outputEncoding\}/g, "UTF-8");
  // strip ALL remaining {...} EXCEPT {searchTerms}
  u = u.replace(/\{(?!searchTerms\})[^}]*\}/g, "");
  // clean dangling separators
  u = u.replace(/\?&+/g, "?")
       .replace(/&{2,}/g, "&")
       .replace(/&+$/g, "")
       .replace(/\?$/, "");
  return u;
}

function parseTextImport(text) {
  const lines = text.split(/\r?\n/);
  const engines = [];
  let cur = {};
  const push = () => {
    if (cur.name && cur.query) engines.push({ ...cur });
    cur = {};
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { push(); continue; }
    const ci = line.indexOf(":");
    if (ci === -1) continue;
    const key = line.slice(0, ci).trim().toLowerCase();
    const val = line.slice(ci + 1).trim();
    if (key === "site name" || key === "name") {
      // start of a new entry — flush previous if any
      if (cur.name || cur.query) push();
      cur.name = val;
    } else if (key === "nick" || key === "nickname" || key === "keyword" || key === "shortcut") {
      cur.nick = val;
    } else if (key === "query" || key === "url" || key === "template") {
      cur.query = cleanQueryUrl(val);
    }
  }
  push();
  return engines;
}

// best-effort domain → category mapping (only HIGH confidence; rest stays uncategorized)
const CATEGORY_RULES = [
  { cat: "SEARCH",  match: /^(google|bing|duckduckgo|ddg|kagi|brave|ecosia|startpage|qwant|yandex|baidu|naver|mojeek|searx|yahoo)\b/i,
                    domains: ["google.","bing.","duckduckgo.","kagi.","brave.com","ecosia.","startpage.","qwant.","yandex.","baidu.","naver.","mojeek.","searx","yahoo."] },
  { cat: "TORRENT", match: /(1337x|piratebay|tpb|rarbg|nyaa|torrentz|magnetdl|kickass|limetorrents|yts|eztv|torrent)/i,
                    domains: ["1337x.","piratebay","thepiratebay","rarbg","nyaa.","torrentz","magnetdl","kickass","limetorrents","yts.","eztv.","rutracker.","torlock"] },
  { cat: "DEV",     match: /(github|gitlab|stackoverflow|stackexchange|mdn|devdocs|npm|crates|pypi|docker|kernel\.org|cppreference|godbolt)/i,
                    domains: ["github.com","gitlab.com","stackoverflow.com","stackexchange.com","developer.mozilla.org","devdocs.io","npmjs.com","crates.io","pypi.org","hub.docker.com","kernel.org","cppreference.com","godbolt.org"] },
  { cat: "ARCHIVE", match: /(wayback|web\.archive|archive\.org|archive\.today|archive\.ph|cachedview|ghostarchive)/i,
                    domains: ["web.archive.org","archive.org","archive.today","archive.ph","archive.is","cachedview.com","ghostarchive.org"] },
  { cat: "MEDIA",   match: /(youtube|vimeo|soundcloud|bandcamp|spotify|last\.fm|discogs|musicbrainz|rateyourmusic|rym\b|imdb|letterboxd|tmdb|tvdb)/i,
                    domains: ["youtube.com","vimeo.com","soundcloud.com","bandcamp.com","spotify.com","last.fm","discogs.com","musicbrainz.org","rateyourmusic.com","imdb.com","letterboxd.com","themoviedb.org","thetvdb.com"] },
  { cat: "REFERENCE", match: /(wikipedia|wikiquote|wiktionary|wikidata|britannica|merriam|oxford|stanford\.edu|jstor|scholar|arxiv|pubmed|wolframalpha)/i,
                    domains: ["wikipedia.org","wikiquote.org","wiktionary.org","wikidata.org","britannica.com","merriam-webster.com","oxforddictionaries.com","jstor.org","scholar.google","arxiv.org","pubmed.","wolframalpha.com"] },
  { cat: "SOCIAL",  match: /(reddit|twitter|x\.com|mastodon|bluesky|bsky|hackernews|hn\b|lobsters|tumblr|pinterest|instagram|tiktok)/i,
                    domains: ["reddit.com","twitter.com","x.com","mastodon.","bsky.app","bluesky","news.ycombinator.com","lobste.rs","tumblr.com","pinterest.com","instagram.com","tiktok.com"] },
  { cat: "FILES",   match: /(annas-archive|libgen|zlib|sci-hub|scihub|softpedia|fosshub|github-releases|alternativeto)/i,
                    domains: ["annas-archive.","libgen.","z-lib.","b-ok.","sci-hub.","softpedia.com","fosshub.com","alternativeto.net"] },
  { cat: "OSINT",   match: /(shodan|censys|virustotal|threatcrowd|hunter\.io|haveibeenpwned|hibp|abuse\.ch|urlscan|whois|crt\.sh)/i,
                    domains: ["shodan.io","censys.io","virustotal.com","threatcrowd.org","hunter.io","haveibeenpwned.com","abuse.ch","urlscan.io","whois.","crt.sh"] },
  { cat: "SHOPPING", match: /(amazon|ebay|etsy|aliexpress|newegg|bestbuy|walmart|target|reverb|chrono24)/i,
                    domains: ["amazon.","ebay.","etsy.com","aliexpress.","newegg.com","bestbuy.com","walmart.com","target.com","reverb.com","chrono24.com"] }
];

function guessCategory(name, query) {
  const haystack = (name + " " + query).toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(name)) return rule.cat;
    for (const d of rule.domains) {
      if (haystack.includes(d)) return rule.cat;
    }
  }
  return null;
}

function autoDetectImportFormat(txt) {
  const t = txt.trim();
  if (!t) return "empty";
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (/^site\s*name\s*:/im.test(t) || /^(name|nick|query)\s*:/im.test(t)) return "txt";
  return "unknown";
}

function buildItemsFromParsedEngines(engines, autoCategorize) {
  const cats = new Map(); // name -> category object
  const standalone = [];
  for (const e of engines) {
    const eng = {
      id: uid(),
      type: "engine",
      name: e.name,
      nick: (e.nick || "").toLowerCase().replace(/[^a-z0-9._-]/g, "") || (e.name || "x").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "x",
      query: e.query
    };
    const catName = autoCategorize ? guessCategory(e.name, e.query) : null;
    if (catName) {
      if (!cats.has(catName)) {
        cats.set(catName, {
          id: uid(), type: "category",
          name: catName, nick: catName.toLowerCase(), expanded: true,
          children: []
        });
      }
      cats.get(catName).children.push(eng);
    } else {
      standalone.push(eng);
    }
  }
  // categories first (sorted by name), then standalone (sorted by name)
  const catArr = [...cats.values()].sort((a, b) => a.name.localeCompare(b.name));
  // sort children inside each category alphabetically
  for (const c of catArr) c.children.sort(itemSorter);
  standalone.sort(itemSorter);
  return [...catArr, ...standalone];
}

// ============================================================
// MODALS
// ============================================================
function openModal(id) {
  $("#modal-backdrop").classList.add("active");
  $(`#modal-${id}`).classList.add("active");
}
function closeAllModals() {
  $("#modal-backdrop").classList.remove("active");
  $$(".modal").forEach(m => m.classList.remove("active"));
}

let editingEngineId = null;
function openEngineModal(engine, defaultCatId) {
  editingEngineId = engine ? engine.id : null;
  $("#engine-modal-title").textContent = engine ? "EDIT ENGINE" : "+ ENGINE";
  const form = $("#engine-form");
  form.reset();

  let initialCatId = "";
  if (engine) {
    form.name.value = engine.name;
    form.nick.value = engine.nick;
    form.query.value = engine.query;
    form.imageSearch.checked = !!engine.imageSearch;
    const f = findItem(engine.id);
    initialCatId = f && f.parent ? f.parent.id : "";
  } else {
    initialCatId = defaultCatId || "";
    form.imageSearch.checked = false;
  }

  populateEngineCategorySelect(initialCatId);

  // ensure any leftover inline new-cat input row is gone (e.g. if modal was closed mid-edit)
  $$(".inline-new-cat-row").forEach(n => n.remove());
  $("#engine-category-select").style.display = "";

  openModal("engine");
  setTimeout(() => form.name.focus(), 50);
}

function populateEngineCategorySelect(selectedId) {
  const sel = $("#engine-category-select");
  sel.innerHTML = "";
  sel.appendChild(el("option", { value: "" }, "\u2014 STANDALONE \u2014"));
  for (const item of state.items) {
    if (item.type === "category") {
      sel.appendChild(el("option", { value: item.id }, `[${item.name}] /${item.nick}`));
    }
  }
  sel.appendChild(el("option", { value: "__new__" }, "+ NEW CATEGORY\u2026"));
  // restore selection if still valid
  const stillExists = !selectedId || state.items.some(i => i.id === selectedId);
  sel.value = stillExists ? (selectedId || "") : "";
  sel.dataset.lastValid = sel.value;
}

$("#engine-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const rawCat = form.categoryId.value;
  const data = {
    name: form.name.value.trim(),
    nick: form.nick.value.trim().toLowerCase(),
    query: form.query.value.trim(),
    categoryId: (rawCat && rawCat !== "__new__") ? rawCat : null,
    imageSearch: !!form.imageSearch.checked
  };
  if (!data.name || !data.nick || !data.query) return;
  if (!isValidQuery(data.query)) { toast("INVALID URL", true); return; }
  if (!PLACEHOLDER_RE.test(data.query)) {
    if (!confirm("URL has no %s or {searchTerms} placeholder. The query will be appended as ?q=...  Continue?")) return;
  }
  PLACEHOLDER_RE.lastIndex = 0;

  if (editingEngineId) {
    const f = findItem(editingEngineId);
    if (!f) { closeAllModals(); return; }
    f.item.name = data.name;
    f.item.nick = data.nick;
    f.item.query = data.query;
    f.item.imageSearch = data.imageSearch;
    const currentParentId = f.parent ? f.parent.id : null;
    if (currentParentId !== data.categoryId) {
      removeItem(editingEngineId);
      insertItem(f.item, data.categoryId, Number.MAX_SAFE_INTEGER);
    }
    toast("UPDATED");
  } else {
    const eng = { id: uid(), type: "engine", name: data.name, nick: data.nick, query: data.query, imageSearch: data.imageSearch };
    insertItem(eng, data.categoryId, Number.MAX_SAFE_INTEGER);
    toast("ADDED");
  }
  await persist();
  render();
  closeAllModals();
});

// inline new-category creation from the engine modal's category dropdown
function setupEngineCategoryNewHandler() {
  const sel = $("#engine-category-select");
  if (!sel || sel.dataset.bound === "1") return;
  sel.dataset.bound = "1";
  sel.addEventListener("change", () => {
    if (sel.value === "__new__") {
      showInlineNewCategoryRow(sel, sel.parentElement, sel.dataset.lastValid || "", (newId) => {
        populateEngineCategorySelect(newId);
      });
    } else {
      sel.dataset.lastValid = sel.value;
    }
  });
}

function showInlineNewCategoryRow(selectEl, mountEl, previousValue, onCreated) {
  // hide the select, drop in an inline row with input + ✓/✗
  const row = el("div", { class: "inline-new-cat-row" });
  const input = el("input", {
    type: "text",
    placeholder: "new category name",
    maxlength: 32,
    autocomplete: "off"
  });
  const confirmBtn = el("button", { type: "button", class: "btn btn-tiny btn-primary" }, "\u2713 CREATE");
  const cancelBtn  = el("button", { type: "button", class: "btn btn-tiny" }, "\u2715");
  row.appendChild(input);
  row.appendChild(confirmBtn);
  row.appendChild(cancelBtn);

  selectEl.style.display = "none";
  mountEl.appendChild(row);
  input.focus();

  const restoreSelect = (newId) => {
    row.remove();
    selectEl.style.display = "";
    if (onCreated && newId) onCreated(newId);
    else {
      selectEl.value = previousValue || "";
      selectEl.dataset.lastValid = selectEl.value;
    }
  };

  const cancel = () => restoreSelect(null);
  const confirm = async () => {
    const name = input.value.trim();
    if (!name) { toast("ENTER A NAME", true); input.focus(); return; }
    // generate a unique-ish nick from the name
    let baseNick = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "cat";
    let nick = baseNick, n = 2;
    while (state.items.some(i => i.type === "category" && i.nick === nick)) {
      nick = baseNick + n;
      n++;
    }
    const newCat = { id: uid(), type: "category", name, nick, expanded: true, children: [] };
    state.items.push(newCat);
    await persist();
    restoreSelect(newCat.id);
    toast(`+ [${name}]`);
    render();
  };

  cancelBtn.addEventListener("click", cancel);
  confirmBtn.addEventListener("click", confirm);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  { e.preventDefault(); confirm(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
}

let editingCatId = null;
function openCategoryModal(cat) {
  editingCatId = cat ? cat.id : null;
  $("#category-modal-title").textContent = cat ? "EDIT CATEGORY" : "+ CATEGORY";
  const form = $("#category-form");
  form.reset();
  if (cat) {
    form.name.value = cat.name;
    form.nick.value = cat.nick;
  }
  openModal("category");
  setTimeout(() => form.name.focus(), 50);
}

$("#category-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  const nick = form.nick.value.trim().toLowerCase();
  if (!name || !nick) return;

  if (editingCatId) {
    const f = findItem(editingCatId);
    if (f) { f.item.name = name; f.item.nick = nick; }
    toast("UPDATED");
  } else {
    state.items.push({ id: uid(), type: "category", name, nick, expanded: true, children: [] });
    toast("ADDED");
  }
  await persist();
  render();
  closeAllModals();
});

// nick preview in category modal (handler defined later in settings section)

// ----- settings modal -----
function openSettingsModal() {
  const form = $("#settings-form");
  form.openInBackground.checked = !!state.settings.openInBackground;
  form.uncategorizedFolder.checked = !!state.settings.uncategorizedFolder;
  form.confirmMultiOver.value = state.settings.confirmMultiOver ?? 8;
  $("#settings-prefix-display").textContent = chrome.runtime.getManifest().omnibox?.keyword || "ms";
  openModal("settings");
}

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  state.settings.openInBackground = form.openInBackground.checked;
  state.settings.uncategorizedFolder = form.uncategorizedFolder.checked;
  state.settings.confirmMultiOver = parseInt(form.confirmMultiOver.value, 10) || 8;
  await persist();
  render();
  closeAllModals();
  toast("SAVED");
});

// nick preview in category modal
$("#category-form").addEventListener("input", () => {
  const nick = $("#category-form").nick.value.trim() || "<nick>";
  const kw = chrome.runtime.getManifest().omnibox?.keyword || "ms";
  $("#cat-nick-preview").textContent = `${kw} ${nick} query`;
});

// ============================================================
// IMPORT / EXPORT
// ============================================================
function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function doExport() {
  const exportData = {
    schema: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    items: state.items
  };
  downloadFile(`multisearch-${Date.now()}.json`, JSON.stringify(exportData, null, 2));
  toast("EXPORTED");
}

function openImportModal() {
  $("#import-text").value = "";
  $("#import-file").value = "";
  openModal("import");
}

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const txt = await file.text();
  $("#import-text").value = txt;
});

function parseImport() {
  const txt = $("#import-text").value.trim();
  if (!txt) { toast("PASTE JSON OR TXT FIRST", true); return null; }
  const fmt = autoDetectImportFormat(txt);
  if (fmt === "json") {
    try {
      const parsed = JSON.parse(txt);
      if (!parsed.items || !Array.isArray(parsed.items)) {
        toast("INVALID JSON STRUCTURE", true);
        return null;
      }
      // strip separators (removed feature in v0.1.6)
      const filtered = parsed.items.filter(it => {
        if (it.type === "separator") return false;
        if (it.type === "category" && Array.isArray(it.children)) {
          it.children = it.children.filter(c => c.type !== "separator");
        }
        return true;
      });
      return { items: filtered, settings: parsed.settings, count: filtered.length, format: "json" };
    } catch (e) {
      toast("INVALID JSON", true);
      return null;
    }
  }
  if (fmt === "txt") {
    const engines = parseTextImport(txt);
    if (engines.length === 0) {
      toast("NO ENGINES PARSED FROM TXT", true);
      return null;
    }
    const items = buildItemsFromParsedEngines(engines, true);
    return { items, count: engines.length, format: "txt" };
  }
  toast("UNRECOGNIZED FORMAT", true);
  return null;
}

$("#btn-import-replace").addEventListener("click", async () => {
  const parsed = parseImport();
  if (!parsed) return;
  if (!confirm(`REPLACE all current data with ${parsed.count} engine(s) from ${parsed.format.toUpperCase()}?\nThis cannot be undone.`)) return;
  state.items = parsed.items;
  if (parsed.settings) state.settings = { ...state.settings, ...parsed.settings };
  // regenerate IDs to prevent collisions (txt-parsed items already have fresh ids; json may not)
  for (const item of state.items) {
    item.id = uid();
    if (item.children) for (const c of item.children) c.id = uid();
  }
  await persist();
  render();
  closeAllModals();
  toast(`IMPORTED ${parsed.count}`);
});

$("#btn-import-merge").addEventListener("click", async () => {
  const parsed = parseImport();
  if (!parsed) return;
  for (const item of parsed.items) {
    item.id = uid();
    if (item.children) for (const c of item.children) c.id = uid();
    // for txt-imported categories, merge into existing same-named category if it exists
    if (parsed.format === "txt" && item.type === "category") {
      const existing = state.items.find(i => i.type === "category" && i.name.toLowerCase() === item.name.toLowerCase());
      if (existing) {
        existing.children.push(...item.children);
        continue;
      }
    }
    state.items.push(item);
  }
  await persist();
  render();
  closeAllModals();
  toast(`MERGED ${parsed.count}`);
});

// ============================================================
// EDITABLE OMNIBOX PREFIX
// ============================================================
function bindPrefixClickToEdit() {
  const span = $("#prefix-value");
  if (!span || span.dataset.bound === "1") return;
  span.dataset.bound = "1";
  span.style.cursor = "text";
  span.title = "Click to change";
  span.addEventListener("click", startPrefixEdit);
}

function startPrefixEdit() {
  const span = $("#prefix-value");
  const current = span.textContent.trim();
  const input = document.createElement("input");
  input.type = "text";
  input.value = current;
  input.maxLength = 8;
  input.className = "prefix-edit-input";
  input.setAttribute("autocomplete", "off");
  span.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const raw = input.value.trim();
    const clean = raw.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 8);
    const finalVal = clean || current || "ms";
    // restore the span
    const newSpan = document.createElement("span");
    newSpan.className = "prefix-value";
    newSpan.id = "prefix-value";
    newSpan.textContent = finalVal;
    input.replaceWith(newSpan);
    bindPrefixClickToEdit();

    if (finalVal !== current) {
      state.settings.omniboxPrefix = finalVal;
      await persist();
      updatePrefixMismatchIndicator();
      const manifestKw = chrome.runtime.getManifest().omnibox?.keyword || "ms";
      if (finalVal !== manifestKw) {
        promptManifestDownload(finalVal);
      } else {
        toast("PREFIX SAVED");
      }
    }
  };
  const cancel = () => {
    if (done) return;
    done = true;
    const newSpan = document.createElement("span");
    newSpan.className = "prefix-value";
    newSpan.id = "prefix-value";
    newSpan.textContent = current;
    input.replaceWith(newSpan);
    bindPrefixClickToEdit();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
}

function updatePrefixMismatchIndicator() {
  const node = $("#prefix-mismatch");
  if (!node) return;
  const manifestKw = chrome.runtime.getManifest().omnibox?.keyword || "ms";
  const userKw = state.settings.omniboxPrefix || manifestKw;
  if (userKw !== manifestKw) {
    node.hidden = false;
    node.textContent = `(MANIFEST STILL ON "${manifestKw}" — click to fix)`;
    node.style.cursor = "pointer";
    node.onclick = () => promptManifestDownload(userKw);
  } else {
    node.hidden = true;
    node.onclick = null;
  }
}

async function promptManifestDownload(newKeyword) {
  const ok = confirm(
    `To make the address bar listen on "${newKeyword}" instead of the current manifest keyword, ` +
    `MULTISEARCH needs to update its manifest.json file and you'll need to reload the extension.\n\n` +
    `Click OK to download an updated manifest.json. Then:\n` +
    `  1. Open your ext\\ folder\n` +
    `  2. Replace manifest.json with the downloaded one\n` +
    `  3. Go to chrome://extensions and click the reload arrow on MULTISEARCH`
  );
  if (!ok) {
    toast("PREFIX SAVED \u2014 MANIFEST UNCHANGED");
    return;
  }
  try {
    const resp = await fetch(chrome.runtime.getURL("manifest.json"));
    const manifest = await resp.json();
    manifest.omnibox = manifest.omnibox || {};
    manifest.omnibox.keyword = newKeyword;
    const txt = JSON.stringify(manifest, null, 2);
    downloadFile("manifest.json", txt);
    toast("MANIFEST DOWNLOADED \u2014 REPLACE AND RELOAD");
  } catch (e) {
    toast("MANIFEST FETCH FAILED", true);
  }
}

// ============================================================
// DETECT ON PAGE
// (Moved out of options page in v0.1.4 — now lives in popup.html,
// reachable via toolbar icon click or right-click DETECT ENGINES.)
// ============================================================

// ============================================================
// DRAG & DROP
// ============================================================
function onCatDragStart(e) {
  const head = e.currentTarget;
  const card = head.closest(".cat");
  dragCtx = { id: head.dataset.id, type: "category", fromCatId: null };
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", head.dataset.id);
  card.style.opacity = "0.4";
}

function onEngDragStart(e) {
  const row = e.currentTarget;
  dragCtx = { id: row.dataset.id, type: "engine", fromCatId: row.dataset.catId || null };
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", row.dataset.id);
  row.classList.add("dragging");
}

function onSepDragStart(e) {
  const row = e.currentTarget;
  dragCtx = { id: row.dataset.id, type: "separator", fromCatId: row.dataset.catId || null };
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", row.dataset.id);
  row.classList.add("dragging");
}

function onDragEnd() {
  $$(".eng, .sep-row").forEach(r => r.classList.remove("dragging"));
  $$(".cat").forEach(c => c.style.opacity = "");
  removeIndicator();
  dragCtx = null;
}

function removeIndicator() {
  $$(".drop-indicator").forEach(el => el.remove());
  $$(".cat").forEach(c => c.classList.remove("drag-over-self"));
}

function placeIndicatorBefore(refNode) {
  removeIndicator();
  if (!refNode || !refNode.parentNode) return;
  const ind = document.createElement("div");
  ind.className = "drop-indicator";
  refNode.parentNode.insertBefore(ind, refNode);
}

function placeIndicatorAfter(refNode) {
  removeIndicator();
  if (!refNode || !refNode.parentNode) return;
  const ind = document.createElement("div");
  ind.className = "drop-indicator";
  if (refNode.nextSibling) refNode.parentNode.insertBefore(ind, refNode.nextSibling);
  else refNode.parentNode.appendChild(ind);
}

// dragover on the tree (root) — for reordering categories/standalone items
$("#tree").addEventListener("dragover", (e) => {
  if (!dragCtx) return;
  // engines/separators can drop here; categories must also drop here only
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const tree = e.currentTarget;
  const after = getDragAfterElement(tree, e.clientY, ".cat, #tree > .eng, #tree > .sep-row");
  if (after == null) {
    // append at end — place indicator at end
    removeIndicator();
    const ind = document.createElement("div");
    ind.className = "drop-indicator";
    tree.appendChild(ind);
  } else {
    placeIndicatorBefore(after);
  }
});

$("#tree").addEventListener("drop", async (e) => {
  if (!dragCtx) return;
  e.preventDefault();
  e.stopPropagation();
  const tree = e.currentTarget;
  const indicator = $(".drop-indicator", tree);
  let index = state.items.length;
  if (indicator) {
    // count siblings before indicator that match top-level items
    const allTop = $$("#tree > .cat, #tree > .eng, #tree > .sep-row");
    let count = 0;
    for (const node of [...tree.children]) {
      if (node === indicator) break;
      if (node.matches?.(".cat, .eng, .sep-row")) count++;
    }
    index = count;
  }
  await applyDrop(null, index);
  removeIndicator();
});

// dragover on a category body — for engines/separators inside that category
function onChildDragOver(e) {
  if (!dragCtx) return;
  if (dragCtx.type === "category") return; // categories can't go inside
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = "move";
  const body = e.currentTarget;
  const after = getDragAfterElement(body, e.clientY, ".eng, .sep-row");
  if (after == null) {
    removeIndicator();
    const ind = document.createElement("div");
    ind.className = "drop-indicator";
    body.appendChild(ind);
  } else {
    placeIndicatorBefore(after);
  }
}
function onChildDragLeave(e) {
  // only clear if leaving the body entirely
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
  // don't remove indicator here; tree dragover will handle if moving up
}
async function onChildDrop(e) {
  if (!dragCtx) return;
  if (dragCtx.type === "category") return;
  e.preventDefault();
  e.stopPropagation();
  const body = e.currentTarget;
  const catId = body.dataset.catId;
  const indicator = $(".drop-indicator", body);
  let index = 0;
  if (indicator) {
    for (const node of [...body.children]) {
      if (node === indicator) break;
      if (node.matches?.(".eng, .sep-row")) index++;
    }
  } else {
    const cat = state.items.find(i => i.id === catId);
    index = cat ? cat.children.length : 0;
  }
  await applyDrop(catId, index);
  removeIndicator();
}

// dragover/drop on individual rows (so we can drop into middle of a list)
function onRowDragOver(e) {
  if (!dragCtx) return;
  if (dragCtx.type === "category") return;
  e.preventDefault();
  e.stopPropagation();
  const row = e.currentTarget;
  const rect = row.getBoundingClientRect();
  const before = (e.clientY - rect.top) < rect.height / 2;
  if (before) placeIndicatorBefore(row);
  else placeIndicatorAfter(row);
}
function onRowDragLeave(e) { /* no-op; parent handles */ }
async function onRowDrop(e) {
  if (!dragCtx) return;
  if (dragCtx.type === "category") return;
  e.preventDefault();
  e.stopPropagation();
  const row = e.currentTarget;
  const parent = row.parentNode;
  const catId = parent.dataset.catId || null;
  const indicator = $(".drop-indicator", parent);
  let index = 0;
  if (indicator) {
    for (const node of [...parent.children]) {
      if (node === indicator) break;
      if (node.matches?.(".eng, .sep-row")) index++;
    }
  }
  await applyDrop(catId, index);
  removeIndicator();
}

function getDragAfterElement(container, y, selector) {
  const draggables = [...container.querySelectorAll(selector)].filter(el => !el.classList.contains("dragging") && el.style.opacity !== "0.4");
  // only DIRECT children
  const direct = draggables.filter(el => el.parentNode === container);
  return direct.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

async function applyDrop(targetCatId, index) {
  // virtual UNCATEGORIZED folder = root level
  if (targetCatId === "__uncategorized__") targetCatId = null;
  const removed = removeItem(dragCtx.id);
  if (!removed) return;
  // adjust index if moving within same parent and original was before target
  if ((removed.parent ? removed.parent.id : null) === targetCatId) {
    if (removed.index < index) index--;
  }
  insertItem(removed.item, targetCatId, index);
  await persist();
  render();
}

// ============================================================
// EVENT WIRING
// ============================================================
$("#btn-export").addEventListener("click", doExport);
$("#btn-import").addEventListener("click", openImportModal);
$("#btn-find-broken").addEventListener("click", findBrokenEngines);
$("#btn-settings").addEventListener("click", openSettingsModal);
$("#btn-add-category-top").addEventListener("click", () => openCategoryModal(null));
$("#btn-expand-all").addEventListener("click", expandAllCategories);
$("#btn-collapse-all").addEventListener("click", collapseAllCategories);

// sort dropdown
function setupSortDropdown() {
  const btn = $("#btn-sort-root");
  const menu = $("#sort-menu");
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  document.addEventListener("click", () => { menu.hidden = true; });

  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    const target = e.target.closest("[data-sort]");
    if (target) {
      menu.hidden = true;
      sortRoot(target.dataset.sort);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      menu.hidden = true;
    }
  });
}

$$(".btn-add").forEach(b => {
  b.addEventListener("click", () => {
    const type = b.dataset.add;
    if (type === "category") openCategoryModal(null);
    else if (type === "engine") openEngineModal(null, null);
    else if (type === "separator") addSeparator(null);
  });
});

// close modal on backdrop or close button
$("#modal-backdrop").addEventListener("click", closeAllModals);
$$("[data-close]").forEach(b => b.addEventListener("click", closeAllModals));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllModals();
});

// toast helper
let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", isErr);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

// react to external sync changes (other devices)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    state = changes[STORAGE_KEY].newValue;
    render();
  }
});

// ----- boot -----
(async () => {
  await load();
  render();
  bindPrefixClickToEdit();
  setupEngineCategoryNewHandler();
  setupSortDropdown();
})();
