export interface ManagerSender {
  senderFrame: { url: string } | null;
  sender: { mainFrame: unknown };
}

export function isManagerSender(event: ManagerSender, expectedUrl: string): boolean {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    url.hash = "";
    return url.href === expectedUrl;
  } catch { return false; }
}
