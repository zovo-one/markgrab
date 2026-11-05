import "./sw.js";

// Zovo what's new page. It opens only on an extension update (never on install or on a Chrome update).
(() => {
  const zovoOpen = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('zovo-whats-new/index.html') }, () => void chrome.runtime.lastError);
  };
  chrome.runtime.onInstalled.addListener((d) => {
    if (!d || d.reason !== 'update') return;
    const v = chrome.runtime.getManifest().version;
    if (d.previousVersion === v) return;
    if (!chrome.storage || !chrome.storage.local) { zovoOpen(); return; }
    chrome.storage.local.get('zovoWhatsNewShown', (r) => {
      if (chrome.runtime.lastError) return;
      if (r && r.zovoWhatsNewShown === v) return;
      chrome.storage.local.set({ zovoWhatsNewShown: v }, () => void chrome.runtime.lastError);
      zovoOpen();
    });
  });
})();
