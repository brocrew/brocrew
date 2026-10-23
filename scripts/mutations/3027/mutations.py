"""3027 · F093's backend · what a launch and a turn kept, the one read, memory paging, each child's context — 7973c2fd, 8efcfba7.

⛔ **The subject**: F093 lets a person see what an agent was actually given. A launch keeps a record of
what it gave (the profile file, the tools and how they are handed); a turn keeps the words that were
really handed to the provider (`sent`); one read (`whatThisAgentWasGiven`) says who wrote each part;
memory is paged through the window's door behind a person gate; each conversation at work carries
its own context reading. 🔴 **And the HIGH: a look at a person's own conversation writes nothing
into their own provider folder** (`~/.codex`, `~/.claude`).

⛔ **No row can write into a real home.** The HIGH rows' killer
(`a-look-at-the-persons-own-conversation-writes-nothing-in-their-folder.test.ts`) points `HOME`,
`CODEX_HOME` and `CLAUDE_CONFIG_DIR` at a throwaway folder and refuses to run otherwise (it throws
before any host call unless the person's folder and `homedir()` are inside the throwaway folders),
so even under the planted defect the only writes are inside temp folders.

## ⚑ What a row here measures

 * 🔴 **M1–M4 are the HIGH, in `runtime-host.ts`** (the look and the read compose into a home only
   when it is a home this app manages): a look composing into the person's folder (M1), the read
   composing into it (M2), a string-prefix check that takes `<root>-theirs` as managed (M3), and the
   over-broad guard that never composes into BroBot's own homes (M4).
 * ⚑ **M5–M7 are what a launch and a turn kept** (`runtime-host.ts`): `sent` keeps the words rather
   than what was handed over (M5), a turn that handed over no words (Codex `/compact`) gets a
   `sent` (M6), a reopen's `launched` row keeps no record (M7).
 * ⚑ **M8–M10 are the one read** (`what-this-agent-was-given.ts`, `ipc.ts`): a Codex external server
   drawn as in every request (M8), tool search counted as full definitions in the total (M9), and the
   read open to an agent channel (M10).
 * ⚑ **M11 is a refused file** counted in the sizes (`what-this-agent-was-given.ts`).
 * ⚑ **M12–M13, M15 are memory paging**: amendable by page, not by position (M12, `agent-memory.ts`),
   a limit-only request not paged (M13, `ipc.ts`), and 8efcfba7's person gate on the paged arm
   removed (M15, `ipc.ts`: the dev follow-up moved the gate INTO the paged arm, behind its own check,
   so a paged read from a sink no person is behind must be refused as the first twenty are).
 * ⚑ **M14 is each child's context** (`runtime-host.ts`): one conversation's reading shown on every
   conversation at work.

## ⛔ What this table does not contain

 * ⚠️ The rows for the refusal reasons of the profile file other than `unmanaged-override`: the only
   refusal the read can carry is the profile file's, and `over-budget` is never drawn for other files.
 * ⚠️ Spares from the drafting notes (not written): the page-edge `break` → `continue` in
   `instructions.ts`, the closed read's ledger fallback, the profile-file-once `continue`, and the
   `foundInUserHome` import flag.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
GIVEN = "apps/desktop/src/main/runtime/what-this-agent-was-given.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
MEMORY = "apps/desktop/src/main/runtime/agent-memory.ts"

OWN = "a-look-at-the-persons-own-conversation-writes-nothing-in-their-folder.test.ts"
KEPT = "what-a-launch-and-a-turn-kept-is-what-the-provider-got.test.ts"
READ = "the-one-read-says-who-wrote-each-part-and-how-the-tools-are-handed.test.ts"
REFUSED = "a-refused-file-is-listed-and-not-counted.test.ts"
PAGES = "memory-pages-past-the-first-twenty-through-the-window-door.test.ts"
CHILD = "each-conversation-at-work-carries-its-own-context-reading.test.ts"
GATE = "an-agent-memory-read-asks-a-person-on-both-arms.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 a look at the person's own conversation composes the rules into their own "
        f"`~/.codex` / `~/.claude` · killed by `{OWN}`",
        [(HOST,
          "const instructions = this.composesInItsOwnHome(providerHome)",
          "const instructions = true")],
    ),
    (
        "M2 · 🔴 the one read composes into the person's own folder · killed by "
        f"`{OWN}`",
        [(HOST,
          "const read = this.composesInItsOwnHome(providerHome)",
          "const read = true")],
    ),
    (
        "M3 · 🔴 a folder whose NAME starts with the managed root (`<root>-theirs`) is taken as "
        f"managed, by a string prefix · killed by `{OWN}`",
        [(HOST,
          "    const inside = relative(resolvePath(root), resolvePath(providerHome))\n"
          "    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)\n",
          "    return resolvePath(providerHome).startsWith(resolvePath(root))\n")],
    ),
    (
        "M4 · over-broad guard: BroBot's own homes are never composed into for a look or a read "
        f"· killed by `{OWN}`",
        [(HOST,
          "    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)\n",
          "    return false\n")],
    ),
    (
        "M5 · a turn's `sent` keeps the words the person typed, not what was handed to the "
        f"provider · killed by `{KEPT}`",
        [(HOST,
          # ⚑ **W4.179 · re-anchored in place, not retired** — W4.179 records the lead beside `sent` in the same branch; the mutation still keeps the typed words
          # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The saved-methods index is kept out of records here; original defect, ID and killer retained.
          "        event.sent = kept\n",
          "        event.sent = event.text\n")],
    ),
    (
        "M6 · a turn that handed over no words (Codex `/compact`) is still given a `sent` · "
        f"killed by `{KEPT}`",
        [(HOST,
          "if (sent === null || framed.length !== words.length) return {}",
          "if (framed.length !== words.length) return {}")],
    ),
    (
        "M7 · a reopen's `launched` row keeps no record of what the launch gave · killed by "
        f"`{KEPT}`",
        [(HOST,
          "      cwd: row.cwd,\n      providerHome,\n      profileId,\n      launchGave,\n",
          "      cwd: row.cwd,\n      providerHome,\n      profileId,\n")],
    ),
    (
        "M8 · a Codex external server is drawn as in every request, not found by search · killed "
        f"by `{READ}`",
        [
            ("apps/desktop/src/main/providers/codex/given.ts", "    kind: 'found-by-search',", "    kind: 'in-every-request',"),
        ],
    ),
    (
        "M9 · tool search is counted as full definitions in the total, not as names · killed by "
        f"`{READ}`",
        [(GIVEN,
          "    deferral.kind === 'names-until-loaded'\n",
          "    false\n")],
    ),
    (
        "M10 · 🔴 the one read (an agent's memory verbatim, its own instructions) is open to an "
        f"agent channel · killed by `{READ}`",
        [(IPC,
          "      requireAPerson(sink, command.kind)\n"
          "      return host.whatThisAgentWasGiven(command.sessionId)\n",
          "      return host.whatThisAgentWasGiven(command.sessionId)\n")],
    ),
    (
        "M11 · a refused file is counted in the sizes and the total · killed by "
        f"`{REFUSED}`",
        [(GIVEN,
          "const reaching = files.filter((one) => one.refused === null)",
          "const reaching = files")],
    ),
    (
        "M12 · amendment is wrongly limited to the first window page · killed by "
        f"`{PAGES}`",
        [(MEMORY,
          '    const entries: AgentMemoryEntry[] = paged.memory.map((item) => ({\n      ...item,\n      amendable: amendable(item.path, item.link, root),\n    }))',
          '    const entries: AgentMemoryEntry[] = paged.memory.map((item) => ({\n      ...item,\n      amendable: page.offset === 0 && amendable(item.path, item.link, root),\n    }))')],
    ),
    (
        "M13 · a request that names only a limit is not paged · killed by "
        f"`{PAGES}`",
        [(IPC,
          "if (command.offset !== undefined || command.limit !== undefined) {",
          "if (command.offset !== undefined) {")],
    ),
    (
        "M14 · one conversation's context reading is shown on every conversation at work · "
        f"killed by `{CHILD}`",
        [(HOST,
          "            context: session.latestContext,",
          "            context: [...this.slots.values()].find((one) => one.session?.latestContext != null)?.session?.latestContext ?? null,")],
    ),
    (
        "M15 · 🔴 the person gate on the PAGED arm of `agentMemory` is removed — a paged read of "
        f"an agent's memory verbatim is answered to an agent channel · killed by `{GATE}`",
        [(IPC,
          "      if (command.offset !== undefined || command.limit !== undefined) {\n"
          "        requireAPerson(sink, command.kind)\n"
          "        return host.agentMemoryPage(\n",
          "      if (command.offset !== undefined || command.limit !== undefined) {\n"
          "        return host.agentMemoryPage(\n")],
    ),
]
