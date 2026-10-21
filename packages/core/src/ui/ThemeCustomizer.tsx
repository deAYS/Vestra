import { useRef, useState } from "react";
import {
  ThemeCustomizationSchema,
  type SettingsStore,
  type Theme,
  type ThemeCustomization,
} from "../api/settings.js";
import {
  customizedThemeCss,
  DEFAULT_THEME_CUSTOMIZATION,
} from "../themeCustomization.js";
import { ThemePreviewFrame } from "./ThemePreviewFrame.js";
import { PREVIEW_SCENES, type PreviewScene } from "./previewScenes.js";
import { downloadThemePackage } from "../themeTransfer.js";

const controls = [
  { key: "opacity", label: "Panel opacity", min: 0, max: 100, unit: "%" },
  { key: "blur", label: "Glass blur", min: 0, max: 48, unit: "px" },
  {
    key: "saturation",
    label: "Background saturation",
    min: 0,
    max: 200,
    unit: "%",
  },
  {
    key: "brightness",
    label: "Background brightness",
    min: 0,
    max: 120,
    unit: "%",
  },
  { key: "radius", label: "Corner radius", min: 0, max: 30, unit: "px" },
  {
    key: "homeOpacity",
    label: "Home panels opacity",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "popupOpacity",
    label: "Profiles & menus opacity",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "settingsOpacity",
    label: "Settings opacity",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "glowStrength",
    label: "Text glow strength",
    min: 0,
    max: 100,
    unit: "%",
  },
  { key: "glowSize", label: "Text glow size", min: 1, max: 18, unit: "px" },
] as const;

function appearanceDefaults(theme: Theme): ThemeCustomization {
  const glass = theme.css.includes("--glass-pane:");
  return {
    ...DEFAULT_THEME_CUSTOMIZATION,
    ...(!glass
      ? {
          opacity: 100,
          blur: 0,
          saturation: 100,
          radius: 12,
          homeOpacity: 100,
          popupOpacity: 100,
          settingsOpacity: 100,
        }
      : {}),
    glowColor:
      theme.css.match(/--text-link:\s*(#[\da-f]{6})\b/i)?.[1] ??
      DEFAULT_THEME_CUSTOMIZATION.glowColor,
    surfaceOverrides: false,
  };
}

async function readBackground(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|avif)$/.test(file.type))
    throw new Error("Choose a PNG, JPG, WebP or AVIF image.");
  if (file.size > 15_000_000)
    throw new Error("Choose an image smaller than 15 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/webp", 0.85);
    if (image.length > 1_500_000)
      throw new Error("This image is too detailed. Choose a smaller image.");
    return image;
  } finally {
    bitmap.close();
  }
}

export function ThemeCustomizer({
  theme,
  settings,
}: {
  theme: Theme;
  settings: SettingsStore;
}): JSX.Element {
  const [draft, setDraft] = useState<ThemeCustomization>(() => ({
    ...appearanceDefaults(theme),
    ...theme.customization,
  }));
  const [changed, setChanged] = useState(false);
  const [scene, setScene] = useState<PreviewScene>("chat");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [imageUrl, setImageUrl] = useState(
    theme.customization?.backgroundImage.startsWith("https:")
      ? theme.customization.backgroundImage
      : "",
  );
  const input = useRef<HTMLInputElement>(null);
  const preview = changed
    ? customizedThemeCss({ ...theme, customization: draft })
    : customizedThemeCss(theme);
  const update = (values: Partial<ThemeCustomization>): void => {
    const surfaceChange = Object.keys(values).some(
      (key) =>
        !["textColor", "glowColor", "glowStrength", "glowSize"].includes(key),
    );
    setDraft((previous) => ({
      ...previous,
      ...values,
      surfaceOverrides: previous.surfaceOverrides || surfaceChange,
    }));
    setChanged(true);
    setStatus("");
    setError("");
  };
  const save = async (reset = false): Promise<void> => {
    setPending(true);
    setError("");
    try {
      settings.setThemeCustomization(
        theme.id,
        reset ? undefined : ThemeCustomizationSchema.parse(draft),
      );
      await settings.flush();
      if (reset) {
        setDraft(appearanceDefaults(theme));
        setImageUrl("");
      }
      setChanged(false);
      setStatus(
        reset ? "Original theme restored." : "Appearance saved for this theme.",
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setPending(false);
    }
  };
  const rangeControl = (control: (typeof controls)[number]): JSX.Element => (
    <label className="vs-appearance-slider" key={control.key}>
      <span>
        {control.label}
        <output>
          {draft[control.key]}
          {control.unit}
        </output>
      </span>
      <input
        type="range"
        aria-label={control.label}
        min={control.min}
        max={control.max}
        value={draft[control.key]}
        disabled={pending}
        onFocus={() => previewControl(control.key)}
        onPointerDown={() => previewControl(control.key)}
        onChange={(event) =>
          update({ [control.key]: Number(event.target.value) })
        }
      />
    </label>
  );
  const previewControl = (key: string): void => {
    if (key === "homeOpacity") setScene("home");
    else if (key === "popupOpacity") setScene("profile");
    else if (key === "settingsOpacity") setScene("settings");
  };

  return (
    <section className="vs-theme-customizer" aria-label="Theme appearance">
      <header>
        <div>
          <span className="vs-appearance-eyebrow">MAKE IT YOURS</span>
          <h3>{theme.name.replace("Vestra ", "")} appearance</h3>
          <p>
            Preview your changes, then apply. Saved separately for each theme.
          </p>
        </div>
        <span className="vs-appearance-badge">
          {changed ? "Unsaved preview" : "Your active theme"}
        </span>
      </header>
      <div className="vs-appearance-layout">
        <div className="vs-appearance-controls">
          {controls.slice(0, 5).map(rangeControl)}
          <div
            className="vs-appearance-advanced"
            role="group"
            aria-label="Text & readability"
          >
            <h4>Text & readability</h4>
            <div>
              {controls.slice(5).map(rangeControl)}
              <label className="vs-appearance-color">
                <span>Text color</span>
                <input
                  type="color"
                  aria-label="Text color"
                  value={draft.textColor || "#f1edf7"}
                  disabled={pending}
                  onChange={(event) =>
                    update({ textColor: event.target.value })
                  }
                />
                <button
                  type="button"
                  disabled={pending || !draft.textColor}
                  onClick={() => update({ textColor: "" })}
                >
                  Original
                </button>
              </label>
              <label className="vs-appearance-color">
                <span>Glow color</span>
                <input
                  type="color"
                  aria-label="Glow color"
                  value={draft.glowColor}
                  disabled={pending}
                  onChange={(event) =>
                    update({ glowColor: event.target.value })
                  }
                />
              </label>
            </div>
          </div>
          <label className="vs-appearance-color">
            <span>Background color</span>
            <input
              type="color"
              aria-label="Background color"
              value={draft.backgroundColor || "#262132"}
              disabled={pending}
              onChange={(event) =>
                update({ backgroundColor: event.target.value })
              }
            />
            <button
              type="button"
              disabled={pending || !draft.backgroundColor}
              onClick={() => update({ backgroundColor: "" })}
            >
              Original
            </button>
          </label>
        </div>
        <div className="vs-appearance-preview">
          <div
            className="vs-preview-tabs"
            role="tablist"
            aria-label="Preview surface"
          >
            {PREVIEW_SCENES.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                tabIndex={scene === item.id ? 0 : -1}
                aria-selected={scene === item.id}
                aria-controls="vestra-appearance-sample"
                onClick={() => setScene(item.id)}
                onKeyDown={(event) => {
                  const offset =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? PREVIEW_SCENES.length - 1
                        : offset
                          ? (index + offset + PREVIEW_SCENES.length) %
                            PREVIEW_SCENES.length
                          : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    setScene(PREVIEW_SCENES[next]!.id);
                    (
                      event.currentTarget.parentElement?.children[
                        next
                      ] as HTMLButtonElement
                    )?.focus();
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            id="vestra-appearance-sample"
            role="tabpanel"
            aria-label={`${PREVIEW_SCENES.find((item) => item.id === scene)!.label} preview`}
          >
            <ThemePreviewFrame
              title={`${theme.name} appearance preview`}
              css={preview}
              scene={scene}
            />
          </div>
          <span>
            {draft.backgroundImage.startsWith("https:")
              ? "External images appear in Discord after Apply."
              : `Sample ${scene === "chat" ? "conversation" : scene === "home" ? "home page" : scene} · your account stays private`}
          </span>
        </div>
      </div>
      <div className="vs-appearance-background">
        <div>
          <strong>Background image</strong>
          <p>
            {draft.backgroundImage
              ? draft.backgroundImage.startsWith("data:")
                ? "Image saved inside your preferences · survives restarts"
                : "HTTPS image · loaded from the address you choose"
              : "Keep the theme’s backdrop, choose a picture, or add an HTTPS image URL."}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => input.current?.click()}
        >
          Choose image ↗
        </button>
        <button
          type="button"
          disabled={pending || !draft.backgroundImage}
          onClick={() => {
            update({ backgroundImage: "" });
            setImageUrl("");
          }}
        >
          Remove image
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        aria-label="Choose background image"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setPending(true);
          setError("");
          try {
            update({ backgroundImage: await readBackground(file) });
            setImageUrl("");
          } catch (problem) {
            setError(
              problem instanceof Error ? problem.message : String(problem),
            );
          } finally {
            setPending(false);
          }
        }}
      />
      <div className="vs-appearance-url">
        <input
          type="url"
          placeholder="https://…/wallpaper.webp"
          aria-label="Background image URL"
          value={imageUrl}
          disabled={pending}
          onChange={(event) => setImageUrl(event.target.value)}
        />
        <button
          type="button"
          disabled={pending || !imageUrl.trim()}
          onClick={() => {
            const parsed = ThemeCustomizationSchema.safeParse({
              ...draft,
              backgroundImage: imageUrl.trim(),
            });
            if (!parsed.success) {
              setError("Enter a valid HTTPS image URL.");
              return;
            }
            update({ backgroundImage: parsed.data.backgroundImage });
          }}
        >
          Use URL
        </button>
      </div>
      <footer>
        <div role="status">
          {error ? (
            <span role="alert">{error}</span>
          ) : (
            status ||
            (changed
              ? "Apply to update Discord. You can restore the original at any time."
              : "Start with a slider or choose your own backdrop.")
          )}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            try {
              downloadThemePackage(
                changed ? { ...theme, customization: draft } : theme,
              );
              setStatus(
                changed
                  ? "Exported with your preview changes."
                  : "Theme package exported.",
              );
            } catch (problem) {
              setError(
                problem instanceof Error ? problem.message : String(problem),
              );
            }
          }}
        >
          Export theme ↗
        </button>
        <button
          type="button"
          disabled={pending || (!theme.customization && !changed)}
          onClick={() => void save(true)}
        >
          Restore original
        </button>
        <button
          type="button"
          className="vs-appearance-apply"
          disabled={pending || !changed}
          onClick={() => void save()}
        >
          {pending ? "Saving…" : "Apply appearance"}
        </button>
      </footer>
    </section>
  );
}
