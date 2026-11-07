# Chrome releases

Production uses the unsigned repository list described in [plugin-production.md](contracts/plugin-production.md). Users install from Settings → Plugins.

`scripts/export-chrome-plugin.mjs` prepares the standalone Chrome source repository and its release workflow. The workflow builds archives with `scripts/build-plugin-release.mjs`, verifies their bytes and source commit, runs the fake-browser tests and publication guards, and emits the plugin-list entry. Manual dispatch runs the build-only job; a version tag selects publication.

For author-bearing archives, the dispatch-only `plugin-archive-dry-run.yml` workflow exercises the canonical source pin and format-2 catalogue verification before publication. App-level archive verification and lifecycle tests remain in this repository. These source and fake-browser checks do not establish packaged app or real-browser qualification.
