# Chrome Web Store Listing — MCP Group Cleanup

Source content for the Web Store Developer Dashboard fields. Update before submitting each version.

## Item

| Field | Value |
|---|---|
| Name | `MCP Group Cleanup` |
| Summary (132 char max) | `Auto-closes Chrome tab groups whose title matches your filter (default: 'Claude'). 60-sec undo, exclude patterns.` |
| Category | Productivity |
| Language | English (primary), 日本語 (additional) |

## Detailed description

> MCP Group Cleanup keeps your tab strip tidy by automatically closing tab groups whose **title contains a substring you choose**. The default substring is `Claude`, which matches the `Claude (MCP)`, `⏳Claude`, `✅Claude` etc. groups that pile up across many AI-tool sessions.
>
> **Features**
> - Background sweep every 30 minutes (toggle in the popup)
> - One-click manual cleanup with a confirmation dialog
> - Multi-keyword filter with space/comma separators (OR semantics)
> - Exclude patterns: prefix with `!` (e.g. `Claude !Pinned`)
> - 60-second undo recreates tabs **with the same group title and color**
> - Built-in diagnostic dump (the `ⓘ` button) for troubleshooting
>
> **Privacy: nothing leaves your device.**
> - No telemetry, analytics, or remote logging
> - No `host_permissions` requested
> - All settings stored in `chrome.storage.local` only
>
> **Disclaimer**
> This is an independent third-party tool. Not affiliated with, sponsored by, or endorsed by Anthropic, PBC. "Claude" is a trademark of Anthropic, PBC, and is the **default filter substring** only because Chrome tab-group titles around AI tooling commonly contain it. You can change the filter to anything.
>
> Open source: <REPO_URL>
> Privacy policy: <PRIVACY_URL>

## Single Purpose statement

> The single purpose of this extension is to close Chrome tab groups whose title matches a user-configurable substring filter, with optional automatic periodic execution, a 60-second undo window, and exclude patterns.

## Permissions justifications (Privacy Practices tab)

| Permission | Justification (paste verbatim) |
|---|---|
| `tabs` | Required to query tabs by `groupId` (`chrome.tabs.query({groupId})`) and to close tabs in matching groups (`chrome.tabs.remove`). The extension never reads URLs, content, or titles of tabs outside a user-initiated cleanup. |
| `tabGroups` | Required to enumerate tab groups (`chrome.tabGroups.query`) for matching against the user filter, and to restore group title/color on undo (`chrome.tabGroups.update`). |
| `alarms` | Required to schedule the 30-minute periodic sweep used by the auto-cleanup feature. |
| `storage` | Required to persist (1) the user-set filter substring, (2) the auto-cleanup on/off toggle, and (3) the 60-second undo snapshot — all in `chrome.storage.local` only. |

Remote code: **No, I am not using remote code**.

## Data usage disclosures (Privacy Practices tab)

Tick **only**:
- [x] Website content — _restricted: only tab URLs/titles inside user-targeted groups, kept locally for ≤60 s for undo_

Untick everything else (PII, health, financial, authentication, location, web history, user activity, personal communications). Justification text:

> The extension reads URLs and titles of tabs that are inside groups matching the user-configured filter, only at the moment the user (or the user-enabled scheduler) initiates a cleanup. The data is held in `chrome.storage.local` for at most 60 seconds to power the undo feature. It is not transmitted, shared, or used for any other purpose.

## Limited Use certification

> I certify that this product's use of data received from the listed permissions complies with the Chrome Web Store Limited Use requirements. Specifically: (a) data is used only for the user-facing single purpose described above; (b) no data is transferred to third parties; (c) no data is used or transferred for personalized, retargeted, or interest-based advertising; (d) no humans read user data.

## Privacy policy URL

`<HOST_THIS>` — recommended: GitHub Pages of this repo serving `PRIVACY.md`, e.g. `https://<user>.github.io/mcp-group-cleanup/PRIVACY.html`.

## Screenshots required

Web Store requires **at least 1**, recommended 3-5, **1280×800 or 640×400**.

Suggested set:
1. **Popup default state** showing groups list + 自動 toggle on
2. **Filter with exclude pattern** (`Claude !Pinned`) showing matched/excluded distinction
3. **Confirmation dialog** ("3 グループ / 計 14 タブを閉じます")
4. **Undo banner** showing remaining seconds
5. **Diagnostic JSON** open (highlights "no telemetry" angle)

Take from `chrome://extensions/` after `Load unpacked`, popup-only screenshot via DevTools → Sensors or third-party Window Capture; resize to 1280×800.

## Promo tile (optional but boosts visibility)

- Small tile: 440×280
- Marquee tile: 1400×560 (only if applying for "Featured")

## Submission checklist

- [ ] Privacy policy URL is publicly accessible
- [ ] At least 1 screenshot (1280×800)
- [ ] Single purpose statement matches described features
- [ ] Permission justifications match `manifest.json` exactly
- [ ] Disclaimer about Anthropic / "Claude" trademark visible in description AND in extension UI (footer)
- [ ] Version bumped (`manifest.json`)
- [ ] `bash build.sh` produces `dist/mcp-group-cleanup-v0.4.0.zip`
- [ ] Test the zip by **Load unpacked** on an unzipped copy before upload
- [ ] First-time only: $5 developer registration fee paid
