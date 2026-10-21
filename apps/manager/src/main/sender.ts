export interface ManagerSender {
  senderFrame: { url: string } | null;
  sender: { mainFrame: unknown };
}

export function isManagerSender(
  event: ManagerSender,
  expectedUrl: string,
): boolean {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame)
    return false;
  try {
    const url = new URL(event.senderFrame.url);
    const expected = new URL(expectedUrl);
    if (
      url.protocol !== "file:" ||
      expected.protocol !== "file:" ||
      url.host !== expected.host ||
      url.search !== expected.search
    )
      return false;
    // Chromium and Node can encode the same Windows path differently (for example ~ and %7E).
    const actualPath = path.resolve(fileURLToPath(url));
    const expectedPath = path.resolve(fileURLToPath(expected));
    return process.platform === "win32"
      ? actualPath.toLowerCase() === expectedPath.toLowerCase()
      : actualPath === expectedPath;
  } catch {
    return false;
  }
}
import * as path from "node:path";
import { fileURLToPath } from "node:url";
