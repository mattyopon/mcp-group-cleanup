# Changelog

All notable changes to **MCP Group Cleanup** will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

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
