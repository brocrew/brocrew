# Chrome releases

Production uses the unsigned repository list described in [plugin-production.md](contracts/plugin-production.md). Users install from Settings → Plugins.

`scripts/export-chrome-plugin.mjs` prepares the standalone Chrome source repository and its release workflow. The workflow builds archives with `scripts/build-plugin-release.mjs`, records the checked-out revision, runs the fake-browser tests, and emits the plugin-list entry. Manual dispatch runs the build-only job; a version tag selects publication.

App-level archive verification and lifecycle tests remain in this repository. These source and fake-browser checks do not establish packaged app or real-browser qualification.
