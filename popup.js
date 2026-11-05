/* MarkGrab popup controller.
 * Talks to sw.js via MG_* messages, injects content/grab.js on demand.
 * No inline scripts (MV3 CSP). */
(function () {
  'use strict';

  var CLOSE_DELAY_MS = 350;
  var DOWNLOAD_SETTLE_MS = 250;
  var RESTRICTED_PREFIXES = ['chrome://', 'edge://', 'about:', 'https://chromewebstore.google.com'];

  var els = {
    btnPage: document.getElementById('btnPage'),
    btnAi: document.getElementById('btnAi'),
    btnDownload: document.getElementById('btnDownload'),
    btnSettings: document.getElementById('btnSettings'),
    proBadge: document.getElementById('proBadge'),
    meter: document.getElementById('meter'),
    meterText: document.getElementById('meterText'),
    meterFill: document.getElementById('meterFill'),
    capBanner: document.getElementById('capBanner'),
    restricted: document.getElementById('restricted'),
    status: document.getElementById('status')
  };

  var state = { count: 0, cap: 15, pro: false, settings: {} };
  var activeTab = null;
  var busy = false;

  function msg(key, subs) {
    try { return chrome.i18n.getMessage(key, subs) || key; } catch (e) { return key; }
  }

  function send(payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(payload, function (res) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(res || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function isRestricted(url) {
    /* Unknown URL (no activeTab grant yet): allow the attempt - injection
       into a genuinely restricted page fails into the catch path with a
       friendly error, which beats silently disabling the whole popup. */
    if (!url) { return false; }
    for (var i = 0; i < RESTRICTED_PREFIXES.length; i++) {
      if (url.indexOf(RESTRICTED_PREFIXES[i]) === 0) { return true; }
    }
    return false;
  }

  function setActionsEnabled(enabled) {
    els.btnPage.disabled = !enabled;
    els.btnAi.disabled = !enabled;
    els.btnDownload.disabled = !enabled;
  }

  function showStatus(text) {
    els.status.textContent = text;
    els.status.hidden = false;
  }

  function renderMeter() {
    if (state.pro) {
      els.meter.hidden = true;
      els.proBadge.hidden = false;
      return;
    }
    els.proBadge.hidden = true;
    els.meter.hidden = false;
    els.meterText.textContent = msg('popupMeter', [String(state.count), String(state.cap)]);
    var pct = state.cap > 0 ? Math.min(100, Math.round((state.count / state.cap) * 100)) : 0;
    els.meterFill.style.width = pct + '%';
  }

  function renderCapped() {
    renderMeter();
    els.capBanner.hidden = false;
    setActionsEnabled(false);
  }

  function render() {
    renderMeter();
    var capped = !state.pro && state.count >= state.cap;
    els.capBanner.hidden = !capped;

    if (activeTab && isRestricted(activeTab.url)) {
      els.restricted.hidden = false;
      setActionsEnabled(false);
      return;
    }
    els.restricted.hidden = true;
    setActionsEnabled(!capped);
  }

  function inject(mode) {
    var tabId = activeTab.id;
    return chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content/grab.js'] })
      .then(function () {
        return chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function (m) { window.__markgrab && window.__markgrab(m); },
          args: [mode]
        });
      });
  }

  /* Runs a grab. Resolves true on success, false when blocked/failed. */
  function grab(mode) {
    if (busy || !activeTab) { return Promise.resolve(false); }
    busy = true;
    els.status.hidden = true;

    var gate = Promise.resolve(true);
    if ((mode === 'page' || mode === 'ai') && !state.pro) {
      gate = send({ type: 'MG_CHECK_CAP' }).then(function (res) {
        if (res && res.allowed === false) {
          state.count = res.count;
          state.cap = res.cap;
          renderCapped();
          return false;
        }
        return true;
      });
    }

    return gate
      .then(function (allowed) {
        if (!allowed) { return false; }
        return inject(mode).then(function () { return true; });
      })
      .catch(function () {
        showStatus(msg('popupError'));
        return false;
      })
      .then(function (ok) {
        busy = false;
        return ok;
      });
  }

  function grabAndClose(mode) {
    grab(mode).then(function (ok) {
      if (ok) { setTimeout(function () { window.close(); }, CLOSE_DELAY_MS); }
    });
  }

  function downloadMd() {
    var title = (activeTab && activeTab.title) || 'page';
    grab('page').then(function (ok) {
      if (!ok) { return; }
      delay(DOWNLOAD_SETTLE_MS)
        .then(function () {
          return chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: function (t) {
              window.__markgrabDownload && window.__markgrabDownload(window.__markgrabLast || '', t);
            },
            args: [title]
          });
        })
        .then(function () {
          setTimeout(function () { window.close(); }, CLOSE_DELAY_MS);
        })
        .catch(function () { showStatus(msg('popupError')); });
    });
  }

  function init() {
    els.btnPage.addEventListener('click', function () { grabAndClose('page'); });
    els.btnAi.addEventListener('click', function () { grabAndClose('ai'); });
    els.btnDownload.addEventListener('click', downloadMd);
    els.btnSettings.addEventListener('click', function () { chrome.runtime.openOptionsPage(); });

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      activeTab = (tabs && tabs[0]) || null;
      send({ type: 'MG_GET_STATE' }).then(function (res) {
        if (res) {
          state.count = typeof res.count === 'number' ? res.count : state.count;
          state.cap = typeof res.cap === 'number' ? res.cap : state.cap;
          state.pro = !!res.pro;
          state.settings = res.settings || {};
        }
        render();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
