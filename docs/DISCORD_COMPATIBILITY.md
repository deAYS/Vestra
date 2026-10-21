# Discord appearance and utilities — 2026-10-20

## Findings

### Glass readability and preview updates — 2026-10-21

Glass now gives Friends, Shop and Quests a separate blurred backing. Default
profiles and settings use denser local surfaces; custom-colored profiles retain
their own styling. Appearance controls expose independent home, popup and settings
opacity alongside optional text color and glow. Role colors remain unchanged;
code and timestamps do not inherit decorative glow.

The appearance iframe keeps a stable scriptless document. Slider updates replace
only its theme stylesheet once per animation frame. Embedded image URLs live in
stable CSS variables so rapid changes do not repeatedly navigate the frame or
reparse the image into its stylesheet. Its sandbox allows same-origin DOM access
for the parent, without allowing scripts; its CSP blocks scripts and external
resource requests.

The Electron fixture sends 144 rapid changes, checks the final slider value,
and verifies unchanged document identity with zero additional loads. It also
checks surface opacity, text/glow application, custom profile preservation and
persistence. These are fixture checks, not a logged-in Discord validation.

### Palette coverage

The 2026-10-21 review also found that applying a backdrop filter to every dialog
changed the containing block of fixed media controls and painted the full-screen
carrier used by floating pickers. Settings surfaces now match settings components
or a dialog with a settings sidebar. Generic media and GIF carriers retain native
positioning and clear backgrounds. The fixture covers these boundaries across all
six presets, with and without custom surface overrides.

Typography-only UI edits preserve authored surfaces. Surface customization derives
its dark tint from each theme's palette. Preset revision 4 refines composer, selected
navigation, home and profile surfaces while retaining the four original palettes.
Afterglow 1.1 and Glass 2.2 use the same scope boundaries. Exact earlier CSS migrates
without replacing user-edited copies or removing appearance preferences.

Manager uses frameless, draggable custom chrome. Window actions and material
changes accept only its bundled main frame. Solid/Mica/Acrylic choices are validated
and stored atomically in the Manager's own user-data folder. Electron's native
backdrop API requires Windows 11 22H2 or later; unsupported or failed effects fall
back to Solid. Integration checks exercise window actions, sender rejection,
material preferences and notification dismissal without touching real installs.

Archive verification now normalizes portable `/` and Windows `\` entry separators
before reading ASAR files. A real Node-on-Windows check reproduced failed nested
reads with portable separators; both forms read the same packaged entries after
normalization. The regression also covers archives with a nested main entry.

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

## Desktop persistence and update recovery

Desktop preferences are stored atomically under `%AppData%\Vestra\settings`,
with separate `stable.json`, `ptb.json` and `canary.json` files and a last-valid
`.bak`. Discord's origin storage is only a migration source, so deleting it does
not reset themes, plugin options or shortcuts. Native storage is connected before
local plugin registration. Browser previews continue to use their own local storage.

Theme reconciliation watches the document head, reattaches removed style elements
and orders the selected theme after native stylesheets, with QuickCSS last. It
also handles a replaced head and disconnects observers when the runtime stops.

Windows Manager Install and Repair stop only processes beneath the selected
installation root, wait for that root's Update.exe to finish, rediscover the
current version, replace all four payload files, verify them and relaunch the
selected Discord executable. Explicit Repair also replaces healthy installations.
An in-place native Discord update becomes the new pristine backup; an older
backup never overwrites an updated native archive during Repair or Uninstall.

Keep Vestra installed registers the named HKCU Run value VestraMaintenance. Its
independent local runtime supports Portable builds after extraction cleanup. It
observes only registered roots on selected channels, waits for unchanged file
metadata across two 15-second observations, defers during updater activity and
checks integrity before repairing. Healthy Discord instances are left running;
a recovered instance restarts. Failed attempts back off five minutes. Foreground
and background writes share an OS-owned named pipe lock on Windows, released
automatically on process exit. Disable removes the startup value; Uninstall
untracks its channel and removes the value after the final tracked channel.

Recovery is an enabled, visible Manager setting rather than a guarantee against
future Discord changes. It does not stop Discord updates or download remote code.
