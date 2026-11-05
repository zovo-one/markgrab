/*
 * MarkGrab - service worker (MV3, ES module context).
 * Owns: context menus, onboarding on install, daily capture counter,
 * cap gating, license verification (the ONLY network call in the product).
 */

const CAP = 15;
const VERIFY_URL = "https://zgubxqomnbmxgbdhvwja.supabase.co/functions/v1/verify-extension-license";
const VERIFY_ANON_KEY = "sb_publishable_RG4IVO9Qm23_xPzdQjdFPQ_QHBwbOLv";
const VERIFY_TIMEOUT_MS = 10000;
const PRO_TIERS = ["pro", "lifetime"];

const MENU_MODES = {
  "markgrab-page": "page",
  "markgrab-selection": "selection",
  "markgrab-ai": "ai"
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function localDateString() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}

async function isPro() {
  const { mgLicense } = await chrome.storage.local.get("mgLicense");
  return !!(mgLicense && PRO_TIERS.includes(mgLicense.tier));
}

async function readCount() {
  const today = localDateString();
  const { mgCapDate, mgCapCount } = await chrome.storage.local.get(["mgCapDate", "mgCapCount"]);
  if (mgCapDate !== today) { return 0; }
  const n = Number(mgCapCount);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function bumpCount() {
  const count = (await readCount()) + 1;
  await chrome.storage.local.set({ mgCapDate: localDateString(), mgCapCount: count });
  return count;
}

async function getSettings() {
  const { mgSettings } = await chrome.storage.local.get("mgSettings");
  return (mgSettings && typeof mgSettings === "object") ? mgSettings : {};
}

/* ------------------------------------------------------------------ */
/* License verification (single allowed network call)                  */
/* ------------------------------------------------------------------ */

async function verifyLicense(key) {
  if (typeof key !== "string" || key.trim().length === 0) {
    return { ok: false, reason: "invalid" };
  }
  const trimmed = key.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": VERIFY_ANON_KEY,
        "Authorization": "Bearer " + VERIFY_ANON_KEY
      },
      body: JSON.stringify({ license_key: trimmed, extension: "markgrab_pro" }),
      signal: controller.signal
    });
    if (!res.ok) { return { ok: false, reason: "invalid" }; }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (data && data.ok === true && typeof data.tier === "string") {
      await chrome.storage.local.set({
        mgLicense: { key: trimmed, tier: data.tier, verifiedAt: Date.now() }
      });
      return { ok: true, tier: data.tier };
    }
    return { ok: false, reason: "invalid" };
  } catch (e) {
    if (e && e.name === "AbortError") { return { ok: false, reason: "timeout" }; }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Install: context menus (idempotent) + onboarding                    */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "markgrab-page",
      title: chrome.i18n.getMessage("menuPage"),
      contexts: ["page"]
    });
    chrome.contextMenus.create({
      id: "markgrab-selection",
      title: chrome.i18n.getMessage("menuSelection"),
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "markgrab-ai",
      title: chrome.i18n.getMessage("menuAi"),
      contexts: ["page"]
    });
  });

  if (details && details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") })
      .catch(() => { /* tab creation can fail during shutdown; non-fatal */ });
  }
});

/* ------------------------------------------------------------------ */
/* Context menu clicks -> inject + run                                 */
/* ------------------------------------------------------------------ */

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const mode = MENU_MODES[info.menuItemId];
  if (!mode || !tab || typeof tab.id !== "number") { return; }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/grab.js"]
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (m) => { if (window.__markgrab) { window.__markgrab(m); } },
      args: [mode]
    });
  } catch (e) {
    /* Restricted page (chrome://, Chrome Web Store, PDF viewer):
       fail silently here; the popup surfaces a friendly notice. */
  }
});

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message && message.type;

  if (type === "MG_COUNT") {
    (async () => {
      const count = await bumpCount();
      sendResponse({ count, cap: CAP, pro: await isPro() });
    })().catch(() => sendResponse({ count: 0, cap: CAP, pro: false }));
    return true;
  }

  if (type === "MG_CHECK_CAP") {
    (async () => {
      const [pro, count] = await Promise.all([isPro(), readCount()]);
      sendResponse({ allowed: pro || count < CAP, count, cap: CAP });
    })().catch(() => sendResponse({ allowed: true, count: 0, cap: CAP }));
    return true;
  }

  if (type === "MG_GET_STATE") {
    (async () => {
      const [pro, count, settings] = await Promise.all([isPro(), readCount(), getSettings()]);
      sendResponse({ count, cap: CAP, pro, settings });
    })().catch(() => sendResponse({ count: 0, cap: CAP, pro: false, settings: {} }));
    return true;
  }

  if (type === "MG_VERIFY_LICENSE") {
    verifyLicense(message.key)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: "network" }));
    return true;
  }

  return false;
});
