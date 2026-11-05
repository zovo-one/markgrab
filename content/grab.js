/*
 * MarkGrab - content script: extract readable content, convert to GFM, copy.
 * Classic script, fully self-contained, idempotent, zero dependencies.
 * All processing is 100% local. No network calls from this file.
 */
(function () {
  "use strict";

  if (window.__markgrab) { return; }

  var MAX_DEPTH = 200;
  var MAX_LIST_DEPTH = 12;
  var MIN_WORDS = 40;
  var TOAST_ID = "markgrab-toast";

  var STRIP_SELECTOR = [
    "script", "style", "noscript", "nav", "aside", "footer", "header", "form",
    "iframe", "button", "svg", "[aria-hidden=\"true\"]",
    "[class*=\"nav\"]", "[class*=\"menu\"]", "[class*=\"sidebar\"]",
    "[class*=\"footer\"]", "[class*=\"comment\"]", "[class*=\"share\"]",
    "[class*=\"related\"]", "[class*=\"ad-\"]", "[id*=\"comment\"]"
  ].join(",");

  var SELECTION_STRIP_SELECTOR = "script,style,noscript,iframe,svg,button";

  /* ------------------------------------------------------------------ */
  /* i18n                                                                */
  /* ------------------------------------------------------------------ */

  function msg(key, subs) {
    try {
      var m = chrome.i18n.getMessage(key, subs);
      return m || key;
    } catch (e) {
      return key;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Pure converter core (DOM node -> GFM). No document/window access:   */
  /* only nodeType, nodeName, childNodes, getAttribute, nodeValue,       */
  /* textContent and the URL constructor. Testable outside the browser.  */
  /* ------------------------------------------------------------------ */

  function isEl(n) { return !!n && n.nodeType === 1; }
  function isTxt(n) { return !!n && n.nodeType === 3; }

  function tagOf(n) { return String(n && n.nodeName || "").toUpperCase(); }

  function attrOf(n, name) {
    if (!n || typeof n.getAttribute !== "function") { return null; }
    var v = null;
    try { v = n.getAttribute(name); } catch (e) { v = null; }
    return v == null ? null : String(v);
  }

  function rawText(n) {
    if (isTxt(n)) { return n.nodeValue == null ? "" : String(n.nodeValue); }
    return (n && n.textContent != null) ? String(n.textContent) : "";
  }

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, SVG: 1,
    BUTTON: 1, SELECT: 1, INPUT: 1, TEXTAREA: 1, OBJECT: 1, EMBED: 1
  };

  var CONTAINER_TAGS = {
    DIV: 1, SECTION: 1, ARTICLE: 1, MAIN: 1, ASIDE: 1, HEADER: 1, FOOTER: 1,
    NAV: 1, ADDRESS: 1, DL: 1, DT: 1, DD: 1, DETAILS: 1, SUMMARY: 1,
    FIELDSET: 1, FIGURE: 1, CENTER: 1, BODY: 1, HTML: 1, "#ROOT": 1
  };

  function isBlockTag(tag) {
    if (/^H[1-6]$/.test(tag)) { return true; }
    if (CONTAINER_TAGS[tag]) { return true; }
    return tag === "P" || tag === "HR" || tag === "BLOCKQUOTE" || tag === "PRE" ||
      tag === "UL" || tag === "OL" || tag === "TABLE" || tag === "FIGCAPTION";
  }

  function absUrl(u, base) {
    try { return new URL(u, base).href; } catch (e) { return u; }
  }

  function nextCtx(ctx) {
    return { base: ctx.base, depth: ctx.depth + 1 };
  }

  function inlineChildren(node, ctx) {
    var s = "";
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      s += renderInline(kids[i], ctx);
    }
    return s;
  }

  function renderInline(node, ctx) {
    if (ctx.depth > MAX_DEPTH) { return ""; }
    if (isTxt(node)) { return rawText(node).replace(/\s+/g, " "); }
    if (!isEl(node)) { return ""; }

    var tag = tagOf(node);
    if (SKIP_TAGS[tag]) { return ""; }

    var ctx2 = nextCtx(ctx);
    var inner;

    if (tag === "BR") { return "  \n"; }

    if (tag === "IMG") {
      var src = attrOf(node, "src");
      if (!src) { return ""; }
      var alt = attrOf(node, "alt") || "";
      return "![" + alt.replace(/\s+/g, " ").trim() + "](" + absUrl(src, ctx.base) + ")";
    }

    if (tag === "A") {
      inner = inlineChildren(node, ctx2).trim();
      if (!inner) { return ""; }
      var href = attrOf(node, "href");
      if (!href) { return inner; }
      return "[" + inner + "](" + absUrl(href, ctx.base) + ")";
    }

    if (tag === "STRONG" || tag === "B") {
      inner = inlineChildren(node, ctx2).trim();
      return inner ? "**" + inner + "**" : "";
    }

    if (tag === "EM" || tag === "I") {
      inner = inlineChildren(node, ctx2).trim();
      return inner ? "*" + inner + "*" : "";
    }

    if (tag === "CODE") {
      var codeText = rawText(node).replace(/\s+/g, " ").trim();
      if (!codeText) { return ""; }
      if (codeText.indexOf("`") !== -1) { return "`` " + codeText + " ``"; }
      return "`" + codeText + "`";
    }

    if (isBlockTag(tag)) {
      /* Block landed in an inline position (e.g. inside a list item):
         flatten it to a single line. */
      return renderBlock(node, ctx).replace(/\n+/g, " ");
    }

    return inlineChildren(node, ctx2);
  }

  function renderPre(el, ctx) {
    var code = null;
    var kids = el.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (isEl(kids[i]) && tagOf(kids[i]) === "CODE") { code = kids[i]; break; }
    }
    var cls = (attrOf(code, "class") || "") + " " + (attrOf(el, "class") || "");
    var lm = /(?:^|\s)language-([A-Za-z0-9#+_-]+)/.exec(cls);
    var lang = lm ? lm[1] : "";
    var text = rawText(code || el).replace(/^\n+/, "").replace(/\s+$/, "");
    if (!text) { return ""; }
    var fence = text.indexOf("```") !== -1 ? "````" : "```";
    return fence + lang + "\n" + text + "\n" + fence + "\n\n";
  }

  function renderList(listEl, ctx, depth) {
    if (depth > MAX_LIST_DEPTH) { return ""; }
    var ordered = tagOf(listEl) === "OL";
    var index = 1;
    var lines = [];
    var indent = "  ".repeat(depth);
    var kids = listEl.childNodes || [];
    var ctx2 = nextCtx(ctx);

    for (var i = 0; i < kids.length; i++) {
      var li = kids[i];
      if (!isEl(li) || tagOf(li) !== "LI") { continue; }

      var nested = [];
      var inline = "";
      var liKids = li.childNodes || [];
      for (var j = 0; j < liKids.length; j++) {
        var g = liKids[j];
        var gt = isEl(g) ? tagOf(g) : "";
        if (gt === "UL" || gt === "OL") {
          nested.push(g);
        } else if (isEl(g) && isBlockTag(gt)) {
          inline += " " + renderBlock(g, ctx2).replace(/\n+/g, " ");
        } else {
          inline += renderInline(g, ctx2);
        }
      }
      inline = inline.replace(/[ \t]+/g, " ").trim();

      var marker = ordered ? String(index) + ". " : "- ";
      index += 1;
      lines.push(indent + marker + inline);

      for (var k = 0; k < nested.length; k++) {
        var sub = renderList(nested[k], ctx, depth + 1);
        if (sub) { lines.push(sub); }
      }
    }
    return lines.join("\n");
  }

  function collectTableRows(el, rows, guard) {
    if (guard > 6) { return; }
    var kids = el.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (!isEl(c)) { continue; }
      var t = tagOf(c);
      if (t === "TR") {
        rows.push(c);
      } else if (t === "THEAD" || t === "TBODY" || t === "TFOOT") {
        collectTableRows(c, rows, guard + 1);
      }
    }
  }

  function renderTable(el, ctx) {
    var rows = [];
    collectTableRows(el, rows, 0);
    if (rows.length === 0) { return ""; }

    var ctx2 = nextCtx(ctx);
    var grid = [];
    var cols = 0;
    for (var i = 0; i < rows.length; i++) {
      var cells = [];
      var kids = rows[i].childNodes || [];
      for (var j = 0; j < kids.length; j++) {
        var c = kids[j];
        if (!isEl(c)) { continue; }
        var t = tagOf(c);
        if (t !== "TH" && t !== "TD") { continue; }
        var text = inlineChildren(c, ctx2)
          .replace(/\s+/g, " ")
          .trim()
          .replace(/\|/g, "\\|");
        cells.push(text);
      }
      if (cells.length > cols) { cols = cells.length; }
      grid.push(cells);
    }
    if (cols === 0) { return ""; }

    for (var r = 0; r < grid.length; r++) {
      while (grid[r].length < cols) { grid[r].push(""); }
    }

    function line(cells) { return "| " + cells.join(" | ") + " |"; }

    var sepCells = [];
    for (var s = 0; s < cols; s++) { sepCells.push("---"); }

    var out = [line(grid[0]), line(sepCells)];
    for (var b = 1; b < grid.length; b++) { out.push(line(grid[b])); }
    return out.join("\n") + "\n\n";
  }

  function renderBlock(el, ctx) {
    if (ctx.depth > MAX_DEPTH) { return ""; }
    var tag = tagOf(el);
    if (SKIP_TAGS[tag]) { return ""; }
    var ctx2 = nextCtx(ctx);
    var t;

    var h = /^H([1-6])$/.exec(tag);
    if (h) {
      t = inlineChildren(el, ctx2).trim();
      return t ? "#".repeat(Number(h[1])) + " " + t + "\n\n" : "";
    }

    switch (tag) {
      case "P":
        t = inlineChildren(el, ctx2).trim();
        return t ? t + "\n\n" : "";
      case "HR":
        return "---\n\n";
      case "PRE":
        return renderPre(el, ctx2);
      case "BLOCKQUOTE": {
        var inner = renderBlocks(el, ctx2).trim();
        if (!inner) { return ""; }
        var quoted = inner.split("\n").map(function (l) {
          return l ? "> " + l : ">";
        }).join("\n");
        return quoted + "\n\n";
      }
      case "UL":
      case "OL": {
        var body = renderList(el, ctx2, 0);
        return body ? body + "\n\n" : "";
      }
      case "TABLE":
        return renderTable(el, ctx2);
      case "FIGCAPTION":
        t = inlineChildren(el, ctx2).trim();
        return t ? "*" + t + "*\n\n" : "";
      default:
        return renderBlocks(el, ctx2);
    }
  }

  function renderBlocks(container, ctx) {
    if (ctx.depth > MAX_DEPTH) { return ""; }
    var out = "";
    var buf = "";

    function flush() {
      var t = buf.replace(/[ \t]+/g, " ").trim();
      buf = "";
      if (t) { out += t + "\n\n"; }
    }

    var kids = container.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i];
      if (isEl(child) && isBlockTag(tagOf(child))) {
        flush();
        out += renderBlock(child, ctx);
      } else {
        buf += renderInline(child, nextCtx(ctx));
      }
    }
    flush();
    return out;
  }

  function mgConvert(rootNode, opts) {
    if (!rootNode) { return ""; }
    var o = opts || {};
    var base = o.baseUrl ||
      ((typeof location !== "undefined" && location && location.href) ? location.href : "");
    var md = renderBlocks(rootNode, { base: base, depth: 0 });
    return md.replace(/\n{3,}/g, "\n\n").trim();
  }

  window.__markgrabConvert = mgConvert;

  /* ------------------------------------------------------------------ */
  /* Extractor (readability-lite) - browser only                         */
  /* ------------------------------------------------------------------ */

  function scoreEl(el) {
    var total = (el.textContent || "").length;
    var linkLen = 0;
    var links;
    try { links = el.querySelectorAll("a"); } catch (e) { links = []; }
    for (var i = 0; i < links.length && i < 5000; i++) {
      linkLen += (links[i].textContent || "").length;
    }
    return total - linkLen * 0.6;
  }

  function densestBlock() {
    var node = document.body;
    if (!node) { return null; }
    var guard = 0;
    while (guard < 25) {
      guard += 1;
      var best = null;
      var bestScore = 0;
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        var t = tagOf(k);
        if (t === "DIV" || t === "SECTION" || t === "MAIN" || t === "ARTICLE" || t === "TD") {
          var s = scoreEl(k);
          if (s > bestScore) { bestScore = s; best = k; }
        }
      }
      if (best && bestScore >= scoreEl(node) * 0.8) {
        node = best;
      } else {
        break;
      }
    }
    return node;
  }

  function pickRoot() {
    var el = null;
    try { el = document.querySelector("article, main, [role=\"main\"]"); } catch (e) { el = null; }
    return el || densestBlock();
  }

  function stripJunk(root, selector) {
    var junk;
    try { junk = root.querySelectorAll(selector); } catch (e) { return root; }
    for (var i = 0; i < junk.length; i++) {
      var n = junk[i];
      if (n && n.parentNode) { n.parentNode.removeChild(n); }
    }
    return root;
  }

  function cleanedClone(el) {
    return stripJunk(el.cloneNode(true), STRIP_SELECTOR);
  }

  function selectionRoot() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { return null; }
    var wrap = document.createElement("div");
    for (var i = 0; i < sel.rangeCount && i < 20; i++) {
      wrap.appendChild(sel.getRangeAt(i).cloneContents());
    }
    return stripJunk(wrap, SELECTION_STRIP_SELECTOR);
  }

  /* ------------------------------------------------------------------ */
  /* Toast                                                               */
  /* ------------------------------------------------------------------ */

  function showToast(text) {
    try {
      var old = document.getElementById(TOAST_ID);
      if (old && old.parentNode) { old.parentNode.removeChild(old); }
      var el = document.createElement("div");
      el.id = TOAST_ID;
      el.textContent = text;
      el.style.cssText = [
        "position:fixed", "left:50%", "bottom:28px", "transform:translateX(-50%)",
        "max-width:min(92vw,520px)", "padding:10px 18px", "border-radius:999px",
        "background:#111827", "color:#f9fafb",
        "font:500 13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif",
        "box-shadow:0 8px 24px rgba(0,0,0,0.35)", "z-index:2147483647",
        "opacity:0", "transition:opacity 180ms ease", "pointer-events:none",
        "text-align:center", "white-space:normal"
      ].join(";");
      (document.body || document.documentElement).appendChild(el);
      window.setTimeout(function () { el.style.opacity = "1"; }, 20);
      window.setTimeout(function () { el.style.opacity = "0"; }, 2400);
      window.setTimeout(function () {
        if (el.parentNode) { el.parentNode.removeChild(el); }
      }, 2800);
    } catch (e) {
      /* toast is best-effort */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Clipboard                                                           */
  /* ------------------------------------------------------------------ */

  function copyViaExec(text) {
    var ok = false;
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      (document.body || document.documentElement).appendChild(ta);
      ta.focus();
      ta.select();
      ok = document.execCommand("copy");
      if (ta.parentNode) { ta.parentNode.removeChild(ta); }
    } catch (e) {
      ok = false;
    }
    return ok;
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { resolve(true); },
          function () { resolve(copyViaExec(text)); }
        );
      } else {
        resolve(copyViaExec(text));
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Messaging + counters                                                */
  /* ------------------------------------------------------------------ */

  function sendMessage(payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(payload, function (res) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(res || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function wordCount(md) {
    var parts = md.split(/\s+/);
    var n = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i]) { n += 1; }
    }
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* Download helper (popup triggers via executeScript func)             */
  /* ------------------------------------------------------------------ */

  window.__markgrabDownload = function (md, title) {
    try {
      var slug = String(title || "page")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "page";
      var blob = new Blob([String(md || "")], { type: "text/markdown" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = slug + ".md";
      a.style.display = "none";
      (document.body || document.documentElement).appendChild(a);
      a.click();
      if (a.parentNode) { a.parentNode.removeChild(a); }
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      showToast(msg("toastClipboard"));
    }
  };

  /* ------------------------------------------------------------------ */
  /* Entry point                                                         */
  /* ------------------------------------------------------------------ */

  window.__markgrab = async function (mode) {
    var m = (mode === "selection" || mode === "ai") ? mode : "page";
    try {
      if (m !== "selection") {
        var gate = await sendMessage({ type: "MG_CHECK_CAP" });
        if (gate && gate.allowed === false) {
          showToast(msg("toastCapReached"));
          return;
        }
      }

      var md = "";
      if (m === "selection") {
        var selRoot = selectionRoot();
        if (!selRoot) {
          showToast(msg("toastNoSelection"));
          return;
        }
        md = mgConvert(selRoot, { baseUrl: location.href });
        if (!md) {
          showToast(msg("toastEmpty"));
          return;
        }
      } else {
        var picked = pickRoot();
        if (!picked) {
          showToast(msg("toastEmpty"));
          return;
        }
        md = mgConvert(cleanedClone(picked), { baseUrl: location.href });
        if (wordCount(md) < MIN_WORDS && document.body && picked !== document.body) {
          md = mgConvert(cleanedClone(document.body), { baseUrl: location.href });
        }
        if (wordCount(md) < MIN_WORDS) {
          showToast(msg("toastEmpty"));
          return;
        }
      }

      var words = wordCount(md);
      if (m === "ai") {
        md = "# " + (document.title || "Untitled") + "\n\n" +
          "Source: " + location.href + "\n" +
          "Captured: " + new Date().toISOString().slice(0, 10) + "\n\n" +
          "---\n\n" + md;
      }

      var ok = await copyText(md);
      if (!ok) {
        showToast(msg("toastClipboard"));
        return;
      }
      showToast(msg("toastCopied", [String(words)]));

      if (m !== "selection") {
        sendMessage({ type: "MG_COUNT" });
      }
    } catch (e) {
      console.error("MarkGrab:", e);
      showToast(msg("toastClipboard"));
    }
  };
})();
