import { strict as assert } from "node:assert";
import { matchesFilter, planCleanup } from "../matcher.js";
import {
  performCleanupCore,
  restoreFromSnapshot,
  snapshotMatchingTabs,
  UNDO_TTL_MS,
} from "../cleanup-logic.js";

function makeChromeMock(initialGroups, initialTabs, storageData = {}) {
  let nextTabId = 1000;
  let nextGroupId = 9000;
  const removed = [];
  const created = [];
  const grouped = [];
  const groupUpdates = [];
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
      async create({ url, active, pinned }) {
        const tab = {
          id: nextTabId++,
          url,
          active: !!active,
          pinned: !!pinned,
          groupId: -1,
        };
        initialTabs.push(tab);
        created.push(tab);
        return tab;
      },
      async group({ tabIds }) {
        const gid = nextGroupId++;
        for (const id of tabIds) {
          const t = initialTabs.find((x) => x.id === id);
          if (t) t.groupId = gid;
        }
        initialGroups.push({ id: gid, title: "", color: "grey" });
        grouped.push({ groupId: gid, tabIds: [...tabIds] });
        return gid;
      },
    },
    _removed: removed,
    _created: created,
    _grouped: grouped,
    _groupUpdates: groupUpdates,
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
  assert.equal("lastSnapshot" in c._storage, false, "no snapshot when nothing matched");
});

await t("performCleanupCore writes snapshot to storage when something removed", async () => {
  const groups = [{ id: 100, title: "Claude (MCP)", color: "orange", windowId: 1 }];
  const tabs = [
    { id: 1, groupId: 100, url: "https://a.com", title: "A", pinned: false },
    { id: 2, groupId: 100, url: "https://b.com", title: "B", pinned: true },
  ];
  const c = makeChromeMock(groups, tabs);
  await performCleanupCore(c, "Claude", "manual");
  const snap = c._storage.lastSnapshot;
  assert.ok(snap);
  assert.equal(snap.groups.length, 1);
  assert.equal(snap.groups[0].title, "Claude (MCP)");
  assert.equal(snap.groups[0].color, "orange");
  assert.equal(snap.groups[0].tabs.length, 2);
  assert.equal(snap.groups[0].tabs[1].pinned, true);
  assert.equal(snap.source, "manual");
  assert.ok(typeof snap.ts === "number");
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

// === restore ===

await t("restoreFromSnapshot returns no-snapshot when nothing saved", async () => {
  const c = makeChromeMock([], [], {});
  const r = await restoreFromSnapshot(c);
  assert.equal(r.restored, 0);
  assert.equal(r.reason, "no-snapshot");
});

await t("restoreFromSnapshot returns expired beyond TTL", async () => {
  const old = Date.now() - UNDO_TTL_MS - 1000;
  const c = makeChromeMock(
    [],
    [],
    {
      lastSnapshot: {
        ts: old,
        groups: [{ title: "Claude", color: "orange", tabs: [{ url: "https://a.com", pinned: false }] }],
      },
    }
  );
  const r = await restoreFromSnapshot(c);
  assert.equal(r.restored, 0);
  assert.equal(r.reason, "expired");
});

await t("restoreFromSnapshot recreates tabs and regroups them", async () => {
  const c = makeChromeMock(
    [],
    [],
    {
      lastSnapshot: {
        ts: Date.now() - 1000,
        groups: [
          {
            title: "Claude (MCP)",
            color: "orange",
            tabs: [
              { url: "https://a.com", pinned: false },
              { url: "https://b.com", pinned: true },
            ],
          },
          {
            title: "⏳Claude",
            color: "grey",
            tabs: [{ url: "https://c.com", pinned: false }],
          },
        ],
      },
    }
  );
  const r = await restoreFromSnapshot(c);
  assert.equal(r.reason, "ok");
  assert.equal(r.restored, 3);
  assert.equal(c._created.length, 3);
  assert.equal(c._grouped.length, 2);
  assert.equal(c._groupUpdates[0].props.title, "Claude (MCP)");
  assert.equal(c._groupUpdates[0].props.color, "orange");
  assert.equal("lastSnapshot" in c._storage, false, "snapshot consumed");
});

await t("restoreFromSnapshot skips chrome:// URLs", async () => {
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
              { url: "chrome://extensions", pinned: false },
              { url: "https://a.com", pinned: false },
              { url: "about:blank", pinned: false },
              { url: "chrome-extension://abc/popup.html", pinned: false },
            ],
          },
        ],
      },
    }
  );
  const r = await restoreFromSnapshot(c);
  assert.equal(r.restored, 1);
  assert.equal(c._created.length, 1);
  assert.equal(c._created[0].url, "https://a.com");
});

// === legacy regression: matchesFilter behavior preserved ===

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
