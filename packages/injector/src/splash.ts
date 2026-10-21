import { VESTRA_MARK_PATH } from "@vestra/shared";

// DOM-only. Every dependency used by the serialized function is an argument.
export function installSplash(markPath: string): {
  set(pct: number, label: string): void;
  done(): void;
  cancel(): void;
} {
  const host = document.documentElement;
  const existing = document.getElementById("vestra-splash");
  if (!host || existing) return { set() {}, done() {}, cancel() {} };
  const style = document.createElement("style");
  style.id = "vestra-splash-style";
  style.textContent = `
  @property --vs-reveal{syntax:'<percentage>';inherits:false;initial-value:0%}
  #vestra-splash{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;overflow:hidden;background:#101015;color:#F2F0F7;font-family:system-ui,sans-serif;user-select:none;transition:opacity .35s ease}
  #vestra-splash::before{content:"";position:absolute;width:650px;height:650px;border-radius:50%;background:radial-gradient(ellipse,rgba(169,143,217,.12),transparent 66%);animation:vs-aurora 7s ease-in-out infinite alternate;pointer-events:none}
  #vestra-splash::after{content:"";position:absolute;inset:0;background-image:linear-gradient(#a8c8ff05 1px,transparent 1px),linear-gradient(90deg,#a8c8ff05 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(ellipse,#000,transparent 72%);pointer-events:none}
  #vestra-splash .vs-boot-content{position:relative;z-index:1;text-align:center;width:min(340px,80vw);animation:vs-arrive .6s ease both}
  #vestra-splash .vs-boot-orbit{width:150px;height:150px;margin:0 auto 32px;display:grid;place-items:center;position:relative}
  #vestra-splash .vs-boot-orbit::before{content:"";position:absolute;inset:0;border:1px solid #C5BAF811;border-top-color:#C5BAF866;transform:rotate(-35deg);border-radius:50%;animation:vs-orbit 8s linear infinite}
  #vestra-splash svg{filter:drop-shadow(0 0 24px #C5BAF844);animation:vs-logo-wake 1.05s cubic-bezier(.16,1,.3,1) both,vs-logo-breathe 3.5s 1.05s ease-in-out infinite}
  #vestra-splash h1{font-size:17px;letter-spacing:.5em;text-indent:.5em;margin:0 0 10px;font-weight:600}
  #vestra-splash .vs-boot-tag{font-size:10px;letter-spacing:.17em;color:#8592aa;margin:0 0 38px}
  #vestra-splash .vs-boot-track{height:2px;background:#ffffff12;overflow:hidden;border-radius:4px}
  #vestra-splash .vs-boot-fill{height:100%;width:0;background:linear-gradient(90deg,#71618C,#C5BAF8);box-shadow:0 0 18px #C5BAF81A;transition:width .35s ease}
  #vestra-splash .vs-boot-status{display:flex;justify-content:space-between;gap:10px;margin-top:12px;font-size:11px;color:#a0adc3;font-variant-numeric:tabular-nums}
  #vestra-splash button{position:absolute;z-index:2;bottom:28px;border:1px solid #ffffff18;background:#ffffff05;color:#8997af;padding:8px 14px;border-radius:20px;cursor:pointer;font:11px system-ui}
  #vestra-splash button:hover,#vestra-splash button:focus-visible{color:#fff;border-color:#aacfff}
  #vestra-splash.vs-done{opacity:0;pointer-events:none}
  @supports(mask-image:radial-gradient(circle,transparent,#000)){
    #vestra-splash.vs-done{opacity:1;mask-image:radial-gradient(circle farthest-corner at 50% 50%,transparent calc(var(--vs-reveal) - 10%),#000 var(--vs-reveal));animation:vs-unveil .95s cubic-bezier(.65,0,.25,1) forwards}
  }
  #vestra-splash.vs-done .vs-boot-content{animation:vs-boot-depart .55s ease-in forwards}
  #vestra-splash.vs-done svg{animation:vs-logo-depart .55s cubic-bezier(.4,0,.2,1) forwards}
  @keyframes vs-unveil{0%{--vs-reveal:0%;opacity:1}85%{opacity:1}100%{--vs-reveal:125%;opacity:0}}
  @keyframes vs-logo-wake{0%{opacity:0;transform:perspective(500px) rotateY(-65deg) rotate(-12deg) scale(.45)}65%{opacity:1;transform:perspective(500px) rotateY(8deg) rotate(3deg) scale(1.07)}100%{opacity:1;transform:none}}
  @keyframes vs-logo-breathe{50%{transform:translateY(-5px) scale(1.035);filter:drop-shadow(0 0 32px #C5BAF866)}}
  @keyframes vs-logo-depart{30%{transform:scale(1.15)}100%{opacity:0;transform:scale(.5) rotate(8deg)}}
  @keyframes vs-boot-depart{to{opacity:0;transform:scale(.94)}}
  @keyframes vs-orbit{to{transform:rotate(325deg)}}
  @keyframes vs-aurora{to{transform:translate(12%,-8%) scale(1.15)}}
  @keyframes vs-arrive{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
  @media(prefers-reduced-motion:reduce){#vestra-splash,#vestra-splash *,#vestra-splash::before,#vestra-splash::after{animation:none!important;transition:none!important}#vestra-splash.vs-done{opacity:0}}
  `;
  const el = document.createElement("div");
  el.id = "vestra-splash";
  el.innerHTML = `<div class="vs-boot-content"><div class="vs-boot-orbit"><svg width="100" height="100" viewBox="0 0 64 64" aria-hidden="true"><path d="${markPath}" fill="#C5BAF8" fill-rule="evenodd"/></svg></div><h1>VESTRA</h1><p class="vs-boot-tag">YOUR DISCORD. YOUR RULES.</p><div class="vs-boot-track"><div class="vs-boot-fill"></div></div><div class="vs-boot-status" role="status" aria-live="polite"><span>Connecting to Discord…</span><span>0%</span></div></div><button type="button">Continue to Discord · Esc</button>`;
  host.appendChild(style);
  host.appendChild(el);
  let completed = false;
  const mountedAt = Date.now();
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let current = 0;
  const fill = el.querySelector<HTMLElement>(".vs-boot-fill")!;
  const labels = el.querySelectorAll(".vs-boot-status span");
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") dismiss();
  };
  const timeout = setTimeout(dismiss, 12000);
  function dismiss(): void {
    if (completed) return;
    completed = true;
    clearTimeout(timeout);
    if (finishTimer !== undefined) clearTimeout(finishTimer);
    window.removeEventListener("keydown", onKey);
    el.classList.add("vs-done");
    setTimeout(() => {
      el.remove();
      style.remove();
    }, 1000);
  }
  function done(): void {
    if (completed || finishTimer !== undefined) return;
    // Runtime starts immediately; only the visual exit waits for a visible paint.
    // Escape and the failsafe bypass this minimum duration.
    finishTimer = setTimeout(
      dismiss,
      Math.max(0, 1100 - (Date.now() - mountedAt)),
    );
  }
  el.querySelector("button")!.addEventListener("click", dismiss);
  window.addEventListener("keydown", onKey);
  return {
    set(pct, label) {
      if (completed || !Number.isFinite(pct)) return;
      current = Math.max(current, Math.min(100, Math.round(pct)));
      fill.style.width = `${current}%`;
      labels[0]!.textContent = label;
      labels[1]!.textContent = `${current}%`;
      if (current === 100) done();
    },
    done,
    cancel() {
      completed = true;
      clearTimeout(timeout);
      clearTimeout(finishTimer);
      window.removeEventListener("keydown", onKey);
      el.remove();
      style.remove();
    },
  };
}

// Function source must be standalone: no closure captures/imports in installSplash.
export function buildSplashSource(): string {
  return `(${installSplash.toString()})(${JSON.stringify(VESTRA_MARK_PATH)})`;
}

export function showSplash(): ReturnType<typeof installSplash> {
  return installSplash(VESTRA_MARK_PATH);
}
