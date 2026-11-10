# Previous configuration dependencies

Configuration schemas/read/apply and ledger copied from source1b224f09c4c0b183196bd4a5dfe6ccd17cc19743 for actual previous-reader/migration tests. Only imports are relocated, except adapters: its configuration entries are the same and the older cleanup dependency is wired to the already frozen plugin-delete-parent implementation. No production code imports these modules.

Existing historic controller/person/settings snapshots now import these test-only dependencies instead of deleted live production modules. Their legacy removal type is kept in legacy-settings.ts. Source manifests retain the original hashes and update import relocation maps. No legacy command is run by the new ledger, which reads only envelope/revision/hash continuity and writes consumed checkpoints.
