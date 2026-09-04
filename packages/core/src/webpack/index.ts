// @vestra/core webpack — Module Finder.
// Phase 6 (roadmap #6). Locate Discord's internal modules without hardcoding
// bundle indexes: `find`, `findAll`, `findByProps`, `findByDisplayName`,
// `findStore`, `waitFor`, plus the `filters` predicates. Raw bundle access
// lives in `raw.ts` only; everything else goes through `WebpackFinder`.

export { Webpack, WebpackFinder, createWebpackFinder } from "./finder.js";
export type { FindOptions, WebpackFinderOptions } from "./finder.js";

export { filters } from "./filters.js";

export { getWebpackRequire, defaultRequireSource, enumerateModules } from "./raw.js";

export { waitForModule } from "./waitFor.js";
export type { ModuleSearch } from "./waitFor.js";

export type {
  FluxStoreLike,
  ModuleFilter,
  RequireSource,
  WaitForOptions,
  WebpackExports,
  WebpackRequireLike,
} from "./types.js";
