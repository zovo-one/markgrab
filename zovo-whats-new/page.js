'use strict';
// Zovo what's new page. Fills the name, version, icon and review link from config.js.
(() => {
  const ID_RE = /^[a-p]{32}$/;
  const ICON_RE = /^[A-Za-z0-9._-]+$/;
  const raw = globalThis.ZOVO_WHATS_NEW;
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const $ = (id) => document.getElementById(id);

  const name = typeof cfg.name === 'string' ? cfg.name.trim() : '';
  if (name) {
    document.querySelectorAll('.js-name').forEach((el) => { el.textContent = name; });
    document.title = `What's new in ${name}`;
  }

  let version = typeof cfg.version === 'string' ? cfg.version : '';
  try {
    const live = chrome.runtime.getManifest().version;
    if (typeof live === 'string' && live) version = live;
  } catch (_) { /* not running as an extension page */ }
  if (version) {
    document.querySelectorAll('.js-version').forEach((el) => { el.textContent = version; });
  } else {
    $('version-label').hidden = true;
  }

  // Hero. If the image is missing or broken, remove the slot so the page still looks complete.
  const hero = $('hero');
  const heroImg = $('hero-img');
  const hideHero = () => { hero.hidden = true; };
  heroImg.addEventListener('error', hideHero, { once: true });
  if (heroImg.complete && heroImg.naturalWidth === 0) hideHero();

  const icon = $('app-icon');
  if (typeof cfg.icon === 'string' && ICON_RE.test(cfg.icon)) {
    icon.addEventListener('error', () => { icon.hidden = true; }, { once: true });
    icon.src = cfg.icon;
    icon.hidden = false;
  }

  const state = $('review-state');
  const NONE_TEXT = "It has no reviews yet, so yours would be one of the very first, and the first ones count the most.";
  const GOOD_TEXT = "Only a few people have shared a review so far, so each new one carries real weight.";
  if (state && cfg.reviews === 'none') state.textContent = NONE_TEXT;
  if (state && cfg.reviews === 'good') state.textContent = GOOD_TEXT;
  const vl = $('value-line');
  if (vl && typeof cfg.valueLine === 'string' && cfg.valueLine.trim()) { vl.textContent = cfg.valueLine.trim(); vl.hidden = false; }

  const review = $('review-link');
  if (typeof cfg.id === 'string' && ID_RE.test(cfg.id)) {
    review.href = `https://chromewebstore.google.com/detail/${cfg.id}/reviews`;
  } else {
    review.closest('.card').hidden = true;
  }


  // Share row. Links point to this extension's store page.
  const storeUrl = (typeof cfg.id === 'string' && ID_RE.test(cfg.id)) ? `https://chromewebstore.google.com/detail/${cfg.id}` : 'https://zovo.one/';
  const shareText = `${name || 'This extension'}, a free Chrome extension made by one developer in Poland. I use it and thought you might like it.`;
  const enc = encodeURIComponent;
  const nets = {
    whatsapp: `https://wa.me/?text=${enc(shareText + ' ' + storeUrl)}`,
    telegram: `https://t.me/share/url?url=${enc(storeUrl)}&text=${enc(shareText)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(storeUrl)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(storeUrl)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(storeUrl)}`,
    reddit: `https://www.reddit.com/submit?url=${enc(storeUrl)}&title=${enc(shareText)}`,
    email: `mailto:?subject=${enc((name || 'A Chrome extension') + ' for you')}&body=${enc(shareText + '\n\n' + storeUrl)}`
  };
  document.querySelectorAll('#share-row [data-net]').forEach((a) => { const u = nets[a.dataset.net]; if (u) a.href = u; });
  const copyBtn = $('copy-link');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(storeUrl); } catch (_) {
      const t = document.createElement('textarea'); t.value = storeUrl; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (_) { /* ignore */ } t.remove();
    }
    const note = $('share-copied'); if (note) { note.hidden = false; setTimeout(() => { note.hidden = true; }, 2500); }
  });

  // Campaign tags on the owner's own sites, so analytics can count visits from this page.
  const src = (typeof cfg.id === 'string' && ID_RE.test(cfg.id)) ? cfg.id : 'unknown';
  document.querySelectorAll('a[href]').forEach((a) => {
    try {
      const u = new URL(a.href);
      const own = /(^|\.)(zovo\.one|notemods\.com|belikenative\.com|barframe\.com|aiwebsitepipeline\.com|toolsthatrank\.com|handsofflinks\.com|recipetool\.net)$/.test(u.hostname);
      if (own && !u.searchParams.has('utm_source')) {
        u.searchParams.set('utm_source', 'whatsnew'); u.searchParams.set('utm_medium', 'extension'); u.searchParams.set('utm_campaign', src);
        a.href = u.toString();
      }
    } catch (_) { /* ignore */ }
  });

  const showClosedNote = () => {
    $('page').hidden = true;
    $('closed-note').hidden = false;
  };

  const closeTab = () => {
    try { window.close(); } catch (_) { /* ignore */ }
    // If the tab is still open, try the tabs API (no permission needed), then hide the page.
    setTimeout(() => {
      const tabs = globalThis.chrome && chrome.tabs;
      if (!tabs || typeof tabs.getCurrent !== 'function') { showClosedNote(); return; }
      try {
        tabs.getCurrent((tab) => {
          if (chrome.runtime.lastError || !tab) { showClosedNote(); return; }
          tabs.remove(tab.id, () => { if (chrome.runtime.lastError) showClosedNote(); });
        });
      } catch (_) {
        showClosedNote();
      }
    }, 150);
  };

  $('close-button').addEventListener('click', closeTab);
})();
