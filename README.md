# MCP Group Cleanup

A tiny Chrome extension that auto-closes tab groups whose **title** contains a configurable substring (default: `Claude`). Born out of the daily annoyance of accumulating `Claude (MCP)` tab groups across many sessions.

> **Disclaimer:** This is an independent third-party tool. **Not affiliated with Anthropic, PBC.** "Claude" is a trademark of Anthropic, PBC. The default filter `Claude` is a substring you can change at any time.

## Features

- **Auto-cleanup** every 30 minutes (toggle in popup)
- **Manual one-click cleanup** with confirmation dialog
- **Multi-keyword filter** — space/comma separated, OR semantics (`Claude MCP`)
- **Exclude pattern** — prefix with `!` (`Claude !Pinned` keeps groups containing "Pinned")
- **60-second Undo** — recreates tabs and re-groups them with original title/color
- **Single-group delete** — `×` button on any group in the list
- **Diagnostic dump** — built-in `ⓘ` button captures storage / API / errors as JSON
- **Zero network** — all data stays in `chrome.storage.local`. No telemetry, no analytics

## Install (developer mode)

1. Clone this repo
2. Open `chrome://extensions/` and enable **Developer mode**
3. **Load unpacked** → select this directory
4. Pin the extension to the toolbar from the puzzle-piece menu

## Usage

| Action | How |
|---|---|
| Set filter | Type in the popup. `Claude` matches `Claude (MCP)`, `⏳Claude`, `Claude Code`, etc. |
| Multi-include | `Claude MCP` matches groups whose title contains `Claude` **or** `MCP` |
| Exclude | `Claude !Pinned` matches `Claude*` but skips groups containing `Pinned` |
| Manual cleanup | Click **マッチを全件クリーンアップ** → confirm |
| Single group | Click `×` next to any group |
| Toggle auto | Switch in the popup; persists across restarts |
| Undo | Click **元に戻す** within 60 seconds |
| Diagnostic | Click `ⓘ` for a JSON dump of state / errors |

## Saved Tab Groups note

Recent Chrome versions save closed tab groups to the **Saved Tab Groups** bar by default. This extension closes the group's tabs (which automatically closes the group itself per the [`chrome.tabGroups.onRemoved`](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) spec) but it does **not** delete saved entries. To purge them: right-click a saved group on the bookmarks bar → **Delete group**.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | `chrome.tabs.query({groupId})` to enumerate tabs of a group; `chrome.tabs.remove` to close |
| `tabGroups` | `chrome.tabGroups.query`/`update` to list and re-group during undo |
| `alarms` | 30-minute periodic sweep |
| `storage` | Persist filter / autoEnabled / undo snapshot |

No `<all_urls>`, no `host_permissions`, no `activeTab`. Per Chrome Web Store [Minimum Permission Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

## Privacy

- The extension does **not** transmit data anywhere.
- Stored locally only: filter string, auto-toggle state, last-cleanup snapshot (URLs/titles), captured runtime errors.
- See [`PRIVACY.md`](./PRIVACY.md).

## Development

```bash
# Run tests
bash tests/run.sh

# Build a Web Store-ready zip
bash build.sh
# -> dist/mcp-group-cleanup-v<version>.zip
```

## License

MIT — see [`LICENSE`](./LICENSE).
