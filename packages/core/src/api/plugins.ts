import { z } from "zod";

export type PluginLifecycleFn = () => void | Promise<void>;

const lifecycleFnSchema = z.custom<PluginLifecycleFn>(
  (v) => typeof v === "function",
  { message: "Expected start/stop to be a function" },
);

export const PluginDefinitionSchema = z.object({
  name: z.string().min(1, "Plugin name must not be empty").max(64)
    .refine(name => !["__proto__", "constructor", "prototype"].includes(name), "Reserved plugin name"),
  description: z.string().min(1, "Plugin description must not be empty"),
  authors: z
    .array(z.string().min(1, "Author name must not be empty"))
    .min(1, "Plugin must list at least one author"),
  enabledByDefault: z.boolean().optional(),
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
export function assertValidPluginDefinition(value: unknown): asserts value is PluginDefinition {
  const parsed = PluginDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid plugin definition: ${parsed.error.message}`);
  }
}
