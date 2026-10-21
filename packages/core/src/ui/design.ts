import { Styles } from "../api/styles.js";

export function ensureSettingsDesign(): void {
  if (Styles.has("vestra-settings-design")) return;
  Styles.inject(
    "vestra-settings-design",
    `
.vs-settings-root{position:relative;display:flex;height:100%;min-height:0;isolation:isolate;text-align:left}
.vs-settings-root[data-theme-follow=true]{--vs-bg:var(--background-primary,#17161c);--vs-sidebar:var(--background-secondary,#121116);--vs-surface:var(--background-surface-high,var(--background-floating,#1e1d25));--vs-control:var(--channeltextarea-background,#25232d);--vs-border:var(--border-normal,#302e39);--vs-accent:var(--text-link,#c5baf8);--vs-text:var(--text-normal,#f2f0f7);--vs-muted:var(--text-muted,#9894a6)}
.vs-settings-root[data-theme-follow=true] .vs-settings-content{background:var(--vs-bg);color:var(--vs-text)}
.vs-settings-root[data-theme-follow=true] .vs-settings-sidebar{background:var(--vs-sidebar);border-color:var(--vs-border)}
.vs-settings-root[data-theme-follow=true] :is(.vs-home-hero,.vs-stat,.vs-theme-card,.vs-plugin-card,.vs-theme-peek-panel){background:var(--vs-surface)!important;border-color:var(--vs-border)!important}
.vs-settings-root[data-theme-follow=true] :is(.vs-settings-brand,.vs-plugin-glyph,.vs-settings-nav button[aria-current=page],.vs-settings-nav button[aria-current=page] svg){color:var(--vs-accent)}
.vs-settings-root[data-theme-follow=true] :is(.vs-stat strong,.vs-setting-row strong,.vs-theme-card strong,.vs-settings-wordmark){color:var(--vs-text)}
.vs-settings-root[data-theme-follow=true] :is(.vs-setting-row p,.vs-theme-card p,.vs-sidebar-bottom,.vs-stat>span){color:var(--vs-muted)}
.vs-settings-root[data-theme-follow=true] input[type=checkbox]:checked{background:var(--vs-accent);border-color:var(--vs-accent)}
.vs-settings-root[data-theme-follow=true] .vs-settings-nav button[aria-current=page]{background:color-mix(in srgb,var(--vs-accent) 12%,transparent);border-color:color-mix(in srgb,var(--vs-accent) 20%,transparent)}
.vs-settings-launcher[data-theme-follow=true],.vs-launcher-menu[data-theme-follow=true]{background:var(--background-floating,#1c1923)!important;color:var(--text-link,#c5baf8)!important;border-color:var(--border-strong,#c5baf844)!important}
.vs-launcher-menu[data-theme-follow=true] p{color:var(--text-muted,#9d92ad)}
.vs-launcher-menu[data-theme-follow=true] button:hover{background:var(--background-modifier-hover,#ffffff09)}
.vs-settings-root *{box-sizing:border-box}
.vs-settings-root button,.vs-settings-root input,.vs-settings-root textarea{font-family:inherit}
.vs-settings-root button{transition:background .15s,border-color .15s,opacity .15s;white-space:nowrap}
.vs-settings-root button:hover:not(:disabled){filter:brightness(1.1)}
.vs-settings-root button:active:not(:disabled){transform:scale(.97)}
.vs-settings-content section{animation:vs-page-enter .38s cubic-bezier(.16,1,.3,1) both}
@keyframes vs-page-enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.vs-settings-root button:disabled{opacity:.45;cursor:default}
.vs-settings-root :focus-visible{outline:2px solid #C5BAF8;outline-offset:3px}
.vs-settings-sidebar{width:190px;flex:none;background:#121116;border-right:1px solid #FFFFFF07;padding:28px 14px 18px;display:flex;flex-direction:column}
.vs-settings-brand{display:flex;align-items:center;gap:8px;padding:0 10px 30px;color:#C5BAF8}
.vs-settings-wordmark{font-size:22px;font-weight:720;letter-spacing:-.065em;color:#F2F0F7}
.vs-nav-caption{color:#716C80;font-size:9px;font-weight:650;letter-spacing:.14em;padding:0 14px;margin:0 0 12px;text-transform:uppercase}
.vs-settings-nav{display:flex;flex-direction:column;gap:5px}
.vs-settings-nav button{display:flex;align-items:center;gap:11px;width:100%;padding:11px 13px;border:1px solid transparent;border-radius:9px;background:transparent;color:#9691A4;cursor:pointer;text-align:left;font-size:12px;font-weight:500}
.vs-settings-nav button[aria-current=page]{color:#D8CFFF;background:#C5BAF811;border-color:#C5BAF80D}
.vs-settings-nav button[aria-current=page] svg{color:#C5BAF8}
.vs-settings-nav button:hover{background:#FFFFFF05;color:#E5DEEF}
.vs-nav-count{margin-left:auto;color:#8E859F;font:10px Consolas,monospace}
.vs-sidebar-bottom{margin-top:auto;padding:22px 12px 0;color:#6F697D;font-size:10px;line-height:1.8}
.vs-sidebar-bottom span{display:block;color:#968EA9;font-size:11px}
.vs-sidebar-bottom kbd{border:1px solid #3B3546;border-radius:4px;padding:2px 4px;color:#9990AC;font:9px inherit}
.vs-settings-content{min-width:0;flex:1;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#413B4E transparent;padding:39px 32px 30px;background:#17161C}
.vs-content-eyebrow{display:flex;align-items:center;gap:7px;color:#7C758C;font-size:10px;margin-bottom:24px;letter-spacing:.02em}
.vs-content-eyebrow span{color:#B7AEC8}
.vs-section-label{font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#8C859D;margin:27px 0 13px}
.vs-home-hero{position:relative;overflow:hidden;min-height:176px;padding:25px;border:1px solid #8B77C82B;border-radius:15px;background:radial-gradient(ellipse at 95% 10%,#9C78D521,transparent 65%),linear-gradient(120deg,#25202F,#1C1A23);margin-bottom:22px}
.vs-home-hero>svg{position:absolute;right:12px;bottom:-26px;color:#C5BAF80D;transform:rotate(-12deg);pointer-events:none}
.vs-home-hero small{display:flex;align-items:center;gap:6px;color:#B5A7CC;font-size:9px;letter-spacing:.13em;font-weight:550;text-transform:uppercase}
.vs-status-dot{height:5px;width:5px;border-radius:50%;background:#9CCFB3;display:inline-block}
.vs-home-hero h3{font-size:26px;line-height:1.25;font-weight:550;letter-spacing:-.045em;color:#F4F0FA;margin:14px 0 8px;position:relative}
.vs-home-hero p{font-size:12px;color:#AEA4BC;max-width:290px;line-height:1.65;margin:0 0 18px;position:relative}
.vs-home-hero button{position:relative}
.vs-stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:25px}
.vs-stat{border:1px solid #FFFFFF08;border-radius:11px;padding:15px;background:#1D1B23}
.vs-stat>span{display:flex;align-items:center;gap:6px;color:#90889F;font-size:10px;margin-bottom:8px}
.vs-stat strong{font-size:21px;letter-spacing:-.04em;font-weight:550;color:#E4DDEF}
.vs-stat small{font-size:10px;color:#81798E;margin-left:5px}
.vs-setting-row{display:flex;align-items:center;gap:16px;padding:18px 0;border-bottom:1px solid #FFFFFF07}
.vs-setting-row:last-child{border-bottom:none}
.vs-setting-row>div:first-child{flex:1;min-width:0}
.vs-setting-row strong{font-size:12px;font-weight:550;color:#DCD6E6}
.vs-setting-row p{font-size:11px;line-height:1.6;color:#8F869E;margin:4px 0 0}
.vs-settings-root input[type=checkbox]{appearance:none;-webkit-appearance:none;display:inline-block;position:relative;width:34px;height:20px;min-width:34px;border:1px solid #4D465B;border-radius:20px;background:#3B3546;cursor:pointer;vertical-align:middle;margin:0;transition:background .2s,border-color .2s}
.vs-settings-root input[type=checkbox]::after{content:"";position:absolute;left:3px;top:3px;width:12px;height:12px;border-radius:50%;background:#A9A0B8;transition:transform .2s,background .2s}
.vs-settings-root input[type=checkbox]:checked{background:#C5BAF8;border-color:#C5BAF8}
.vs-settings-root input[type=checkbox]:checked::after{transform:translateX(14px);background:#302541}
.vs-settings-root input[type=checkbox]:disabled{opacity:.4;cursor:wait}
.vs-plugin-card{padding:19px!important;transition:border-color .15s}
.vs-plugin-card:hover{border-color:#484052!important}
.vs-plugin-heading{display:flex;align-items:center;gap:12px;margin-bottom:11px}
.vs-plugin-glyph{width:35px;height:35px;display:grid;place-items:center;border:1px solid #C5BAF816;border-radius:10px;background:#C5BAF809;color:#C5BAF8;flex:none}
.vs-plugin-heading strong{font-size:13px;letter-spacing:-.015em;font-weight:600}
.vs-plugin-heading small{display:block;color:#8D829E;font-size:10px;margin-top:2px}
.vs-plugin-heading input{margin-left:auto!important}
.vs-plugin-card>p{font-size:12px;line-height:1.65;min-height:38px;margin:0 0 14px;color:#9B92AA}
.vs-plugin-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:#7E748C}
.vs-plugin-footer button{background:transparent;border:0;color:#ADA0C3;font-size:11px;padding:4px 0;cursor:pointer}
.vs-plugin-options{margin-top:20px;padding-top:18px;border-top:1px solid #ffffff0b;scroll-margin-block:24px}
.vs-plugin-options h4{font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-weight:600;color:#ada1bc;margin:0 0 4px}
.vs-option-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:15px 0;border-bottom:1px solid #ffffff06;flex-wrap:wrap}
.vs-option-row>div:first-child{flex:1;min-width:180px}
.vs-option-row strong{font-size:12px;font-weight:500;color:#ddd5e8}
.vs-option-row p,.vs-options-note{font-size:10px!important;line-height:1.65!important;color:#91859f!important;margin:5px 0 0!important}
.vs-option-row select{font:11px inherit;background:#25202e;border:1px solid #40364e;border-radius:8px;color:#ded4ea;padding:9px;min-width:110px}
.vs-shortcut-editor{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;max-width:100%}
.vs-option-reset{background:transparent;border:0;color:#afa0c3;font:10px inherit;cursor:pointer;padding:5px}
.vs-number-option{display:flex;align-items:center;gap:10px;width:160px}
.vs-number-option input{width:120px;accent-color:#c5baf8}.vs-number-option output{font:11px Consolas,monospace;color:#c5baf8;min-width:30px}
.vs-options-note{padding-top:13px}
.vs-addon-folder{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:16px 18px;margin:0 0 24px;border:1px solid #c5baf818;border-radius:11px;background:#c5baf804}
.vs-addon-folder>div:first-child{flex:1;min-width:190px}.vs-addon-folder strong{font-size:11px;font-weight:550;color:#d3c8e0}
.vs-addon-folder p{font-size:10px;color:#91869f;line-height:1.65;margin:4px 0}.vs-addon-folder code{color:#a699b5;font:10px Consolas,monospace}
.vs-addon-folder .vs-addon-note{width:100%;margin:0;color:#8b809a}
.vs-search{position:relative;margin-bottom:20px}
.vs-search>svg{position:absolute;top:13px;left:13px;color:#7E748F}
.vs-search input{padding-left:40px!important}
.vs-collection-bar{display:flex;align-items:center;justify-content:space-between;margin:23px 0 13px;color:#8E839E;font-size:11px}
.vs-collection-bar h3{font-size:12px;font-weight:550;color:#C9BED8;margin:0}
.vs-theme-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.vs-theme-peek{display:inline-flex;flex:none}
.vs-theme-peek>button{border:1px solid #c5baf826;border-radius:7px;background:#c5baf809;color:#c5baf8;cursor:pointer;font-size:10px;padding:6px 9px}
.vs-theme-peek-panel{display:flex;flex-direction:column;z-index:8;border:1px solid #c5baf844;border-radius:13px;background:#17141f;box-shadow:0 18px 70px #000b;overflow:hidden;pointer-events:none;animation:vs-page-enter .2s ease-out}
.vs-theme-peek-panel>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 15px;color:#e3daed}
.vs-theme-peek-panel strong{font-size:12px}.vs-theme-peek-panel span{font-size:9px;color:#aa9cbd}
.vs-theme-peek-panel iframe{display:block;width:100%;flex:1;min-height:0;border:0;background:#101019;pointer-events:none}
.vs-theme-action{gap:6px;flex-wrap:wrap}
@media(prefers-reduced-motion:reduce){.vs-theme-peek-panel{animation:none}}
.vs-theme-card{border:1px solid #37303F;border-radius:12px;overflow:hidden;background:#1D1A23;transition:border-color .2s}
.vs-theme-card[data-active=true]{border-color:#A18DBF66}
.vs-theme-art{position:relative;height:106px;padding:14px 12px 0;overflow:hidden;display:flex;align-items:flex-start;justify-content:center}
.vs-theme-art::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,#0002,transparent);pointer-events:none}
.vs-mini-client{width:100%;height:106px;border:1px solid #FFFFFF15;border-radius:7px 7px 0 0;display:flex;overflow:hidden;box-shadow:0 5px 20px #0004;text-align:left}
.vs-mini-rail{width:23px;padding:8px 5px;display:grid;align-content:start;gap:6px;background:#0003}
.vs-mini-rail i{display:block;width:11px;height:11px;border-radius:4px;background:#FFFFFF11}
.vs-mini-channels{width:49px;background:#0002;padding:9px 6px;display:grid;align-content:start;gap:7px}
.vs-mini-channels i{height:3px;border-radius:4px;background:#FFFFFF16;display:block}
.vs-mini-chat{flex:1;padding:12px 9px;display:grid;align-content:start;gap:9px}
.vs-mini-message{display:flex;gap:5px}
.vs-mini-message>b{width:10px;height:10px;border-radius:4px;flex:none}
.vs-mini-message>div{display:grid;gap:4px;flex:1;padding-top:2px}
.vs-mini-message i{height:3px;border-radius:4px;display:block;background:#FFFFFF22}
.vs-theme-card-content{padding:13px 14px}
.vs-theme-card-top{display:flex;justify-content:space-between;align-items:center;gap:5px}
.vs-theme-card strong{font-size:12px;font-weight:550;color:#E3DAED}
.vs-theme-card p{font-size:10px;color:#8F829F;margin:4px 0 11px}
.vs-theme-action{display:flex;align-items:center;justify-content:space-between;color:#7E728D;font-size:10px}
.vs-theme-action button{padding:6px 10px!important;font-size:10px!important;line-height:15px!important}
.vs-theme-swatch{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:3px}
.vs-theme-installed{display:flex;align-items:center;gap:12px;padding:15px 0;border-bottom:1px solid #FFFFFF08}
.vs-theme-installed>div{flex:1}.vs-theme-installed strong{font-size:12px;font-weight:550}.vs-theme-installed p{font-size:10px;color:#8D819D;margin:3px 0 0}
.vs-theme-installed>button{border:0;background:transparent;color:#93849F;cursor:pointer;font-size:11px}
.vs-theme-customizer{container:vs-appearance/inline-size;margin:0 0 32px;border:1px solid #c5baf82b;border-radius:18px;padding:28px;background:radial-gradient(ellipse at 90% 0,#c5baf80b,transparent 65%),#ffffff03}
.vs-theme-customizer header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
.vs-appearance-eyebrow{font-size:11px;letter-spacing:.13em;color:#bfb2d0}
.vs-theme-customizer h3{font-size:22px;letter-spacing:-.035em;margin:10px 0;color:#eee7f5}
.vs-theme-customizer header p,.vs-appearance-background p{font-size:13px;color:#b9adc6;line-height:1.65;margin:0}
.vs-appearance-badge{border:1px solid #ffffff20;border-radius:20px;white-space:nowrap;font-size:11px;padding:8px 11px;color:#c6b9d7}
.vs-appearance-layout{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(380px,1.2fr);gap:28px;margin:30px 0}
.vs-appearance-controls{display:grid;gap:22px;min-width:0}
.vs-appearance-slider>span{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:14px;line-height:1.5;color:#e0d6eb}
.vs-appearance-slider output{flex:none;font:12px Consolas,monospace;color:#d0c3ff}
.vs-appearance-slider input{display:block;width:100%;height:22px;accent-color:#c5baf8;margin:10px 0 0;cursor:pointer}
.vs-appearance-color{display:flex;gap:12px;align-items:center;font-size:14px;line-height:1.5;color:#e0d6eb;min-width:0}
.vs-appearance-color>span{flex:1}
.vs-appearance-color input{width:40px;height:34px;padding:3px;border:1px solid #ffffff30;border-radius:8px;background:none;cursor:pointer;flex:none}
.vs-appearance-preview{min-width:0;display:flex;flex-direction:column;align-self:start;position:sticky;top:12px}
.vs-appearance-preview iframe{width:100%;height:390px;border:1px solid #ffffff26;border-radius:15px;background:#17131f;pointer-events:none}
.vs-appearance-preview>span{font-size:12px;line-height:1.6;color:#b9adc6;text-align:center;margin-top:12px}
.vs-theme-customizer button{cursor:pointer;border:1px solid #c5baf835;background:#c5baf809;border-radius:9px;color:#ded3f0;padding:10px 13px;font-size:13px;line-height:1.5;white-space:nowrap}
.vs-theme-customizer button:disabled{opacity:.4;cursor:default}
.vs-appearance-background{border-top:1px solid #ffffff16;padding-top:24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.vs-appearance-background>div{flex:1;min-width:220px}
.vs-appearance-background strong{font-size:15px;color:#e0d6eb}
.vs-appearance-background p{margin-top:7px}
.vs-appearance-url{display:flex;gap:12px;margin-top:18px}
.vs-appearance-url input{flex:1;min-width:0;font-size:13px!important;line-height:1.6!important;padding:12px!important}
.vs-theme-customizer footer{display:flex;gap:12px;align-items:center;border-top:1px solid #ffffff16;margin-top:24px;padding-top:22px;flex-wrap:wrap}
.vs-theme-customizer footer>div{flex:1;min-width:220px;font-size:13px;color:#b9adc6;line-height:1.65}
.vs-theme-customizer [role=alert]{color:#e5a0ae}
.vs-theme-customizer .vs-appearance-apply{background:#c5baf8;color:#211b2d;border-color:transparent;font-weight:600}
.vs-appearance-advanced{border-block:1px solid #ffffff18;padding:22px 0}
.vs-appearance-advanced h4{font-size:15px;font-weight:600;line-height:1.5;margin:0 0 20px;color:#eee7f5}
.vs-appearance-advanced>div{display:grid;gap:22px}
@container vs-appearance (max-width:680px){.vs-appearance-layout{grid-template-columns:minmax(0,1fr)}.vs-appearance-preview{position:static;grid-row:1}.vs-appearance-controls{grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 24px}.vs-appearance-advanced{grid-column:1/-1}.vs-appearance-advanced>div{grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 24px}.vs-appearance-badge{display:none}}
@container vs-appearance (max-width:420px){.vs-appearance-controls,.vs-appearance-advanced>div{grid-template-columns:minmax(0,1fr)}.vs-appearance-preview iframe{height:350px}.vs-appearance-url{flex-wrap:wrap}.vs-appearance-url input{flex-basis:100%}}
@media(max-width:720px){.vs-theme-customizer{padding:20px}}
.vs-empty{border:1px dashed #3A3244;border-radius:11px;padding:22px;text-align:center;color:#8D829D;font-size:12px}
.vs-editor-toolbar{display:flex;align-items:center;gap:8px;border:1px solid #302B39;border-bottom:0;border-radius:11px 11px 0 0;background:#1D1924;padding:12px 15px;font:11px Consolas,monospace;color:#9D90AF}
.vs-editor-toolbar span:last-child{margin-left:auto;font:10px inherit;color:#8EB69B}
.vs-css-editor{overflow:hidden;border:1px solid #302B39;border-radius:0 0 11px 11px;background:#111015;transition:border-color .2s,box-shadow .2s}
.vs-editor:focus-within .vs-css-editor{border-color:#9f8fd46b;box-shadow:0 0 0 3px #c5baf806}
.vs-about-brand{padding:25px 0 30px;color:#C5BAF8}.vs-about-brand h2{color:#E7E1EF;font-size:34px;letter-spacing:-.065em;font-weight:650;margin:8px 0 2px}.vs-about-brand p{font-size:12px;color:#95889F;margin:0}
@media(max-width:720px){.vs-settings-sidebar{width:152px;padding:24px 10px 16px}.vs-settings-content{padding:32px 21px 22px}.vs-settings-brand{padding-left:8px;gap:5px}.vs-settings-wordmark{font-size:20px}.vs-settings-nav button{font-size:11px;padding:10px}.vs-home-hero{padding:20px}.vs-stat{padding:12px}.vs-stat small{display:block;margin:0}.vs-home-hero>svg{opacity:.6}}
@media(max-width:520px){.vs-settings-sidebar{width:60px;padding:23px 8px}.vs-settings-brand{padding:0 0 23px;justify-content:center}.vs-settings-wordmark,.vs-nav-caption,.vs-settings-nav button>span,.vs-sidebar-bottom{display:none}.vs-settings-nav button{justify-content:center;padding:12px 0}.vs-theme-grid{grid-template-columns:1fr}.vs-stat-grid{gap:6px}.vs-stat{padding:10px}.vs-settings-content{padding:30px 17px}.vs-home-hero h3{font-size:23px}}
@media(prefers-reduced-motion:reduce){.vs-settings-root *{transition:none!important;animation:none!important}}
`,
  );
}
