# Reload product checks

Windows 0.1.8 runs the controlled main-app reload journey in its own scratch package. It exercises the actual RuntimeHost queue, restricted preload IPC, three pending sends across retirement, native database closure and native app closure. The cold fixture module input hashes in `reload-inputs.json` remain checked before projection and removal.

The installed SDK branch roles run their separate start/reload probe. They retain pinned SDK/CLI versions, installed dependency integrity, a fulfilled reload acknowledgement within ten seconds, and child/fixture cleanup. Their results do not borrow success from the catalogue or controlled fixture.

Both validators take the tested checkout SHA and product summaries directly:

```sh
node scripts/gates/plugin-v2/verify-reload.mjs <source-sha> <catalogue-summary.json> <reload-summary.json>
node scripts/gates/plugin-v2/verify-reload.mjs sdk <source-sha> <sdk-summary.json>
```

The source SHA must match the result. Product behavior and cleanup must pass. Workflow job timeouts and the existing branch roles remain in place. Native execution, installed SDK execution and final release qualification require their actual hosted results.
