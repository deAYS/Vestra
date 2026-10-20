Vestra for Windows — an early alpha with its own plugin API and theme library.

### In this release

- Windows Manager with backup, installation, check, repair and uninstall.
- Install and Repair close, replace, verify and relaunch the selected Discord.
- Repair reinstalls even healthy installations.
- Optional Windows sign-in recovery follows Discord updates into new version folders.
- Theme CSS recovers after native stylesheet changes and removed style elements.
- Desktop themes, shortcuts and plugin preferences persist in channel-specific files with atomic writes and backup recovery.
- Theme selection waits for disk confirmation; storage failures are visible and retryable.
- Midnight, Graphite, Rose and Aurora themes with modern Discord surface colors.
- Nine built-in plugins, including image zoom, message/code copying and focus mode.
- A movable settings button with saved position and keyboard access.
- Per-plugin settings and configurable shortcuts, with conflict checks.
- Local plugin/theme folders, CSS import/export and manual file refresh.
- A CSS editor with highlighting, completion, search and automatic scrolling.
- Exclusive theme selection and replacement of native background layers.
- Right-click launcher hiding with a rotating exit and a restore control.
- Animated startup with a center-out reveal and reduced-motion support.
- A standalone typed SDK, shipped as a separate tarball.

### Install

Choose the x64 **Setup** or **Portable** executable. Select your Discord
installation in the Manager and install Vestra. Discord closes and reopens
automatically; active calls and streams disconnect. Open settings with the
floating button or Ctrl+Shift+V. Keep Vestra installed enables a local Windows
sign-in recovery process; turn it off in the Manager if you prefer manual repair.

These builds are unsigned. Discord updates can require Repair or a compatibility
update. The bundled utilities use Vestra's API; BetterDiscord/Vencord plugins do
not run unchanged. The SDK tarball is not an npm publication.

SHA-256 checksums are attached in `SHA256SUMS.txt`.
