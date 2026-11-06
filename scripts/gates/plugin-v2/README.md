# Plugin v2 product gate

The Mac and Windows `plugin-v2-review` jobs run through `workflow_dispatch` on their existing `gate/plugin-v2-*` branches. They stay outside release dependencies and retain their job timeouts.

The checkout HEAD must match `GITHUB_SHA`. That tested source SHA travels in `observedIdentity.routeCommit` through staging, installation and each result. The 0.1.8 app uses that source; the 0.1.7 comparison keeps its published source. Staging overlays tracked gate files from the tested checkout into a separate scratch clone.

The gate checks real HTTPS catalogue/archive downloads before projecting the fixed candidate list. Candidate and downloaded archive integrity, normal-build refusal, packaged bundle paths, plugin Review/cancel/confirm/manage/remove behavior, native details, and process closure checks remain required. Child output is printed unchanged to stderr so staging stdout can carry its control directory.

Validate a downloaded catalogue summary with the tested source SHA:

```sh
node scripts/gates/plugin-v2/verify-operation.mjs <source-sha> <summary.json>
```

No operator contract or broker receipt is needed. Public checks run through their own workflow. A catalogue result covers its measured platform and app version; it does not establish the SDK/reload results or a normal postpublication journey.

Run the bounded source controls with:

```sh
node --test --test-concurrency=1 scripts/gates/plugin-v2/controls.test.mjs scripts/gates/plugin-v2/source-binding.test.mjs scripts/gates/plugin-v2/reload-controls.test.mjs scripts/gates/plugin-v2/native-dependency.test.mjs
```
