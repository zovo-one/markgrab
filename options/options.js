/* MarkGrab options controller.
 * Settings persist to storage.local under "mgSettings"; the service worker
 * reads them. License activation goes through MG_VERIFY_LICENSE. */
(function () {
  'use strict';

  var SAVE_DEBOUNCE_MS = 300;
  var SAVED_FLASH_MS = 1600;
  var DEFAULT_SETTINGS = { aiTemplate: '', imageMode: 'skip', frontMatter: false };

  var els = {
    proBadge: document.getElementById('proBadge'),
    aiTemplate: document.getElementById('aiTemplate'),
    imageMode: document.getElementById('imageMode'),
    frontMatter: document.getElementById('frontMatter'),
    savedNote: document.getElementById('savedNote'),
    licenseForm: document.getElementById('licenseForm'),
    licenseKey: document.getElementById('licenseKey'),
    btnActivate: document.getElementById('btnActivate'),
    licenseStatus: document.getElementById('licenseStatus'),
    proActive: document.getElementById('proActive'),
    upgradeCard: document.getElementById('upgradeCard'),
    version: document.getElementById('version')
  };

  var pro = false;
  var settings = { aiTemplate: '', imageMode: 'skip', frontMatter: false };
  var saveTimer = null;
  var savedTimer = null;

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

  function renderGates() {
    var fields = document.querySelectorAll('[data-progate]');
    for (var i = 0; i < fields.length; i++) {
      fields[i].classList.toggle('is-locked', !pro);
    }
    els.aiTemplate.disabled = !pro;
    els.imageMode.disabled = !pro;
    els.frontMatter.disabled = !pro;

    els.proBadge.hidden = !pro;
    els.upgradeCard.hidden = pro;
    els.licenseForm.hidden = pro;
    els.proActive.hidden = !pro;
  }

  function renderSettings() {
    els.aiTemplate.value = settings.aiTemplate || '';
    els.imageMode.value = settings.imageMode || 'skip';
    els.frontMatter.checked = !!settings.frontMatter;
    els.frontMatter.setAttribute('aria-checked', settings.frontMatter ? 'true' : 'false');
  }

  function flashSaved() {
    els.savedNote.hidden = false;
    if (savedTimer) { clearTimeout(savedTimer); }
    savedTimer = setTimeout(function () { els.savedNote.hidden = true; }, SAVED_FLASH_MS);
  }

  function persist() {
    chrome.storage.local.set({ mgSettings: settings }, function () {
      if (!chrome.runtime.lastError) { flashSaved(); }
    });
  }

  function queueSave() {
    if (saveTimer) { clearTimeout(saveTimer); }
    saveTimer = setTimeout(persist, SAVE_DEBOUNCE_MS);
  }

  function onSettingChanged() {
    settings.aiTemplate = els.aiTemplate.value;
    settings.imageMode = els.imageMode.value;
    settings.frontMatter = els.frontMatter.checked;
    els.frontMatter.setAttribute('aria-checked', settings.frontMatter ? 'true' : 'false');
    queueSave();
  }

  function setLicenseStatus(text, ok) {
    els.licenseStatus.textContent = text;
    els.licenseStatus.classList.toggle('is-ok', !!ok);
    els.licenseStatus.classList.toggle('is-err', !ok);
    els.licenseStatus.hidden = false;
  }

  function activate() {
    var key = (els.licenseKey.value || '').trim();
    if (!key) {
      setLicenseStatus(msg('optLicenseErr'), false);
      return;
    }
    els.btnActivate.disabled = true;
    els.btnActivate.textContent = msg('optActivating');

    send({ type: 'MG_VERIFY_LICENSE', key: key }).then(function (res) {
      els.btnActivate.disabled = false;
      els.btnActivate.textContent = msg('optActivate');

      if (res && res.ok) {
        pro = true;
        setLicenseStatus(msg('optLicenseOk'), true);
        renderGates();
        return;
      }
      var text = msg('optLicenseErr');
      if (res && res.reason) { text += ' (' + res.reason + ')'; }
      setLicenseStatus(text, false);
    });
  }

  function loadState() {
    try {
      els.version.textContent = chrome.runtime.getManifest().version;
    } catch (e) { /* keep static fallback */ }

    chrome.storage.local.get({ mgSettings: DEFAULT_SETTINGS }, function (data) {
      var stored = (data && data.mgSettings) || DEFAULT_SETTINGS;
      settings.aiTemplate = stored.aiTemplate || '';
      settings.imageMode = stored.imageMode || 'skip';
      settings.frontMatter = !!stored.frontMatter;
      renderSettings();
    });

    send({ type: 'MG_GET_STATE' }).then(function (res) {
      pro = !!(res && res.pro);
      renderGates();
    });
  }

  function init() {
    els.aiTemplate.addEventListener('input', onSettingChanged);
    els.imageMode.addEventListener('change', onSettingChanged);
    els.frontMatter.addEventListener('change', onSettingChanged);
    els.btnActivate.addEventListener('click', activate);
    els.licenseKey.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { activate(); }
    });

    renderGates();
    loadState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
