Vestra v0.1.0-alpha.6 keeps Vestra running after Discord updates and rebuilds the Manager screen.

### Fixes

- Vestra no longer rejects Discord's own window at start-up. On some launches this silently stopped Vestra from loading even though it was installed.
- Each launch now records whether Vestra started. Start-up retries before giving up.
- Archive writes and restores are atomic, so an interrupted write cannot leave Discord unable to start. A Discord archive replaced outside Vestra is reported as needing repair.
- Repair without a channel only touches Discord installations that already use Vestra. Uninstall works after Discord updates, and purge only runs after every uninstall succeeded.
- Update handoff works with typographic apostrophes in folder names. Manager calls Windows tools by their full system path, and update errors stay visible until dismissed.
- Pages in Discord can only open Vestra's own folders through the plugin API.

### Keep Vestra installed

- Vestra is added to a new Discord version as soon as Discord's updater finishes downloading it, while the old version keeps running.
- Recovery never closes Discord on its own. If Discord has already started an unpatched version, Vestra waits for it to close and offers Restart Discord.
- The 15-second background polling is gone. Retries are capped, and failures are shown in Manager and in a notification.
- Discord's quick updates still fall back to a full download while Vestra is installed. Recovery then patches the new version before it starts.

### Manager

- One row per Discord with a status that says whether Vestra actually started, one main action, and a ⋯ menu for Repair and Uninstall.
- A Check for updates button is always available.
- The window background picker was removed.

### Install or upgrade

Download the Windows x64 Setup or Portable executable below. Open Manager once after upgrading so Keep Vestra installed moves onto the new version, then choose Repair on each Discord that uses Vestra. Manager closes and reopens the selected Discord channel.

The Plugin SDK tarball remains at version 0.1.2. `openPath` now only opens folders inside Vestra's own data folder. Windows builds are unsigned alpha releases. Download checksums are in SHA256SUMS.txt.
