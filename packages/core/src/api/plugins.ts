import { z } from "zod";
export type { PluginSettingDefinition } from "@vestra/api";

const settingLabel = z.object({
  label: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
});
const settingDefinition = z
  .discriminatedUnion("type", [
    settingLabel.extend({ type: z.literal("boolean"), default: z.boolean() }),
    settingLabel.extend({
      type: z.literal("number"),
      default: z.number().finite(),
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
      step: z.number().positive().optional(),
    }),
    settingLabel.extend({
      type: z.literal("select"),
      default: z.string(),
      options: z
        .array(
          z.object({
            label: z.string().min(1).max(80),
            value: z.string().max(100),
          }),
        )
        .min(1)
        .max(32),
    }),
    settingLabel.extend({
      type: z.enum(["keybind", "text"]),
      default: z.string().max(500),
    }),
  ])
  .refine(
    (value) =>
      value.type !== "select" ||
      value.options.some((option) => option.value === value.default),
    "Select defaults must match an option",
  )
  .refine(
    (value) =>
      value.type !== "number" ||
      ((value.min === undefined || value.default >= value.min) &&
        (value.max === undefined || value.default <= value.max) &&
        (value.min === undefined ||
          value.max === undefined ||
          value.min <= value.max)),
    "Number defaults must be inside their range",
  );

export type PluginLifecycleFn = () => void | Promise<void>;

const lifecycleFnSchema = z.custom<PluginLifecycleFn>(
  (v) => typeof v === "function",
  { message: "Expected start/stop to be a function" },
);

export const PluginDefinitionSchema = z.object({
  name: z
    .string()
    .min(1, "Plugin name must not be empty")
    .max(64)
    .refine(
      (name) => !["__proto__", "constructor", "prototype"].includes(name),
      "Reserved plugin name",
    ),
  description: z.string().min(1, "Plugin description must not be empty"),
  authors: z
    .array(z.string().min(1, "Author name must not be empty"))
    .min(1, "Plugin must list at least one author"),
  enabledByDefault: z.boolean().optional(),
  settingsSchema: z
    .record(settingDefinition)
    .refine(
      (value) => Object.keys(value).length <= 32,
      "Too many plugin settings",
    )
    .optional(),
  start: lifecycleFnSchema.optional(),
  stop: lifecycleFnSchema.optional(),
  // Each service validates its own configuration.
  settings: z.unknown().optional(),
  patches: z.unknown().optional(),
});

export type PluginDefinition = z.infer<typeof PluginDefinitionSchema>;

/** Declare a plugin. Returns the definition unchanged, with full type inference. */
export function definePlugin<const T extends PluginDefinition>(def: T): T {
  return def;
}

/** Runtime-validate an unknown value as a plugin definition. Throws on failure. */
export function assertValidPluginDefinition(
  value: unknown,
): asserts value is PluginDefinition {
  const parsed = PluginDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid plugin definition: ${parsed.error.message}`);
  }
}
