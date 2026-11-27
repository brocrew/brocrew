# Plugin review

BroCrew's one hosted plugin check, run by `.github/workflows/plugin-review.yml`. The Windows job runs on every push to `main` that touches the plugin area, and on `workflow_dispatch` before a plugin release. The Mac job runs only on `workflow_dispatch`, because hosted Mac runners are paid. Both keep their job timeouts.

The checkout HEAD must match `GITHUB_SHA`. That tested source SHA travels in `observedIdentity.routeCommit` through staging, installation and each result. The app is that source, built with its own `apps/desktop/package.json` version.

The run reads the public plugin lists (`catalogue.json` and `catalogue-v2.json`) once over HTTPS, downloads this platform's Chrome and WhatsApp archives, and verifies them against what the list says. The versions, authors and permissions the Review must show come from that read. The packaged app then reads the same public lists itself. In it, each plugin is reviewed, cancelled with nothing installed, refused with stale consent, confirmed, running, restarted, configured (WhatsApp's Configure page shows it not linked) and removed. Native details, the package's binding to the built bundles and process closure stay required. Child output goes unchanged to stderr, so staging stdout can carry its control directory.

The Windows job also runs the controlled main-app reload journey; see `RELOAD-PREVIEW.md`.

Validate a downloaded summary against the tested source SHA:

```sh
node scripts/gates/plugin-v2/verify-operation.mjs <source-sha> <summary.json>
```

Run the bounded source controls with:

```sh
node --test --test-concurrency=1 scripts/gates/plugin-v2/controls.test.mjs scripts/gates/plugin-v2/source-binding.test.mjs scripts/gates/plugin-v2/reload-controls.test.mjs scripts/gates/plugin-v2/native-dependency.test.mjs
```
