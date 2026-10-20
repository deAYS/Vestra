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
  currentInstalledVersion,
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
