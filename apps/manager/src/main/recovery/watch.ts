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

/** The folders to watch for one tracked installation. */
export interface WatchTarget {
  rootDir: string;
  appDir: string;
}

/**
 * Non-recursive watchers on each tracked root and on each tracked target's
 * current `app-<v>\resources` only (older version folders are not watched).
 * Any watcher that cannot start or later fails is dropped; the sweep covers it.
 */
export function watchRoots(
  targets: WatchTarget[],
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
  const roots = new Map<string, string>();
  for (const target of targets)
    roots.set(path.resolve(target.rootDir).toLowerCase(), target.rootDir);
  for (const root of roots.values()) open(root, root, classifyRootEvent);
  const resources = new Set<string>();
  for (const target of targets) {
    const dir = path.join(target.appDir, "resources");
    if (resources.has(dir.toLowerCase()) || !getRealFs().existsSync(dir))
      continue;
    resources.add(dir.toLowerCase());
    open(dir, target.rootDir, classifyResourcesEvent);
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
