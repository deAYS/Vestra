import { VESTRA_API_VERSION } from "@vestra/shared";
import { BrandMark } from "./Brand.js";
import { s } from "./theme.js";
import type { PageProps } from "./types.js";

export function AboutPage({ plugins, version }: PageProps): JSX.Element {
  return <section data-vestra-page="about">
    <div className="vs-about-brand"><BrandMark size={84}/><h2>vestra</h2><p>Your Discord. Your rules.</p></div>
    <div className="vs-setting-row"><div><strong>Vestra Client</strong><p>A more personal place to hang out.</p></div><span style={s.code}>{version}</span></div>
    <div className="vs-setting-row"><div><strong>Built to be yours</strong><p>Open source. MIT licensed. Made for the community.</p></div><span style={{color:"#C5BAF8",fontSize:11}}>Independent</span></div>
    <div className="vs-setting-row"><div><strong>Plugin API</strong><p>{plugins.list().length} plugins in your workspace.</p></div><span style={s.code}>v{VESTRA_API_VERSION}</span></div>
    <p style={{...s.muted,fontSize:11,marginTop:30}}>Vestra is an independent project and is not affiliated with Discord.</p>
  </section>;
}
