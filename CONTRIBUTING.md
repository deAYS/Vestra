# Contributing

Small, focused changes are welcome. For a substantial feature, open an issue first
so its behavior and compatibility requirements can be discussed.

Use Node.js 22+ and Bun 1.4.3, then run `bun install --frozen-lockfile`.
`bun run preview` serves the settings playground without touching Discord.
`bun run site:preview` serves the public website.

Before opening a pull request:

```sh
bun run typecheck
bun test
bun run build
bun run test:electron
```

Run `bun run site:build` for website changes and check the layout at desktop and
mobile widths. Windows packaging changes also need `bun run manager:package`.

Explain the user-visible behavior and how you checked it. Add a regression test
when a fix depends on lifecycle ordering, IPC validation, persistence, file safety
or Discord compatibility. Cosmetic changes generally need a visual check instead.

Plugins must undo their listeners, timers, styles, observers and subscriptions in
`stop()`. Use the plugin name as the patch owner. Discord module discovery can
return `undefined`; handle that without breaking the rest of the client.

Do not include Discord tokens, private conversations, local settings, build output
or machine-specific paths. Bug reports should include Vestra/Discord versions,
the enabled plugins/theme and a minimal description of how to reproduce the issue.
