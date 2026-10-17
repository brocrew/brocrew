"""717 · The gate-only test split, a compacting pill, and the live batch.

⚑ **Ordered by** the PM — runtime-dev-2's `706` F-2 and F-3 (ruled R45, R46), runtime-dev's `713`
F-1 and F-3.

## 🔴 A · R45 — the census learns the two shapes that start nothing, and only those (M1-M6, M20, M26, M35)

⚑ `clean-base`'s tests that never spawn it came back to `scripts/test/`, holding a NAMED import of
the library and the CLI's source READ as text — both of which the `706` census counted as a start.
It now exempts exactly those two shapes, and derives from the library which of its exports are ACTS.
Each row widens an exemption, or narrows the derivation, and the census's planted sources see it.

## 🔴 B · R46 — no start without naming scratch (M7-M14, M19, M21-M25, M27, M28, M36-M43)

⚑ `mustNameScratch` stands in front of every start in the gate-only `clean-base` file and the
`pnpm seed` file: a `--dir` that is not strictly below a fixture the test made, or a call that falls
back to a directory derived from `HOME` that is not one, throws before anything is spawned. M7-M12,
M19, M21-M24, M28, M36 and M37 take one refusal away each; M13-M14 take the guard off the one helper
through which each file starts its script, and M25, M27 and M38-M43 let a start round it — all of which
the routing census reads.

## ⚑ C · `713` F-3 — Codex says it is compacting, and its row ends it (M15-M16, M29-M31, M34)

## ⚑ D · `713` F-1 — smoke steps 2 and 50 name the drawer's seventh tab (M17-M18, M32-M33)

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the gate-only half's own new assertion** — the §5 call that now plants the directory
it would fall back to and reads it afterwards. That file spawns `clean-base`, so only the
whole `pnpm run ci` runs it, and `ci` never applies a row: a row whose only killer is there could not
be verified RED by anything, which is exactly the cost R45 exists to shrink. Their guard's rows are
B's, whose killers run in the ordinary suite.
"""

CENSUS = "scripts/test/clean-base-runs-only-in-the-gate.test.mjs"
FIXTURE = "scripts/test/fixtures/a-planted-user-data.mjs"
GATED = "scripts/gate-only/clean-base.test.mjs"
SEED = "scripts/test/pnpm-seed-cannot-be-run-by-accident.test.mjs"
CODEX = "packages/runtime/src/codex/normalize.ts"
SMOKE = "scripts/ui-live-smoke.mjs"
ROUTING = "scripts/test/clean-base-starts-only-on-scratch.test.mjs"
PILL = "apps/desktop/src/renderer/src/lib/transcript.ts"
BEING = "apps/desktop/src/main/runtime/being-done.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · R45 — the census ──────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **a file that names an ACT keeps its library import exempt** · `import { applyChecked } "
        "from '../lib/<script>'` reads as starting nothing, and a test in the ordinary suite can run "
        "the removal in-process — killed by `clean-base-runs-only-in-the-gate.test.mjs`",
        [
            (
                CENSUS,
                "  const namesAnAct = ACTS.some((act) => new RegExp(`\\\\b${act}\\\\b`).test(read))\n",
                "  const namesAnAct = false\n",
            )
        ],
    ),
    (
        "M2 · 🔴 **any module's named import is exempt, the SCRIPT's too** · importing the CLI "
        "runs it, and it would read as a library import — killed by "
        "`clean-base-runs-only-in-the-gate.test.mjs`",
        [(CENSUS, "    LIBRARY_PATH.test(from) && !namesAnAct && !plansAndRemoves ? '' : whole,\n", "    !namesAnAct && !plansAndRemoves ? '' : whole,\n")],
    ),
    (
        "M3 · ⛔ **any read's arguments are exempt** · a read that runs something, or carries the "
        "script's path out through a call or a `Worker`, reads as starting nothing — killed by "
        "`clean-base-runs-only-in-the-gate.test.mjs`",
        [
            (
                CENSUS,
                "    if (!THE_READ_SHAPE.test(args)) out += args\n",
                "    if (false) out += args\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ **the exemption by guess, not by exact shape** · `fs.readFileSync(` and anything "
        "else ending in the word count as a bare read — killed by "
        "`clean-base-runs-only-in-the-gate.test.mjs`",
        [
            (
                CENSUS,
                "const A_BARE_READ = /(?<![\\w$.])readFileSync\\s*\\(/g\n",
                "const A_BARE_READ = /readFileSync\\s*\\(/g\n",
            )
        ],
    ),
    (
        "M5 · ⛔ **the acts stop being transitive** · an export that removes nothing itself but "
        "calls one that does is importable by name — killed by "
        "`clean-base-runs-only-in-the-gate.test.mjs`",
        [
            (
                CENSUS,
                "      const callsAnAct = [...acts].some((act) => new RegExp(`\\\\b${act}\\\\s*\\\\(`).test(body))\n",
                "      const callsAnAct = false\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ **`rmdirSync` stops being a removal** · `removeEmptyRoot` leaves the acts, and "
        "the library's root-removal becomes importable by name — killed by "
        "`clean-base-runs-only-in-the-gate.test.mjs`",
        [
            (
                CENSUS,
                "const A_REMOVAL = /\\b(?:removeChecked|rmdirSync|rmSync|unlinkSync|rmdir|unlink|rm)\\s*\\(/\n",
                "const A_REMOVAL = /\\b(?:removeChecked|rmSync|unlinkSync|rmdir|unlink|rm)\\s*\\(/\n",
            )
        ],
    ),
    # ── B · R46 — the guard ───────────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 **a `--dir` with no value after a scratch one no longer falls back** · `--dir "
        "<scratch> --dir` runs under his own `HOME` — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [(FIXTURE, "      else dangling = true\n", "      else dangling = false\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (W4.90, option A):** `clean-base --packaged` is gone. A packaged
        # BroBot and a development build keep their data in the one folder (`lib/user-data.mjs`, and
        # the app pins it: `apps/desktop/src/main/data-folder.ts`), so the flag named a folder no
        # build used, and the guard line this row edits went with it. The gate-only test now pins
        # `--packaged` as an unknown option. Its anchor is left stale; landing records the
        # retirement when it regenerates the census (`mutations:census -- --retire "717 M8:anchor-absent"`).
        # ⛔ **RETIRED BY RULING (f441ec95, W4.103 reviewer agreed):** `--packaged` left clean-base and the
        # fixture; a start's target is its `--dir` or the one data folder, so no flag can send a start
        # that names scratch to a folder derived from `HOME`. The anchor stays stale for the census.
        "M8 · 🔴 **`--packaged` is not a fallback** · a call naming it gets his own `HOME`, whose "
        "packaged userData is a real app's — killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [
            (
                FIXTURE,
                "  if (dirs.length === 0 || dangling || args.includes('--packaged')) {\n",
                "  if (dirs.length === 0 || dangling) {\n",
            )
        ],
    ),
    (
        "M9 · ⛔ **scratch by PREFIX** · any `/tmp/b351-cb-*` passes, including one nobody made — "
        "killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [
            (
                FIXTURE,
                "    [root, realpathSync(root)].some((one) => path === one || path.startsWith(`${one}${sep}`)),\n",
                "    [root, realpathSync(root)].some(() => /^(?:\\/private)?\\/tmp\\/b351-cb-/.test(path)),\n",
            )
        ],
    ),
    (
        "M10 · ⚠️ **the resolved spelling is not scratch** · `/private/tmp/…` — the spelling the OS "
        "hands back for a `/tmp` fixture — is refused — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [(FIXTURE, "    [root, realpathSync(root)].some(", "    [root].some(")],
    ),
    (
        "M11 · ⚠️ **a relative `--dir` is read against the TEST's cwd** · not the one the script "
        "is started in, so what is checked is not what the script would take — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [(FIXTURE, "    const path = resolve(whereItLeads(resolve(cwd)), dir)\n", "    const path = resolve(dir)\n")],
    ),
    (
        "M12 · 🔴 **the directories named are never checked** · `--dir <his home>` passes — "
        "killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [(FIXTURE, "  for (const dir of dirs) {\n", "  for (const dir of []) {\n")],
    ),
    (
        "M13 · 🔴 **`clean-base`'s gate-only `run()` stops asking** · every start in that file "
        "goes out unguarded — killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [(GATED, "  mustNameScratch(args, { env })\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `scripts/seed-demo.mjs` and its test
        # `scripts/test/pnpm-seed-cannot-be-run-by-accident.test.mjs` were deleted, and package.json
        # no longer has a seed script. Commit message: 'Proposals go end to end, with the demo
        # seed'. Its anchor is left stale, so the census records it retired.
        "M14 · 🔴 **`runSeed` stops asking** · `pnpm seed` with no `--dir` writes into whatever "
        "`HOME` the test has — killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [(SEED, "  mustNameScratch(args, { env, ...(cwd === undefined ? {} : { cwd }) })\n", "")],
    ),
    # ── C · `713` F-3 — the pill ──────────────────────────────────────────────────────────────
    (
        "M15 · ⚑ **the start says nothing again** · `713`'s shape — Codex compacts with no pill, "
        "though its item opened 140 ms before it closed — killed by `codex-normalize.test.ts`, and "
        "on the real adapter killed by `codex-runtime.test.ts`",
        [
            (
                CODEX,
                "    if (phase === 'started') return [{ type: 'activity', phase: 'compacting' }]\n",
                "    if (phase === 'started') return []\n",
            )
        ],
    ),
    (
        "M16 · ⛔ **the start draws a ROW instead** · two boundary rows for one compaction, and the "
        "meter's tally says 2 — killed by `codex-normalize.test.ts`, and on the real adapter killed "
        "by `codex-runtime.test.ts`",
        [
            (
                CODEX,
                "    if (phase === 'started') return [{ type: 'activity', phase: 'compacting' }]\n",
                "    if (phase === 'started') return [{ type: 'compaction', source: type }]\n",
            )
        ],
    ),
    # ── D · `713` F-1 — step 2 ────────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 **step 2 forgets `work` again** · `713` F-1 exactly: red in every live batch "
        "since `508`, and green in `ci` — killed by "
        "`smoke-step-2-reads-the-drawer-the-app-ships.test.mjs`",
        [
            (
                SMOKE,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 6ad82ff2 took `context` out of the drawer, so step 2's list is six; the plant still forgets `work`. Killed by smoke-step-2-reads-the-drawer-the-app-ships.test.mjs (list vs DRAWER_TABS).
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · d21b3125 removed the Controls tab, so step 2's exact list is five tabs; the plant still forgets work.
                "      if (live.join(',') !== 'open,events,info,changes,work') {\n",
                "      if (live.join(',') !== 'open,events,info,changes') {\n",
            )
        ],
    ),
    (
        "M18 · ⚠️ **the count stays six** · the list names seven and the strip is refused for "
        "having them — killed by `smoke-step-2-reads-the-drawer-the-app-ships.test.mjs`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 6ad82ff2 made the strip six; the plant counts one short (5). Killed by smoke-step-2-reads-the-drawer-the-app-ships.test.mjs (count = live + reserved = 6).
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · d21b3125 removed the Controls tab, so step 2 counts five; the plant still counts one fewer than the strip lays out.
        [(SMOKE, "      if (strip.length !== 5) throw", "      if (strip.length !== 4) throw")],
    ),
    # ── B · R46 — the guard, one refusal more (found reviewing this dispatch's own diff) ──────────
    (
        "M19 · 🔴 **the path as TYPED, not where it leads** · a link inside a fixture pointing out "
        "of it passes as scratch, and the script follows it — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [
            (
                FIXTURE,
                "  return underAFixture(path) && underAFixture(whereItLeads(path))\n",
                "  return underAFixture(path)\n",
            )
        ],
    ),
    # ── the review's round 1 — each fix, one row ─────────────────────────────────────────────
    (
        "M20 · 🔴 **`safe-remove.mjs`' acts leave the derivation** · the library's planner and "
        "`removeChecked` run the reset in-process, and the file reads as starting nothing — killed "
        "by `clean-base-runs-only-in-the-gate.test.mjs`",
        [
            (
                CENSUS,
                "const ACTS = [...new Set([...actsOf(LIBRARY_SOURCE), ...actsOf(REMOVER_SOURCE)])].sort()\n",
                "const ACTS = actsOf(LIBRARY_SOURCE)\n",
            )
        ],
    ),
    (
        "M21 · 🔴 **`--dir=` is read as a directory again** · `pnpm seed` does not read it, and "
        "falls back to his own userData under the real `HOME` — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [(FIXTURE, "    if (args[at].startsWith('--dir=')) {\n", "    if (false) {\n")],
    ),
    (
        "M22 · ⚠️ **a path that does not exist yet is taken as typed** · the link ABOVE it is not "
        "followed, so `<fixture>/out/new` passes while `out` leads elsewhere — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [(FIXTURE, "      rest = join(basename(at), rest)\n", "      return path\n")],
    ),
    (
        "M23 · ⚠️ **off the Mac the fallback ignores `XDG_CONFIG_HOME`** · an inherited one decides "
        "where the scripts fall back to, and the guard would judge a different directory — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [
            (
                FIXTURE,
                "        : (env.XDG_CONFIG_HOME ?? join(env.HOME, '.config'))\n",
                "        : join(env.HOME, '.config')\n",
            )
        ],
    ),
    (
        "M24 · 🔴 **the fallback is judged by `HOME`, not by where the scripts derive from it** · a "
        "scratch `HOME` whose `Library` links out sends the reset through the link — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [
            (
                FIXTURE,
                "fallbacksUnder(child).flatMap(sweptBy)",
                "[resolve(env.HOME)]",
            )
        ],
    ),
    (
        "M25 · 🔴 **the routing census reads only the starts that name the script's variable** · a "
        "second start spelled with a path goes unread — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [
            (
                ROUTING,
                "    if (allow.some((shape) => shape.test(args))) continue\n",
                "    if (!/\\b(?:CLI|SEED)\\b/.test(args) || allow.some((shape) => shape.test(args))) continue\n",
            )
        ],
    ),
    (
        "M26 · ⚠️ **any function named `readFileSync` is node's** · a local one by that name spawns "
        "the script, and its call reads as a read — killed by `clean-base-runs-only-in-the-gate.test.mjs`",
        [
            (
                CENSUS,
                "  if (!readsWithNode(imports)) return imports\n",
                "",
            )
        ],
    ),
    (
        "M27 · ⚠️ **a guard ANYWHERE in the helper counts** · one a `try` swallows, or one asked "
        "after the start — killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [
            (
                ROUTING,
                "    new RegExp(`^function ${helper}\\\\([^)]*\\\\) \\\\{\\\\n {2}mustNameScratch\\\\(`).test(\n",
                "    new RegExp(`^function ${helper}\\\\([^)]*\\\\) \\\\{[^]*mustNameScratch\\\\(`).test(\n",
            )
        ],
    ),
    (
        "M28 · 🔴 **neither pasted-images sibling is checked** · `clean-base` sweeps one, a link there "
        "leads out, and a fixture ROOT passes as a `--dir` — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [
            (
                FIXTURE,
                "  return [path, pastedImagesRoot(path), pastedImagesRoot(whereItLeads(path))]\n",
                "  return [path]\n",
            )
        ],
    ),
    # ── C · the pill, ended by its row ───────────────────────────────────────────────────────
    (
        "M29 · 🔴 **the renderer's fold keeps the pill past its row** · a Codex compaction inside a "
        "turn that goes on working reads *compacting context* under a row that says it is over — "
        "killed by `a-compaction-row-ends-its-pill.test.ts`",
        [(PILL, "      if (state.activity?.phase === 'compacting') state.activity = null\n", "")],
    ),
    (
        "M30 · 🔴 **main's fold keeps it** · every plate that reads `BeingDoneTracker` says "
        "*compacting* after the row — killed by `a-compaction-row-ends-its-pill.test.ts`",
        [
            (
                BEING,
                "        if (told.said === 'an-activity' && told.phase === 'compacting') told = NOTHING_RIGHT_NOW\n",
                "",
            )
        ],
    ),
    (
        "M31 · ⚠️ **the row ends ANY pill** · a `thinking` that is still going on is blanked by a "
        "compaction row — killed by `a-compaction-row-ends-its-pill.test.ts`",
        [
            (
                PILL,
                "      if (state.activity?.phase === 'compacting') state.activity = null\n",
                "      state.activity = null\n",
            )
        ],
    ),
    # ── D · step 50, beside step 2 ───────────────────────────────────────────────────────────
    (
        "M32 · 🔴 **step 50 counts six again** · `713` F-1's defect in the step beside step 2 — "
        "killed by `smoke-step-2-reads-the-drawer-the-app-ships.test.mjs`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 6ad82ff2 made step 50 count six; the plant counts five. Killed by smoke-step-2-reads-the-drawer-the-app-ships.test.mjs (step 50 counts).
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · d21b3125 removed the Controls tab, so step 50 counts five; the plant still counts one fewer.
        [(SMOKE, "        if (strip.tabs !== 5) throw", "        if (strip.tabs !== 4) throw")],
    ),
    (
        "M33 · ⚠️ **step 50 walks six** · one live tab is never measured at either width — killed "
        "by `smoke-step-2-reads-the-drawer-the-app-ships.test.mjs`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · 6ad82ff2 made step 50 walk six; the plant walks five. Killed by smoke-step-2-reads-the-drawer-the-app-ships.test.mjs (step 50 walks).
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · d21b3125 removed the Controls tab, so step 50 walks five; the plant still lets one live tab go unwalked.
        [(SMOKE, "      if (walkable.length < 5) {\n", "      if (walkable.length < 4) {\n")],
    ),
    # ── the review's round 2 — each fix, one row ─────────────────────────────────────────────
    (
        "M34 · ⚠️ **main's fold ends ANY pill at the row** · a `thinking` still going on is "
        "blanked on every plate that reads `BeingDoneTracker` — killed by "
        "`a-compaction-row-ends-its-pill.test.ts`",
        [(BEING, "        if (told.said === 'an-activity' && told.phase === 'compacting') told = NOTHING_RIGHT_NOW\n", "        if (told.said === 'an-activity') told = NOTHING_RIGHT_NOW\n")],
    ),
    (
        "M35 · 🔴 **a planner beside node's own removal is exempt** · `checkPlan`'s verdicts "
        "handed to `rmSync` run the reset in-process, and no act is named — killed by "
        "`clean-base-runs-only-in-the-gate.test.mjs`",
        [(CENSUS, "    LIBRARY_PATH.test(from) && !namesAnAct && !plansAndRemoves ? '' : whole,\n", "    LIBRARY_PATH.test(from) && !namesAnAct ? '' : whole,\n")],
    ),
    (
        "M36 · 🔴 **a relative `--dir` is read against the cwd as TYPED** · a `..` under a cwd "
        "that links out climbs from the link's name, and the child climbs from where it leads — "
        "killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [(FIXTURE, "    const path = resolve(whereItLeads(resolve(cwd)), dir)\n", "    const path = resolve(cwd, dir)\n")],
    ),
    (
        "M37 · ⚠️ **the sibling of where a `--dir` LEADS is not checked** · a link to a fixture "
        "root puts the sibling `clean-base` sweeps outside it — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [(FIXTURE, "  return [path, pastedImagesRoot(path), pastedImagesRoot(whereItLeads(path))]\n", "  return [path, pastedImagesRoot(path)]\n")],
    ),
    (
        "M38 · ⚠️ **a call on `cp.` is not a process call** · `cp.execFileSync(…)` outside the "
        "helper goes unread — killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [(ROUTING, "  /(?:(?<![\\w$.])\\w*(?:[Ee]xec|[Ss]pawn|fork)\\w*|\\b(?:child_process|childProcess|cp)\\.\\w+)\\s*\\(/g\n", "  /(?:(?<![\\w$.])\\w*(?:[Ee]xec|[Ss]pawn|fork)\\w*)\\s*\\(/g\n")],
    ),
    (
        "M39 · ⚠️ **a starter handed on as a value is not read** · `const go = execFileSync` — "
        "killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [(ROUTING, "    if (A_LAUNCHER_HANDED_ON.test(line)) out.push(line.trim())\n", "")],
    ),
    (
        "M40 · ⚠️ **the helper's body runs to the end of the file** · a second start written "
        "after it reads as inside it — killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [(ROUTING, "  const closes = opens === -1 ? -1 : read.indexOf('\\n}\\n', opens)\n", "  const closes = read.length\n")],
    ),
    (
        "M41 · 🔴 **the module taken another way is not read** · a namespace, default or dynamic "
        "import of `node:child_process` starts the script unseen — killed by "
        "`clean-base-starts-only-on-scratch.test.mjs`",
        [(ROUTING, "    if (ANOTHER_WAY_IN.test(line) && !A_PROCESS_CALL.test(line)) out.push(line.trim())\n", "")],
    ),
    (
        "M42 · ⚠️ **an aliased named import is allowed** · `import { execFileSync as go }` then "
        "`go(…)` — killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [(ROUTING, "    if (/\\sas\\s/.test(shape)) out.push(shape.replace(/\\s+/g, ' '))\n", "")],
    ),
    (
        "M43 · ⚠️ **the sleeper is allowed by its PREFIX** · a start appended inside its own "
        "shell string rides through — killed by `clean-base-starts-only-on-scratch.test.mjs`",
        [(ROUTING, "\\$\\{JSON\\.stringify\\(realSpelling\\)\\} >\\/dev\\/null 2>&1 & echo \\$!`,?\\s*\\]$/", "\\$\\{JSON\\.stringify\\(realSpelling\\)\\} /")],
    ),
]
