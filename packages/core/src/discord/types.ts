// @vestra/core discord — public wrapper types.
// Phase 8 (roadmap #8). Minimal structural facades over Discord internals.
// Fields are optional beyond `id` because Discord's shapes drift; wrappers
// validate structure at resolve time and degrade to undefined at call time.

/** Lazily resolved, cached handle. Never throws on lookup. */
export interface DiscordWrapper<T> {
  readonly name: string;
  /** Resolve now (cached). Undefined when the bundle lacks/changes the module. */
  get(): T | undefined;
  isAvailable(): boolean;
  /** Drop the cache so the next `get()` rescans (bundle reloads). */
  reset(): void;
}

export interface DiscordUser {
  id: string;
  username?: string;
  discriminator?: string;
  avatar?: string;
  bot?: boolean;
  system?: boolean;
}

export interface UserStoreFacade {
  getCurrentUser(): DiscordUser | undefined;
  getUser(id: string): DiscordUser | undefined;
}

export interface DiscordChannel {
  id: string;
  type?: number;
  name?: string;
  guildId?: string;
}

export interface ChannelStoreFacade {
  getChannel(id: string): DiscordChannel | undefined;
}

export interface DiscordGuild {
  id: string;
  name?: string;
  icon?: string;
}

export interface GuildStoreFacade {
  getGuild(id: string): DiscordGuild | undefined;
}

export interface SelectedChannelFacade {
  getChannelId(): string | undefined;
  getVoiceChannelId(): string | undefined;
}

export type DispatcherCallback = (event: Record<string, unknown>) => void;

export interface DispatcherFacade {
  dispatch(event: Record<string, unknown>): void;
  /** Subscribe; returns an unsubscribe function. */
  subscribe(type: string, callback: DispatcherCallback): () => void;
  unsubscribe(type: string, callback: DispatcherCallback): void;
}

export interface DiscordReactFacade {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  Component: unknown;
  useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void];
}
