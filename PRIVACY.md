# Privacy Policy — MCP Group Cleanup

**Effective date:** 2026-05-01
**Maintainer:** Yutaro Maeda (mattyopon@gmail.com)

## Summary

The "MCP Group Cleanup" Chrome extension does **not** collect, transmit, or share any personal or sensitive user data with the developer or any third party. All data created by the extension is stored locally in your browser's `chrome.storage.local` and never leaves your device.

## What is stored locally

| Key | Content | Purpose | Retention |
|---|---|---|---|
| `filter` | The substring you typed (max 200 chars, e.g. `Claude !Pinned`) | Determines which tab groups match | Until you change it or uninstall |
| `autoEnabled` | Boolean | Whether 30-minute auto-cleanup is on | Same as above |
| `lastSnapshot` | URL, title, pinned state of just-closed tabs, plus group title, color, and `windowId` | Powers the 60-second undo and group reconstruction | Auto-purged ≤ ~60 s after creation by a 1-minute background alarm; also cleared on undo, on the next cleanup that overwrites it, or on uninstall |

These are written via `chrome.storage.local.set` and read via `chrome.storage.local.get`. They are **not** synced to any cloud, including Google's `chrome.storage.sync`.

## Snapshot lifecycle (precise)

When you (or the 30-minute auto-sweep) trigger a cleanup, the extension records a `lastSnapshot` containing the URLs/titles/pinned-state of the just-closed tabs and each group's title/color/`windowId`. This snapshot is removed by **whichever happens first**:

1. You click **元に戻す (Undo)** in the popup (the snapshot is consumed on success, kept on partial failure for retry).
2. The 1-minute `purge-snapshot` background alarm fires after the 60-second TTL has elapsed.
3. A subsequent cleanup runs and overwrites it.
4. You uninstall the extension.

Until one of those happens, the snapshot remains in your local browser storage only.

## What is NOT collected

- No analytics, telemetry, crash reporting, or remote logging.
- No tracking IDs, advertising IDs, fingerprints, or session identifiers.
- No browsing history beyond the URLs and titles of tabs in groups you explicitly target with the filter, retained only as described in the snapshot lifecycle above.
- No content of pages, cookies, form data, login credentials, or DOM scraping.
- No inter-extension communication beyond the extension's own background ↔ popup messaging.

## Permissions and why

- `tabs` — required to enumerate tabs by `groupId` (`chrome.tabs.query({groupId})`), to close them (`chrome.tabs.remove`), and to **recreate them on undo** (`chrome.tabs.create`) and **regroup them** (`chrome.tabs.group`).
- `tabGroups` — required to read group metadata (`chrome.tabGroups.query`) for matching against your filter, and to restore each group's title and color on undo (`chrome.tabGroups.update`).
- `alarms` — required to schedule the 30-minute auto-cleanup sweep and the 1-minute snapshot-TTL purge.
- `storage` — required to persist your filter, the auto-cleanup toggle, and the temporary undo snapshot (`chrome.storage.local` only).

These are the **narrowest set of permissions necessary** per the Chrome Web Store [Minimum Permission policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#h-min-perm).

## Limited Use compliance

This extension's use of any user data obtained through the listed permissions complies with the Chrome Web Store [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) requirements. Specifically:

- **Allowed use:** All access is for the single purpose of identifying and cleaning matching tab groups, plus the user-initiated 60-second undo.
- **No allowed transfer to third parties.** No data is transferred at all.
- **No advertising or behavioral profiling.**
- **No human review.** The developer cannot read your data because the developer never receives it.

## Diagnostic export ("ⓘ" button)

Clicking the `ⓘ` button shows a JSON dump of the current extension state for troubleshooting. To prevent accidental leakage when users share this output:

- Tab URLs are **redacted to their `origin` only** (e.g. `https://example.com/…` instead of the full path / query string).
- Tab titles are reduced to their character length only.
- Tab-group titles in the live `tabGroupsRaw` section are replaced with `(redacted)`.

The full URLs and titles are **never** sent off-device, even pre-redaction; redaction only affects what is rendered in the diagnostic panel and copied to the clipboard.

## Your control

- **Change filter:** anytime in the popup (capped at 200 characters).
- **Disable auto-cleanup:** toggle in the popup (state stored locally only).
- **Delete all data:** uninstall the extension; Chrome clears all `chrome.storage.local` entries it owns.
- **Inspect what's stored:** click the `ⓘ` (info) button, then "クリップボードにコピー" to see the redacted JSON.

## Children's privacy

The extension does not knowingly process data from anyone, including children under 13. It cannot — it processes no personal data.

## Trademark / Affiliation disclaimer

This extension is an independent third-party tool. It is **not** developed, sponsored, endorsed by, or affiliated with Anthropic, PBC. "Claude" is a trademark of Anthropic, PBC, and is referenced only as the default filter substring because of common Chrome tab-group naming patterns (e.g. `Claude (MCP)`).

## Changes to this policy

If this policy changes, the new version will be committed to the repository and the `Effective date` above updated. Material changes will also be reflected in the next Chrome Web Store update notes.

## Contact

mattyopon@gmail.com
