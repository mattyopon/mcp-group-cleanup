import { DEFAULT_FILTER } from "./matcher.js";
import {
  performCleanupCore,
  restoreFromSnapshot,
  purgeExpiredSnapshot,
} from "./cleanup-logic.js";
import { SWEEP_PERIOD_MIN, UNDO_TTL_MS, LOG_PREFIX } from "./constants.js";

const SWEEP_ALARM = "sweep";
const PURGE_ALARM = "purge-snapshot";

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
    console.error(LOG_PREFIX, "autoCleanup failed:", e);
  }
}

async function ensureAlarms() {
  const sweep = await chrome.alarms.get(SWEEP_ALARM);
  if (!sweep) {
    chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: SWEEP_PERIOD_MIN });
  }
  const purge = await chrome.alarms.get(PURGE_ALARM);
  if (!purge) {
    chrome.alarms.create(PURGE_ALARM, { periodInMinutes: 1 });
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
      } else if (msg?.type === "singleGroupCleanup") {
        if (typeof msg.groupId !== "number") {
          sendResponse({ ok: false, error: "groupId required" });
          return;
        }
        const all = await chrome.tabGroups.query({});
        const target = all.find((g) => g.id === msg.groupId);
        if (!target) {
          sendResponse({ ok: false, error: "group not found" });
          return;
        }
        const tabs = await chrome.tabs.query({ groupId: msg.groupId });
        const snapshot = {
          ts: Date.now(),
          source: "single",
          groups: [
            {
              title: target.title || "",
              color: target.color || "grey",
              windowId: target.windowId,
              tabs: tabs.map((t) => ({
                url: t.url || t.pendingUrl || "",
                title: t.title || "",
                pinned: !!t.pinned,
              })),
            },
          ],
        };
        if (tabs.length > 0) {
          await chrome.storage.local.set({ lastSnapshot: snapshot });
          await chrome.tabs.remove(tabs.map((t) => t.id));
        }
        sendResponse({ ok: true, groups: 1, tabs: tabs.length });
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

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
  await autoCleanup();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    await chrome.storage.local.set({
      filter: DEFAULT_FILTER,
      autoEnabled: true,
    });
  }
  await ensureAlarms();
  await autoCleanup();
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === SWEEP_ALARM) {
    await autoCleanup();
  } else if (a.name === PURGE_ALARM) {
    try {
      await purgeExpiredSnapshot(chrome, UNDO_TTL_MS);
    } catch (e) {
      console.error(LOG_PREFIX, "purgeExpiredSnapshot failed:", e);
    }
  }
});

ensureAlarms().catch((e) => console.error(LOG_PREFIX, "ensureAlarms failed:", e));
