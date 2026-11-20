export type SenderRejection =
  | "no-sender"
  | "no-frame"
  | "subframe"
  | "untrusted-url";

/**
 * Returns null when the IPC event comes from the trusted top-level frame,
 * else the rejection reason. Pure and self-contained: it is embedded into the
 * generated main hook with `.toString()`, so it must not reference imports or
 * module scope. Frame identity is deliberately not compared: Electron may hand
 * out a different wrapper object for the same frame.
 */
export function senderRejection(
  event: unknown,
  trustedUrl: (url: string) => boolean,
): SenderRejection | null {
  try {
    const ev = event as any;
    const sender = ev === null || ev === undefined ? undefined : ev.sender;
    if (sender === null || sender === undefined) return "no-sender";
    let frame = ev.senderFrame;
    if (frame === null || frame === undefined) {
      const main = sender.mainFrame;
      if (
        main !== null &&
        main !== undefined &&
        ev.processId === main.processId &&
        ev.frameId === main.routingId
      ) {
        frame = main;
      } else {
        return "no-frame";
      }
    }
    if (frame.parent !== null && frame.parent !== undefined) return "subframe";
    if (!trustedUrl(String(frame.url))) return "untrusted-url";
    return null;
  } catch (_) {
    return "no-frame";
  }
}
