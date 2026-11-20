import * as fs from "node:fs";
import * as path from "node:path";
import { getRealFs } from "@vestra/injector";

export type WatchKind = "staged" | "asar-changed";
type Listener = (event: string, filename: string | Buffer | null) => void;
type Watch = (dir: string, listener: Listener) => fs.FSWatcher;

function name(filename: string | Buffer | null): string | null {
  if (filename === null || filename === undefined) return null;
  return typeof filename === "string" ? filename : filename.toString("utf8");
}

/** Discord's updater finishes by renaming `.app-<v>.installing` to `app-<v>`. */
export function classifyRootEvent(
  event: string,
  filename: string | Buffer | null,
): WatchKind | null {
  const entry = name(filename);
  return event === "rename" && entry !== null && /^app-/i.test(entry)
    ? "staged"
    : null;
}

export function classifyResourcesEvent(
  _event: string,
  filename: string | Buffer | null,
): WatchKind | null {
  return name(filename)?.toLowerCase() === "app.asar" ? "asar-changed" : null;
}

function versionResources(root: string): string[] {
  try {
    return getRealFs()
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^app-/i.test(entry.name))
      .map((entry) => path.join(root, entry.name, "resources"))
      .filter((dir) => getRealFs().existsSync(dir));
  } catch {
    return [];
  }
}

/**
 * Non-recursive watchers on each root and each current `app-*\resources`.
 * Any watcher that cannot start or later fails is dropped; the sweep covers it.
 */
export function watchRoots(
  roots: string[],
  onEvent: (root: string, kind: WatchKind) => void,
  watch: Watch = (dir, listener) => fs.watch(dir, listener),
): () => void {
  const watchers: fs.FSWatcher[] = [];
  const open = (
    dir: string,
    root: string,
    classify: (event: string, filename: string | Buffer | null) => WatchKind | null,
  ): void => {
    try {
      const watcher = watch(dir, (event, filename) => {
        const kind = classify(event, filename);
        if (kind) onEvent(root, kind);
      });
      watcher.on("error", () => {
        try {
          watcher.close();
        } catch {
          /* already closed */
        }
      });
      watchers.push(watcher);
    } catch {
      /* the sweep covers folders that cannot be watched */
    }
  };
  for (const root of roots) {
    open(root, root, classifyRootEvent);
    for (const resources of versionResources(root))
      open(resources, root, classifyResourcesEvent);
  }
  return () => {
    for (const watcher of watchers.splice(0)) {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
    }
  };
}
