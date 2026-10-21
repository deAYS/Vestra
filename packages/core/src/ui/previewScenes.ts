import { themePreviewDocument } from "./ThemePeek.js";

export type PreviewScene = "chat" | "home" | "profile" | "settings";
export const PREVIEW_SCENES: ReadonlyArray<{
  id: PreviewScene;
  label: string;
}> = [
  { id: "chat", label: "Chat" },
  { id: "home", label: "Home" },
  { id: "profile", label: "Profile" },
  { id: "settings", label: "Settings" },
];

const css = `
.vs-preview-scene{display:none!important;width:100%;height:100%;min-width:0;box-sizing:border-box}
html:not([data-preview-scene=chat]) #app-mount>:not(.vs-preview-scene){display:none!important}
html[data-preview-scene=home] .vs-preview-scene[data-scene=home],html[data-preview-scene=profile] .vs-preview-scene[data-scene=profile],html[data-preview-scene=settings] .vs-preview-scene[data-scene=settings]{display:flex!important}
.vs-preview-scene{font:12px/1.55 system-ui;color:var(--text-normal,#eee7f7)}
.vs-preview-scene h3{font-size:16px;margin:0 0 4px;color:var(--header-primary,#fff)}
.vs-preview-scene h4{font-size:12px;margin:0 0 12px}.vs-preview-scene p{font-size:12px;margin:5px 0}
.vs-preview-scene small{font-size:11px;margin:0;color:var(--text-muted,#aaa)}
.vs-preview-home{padding:14px;flex-direction:column;gap:12px;background:var(--background-primary,#1c1923)}
.vs-preview-home .container_previewHome{display:flex;flex:1;min-height:0;flex-direction:column;margin:0!important;padding:18px}
.vs-preview-home header{display:flex;gap:15px;align-items:center;padding-bottom:14px;border-bottom:1px solid var(--border-subtle,#fff2)}
.vs-preview-home .tabBody_previewHome{display:flex;flex:1;min-height:0;gap:15px;padding-top:14px}
.vs-preview-friends{flex:1;min-width:0}.vs-preview-friend{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--border-subtle,#fff1)}
.vs-preview-avatar{display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:12px;background:var(--brand-500,#c5baf8);color:#201a2a;font-size:13px;font-weight:650}
.vs-preview-home .nowPlayingColumn_previewHome{width:110px;padding:12px;border-radius:12px;background:var(--background-secondary,#191620)}
.vs-preview-profile{align-items:center;justify-content:center;padding:18px}
.vs-preview-profile .user-profile-popout{width:280px;max-width:100%;border:1px solid var(--border-normal,#fff2);border-radius:18px;overflow:hidden;background:var(--background-floating,#211c2a)}
.vs-preview-banner{height:62px;background:linear-gradient(115deg,var(--brand-500,#c5baf8),var(--background-tertiary,#292230))}
.vs-preview-profile-body{padding:0 20px 20px}.vs-preview-profile-body>.vs-preview-avatar{width:52px;height:52px;margin-top:-24px;margin-bottom:12px;border:4px solid var(--background-floating,#211c2a);font-size:20px}
.vs-preview-profile-body hr{border:0;border-top:1px solid var(--border-subtle,#fff2);margin:15px 0}
.vs-preview-activity{border-radius:10px;padding:12px;background:var(--background-surface-high,#ffffff0b);margin-top:14px}
.vs-preview-settings{padding:14px}
.vs-preview-settings .standardSidebarView_previewSettings{display:flex;width:100%;height:100%;padding:18px;gap:20px;border:1px solid var(--border-normal,#fff2);border-radius:16px;background:var(--background-primary,#1c1923)}
.vs-preview-settings nav{width:100px;flex:none;border-right:1px solid var(--border-subtle,#fff2);padding-right:12px}
.vs-preview-settings nav p{margin:14px 0;color:var(--text-muted,#aaa)}
.vs-preview-settings main{flex:1;min-width:0}.vs-preview-control{height:32px;border:1px solid var(--border-normal,#fff2);border-radius:9px;background:var(--input-background-default,#ffffff10);margin:10px 0 22px;padding:7px 10px;font-size:11px;overflow:hidden}
.vs-preview-slider{height:4px;border-radius:5px;background:var(--background-modifier-selected,#fff3);margin:15px 0 22px}.vs-preview-slider:before{content:"";display:block;height:4px;width:70%;border-radius:5px;background:var(--brand-500,#c5baf8)}
@media(max-width:400px){.vs-preview-home .nowPlayingColumn_previewHome{display:none}.vs-preview-settings nav{width:74px}.vs-preview-settings .standardSidebarView_previewSettings{padding:14px;gap:12px}}
`;

const samples = `
<section class="vs-preview-scene vs-preview-home" data-scene="home" aria-label="Sample home page"><div class="container_previewHome"><header><h3>Friends</h3><span>Online</span><small>All</small></header><div class="tabBody_previewHome"><div class="vs-preview-friends"><small>ONLINE — 3</small>${["mira", "nova", "atlas"].map((name) => `<div class="vs-preview-friend"><span class="vs-preview-avatar">${name[0]}</span><div><strong>${name}</strong><p><small>Online · Just hanging out</small></p></div></div>`).join("")}</div><aside class="nowPlayingColumn_previewHome"><h4>Active now</h4><p>A quiet evening.</p><small>Your friends’ activity appears here.</small></aside></div></div></section>
<section class="vs-preview-scene vs-preview-profile" data-scene="profile" aria-label="Sample profile"><aside class="user-profile-popout"><div class="vs-preview-banner"></div><div class="vs-preview-profile-body"><span class="vs-preview-avatar">m</span><h3>mira</h3><small>mira · Online</small><p>A familiar place.<br>A different atmosphere.</p><hr><small>3 mutual friends · 1 mutual server</small><div class="vs-preview-activity"><strong>Listening to music</strong><p>After hours, on repeat.</p></div></div></aside></section>
<section class="vs-preview-scene vs-preview-settings" data-scene="settings" aria-label="Sample settings"><div class="standardSidebarView_previewSettings"><nav><h4>Settings</h4><p>My account</p><p>Appearance</p><strong>Voice & video</strong><p>Notifications</p></nav><main><h3>Voice & video</h3><p>Input device</p><div class="vs-preview-control">Default microphone</div><p>Input volume</p><div class="vs-preview-slider"></div><p>Input profile</p><div class="vs-preview-control">Voice isolation</div><small>Clear controls over your backdrop.</small></main></div></section>`;

export function appearancePreviewDocument(): string {
  return themePreviewDocument("", true)
    .replace("<html ", '<html data-preview-scene="chat" ')
    .replace("</head>", `<style>${css}</style></head>`)
    .replace("</div></body>", `${samples}</div></body>`);
}
