# Discord appearance and utilities — 2026-10-20

## Findings

The original presets only supplied `--background-primary`, `--background-secondary`
and related legacy variables. Discord's Visual Refresh surfaces now consume
`--background-base-lowest`, `--background-base-lower`, `--background-base-low`,
`--background-surface-high` and newer input/control/text tokens. `--text-link`
still worked, explaining the user's screenshot: pink links with unchanged panels.
The theme service was injecting CSS correctly; its palette coverage was incomplete.

Modern palettes cover both token generations, nested theme scopes (including
popouts), composer, cards, borders, mentions, scrolling and primary controls.
Discord's custom-background rules use `--background-gradient-*` before a solid
surface fallback. Preset revision 3 clears those layers while active. It also
styles the chat, channel list, member list, server rail and composer through
component-name prefixes scoped below the app mount. Full class hashes are not
embedded. Custom profile surfaces are excluded from these overrides.

Built-in presets use important declarations to override native variants; QuickCSS
overrides of these tokens or surfaces should also use `!important`. Imported
third-party CSS is preserved as supplied, and its compatibility remains the
author's responsibility.

Fixing the catalog alone cannot fix an installed theme: settings contain a full
CSS snapshot. Exact copies of our previous four presets are upgraded in place,
preserving IDs and order. This includes exact revision-2 CSS snapshots. Edited CSS
and unrelated themes with the same name are preserved. Applying a preset matches
its CSS rather than its name. Theme selection is exclusive in the settings store
and both UI entry points. Old overlapping selections retain the final enabled
theme, matching the old style order, and persist that migration.

The preload mounted its splash at DOMContentLoaded and removed it immediately
after startup. A fast bootstrap could complete before the browser painted it.
The splash now mounts as soon as the document root exists, keeps a minimum
1.1-second visual lifetime without delaying runtime startup, then reveals Discord
through an expanding radial transparency mask. Logo wake/breath/depart animations
share that lifecycle. The 12-second failsafe and Escape/Continue remain available.
Reduced-motion preferences suppress decorative animation. Origin, app-route and
main-frame checks still exclude updater, external pages and subframes.

The launcher uses pointer capture with a movement threshold, suppresses the click
after dragging, and saves fractional travel coordinates. Position is clamped for
resizing and restored after reload. Arrow keys move it (Shift increases the step);
Home or Overview → Reset position restores the default. A normal click plays a
press/rebound animation; settings have entrance and exit transitions.
Right-click opens a hide action. The button rotates, shrinks and fades, then stays
hidden across restarts. The overlay shortcut stays available, and Overview can
restore the button. Reduced motion skips the exit animation.

## Six additional built-ins

All start disabled, use Vestra's lifecycle and remove their effects when stopped.
The table lists default bindings. Configure provides copy/zoom modifiers, lens
size and zoom, timestamp options, Focus Mode's action shortcut and panel choices.
Every plugin also supports an optional enable/disable shortcut, excluded from text
entry and Vestra's own controls. The shortcut editor rejects conflicts with other
Vestra bindings.

| Plugin           | Usage                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| ImageZoom        | Hold Alt over a loaded chat image; scroll to zoom; release Alt to dismiss.                            |
| QuickMessageCopy | Alt-click message text; add Shift to copy its Discord permalink.                                      |
| CleanLinkCopy    | Alt-click a chat web link to copy it without common tracking parameters. Normal clicks are unchanged. |
| FullTimestamps   | Full local date and time, including seconds. Virtualized timestamp updates are observed.              |
| CodeBlockCopy    | A copy button on chat code blocks, restored when Discord replaces their content.                      |
| FocusMode        | Ctrl+Alt+F toggles channel/member sidebars. Disable the plugin to restore the layout.                 |

These are independent implementations for the Vestra API. They do not load
Vencord or BetterDiscord code. Message actions do not send, edit or delete messages.
The image lens reuses an already displayed image. Clipboard writes only occur
after the explicit shortcut or button click. No new network service is required.

## Research sources

- [Midnight's current color-token mapping](https://github.com/refact0r/midnight-discord/blob/master/src/colors.css), consulted to confirm modern Discord token names and nested scopes.
- [Discord's public app assets](https://discord.com/app), inspected on 2026-10-20 to confirm custom-background gradient precedence and current component surface rules. Vendor styles were inspected locally and are not bundled into Vestra.
- [Vencord plugin catalog](https://vencord.dev/plugins), consulted for utility categories and interaction ideas.
- [Vencord ImageZoom](https://vencord.dev/plugins/ImageZoom), consulted for the Alt/scroll magnifier concept; no source code was copied.
- [BetterDiscord plugin catalog](https://betterdiscord.app/plugins) and [Hide Channels](https://www.betterdiscord.app/plugins/Hide%20Channels), consulted for daily-use layout utilities.

## Verification and limits

Unit regressions cover exact legacy migration, custom-theme preservation, preset
deduplication, corrupt/tiny-window launcher positions, clean-link parameters,
DM/server permalinks, emoji/code copying, splash lifetime and escape/failsafe cleanup.

The real Electron integration fixture runs the production-minified core inside a
sandboxed, isolated renderer with strict CSP. It checks computed backgrounds on
modern scoped surfaces for all four presets; disabling restores native colors.
It starts all six utilities, exercises their actions against Discord-shaped DOM,
replaces code/time nodes, checks cleanup, and tests actual mouse input for launcher
dragging, click suppression, persistence after a full navigation and click animation.
The fixture stubs its own clipboard so it does not replace the user's clipboard.

This fixture is not a logged-in Discord session. Discord's DOM may change;
FocusMode and chat utilities still need a visual check after restarting the user's
real Stable client. No Discord account data was extracted and no live messages
were sent during these tests. The release remains an alpha, not a guarantee of
compatibility with every third-party theme or plugin.
