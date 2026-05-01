import { strict as assert } from "node:assert";
import { matchesFilter, planCleanup } from "../matcher.js";
import {
  performCleanupCore,
  restoreFromSnapshot,
  snapshotMatchingTabs,
  purgeExpiredSnapshot,
  isRestorableUrl,
  UNDO_TTL_MS,
} from "../cleanup-logic.js";

function makeChromeMock(initialGroups, initialTabs, storageData = {}, opts = {}) {
  let nextTabId = 1000;
  let nextGroupId = 9000;
  const removed = [];
  const created = [];
  const grouped = [];
  const groupUpdates = [];
  const ungrouped = [];
  const failCreateUrls = new Set(opts.failCreateUrls || []);
  const failGroupCalls = opts.failGroupCalls || 0;
  const failGroupUpdates = opts.failGroupUpdates || 0;
  const failUngroupCalls = opts.failUngroupCalls || 0;
  let groupCallsSoFar = 0;
  let groupUpdateCallsSoFar = 0;
  let ungroupCallsSoFar = 0;
  return {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") {
            return keys in storageData ? { [keys]: storageData[keys] } : {};
          }
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) if (k in storageData) out[k] = storageData[k];
            return out;
          }
          return { ...storageData };
        },
        async set(o) {
          Object.assign(storageData, o);
        },
        async remove(key) {
          const arr = Array.isArray(key) ? key : [key];
          for (const k of arr) delete storageData[k];
        },
      },
    },
    tabGroups: {
      async query(_filter) {
        return [...initialGroups];
      },
      async update(groupId, props) {
        groupUpdateCallsSoFar++;
        if (groupUpdateCallsSoFar <= failGroupUpdates) {
          throw new Error("simulated tabGroups.update failure");
        }
        groupUpdates.push({ groupId, props });
        const g = initialGroups.find((x) => x.id === groupId);
        if (g) Object.assign(g, props);
        return g;
      },
    },
    tabs: {
      async query({ groupId }) {
        return initialTabs.filter((t) => t.groupId === groupId);
      },
      async remove(ids) {
        const arr = Array.isArray(ids) ? ids : [ids];
        for (const id of arr) {
          const i = initialTabs.findIndex((t) => t.id === id);
          if (i >= 0) {
            removed.push(initialTabs[i]);
            initialTabs.splice(i, 1);
          }
        }
      },
      async ungroup(ids) {
        ungroupCallsSoFar++;
        if (ungroupCallsSoFar <= failUngroupCalls) {
          throw new Error("simulated tabs.ungroup failure");
        }
        const arr = Array.isArray(ids) ? ids : [ids];
        for (const id of arr) {
          const t = initialTabs.find((x) => x.id === id);
          if (t) t.groupId = -1;
        }
        ungrouped.push([...arr]);
      },
      async create({ url, active, pinned, windowId }) {
        if (failCreateUrls.has(url)) {
          throw new Error("simulated tabs.create failure for " + url);
        }
        const tab = {
          id: nextTabId++,
          url,
          active: !!active,
          pinned: !!pinned,
          windowId,
          groupId: -1,
        };
        initialTabs.push(tab);
        created.push(tab);
        return tab;
      },
      async group({ tabIds, createProperties }) {
        groupCallsSoFar++;
        if (groupCallsSoFar <= failGroupCalls) {
          throw new Error("simulated tabs.group failure");
        }
        if (!Array.isArray(tabIds) || tabIds.length === 0) {
          throw new Error("tabIds must be non-empty");
        }
        const gid = nextGroupId++;
        for (const id of tabIds) {
          const t = initialTabs.find((x) => x.id === id);
          if (t) t.groupId = gid;
        }
        const windowId = createProperties?.windowId;
        initialGroups.push({ id: gid, title: "", color: "grey", windowId });
        grouped.push({ groupId: gid, tabIds: [...tabIds], windowId });
        return gid;
      },
    },
    _removed: removed,
    _created: created,
    _grouped: grouped,
    _groupUpdates: groupUpdates,
    _ungrouped: ungrouped,
    _storage: storageData,
    _tabs: initialTabs,
    _groups: initialGroups,
  };
}

let pass = 0;
let fail = 0;
const log = [];

async function t(name, fn) {
  try {
    await fn();
    pass++;
    log.push(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    log.push(`  FAIL  ${name}\n        ${e.message.split("\n")[0]}`);
  }
}

// === isRestorableUrl ===
await t("isRestorableUrl allows http/https/ftp/ftps", () => {
  assert.equal(isRestorableUrl("https://a.com"), true);
  assert.equal(isRestorableUrl("http://a.com"), true);
  assert.equal(isRestorableUrl("ftp://a.com"), true);
  assert.equal(isRestorableUrl("ftps://a.com"), true);
});

await t("isRestorableUrl rejects chrome/about/edge/brave/extension", () => {
  assert.equal(isRestorableUrl("chrome://extensions"), false);
  assert.equal(isRestorableUrl("chrome-extension://abc/popup.html"), false);
  assert.equal(isRestorableUrl("about:blank"), false);
  assert.equal(isRestorableUrl("edge://settings"), false);
  assert.equal(isRestorableUrl("brave://settings"), false);
});

await t("isRestorableUrl rejects javascript/data/file (defense-in-depth)", () => {
  assert.equal(isRestorableUrl("javascript:alert(1)"), false);
  assert.equal(isRestorableUrl("data:text/html,hi"), false);
  assert.equal(isRestorableUrl("file:///etc/passwd"), false);
});

await t("isRestorableUrl rejects empty/non-string", () => {
  assert.equal(isRestorableUrl(""), false);
  assert.equal(isRestorableUrl(null), false);
  assert.equal(isRestorableUrl(undefined), false);
  assert.equal(isRestorableUrl(42), false);
});

// === performCleanupCore ===
await t(
  "performCleanupCore closes all tabs in matching 'Claude (MCP)' groups",
  async () => {
    const groups = [
      { id: 100, title: "Claude (MCP)", color: "orange" },
      { id: 200, title: "Work", color: "blue" },
    ];
    const tabs = [
      { id: 1, groupId: 100, url: "https://a.com", title: "A" },
      { id: 2, groupId: 100, url: "https://b.com", title: "B" },
      { id: 3, groupId: 200, url: "https://work.com", title: "W" },
    ];
    const c = makeChromeMock(groups, tabs);
    const r = await performCleanupCore(c, "Claude", "manual");
    assert.equal(r.groups, 1);
    assert.equal(r.tabs, 2);
    assert.equal(c._removed.length, 2);
    assert.equal(c._tabs.length, 1);
    assert.equal(c._tabs[0].id, 3);
  }
);

await t("performCleanupCore catches multiple Claude variants", async () => {
  const groups = [
    { id: 100, title: "⏳Claude" },
    { id: 200, title: "✅Claude" },
    { id: 300, title: "Claude (MCP)" },
    { id: 400, title: "My Notes" },
  ];
  const tabs = [
    { id: 1, groupId: 100, url: "https://1.com" },
    { id: 2, groupId: 200, url: "https://2.com" },
    { id: 3, groupId: 200, url: "https://3.com" },
    { id: 4, groupId: 300, url: "https://4.com" },
    { id: 5, groupId: 400, url: "https://5.com" },
  ];
  const c = makeChromeMock(groups, tabs);
  const r = await performCleanupCore(c, "Claude", "manual");
  assert.equal(r.groups, 3);
  assert.equal(r.tabs, 4);
  assert.equal(c._removed.length, 4);
});

await t("performCleanupCore with no matches removes nothing", async () => {
  const groups = [{ id: 100, title: "Work" }];
  const tabs = [{ id: 1, groupId: 100, url: "https://a.com" }];
  const c = makeChromeMock(groups, tabs);
  const r = await performCleanupCore(c, "Claude", "manual");
  assert.equal(r.groups, 0);
  assert.equal(r.tabs, 0);
  assert.equal(c._removed.length, 0);
  assert.equal("lastSnapshot" in c._storage, false);
});

await t("performCleanupCore writes snapshot with windowId/color/source", async () => {
  const groups = [{ id: 100, title: "Claude (MCP)", color: "orange", windowId: 7 }];
  const tabs = [
    { id: 1, groupId: 100, url: "https://a.com", title: "A", pinned: false },
    { id: 2, groupId: 100, url: "https://b.com", title: "B", pinned: true },
  ];
  const c = makeChromeMock(groups, tabs);
  await performCleanupCore(c, "Claude", "manual");
  const snap = c._storage.lastSnapshot;
  assert.ok(snap);
  assert.equal(snap.groups[0].title, "Claude (MCP)");
  assert.equal(snap.groups[0].color, "orange");
  assert.equal(snap.groups[0].windowId, 7);
  assert.equal(snap.groups[0].tabs.length, 2);
  assert.equal(snap.groups[0].tabs[1].pinned, true);
  assert.equal(snap.source, "manual");
});

await t("performCleanupCore respects exclude pattern", async () => {
  const groups = [
    { id: 100, title: "Claude (MCP)" },
    { id: 200, title: "Claude Pinned" },
    { id: 300, title: "Claude Code" },
  ];
  const tabs = [
    { id: 1, groupId: 100, url: "https://a.com" },
    { id: 2, groupId: 200, url: "https://b.com" },
    { id: 3, groupId: 300, url: "https://c.com" },
  ];
  const c = makeChromeMock(groups, tabs);
  const r = await performCleanupCore(c, "Claude !Pinned", "manual");
  assert.equal(r.groups, 2);
  assert.equal(c._tabs.length, 1);
  assert.equal(c._tabs[0].id, 2);
});

await t("performCleanupCore: snapshot tabIds match removed (no double-query race)", async () => {
  const groups = [{ id: 100, title: "Claude" }];
  const tabs = [
    { id: 1, groupId: 100, url: "https://a.com" },
    { id: 2, groupId: 100, url: "https://b.com" },
  ];
  const c = makeChromeMock(groups, tabs);
  await performCleanupCore(c, "Claude", "manual");
  const snap = c._storage.lastSnapshot;
  assert.equal(snap.groups[0].tabs.length, 2);
  assert.equal(c._removed.length, 2);
  const removedIds = new Set(c._removed.map((t) => t.id));
  assert.deepEqual([...removedIds].sort(), [1, 2]);
});

// === restoreFromSnapshot ===
await t("restoreFromSnapshot returns no-snapshot when nothing saved", async () => {
  const c = makeChromeMock([], [], {});
  const r = await restoreFromSnapshot(c);
  assert.equal(r.restored, 0);
  assert.equal(r.reason, "no-snapshot");
});

await t("restoreFromSnapshot returns expired beyond TTL and purges", async () => {
  const old = Date.now() - UNDO_TTL_MS - 1000;
  const c = makeChromeMock([], [], {
    lastSnapshot: {
      ts: old,
      groups: [{ title: "Claude", color: "orange", tabs: [{ url: "https://a.com" }] }],
    },
  });
  const r = await restoreFromSnapshot(c);
  assert.equal(r.reason, "expired");
  assert.equal("lastSnapshot" in c._storage, false, "expired snapshot should be purged");
});

await t("restoreFromSnapshot TTL boundary: now-ts === ttlMs is still ok", async () => {
  const ts = 1_000_000;
  const c = makeChromeMock([], [], {
    lastSnapshot: {
      ts,
      groups: [{ title: "Claude", color: "orange", tabs: [{ url: "https://a.com" }] }],
    },
  });
  const r = await restoreFromSnapshot(c, UNDO_TTL_MS, ts + UNDO_TTL_MS);
  assert.equal(r.reason, "ok");
  assert.equal(r.restored, 1);
});

await t("restoreFromSnapshot TTL boundary: now-ts === ttlMs+1 is expired", async () => {
  const ts = 1_000_000;
  const c = makeChromeMock([], [], {
    lastSnapshot: {
      ts,
      groups: [{ title: "Claude", color: "orange", tabs: [{ url: "https://a.com" }] }],
    },
  });
  const r = await restoreFromSnapshot(c, UNDO_TTL_MS, ts + UNDO_TTL_MS + 1);
  assert.equal(r.reason, "expired");
});

await t("restoreFromSnapshot recreates tabs with correct windowId and regroups", async () => {
  const c = makeChromeMock([], [], {
    lastSnapshot: {
      ts: Date.now() - 1000,
      groups: [
        {
          title: "Claude (MCP)",
          color: "orange",
          windowId: 42,
          tabs: [
            { url: "https://a.com", pinned: false },
            { url: "https://b.com", pinned: true },
          ],
        },
        {
          title: "⏳Claude",
          color: "grey",
          windowId: 42,
          tabs: [{ url: "https://c.com", pinned: false }],
        },
      ],
    },
  });
  const r = await restoreFromSnapshot(c);
  assert.equal(r.reason, "ok");
  assert.equal(r.restored, 3);
  assert.equal(c._created.length, 3);
  assert.equal(c._created[0].windowId, 42, "create gets windowId");
  assert.equal(c._grouped.length, 2);
  assert.equal(c._grouped[0].windowId, 42, "group gets windowId");
  assert.equal(c._groupUpdates[0].props.title, "Claude (MCP)");
  assert.equal(c._groupUpdates[0].props.color, "orange");
  assert.equal("lastSnapshot" in c._storage, false);
});

await t("restoreFromSnapshot skips chrome/about/javascript/data/file URLs", async () => {
  const c = makeChromeMock([], [], {
    lastSnapshot: {
      ts: Date.now(),
      groups: [
        {
          title: "Claude",
          color: "orange",
          tabs: [
            { url: "chrome://extensions" },
            { url: "https://a.com" },
            { url: "about:blank" },
            { url: "chrome-extension://abc/popup.html" },
            { url: "javascript:alert(1)" },
            { url: "data:text/html,hi" },
            { url: "file:///etc/passwd" },
            { url: "edge://settings" },
            { url: "brave://settings" },
          ],
        },
      ],
    },
  });
  const r = await restoreFromSnapshot(c);
  assert.equal(r.restored, 1);
  assert.equal(r.skipped, 8);
  assert.equal(c._created[0].url, "https://a.com");
});

await t("restoreFromSnapshot handles group with all-skipped URLs gracefully", async () => {
  const c = makeChromeMock([], [], {
    lastSnapshot: {
      ts: Date.now(),
      groups: [
        {
          title: "OnlyChrome",
          color: "blue",
          tabs: [
            { url: "chrome://settings" },
            { url: "chrome://extensions" },
          ],
        },
        {
          title: "Restorable",
          color: "orange",
          tabs: [{ url: "https://a.com" }],
        },
      ],
    },
  });
  const r = await restoreFromSnapshot(c);
  assert.equal(r.restored, 1);
  assert.equal(r.skipped, 2);
  assert.equal(c._grouped.length, 1, "only Restorable group is created");
  assert.equal(c._groupUpdates[0].props.title, "Restorable");
});

await t(
  "restoreFromSnapshot: tabs.create failure keeps snapshot for retry",
  async () => {
    const c = makeChromeMock(
      [],
      [],
      {
        lastSnapshot: {
          ts: Date.now(),
          groups: [
            {
              title: "Claude",
              color: "orange",
              tabs: [
                { url: "https://ok.com" },
                { url: "https://fail.com" },
              ],
            },
          ],
        },
      },
      { failCreateUrls: ["https://fail.com"] }
    );
    const r = await restoreFromSnapshot(c);
    assert.equal(r.reason, "partial");
    assert.equal(r.restored, 1);
    assert.ok(
      "lastSnapshot" in c._storage,
      "snapshot must be preserved after partial failure"
    );
  }
);

await t(
  "restoreFromSnapshot: tabs.group failure keeps snapshot for retry",
  async () => {
    const c = makeChromeMock(
      [],
      [],
      {
        lastSnapshot: {
          ts: Date.now(),
          groups: [
            {
              title: "Claude",
              color: "orange",
              tabs: [{ url: "https://a.com" }],
            },
          ],
        },
      },
      { failGroupCalls: 1 }
    );
    const r = await restoreFromSnapshot(c);
    assert.equal(r.reason, "partial");
    assert.equal(r.restored, 1);
    assert.ok("lastSnapshot" in c._storage);
  }
);

// === purgeExpiredSnapshot ===
await t("purgeExpiredSnapshot removes expired", async () => {
  const ts = 1_000_000;
  const c = makeChromeMock([], [], {
    lastSnapshot: { ts, groups: [{ title: "x", color: "grey", tabs: [] }] },
  });
  const r = await purgeExpiredSnapshot(c, UNDO_TTL_MS, ts + UNDO_TTL_MS + 1);
  assert.equal(r.purged, true);
  assert.equal("lastSnapshot" in c._storage, false);
});

await t("purgeExpiredSnapshot keeps fresh", async () => {
  const ts = 1_000_000;
  const c = makeChromeMock([], [], {
    lastSnapshot: { ts, groups: [{ title: "x", color: "grey", tabs: [] }] },
  });
  const r = await purgeExpiredSnapshot(c, UNDO_TTL_MS, ts + UNDO_TTL_MS - 100);
  assert.equal(r.purged, false);
  assert.equal(r.reason, "fresh");
  assert.ok("lastSnapshot" in c._storage);
});

await t("purgeExpiredSnapshot no-snapshot when none stored", async () => {
  const c = makeChromeMock([], [], {});
  const r = await purgeExpiredSnapshot(c);
  assert.equal(r.purged, false);
  assert.equal(r.reason, "no-snapshot");
});

// === ungroup-before-remove ===
await t("performCleanupCore default ungroupFirst=true calls tabs.ungroup before remove", async () => {
  const groups = [{ id: 100, title: "Claude (MCP)", color: "orange" }];
  const tabs = [
    { id: 1, groupId: 100, url: "https://a.com" },
    { id: 2, groupId: 100, url: "https://b.com" },
  ];
  const c = makeChromeMock(groups, tabs);
  const r = await performCleanupCore(c, "Claude", "manual");
  assert.equal(r.ungroupedGroups, 1);
  assert.equal(c._ungrouped.length, 1);
  assert.deepEqual([...c._ungrouped[0]].sort(), [1, 2]);
  assert.equal(c._removed.length, 2);
  assert.equal(c._storage.lastSnapshot.ungrouped, true);
});

await t("performCleanupCore ungroupFirst=false skips tabs.ungroup", async () => {
  const groups = [{ id: 100, title: "Claude" }];
  const tabs = [{ id: 1, groupId: 100, url: "https://a.com" }];
  const c = makeChromeMock(groups, tabs);
  const r = await performCleanupCore(c, "Claude", "manual", { ungroupFirst: false });
  assert.equal(r.ungroupedGroups, 0);
  assert.equal(c._ungrouped.length, 0);
  assert.equal(c._removed.length, 1);
  assert.equal(c._storage.lastSnapshot.ungrouped, false);
});

await t("performCleanupCore ungroup failure does NOT block remove (graceful)", async () => {
  const groups = [{ id: 100, title: "Claude" }];
  const tabs = [{ id: 1, groupId: 100, url: "https://a.com" }];
  const c = makeChromeMock(groups, tabs, {}, { failUngroupCalls: 1 });
  const r = await performCleanupCore(c, "Claude", "manual");
  assert.equal(r.ungroupedGroups, 0, "ungroup count not incremented on failure");
  assert.equal(c._removed.length, 1, "remove still runs");
});

await t("performCleanupCore ungroup not called for groups with 0 tabs", async () => {
  const groups = [
    { id: 100, title: "Claude" },
    { id: 200, title: "Claude (empty)" },
  ];
  const tabs = [{ id: 1, groupId: 100, url: "https://a.com" }];
  const c = makeChromeMock(groups, tabs);
  await performCleanupCore(c, "Claude", "manual");
  assert.equal(c._ungrouped.length, 1, "only the non-empty group is ungrouped");
});

await t("performCleanupCore handles api without ungroup method (older Chrome / partial mock)", async () => {
  const groups = [{ id: 100, title: "Claude" }];
  const tabs = [{ id: 1, groupId: 100, url: "https://a.com" }];
  const c = makeChromeMock(groups, tabs);
  delete c.tabs.ungroup;
  const r = await performCleanupCore(c, "Claude", "manual");
  assert.equal(r.ungroupedGroups, 0);
  assert.equal(c._removed.length, 1);
});

// === legacy regression ===
await t("legacy: cleanup with empty filter touches nothing", async () => {
  const groups = [{ id: 100, title: "Claude (MCP)" }];
  const tabs = [{ id: 1, groupId: 100, url: "https://a.com" }];
  const c = makeChromeMock(groups, tabs);
  const targets = planCleanup(groups, "");
  assert.equal(targets.length, 0);
  assert.equal(c._removed.length, 0);
  assert.equal(c._tabs.length, 1);
});

await t("legacy: matchesFilter still works with single keyword", async () => {
  assert.equal(matchesFilter("Claude (MCP)", "Claude"), true);
});

console.log(log.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
