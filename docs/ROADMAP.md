# Roadmap

## Available in the alpha

- Windows Manager with Stable as the default, backup, installation, check, repair and uninstall.
- A guarded sandbox-compatible renderer bootstrap and dismissible startup animation.
- Four curated themes, CSS import, live QuickCSS and saved theme migration.
- Nine built-in plugins, a draggable launcher and keyboard-accessible settings.
- A standalone typed plugin SDK and builder.
- Setup/Portable packaging, regression checks and a GitHub Pages website.

## Next

- Verify compatibility against new Discord versions and expand the built-in utilities.
- Add a native Discord settings entry with a fallback when its internal modules change.
- Add plugin capability declarations, resource scopes and lifecycle cancellation.
- Coordinate preferences across multiple windows and formalize account/session migration.
- Add bounded downloads, signed feeds and atomic staging before opening a public plugin marketplace.
- Add Windows code signing and release provenance.
- Publish the SDK after confirming ownership of the npm scope.

BetterDiscord and Vencord plugins require adapters. Existing store and updater
tools provide local feed/envelope primitives; they are not a public marketplace.
Native updater installation currently reports an unsupported operation rather
than claiming that an update was applied.
