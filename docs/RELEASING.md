# Releases and website

## Windows release

Build from a clean checkout with Node.js 22+ and Bun 1.4.3:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run test:electron
bun run manager:package
npm pack ./packages/api
```

The Setup and Portable executables are created in `apps/manager/release`.
The SDK tarball is separate. These commands do not publish a release or npm package.
Current Windows builds are unsigned.

The `Draft release` workflow runs for a version tag such as `v0.1.0-alpha.1` and
requires the tag to match the root package version. It builds, tests, packages and
creates a **draft prerelease** containing the Windows executables, SDK tarball
and SHA-256 checksums. Review the draft before making it public.

Keep runtime versions in the root, apps and host packages aligned. The SDK uses
its own package version and the host API compatibility major. Do not claim that
the npm SDK is available until it has actually been published by the scope owner.

## GitHub Pages

The website source is `site/`. `bun run site:build` produces `site/dist`, copying
the brand, settings screenshot, shared splash implementation and the four actual
CSS presets. Download buttons therefore use the same themes as the client.

Preview it with `bun run site:preview`, then open
`http://127.0.0.1:4180/Vestra/`. All assets use relative paths so the project
subdirectory works. The page uses no remote fonts, analytics or third-party scripts.

For `deAYS/Vestra`, enable **Settings → Pages → Build and deployment → Source →
GitHub Actions**. The `Publish website` workflow builds the site and deploys it
through the `github-pages` environment after relevant pushes to `main` or manual
dispatch. Its target URL is `https://deays.github.io/Vestra/`.

See [GitHub's custom Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
for the required Pages/OIDC permissions and deployment environment.

For a fork, update the repository links, canonical/social URLs and Pages target.
The CI workflow only verifies and uploads build artifacts. The release workflow
creates drafts; the Pages workflow publishes the website when enabled.
