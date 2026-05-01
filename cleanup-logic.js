import { planCleanup } from "./matcher.js";
import { UNDO_TTL_MS, LOG_PREFIX } from "./constants.js";

export { UNDO_TTL_MS } from "./constants.js";

const ALLOWED_SCHEMES = ["http://", "https://", "ftp://", "ftps://"];

export function isRestorableUrl(url) {
  if (typeof url !== "string" || url.length === 0) return false;
  return ALLOWED_SCHEMES.some((s) => url.startsWith(s));
}

export async function snapshotMatchingTabs(api, targets) {
  const groups = [];
  const tabIdsByGroup = new Map();
  for (const g of targets) {
    const tabs = await api.tabs.query({ groupId: g.id });
    if (tabs.length === 0) continue;
    groups.push({
      title: g.title || "",
      color: g.color || "grey",
      windowId: g.windowId,
      tabs: tabs.map((t) => ({
        url: t.url || t.pendingUrl || "",
        title: t.title || "",
        pinned: !!t.pinned,
      })),
    });
    tabIdsByGroup.set(g.id, tabs.map((t) => t.id));
  }
  return { snapshot: { ts: Date.now(), groups }, tabIdsByGroup };
}

export async function performCleanupCore(api, filter, source, opts = {}) {
  const ungroupFirst = opts.ungroupFirst !== false;
  const all = await api.tabGroups.query({});
  const targets = planCleanup(all, filter);
  const { snapshot, tabIdsByGroup } = await snapshotMatchingTabs(api, targets);

  let removedTabs = 0;
  let ungroupedGroups = 0;
  for (const g of targets) {
    const ids = tabIdsByGroup.get(g.id);
    if (!ids || ids.length === 0) continue;
    if (ungroupFirst && api.tabs.ungroup) {
      try {
        await api.tabs.ungroup(ids);
        ungroupedGroups++;
      } catch (e) {
        console.error(LOG_PREFIX, "tabs.ungroup failed for group", g.id, e);
      }
    }
    try {
      await api.tabs.remove(ids);
      removedTabs += ids.length;
    } catch (e) {
      console.error(LOG_PREFIX, "tabs.remove failed for group", g.id, e);
    }
  }

  if (snapshot.groups.length > 0) {
    snapshot.source = source;
    snapshot.ungrouped = ungroupFirst;
    await api.storage.local.set({ lastSnapshot: snapshot });
  }
  return {
    groups: targets.length,
    tabs: removedTabs,
    ungroupedGroups,
    snapshot,
  };
}

export async function purgeExpiredSnapshot(api, ttlMs = UNDO_TTL_MS, now = Date.now()) {
  const { lastSnapshot } = await api.storage.local.get("lastSnapshot");
  if (!lastSnapshot) return { purged: false, reason: "no-snapshot" };
  if (now - lastSnapshot.ts <= ttlMs) {
    return { purged: false, reason: "fresh" };
  }
  await api.storage.local.remove("lastSnapshot");
  return { purged: true, reason: "expired" };
}

async function tryCreateTab(api, tabInfo, windowId) {
  try {
    return await api.tabs.create({
      url: tabInfo.url,
      active: false,
      pinned: tabInfo.pinned,
      windowId,
    });
  } catch (e) {
    try {
      return await api.tabs.create({
        url: tabInfo.url,
        active: false,
        pinned: tabInfo.pinned,
      });
    } catch (e2) {
      console.error(LOG_PREFIX, "tabs.create fallback failed", tabInfo.url, e2);
      return null;
    }
  }
}

export async function restoreFromSnapshot(api, ttlMs = UNDO_TTL_MS, now = Date.now()) {
  const { lastSnapshot } = await api.storage.local.get("lastSnapshot");
  if (!lastSnapshot) return { restored: 0, skipped: 0, reason: "no-snapshot" };
  if (now - lastSnapshot.ts > ttlMs) {
    await api.storage.local.remove("lastSnapshot");
    return { restored: 0, skipped: 0, reason: "expired" };
  }

  let restored = 0;
  let skipped = 0;
  let hadError = false;

  for (const g of lastSnapshot.groups) {
    const tabIds = [];
    for (const tabInfo of g.tabs) {
      if (!isRestorableUrl(tabInfo.url)) {
        skipped++;
        continue;
      }
      const tab = await tryCreateTab(api, tabInfo, g.windowId);
      if (tab && typeof tab.id === "number") {
        tabIds.push(tab.id);
        restored++;
      } else {
        hadError = true;
      }
    }
    if (tabIds.length > 0) {
      try {
        const groupId = await api.tabs.group({
          tabIds,
          createProperties: g.windowId != null ? { windowId: g.windowId } : undefined,
        });
        try {
          await api.tabGroups.update(groupId, {
            title: g.title,
            color: g.color,
          });
        } catch (e) {
          console.error(LOG_PREFIX, "tabGroups.update failed", e);
          hadError = true;
        }
      } catch (e) {
        console.error(LOG_PREFIX, "tabs.group failed", e);
        hadError = true;
      }
    }
  }

  if (!hadError) {
    await api.storage.local.remove("lastSnapshot");
    return { restored, skipped, reason: "ok" };
  }
  return { restored, skipped, reason: "partial" };
}
