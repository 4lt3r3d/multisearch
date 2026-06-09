// ============================================================
// MULTISEARCH // POPUP LOGIC
// Used in two modes:
//   1) Toolbar popup (no params): user clicks DETECT manually
//   2) Window mode (?auto=1&tabId=N): auto-detects on the given tab
// ============================================================

const STORAGE_KEY = "ms_data_v1";
const PLACEHOLDER_RE = /\{searchTerms\}|%s/g;

const CHROME_BASE_URLS = {
  "google:baseURL": "https://www.google.com/",
  "google:baseSearchURL": "https://www.google.com/search?",
  "google:baseSuggestURL": "https://www.google.com/complete/search?",
  "bing:baseURL": "https://www.bing.com/",
  "yahoo:baseURL": "https://search.yahoo.com/",
  "duckduckgo:baseURL": "https://duckduckgo.com/",
  "ecosia:baseURL": "https://www.ecosia.org/",
  "startpage:baseURL": "https://www.startpage.com/",
  "qwant:baseURL": "https://www.qwant.com/",
  "yandex:baseURL": "https://yandex.com/",
  "baidu:baseURL": "https://www.baidu.com/",
  "brave:baseURL": "https://search.brave.com/",
  "mojeek:baseURL": "https://www.mojeek.com/"
};

// ----- utilities -----
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "html") n.innerHTML = v;
      else if (v === true) n.setAttribute(k, "");
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    n.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}
function uid() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 12);
}
function sanitizeNick(s, fallback = "x") {
  s = (s || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (s) return s;
  const f = (fallback || "x").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return f || "x";
}
function cleanQueryUrl(rawUrl) {
  let u = rawUrl.trim();
  u = u.replace(/\{searchTerms\??\}/g, "{searchTerms}");
  for (const [k, v] of Object.entries(CHROME_BASE_URLS)) {
    u = u.split("{" + k + "}").join(v);
  }
  u = u.replace(/\{inputEncoding\}/g, "UTF-8").replace(/\{outputEncoding\}/g, "UTF-8");
  u = u.replace(/\{(?!searchTerms\})[^}]*\}/g, "");
  u = u.replace(/\?&+/g, "?").replace(/&{2,}/g, "&").replace(/&+$/g, "").replace(/\?$/, "");
  return u.trim();
}

// ============================================================
// URL-based search engine inference
//
// When a page doesn't publish an OpenSearch descriptor, we can often still
// figure out its search URL pattern from the *current* URL. If the URL is
// the result of a search submission, its query string almost always carries
// the search term in one of its parameters. We score each parameter and
// produce candidate templates where the value has been swapped for %s.
//
// Examples this catches:
//   https://shopgoodwill.com/categories/listing?st=TEST&sg=&c=...
//     → https://shopgoodwill.com/categories/listing?st=%s&sg=&c=...
//   https://www.ebay.com/sch/i.html?_nkw=test
//     → https://www.ebay.com/sch/i.html?_nkw=%s
// ============================================================
const SEARCH_PARAM_NAMES = new Set([
  "q", "query", "s", "search", "search_query", "searchquery", "searchterm",
  "search_term", "st", "term", "keyword", "keywords", "k", "kw", "kwd",
  "text", "find", "p", "_nkw", "wd", "w"
]);

function scoreUrlParam(key, value) {
  if (!value) return 0;
  // The decoded value's length and content matter
  let decoded = value;
  try { decoded = decodeURIComponent(value.replace(/\+/g, " ")); } catch {}
  if (decoded.length < 2 || decoded.length > 200) return 0;
  // pure numeric values are almost certainly IDs/pagination/filters
  if (/^\d+(\.\d+)?$/.test(decoded)) return 0;
  // boolean flags
  if (/^(true|false|yes|no|on|off)$/i.test(decoded)) return 0;
  // must contain at least one alphabetic (or CJK / extended Latin) character
  if (!/[a-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/i.test(decoded)) return 0;

  let score = 1;
  if (SEARCH_PARAM_NAMES.has(key.toLowerCase())) score += 10;
  if (decoded.length >= 3 && decoded.length <= 80) score += 1;
  // bonus for human-looking text (has spaces or multiple words once decoded)
  if (/\s/.test(decoded)) score += 1;
  return score;
}

function inferEnginesFromUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return []; }
  const rawQuery = u.search.slice(1); // strip leading ?
  if (!rawQuery) return [];

  // Walk the raw query string preserving the original encoding of every pair
  const rawPairs = rawQuery.split("&");
  const candidates = [];
  for (let i = 0; i < rawPairs.length; i++) {
    const pair = rawPairs[i];
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const rawKey = pair.slice(0, eqIdx);
    const rawVal = pair.slice(eqIdx + 1);
    let key = rawKey;
    try { key = decodeURIComponent(rawKey); } catch {}
    const score = scoreUrlParam(key, rawVal);
    if (score <= 0) continue;

    // Build the templated URL: replace only THIS pair's value with %s,
    // leave other pairs in their original encoded form (no information loss).
    const templatedPairs = rawPairs.slice();
    templatedPairs[i] = `${rawKey}=%s`;
    const templateUrl = `${u.origin}${u.pathname}?${templatedPairs.join("&")}${u.hash || ""}`;
    candidates.push({
      key,
      score,
      templateUrl,
      suggestedNick: u.hostname.replace(/^www\./, "").split(".")[0]
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  // If any candidate matched a known search-param name (score >= 10), only
  // surface those — they're high-confidence. Otherwise return the top single
  // best-guess so the user still gets something to act on.
  const strong = candidates.filter(c => c.score >= 10);
  if (strong.length > 0) return strong;
  return candidates.slice(0, 1);
}

// ----- state -----
let state = null;
let targetTab = null;
let isWindowMode = false;
let addedCount = 0;

const params = new URLSearchParams(location.search);

// ----- toast -----
let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", isErr);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}
function status(msg, kind = "") {
  const s = $("#status");
  s.textContent = msg;
  s.classList.remove("err", "ok");
  if (kind) s.classList.add(kind);
  s.classList.add("show");
}
function clearStatus() {
  $("#status").classList.remove("show");
}

// ----- storage -----
async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  state = stored[STORAGE_KEY] || { schema: 1, settings: {}, items: [] };
}
async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

// ----- target tab -----
async function resolveTargetTab() {
  const forcedTabId = params.get("tabId");
  isWindowMode = params.get("auto") === "1";

  if (forcedTabId) {
    try {
      targetTab = await chrome.tabs.get(parseInt(forcedTabId, 10));
    } catch (e) {
      // tab closed in the meantime
      targetTab = null;
    }
  } else {
    // toolbar popup mode — find the active tab in the focused window
    // (NOT the popup itself, which has no tab)
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length && !tabs[0].url.startsWith("chrome-extension://")) {
      targetTab = tabs[0];
    } else {
      // fallback: any active tab in any normal window
      const anyTabs = await chrome.tabs.query({ active: true });
      targetTab = anyTabs.find(t => !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://")) || null;
    }
  }

  if (targetTab) {
    $("#page-title").textContent = targetTab.title || "(no title)";
    try {
      $("#page-host").textContent = new URL(targetTab.url).hostname;
    } catch { $("#page-host").textContent = ""; }
  } else {
    $("#page-title").textContent = "(no scannable tab)";
    $("#page-host").textContent = "";
    $("#btn-detect").disabled = true;
  }
}

// ----- detect -----
async function runDetect() {
  if (!targetTab) {
    status("No scannable tab.", "err");
    return;
  }
  // restricted URLs can't be scripted
  const url = targetTab.url || "";
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("about:") || url.startsWith("file://")) {
    status("Cannot scan internal/restricted pages.", "err");
    return;
  }

  status("Scanning page...");
  $("#results").innerHTML = "";
  $("#manual-form").hidden = true;

  let scanResult;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: () => {
        const links = Array.from(document.querySelectorAll('link[rel~="search"]'));
        return {
          opensearch: links.map(l => ({
            title: l.getAttribute("title") || "",
            href: l.getAttribute("href") || "",
            type: l.getAttribute("type") || ""
          })).filter(l => l.href),
          pageTitle: document.title,
          pageUrl: location.href
        };
      }
    });
    scanResult = r.result;
  } catch (e) {
    status("Scan failed: " + e.message, "err");
    return;
  }

  if (!scanResult || scanResult.opensearch.length === 0) {
    // Fallback — try common standard paths (sites with the file but no link tag).
    status("No <link rel=\"search\"> tag. Trying common paths...", "");
    const fallbackPaths = ["/opensearch.xml", "/search.xml", "/opensearchdescription.xml"];
    const baseUrl = scanResult ? scanResult.pageUrl : url;
    const fallbacks = [];
    for (const path of fallbackPaths) {
      let candidateUrl;
      try { candidateUrl = new URL(path, baseUrl).href; } catch { continue; }
      try {
        const resp = await fetch(candidateUrl, { credentials: "omit" });
        if (!resp.ok) continue;
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        // some sites return text/html on 404 with 200 — sanity check the body
        const txt = await resp.text();
        if (!/<\s*opensearchdescription/i.test(txt)) continue;
        fallbacks.push({
          title: path,
          href: candidateUrl,
          type: ct || "application/opensearchdescription+xml"
        });
        break; // first hit wins
      } catch { /* fetch failed (CORS, network) — try next */ }
    }
    if (fallbacks.length === 0) {
      // No OpenSearch found anywhere. Fall back to URL-based detection —
      // look at the current page URL and infer the search engine from its
      // query string. This handles modern sites (ShopGoodwill, eBay, etc.)
      // that simply don't publish OpenSearch descriptors.
      const pageUrl = scanResult ? scanResult.pageUrl : url;
      const inferred = inferEnginesFromUrl(pageUrl);
      if (inferred && inferred.length > 0) {
        const pageU = new URL(pageUrl);
        const baseName = (scanResult && scanResult.pageTitle)
          ? scanResult.pageTitle.split(/[\|\-\u2013\u2014\u00B7]/)[0].trim()
          : pageU.hostname.replace(/^www\./, "");
        const baseNick = pageU.hostname.replace(/^www\./, "").split(".")[0];

        status(`No OpenSearch. Inferred ${inferred.length} search engine${inferred.length === 1 ? "" : "s"} from the URL pattern.`, "ok");
        const resultsEl = $("#results");
        for (const cand of inferred.slice(0, 5)) {
          const card = renderResultCard({
            name: baseName,
            nick: cand.suggestedNick || baseNick,
            query: cand.templateUrl
          });
          resultsEl.appendChild(card);
        }
        updateAddAllRow();
        return;
      }
      status("This page doesn't advertise an OpenSearch descriptor, and no search-like query parameters were found in the URL. Use ADD MANUALLY below.", "");
      $("#manual-form").hidden = false;
      return;
    }
    // promote fallbacks into scanResult so the rest of the flow handles them
    if (!scanResult) scanResult = { opensearch: [], pageTitle: "", pageUrl: url };
    scanResult.opensearch = fallbacks;
    status(`Found ${fallbacks.length} descriptor via fallback path. Fetching...`, "ok");
  }

  status(`Found ${scanResult.opensearch.length} descriptor(s). Fetching templates...`, "ok");

  // fetch each descriptor's XML in parallel
  const results = await Promise.all(scanResult.opensearch.map(async (os) => {
    const absUrl = new URL(os.href, scanResult.pageUrl).href;
    let template = null, osName = null;
    try {
      const resp = await fetch(absUrl, { credentials: "omit" });
      const txt = await resp.text();
      const doc = new DOMParser().parseFromString(txt, "text/xml");
      const urls = Array.from(doc.querySelectorAll("Url"));
      for (const u of urls) {
        if ((u.getAttribute("type") || "").toLowerCase().includes("html")) {
          template = u.getAttribute("template");
          break;
        }
      }
      if (!template && urls.length > 0) template = urls[0].getAttribute("template");
      osName = doc.querySelector("ShortName")?.textContent?.trim()
            || doc.querySelector("LongName")?.textContent?.trim()
            || null;
    } catch (e) {
      // CORS or fetch failure — fall back to descriptor URL
    }
    // normalize template: clean Chrome tokens, then convert {searchTerms} to %s
    let cleanedTemplate = null;
    if (template) {
      cleanedTemplate = cleanQueryUrl(template).replace(/\{searchTerms\}/g, "%s");
    }
    return {
      descriptorUrl: absUrl,
      title: os.title,
      template: cleanedTemplate,
      name: osName || os.title || scanResult.pageTitle,
      pageUrl: scanResult.pageUrl
    };
  }));

  // filter valid (have template)
  const valid = results.filter(r => r.template && /^https?:/i.test(r.template));
  const invalid = results.filter(r => !valid.includes(r));

  if (valid.length === 0) {
    status("Descriptors found but no usable templates. Use ADD MANUALLY below.", "err");
    $("#manual-form").hidden = false;
    return;
  }

  // Keep status visible above results — show count permanently
  status(`Found ${valid.length} engine${valid.length === 1 ? "" : "s"} on this page.`, "ok");
  renderResults(valid, scanResult.pageUrl);
  if (invalid.length > 0) {
    const note = el("p", { class: "muted", style: "padding:6px 14px" },
      `Note: ${invalid.length} descriptor(s) couldn't be parsed (CORS or invalid XML).`);
    $("#results").appendChild(note);
  }
  updateAddAllRow();
}

// ----- render result cards -----
function renderResults(items, pageUrl) {
  const out = $("#results");
  out.innerHTML = "";

  for (const item of items) {
    const proposedNick = sanitizeNick(item.name, item.name);
    const card = renderResultCard({
      name: item.name,
      nick: proposedNick,
      query: item.template
    });
    out.appendChild(card);
  }
}

function renderResultCard(initial) {
  const id = uid();
  const card = el("div", { class: "result-card", dataset: { tempId: id } });

  const nameInput = el("input", { type: "text", value: initial.name, maxlength: 60 });
  const nickInput = el("input", { type: "text", value: initial.nick, maxlength: 16 });
  const queryInput = el("input", { type: "text", value: initial.query });

  const imgCheck = el("input", { type: "checkbox", class: "img-check" });
  if (initial.imageSearch) imgCheck.checked = true;
  const imgRow = el("label", { class: "img-check-row", title: "If checked, this engine receives the IMAGE URL (used with right-click on images) instead of selected text." },
    imgCheck,
    el("span", {}, "REVERSE IMAGE SEARCH ENGINE")
  );

  const catSelect = el("select", { class: "category-select" });
  populateCategorySelect(catSelect, "");

  const catField = el("div", { class: "field" },
    el("span", { class: "field-label" }, "CATEGORY"),
    catSelect
  );

  catSelect.addEventListener("change", () => {
    if (catSelect.value === "__new__") {
      showInlineNewCategoryCard(catSelect, catField, catSelect.dataset.lastValid || "");
    } else {
      catSelect.dataset.lastValid = catSelect.value;
    }
  });

  const addBtn = el("button", { class: "btn btn-primary btn-tiny" }, "+ ADD");
  const skipBtn = el("button", { class: "btn btn-tiny" }, "DISCARD");

  // performAdd: returns {ok, reason}. Used by both individual button and ADD ALL.
  // silent=true skips the no-placeholder confirm dialog
  const performAdd = async ({ silent = false } = {}) => {
    if (card.classList.contains("added") || card.classList.contains("discarded")) return { ok: false, reason: "already" };
    const name = nameInput.value.trim();
    const nick = sanitizeNick(nickInput.value.trim(), name);
    const query = queryInput.value.trim();
    if (!name || !query) return { ok: false, reason: "missing fields" };
    if (!/^https?:/i.test(query)) return { ok: false, reason: "invalid URL" };
    if (!PLACEHOLDER_RE.test(query)) {
      PLACEHOLDER_RE.lastIndex = 0;
      if (!silent) {
        if (!confirm("URL has no %s or {searchTerms} placeholder. The query will be appended as ?q=. Continue?")) {
          return { ok: false, reason: "user cancelled" };
        }
      } else {
        return { ok: false, reason: "no placeholder" };
      }
    }
    PLACEHOLDER_RE.lastIndex = 0;

    const engine = { id: uid(), type: "engine", name, nick, query, imageSearch: !!imgCheck.checked };
    const catId = (catSelect.value && catSelect.value !== "__new__") ? catSelect.value : "";
    let catName = null;
    if (catId) {
      const cat = state.items.find(i => i.id === catId && i.type === "category");
      if (cat) { cat.children.push(engine); catName = cat.name; }
    } else {
      state.items.push(engine);
    }
    try {
      await saveState();
      markCardAdded(card, name, catName);
      addedCount++;
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "storage failed" };
    }
  };

  addBtn.addEventListener("click", async () => {
    const r = await performAdd();
    if (r.ok) { toast(`ADDED (${addedCount})`); }
    else if (r.reason !== "user cancelled" && r.reason !== "already") { toast(r.reason.toUpperCase(), true); }
    updateAddAllRow();
  });

  skipBtn.addEventListener("click", () => {
    card.classList.add("discarded");
    card.remove();
    updateAddAllRow();
  });

  card._performAdd = performAdd; // expose for ADD ALL

  card.appendChild(el("div", { class: "result-row" },
    el("div", { class: "field" },
      el("span", { class: "field-label" }, "NAME"),
      nameInput
    ),
    el("div", { class: "field", style: "flex: 0 0 90px" },
      el("span", { class: "field-label" }, "NICK"),
      nickInput
    )
  ));
  card.appendChild(el("div", { class: "field" },
    el("span", { class: "field-label" }, "QUERY URL"),
    queryInput
  ));
  card.appendChild(imgRow);
  card.appendChild(el("div", { class: "result-row" }, catField));
  card.appendChild(el("div", { class: "result-actions" }, skipBtn, addBtn));

  return card;
}

function populateCategorySelect(sel, selectedId) {
  sel.innerHTML = "";
  sel.appendChild(el("option", { value: "" }, "\u2014 STANDALONE \u2014"));
  for (const it of state.items) {
    if (it.type === "category") {
      sel.appendChild(el("option", { value: it.id }, `[${it.name}] /${it.nick}`));
    }
  }
  sel.appendChild(el("option", { value: "__new__" }, "+ NEW CATEGORY\u2026"));
  const stillExists = !selectedId || state.items.some(i => i.id === selectedId);
  sel.value = stillExists ? (selectedId || "") : "";
  sel.dataset.lastValid = sel.value;
}

function refreshAllCategorySelects() {
  // Re-populate every visible category select; skip ones currently in new-cat input mode (hidden).
  for (const sel of $$(".category-select")) {
    if (sel.style.display === "none") continue;
    const current = (sel.value && sel.value !== "__new__") ? sel.value : (sel.dataset.lastValid || "");
    populateCategorySelect(sel, current);
  }
}

function showInlineNewCategoryCard(selectEl, mountEl, previousValue) {
  const row = el("div", { class: "inline-new-cat-row" });
  const input = el("input", {
    type: "text",
    placeholder: "new category name",
    maxlength: 32,
    autocomplete: "off"
  });
  const confirmBtn = el("button", { type: "button", class: "btn btn-primary btn-tiny" }, "\u2713 CREATE");
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
    if (newId) {
      // refresh every card's select so the new category is offered everywhere,
      // and select it in this card
      refreshAllCategorySelects();
      selectEl.value = newId;
      selectEl.dataset.lastValid = newId;
    } else {
      selectEl.value = previousValue || "";
      selectEl.dataset.lastValid = selectEl.value;
    }
  };

  const cancel = () => restoreSelect(null);
  const confirm = async () => {
    const name = input.value.trim();
    if (!name) { toast("ENTER A NAME", true); input.focus(); return; }
    let baseNick = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "cat";
    let nick = baseNick, n = 2;
    while (state.items.some(i => i.type === "category" && i.nick === nick)) {
      nick = baseNick + n;
      n++;
    }
    const newCat = { id: uid(), type: "category", name, nick, expanded: true, children: [] };
    state.items.push(newCat);
    try {
      await saveState();
    } catch (e) {
      toast("STORAGE FAILED", true);
      return;
    }
    restoreSelect(newCat.id);
    toast(`+ [${name}]`);
  };

  cancelBtn.addEventListener("click", cancel);
  confirmBtn.addEventListener("click", confirm);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  { e.preventDefault(); confirm(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
}

function markCardAdded(card, name, catName) {
  card.classList.add("added");
  card.innerHTML = "";
  card.appendChild(el("div", { class: "result-added-badge" },
    `✓ ADDED — ${name}${catName ? " → " + catName : ""}`));
}

function activeCards() {
  return $$("#results .result-card").filter(c =>
    !c.classList.contains("added") && !c.classList.contains("discarded"));
}

function updateAddAllRow() {
  const cards = activeCards();
  const row = $("#add-all-row");
  if (cards.length >= 2) {
    row.hidden = false;
    $("#add-all-count").textContent = `(${cards.length})`;
  } else {
    row.hidden = true;
  }
}

async function addAllCards() {
  const cards = activeCards();
  if (cards.length === 0) return;
  let added = 0;
  let skipped = 0;
  for (const card of cards) {
    if (!card._performAdd) continue;
    const r = await card._performAdd({ silent: true });
    if (r.ok) added++;
    else skipped++;
  }
  if (added > 0) {
    toast(`ADDED ${added}${skipped ? ` (${skipped} skipped)` : ""}`);
  } else if (skipped > 0) {
    toast(`SKIPPED ${skipped} — CHECK FIELDS`, true);
  }
  updateAddAllRow();
}

// ----- manual add -----
$("#btn-toggle-manual").addEventListener("click", () => {
  // Always open the form, never hide it via this button. If already open,
  // re-focus the URL field so the click still produces a visible effect.
  const f = $("#manual-form");
  f.hidden = false;
  const urlInput = $("#manual-url");
  urlInput.focus();
  urlInput.select();
});

$("#btn-manual-close").addEventListener("click", () => {
  $("#manual-form").hidden = true;
});

$("#btn-manual-template").addEventListener("click", () => {
  const url = $("#manual-url").value.trim();
  const q = $("#manual-query").value.trim();
  if (!url || !q) { toast("FILL BOTH FIELDS", true); return; }

  // Try every plausible encoding the URL might use for the query string.
  // %20 vs +, raw, encodeURIComponent, and as a last-resort case-insensitive
  // search to handle URLs that uppercase the term.
  const enc = encodeURIComponent(q);
  const variants = [
    q,
    enc,
    enc.replace(/%20/g, "+"),
    q.replace(/ /g, "+")
  ];
  let templated = null;
  for (const v of variants) {
    if (v && url.includes(v)) {
      templated = url.split(v).join("%s");
      break;
    }
  }
  if (!templated) {
    // case-insensitive last resort — preserve original case in the URL
    const lowerUrl = url.toLowerCase();
    for (const v of variants) {
      if (!v) continue;
      const idx = lowerUrl.indexOf(v.toLowerCase());
      if (idx >= 0) {
        templated = url.slice(0, idx) + "%s" + url.slice(idx + v.length);
        // also replace any further occurrences case-insensitively
        templated = templated.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "%s");
        break;
      }
    }
  }
  if (!templated) {
    toast("QUERY NOT FOUND IN URL", true);
    return;
  }

  let hostname = "site";
  try { hostname = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  const proposedName = hostname;
  const proposedNick = sanitizeNick(hostname.split(".")[0]);
  const card = renderResultCard({ name: proposedName, nick: proposedNick, query: templated });
  $("#results").prepend(card);
  $("#manual-url").value = "";
  $("#manual-query").value = "";
  $("#manual-form").hidden = true;
  updateAddAllRow();
  toast("EDIT THEN ADD");
});

// ----- buttons -----
$("#btn-detect").addEventListener("click", () => runDetect());
$("#btn-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  if (isWindowMode) window.close();
});
$("#btn-add-all").addEventListener("click", () => addAllCards());

// ============================================================
// AUTO-RESIZE (window mode only)
//
// Uses ResizeObserver to track the rendered size of the popup's
// content. Fires for ANY reason content height changes:
//   - cards added / discarded / collapsed to ADDED badges
//   - status messages appearing / disappearing
//   - manual section expanded / collapsed
//   - font load shifts layout
//   - long URLs wrapping to additional lines as you type
//   - any other reflow
//
// The window is resized to scrollHeight + a small chrome offset,
// clamped to a sensible [min, max] range so the window never gets
// absurdly tiny or larger than the screen.
//
// Critical guarantees:
//   - Window will never have unwanted empty space below content
//   - Window will never clip content (up to MAX height; beyond that
//     the content scrolls inside the window — which the user said
//     is fine when there are many engines).
// ============================================================
const RESIZE_MIN_H = 220;
const RESIZE_MAX_H = 900;
const WINDOW_CHROME_H = 40; // title bar + borders for Chromium popup windows

let __resizeTimer = null;
function debouncedResize() {
  clearTimeout(__resizeTimer);
  __resizeTimer = setTimeout(actuallyResize, 50);
}

async function actuallyResize() {
  if (!isWindowMode) return;
  // scrollHeight reflects the full content height even if it exceeds the viewport
  const contentH = document.documentElement.scrollHeight;
  const targetH = Math.max(RESIZE_MIN_H, Math.min(RESIZE_MAX_H, contentH + WINDOW_CHROME_H));
  try {
    const win = await chrome.windows.getCurrent();
    if (win && win.id) {
      await chrome.windows.update(win.id, { height: targetH });
    }
  } catch (e) {
    // window may have been closed; ignore
  }
}

function setupAutoResize() {
  if (!isWindowMode) return;
  // ResizeObserver fires on every size change of the observed element,
  // catching layout shifts that MutationObserver alone would miss.
  const observer = new ResizeObserver(() => debouncedResize());
  observer.observe(document.body);
  observer.observe(document.documentElement);
  // also resize once fonts load (font metrics shift layout)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => debouncedResize());
  }
  // immediate initial sync — don't wait for the first observer fire
  actuallyResize();
}

// ----- boot -----
(async () => {
  await loadState();
  await resolveTargetTab();
  setupAutoResize();
  if (params.get("auto") === "1") {
    await runDetect();
  }
})();
