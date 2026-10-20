import {
  createChannelStore,
  createDispatcher,
  createDiscordReact,
  createGuildStore,
  createSelectedChannel,
  createUserStore,
  defineWrapper,
} from "./wrappers.js";

export const UserStore = createUserStore();
export const ChannelStore = createChannelStore();
export const GuildStore = createGuildStore();
export const SelectedChannel = createSelectedChannel();
export const Dispatcher = createDispatcher();
export const DiscordReact = createDiscordReact();

/** Everything Discord: stores, dispatcher, React copy, wrapper factory. */
export const Discord = {
  UserStore,
  ChannelStore,
  GuildStore,
  SelectedChannel,
  Dispatcher,
  React: DiscordReact,
  defineWrapper,
  /** Drop all wrapper caches (call after a Discord bundle reload). */
  resetAll(): void {
    UserStore.reset();
    ChannelStore.reset();
    GuildStore.reset();
    SelectedChannel.reset();
    Dispatcher.reset();
    DiscordReact.reset();
  },
};

export type DiscordAPI = typeof Discord;

export { defineWrapper } from "./wrappers.js";
export type { DefineWrapperOptions, WrapperFactoryOptions } from "./wrappers.js";
export {
  createChannelStore,
  createDispatcher,
  createDiscordReact,
  createGuildStore,
  createSelectedChannel,
  createUserStore,
} from "./wrappers.js";
export type {
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
