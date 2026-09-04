# @shiplightai/devtools-assets

The Chrome DevTools frontend, built from **this** repository and published to npm
as static assets. `shiplightai`'s local debugger serves the package's `dist/`
directory at `/devtools` and loads `inspector.html` in an iframe.

## Why this package exists

The CLI needs DevTools as *built, servable* files. Upstream's own npm package
(`chrome-devtools-frontend`) ships TypeScript **source**, not a build, so it
cannot be served to a browser as-is. This package fills that gap: the publish
workflow builds this repository and packs the output.

## Why it lives here rather than in the CLI repository

This repository is a Chromium DevTools fork carrying Shiplight's own additions —
the locator picker, the panel toggle, and websocket auto-reconnect. Publishing
from here means the published artifact and the source that produced it share a
commit, so "which source built this tarball?" is answerable by looking at the
release. It also keeps ~120 MB of BSD-3-licensed build output out of the
MIT-licensed CLI repository.

`dist/` is **never committed**. It exists only inside the publish job.

## Layout contract

The CLI resolves this package and joins `"dist"`:

```ts
path.join(path.dirname(require.resolve("@shiplightai/devtools-assets/package.json")), "dist")
```

So the build output must land at `dist/` in the published tarball. If it lands
anywhere else the CLI reports "Required peer package … is not installed", which
is a misleading error for a layout mismatch.

## Publishing

Run the **Publish devtools-assets** workflow (`workflow_dispatch`). It builds
this repository, packs the output, compares the tarball against the live npm
version, and publishes via npm trusted publishing.

The version is **not** auto-bumped — unlike the CLI and MCP release workflows.
Bump `version` in `package.json` by hand, in a PR, when you publish a new build.
The assets are pinned across many `shiplightai` releases so npm's
content-addressed cache can reuse the unchanged tarball; automatic bumps would
defeat that.

## Licensing

The build output is overwhelmingly Chromium's, under BSD-3-Clause, and
`LICENSE` accompanies it. Some files adapt Playwright code under Apache-2.0.
Shiplight's own additions live in this repository's `front_end/` sources.
