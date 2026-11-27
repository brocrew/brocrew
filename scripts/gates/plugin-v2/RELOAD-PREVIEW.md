# Reload product checks

The Windows plugin review runs the controlled main-app reload journey in its own scratch package of the tested source. It exercises the actual RuntimeHost queue, restricted preload IPC, a plugin reload held past the 60-second limit card 197 removed, two sends queued while it is held, the CLI's exit ending it, delivery of all three in the person's order on a fresh resume, native database closure and native app closure. The cold fixture module input hashes in `reload-inputs.json` remain checked before projection and removal.

The validator takes the tested checkout SHA and both product summaries directly:

```sh
node scripts/gates/plugin-v2/verify-reload.mjs <source-sha> <catalogue-summary.json> <reload-summary.json>
```

The source SHA must match the result. Product behavior and cleanup must pass. Native execution requires its actual hosted result.
