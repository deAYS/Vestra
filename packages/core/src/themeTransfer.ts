import { z } from "zod";
import {
  ThemeCustomizationSchema,
  type Theme,
  type SettingsStore,
} from "./api/settings.js";

export const MAX_THEME_PACKAGE_BYTES = 3_000_000;
const ThemePackage = z.object({
  format: z.literal("vestra-theme"),
  version: z.literal(1),
  theme: z.object({
    name: z.string().trim().min(1).max(120),
    author: z.string().max(120),
    css: z
      .string()
      .min(1)
      .max(512_000)
      .refine((value) => value.trim().length > 0),
    customization: ThemeCustomizationSchema.optional(),
  }),
});

export function exportThemePackage(theme: Theme): string {
  return JSON.stringify(
    ThemePackage.parse({ format: "vestra-theme", version: 1, theme }),
    null,
    2,
  );
}

export function importThemePackage(
  settings: SettingsStore,
  source: string,
): Theme {
  if (new TextEncoder().encode(source).length > MAX_THEME_PACKAGE_BYTES)
    throw new Error("Theme packages must be smaller than 3 MB.");
  const parsed = ThemePackage.safeParse(JSON.parse(source));
  if (!parsed.success)
    throw new Error("This is not a supported Vestra theme package.");
  if (settings.getThemes().length >= 32)
    throw new Error("Your library is full (32 themes).");
  const theme: Theme = {
    ...parsed.data.theme,
    id: `theme-${crypto.randomUUID()}`,
    enabled: false,
  };
  settings.setThemes([...settings.getThemes(), theme]);
  return theme;
}

export function downloadThemePackage(theme: Theme): void {
  const data = exportThemePackage(theme);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download =
    (theme.name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\.\./g, "-")
      .slice(0, 90) || "theme") + ".vestra-theme.json";
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
