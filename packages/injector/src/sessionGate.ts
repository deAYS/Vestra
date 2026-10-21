/** Only visible app landmarks are inspected; login fields and account data are never read. */
export function observeDiscordSession(
  onChange: (ready: boolean) => void,
): () => void {
  let ready = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const inspect = (): void => {
    pending = undefined;
    const root = document.getElementById("app-mount");
    const workspace = Boolean(
      root?.querySelector(
        '[class*="guilds_"],[class*="sidebarList_"],[class*="privateChannels_"]',
      ),
    );
    const login =
      Boolean(root?.querySelector('[class*="authBox_"],[class*="qrLogin_"]')) ||
      (!workspace &&
        Boolean(
          root?.querySelector(
            'form:has(input[type="password"]):has(input[name="email"])',
          ),
        ));
    let next = ready;
    if (login) next = false;
    else if (workspace) next = true;
    else if (/^\/(login|register)(\/|$)/.test(location.pathname)) next = false;
    if (next !== ready) {
      ready = next;
      onChange(ready);
    }
  };
  const schedule = (): void => {
    if (pending === undefined) pending = setTimeout(inspect, 60);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document, { childList: true, subtree: true });
  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);
  inspect();
  return () => {
    observer.disconnect();
    clearTimeout(pending);
    window.removeEventListener("popstate", schedule);
    window.removeEventListener("hashchange", schedule);
  };
}
