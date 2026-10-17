"""360 · The reap that said COMPLETE while Codex was still unpacking — freezing the tree, and the
sentence that accused a process on the strength of our own footprints.

⛔ **`window:check` failed a merge with `ENOTEMPTY` and the harness said the right thing: do not
re-run and call it green.** This table is about the two rules that came out of measuring it.

## ⚑ What the measurement found, because it decides what each row is worth

⛔ **`window:check` starts provider children on every launch, and its own docblock said it did not.**
The launcher screen asks for the model catalogue on mount (`RuntimeScreen` → `models` →
`RuntimeHost.askProviderForModels`), with no gesture from anybody. Sampled every 150 ms across 50
interleaved runs at `cf87667` on a loaded machine: **a `codex app-server` and a Claude CLI child for
every one of the 23 launches seen on one tree and all 22 on the other**. `codex-transport` spawns its
child
`detached: true`, so it leads its OWN process group — the teardown's group signal never reaches it,
and only a `remember()` can. `adopt/user-homes.ts` measured what such a child writes before it is
asked anything: **71 files**, including the whole `skills/.system` tree, into the very directory the
check is about to remove.

⚠️ **And it is load-gated.** At load 34-90 the same probe saw none of them: the teardown landed in
0.5 to 2.6 s, before the launcher's watcher fired. At load 92-195 it took 6 to 17 s and the child was
always there — which is to say the race is not rare, it is busy-machine-shaped.

⚑ **So `333`'s sentence — *"it shrinks that window; it does not close it"* — was the defect.** A
window that is only small is a window the machine's load decides.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M13` | ⚑ **`scripts/test/owned-process.test.mjs`** — the freeze, its refusals and its bound |
| `M14`-`M20` | ⚑ **`scripts/test/owned-teardown.test.mjs`** — what a survivor's mtime can prove |
| `M21`-`M24` | ⚑ **`scripts/test/owned-teardown.test.mjs`**, the three-gate source census |

⚠️ **`M21`-`M24` are killed by a SOURCE assertion and that is deliberate** (310). `outcome.refused`
is populated only when a real teardown cannot freeze a real tree — something no unit test on this
machine will cause and `ci` will almost never see. A guard only a live run can trip is dark by
default, so what `ci` can check is that the gate still says it.

## ⛔ What has no row here, and why

⛔ **No row on the `try`/`catch` that used to wrap the freeze.** It was written, and then removed:
every seam `quiesce` reaches already contains its own failure, so nothing could reach the `catch` and
no mutation could have killed it. A line no mutation can kill is not carrying its rule.

⛔ **No row on `Math.round` in the survivor offsets.** It is legibility, not a rule — the assertion
that would kill it is one about decimal places, and pinning that would pin the formatting of a line
whose content is the point.

⚠️ **No row asserting the app STOPS spawning provider children.** That is the product's behaviour and
this dispatch does not change it; the reap is what had to become able to see it.

## ⚑ Anchors moved by 387, and re-verified rather than assumed

⛔ **`M14`, `M15` and `M17` were re-anchored on 2026-09-08** and each was re-run alone against its
killer file and confirmed RED. ⚠️ A corrected anchor otherwise keeps a verdict it never earned: the
row is applied to a line it has never been applied to, and the table's green is the OLD line's.

- `M14`/`M15` · `387` split the `written` filter across three lines and gave it a threshold of
  `askedAt + A_WHOLE_MILLISECOND`. **The rule is unchanged** — a directory must not be counted as a
  writer — and the replacements say the same thing about the new line.
- `M17` · the per-entry line no longer re-reads the mtimes; it is derived from the `written` and
  `stamped` lists the summary counted, which is this row's own defect said as structure. ⛔ The row
  stays, because the two branches can still be written to say each other's sentence, and that is the
  summary and the list disagreeing.
- `M16` · **untouched.** Its line is byte-identical after 387: the `stamped` filter keeps `>= askedAt`
  with no headroom, because a directory's late mtime accuses nobody.
"""

OP = "scripts/lib/owned-process.mjs"
OT = "scripts/lib/owned-teardown.mjs"
WIN = "scripts/window-opens-check.mjs"
QUIT = "scripts/app-closes-check.mjs"
FIX = "scripts/fixture-follow-check.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the freeze itself, which is the whole fix ────────────────────────────────────────
    (
        "M1 · 🔴 the crash path never freezes, so the scan runs against a tree that can still "
        "spawn · 333's window, exactly as it was",
        [(OP, "    if (crash) quiesce(refused, discover)", "    if (false) quiesce(refused, discover)")],
    ),
    (
        "M2 · ⛔ the GRACEFUL path freezes too, so an app asked to quit is stopped before it can",
        [(OP, "    if (crash) quiesce(refused, discover)", "    if (true) quiesce(refused, discover)")],
    ),
    (
        "M3 · ⚠️ the freeze is a SIGTERM, so the tree is asked to end rather than held still — and "
        "an app that ends on its own schedule is the schedule the removal was racing",
        [(OP, "signalSaved(identity, 'SIGSTOP', options)", "signalSaved(identity, 'SIGTERM', options)")],
    ),
    (
        "M4 · ⛔ the launcher is frozen by pid, so every helper in its group runs on through the scan",
        [
            (
                OP,
                "    if (launcher.pgid === launcher.pid) freeze(launcher, refused, { group: true })",
                "    if (launcher.pgid === launcher.pid) freeze(launcher, refused, {})",
            )
        ],
    ),
    (
        "M5 · 🔴 a child already remembered is never frozen — the detached `codex app-server` leads "
        "its own group, so the group signal is not a second chance at it",
        [
            (
                OP,
                "    for (const identity of [...remembered.values()]) {\n      freeze(identity, refused, { allowInitReparent: true })\n    }",
                "    for (const identity of []) {\n      freeze(identity, refused, { allowInitReparent: true })\n    }",
            )
        ],
    ),
    (
        "M6 · ⛔ what the scan finds is remembered and never frozen, so it writes on between being "
        "seen and being killed",
        [
            (
                OP,
                "      for (const identity of fresh) freeze(identity, refused, { allowInitReparent: true })",
                "      for (const identity of []) freeze(identity, refused, { allowInitReparent: true })",
            )
        ],
    ),
    (
        "M7 · ⚠️ one pass only, so a grandchild spawned by the detached child before ITS freeze is "
        "never seen · the reason the bound is not 1",
        [(OP, "for (let pass = 0; pass < FREEZE_PASSES; pass += 1)", "for (let pass = 0; pass < 1; pass += 1)")],
    ),
    (
        "M8 · ⛔ the loop never settles early, so a tree that quiesced on the first pass is reported "
        "as one that would not settle at all",
        [(OP, "      if (fresh.length === 0) return", "      if (false) return")],
    ),
    # ── §2 · the third answer ─────────────────────────────────────────────────────────────────
    (
        "M9 · 🔴 a freeze the KERNEL refused is not a refusal, so the teardown says complete about a "
        "tree it could not hold still",
        [
            (
                OP,
                "    if (state.kind === 'unverifiable' || state.kind === 'unsignallable') {",
                "    if (false) {",
            )
        ],
    ),
    (
        "M10 · ⚠️ every non-signal is a refusal, so a launch that has already ENDED can never be "
        "reaped cleanly · a gate nobody can get green",
        [
            (
                OP,
                "    if (state.kind === 'unverifiable' || state.kind === 'unsignallable') {",
                "    if (true) {",
            )
        ],
    ),
    (
        "M11 · ⛔ a refusal does not stop completion, so the caller removes the directory anyway",
        [
            (
                OP,
                "      complete: last.complete && discoveryComplete && refused.length === 0,",
                "      complete: last.complete && discoveryComplete,",
            )
        ],
    ),
    (
        "M12 · ⚠️ the refusals never reach the caller, so the red line says which pids it counted "
        "and never what it could not ask",
        [(OP, "      refused: Object.freeze([...refused]),", "      refused: Object.freeze([]),")],
    ),
    (
        "M13 · ⛔ a tree that will not settle is passed over in silence rather than refused",
        [
            (
                OP,
                "    refused.push(\n      `the descendant scan was still finding processes nobody had frozen after `",
                "    ;[].push(\n      `the descendant scan was still finding processes nobody had frozen after `",
            )
        ],
    ),
    # ── §3 · what a survivor's mtime can and cannot prove ─────────────────────────────────────
    (
        "M14 · 🔴 directories count as writers again, so a removal's own unlinks are reported as a "
        "process · the sentence that opened this dispatch",
        [
            (
                OT,
                "    (entry) => entry.isDirectory !== true && entry.mtimeMs >= askedAt + A_WHOLE_MILLISECOND,",
                "    (entry) => entry.mtimeMs >= askedAt + A_WHOLE_MILLISECOND,",
            )
        ],
    ),
    (
        "M15 · ⛔ only directories count, so a real late FILE — the one thing that can carry the "
        "claim — is dropped from it",
        [
            (
                OT,
                "    (entry) => entry.isDirectory !== true && entry.mtimeMs >= askedAt + A_WHOLE_MILLISECOND,",
                "    (entry) => entry.isDirectory === true && entry.mtimeMs >= askedAt + A_WHOLE_MILLISECOND,",
            )
        ],
    ),
    (
        "M16 · ⚠️ the directories are counted and never mentioned, so a reader is left to wonder why "
        "half the tree has a fresh mtime and nothing is accused",
        [
            (
                OT,
                "  const stamped = left.filter((entry) => entry.isDirectory === true && entry.mtimeMs >= askedAt)",
                "  const stamped = []",
            )
        ],
    ),
    (
        "M17 · ⛔ the per-entry line calls a stamped directory a write, so the summary and the list "
        "under it say different things",
        [
            (
                OT,
                "                  : stamped.includes(entry)\n                    ? ` \u2190 a directory whose mtime moved ${String(Math.round(entry.mtimeMs - askedAt))}ms after the ask; our own unlinks do that (360)`",
                "                  : stamped.includes(entry)\n                    ? ` \u2190 written ${String(Math.round(entry.mtimeMs - askedAt))}ms AFTER the removal was asked`",
            )
        ],
    ),
    (
        "M18 · 🔴 the survivor walk stops saying which entries are directories, so every rule above "
        "it is answering about a field nobody fills in",
        [
            (
                OT,
                "      found.push({ path, mtimeMs: stats.mtimeMs, isDirectory: stats.isDirectory() })",
                "      found.push({ path, mtimeMs: stats.mtimeMs, isDirectory: false })",
            )
        ],
    ),
    (
        "M19 · ⛔ an entry whose mtime could not be READ is stamped with the walk's own clock, so a "
        "permissions problem becomes a process · the accusation, from the other direction",
        [
            (
                OT,
                "        path: `${relative}/ (could not be listed: ${errorCode(error)})`,\n        mtimeMs: 0,",
                "        path: `${relative}/ (could not be listed: ${errorCode(error)})`,\n        mtimeMs: Date.now(),",
            )
        ],
    ),
    (
        "M20 · ⛔ the directory comes off whatever the reap said · 325's rule, which the third answer "
        "rides on",
        [
            (
                OT,
                "  if (!outcome.complete) return Object.freeze({ ...outcome, removed: false })",
                "  if (false) return Object.freeze({ ...outcome, removed: false })",
            )
        ],
    ),
    # ── §4 · the gates still say it ───────────────────────────────────────────────────────────
    (
        "M21 · ⛔ `window:check` stops printing what the teardown refused to decide about",
        [(WIN, "    refusals(outcome)", "    ''")],
    ),
    (
        "M22 · ⛔ `quit:check` stops printing it",
        [(QUIT, "    refusals(outcome)", "    ''")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `scripts/fixture-follow-check.mjs` is
        # deleted; owned-teardown.test.mjs records 'fixture:check left the chain at D-016 with the
        # demo seed it followed', and the package.json script is gone. The row has no file to plant.
        # Its anchor is left stale, so the census records it retired.
        "M23 · ⛔ `fixture:check` stops printing it",
        [(FIX, "    refusals(outcome)", "    ''")],
    ),
    (
        "M24 · ⚠️ the clause is there and always empty, so the gate carries a sentence it can never "
        "say",
        [(WIN, "    outcome.refused.length === 0", "    true")],
    ),
    # ── §5 · the message a person actually reads ──────────────────────────────────────────────
    (
        "M25 · 🔴 the survivors are printed in walk order, so the one FILE that carries the writer "
        "claim falls off a 25-entry cap behind forty directories",
        [
            (
                OT,
                "  const shown = [...written, ...left.filter((entry) => !written.includes(entry))].slice(\n    0,\n    MAX_SURVIVORS_SHOWN,\n  )",
                "  const shown = left.slice(0, MAX_SURVIVORS_SHOWN)",
            )
        ],
    ),
    (
        "M26 · ⛔ the writer sentence stops saying how many of the survivors are its OWN footprints, "
        "so `2 files` and `55 entries` are left to be read as one number · the sentence this "
        "dispatch is named after",
        [
            (
                OT,
                "        (stamped.length > 0\n          ? ` \u26a0\ufe0f ${String(stamped.length)} more `",
                "        (false\n          ? ` \u26a0\ufe0f ${String(stamped.length)} more `",
            )
        ],
    ),
]
