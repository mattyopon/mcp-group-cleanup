import { DEFAULT_FILTER } from "./matcher.js";
import {
  performCleanupCore,
  restoreFromSnapshot,
  UNDO_TTL_MS,
} from "./cleanup-logic.js";

const SWEEP_PERIOD_MIN = 30;

async function getState() {
  const r = await chrome.storage.local.get(["filter", "autoEnabled"]);
  return {
    filter: r.filter,
    autoEnabled: r.autoEnabled !== false,
  };
}

async function autoCleanup() {
  try {
    const { filter, autoEnabled } = await getState();
    if (!autoEnabled) return;
    if (!filter) return;
    await performCleanupCore(chrome, filter, "auto");
  } catch (e) {
    console.error("[claude-mcp-cleanup] autoCleanup failed:", e);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "manualCleanup") {
        const { filter } = await getState();
        const f = msg.filter ?? filter;
        if (!f) {
          sendResponse({ ok: false, error: "filter is empty" });
          return;
        }
        const result = await performCleanupCore(chrome, f, "manual");
        sendResponse({ ok: true, ...result });
      } else if (msg?.type === "undo") {
        const result = await restoreFromSnapshot(chrome, UNDO_TTL_MS);
        sendResponse({ ok: true, ...result });
      } else if (msg?.type === "ping") {
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true;
});

chrome.runtime.onStartup.addListener(autoCleanup);
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    await chrome.storage.local.set({
      filter: DEFAULT_FILTER,
      autoEnabled: true,
    });
  }
  autoCleanup();
});

chrome.alarms.create("sweep", { periodInMinutes: SWEEP_PERIOD_MIN });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "sweep") autoCleanup();
});
