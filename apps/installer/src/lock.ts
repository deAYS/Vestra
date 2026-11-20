import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:net";
import * as os from "node:os";
import * as path from "node:path";

const held = new AsyncLocalStorage<Set<string>>();

/**
 * Serialize archive transactions across processes. Re-entrant within one
 * async call chain so a caller holding the lock may invoke service methods
 * that take it again.
 */
export async function withInstallLock<T>(
  home: string,
  operation: () => Promise<T>,
): Promise<T> {
  const identity = createHash("sha256")
    .update(path.resolve(home).toLowerCase())
    .digest("hex")
    .slice(0, 24);
  const current = held.getStore();
  if (current?.has(identity)) return operation();
  const address =
    process.platform === "win32"
      ? `\\\\.\\pipe\\vestra-install-${identity}`
      : path.join(os.tmpdir(), `vestra-install-${identity}.sock`);
  const server = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(address, resolve);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
      throw new Error(
        "Another installation operation is running. Try again shortly.",
      );
    throw error;
  }
  // Windows releases the named pipe even after a crash or power loss; no stale PID files.
  try {
    return await held.run(new Set([...(current ?? []), identity]), operation);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
