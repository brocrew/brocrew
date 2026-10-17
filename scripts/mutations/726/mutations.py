"""726 · No guards: BroBot reaches every folder.

⚑ **Ordered by** the person, 2026-09-25, ruled `R92`: *"we don't want any guards! Brobot like any other
Codex or Claude Code CLI, or ChatGPT.app etc.. should have access to all folders. No restrictions to
BroBot and its Agents.. same as the others."* BroBot adds no file- or folder-access restriction of
its own — on what its agents read or write, on where an agent may start a child, or on what BroBot
itself opens for a person. The only gate left is the provider's own approval mode. `R77`, `R86` and
`R88` are withdrawn.

## ⚑ What every row here is

Each row puts ONE removed guard back, in the smallest shape that still does what the guard did, and
names the `726` flip that must notice it. ⛔ **Not the guard verbatim**: the removed code leaned on
helpers `726` deleted with it (`scanForProtected`, `placeWhereItRuns`, `appDataReason`,
`narrowsInto`, `readWithinAny`, the asset root and its depth anchor), so re-inserting it verbatim
would re-insert those too. What each row plants is the guard's BEHAVIOUR — the refusal a person or
an agent would meet — and the flip it names asserts that refusal is gone.

## 🔴 A · the agent's reads (Claude `PreToolUse`) — M1, M2

## 🔴 B · where a conversation may work — M3 (a cwd), M4 (a spawn), M5 (a project folder)

## 🔴 C · what the app opens — M6 (ingest), M7 (the asset door), M8 (Codex's own resolver),
## M9 (the host's resolver), M10 (a workflow output), M11 (a child's file)

⚠️ **M10 is the name rule's shape, not its letter**: `<task_id><ext>` needs the task id the reader no
longer takes, so the row refuses a file whose real name differs from the name it was asked by. It
dies on the flip's link half and on 108's own symlink test; the flip's headline half (a real
`.claude.json` opens) has no row that could put the old rule back without the id.

## 🔴 D · what an agent is told — M12, M13 (`726` §2a, the factory text), M14, M15 (tool text)

## 🔴 E · what the removal exposed, found by `726`'s review — M16 (a rollout's type on its real
## path), M17 (a relative spawn folder), M18 (no tool-wide session rule for a read)

⚑ The 70 rows `726` retired, each by name and each for *"R92 removed the guard"*, are annotated in
their own tables (153, 160, 171, 183, 262, 371, 380, 486, 489, 517, 590, 675, 676, 721), and so are
the three live rows retired by the same ruling as EXPECTED SURVIVORS (371 M5, 372 M1, 372 M4). The
rows it corrected in place are marked there too: 341 M26, 367, 371 M7, 372 M3/M5, 377 M1, 380 M20,
425, 489 M7/M12, 510, 517, 590, 700 M10.
"""

ADAPTER = "packages/runtime/src/claude/claude-runtime.ts"
GENERATED = "packages/runtime/src/codex/generated-image.ts"
CWD = "apps/desktop/src/main/runtime/scratch-cwd.ts"
SPAWN = "apps/desktop/src/main/runtime/spawn-rails.ts"
FOLDERS = "apps/desktop/src/main/runtime/project-folder-rails.ts"
DOCUMENTS = "apps/desktop/src/main/documents/canonical-document.ts"
ASSETS = "apps/desktop/src/main/asset-protocol.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
OUTPUT = "apps/desktop/src/main/workflow-output.ts"
CHILD = "apps/desktop/src/main/child-work.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"

AUTO_YIELD = "            if (isAutoApprove({ approvalMode: effectiveMode() })) return { continue: true }\n"
HABIT = (
    # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the v6 core replaced "How you work" and "Rules"; the same mutation, applied to the core's sentence that carries the rule
    # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
    # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
    # ⚑ **W4.669 · re-anchored in place, not retired** — verified RED alone (verify_row; 377 M4 by a plant against `a-check-in-is-a-question.test.ts` §1, whose §2 waits on request_action). v22 rewords the core sentence this row's defect lives in; the same defect, applied to the v22 sentence that carries it
    "Use the assigned folder; create ' +\n    'one only for saved work. "
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the agent's reads ───────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **a tool call naming the app's own data is refused again, above the mode** — 071's "
        "scan, in miniature: `auto` no longer means what the CLI's own flag means — killed by "
        "`claude-runtime.test.ts` (726 R92, in `auto`)",
        [
            (
                ADAPTER,
                AUTO_YIELD,
                "            if (JSON.stringify(input.tool_input).includes('provider-homes')) {\n"
                "              return denyFor('this path is inside BroBot2’s own data directory')\n"
                "            }\n" + AUTO_YIELD,
            )
        ],
    ),
    (
        "M2 · ⛔ **a read outside the working directory gets OUR card again in `ask`** — the hook's "
        "own outside-cwd ask, which the CLI already raises itself (`721`'s probe) — killed by "
        "`claude-runtime.test.ts` (726 R92, in `ask`)",
        [
            (
                ADAPTER,
                "              PROMPT_EXEMPT_TOOLS.has(input.tool_name) ||\n"
                "              grants.has(input.tool_name, input.tool_input)\n",
                "              (PROMPT_EXEMPT_TOOLS.has(input.tool_name) &&\n"
                "                writesOnlyWithin(input.tool_input, confinement.cwd)) ||\n"
                "              grants.has(input.tool_name, input.tool_input)\n",
            )
        ],
    ),
    # ── B · where a conversation may work ───────────────────────────────────────────────────────
    (
        "M3 · 🔴 **the app-data wall comes back on a cwd** — a conversation may not work in "
        "`userData` outside the workspace — killed by `scratch-cwd.test.ts` (726 R92)",
        [
            (
                CWD,
                "  const verdict = checkSessionCwd(requested)\n"
                "  if (!verdict.ok) throw new Error(verdict.reason)\n"
                "  return verdict.path\n",
                "  const verdict = checkSessionCwd(requested)\n"
                "  if (!verdict.ok) throw new Error(verdict.reason)\n"
                "  if (verdict.path.startsWith(userData) && !verdict.path.startsWith(join(userData, 'brobot-workspace'))) {\n"
                "    throw new Error(`cwd is inside BroBot2's own data directory: ${verdict.path}`)\n"
                "  }\n"
                "  return verdict.path\n",
            )
        ],
    ),
    (
        "M4 · 🔴 **a child is bounded to its parent's folder again** — HO-010 ruling 4's bound, "
        "`cwd-outside-parent` under another rail's name — killed by "
        "`a-parent-that-survives-a-restart.test.ts`, `a-folder-no-agent-can-work-in.test.ts` (726 R92)",
        [
            (
                SPAWN,
                "  if (!folder.ok) return no('folder-unusable', { folderReason: folder.reason })\n",
                "  if (!folder.ok) return no('folder-unusable', { folderReason: folder.reason })\n"
                "  if (folder.path !== defaultCwd && !folder.path.startsWith(`${defaultCwd}/`)) {\n"
                "    return no('folder-unusable', { folderReason: 'the folder asked for is not yours or inside it' })\n"
                "  }\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `project-folder-rails.ts` is deleted
        # (-1) with the project folders and their rails ('project folders and their rails ... are
        # removed'), and the killer `a-proposal-that-could-never-succeed.test.ts` is deleted with
        # proposals. R92 already removed the guard as well: BroBot adds no folder refusals. Its
        # anchor is left stale, so the census records it retired.
        "M5 · ⛔ **a project folder inside the app's own data is refused again** — "
        "`folder-is-not-allowed` under the missing-folder rail — killed by "
        "`a-proposal-that-could-never-succeed.test.ts` (726 R92)",
        [
            (
                FOLDERS,
                "    const verdict = checkSessionCwd(folder)\n    if (!verdict.ok) {\n",
                "    if (folder.includes('/provider-homes')) {\n"
                "      return { ok: false, rail: 'no-such-folder', reason: `inside BroBot2's own data directory: ${folder}`, folder }\n"
                "    }\n"
                "    const verdict = checkSessionCwd(folder)\n    if (!verdict.ok) {\n",
            )
        ],
    ),
    # ── C · what the app opens ──────────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 **a reply's resource must sit inside the workspace again** — "
        "`resource-outside-workspace`, answered as unreadable — killed by "
        "`a-reply-and-its-absence.test.ts` (726 R92)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R92 (BroBot
        # adds no folder guards) and `726`: a resource outside the workspace is kept and the reply
        # lands. The plant puts back the guard that refused a resource outside its base. The subject
        # survives, but `canonical-document.ts` was deleted with documents, and the reader is now
        # `resolveResource` in resources/resources.ts. The plant adds the containment check before
        # the return. Killed by `a-reply-and-its-absence.test.ts`.
        [
            (RESOURCES, '    return { ok: true, realPath: realpathSync.native(lexicalPath) }\n', "    const realPath = realpathSync.native(lexicalPath)\n    if (!realPath.startsWith(`${realpathSync.native(base)}${sep}`)) {\n      return { ok: false, refusal: refuseResource('resource-unreadable', { path: spelled }) }\n    }\n    return { ok: true, realPath }\n"),
        ],
    ),
    (
        "M7 · ⛔ **the asset door serves only from a `generated_images` directory again** — 067 "
        "acceptance 7, in the shape it had (the fixture's own images still pass, the outside one does "
        "not) — killed by `asset-protocol.test.ts` (726 R92)",
        [
            (
                ASSETS,
                "  const real = realOrNull(candidate)\n  if (real === null) return null\n",
                "  const real = realOrNull(candidate)\n  if (real === null) return null\n"
                "  if (!real.includes('/generated_images/')) return null\n",
            )
        ],
    ),
    (
        "M8 · ⛔ **Codex's generated image must sit inside its images directory again** — killed by "
        "`generated-image.test.ts` (726 R92)",
        [
            (
                GENERATED,
                "    const real = realOrNull(candidate)\n    if (real === null) continue\n",
                "    const real = realOrNull(candidate)\n    if (real === null) continue\n"
                "    if (root === null || !real.startsWith(`${root}/`)) continue\n",
            )
        ],
    ),
    (
        "M9 · ⛔ **the host names a generated image only from a `generated_images` directory again** "
        "— the served-root check, one door over — killed by `legacy-profile-images.test.ts` "
        "(726 R92)",
        [
            (
                HOST,
                "        if (asset) return asset.path\n",
                "        if (asset && asset.path.includes('/generated_images/')) return asset.path\n",
            )
        ],
    ),
    (
        "M10 · ⛔ **a workflow output must be named what it was asked for as, after links** — 108's "
        "`<task_id><ext>` rule in its shape — killed by `workflow-output.test.ts` (726 R92)",
        [
            # ⚑ **Corrected in place at `731`**: the extension line it was anchored after is gone (the
            # PM, ruling on `726` §9), so the name rule is planted after the resolved path instead —
            # the subject, a file refused for its NAME, did not move; re-verified RED alone.
            (
                OUTPUT,
                "  const real = resolved.path\n",
                "  const real = resolved.path\n"
                "  if (basename(real) !== basename(path)) return 'not-readable'\n",
            )
        ],
    ),
    (
        "M11 · ⛔ **a child's file must land inside the directory it was found in** — "
        "`readWithin`'s root, one level up — killed by `child-work.test.ts` (726 R92)",
        [
            (
                CHILD,
                "  const resolved = realPathOf(path)\n"
                "  if (!resolved.ok) return resolved.reason\n"
                "  const read = readTextFile(resolved.path, max)\n",
                "  const resolved = realPathOf(path)\n"
                "  if (!resolved.ok) return resolved.reason\n"
                "  const within = realPathOf(join(path, '..'))\n"
                "  if (!within.ok || !resolved.path.startsWith(`${within.path}/`)) return 'not-readable'\n"
                "  const read = readTextFile(resolved.path, max)\n",
            )
        ],
    ),
    # ── D · what an agent is told ───────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 **the folder rule comes back into the factory text** — `370` W21/W22's *\"Work "
        "inside your working directory … do not write in it\"*, which `726` §2a replaced with a "
        "habit — killed by `the-text-a-child-is-actually-told.test.ts` (726 §2a)",
        [
            (
                FACTORY,
                HABIT,
                "Work inside your working directory. A directory this app did not create belongs to somebody else: read it, and do not write in it. ' +\n    '",
            )
        ],
    ),
    (
        "M13 · ⚠️ **the habit goes, and nothing says where new files go** — the §2a line deleted "
        "rather than restored — killed by `the-text-a-child-is-actually-told.test.ts` (726 §2a)",
        [(FACTORY, HABIT, "' +\n    '")],
    ),
    (
        "M14 · ⛔ **`spawn_agent.cwd` tells a caller the bound again** — killed by "
        "`a-folder-no-agent-can-work-in.test.ts` (726 R92)",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # `spawn_agent.cwd`'s description must not tell a caller a bound that R92 removed. The
        # commit only changed the tail of the sentence, from 'Defaults to the folder this
        # conversation ...' to 'Defaults to your own working directory.', so the plant's `old` line
        # moved. The killer's §7 test reads agent-tools.ts as text and requires 'Working directory:
        # any folder that exists.'.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # folder description does not say the bound is only ever your own folder) still holds on
        # `give_work.folder`, which replaced `spawn_agent.cwd`. The plant puts back the 'may only
        # ever be that folder or one inside it' sentence. Killed by
        # `a-folder-no-agent-can-work-in.test.ts`.
        [
            # ⚑ W4.189 · re-anchored in place, not retired — give_work's folder now also grants a
            # conversation the giver already has; the defect planted is the same.
            # ⚑ **parallel workers · re-anchored in place, not retired** — Parallel-worker tool wording changes this anchor. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
            (TOOLS, "A folder for this piece: any that exists;", "A folder for this piece. It may only ever be that folder or one inside it;"),
        ],
    ),
    (
        "M15 · ⛔ **`reply_to_parent.resource_path` tells a caller the file must be inside its own "
        "folder again** — the sentence `726` replaced — killed by "
        "`a-folder-no-agent-can-work-in.test.ts` (726 R92)",
                # ⚑ **736 · corrected in place, not retired** — `733` F-4 renders the kinds of file
                # (`HELD_FORMS_WITH_EXTENSIONS_SAID`); the row still puts the file inside the folder
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # resource-path description does not tell a caller a file must be inside its folder) still
        # holds on `reply_to_parent.resource_paths`, which replaced `resource_path`. The plant puts
        # back 'inside your own working directory' in place of 'anywhere; a relative path is read
        # from your own working directory'. Killed by `a-folder-no-agent-can-work-in.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # sentence 726 replaced now stands in three tool descriptions (give_work.inputs,
        # reply_to_parent.resource_paths, update_work.resources), each door-neutral after D-016c, so
        # the old bare string matches nothing. The killer reads agent-tools.ts as a whole and
        # asserts `toContain('— ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere;')`, so a plant at one
        # site would leave the other two and stay green; the row therefore carries three edits, each
        # anchored on its own lead-in (each count 1). Killed by
        # `a-folder-no-agent-can-work-in.test.ts`.
        [
            (TOOLS, 'Files to hand over with the work, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory.', 'Files to hand over with the work, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — inside your own working directory.'),
            (TOOLS, 'Files to hand back with the reply, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory.', 'Files to hand back with the reply, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — inside your own working directory.'),
            (TOOLS, 'Files to keep for the piece, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory.', 'Files to keep for the piece, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — inside your own working directory.'),
        ],
    ),
    # ── E · what `726`'s review found the removal had exposed ───────────────────────────────────
    # 🔴 **M16 — RETIRED BY RULING at `731`** — the PM, ruling on `726` §9 (2026-09-25): *"A type allow-list whose purpose is keeping credentials out goes: a text viewer opens any readable text file a person names, `auth.json` included."* The `.jsonl` check M16 kept honest (asked
    # of the name AND of where it lands) existed to refuse `auth.json`, and `731` removed it whole;
    # a check on the name only has nothing left to weaken. ⛔ Its anchor is the removed line; it is
    # not re-anchored. Table `731`'s rows put the allow-list back instead, and die on the flip.
    (
        "M16 · 🔴 **a Codex rollout's TYPE is asked of the name only** — with the root gone, a "
        "`.jsonl` name linked to `auth.json` opens in the child-work viewer — killed by "
        "`runtime-host.test.ts` (726 review)",
        [
            (
                HOST,
                "    if (extname(path) !== '.jsonl' || extname(real.path) !== '.jsonl') {\n",
                "    if (extname(path) !== '.jsonl') {\n",
            )
        ],
    ),
    (
        "M17 · 🔴 **a RELATIVE spawn folder is resolved against this process, not the parent** — "
        "`'.'` starts a child in `/` in the packaged app, and `'sub'` is refused as a folder only a "
        "person can fix — killed by `a-narrowing-that-means-something.test.ts` (726 review)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # RELATIVE folder is read from the parent's own working directory, never from this
        # process's) still holds in the give_work path, where spawn-rails.ts joins `giving.cwd` with
        # the spelled folder. The plant uses the spelled path as is, so it resolves against the
        # process cwd. Killed by `a-narrowing-that-means-something.test.ts`.
        [
            # ⚑ W4.189 · re-anchored in place, not retired — give_work's folder now also grants a
            # conversation the giver already has; the defect planted is the same.
            (SPAWN, '    ? join(giversFolder, spelled)\n', '    ? spelled\n'),
        ],
    ),
    # 🔴 **RETIRED BY RULING at `736`** — R94 (PM): *"BroBot installs the rule the provider's CLI itself suggests for that ask … never a narrower one of BroBot's own."* `728`'s per-file rule (`fileGrantRules`) this row mutated is gone; the grant is the CLI's own suggestion, held to the session (table `736` M1–M4).
    (
        "M18 · ⛔ **approving one read 'for the session' allows EVERY read** — the tool-wide fallback "
        "rule for a read-only tool, which nothing of ours stands in front of since R92 — killed by "
        "`claude-runtime.test.ts` (726 review)",
        # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) makes every narrow grant the CLI's rule for the card's own files (`fileGrantRules`); the subject is unchanged — one read's grant must never allow every read
        [(ADAPTER, "      rules: paths.map((path) => ({ toolName: family, ruleContent: `/${path}` })),\n", "      rules: [{ toolName: family }],\n")],
    ),
]


if __name__ == "__main__":
    raise SystemExit("run through mutate.sh, never directly")
