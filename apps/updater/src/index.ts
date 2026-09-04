// Vestra Updater — Phase 12 (self-update: feed → download → apply).
// Library API plus a minimal CLI. Release artifacts are hash-verified
// envelopes; touched installs are re-injected with rollback per install.

export { fetchFeed, newestAbove, compareVersions } from "./feed.js";
export type { FeedRelease, FetchFn, ReleaseFeed, ResponseLike } from "./feed.js";

export { buildEnvelope, parseEnvelope, writeEnvelopePayload } from "./envelope.js";
export type { UpdateEnvelope } from "./envelope.js";

export {
  checkForUpdates,
  downloadUpdate,
  applyUpdate,
  prunePayloads,
  currentStagedVersion,
  UPDATE_STATUS_FILE,
} from "./update.js";
export type {
  ApplyResult,
  DownloadResult,
  UpdateContext,
  UpdateStatus,
} from "./update.js";

export { runUpdaterCli } from "./cli.js";
export type { UpdaterCliIO } from "./cli.js";
