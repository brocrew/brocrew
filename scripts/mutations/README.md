# Mutation table runners

Do not copy another table's `mutate.sh`. Write the table's `mutations.py`, then create or validate
its stable runner with:

```sh
pnpm -C /absolute/path/to/your/current-brobot2-worktree run mutations:scaffold -- TABLE
```

The generated runner is an immutable shim. Put table-specific evidence in `mutations.py`, or as
comments above the shim marker. The table supplies declarative `MUTATIONS` data only; count, file
inventory, naming and prevalidated application live in `lib/table_contract.py`. Locking, controls,
project runs, reachability, active epochs, restoration and atomic publication live in
`lib/run-table.sh`. Contract changes belong in those shared files, not in a table.

The command is idempotent and validates an existing shim. It deliberately refuses to overwrite an
inline or edited runner: an old body may contain table-specific controls, and silently deleting one
could produce plausible but false evidence. A pre-shim runner therefore gets one reviewed semantic
migration; preserve its evidence prose, move any special execution behavior into the shared driver
or declarative contract, and replace only its executable body with the generated shim.

## A row that goes retired

`census.py` will not silently absorb a retirement. When a regeneration finds a row whose anchor has
stopped matching since `CENSUS.md`, it prints the row, the shape of its darkness — `file-gone`,
`anchor-absent` or `anchor-ambiguous` — and the path, and it **writes nothing**. This is the
integrator's step far more often than the author's: the row usually goes dark in somebody else's
merge, which is how `523 M15` went quiet inside `520`'s.

It cannot tell an anchor whose text MOVED from one whose subject is GONE, and it will not re-anchor
anything. Open the path, then either correct the anchor in place and re-verify that one row RED by
hand, or record the retirement by quoting back what the census measured:

```sh
pnpm -C /absolute/path/to/your/current-brobot2-worktree run mutations:census -- \
  --retire "523 M15:anchor-absent"
```

`--check` keeps its own rail for the case where nobody regenerated at all.

## Correcting an anchor in place

When the text MOVED, `reanchor.py` makes the correction where the row stands: it rewrites the
anchor literal (and, when asked, the replacement) at its exact position, puts a note above it, and
reads the table back through the contract's own loader. It reads all three row shapes. It refuses —
and writes nothing in any table — when the new anchor does not match its file exactly once, when the
literal is a constant another row reads, or when it is an expression rather than a literal.

```sh
python3 scripts/mutations/reanchor.py specs.json --by 716 [--dry-run]
# specs.json: [{"table": "310", "row": "M4", "edit": 0, "anchor": "…", "note": "why it moved"}]
```

It does not verify anything RED. A corrected anchor keeps a verdict it never earned, so re-verify
each row it corrected with `verify_row.py TABLE ROW`.

## Running a table that holds one

A recorded retirement is a fact the RUNNER reads, not only the census. `run-table.sh` passes
`--table` to the shared contract, which reads that table's `retirements` out of `ATTESTATION.json`
and declines exactly those rows: the row still gets its header in `mutations.txt`, its body says
`RETIRED · <reason> · not run`, and the artefact's last line reports three numbers —
`N rows defined · M run · K retired and not run`. `--count` is unchanged and still answers how
many rows the table HAS; a run's coverage is the middle number.

Declining is narrow on purpose, and both halves matter:

- a dead anchor the census has **not** recorded still refuses the whole table, exactly as before.
  That refusal is how an integrator learns a row went quiet in somebody's merge;
- a row recorded one way and dark **another** way — `anchor-absent` recorded, `anchor-ambiguous`
  today — is a second accident and refuses too. That is what the reason beside the id is for;
- a recorded row whose anchor has come back is run, not declined.

To check a table by hand the way the driver does, name it:

```sh
python3 scripts/mutations/lib/table_contract.py scripts/mutations/TABLE/mutations.py \
  --dry-run . --table TABLE
```

Without `--table` nothing is read and nothing is declined, which is the pre-`596` behaviour and
still the right check when you want every row proved applicable.

## A row is measured by its killers (W4.36)

Until W4.36 every row ran five WHOLE Vitest projects — about a whole suite per row. Now each row
runs only the test files its label names as killers (`killed by \`file.test.ts\``, the convention
`verify_row.py`reads), grouped by the project each file belongs to, against a pristine baseline of
exactly those files.`lib/killers.py` reads the labels for both tools.

- **A row that names no killer** — or a name that matches no file, several files, or a gate-only
  test — falls back to its reachable projects, run whole, as before. The artefact says how many
  rows did, and why, before M0.
- **A whole run** (no row indices) still runs every project whole for its baselines and for the M0
  and M-END controls, plus every killer group; only a whole run is published as `mutations.txt`.
- **Every Vitest is gentle by itself**: `mutation_vitest` runs at `nice -n 15` with
  `VITEST_MAX_WORKERS` at 2 unless the caller set it; `verify_row.py` does the same.

See what a row would run, with nothing applied and nothing run:

```sh
python3 scripts/mutations/lib/killers.py commands TABLE [ROW ...]
```

### Every run is bounded (W4.91)

`mutation_vitest` runs Vitest through `lib/bounded.py`: a run over named test files is stopped at
600 s (`verify_row.py`'s own bound), a whole project at 1800 s — `MUTATION_FILE_RUN_BOUND_S` and
`MUTATION_PROJECT_RUN_BOUND_S` override them. A run past its bound is stopped with its whole process
group and reads `NO-REPORT (ran past its … s bound and was stopped — NOT MEASURED …)`: never a kill,
never a survivor, and the census counts the row as non-evidentiary.

### Batches that fit one call

A run given row indices is a BATCH: diagnostic, written to `mutations.txt.partial`, never published.
A batch whose rows all name their killers runs its baselines and controls over those killer groups
only, so it costs a few killer-file runs per row. Keep a batch to what fits about seven minutes —
a few rows; time one row with `verify_row.py` first if unsure.

```sh
scripts/mutations/742/mutate.sh 0 1 2
python3 scripts/mutations/lib/killers.py remaining 742   # the indices no batch has measured yet
scripts/mutations/742/mutate.sh 3 4 5
```

To resume after a stop, ask `remaining` again: it reads every batch log of the table (the next
batch keeps the last one as `mutations.txt.partial.interrupted*`), counts a row only when its record
followed its header, and prints the indices still to run. A batch holding a fallback row runs whole
controls, so give fallback rows a call of their own or verify them with `verify_row.py --killer`.

## Branch handoff

Code absent from an old branch cannot warn that branch about a future contract. Before final
handoff, merge or rebase the Project Manager's named target commit and prove that target is an
ancestor of the result. Then run the current tree's scaffold and gates while the originating seat
still owns the branch:

```sh
git merge-base --is-ancestor TARGET_SHA HEAD
pnpm -C /absolute/path/to/your/current-brobot2-worktree run mutations:scaffold -- TABLE
pnpm -C /absolute/path/to/your/current-brobot2-worktree run mutations:check
pnpm -C /absolute/path/to/your/current-brobot2-worktree run ci
```

Read CI's first package line and confirm it names this mutation worktree. If the target moves after
that proof, the integration merge repeats these gates and returns any failure to the seat while it
still owns the work. No script that is absent from a stale commit can enforce this synchronization;
the named-target ancestry check is the handoff boundary that makes the current gate available.

The shim is what removes the recurring collision after this transition: it contains no evolving
contract hooks, so merging a newer shared driver needs no table edit. The v1 three-line shim ABI is
permanent: future behavior is additive in the shared driver, or uses a new shim version while the
driver continues to accept v1.

Changing only runner orchestration does not retroactively change accurately scoped targeted row
observations. It also does not promote them: a table without canonical M0/M-END evidence still needs
a whole no-argument run under the current driver before `mutations.txt` may be published.
