import { VESTRA_API_VERSION } from "@vestra/shared";
import { BrandMark } from "./Brand.js";
import { s } from "./theme.js";
import type { PageProps } from "./types.js";
import { useState } from "react";
import { Native } from "../api/native.js";

export function AboutPage({ plugins, version }: PageProps): JSX.Element {
  const [update, setUpdate] = useState("Check GitHub for the latest release.");
  const [pending, setPending] = useState(false);
  const check = async (): Promise<void> => {
    setPending(true);
    try {
      const result = await Native.checkForUpdates(true);
      setUpdate(
        result.available
          ? `v${result.version} is available. Download it in Manager.`
          : "You have the latest compatible release.",
      );
    } catch {
      setUpdate("Could not reach GitHub. Try again shortly.");
    } finally {
      setPending(false);
    }
  };
  return (
    <section data-vestra-page="about">
      <div className="vs-about-brand">
        <BrandMark size={84} />
        <h2>vestra</h2>
        <p>Your Discord. Your rules.</p>
      </div>
      <div className="vs-setting-row">
        <div>
          <strong>Vestra Client</strong>
          <p>A more personal place to hang out.</p>
        </div>
        <span style={s.code}>{version}</span>
      </div>
      <div className="vs-setting-row">
        <div>
          <strong>Updates</strong>
          <p role="status">
            {Native.isAvailable()
              ? update
              : "Use Vestra Manager to check for updates."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            style={s.button}
            disabled={pending || !Native.isAvailable()}
            onClick={() => void check()}
          >
            {pending ? "Checking…" : "Check"}
          </button>
          <button
            style={s.button}
            disabled={!Native.isAvailable()}
            onClick={() =>
              void Native.installUpdate().catch(() =>
                setUpdate(
                  "Open Vestra Manager to download and install the update.",
                ),
              )
            }
          >
            Open Manager ↗
          </button>
        </div>
      </div>
      <div className="vs-setting-row">
        <div>
          <strong>Built to be yours</strong>
          <p>Open source. MIT licensed. Made for the community.</p>
        </div>
        <span style={{ color: "#C5BAF8", fontSize: 11 }}>Independent</span>
      </div>
      <div className="vs-setting-row">
        <div>
          <strong>Plugin API</strong>
          <p>{plugins.list().length} plugins in your workspace.</p>
        </div>
        <span style={s.code}>v{VESTRA_API_VERSION}</span>
      </div>
      <div className="vs-setting-row">
        <div>
          <strong>Join the community</strong>
          <p>Share your setup, suggest plugins and get help.</p>
        </div>
        <a
          href="https://discord.gg/jKf2RGesRK"
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...s.button, textDecoration: "none", flexShrink: 0 }}
        >
          Discord <span aria-hidden="true">↗</span>
        </a>
      </div>
      <p style={{ ...s.muted, fontSize: 11, marginTop: 30 }}>
        Vestra is an independent project and is not affiliated with Discord.
      </p>
    </section>
  );
}
