// @vestra/core discord — wrapper implementations.
// Phase 8. Each wrapper resolves its module through `WebpackFinder` with
// conservative prop filters, validates the shape structurally (so a Discord
// update degrades to `undefined` instead of a crash), then delegates through
// facades whose methods capture errors and return fallbacks. Raw module
// access stays in `webpack/`; plugins consume these facades.

import { Logger, type ScopedLogger } from "../api/logger.js";
import { Webpack, type WebpackFinder, type WebpackExports } from "../webpack/index.js";
import type {
  ChannelStoreFacade,
  DiscordChannel,
  DiscordGuild,
  DiscordReactFacade,
  DiscordUser,
  DiscordWrapper,
  DispatcherCallback,
  DispatcherFacade,
  GuildStoreFacade,
  SelectedChannelFacade,
  UserStoreFacade,
} from "./types.js";

export interface DefineWrapperOptions<T> {
  logger?: ScopedLogger | undefined;
  finder?: WebpackFinder | undefined;
  resolve: (finder: WebpackFinder) => T | undefined;
}

export interface WrapperFactoryOptions {
  finder?: WebpackFinder | undefined;
  logger?: ScopedLogger | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null
  );
}

function asIdObject(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["id"] === "string" ? value : undefined;
}

function toUser(value: unknown): DiscordUser | undefined {
  const obj = asIdObject(value);
  if (obj === undefined) return undefined;
  const user: DiscordUser = { id: obj["id"] as string };
  if (typeof obj["username"] === "string") user.username = obj["username"];
  if (typeof obj["discriminator"] === "string") user.discriminator = obj["discriminator"];
  if (typeof obj["avatar"] === "string") user.avatar = obj["avatar"];
  if (typeof obj["bot"] === "boolean") user.bot = obj["bot"];
  if (typeof obj["system"] === "boolean") user.system = obj["system"];
  return user;
}

function toChannel(value: unknown): DiscordChannel | undefined {
  const obj = asIdObject(value);
  if (obj === undefined) return undefined;
  const channel: DiscordChannel = { id: obj["id"] as string };
  if (typeof obj["type"] === "number") channel.type = obj["type"];
  if (typeof obj["name"] === "string") channel.name = obj["name"];
  if (typeof obj["guildId"] === "string") channel.guildId = obj["guildId"];
  return channel;
}

function toGuild(value: unknown): DiscordGuild | undefined {
  const obj = asIdObject(value);
  if (obj === undefined) return undefined;
  const guild: DiscordGuild = { id: obj["id"] as string };
  if (typeof obj["name"] === "string") guild.name = obj["name"];
  if (typeof obj["icon"] === "string") guild.icon = obj["icon"];
  return guild;
}

/** Generic lazy wrapper. `resolve` runs once until `reset()`. Never throws. */
export function defineWrapper<T>(name: string, options: DefineWrapperOptions<T>): DiscordWrapper<T> {
  if (name === "") throw new Error("defineWrapper() requires a non-empty name.");
  if (options === undefined || typeof options.resolve !== "function") {
    throw new Error("defineWrapper() requires a resolve function.");
  }
  const log = options.logger ?? Logger.extend(`Discord:${name}`);
  const finder = options.finder ?? Webpack;
  let cached: T | undefined;
  let settled = false;
  return {
    name,
    get(): T | undefined {
      if (settled) return cached;
      try {
        cached = options.resolve(finder) ?? undefined;
      } catch (err: unknown) {
        log.captureError(err, `Discord.${name}.resolve`);
        cached = undefined;
      }
      settled = true;
      return cached;
    },
    isAvailable(): boolean {
      return this.get() !== undefined;
    },
    reset(): void {
      cached = undefined;
      settled = false;
    },
  };
}

/**
 * Extract a module method bound to its owner. Binding matters: Flux store
 * methods read instance state through `this`, which would be lost if the
 * facade called the raw function unbound.
 */
function method(mod: WebpackExports, key: string): ((...args: unknown[]) => unknown) | undefined {
  const direct = mod[key];
  if (typeof direct === "function") {
    return (direct as (...args: unknown[]) => unknown).bind(mod);
  }
  const def = mod["default"];
  if (isRecord(def)) {
    const nested = (def as WebpackExports)[key];
    if (typeof nested === "function") {
      return (nested as (...args: unknown[]) => unknown).bind(def);
    }
  }
  return undefined;
}

/** Call a raw module method safely; fall back on any failure. */
function safeCall<T>(log: ScopedLogger, label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err: unknown) {
    log.captureError(err, label);
    return fallback;
  }
}

/** Flux UserStore: current + by-id users. */
export function createUserStore(
  options?: WrapperFactoryOptions,
): DiscordWrapper<UserStoreFacade> {
  const log = options?.logger ?? Logger.extend("Discord:UserStore");
  return defineWrapper<UserStoreFacade>("UserStore", {
    logger: log,
    finder: options?.finder,
    resolve: (finder) => {
      const mod = finder.findByProps("getCurrentUser", "getUser");
      if (mod === undefined) return undefined;
      const rawCurrent = method(mod, "getCurrentUser");
      const rawById = method(mod, "getUser");
      if (rawCurrent === undefined || rawById === undefined) return undefined;
      return {
        getCurrentUser: () =>
          safeCall(log, "UserStore.getCurrentUser", () => toUser(rawCurrent()), undefined),
        getUser: (id: string) =>
          safeCall(log, "UserStore.getUser", () => toUser(rawById(id)), undefined),
      };
    },
  });
}

/** Flux ChannelStore. */
export function createChannelStore(
  options?: WrapperFactoryOptions,
): DiscordWrapper<ChannelStoreFacade> {
  const log = options?.logger ?? Logger.extend("Discord:ChannelStore");
  return defineWrapper<ChannelStoreFacade>("ChannelStore", {
    logger: log,
    finder: options?.finder,
    resolve: (finder) => {
      const mod = finder.findByProps("getChannel", "getDMFromUserId");
      const raw = mod === undefined ? undefined : method(mod, "getChannel");
      if (mod === undefined || raw === undefined) {
        // Fallback: any module with just getChannel (narrower bundles).
        const loose = finder.findByProps("getChannel");
        const looseRaw = loose === undefined ? undefined : method(loose, "getChannel");
        if (loose === undefined || looseRaw === undefined) return undefined;
        return {
          getChannel: (id: string) =>
            safeCall(log, "ChannelStore.getChannel", () => toChannel(looseRaw(id)), undefined),
        };
      }
      const rawGet = raw;
      return {
        getChannel: (id: string) =>
          safeCall(log, "ChannelStore.getChannel", () => toChannel(rawGet(id)), undefined),
      };
    },
  });
}

/** Flux GuildStore. */
export function createGuildStore(
  options?: WrapperFactoryOptions,
): DiscordWrapper<GuildStoreFacade> {
  const log = options?.logger ?? Logger.extend("Discord:GuildStore");
  return defineWrapper<GuildStoreFacade>("GuildStore", {
    logger: log,
    finder: options?.finder,
    resolve: (finder) => {
      const mod = finder.findByProps("getGuild", "getGuildCount");
      const raw = mod === undefined ? undefined : method(mod, "getGuild");
      if (mod === undefined || raw === undefined) return undefined;
      const rawGet = raw;
      return {
        getGuild: (id: string) =>
          safeCall(log, "GuildStore.getGuild", () => toGuild(rawGet(id)), undefined),
      };
    },
  });
}

/** Selected channel / voice channel ids. */
export function createSelectedChannel(
  options?: WrapperFactoryOptions,
): DiscordWrapper<SelectedChannelFacade> {
  const log = options?.logger ?? Logger.extend("Discord:SelectedChannel");
  return defineWrapper<SelectedChannelFacade>("SelectedChannel", {
    logger: log,
    finder: options?.finder,
    resolve: (finder) => {
      const mod = finder.findByProps("getChannelId", "getVoiceChannelId");
      const rawChannel = mod === undefined ? undefined : method(mod, "getChannelId");
      const rawVoice = mod === undefined ? undefined : method(mod, "getVoiceChannelId");
      if (mod === undefined || rawChannel === undefined || rawVoice === undefined) return undefined;
      return {
        getChannelId: () =>
          safeCall(log, "SelectedChannel.getChannelId", () => {
            const v = rawChannel() as unknown;
            return typeof v === "string" ? v : undefined;
          }, undefined),
        getVoiceChannelId: () =>
          safeCall(log, "SelectedChannel.getVoiceChannelId", () => {
            const v = rawVoice() as unknown;
            return typeof v === "string" ? v : undefined;
          }, undefined),
      };
    },
  });
}

/** Flux dispatcher: dispatch + subscribe/unsubscribe. */
export function createDispatcher(
  options?: WrapperFactoryOptions,
): DiscordWrapper<DispatcherFacade> {
  const log = options?.logger ?? Logger.extend("Discord:Dispatcher");
  return defineWrapper<DispatcherFacade>("Dispatcher", {
    logger: log,
    finder: options?.finder,
    resolve: (finder) => {
      const mod = finder.findByProps("dispatch", "subscribe", "unsubscribe");
      if (mod === undefined) return undefined;
      const rawDispatch = method(mod, "dispatch");
      const rawSubscribe = method(mod, "subscribe");
      const rawUnsubscribe = method(mod, "unsubscribe");
      if (rawDispatch === undefined || rawSubscribe === undefined || rawUnsubscribe === undefined) {
        return undefined;
      }
      const unsubscribe = (type: string, callback: DispatcherCallback): void => {
        safeCall(log, "Dispatcher.unsubscribe", () => {
          rawUnsubscribe(type, callback);
        }, undefined);
      };
      return {
        dispatch: (event: Record<string, unknown>) => {
          safeCall(log, "Dispatcher.dispatch", () => {
            rawDispatch(event);
          }, undefined);
        },
        subscribe: (type: string, callback: DispatcherCallback): (() => void) => {
          safeCall(log, "Dispatcher.subscribe", () => {
            rawSubscribe(type, callback);
          }, undefined);
          return () => {
            unsubscribe(type, callback);
          };
        },
        unsubscribe,
      };
    },
  });
}

/** Discord's own React copy (hook identity matters across copies). */
export function createDiscordReact(
  options?: WrapperFactoryOptions,
): DiscordWrapper<DiscordReactFacade> {
  const log = options?.logger ?? Logger.extend("Discord:React");
  return defineWrapper<DiscordReactFacade>("React", {
    logger: log,
    finder: options?.finder,
    resolve: (finder) => {
      const mod = finder.findByProps("createElement", "Component", "useState");
      if (mod === undefined) return undefined;
      const createElement = method(mod, "createElement") as
        | DiscordReactFacade["createElement"]
        | undefined;
      const useState = method(mod, "useState") as DiscordReactFacade["useState"] | undefined;
      const component = (mod["Component"] ?? (isRecord(mod["default"]) ? mod["default"].Component : undefined)) as unknown;
      if (createElement === undefined || useState === undefined || component === undefined) return undefined;
      return { createElement, Component: component, useState };
    },
  });
}
