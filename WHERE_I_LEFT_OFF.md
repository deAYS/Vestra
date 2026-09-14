# Where I Left Off — Vestra

Last updated: 2026-09-04. Dev repo: `C:\Users\uzu\Documents\GitHub\Vestra`
(Read the full build spec in `vestra_project_spec.json` next to this file.)

## Locked decisions
- Work happens in the `Vestra` repo (dev state). The installed product will live under
  `%AppData%` later (Phase 11 installer) — don't hardcode install paths now.
- Runtime: **Bun + Zod** (Bun 1.4.0 installed at `C:\Users\uzu\.bun\bin\bun.exe`).
- Work phase-by-phase, **stop after every phase**, wait for "go N".
- Settings UI scope: **full spec UI** (Phase 5).

## Done
- [x] **Phase 0 — Toolchain + monorepo scaffold.** Bun workspaces (`apps/*`, `packages/*`,
  `plugins/*`), strict `tsconfig`, `packages/shared` (branding/colors/storage key),
  placeholder tree for core/api/ui/webpack/injector/installer/plugins/themes.
  Verified: `bun install`, `bunx tsc --noEmit` = 0.
- [x] **Phase 1 — Core Bootstrap** (roadmap #1). `packages/core/src/api/logger.ts`
  (`Logger`, `createLogger`, `captureError`), `packages/core/src/index.ts`
  (`Vestra.start()`/`stop()`, banner, `globalThis.Vestra`, idempotent).
  Verified: flags, double-start warn, scoped logging, IIFE bundle executes `start()`.
- [x] **Phase 2 — Plugin Manager** (roadmap #2 = spec `first_prompt`).
  `packages/core/src/api/plugins.ts` (`definePlugin`, Zod schema),
  `packages/core/src/pluginManager.ts` (register/duplicate-reject/enable/disable,
  async + isolated failures, enabled-state persistence under `vestra-settings`,
  `shutdown` keeps toggles), runtime `Plugins` wired (start boots persisted,
  stop suspends). Verified: 12/12 + 5/5 checks, `tsc` 0, bundle rebuild OK (139.5kb).
- [x] **Phase 3 — Settings Persist** (roadmap #3).
  `packages/core/src/api/settings.ts` (`SettingsStore`, `Settings` singleton,
  `createSettingsStore`, Zod schemas, `localStorage` + memory fallback,
  `customCss: { enabled, css }` with legacy `boolean`/`string` auto-migration,
  per-plugin get/set, `subscribe` with isolated listeners, corrupt-JSON reset +
  partial-salvage policy that never blocks startup).
  `pluginManager.ts` migrated via `createSettingsEnabledStateStorage()` (public
  `EnabledStateStorage` API unchanged, legacy `createDefaultEnabledStateStorage`
  kept); runtime `index.ts` loads `Settings` before plugin boot, exposes
  `Vestra.Settings`, saves on stop; `api/index.ts` re-exports Settings.
  Verified: `tsc` 0, bundle 149.1kb, 18/18 functional checks (persist, legacy
  migrate, corrupt reset, salvage, subscribe/unsub, adapter preserves
  settings+css, broken-plugin isolation), start/stop global wiring OK.
- [x] **Phase 4 — Styles + QuickCSS** (roadmap #4).
  `packages/core/src/api/styles.ts` (`StylesManager`, `Styles` singleton,
  `createStylesManager`, one `<style data-vestra-style="<id>">` per id,
  create-or-update `inject`, idempotent `remove`, `has`/`get`/`list`/`clear`;
  DOM-degraded memory tracking for Bun/Node, DOM failures captured via Logger,
  validation throws). `packages/core/src/quickCss.ts` (`QUICKCSS_STYLE_ID`,
  `applyQuickCssState`, `startQuickCss` subscribing to Settings with change
  dedup, stop unsubscribes + removes). Runtime `index.ts` starts QuickCSS sync
  after plugin boot, stops it on shutdown, exposes `Vestra.Styles`;
  `api/index.ts` re-exports Styles + QuickCSS helpers. `plugins/quick-css`
  upgraded to a real `definePlugin` (one-shot apply on start, remove on stop;
  live sync owned by core service).
  Verified: `tsc` 0, bundle 155.7kb, 23/23 style checks (single-element update,
  remove/double-remove, empty-removes, clear, no-DOM tracking, validation
  throws, DOM-failure isolation, QuickCSS on/off/blank, live sync, stop
  unsubscribes + idempotent), boot-apply/live-update/stop-remove via runtime,
  plugin register/enable/disable clean.
- [x] **Phase 5 — Settings UI (full)** (roadmap #5).
  `packages/core/src/ui/` (12 modules): `VestraSettingsPanel` tab shell (5 spec
  pages), `PluginsPage` (search, enable/disable, description + authors, counts),
  `PluginCard` (async toggle, `lastError` inline, expandable per-plugin settings
  editor with bool/string/number rows + add/delete), `QuickCssPage` (enabled
  toggle + live textarea writing `Settings.customCss`), `ThemesPage` (honest
  empty state — ThemeManager is 0.1.0), `AboutPage` (branding/version/storage),
  `SettingsHomePage` (overview + two-step reset), `VestraErrorBoundary`
  (per-card + per-page, Retry, logs via Logger), `mountVestraSettings` /
  `unmountVestraSettings` (react-dom/client, never throw), runtime `Vestra.UI`.
  Component renamed `VestraSettingsPanel` to avoid colliding with the Phase 3
  `VestraSettings` data type (kept stable).
  Verified: `tsc` 0, bundle 1.2mb (react-dom; split later), 17/17 SSR checks
  (nav, branding, plugin meta, counts, inline errors, QuickCSS live label,
  themes stub, about, boundary, search, toggle reflection, settings data path,
  home), mount guards return no-ops without a DOM.
- [x] **Phase 6 — Webpack Module Finder** (roadmap #6).
  `packages/core/src/webpack/` (6 modules): `filters` (byProps/byDisplayName/
  byStoreName/byCode/all/any/isFluxStoreLike — pure, miss-never-crash),
  `raw` (only module touching bundle globals: require discovery via stash scan
  + `webpackChunk*` scan, cache read, exports enumeration incl. `.default`;
  undefined outside Discord), `finder` (`WebpackFinder`: find/findAll/findByProps/
  findByDisplayName/findStore/asFluxStore/waitFor/isAvailable/getModuleCount/
  clearCache; success-only WeakMap cache, misses never cached for lazy
  discovery), `waitFor` (polling, timeout/abort resolve undefined), runtime
  `Vestra.Webpack` + `api/index` re-exports. Functions and objects both count
  as matchable exports (requires are functions; components export bare fns).
  `find` returns module exports (`result.default ?? result` for components).
  Verified: `tsc` 0, bundle 1.2mb, 28/28 checks (all find variants, default
  interop, cache-survives-removal + clearCache-rescan, lazy-appear, findAll
  limit, throwing source/filter isolation, waitFor found/timeout/abort, raw
  undefined outside Discord, runtime wiring). Fixed real bug found by tests:
  function-type requires/modules were skipped by record checks.
- [x] **Phase 7 — Patcher** (roadmap #7).
  `packages/core/src/api/patcher.ts` (`Patcher` class + `patcher` singleton +
  `createPatcher`; `before` (mutate args) / `after` (non-undefined replaces) /
  `instead` (composable `callOriginal` chain); every call needs a non-empty
  owner namespace and returns an idempotent, never-throwing `unpatch`;
  `unpatchAll(owner?)` returns removals; original restored byte-for-byte when
  the last hook leaves; targets tracked in a pruned Set since WeakMap is not
  iterable). Failure isolation: throwing before still calls through, throwing
  after keeps prior result, throwing instead falls back down the chain, an
  original that throws propagates after logging. `PluginManager` takes an
  optional `Patcher` (3rd ctor arg, defaults to shared) and auto-removes the
  owner's patches on `disable`/`shutdown`; runtime `Vestra.Patcher` + `api`
  re-exports.
  Verified: `tsc` 0, bundle 1.2mb, 22/22 checks (arg mutation, after
  replace/keep, instead chain order + skip, throw isolation + fallback,
  scoped unpatchAll, 6 validation throws, this-preservation, disable/shutdown
  auto-cleanup with identity restore, runtime wiring).
- [x] **Phase 8 — Discord Component APIs** (roadmap #8).
  `packages/core/src/discord/` (3 modules): `types` (narrow facades —
  `UserStore`, `ChannelStore`, `GuildStore`, `SelectedChannel`, `Dispatcher`,
  `DiscordReact` — optional fields beyond `id` since shapes drift), `wrappers`
  (`defineWrapper` lazy/cached/resettable + six `createX` factories resolving
  via `WebpackFinder` with conservative prop filters + structural validation),
  `index` (`Discord` aggregate + `resetAll`). Every facade method degrades to
  fallbacks via Logger; raw access stays in `webpack/`. Runtime
  `Vestra.Discord` + `api` re-exports.
  Verified: `tsc` 0, bundle 1.3mb, 20/20 checks (delegation + shaping for all
  six, subscribe/dispatch/unsubscribe, missing/malformed → undefined, throwing
  raw → fallback, lazy-miss + reset-resolve, validation, runtime wiring with
  graceful undefined outside Discord). Fixed real bug found by tests: raw
  methods were called unbound, breaking `this`-dependent store methods —
  `method()` now binds to the owning module.
- [x] **Phase 9 — Native Bridge** (roadmap #9).
  `packages/core/src/api/native.ts` (`NativeBridge` + `Native` singleton +
  `createNativeBridge`; 8-channel `NATIVE_CHANNELS` allowlist — settings
  file r/w, shell open/reveal, app version/path, updater check/install).
  Explicit `connect(transport)` only — no ambient global detection, so a
  planted global grants nothing (verified). Two-layer gating: static allowlist
  × dynamic host capabilities; typed errors (`NativeUnavailableError`,
  `NativeDeniedError` with codes; value misuse is TypeError). Args must be
  serializable (functions/symbols/bigints/circular rejected). Helpers degrade
  gracefully on shape drift (undefined / `{available:false}`); transport
  failures log + propagate. Runtime `Vestra.Native` + `api` re-exports.
  Phase 10 contract: injector preload calls `Native.connect({ invoke,
  capabilities })`.
  Verified: `tsc` 0, bundle 1.3mb, 24/24 checks (closed-by-default, connect
  validation, file round-trip, non-listed denial + caps filtering, grant
  gating, arg/value validation, malformed-shape fallbacks, propagation, no
  ambient trust, runtime wiring). Fixed real bug found by tests: circular
  args recursed forever — walker now tracks visited objects.

- [x] **Phase 10 — Injector** (roadmap #10). `packages/injector/` (7 modules).
  `paths` (stable/ptb/canary discovery: win versioned, mac bundles, linux
  unversioned; env/platform-injectable, never throws). `preload`
  (`buildPreloadSource`: contextBridge `window.VestraNative` + own channel
  check + inline loader injection + bundle file URL). `mainHook`
  (`buildMainHookSource`: ipc handlers for all 8 channels with validated
  implementations — settings file under userData, shell guards, app path
  allowlist, updater stubs — plus BrowserWindow preload chaining; never breaks
  startup). `loader` (`buildLoaderSource`: script-tag bundle load, explicit
  `Native.connect(transport)`, `Vestra.start()`, timeouts). `asar` driver
  (pack/unpack/read with cache invalidation). `patch` (plan/apply/uninject/
  isInjected: backup → payload → hook-prepend → repack; restore on failure;
  receipt + backup detection without unpacking). Protocol constants moved to
  `@vestra/shared` (`VESTRA_NATIVE_CHANNELS`, `VESTRA_IPC_PREFIX`); core
  `NATIVE_CHANNELS` re-exports it. New deps: `@electron/asar`, `@types/node`.
  Verified: `tsc` 0, core 1.3mb + injector 230.5kb bundles, 23/23 checks
  (parity, discovery ×3, builder content + `node:vm` syntax ×3 + validation,
  asar round-trip, full inject cycle incl. hook/payload presence,
  double-inject/uninject refusal, byte-identical restore). Fixed real bug
  found by tests: @electron/asar caches filesystems by path, so same-process
  reads after repack returned STALE contents — driver now busts the cache on
  every op (initially misdiagnosed as a pack-overwrite bug).

- [x] **Phase 11 — Installer** (roadmap #11). `apps/installer/` (6 modules).
  `home` (%AppData%/Vestra, injectable), `payload` (versioned staged dir +
  sha256 manifest + verify; payload is install-independent via `<hookdir>`
  preload path — required a small additive Phase 10 change), `registry`
  (atomic installs.json, corrupt-tolerant), `operations` (install/uninstall/
  repair/status: per-install results, successes recorded only, stale-hook
  recovery via `resetToBackup`, deep health via single-file asar reads),
  `cli` (install/uninstall/repair/status/list, --home/--bundle/--channel/
  --root/--force/--purge, exit 0/1/2). Purge deletes home; uninstall keeps it.
  Verified: `tsc` 0, all packages build, 30/30 checks (home ×5, staging +
  tamper + refusal, registry + corrupt, install/record/skip/force, healthy
  status, broken→repaired→skipped, uninstall + registry clear, purge, CLI
  ×5). Fixed real bug found by tests: reinstall over a receipt-less stale
  hook hit the double-hook guard — repair/force now reset to backup first.
  Fixed packaging bug: esbuild CJS broke @electron/asar's
  `createRequire(import.meta.url)` — node builds are ESM (`.mjs`,
  self-contained 226–245kb). Smoke-tested `dist/installer.mjs` loads and
  discovers the REAL local Discord install (untouched).
  NOTE: real Discord stable found at `%LocalAppData%/Discord` — never patched
  it; all tests used fake installs.

- [x] **Phase 12 — Updater** (roadmap #12). `apps/updater/` (4 modules).
  `feed` (fetch + validate + newest-above-current, injectable fetch, bad
  entries skipped), `envelope` (base64 release artifact: envelope hash from
  feed + inner manifest hashes, `buildEnvelope` for releases), `update`
  (check writes `update-status.json` for the main hook; download stages
  verified envelopes; apply re-injects touched installs with per-install
  rollback to the previous payload; prune keeps N unreferenced-safe
  versions), `cli` (check/download/apply/update/prune/status, exit 0/1/2).
  Main hook `updater:check` now serves the status file (best-effort,
  `{available:false}` fallback). Installer gained `installAll stage:false +
  only:[...]` for targeted no-bundle reinstalls (needed by apply/rollback).
  Verified: `tsc` 0, all 5 packages build (updater 251.9kb), 36/36 checks
  (versions, feed ×6, envelope ×4, check/status-file, download ×4, apply +
  registry + asar bytes, phantom + rollback-failure paths, prune, hook
  wiring + syntax, CLI ×5 incl. full update against a local feed server).
  Fixed real bug found by tests: rollback re-installed ALL discovered
  installs with the old version (clobbering healthy neighbors) — update and
  rollback are now scoped per install. NOTE: no signature scheme on envelopes
  yet (hash-only) — decide before any public feed.
  NOTE: real Discord stable at `%LocalAppData%/Discord` still untouched.

- [x] **Phase 13 — Store** (roadmap #13, FINAL). `apps/store/` (4 modules).
  `feed` (fetch + validate + latest-per-name + search; bad entries skipped),
  `envelope` (base64 plugin artifact: feed-pinned hash + inner manifest
  hashes, `index.js` entry required, name/path sanitized), `store`
  (trusted `repos.json`, browse/search, install DISABLED-by-default,
  update with old-version retention, remove, enabled-flag registry,
  presence-aware list, prune), `cli` (12 commands, exit 0/1/2). Trust model:
  feeds trusted by explicit `repo-add` (fetch-validated first); artifacts
  hash-pinned per entry — no asymmetric signing yet (same open decision as
  updater envelopes). Preload builder gained opt-out `storePlugins`
  injection (default on): registry-gated, sanitized, per-entry isolated
  inline injection of enabled `{home}/plugins/<name>/<version>/index.js`.
  Entry convention (`register` + `enable` via `Vestra.Plugins`) verified
  against the REAL PluginManager. No core changes needed.
  Verified: `tsc` 0, all 6 packages build (store 191.4kb), 40/40 checks
  (feed ×4, envelope ×6, repos ×4, install/enable/disable ×8, update ×4,
  remove ×2, preload ×3, entry convention ×2, CLI ×7 incl. local feed
  server end-to-end). NOTE: real Discord stable at `%LocalAppData%/Discord`
  still untouched — all 13 phases verified against fakes/mocks.

## Roadmap complete — all 13 phases done
Next horizons (not phases; pick when ready): asymmetric signing for
updater/store envelopes; UI code-split (`dist/vestra-ui.js`); renderer
Settings-UI surface for store browse/enable; ThemeManager builtin.

## Live test log (real Discord Canary 1.0.1156, 2026-09-04)
- Canary silent install left updater DB without host state → fatal
  "install host currently running" on every launch. Fixed by transplanting
  the host-state record into the root installer.db (backed up first),
  mirroring healthy Stable. Canary runs since.
- INCIDENT: pre-fix Phase 12 dev runs patched REAL Stable (test payload
  `/* bundle FOUR */`, harmless comment-only bundle) via unscoped batch over
  merged discovery. Found via `status`, restored with `uninstall` (backup +
  receipt verified, both gone after). Stable pristine since.
- Fixed real bug from the above: `uninstallAll --channel X` dropped registry
  records outside the filter ("forgotten"). Channel filter now applies to
  registry records too (verified: canary record survives stable-scoped run).
- Vestra installed into Canary only (`install --channel canary`): status
  healthy, restarted clean (6 procs, updater complete, renderer routing).
  Stable: not injected, untouched.
- LIVE DEBUGGING (renderer_js.log is the observability channel):
  1. `bundle load failed: vestra.js` — root causes: (a) context isolation
     hides the preload's `window` globals from page scripts, so the loader
     never saw the bundle URL; (b) Chromium blocks `file://` script sources
     on app pages anyway. Fixed: preload exposes `bundleUrl` via
     contextBridge AND injects the 1.3mb bundle inline; loader prefers the
     bridged URL. New `bundleInline` builder option (default true).
  2. `Vestra.Native missing from bundle` — the IIFE global is the module
     NAMESPACE, not the runtime singleton (which lives at `.Vestra` /
     `.default`; `start()` later swaps the global via exposeGlobal). Fixed:
     loader normalizes with `runtimeOf()` helper + reason logging in
     `connectNative`.
  - Proof of life in log: `Native bridge connected (8 capabilities)`,
    banner, `Vestra runtime started`. Full chain works in real Discord.
- UX PASS (user asked for visible Vestra: toasts, keybind overlay, splash).
  `core/src/api/toasts.ts` (ToastManager: types, durations, cap 4,
  headless-safe) + `ui/Toasts.tsx` (glass cards, slide-in, progress bar
  with true hover-pause, per-type accents, CSS via Styles API) + "Vestra
  loaded" toast on boot. `ui/keybind.ts` (format/parse/match/require-
  modifier) + `ui/Overlay.tsx` (controller, mount, shortcuts, panel shell
  reusing VestraSettingsPanel, keybind recorder card in Settings home;
  combo stored under Settings "Vestra" core entry; default Ctrl+Shift+V;
  `Vestra.UI.open/close/toggleSettings`). Preload splash (default on):
  observer-inserted at document-start, 0-100 driven by loader milestones,
  logo pulse + shimmer bar, auto-complete on window load, 25s failsafe.
  Loader normalizes the IIFE namespace → runtime singleton.
  Verified: tsc 0, 31/31 checks, all builds, Canary boots patched with new
  payload (native connected, runtime started). Windows gotcha (again):
  `overlay.ts` + `Overlay.tsx` cannot coexist (case-insensitive FS) —
  merged into `Overlay.tsx`; imports use `./Overlay.js`.
  NOTE: `Vestra is not defined` in the user's console was a DevTools frame
  issue (console attached to a non-main frame) — runtime proven live in
  logs 3×. User to select the "top" frame.
- UX FIX ROUND (splash stuck at 6%, no toast, keybind seemingly dead):
  one missed boot explained all three — logs showed the splash insert
  (preload ran) but zero loader lines, so nothing started. Hardened:
  1. Splash progress bridged via contextBridge (`__VESTRA_SPLASH__`
     set/done proxied; loader prefers bridge, falls back to the isolated
     global). Same isolation class of bug as the bundle URL.
  2. Redundant injection: `ensureVestraInjected()` on DOMContentLoaded +
     load + capped 1.5s retries (id-guarded), plus a one-time
     `preload active (<reason>)` log line as proof-of-preload.
  Boot toast bumped 4s → 8s (was expiring behind the splash). Verified
  live: `preload active (domcontentloaded)` → connected → started.
  NOTE: a second `preload active` ~2s later (sub-frame) is expected and
  guarded; per-frame duplicate runtimes remain a known non-issue.
- SPLASH STUCK-AT-6% ROOT CAUSE (proven via timestamps: splash inserted but
  zero loader lines that boot): loader milestones fired within ~20ms while
  the splash element was still observer-deferred → all `set()` calls hit
  the missing-element guard. Fixed: (1) stash-and-apply (pre-insert
  milestones applied on insert; late `done()` suppresses insert),
  (2) preload heartbeat easing toward 85% so the bar never looks dead,
  (3) top-frame-only splash, (4) loader logs when no splash bridge
  resolves. Headless proof: new splash harness executes the generated IIFE
  in a fake DOM — 8/8 (deferred-insert stash, done-suppression, heartbeat
  advance + cap, finish-remove, iframe skip). Deployed to Canary, clean
  boot verified in logs.

## Resume notes for a new session
1. `cd C:\Users\uzu\Documents\GitHub\Vestra`
2. Ensure Bun on PATH: `$env:PATH = "C:\Users\uzu\.bun\bin;" + $env:PATH`
3. Sanity: `bunx tsc --noEmit` (expect exit 0), `bun install` if deps changed.
4. Roadmap: COMPLETE (Phases 0–13). See "Roadmap complete" above for horizons.
5. Known follow-up (non-blocking): main IIFE bundle grew 155.7kb → 1.3mb after
   bundling react-dom for the settings UI. Consider code-splitting the UI
   (`dist/vestra-ui.js`, lazy `import()`) before the installable alpha (0.1.0).
6. Nothing is committed after Phase 0 — commit when the user asks.
