# Changelog

All notable changes to **MCP Group Cleanup** will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.5] — 2026-05-01

### Removed
- **`bookmarks` permission reverted.** v0.4.4 added it to empirically test whether Chrome's "Saved Tab Groups" leak through `chrome.bookmarks.getTree()`. They do not. Verified on Chrome 147: the bookmarks-bar folder has `children: []` even when saved tab groups are visibly pinned to it. Saved Tab Groups live in a separate internal sync store inaccessible to extension APIs.
- **`bookmarksRaw` removed from the diagnostic dump.** `summarizeBookmarkNode` helper deleted. `chrome.bookmarks` typeof checks dropped from the `apis` block.

### Documentation
- README "Saved Tab Groups note" rewritten to state the feature is **unsupported** with explicit empirical evidence and links to chromium issue 374592179 and the chromium-extensions ML thread.

### Result
- Permission set is back to the minimum: `tabs`, `tabGroups`, `alarms`, `storage`.

## [0.4.4] — 2026-05-01

### Added (verification-only)
- **`bookmarks` permission** added to `manifest.json` *for the diagnostic verification phase only*. Goal: determine whether Chrome's "Saved Tab Groups" (pinned to bookmarks bar) appear in `chrome.bookmarks.getTree()`.
- **`bookmarksRaw` in the `ⓘ` diagnostic dump** — full tree with bookmark URLs redacted to `origin/…`, titles preserved (we need titles to identify saved tab groups). Folder/bookmark distinction recorded.
- **`tabGroupsRaw` titles unredacted** in diagnostic — required to correlate live groups vs bookmark entries.

### Why
Per [chromium-extensions thread, Oct 2024](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/rypFJOkAlz8), the Chrome team confirmed there is **no public API for Saved Tab Groups**. Whether they leak through `chrome.bookmarks` is unknown without empirical testing on a current Chrome build, hence this verification-only release.

### Note
If `chrome.bookmarks.getTree()` does not surface saved tab groups, the `bookmarks` permission will be removed in v0.4.5 and the feature will be marked unsupported until Chrome ships a public API.

## [0.4.3] — 2026-05-01

### Fixed
- **空フィルタで何もマッチしない問題** — `effectiveFilter()` ヘルパを追加し、ストレージ値が空文字列・空白のみ・null/undefined/非文字列のいずれでも DEFAULT_FILTER (`"Claude"`) にフォールバックさせる。`onInstalled.reason === "install"` でしかデフォルトを書かない仕様の隙間 (v0.3.1 → v0.4.x のアップデートや手動で空にした場合) を塞いだ。
- popup の bulk cleanup 時、フィルタ欄が空ならその場で DEFAULT_FILTER を入力欄にも書き戻す。
- bg autoCleanup と manualCleanup ハンドラも `effectiveFilter` 経由に変更。

### Tests
- 5 件追加 (matcher.test.mjs): effectiveFilter の non-empty / empty string / whitespace / null/undefined/非文字列 / surrounding whitespace trim。

## [0.4.2] — 2026-05-01

### Added
- **「拡張をリロード」ボタン**を診断パネル (`ⓘ`) 内に追加。`chrome.runtime.reload()` を直接呼ぶので `chrome://extensions/` に遷移せずに popup 上から拡張を再読み込みできる。誤クリック防止のため通常導線 (refresh/cleanup) からは独立し、`ⓘ` を開いた時のみ表示される。

## [0.4.1] — 2026-05-01

### Added
- **`constants.js`** — single source of truth for `UNDO_TTL_MS`, `SWEEP_PERIOD_MIN`, `FILTER_MAX_LENGTH`, `LOG_PREFIX`. Removes drift risk between background and popup.
- **Snapshot purge alarm** — a 1-minute `purge-snapshot` alarm now actively deletes expired `lastSnapshot` entries from `chrome.storage.local`, matching the privacy policy's "auto-deleted after ~60 s" claim.
- **Single-group `×` button is now undo-eligible** — `popup.js` routes individual deletes through a new `singleGroupCleanup` message that records the same snapshot shape as a bulk cleanup.
- **Diagnostic redaction** — the popup `ⓘ` JSON dump now exposes only `URL.origin + "/…"` instead of full URLs and replaces `tabGroupsRaw[].title` with `(redacted)`. Prevents leakage if the user pastes the diag into a public tracker.
- **Hardened `isRestorableUrl`** — switched from a denylist (`chrome://`, `chrome-extension://`, `about:`, `edge://`, `brave://`) to an explicit **allowlist** of `http://`, `https://`, `ftp://`, `ftps://`. `javascript:`, `data:`, and `file://` are now actively rejected for defense-in-depth even though Chromium's tab API normally already blocks them.
- **`FILTER_MAX_LENGTH = 200`** enforced in `manifest.json` `<input>`, on storage write, and on read.
- **TTL boundary tests** — `now-ts === ttlMs` is allowed; `now-ts === ttlMs+1` is expired. `purgeExpiredSnapshot` is unit tested.
- **windowId restoration** — `chrome.tabs.create` and `chrome.tabs.group` now receive the original group's `windowId`, with a single fallback to the focused window if the original is gone. Prevents undo from re-creating tabs in the wrong Chrome window.
- **Partial-failure resilience** — `restoreFromSnapshot` no longer consumes `lastSnapshot` if any `tabs.create` / `tabs.group` / `tabGroups.update` fails; it returns `reason: "partial"` so the user can hit Undo again.
- **All-skipped group handling** — a group whose tabs are all chrome:// (or other unrestorable schemes) no longer triggers a `chrome.tabs.group({tabIds: []})` call, eliminating a latent service-worker exception.
- **Idempotent alarm registration** — `chrome.alarms.create` is gated by `chrome.alarms.get` so service-worker re-spawns don't perpetually reset the 30-minute sweep timer.

### Changed
- **`bg.js` log prefix** unified to `[mcp-cleanup]` (was a mix of `[claude-mcp-cleanup]` and `[mcp-cleanup]`).
- **Snapshot tab IDs are captured at snapshot time and reused for the remove call** — eliminates the previous double-`chrome.tabs.query` race in `performCleanupCore` where a tab opened mid-cleanup could be closed without being recorded for undo.
- **`PRIVACY.md`** now precisely documents (a) `windowId` is stored in the snapshot, (b) the snapshot is purged by a 1-minute alarm rather than only on popup-open, (c) diagnostic redaction policy.
- **`store-listing.md`** Privacy Practices section now ticks **Web history** in addition to Website content, matching the URL+title+timestamp shape of `lastSnapshot`. Permission justifications updated to mention `tabs.create` / `tabs.group` for undo.
- **`build.sh`** now (a) extracts the version with a `node → python3 → grep` fallback chain, (b) emits a deterministic, lexicographically-sorted zip with fixed (1980-01-01) timestamps via `zipfile.ZipInfo`, eliminating the cross-machine binary drift.

### Verified
- 49/49 tests pass (`matcher.test.mjs` 25, `cleanup.test.mjs` 24).
- `bash build.sh` produces `dist/mcp-group-cleanup-v0.4.1.zip` from the staged file set listed in `build.sh`.

### Test additions (new in 0.4.1)
- `isRestorableUrl` allowlist behavior across http/https/ftp/ftps and rejection of chrome/about/edge/brave/extension/javascript/data/file/empty/non-string.
- `restoreFromSnapshot` TTL boundary at exactly `ttlMs` and `ttlMs + 1`.
- `restoreFromSnapshot` recreates tabs **with `windowId`** and the regrouped tabs inherit the same `windowId`.
- `restoreFromSnapshot` keeps `lastSnapshot` after a `tabs.create` failure (retryable partial state).
- `restoreFromSnapshot` keeps `lastSnapshot` after a `tabs.group` failure.
- `restoreFromSnapshot` handles a group whose tabs are all chrome:// without crashing.
- `purgeExpiredSnapshot` removes expired, keeps fresh, no-ops when none stored.
- `performCleanupCore` snapshot tab IDs match the removed-tab IDs (race regression).

## [0.4.0] — 2026-05-01

### Added
- **Multi-keyword include** — space/comma-separated filter tokens behave as OR. `Claude MCP` now matches groups containing either word.
- **Exclude patterns** — prefix any token with `!` to exclude (`Claude !Pinned`).
- **Confirmation dialog** before manual bulk cleanup, showing affected group/tab counts.
- **60-second Undo** — `lastSnapshot` is written to `chrome.storage.local` immediately before tab removal; the popup exposes "元に戻す" and re-creates tabs with their original group title and color via `chrome.tabs.create` + `chrome.tabs.group` + `chrome.tabGroups.update`.
- **Auto-cleanup toggle** — switch in the popup; `autoEnabled` is persisted to `chrome.storage.local`. The background sweep skips when off.
- **`cleanup-logic.js`** — pure-function core (chrome API injected) for unit testability.
- **`PRIVACY.md`**, **`LICENSE` (MIT)**, **`README.md`** for Chrome Web Store submission readiness.
- **`build.sh`** — produces a Web Store-ready zip excluding tests/docs.

### Changed
- **Renamed** to `MCP Group Cleanup` (was `Claude MCP Group Auto-Cleanup`) — reduces Anthropic trademark surface while keeping the default filter substring `Claude`. Disclaimer added in popup footer, README, and privacy policy.
- `bg.js` now delegates to `cleanup-logic.js` and exposes `manualCleanup` / `undo` / `ping` message types.
- Test suite expanded from 23 to 36 cases (matcher 25, cleanup 11) covering parseFilter, exclude semantics, snapshot/restore, TTL, and chrome-scheme URL skipping.

### Verified
- `chrome.tabGroups.onRemoved` fires automatically when a group's tab count reaches zero ([per official spec](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)). No explicit group close API is needed and none exists.

## [0.3.1] — 2026-04-30

- Initial private build: matcher, popup with diagnostic, 30-minute auto sweep, 23 unit tests.
