import { planCleanup } from "./matcher.js";

export const UNDO_TTL_MS = 60_000;

export async function snapshotMatchingTabs(api, targets) {
  const groups = [];
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
  }
  return { ts: Date.now(), groups };
}

export async function performCleanupCore(api, filter, source) {
  const all = await api.tabGroups.query({});
  const targets = planCleanup(all, filter);
  const snapshot = await snapshotMatchingTabs(api, targets);

  let removedTabs = 0;
  for (const g of targets) {
    const tabs = await api.tabs.query({ groupId: g.id });
    if (tabs.length > 0) {
      await api.tabs.remove(tabs.map((t) => t.id));
      removedTabs += tabs.length;
    }
  }

  if (snapshot.groups.length > 0) {
    snapshot.source = source;
    await api.storage.local.set({ lastSnapshot: snapshot });
  }
  return { groups: targets.length, tabs: removedTabs, snapshot };
}

function isRestorableUrl(url) {
  if (!url) return false;
  if (url.startsWith("chrome://")) return false;
  if (url.startsWith("chrome-extension://")) return false;
  if (url.startsWith("about:")) return false;
  if (url.startsWith("edge://")) return false;
  if (url.startsWith("brave://")) return false;
  return true;
}

export async function restoreFromSnapshot(api, ttlMs = UNDO_TTL_MS, now = Date.now()) {
  const { lastSnapshot } = await api.storage.local.get("lastSnapshot");
  if (!lastSnapshot) return { restored: 0, reason: "no-snapshot" };
  if (now - lastSnapshot.ts > ttlMs) {
    return { restored: 0, reason: "expired" };
  }
  let restored = 0;
  for (const g of lastSnapshot.groups) {
    const tabIds = [];
    for (const tabInfo of g.tabs) {
      if (!isRestorableUrl(tabInfo.url)) continue;
      const tab = await api.tabs.create({
        url: tabInfo.url,
        active: false,
        pinned: tabInfo.pinned,
      });
      tabIds.push(tab.id);
      restored++;
    }
    if (tabIds.length > 0) {
      const groupId = await api.tabs.group({ tabIds });
      await api.tabGroups.update(groupId, {
        title: g.title,
        color: g.color,
      });
    }
  }
  await api.storage.local.remove("lastSnapshot");
  return { restored, reason: "ok" };
}
