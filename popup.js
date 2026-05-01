import { matchesFilter, DEFAULT_FILTER, effectiveFilter } from "./matcher.js";
import { UNDO_TTL_MS, FILTER_MAX_LENGTH, LOG_PREFIX } from "./constants.js";

const $ = (id) => document.getElementById(id);

const COLOR_HEX = {
  grey: "#9aa0a6",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#fbbc04",
  green: "#188038",
  pink: "#d01884",
  purple: "#9334e6",
  cyan: "#007b83",
  orange: "#fa7b17",
};

const errors = [];
let undoTimer = null;

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function showError(label, e) {
  const text = `${label}: ${e?.message || e}`;
  errors.push({ label, message: e?.message || String(e), stack: e?.stack });
  console.error(LOG_PREFIX, label, e);
  const banner = $("err-banner");
  banner.textContent = text;
  banner.classList.add("show");
}

function setMsg(text, kind = "") {
  const el = $("msg");
  el.textContent = text;
  el.className = "msg" + (kind ? " " + kind : "");
}

function setStats(text) {
  $("stats").textContent = text;
}

async function safeQueryGroups() {
  try {
    if (!chrome?.tabGroups?.query) {
      throw new Error(
        "chrome.tabGroups API 不在 (Chrome 89+ / 'tabGroups' 権限要)"
      );
    }
    const result = await chrome.tabGroups.query({});
    if (!Array.isArray(result)) {
      throw new Error("tabGroups.query が配列を返さず: " + typeof result);
    }
    return result;
  } catch (e) {
    showError("tabGroups.query 失敗", e);
    return [];
  }
}

async function safeTabsOf(groupId) {
  try {
    return await chrome.tabs.query({ groupId });
  } catch (e) {
    showError(`tabs.query(groupId=${groupId}) 失敗`, e);
    return [];
  }
}

async function render() {
  const filter = $("filter").value.trim();
  $("list").innerHTML = '<div class="loading">取得中…</div>';

  const groups = await safeQueryGroups();

  const enriched = [];
  for (const g of groups) {
    const tabs = await safeTabsOf(g.id);
    enriched.push({ g, tabs, matches: matchesFilter(g.title, filter) });
  }
  enriched.sort((a, b) => Number(b.matches) - Number(a.matches));

  const matchCount = enriched.filter((r) => r.matches).length;
  const totalTabs = enriched.reduce((s, r) => s + r.tabs.length, 0);
  const matchTabCount = enriched
    .filter((r) => r.matches)
    .reduce((s, r) => s + r.tabs.length, 0);

  setStats(
    `グループ ${groups.length} / タブ ${totalTabs} / マッチ ${matchCount}`
  );

  if (enriched.length === 0) {
    $("list").innerHTML =
      '<div class="empty">タブグループが0件です<br>(タブをグループ化していないか、API取得失敗)</div>';
  } else {
    $("list").innerHTML = enriched
      .map((r) => {
        const titleHtml = r.g.title
          ? escapeHtml(r.g.title)
          : '<span class="untitled">(無題)</span>';
        const dot = COLOR_HEX[r.g.color] || "#999";
        return `<div class="group ${r.matches ? "match" : ""}" data-gid="${r.g.id}">
          <span class="dot" style="background:${dot}"></span>
          <span class="title" title="${escapeHtml(r.g.title || "")}">${titleHtml}</span>
          <span class="tabs">${r.tabs.length}t</span>
          <button class="del" data-gid="${r.g.id}" title="このグループのタブを閉じる (60秒以内なら元に戻せます)">×</button>
        </div>`;
      })
      .join("");

    document.querySelectorAll(".del").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const gid = parseInt(btn.dataset.gid, 10);
        try {
          const resp = await chrome.runtime.sendMessage({
            type: "singleGroupCleanup",
            groupId: gid,
          });
          if (!resp?.ok) throw new Error(resp?.error || "singleGroupCleanup failed");
          setMsg(`グループ #${gid} のタブ ${resp.tabs} 件を閉じました`, "ok");
          startUndoCountdown();
        } catch (err) {
          showError(`タブ削除 (gid=${gid})`, err);
        }
        await render();
        await refreshUndoUI();
      });
    });
  }

  const cleanupBtn = $("cleanup");
  cleanupBtn.disabled = matchCount === 0;
  cleanupBtn.dataset.matchCount = String(matchCount);
  cleanupBtn.dataset.matchTabs = String(matchTabCount);
  cleanupBtn.textContent =
    matchCount === 0 ? "マッチなし" : `マッチ ${matchCount} 件をクリーンアップ`;
}

let confirmInFlight = false;
function showConfirm({ groupCount, tabCount }) {
  if (confirmInFlight) return Promise.resolve(false);
  confirmInFlight = true;
  return new Promise((resolve) => {
    const modal = $("confirm-modal");
    $("confirm-text").textContent =
      `${groupCount} グループ / 計 ${tabCount} タブを閉じます。元に戻すは ${
        UNDO_TTL_MS / 1000
      } 秒以内のみ可能です。`;
    modal.classList.add("show");
    let settled = false;
    const finish = (decision) => {
      if (settled) return;
      settled = true;
      modal.classList.remove("show");
      $("confirm-yes").removeEventListener("click", yes);
      $("confirm-no").removeEventListener("click", no);
      confirmInFlight = false;
      resolve(decision);
    };
    const yes = () => finish(true);
    const no = () => finish(false);
    $("confirm-yes").addEventListener("click", yes);
    $("confirm-no").addEventListener("click", no);
  });
}

async function bulkCleanup() {
  const raw = $("filter").value.trim();
  const filter = effectiveFilter(raw);
  if (raw === "") {
    $("filter").value = filter;
  }
  const cleanupBtn = $("cleanup");
  const groupCount = parseInt(cleanupBtn.dataset.matchCount || "0", 10);
  const tabCount = parseInt(cleanupBtn.dataset.matchTabs || "0", 10);
  if (groupCount === 0) return;

  const ok = await showConfirm({ groupCount, tabCount });
  if (!ok) return;

  cleanupBtn.disabled = true;
  setMsg("クリーンアップ中…");
  try {
    const resp = await chrome.runtime.sendMessage({ type: "manualCleanup", filter });
    if (!resp?.ok) throw new Error(resp?.error || "manualCleanup failed");
    await chrome.storage.local.set({ filter });
    setMsg(`${resp.groups} group / ${resp.tabs} tabs を閉じました`, "ok");
    startUndoCountdown();
  } catch (e) {
    showError("bulkCleanup", e);
  } finally {
    await render();
    await refreshUndoUI();
  }
}

async function doUndo() {
  setMsg("復元中…");
  try {
    const resp = await chrome.runtime.sendMessage({ type: "undo" });
    if (!resp?.ok) throw new Error(resp?.error || "undo failed");
    if (resp.reason === "no-snapshot") {
      setMsg("復元できる履歴がありません", "err");
    } else if (resp.reason === "expired") {
      setMsg(`有効期限切れ (${UNDO_TTL_MS / 1000}秒以内のみ復元可)`, "err");
    } else if (resp.reason === "partial") {
      setMsg(
        `部分復元 (${resp.restored} 件成功 / 一部失敗。再度元に戻すで残りを再試行可)`,
        "err"
      );
    } else {
      const skip = resp.skipped > 0 ? ` (${resp.skipped} 件は復元不可URLのためスキップ)` : "";
      setMsg(`${resp.restored} タブを復元しました${skip}`, "ok");
    }
  } catch (e) {
    showError("undo", e);
  } finally {
    await render();
    await refreshUndoUI();
  }
}

async function refreshUndoUI() {
  if (undoTimer) {
    clearInterval(undoTimer);
    undoTimer = null;
  }
  const { lastSnapshot } = await chrome.storage.local.get("lastSnapshot");
  const row = $("undo-row");
  if (!lastSnapshot) {
    row.classList.remove("show");
    return;
  }
  const elapsed = Date.now() - lastSnapshot.ts;
  if (elapsed > UNDO_TTL_MS) {
    row.classList.remove("show");
    await chrome.storage.local.remove("lastSnapshot");
    return;
  }
  row.classList.add("show");
  const totalTabs = lastSnapshot.groups.reduce(
    (s, g) => s + g.tabs.length,
    0
  );
  const updateLabel = () => {
    const remain = Math.max(0, UNDO_TTL_MS - (Date.now() - lastSnapshot.ts));
    const sec = Math.ceil(remain / 1000);
    if (remain <= 0) {
      row.classList.remove("show");
      clearInterval(undoTimer);
      undoTimer = null;
      return;
    }
    $("undo-label").textContent = `${totalTabs} タブを復元 (残り ${sec}秒)`;
  };
  updateLabel();
  undoTimer = setInterval(updateLabel, 500);
}

function startUndoCountdown() {
  refreshUndoUI();
}

function redactUrl(url) {
  if (typeof url !== "string" || !url) return "";
  try {
    return new URL(url).origin + "/…";
  } catch {
    return "(opaque)";
  }
}

function redactSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    ts: snapshot.ts,
    source: snapshot.source,
    groups: (snapshot.groups || []).map((g) => ({
      title: g.title,
      color: g.color,
      windowId: g.windowId,
      tabs: (g.tabs || []).map((t) => ({
        urlOrigin: redactUrl(t.url),
        titleLength: (t.title || "").length,
        pinned: !!t.pinned,
      })),
    })),
  };
}

async function buildDiagnostic() {
  const manifest = chrome.runtime.getManifest();
  const ua = navigator.userAgent;
  let storageState = null;
  try {
    const raw = await chrome.storage.local.get(null);
    storageState = { ...raw };
    if (storageState.lastSnapshot) {
      storageState.lastSnapshot = redactSnapshot(storageState.lastSnapshot);
    }
  } catch (e) {
    storageState = { _error: e.message };
  }

  let groupsRaw = null;
  try {
    const raw = await chrome.tabGroups.query({});
    groupsRaw = Array.isArray(raw)
      ? raw.map((g) => ({ id: g.id, color: g.color, title: g.title ? "(redacted)" : "" }))
      : { _error: "not array" };
  } catch (e) {
    groupsRaw = { _error: e.message };
  }

  let tabsRaw = null;
  try {
    const allTabs = await chrome.tabs.query({});
    tabsRaw = {
      total: allTabs.length,
      grouped: allTabs.filter((t) => t.groupId !== -1).length,
    };
  } catch (e) {
    tabsRaw = { _error: e.message };
  }

  const apis = {
    "chrome.tabGroups": typeof chrome.tabGroups,
    "chrome.tabGroups.query": typeof chrome.tabGroups?.query,
    "chrome.tabs": typeof chrome.tabs,
    "chrome.tabs.query": typeof chrome.tabs?.query,
    "chrome.tabs.remove": typeof chrome.tabs?.remove,
    "chrome.tabs.create": typeof chrome.tabs?.create,
    "chrome.tabs.group": typeof chrome.tabs?.group,
    "chrome.storage.local": typeof chrome.storage?.local,
    "chrome.runtime.sendMessage": typeof chrome.runtime?.sendMessage,
  };

  const dump = {
    extension: {
      name: manifest.name,
      version: manifest.version,
      permissions: manifest.permissions,
    },
    userAgent: ua,
    apis,
    storage: storageState,
    tabGroupsRaw: groupsRaw,
    tabsSummary: tabsRaw,
    capturedErrors: errors,
    timestamp: new Date().toISOString(),
    note: "URLs and titles are redacted to origin / length only.",
  };
  return JSON.stringify(dump, null, 2);
}

async function showDiagnostic() {
  const panel = $("diag");
  const actions = $("diag-actions");
  panel.classList.add("show");
  actions.classList.add("show");
  panel.textContent = "収集中…";
  panel.textContent = await buildDiagnostic();
}

function hideDiagnostic() {
  $("diag").classList.remove("show");
  $("diag-actions").classList.remove("show");
}

async function copyDiagnostic() {
  const text = $("diag").textContent;
  try {
    await navigator.clipboard.writeText(text);
    setMsg("診断情報をコピーしました (URLは origin のみ)", "ok");
  } catch (e) {
    showError("clipboard.writeText", e);
  }
}

window.addEventListener("error", (ev) => {
  showError("window.error", ev.error || ev.message);
});
window.addEventListener("unhandledrejection", (ev) => {
  showError("unhandledrejection", ev.reason);
});

(async () => {
  try {
    const m = chrome.runtime.getManifest();
    $("ver").textContent = "v" + m.version;
  } catch (e) {
    showError("getManifest", e);
  }

  $("filter").maxLength = FILTER_MAX_LENGTH;

  try {
    const stored = await chrome.storage.local.get([
      "filter",
      "autoEnabled",
      "ungroupBeforeRemove",
    ]);
    $("filter").value = effectiveFilter(stored.filter).slice(0, FILTER_MAX_LENGTH);
    $("auto-toggle").checked = stored.autoEnabled !== false;
    $("ungroup-toggle").checked = stored.ungroupBeforeRemove !== false;
  } catch (e) {
    showError("storage.get", e);
    $("filter").value = DEFAULT_FILTER;
    $("auto-toggle").checked = true;
  }

  $("cleanup").addEventListener("click", bulkCleanup);
  $("undo-btn").addEventListener("click", doUndo);
  $("refresh").addEventListener("click", async () => {
    setMsg("");
    $("err-banner").classList.remove("show");
    errors.length = 0;
    await render();
    await refreshUndoUI();
  });
  $("info-btn").addEventListener("click", showDiagnostic);
  $("diag-copy").addEventListener("click", copyDiagnostic);
  $("diag-reload").addEventListener("click", () => {
    setMsg("拡張をリロード中…", "ok");
    chrome.runtime.reload();
  });
  $("diag-close").addEventListener("click", hideDiagnostic);

  $("auto-toggle").addEventListener("change", async (e) => {
    try {
      await chrome.storage.local.set({ autoEnabled: e.target.checked });
      setMsg(
        e.target.checked
          ? "自動クリーンアップを有効化"
          : "自動クリーンアップを無効化",
        "ok"
      );
    } catch (err) {
      showError("storage.set autoEnabled", err);
    }
  });

  $("ungroup-toggle").addEventListener("change", async (e) => {
    try {
      await chrome.storage.local.set({ ungroupBeforeRemove: e.target.checked });
      setMsg(
        e.target.checked
          ? "閉じる前に ungroup します (ブックマーク保存回避を試行)"
          : "ungroup せず直接タブを閉じます",
        "ok"
      );
    } catch (err) {
      showError("storage.set ungroupBeforeRemove", err);
    }
  });

  let saveTimer = null;
  $("filter").addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const v = $("filter").value.trim().slice(0, FILTER_MAX_LENGTH);
        await chrome.storage.local.set({ filter: v });
      } catch (e) {
        showError("storage.set", e);
      }
    }, 300);
    render();
  });

  await render();
  await refreshUndoUI();
})().catch((e) => showError("popup init", e));
