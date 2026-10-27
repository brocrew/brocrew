# Recovery retention mutation evidence

All 13 rows in table 4007 were measured RED with `scripts/mutations/verify_row.py` on fictional workspaces. Each named killer was GREEN before mutation; the verifier restored and hashed each target after its row. Both verifier invocations exited 0.

These are individual row proofs. The full `mutate.sh` whole-repository controls were not run; the census correctly lists the table as unrun because there is no published `mutations.txt`.

| Row | Result | An assertion that noticed the defect                                                                                              |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| M1  | RED    | prune keeps one newest intact offerable copy across migration counts                                                              |
| M2  | RED    | recovery copy expiry and Settings keeps the last copy until exactly three days, then removes it                                   |
| M3  | RED    | recovery copy expiry and Settings expires after three successful starts of its new version and does not recreate it on the fourth |
| M4  | RED    | recovery copy expiry and Settings expires after three successful starts of its new version and does not recreate it on the fourth |
| M5  | RED    | retention safety boundaries does not count checks, failed opens, other versions, or earlier copies toward a new copy              |
| M6  | RED    | retention safety boundaries never counts or deletes during history-only.json                                                      |
| M7  | RED    | recovery copy expiry and Settings Settings delete refuses stale ids, damage, extra personal files and unreadable manifests        |
| M8  | RED    | recovery copy expiry and Settings Settings delete refuses stale ids, damage, extra personal files and unreadable manifests        |
| M9  | RED    | shows copy size and expiry; Delete now waits, reports failures, and refreshes on success                                          |
| M10 | RED    | shows copy size and expiry; Delete now waits, reports failures, and refreshes on success                                          |
| M11 | RED    | shows copy size and expiry; Delete now waits, reports failures, and refreshes on success                                          |
| M12 | RED    | a copy before a migration keeps a lone copy and uses only the first sentence when none can be pruned                              |
| M13 | RED    | does not repeatedly retry a copy that safety checks kept after its expiry                                                         |

Commands, each through default-local pace and shared heavy-run at nice 15:

```sh
python3 scripts/mutations/verify_row.py 4007 M1 M2 M3 M4 M5 M6 M7 M8 M9 M10 M11 M12 --json evidence/4007-verified.json
python3 scripts/mutations/verify_row.py 4007 M13 --json evidence/4007-M13-verified.json
```

M1–M12 definitions are byte-for-byte equal as parsed data to their definitions at `ba1b17d`; M13 adds the timer regression. Source changes after the first measurement were limited to the timer helper, its launch wiring, its test and its own row. Existing measured checkpoint/UI/coordinator targets did not change.

This index is kept on W4.1316. Raw evidence remains in this worktree’s `evidence/` folder:

- `evidence/4007-verified.json`: SHA-256 `61ba05c9cba84aa6e06c3dc2e3e5b46c45a067bbb81e99c4d03a62fb263026f5`
- `evidence/4007-M13-verified.json`: SHA-256 `17cd5fb764876104112dc518c253d9caf61c545ff144f46e7530846a8d2c96ed`
