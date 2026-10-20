const palettes = {
  midnight: {
    name: "Midnight",
    label: "MIDNIGHT / DEEP NAVY",
    base: "#06080d",
    chat: "#0b101b",
    side: "#090d16",
    raised: "#111a29",
    input: "#141e30",
    accent: "#618df2",
  },
  graphite: {
    name: "Graphite",
    label: "GRAPHITE / NEUTRAL CHARCOAL",
    base: "#101112",
    chat: "#1b1d20",
    side: "#151719",
    raised: "#23262a",
    input: "#26292e",
    accent: "#858f9e",
  },
  rose: {
    name: "Rose",
    label: "ROSE / WARM DUSK",
    base: "#160d14",
    chat: "#241622",
    side: "#1c111b",
    raised: "#30202e",
    input: "#332131",
    accent: "#c985a9",
  },
  aurora: {
    name: "Aurora",
    label: "AURORA / FOREST SHADOWS",
    base: "#081311",
    chat: "#101f1c",
    side: "#0b1916",
    raised: "#1b3029",
    input: "#1b3029",
    accent: "#62bda4",
  },
  afterglow: {
    name: "Afterglow", label: "AFTERGLOW / MOLTEN COPPER",
    base: "#100b0b", chat: "#1d1414", side: "#160e10",
    raised: "#302020", input: "#2b1d1e", accent: "#e6ad83",
  },
  "liquid-glass": {
    name: "Liquid Glass", label: "LIQUID GLASS / PEARL LIGHT",
    base: "#262132", chat: "#ffffff09", side: "#ffffff0c",
    raised: "#ffffff15", input: "#ffffff13", accent: "#ddd2ff",
  },
};
const product = document.querySelector(".product-window");
const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
let productFrame = 0;
let productPoint = null;
function resetProduct() {
  cancelAnimationFrame(productFrame);
  productFrame = 0;
  productPoint = null;
  for (const key of ["--tilt-x", "--tilt-y", "--light-x", "--light-y"]) product?.style.removeProperty(key);
  product?.removeAttribute("data-pointing");
}
product?.addEventListener("pointermove", event => {
  if (motion.matches || event.pointerType !== "mouse") return;
  productPoint = { x: event.clientX, y: event.clientY };
  if (productFrame) return;
  productFrame = requestAnimationFrame(() => {
    productFrame = 0;
    if (!productPoint) return;
    const rect = product.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (productPoint.x - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (productPoint.y - rect.top) / rect.height));
    product.style.setProperty("--tilt-x", `${(0.5 - y) * 5}deg`);
    product.style.setProperty("--tilt-y", `${(x - 0.5) * 7}deg`);
    product.style.setProperty("--light-x", `${x * 100}%`);
    product.style.setProperty("--light-y", `${y * 100}%`);
    product.setAttribute("data-pointing", "true");
  });
});
product?.addEventListener("pointerleave", resetProduct);
product?.addEventListener("pointercancel", resetProduct);
window.addEventListener("blur", resetProduct);
motion.addEventListener("change", resetProduct);
const demo = document.getElementById("client-demo");
document.querySelectorAll("[data-theme]").forEach((button) =>
  button.addEventListener("click", () => {
    const id = button.dataset.theme;
    const palette = palettes[id];
    demo.dataset.palette = id;
    document
      .querySelectorAll("[data-theme]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
    for (const key of ["base", "chat", "side", "raised", "input", "accent"])
      demo.style.setProperty(`--demo-${key}`, palette[key]);
    demo.setAttribute(
      "aria-label",
      `Illustrative ${palette.name} theme preview`,
    );
    document.getElementById("palette-name").textContent = palette.label;
    const download = document.getElementById("theme-download");
    download.href = `themes/${id}.theme.css`;
    download.textContent = `Download ${palette.name} CSS ↓`;
  }),
);

const utilities = {
  zoom: {
    title: "Image Zoom",
    description:
      "Get a closer look at chat images with a floating magnifying lens. Change the zoom without leaving the conversation.",
    shortcut: "Hold Alt over an image. Scroll to zoom. Release Alt to dismiss.",
    index: "01",
  },
  copy: {
    title: "Quick Message Copy",
    description:
      "Grab the words you need, or a link straight back to the conversation. No menu hunting.",
    shortcut: "Alt + click message text. Add Shift to copy its permalink.",
    index: "02",
  },
  code: {
    title: "Code Block Copy",
    description:
      "A small copy button on every chat code block. Just the code, without the formatting.",
    shortcut: "Enable it in Vestra → Plugins.",
    index: "03",
  },
  time: {
    title: "Full Timestamps",
    description:
      "Know exactly when it happened. A full local date and time, down to the second, beside your chat messages.",
    shortcut:
      "Enable it in Vestra → Plugins. Times follow your local timezone.",
    index: "04",
  },
  links: {
    title: "Clean Link Copy",
    description:
      "Copy a chat link without common analytics parameters. The parts that make the link work stay put.",
    shortcut: "Alt + click a web link. Regular clicks work as usual.",
    index: "05",
  },
  focus: {
    title: "Focus Mode",
    description:
      "Let the conversation take the space it needs. Hide channel and member sidebars, then bring them back when you’re ready.",
    shortcut: "Enable it in Plugins, then press Ctrl + Alt + F.",
    index: "06",
  },
};
document.querySelectorAll("[data-plugin]").forEach((button) =>
  button.addEventListener("click", () => {
    const utility = utilities[button.dataset.plugin];
    document
      .querySelectorAll("[data-plugin]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
    document.getElementById("utility-title").textContent = utility.title;
    document.getElementById("utility-description").textContent =
      utility.description;
    document.getElementById("utility-shortcut").textContent = utility.shortcut;
    document.getElementById("utility-index").textContent =
      `${utility.index} / 06`;
    document.querySelector(".utility-example").hidden =
      button.dataset.plugin !== "code";
  }),
);
document.getElementById("copy-demo").addEventListener("click", async () => {
  const status = document.getElementById("copy-status");
  try {
    await navigator.clipboard.writeText(
      'const atmosphere = {\n  palette: "midnight",\n  feeling: "at home"\n};',
    );
    status.textContent = "Copied. Make something yours.";
  } catch {
    status.textContent =
      "Clipboard access is unavailable. You can select the code instead.";
  }
});

document.getElementById("preview-startup").addEventListener("click", () => {
  if (!window.VestraSplash || document.getElementById("vestra-splash")) return;
  const splash = window.VestraSplash.showSplash();
  splash.set(12, "Animation preview…");
  const timers = [
    setTimeout(() => splash.set(50, "Finding your atmosphere…"), 650),
    setTimeout(() => splash.set(78, "A little more you…"), 1250),
    setTimeout(() => splash.set(100, "Welcome home."), 2100),
  ];
  const dismiss = (event) => {
    if (event.type === "keydown" && event.key !== "Escape") return;
    for (const timer of timers) clearTimeout(timer);
    window.removeEventListener("keydown", dismiss);
  };
  window.addEventListener("keydown", dismiss);
  document
    .querySelector("#vestra-splash button")
    ?.addEventListener("click", dismiss, { once: true });
  setTimeout(() => window.removeEventListener("keydown", dismiss), 3500);
});
