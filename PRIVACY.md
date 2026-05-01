# Privacy Policy — MCP Group Cleanup

**Effective date:** 2026-05-01
**Maintainer:** Yutaro Maeda (mattyopon@gmail.com)

## Summary

The "MCP Group Cleanup" Chrome extension does **not** collect, transmit, or share any personal or sensitive user data with the developer or any third party. All data created by the extension is stored locally in your browser's `chrome.storage.local` and never leaves your device.

## What is stored locally

| Key | Content | Purpose | Persistence |
|---|---|---|---|
| `filter` | The substring you typed (e.g. `Claude !Pinned`) | Determines which tab groups match | Until you change it or uninstall |
| `autoEnabled` | Boolean | Whether 30-minute auto-cleanup is on | Same as above |
| `lastSnapshot` | URL/title/pinned state of just-closed tabs, plus group title and color | Powers the 60-second undo | Auto-deleted after 60 s, on undo, or on uninstall |

These are written via `chrome.storage.local.set` and read via `chrome.storage.local.get`. They are **not** synced to any cloud, including Google's `chrome.storage.sync`.

## What is NOT collected

- No analytics, telemetry, crash reporting, or remote logging.
- No tracking IDs, advertising IDs, fingerprints, or session identifiers.
- No browsing history beyond the URL/title of tabs in groups you explicitly target with the filter, and only for the 60-second undo window.
- No content of pages, cookies, form data, login credentials, or DOM scraping.
- No inter-extension communication beyond the extension's own background ↔ popup messaging.

## Permissions and why

- `tabs` — to read tab IDs / URLs for grouping queries and to close tabs.
- `tabGroups` — to read group metadata (title, color) and re-create groups on undo.
- `alarms` — to schedule the 30-minute periodic sweep.
- `storage` — to remember your filter and undo snapshot, locally only.

These are the **narrowest set of permissions necessary** per the Chrome Web Store [Minimum Permission policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#h-min-perm).

## Limited Use compliance

This extension's use of any user data obtained through the listed permissions complies with the Chrome Web Store [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) requirements. Specifically:

- **Allowed use:** All access is for the single purpose of identifying and cleaning matching tab groups, and for the user-initiated 60-second undo.
- **No allowed transfer to third parties.** No data is transferred at all, period.
- **No advertising or behavioral profiling.** No data is used for ad targeting, retargeting, or interest-based advertising.
- **No human review.** The developer cannot read your data because the developer never receives it.

## Your control

- **Change filter:** anytime in the popup.
- **Disable auto-cleanup:** toggle in the popup (state stored locally only).
- **Delete all data:** uninstall the extension; Chrome clears all `chrome.storage.local` entries it owns.
- **Inspect what's stored:** click the `ⓘ` (info) button in the popup → "クリップボードにコピー" to see the raw JSON.

## Data retention and deletion

Local storage is retained until you change the filter, click undo, the 60-second TTL elapses, or you uninstall the extension. There is no off-device retention because there is no off-device storage.

## Children's privacy

The extension does not knowingly process data from anyone, including children under 13. It cannot — it processes no personal data.

## Trademark / Affiliation disclaimer

This extension is an independent third-party tool. It is **not** developed, sponsored, endorsed by, or affiliated with Anthropic, PBC. "Claude" is a trademark of Anthropic, PBC, and is referenced only as the default filter substring because of common Chrome tab-group naming patterns (e.g. `Claude (MCP)`).

## Changes to this policy

If this policy changes, the new version will be committed to the repository and the `Effective date` above updated. Material changes will also be reflected in the next Chrome Web Store update notes.

## Contact

mattyopon@gmail.com
