import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { Settings } from "./api/settings.js";
import { FullTimestamps } from "./plugins/utilities.js";

test("compact timestamps follow the live clock preference, reused dates and plugin cleanup", async () => {
  const win = new Window({ url: "https://discord.com/channels/1/2" });
  const keys = ["window", "document", "Element", "MutationObserver"] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? win : win[key] });
  const oldClock = Settings.getPluginSetting("FullTimestamps", "twelveHour");
  const oldSeconds = Settings.getPluginSetting("FullTimestamps", "seconds");
  win.document.body.innerHTML = '<li id="chat-messages-2-3"><h2><time datetime="2026-10-26T15:04:05">header</time></h2><time datetime="2026-10-26T15:04:05" title="Original">15:04</time></li>';
  const time = win.document.querySelector("li > time")!;
  const header = win.document.querySelector("h2 time")!;
  // Use the platform's locale while pinning the date and requested clock independently.
  const clock = (iso: string, hourCycle: "h12" | "h23") => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle }).format(new Date(iso));
  try {
    Settings.setPluginSetting("FullTimestamps", "twelveHour", true);
    Settings.setPluginSetting("FullTimestamps", "seconds", true);
    await FullTimestamps.start?.();
    assert.equal(time.getAttribute("data-vestra-time-compact"), clock("2026-10-26T15:04:05", "h12"));
    assert.equal(header.hasAttribute("data-vestra-time-compact"), false);
    Settings.setPluginSetting("FullTimestamps", "twelveHour", false);
    assert.equal(time.getAttribute("data-vestra-time-compact"), clock("2026-10-26T15:04:05", "h23"));
    Settings.setPluginSetting("FullTimestamps", "twelveHour", true);
    time.setAttribute("datetime", "2026-10-26T00:09:10");
    await win.happyDOM.waitUntilComplete();
    assert.equal(time.getAttribute("data-vestra-time-compact"), clock("2026-10-26T00:09:10", "h12"));
    await FullTimestamps.stop?.();
    assert.equal(time.hasAttribute("data-vestra-time-compact"), false);
    assert.equal(time.hasAttribute("data-vestra-time"), false);
    assert.equal(time.getAttribute("title"), "Original");
  } finally {
    await FullTimestamps.stop?.();
    Settings.setPluginSetting("FullTimestamps", "twelveHour", oldClock);
    Settings.setPluginSetting("FullTimestamps", "seconds", oldSeconds);
    keys.forEach((key, i) => {
      const descriptor = descriptors[i];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
    await win.happyDOM.close();
  }
});
