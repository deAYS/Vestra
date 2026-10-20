import { definePlugin } from "../api/plugins.js";
import { Styles } from "../api/styles.js";
import { Toasts } from "../api/toasts.js";

const messageSelector =
  '[id^="chat-messages-"],[data-list-item-id^="chat-messages"]';
const contentSelector = '[id^="message-content-"]';
const excluded = '#vestra-overlay-root,input,textarea,[contenteditable="true"]';

async function copy(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    Toasts.success(label, undefined, 1800);
  } catch {
    Toasts.error(
      "Clipboard unavailable",
      "Discord did not allow clipboard access. Try again with the app focused.",
    );
  }
}

export function cleanLink(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new TypeError("Only web links can be cleaned.");
  // Keep all functional parameters, fragments and signatures. Only known analytics keys.
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid)$/i.test(key))
      url.searchParams.delete(key);
  }
  return url.href;
}

export function messageLink(
  element: Element,
  pathname: string,
): string | undefined {
  const message = element.closest(messageSelector);
  const id = (
    message?.id ||
    message?.getAttribute("data-list-item-id") ||
    ""
  ).match(/(?:chat-messages[-_]+)(\d+)-(\d+)$/);
  const route = pathname.match(/^\/channels\/(\d+|@me)\/(\d+)/);
  if (!id || !route || id[1] !== route[2]) return undefined;
  return `https://discord.com/channels/${route[1]}/${id[1]}/${id[2]}`;
}

export function messageText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone
    .querySelectorAll("button,[data-vestra-code-copy]")
    .forEach((node) => node.remove());
  clone
    .querySelectorAll("img[alt]")
    .forEach((node) => node.replaceWith(node.getAttribute("alt") ?? ""));
  clone.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  clone.querySelectorAll("pre,p,div,li").forEach((node) => {
    node.prepend("\n");
    node.append("\n");
  });
  return (clone.textContent ?? "").trim();
}

function eventPlugin(
  name: string,
  description: string,
  activate: () => () => void,
) {
  let cleanup: (() => void) | undefined;
  return definePlugin({
    name,
    description,
    authors: ["Vestra"],
    start() {
      cleanup?.();
      if (typeof document !== "undefined") cleanup = activate();
    },
    stop() {
      cleanup?.();
      cleanup = undefined;
    },
  });
}

export const QuickMessageCopy = eventPlugin(
  "QuickMessageCopy",
  "Alt + click message text to copy it. Alt + Shift + click copies its Discord message link.",
  () => {
    const click = (event: MouseEvent): void => {
      const target = event.target;
      if (
        !event.altKey ||
        event.button !== 0 ||
        !(target instanceof Element) ||
        target.closest(excluded) ||
        target.closest("a,button")
      )
        return;
      const content = target.closest(contentSelector);
      if (!content) return;
      const text = event.shiftKey
        ? messageLink(content, location.pathname)
        : messageText(content);
      if (!text) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void copy(
        text,
        event.shiftKey ? "Message link copied" : "Message copied",
      );
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  },
);

export const CleanLinkCopy = eventPlugin(
  "CleanLinkCopy",
  "Alt + click a web link in chat to copy it without common tracking parameters. Regular clicks stay unchanged.",
  () => {
    const click = (event: MouseEvent): void => {
      const target = event.target;
      if (
        !event.altKey ||
        event.shiftKey ||
        event.button !== 0 ||
        !(target instanceof Element) ||
        target.closest(excluded)
      )
        return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor?.closest(messageSelector)) return;
      let url: string;
      try {
        url = cleanLink(anchor.href);
      } catch {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      void copy(url, "Clean link copied");
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  },
);

/** Enhance mounted nodes, handle Discord virtualization and restore only our changes. */
function enhance(
  selector: string,
  decorate: (element: HTMLElement) => () => void,
  valid = (_element: HTMLElement): boolean => true,
): () => void {
  const owned = new Map<HTMLElement, () => void>();
  let frame: ReturnType<typeof setTimeout> | undefined,
    stopped = false;
  const refresh = (): void => {
    frame = undefined;
    if (stopped) return;
    for (const [element, cleanup] of owned)
      if (
        !element.isConnected ||
        !element.matches(selector) ||
        !valid(element)
      ) {
        cleanup();
        owned.delete(element);
      }
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (!owned.has(element)) owned.set(element, decorate(element));
    });
  };
  const observer = new MutationObserver(() => {
    if (frame === undefined) frame = setTimeout(refresh, 32);
  });
  refresh();
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["datetime"],
  });
  return () => {
    stopped = true;
    observer.disconnect();
    if (frame !== undefined) clearTimeout(frame);
    for (const cleanup of owned.values()) cleanup();
    owned.clear();
  };
}

export function formatTimestamp(
  iso: string,
  locale?: string,
): string | undefined {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export const FullTimestamps = eventPlugin(
  "FullTimestamps",
  "Show the full local date and time, including seconds, beside chat messages.",
  () => {
    const selector = `${messageSelector
      .split(",")
      .map((part) => `${part} time[datetime]`)
      .join(",")}`;
    const styled = selector
      .split(",")
      .map((part) => `${part}[data-vestra-time]`);
    Styles.inject(
      "plugin-full-timestamps",
      `${styled.join(",")}{font-size:0!important}${styled.map((part) => `${part}>*`).join(",")}{display:none!important}${styled.map((part) => `${part}::after`).join(",")}{content:attr(data-vestra-time);font:11px var(--font-primary,system-ui);color:var(--text-muted);margin-inline:3px}`,
    );
    // Discord can reuse a time node when scrolling. Its datetime is part of identity.
    const cleanup = enhance(selector, (element) => {
      const update = (): void => {
        const text = formatTimestamp(element.getAttribute("datetime") ?? "");
        if (text) element.setAttribute("data-vestra-time", text);
        else element.removeAttribute("data-vestra-time");
      };
      update();
      const observer = new MutationObserver(update);
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["datetime"],
      });
      return () => {
        observer.disconnect();
        element.removeAttribute("data-vestra-time");
      };
    });
    return () => {
      cleanup();
      Styles.remove("plugin-full-timestamps");
    };
  },
);

export const CodeBlockCopy = eventPlugin(
  "CodeBlockCopy",
  "Add a Copy button to code blocks in chat. Copies just the code, without formatting.",
  () => {
    Styles.inject(
      "plugin-code-block-copy",
      `${contentSelector} pre{position:relative}${contentSelector} pre:has([data-vestra-code-copy]){padding-top:34px!important}[data-vestra-code-copy]{position:absolute;right:8px;top:7px;border:1px solid #C5BAF833;background:var(--background-surface-high,#24212b);color:var(--text-normal,#eee);border-radius:6px;padding:3px 9px;font:11px system-ui;cursor:pointer;transition:transform .15s,background .15s}[data-vestra-code-copy]:hover{background:var(--background-surface-higher,#302a3b)}[data-vestra-code-copy]:active{transform:scale(.9)}`,
    );
    const cleanup = enhance(
      `${contentSelector} pre`,
      (element) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Copy";
        button.setAttribute("data-vestra-code-copy", "");
        button.setAttribute("aria-label", "Copy code block");
        const click = (event: MouseEvent): void => {
          event.preventDefault();
          event.stopPropagation();
          void copy(
            element.querySelector("code")?.textContent ?? "",
            "Code copied",
          );
        };
        button.addEventListener("click", click);
        element.appendChild(button);
        return () => {
          button.removeEventListener("click", click);
          button.remove();
        };
      },
      (element) =>
        Boolean(element.querySelector(":scope > [data-vestra-code-copy]")),
    );
    return () => {
      cleanup();
      Styles.remove("plugin-code-block-copy");
    };
  },
);

export const FocusMode = eventPlugin(
  "FocusMode",
  "Ctrl + Alt + F toggles a wider chat by hiding channel and member sidebars. Your last layout is restored when disabled.",
  () => {
    const attr = "data-vestra-focus";
    Styles.inject(
      "plugin-focus-mode",
      `html[${attr}] :is([class*="sidebarList_"],[class*="-sidebarList"],[class*="membersWrap_"],[class*="-membersWrap"]){display:none!important}`,
    );
    const key = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !event.ctrlKey ||
        !event.altKey ||
        event.shiftKey ||
        event.metaKey ||
        event.code !== "KeyF" ||
        event.isComposing
      )
        return;
      event.preventDefault();
      const enabled = document.documentElement.toggleAttribute(attr);
      Toasts.info(
        enabled ? "Focus mode on" : "Focus mode off",
        "Ctrl + Alt + F to toggle",
        1800,
      );
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.documentElement.removeAttribute(attr);
      Styles.remove("plugin-focus-mode");
    };
  },
);

export const ImageZoom = eventPlugin(
  "ImageZoom",
  "Hold Alt over a chat image to reveal a magnifying lens. Scroll while holding Alt to change zoom. Release Alt to dismiss.",
  () => {
    const lens = document.createElement("div");
    lens.setAttribute("data-vestra-image-lens", "");
    lens.setAttribute("aria-hidden", "true");
    Object.assign(lens.style, {
      position: "fixed",
      width: "220px",
      height: "220px",
      borderRadius: "24px",
      border: "2px solid #C5BAF8",
      boxShadow: "0 12px 70px #000b,0 0 24px #C5BAF830",
      pointerEvents: "none",
      zIndex: "2147483643",
      display: "none",
      backgroundRepeat: "no-repeat",
      backgroundColor: "#131217",
    });
    document.body.appendChild(lens);
    let image: HTMLImageElement | undefined,
      x = 0,
      y = 0,
      zoom = 2;
    const hide = (): void => {
      image = undefined;
      lens.style.display = "none";
    };
    const paint = (): void => {
      if (!image?.isConnected) {
        hide();
        return;
      }
      const rect = image.getBoundingClientRect();
      const width = Math.min(220, window.innerWidth - 16),
        height = Math.min(220, window.innerHeight - 16);
      const left = Math.max(
        8,
        Math.min(window.innerWidth - width - 8, x - width / 2),
      );
      const top = Math.max(
        8,
        Math.min(window.innerHeight - height - 8, y - height / 2),
      );
      Object.assign(lens.style, {
        display: "block",
        width: `${width}px`,
        height: `${height}px`,
        left: `${left}px`,
        top: `${top}px`,
        backgroundImage: `url(${JSON.stringify(image.currentSrc || image.src)})`,
        backgroundSize: `${rect.width * zoom}px ${rect.height * zoom}px`,
        backgroundPosition: `${x - left - (x - rect.left) * zoom}px ${y - top - (y - rect.top) * zoom}px`,
      });
    };
    const move = (event: MouseEvent): void => {
      const target = event.target;
      if (
        !event.altKey ||
        !(target instanceof HTMLImageElement) ||
        target.closest(excluded) ||
        !target.closest(`${messageSelector},[role="dialog"]`) ||
        target.classList.contains("emoji")
      ) {
        hide();
        return;
      }
      const rect = target.getBoundingClientRect();
      if (
        !target.complete ||
        !target.naturalWidth ||
        Math.min(rect.width, rect.height) < 48 ||
        Math.max(rect.width, rect.height) < 100
      ) {
        hide();
        return;
      }
      image = target;
      x = event.clientX;
      y = event.clientY;
      paint();
    };
    const wheel = (event: WheelEvent): void => {
      if (!event.altKey || !image || event.deltaY === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      zoom = Math.max(
        1.25,
        Math.min(8, zoom + (event.deltaY < 0 ? 0.25 : -0.25)),
      );
      paint();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Alt" || event.key === "Escape") hide();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("wheel", wheel, {
      passive: false,
      capture: true,
    });
    document.addEventListener("keyup", key);
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("wheel", wheel, true);
      document.removeEventListener("keyup", key);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", hide, true);
      lens.remove();
    };
  },
);

export const UTILITY_PLUGINS = [
  ImageZoom,
  QuickMessageCopy,
  CleanLinkCopy,
  FullTimestamps,
  CodeBlockCopy,
  FocusMode,
];
