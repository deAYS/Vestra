Vestra v0.1.0-alpha.7 makes glass themes cheaper to draw and keeps one plugin or setting from breaking Vestra.

### Performance

- Glass themes blur the wallpaper once and reuse it as the panel background. Panels no longer re-blur on every scroll frame. Small pop-ups and menus keep live blur.
- If the wallpaper can't be read or a panel sits inside a transformed container, glass falls back to one blurred background layer.
- Settings are saved once after changes stop, and once more when Discord closes.
- Theme styles are rebuilt only when theme settings change.
- Lookups into Discord's modules are cached. Missing modules are retried with back-off instead of on every access.

### Fixes

- Vestra's own button and panel load before plugins. A plugin that hangs while starting is stopped waiting after 15 seconds; it stays enabled and is retried next launch.
- Turning a plugin on or off while plugins are still starting is no longer undone.
- One out-of-range theme option resets only that option instead of dropping the theme.
- A theme whose file was deleted can be removed from the library.
- Patching class components no longer breaks them.
- The recovery failure notification opens the installed Manager.

### Plugin SDK

- Plugin settings must be JSON data. Other values throw a `TypeError`.
- `waitFor` wakes when Discord registers modules; `intervalMs` no longer changes timing.
- A local or store plugin that uses a built-in plugin's name is skipped.

### Install or upgrade

Download the Windows x64 Setup or Portable executable below. Open Manager once after upgrading, then choose Repair on each Discord that uses Vestra. Manager closes and reopens the selected Discord channel. Liquid Glass upgrades to 2.3.0 and keeps your customization.

The Plugin SDK tarball remains at version 0.1.2. Windows builds are unsigned alpha releases. Download checksums are in SHA256SUMS.txt.
