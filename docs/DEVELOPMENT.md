# Development

## Runtime

The Manager selects a Windows Discord installation. The installer preserves its
original `app.asar`, adds a main-process hook, then stages the Vestra payload.
Session preloads bootstrap only trusted Discord app routes in the main frame.
Updater, OAuth, popout and unrelated pages are excluded.

The main process owns file access and validates IPC senders. The sandboxed preload
uses Electron's bridge and explicitly evaluates the renderer bundle in the page
world, without relying on inline script tags or relaxed CSP.

The core loads preferences, registers plugins, reconciles theme styles, starts
enabled plugins and mounts settings. Runtime and per-plugin lifecycle queues keep
concurrent starts, stops and toggles ordered. Failed starts stop partial resources,
remove owned patches and persist the disabled state.

`@vestra/api` proxies the host services. It is a separate package with ESM,
CommonJS, TypeScript declarations and a plugin builder, not another copy of core.
Its API major version is checked before a built plugin registers.

## Checks

`bun test` covers installation/channel selection, file and payload integrity,
version ordering, IPC trust boundaries, plugin races, theme migration, settings
persistence and SDK contracts. Fixtures use disposable directories.

`bun run test:electron` builds the production-minified runtime and runs it in a
sandboxed Electron fixture with context isolation and strict CSP. It checks native
IPC, separately built store and local-folder SDK plugins, CSS file reads/writes,
modern/legacy theme surface colors, native gradient replacement/restoration,
all built-in utility actions and cleanup, shortcut reassignment, startup masking,
launcher input, hide/restore and persistence.
The fixture uses illustrative content and its own clipboard stub. It never signs
in to Discord or patches a real installation.
The suite runs with both full and reduced motion, independently of the host's
Windows accessibility preferences.

The addon IPC endpoints only select fixed `plugins` and `themes` directories below
the product home. File reads are bounded, symlink entries are ignored, and imports
use exclusive creation. Theme removal uses the system Trash. Local plugin builds
execute in the Discord renderer; loading one is a trust decision by the user.

The fixture does not establish compatibility with every future Discord build.
After a compatibility change, check the real target channel separately. Keep a
usable backup and record the version used for the visual check.

## Local commands

- `bun run preview`: core settings and startup playground on port 4173.
- `bun run dev`: build core and launch the Windows Manager.
- `bun run site:preview`: website on port 4180, including the `/Vestra/` project path.
- `bun run manager:package`: unsigned Setup and Portable builds under `apps/manager/release`.

`VESTRA_PREVIEW_PORT` and `VESTRA_SITE_PORT` can select alternate local ports.
Build products, dependencies and local test output are ignored by Git.
