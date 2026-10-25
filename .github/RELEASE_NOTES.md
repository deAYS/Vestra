Vestra v0.1.0-alpha.5 fixes installer recovery and compact timestamps.

### Fixes

- Uninstall removes Vestra when its receipt is missing or corrupt. Manager reports the remaining installation as needing repair instead of showing it as absent.
- Install and Repair can retry after a failed receipt write. They preserve newer native Discord archives when clearing stale backup files.
- Repair restores an unreadable Discord archive from its native backup. Missing, unreadable or truncated backups produce an error instead of a false success or a damaged restore.
- Compact message timestamps follow the 12-hour clock setting, including changes made while Discord is open.

### Install or upgrade

Download the Windows x64 Setup or Portable executable below. In Manager, choose Repair to update an existing Discord installation. Manager closes and reopens the selected Discord channel.

The Plugin SDK tarball remains at version 0.1.2. Windows builds are unsigned alpha releases. Download checksums are in SHA256SUMS.txt.
