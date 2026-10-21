Vestra v0.1.0-alpha.4 brings automatic update checks, complete theme sharing and a more readable workspace.

### What's new

- **Updates from GitHub:** Manager and Discord check for newer published releases. Download progress, SHA-256 verification and restart confirmation work with both Setup and Portable. Interrupted updates can be resumed; themes, plugins and preferences are preserved.
- **Theme sharing:** export a `.vestra-theme.json` with CSS, appearance settings and embedded wallpaper. Import it into another library without replacing the active theme. CSS imports still work.
- **Better previews:** switch between Chat, Home, Profile and Settings. Slider updates keep the same preview document loaded, including during rapid dragging.
- **Text and readability:** customize text color, glow and separate opacity for home panels, profiles/menus and settings. Controls stay visible in a larger workspace.
- **Quieter startup:** Vestra waits for the signed-in Discord workspace, stops on logout and restarts on login. Notifications follow the theme, pause on hover/focus and include an optional startup notification.
- **A cohesive Manager:** custom window controls, clearer operation results and optional Windows Mica/Acrylic finishes.
- **Refreshed themes:** six built-in looks, including Afterglow and Liquid Glass, with saved appearance preferences and migration for unedited older presets.

### Fixes

- Server rail spacing now follows corner radius, keeping the Discord Home logo clear of rounded corners, including layouts with an inner scroller.
- Emoji suggestions visibly highlight mouse hover and keyboard selection across built-in and saved custom themes.
- Glass styles leave image viewer placement and full-screen GIF popup containers intact.
- Home pages, profile activity cards and settings have more readable backing surfaces.
- Windows paths containing spaces, apostrophes, non-ASCII characters or short folder names work in the update/Manager flows.

### Install or upgrade

Download the Windows x64 **Setup** or **Portable** executable below. Open Manager and choose **Install Vestra** for a new installation or **Repair** to upgrade an existing one. Discord closes and reopens; active calls and streams disconnect. Open Vestra with its floating button or **Ctrl+Shift+V**.

For older public releases, install this upgrade manually once to get the updater. Preview builds that already include the updater can download this release through Manager. Installation still asks before restarting Discord.

The separate **Plugin SDK 0.1.2** tarball is included for developers; host API compatibility remains **1.0.0**. This is not an npm publication, and BetterDiscord/Vencord plugins do not run unchanged.

**Early alpha:** Windows binaries are unsigned. Discord updates may need Repair or a compatibility update. SHA-256 checksums for the download assets are attached in `SHA256SUMS.txt`.
