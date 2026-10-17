"""371 · A narrowing that means something — each row is THE DEFECT, put back verbatim (131).

⛔ **A spawner may narrow the folder its child works in and may NEVER widen it, and HO-010 ruling 4
fixes what "narrow" is measured against**: *"The project-relative reading makes a parent's narrowing
a suggestion rather than a boundary: a child deep in a subtree climbing back to the root means the
narrowing never happened. Monotone is the only reading where narrowing means anything."* So the bound
is the PARENT's cwd, and `project.cwd` is the initial bound only because a session that asked for no
folder is standing in it (HO-009 §5.1 — the column `362` §3 measured as *"stored, displayed and
ignored by launch"*).

⚑ **The ordering is as load-bearing as the rule** (`362` §4.3): the lexical arm runs before ANY
filesystem call, so a caller naming `/etc` is refused without this app touching `/etc`; the real arm
runs after the existence check, because a path that is not there cannot be `realpath`ed; and both
arms answer with ONE rail and ONE sentence, because *"it is a link and it points out of your tree"*
is a filesystem enumeration primitive handed to the caller it was refused for.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`, `M2`, `M6`, `M7`, `M12` | ⚑ **`run_suite desktop`** — `a-narrowing-that-means-something.test.ts` §1 |
| `M4` | ⚑ **`run_suite desktop`** — §2, the recorded `node:fs` calls and the rail order |
| `M3`, `M13` | ⚑ **`run_suite desktop`** — §3, the symlink escape and its one sentence |
| `M9`, `M10`, `M11` | ⚑ **`run_suite desktop`** — §4, the tool surface in both directions |
| `M8` | ⚑ **`run_suite desktop`** — §5, `project.cwd` at launch |
| `M5` | ⚑ **`run_suite desktop`** — §6, the case hole `realpathSync.native` closes |
| `M14` | ⚑ **`run_suite desktop`** — `a-narrowing-that-means-something.render.test.ts` |

⚑ **Fourteen rows, and all fourteen were applied and run ONE AT A TIME** — apply, run the suite,
restore from bytes, checksum — rather than by running the table.

## ⛔ What this table deliberately does NOT contain

⛔ **`459` legitimately put `project` on both the advertisement and the door.** The invariant this
table introduced did not move: every advertised key must translate to one the strict door accepts.
`M9` now puts `priority` on the advertisement alone, recreating the same disclosure defect without
denying the narrower project-placement capability that later dispatch added.

⛔ **No row on `SPAWN_RAILS`' order.** `spawn-must-prompt` being third is asserted directly by §7 and
by `341`'s own suite; a row that moved it would be a duplicate of an assertion two tables already
own, and `371` added its rail at the end where nothing above it moves.

⛔ **No row that makes `cwd-outside-parent`'s sentence name the arm that refused.** The sentence is
built by `describeRail` from a `detail` that has no arm in it — there is no field to leak through, so
the row would have to add one, and a mutation that first ADDS a carrier is a new feature rather than
a defect put back. `M13` measures the reachable half: answering with a different RAIL.

⛔ **No row on `RuntimeHost.checkCwd('')` short-circuiting to `{ok: true, path: ''}`.** That branch is
the LAUNCHER's — *"blank means the default"*, `203`'s rule — and it is still correct there. What `371`
changed is that a spawn no longer reaches it with a blank string (`M7`), so a row on the branch itself
would report as a survivor: the launcher's own tests need it exactly as it is.
"""

from __future__ import annotations

RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
CWD = "apps/desktop/src/main/runtime/scratch-cwd.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"

# The child-folder containment guard is gone. Keep its removed-code anchors recorded as retired
# because starting outside the parent folder is intended.
MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 THE DEFECT, verbatim: the chokepoint asks nothing about where the child would work, "
        "so a spawner may name any folder on the machine — which is the state HO-009 §5.3 describes "
        "as *a project boundary that does not exist*",
        [
            (
                RAILS,
                "  if (!narrowsInto(bound, requested)) {\n"
                "    return no('cwd-outside-parent', outsideTheBound)\n"
                "  }\n"
                "\n"
                "  // 12b · the folder itself, in `checkSessionCwd`'s own words.\n"
                "  const folder = facts.checkFolder(requested)",
                "  const folder = facts.checkFolder(requested)",
            ),
            (
                RAILS,
                "  if (!narrowsInto(facts.realPathOf(bound), facts.realPathOf(folder.path))) {\n"
                "    return no('cwd-outside-parent', outsideTheBound)\n"
                "  }\n",
                "",
            ),
        ],
    ),
    (
        "M2 · 🔴 THE OTHER READING, verbatim: containment measured the wrong way round, so a child "
        "may climb OUT of its parent's folder and not into a descendant · the plausible mistake: two "
        "path arguments of the same type, and the reversed call type-checks",
        [
            (
                RAILS,
                "  if (!narrowsInto(bound, requested)) {",
                "  if (!narrowsInto(requested, bound)) {",
            )
        ],
    ),
    (
        "M3 · ⛔ the REAL arm is dropped, so `<parent>/link → /elsewhere` is inside the bound by every "
        "string measure and the child runs outside it · the plausible mistake: the lexical check "
        "reads like the whole rule, and 071 learned the same thing from the other side",
        [
            (
                RAILS,
                "  if (!narrowsInto(facts.realPathOf(bound), facts.realPathOf(folder.path))) {\n"
                "    return no('cwd-outside-parent', outsideTheBound)\n"
                "  }\n",
                "",
            )
        ],
    ),
    (
        "M4 · 🔴 THE ORDER, verbatim: the folder is statted BEFORE the lexical arm refuses it, so a "
        "caller learns from this door whether a path outside its reach exists · `362` §4.3 step 6 is "
        "the whole of what this row breaks, and the refusal is still correct — only the syscall is new",
        [
            (
                RAILS,
                "  if (!narrowsInto(bound, requested)) {\n"
                "    return no('cwd-outside-parent', outsideTheBound)\n"
                "  }\n"
                "\n"
                "  // 12b · the folder itself, in `checkSessionCwd`'s own words.\n"
                "  const folder = facts.checkFolder(requested)\n"
                "  if (!folder.ok) return no('folder-unusable', { folderReason: folder.reason })\n",
                "  // 12b · the folder itself, in `checkSessionCwd`'s own words.\n"
                "  const folder = facts.checkFolder(requested)\n"
                "  if (!folder.ok) return no('folder-unusable', { folderReason: folder.reason })\n"
                "  if (!narrowsInto(bound, requested)) {\n"
                "    return no('cwd-outside-parent', outsideTheBound)\n"
                "  }\n",
            )
        ],
    ),
    (
        # 🔴 **RETIRED BY RULING at `726` — R92 removed the guard it measured, and the row is
        # measured to SURVIVE.** Its consequence was 071's app-data cwd wall bypassed by case; R92
        # removed that wall (`appDataReason`), so no comparison of a cwd against `userData` remains
        # for a case to slip past. Verified at `726` (`verify_row.py`, killers `scratch-cwd`,
        # `a-narrowing-that-means-something`, `where-brobots-own-conversation-runs`,
        # `nothing-is-built-outside-the-tree`, `documents-hold-what-agents-produce`): SURVIVED. ⚠️ The
        # anchor stays live — `filesystemSpelling` still serves the documents writer — and no test
        # there stands in a case-mismatched `userData`; that gap is named in `726`'s response.
        "M5 · 🔴 the real spelling keeps the caller's capitalisation, so on APFS `<userdata>` is not "
        "`<userData>` and 071's rule is bypassed by holding down the shift key · the plausible "
        "mistake: `realpathSync` resolves symlinks, which is what the comment above it is about "
        "· ⚠️ EXPECTED SURVIVOR since 726 (R92 removed the guard)",
        [
            (
                CWD,
                "    return realpathSync.native(path)",
                "    return realpathSync(path)",
            )
        ],
    ),
    (
        "M6 · ⛔ the containment predicate compares strings rather than paths, so `/a/b-evil` is "
        "inside `/a/b` · the plausible mistake: `startsWith` is shorter and passes every test whose "
        "paths differ at a separator",
        [
            (
                CWD,
                "  const rel = relative(root, path)\n"
                "  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))",
                "  return path.startsWith(root)",
            )
        ],
    ),
    (
        "M7 · ⛔ a blank cwd is passed through instead of being read as an absent one, so `cwd: \"\"` "
        "reaches `checkCwd('')`, comes back `ok` with an empty path and lands the child in the "
        "durable BroBot workspace — a folder no rail checked and no parent is standing in",
            # ⚑ **Re-anchored in place at `726` (R92)**: the code around it moved; the defect is unchanged.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: a blank
        # `cwd` must be read as absent, or `checkCwd('')` returns ok with an empty path and the
        # child lands in the BroBot workspace. The code moved only in name: the fallback is now
        # `parent.cwd` (the `defaultCwd` variable is gone), so the anchor and the plant are re-cut
        # on today's line.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a blank folder must read as absent, or `checkFolder('')` returns ok with an
        # empty path and the child lands in the BroBot workspace. The test '🔴 a BLANK folder is an
        # absent one' is still there. The spawn's `cwd` argument became `folder` and the parent's
        # `giving.cwd`, so the line moved from `asked.cwd ... parent.cwd` to `asked.folder ...
        # giving.cwd`. Killed by `a-narrowing-that-means-something.test.ts`.
        [
            (RAILS, "  const requested =\n    asked.folder !== undefined && asked.folder.trim() !== '' ? asked.folder : giving.cwd", '  const requested = asked.folder ?? giving.cwd'),
        ],
    ),
    (
        "M8 · 🔴 `project.cwd` goes back to being stored, displayed and IGNORED by launch (`362` §3) "
        "· the plausible mistake: the workspace fallback below already answers every existing "
        "install, because the pinned project has no folder until a person types one",
        [
            (
                HOST,
                "    const cwd = this.deps.resolveCwd(id, input.cwd ?? this.projectCwd())",
                "    const cwd = this.deps.resolveCwd(id, input.cwd)",
            )
        ],
    ),
    (
        "M9 · ⛔ `spawn_agent` advertises a `priority` argument its own door refuses — HO-010 §2.1 "
        "verbatim, *a disclosure claiming a capability that does not exist*, which is criterion 9's "
        "shape and invisible to criterion 10",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: every argument a tool advertises must be one its strict door accepts, and §4 of
        # the killer asserts it for give_work in both directions. `spawn_agent` is gone, so the
        # undocumented `priority` is now advertised on `give_work`, before `folder`. The anchor is a
        # substring of the `folder` argument's start and the plant puts `priority` in front of it.
        # Killed by `a-narrowing-that-means-something.test.ts`.
        [
            # ⚑ W4.189 · re-anchored in place, not retired — give_work's folder now also grants a
            # conversation the giver already has; the defect planted is the same.
            # ⚑ **parallel workers · re-anchored in place, not retired** — Parallel-worker tool wording changes this anchor. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
            # NOT VERIFIED: typed input wrapping shifted indentation; the same defect is retained.
            (TOOLS, "          folder: z\n            .string()\n            .optional()\n            .describe(\n              \"A folder for this piece: any that exists;", "          priority: z.string().optional().describe('How urgently to run it.'),\n          folder: z\n            .string()\n            .optional()\n            .describe(\n              \"A folder for this piece: any that exists;"),
        ],
    ),
    (
        "M10 · 🔴 the translation table is used as an ALLOW-LIST, so a key neither name knows is "
        "STRIPPED before the door sees it — `303` B re-opened inside the fix for it, and rail 1 can "
        "then never fire for the one cause it exists for",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in D-016's own words: give_work hands its arguments to the door verbatim so an
        # argument neither name knows is refused by name (`303` B), and §4 still asserts it ('an
        # argument NEITHER name knows still reaches the door and is named there'). The translation
        # table `named[advertised]` is gone (no rename map between tool and door). The plant is the
        # same defect at the same layer: the tool strips every key it does not advertise before the
        # door sees it. Killed by `a-narrowing-that-means-something.test.ts`.
        [
            (TOOLS, '            given = await host.giveWork(args, by)\n', "            given = await host.giveWork(\n              Object.fromEntries(\n                Object.entries(args).filter(([key]) =>\n                  ['profile', 'title', 'brief', 'folder', 'piece', 'new'].includes(key),\n                ),\n              ) as typeof args,\n              by,\n            )\n"),
        ],
    ),
    (
        "M11 · ⛔ the field the tool fills in is silently overridden again instead of refused, so a "
        "model that named a parent gets a successful spawn and has been told its argument was taken",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The field the
        # tool filled in (`SPAWN_FIELD_THE_TOOL_FILLS_IN`, the `parentSessionId` override) went with
        # `spawn_agent`, but DEV kept the rule: a caller that names the giving conversation anyway
        # must be refused by name, not silently used. The killer's test '⛔ naming a conversation to
        # give FROM is refused rather than silently used' says so, and asserts `rail:
        # malformed-request` plus the name in `detail`. The plant is the old defect again: the tool
        # drops `parentSessionId` before the strict door sees it, so the give succeeds. Killed by
        # `a-narrowing-that-means-something.test.ts`.
        [
            (TOOLS, '            given = await host.giveWork(args, by)\n', "            given = await host.giveWork(\n              Object.fromEntries(\n                Object.entries(args).filter(([key]) => key !== 'parentSessionId'),\n              ) as typeof args,\n              by,\n            )\n"),
        ],
    ),
    (
        "M12 · ⚠️ the refusal says a person could make this call work, so a model is sent to ask for "
        "a grant nobody can give · the plausible mistake: `folder-unusable` beside it is exactly "
        "that value, and both rails are about a directory",
        [
            (
                RAILS,
                "  'cwd-outside-parent': 'permanent',",
                "  'cwd-outside-parent': 'until-a-person-changes-it',",
            )
        ],
    ),
    (
        "M13 · ⛔ the symlink escape answers with a DIFFERENT rail from the plainly-outside folder, "
        "which tells the caller that the path it named is a link and roughly where it points — the "
        "enumeration primitive the single rail exists to close",
        [
            (
                RAILS,
                "  if (!narrowsInto(facts.realPathOf(bound), facts.realPathOf(folder.path))) {\n"
                "    return no('cwd-outside-parent', outsideTheBound)\n"
                "  }",
                "  if (!narrowsInto(facts.realPathOf(bound), facts.realPathOf(folder.path))) {\n"
                "    return no('folder-unusable', { folderReason: `cwd resolves outside ${bound}` })\n"
                "  }",
            )
        ],
    ),
    (
        "M14 · ⚠️ the launcher promises the BroBot workspace whatever the project's folder is, so the "
        "one person who used the project sheet is told the wrong directory — criterion 9's shape on "
        "a placeholder, which is a claim about what happens if you do nothing",
        [
            (
                LAUNCHER,
                "const folderPlaceholder = computed(() => props.projectCwd ?? 'the BroBot workspace')",
                "const folderPlaceholder = computed(() => 'the BroBot workspace')",
            )
        ],
    ),
]
