"""330 · The memory write we render as an ordinary file — each row is THE DEFECT, put back verbatim (131).

⛔ **What 330 fixed, in one sentence.** A Claude memory write arrives on the wire as an ordinary
`Write` naming a 90-character path, and the transcript rendered it as exactly that — so the word
*memory* was never on screen, and the person worked out what he was looking at himself: *"it shows bash
calls when it's writing memories.. maybe good enough."*

## ⚑ The evidence, because §2 changed what this dispatch built

330 §2 asked what the CLI sends back about the memory directory this app tells it to use — a question
`318`/`319` never asked, having measured the RECALL path only. ⛔ **Enumerating FIELDS rather than
item types** (`316`'s defect, named in the brief), across 133 distinct key paths at every depth of 77
frames of a real `2.1.218` session, plus a control write into the cwd:

| signal | where | the control |
|---|---|---|
| `memory_paths.auto` | every `system/init`, once per turn | — |
| `memdirStamped: true` | `tool_use_result` of the TOPIC write | absent on `MEMORY.md`, absent on the cwd write |

🔴 **So the store's location is the PROVIDER's answer, not `claudeAutoMemoryDir` re-derived**, which
is what §3.1 proposed. `M2` is that weaker design, and it survives every ordinary fixture — which is
why its killer is the arm where the two disagree.

⛔ **`memdirStamped` is not the predicate and no row makes it one.** It is absent on the index write,
which is the second of the two rows the person saw, and it arrives on the RESULT — a message after the row
is drawn. A table row asserting it would be pinning a design this dispatch measured and refused.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M14` | ⚑ **`run_suite`** — `packages/runtime/test/claude-memory-store.test.ts` |
| `M15`-`M18` | ⚑ **`run_suite`** — `packages/runtime/test/claude-memory-row.test.ts` |
| `M19`-`M21` | ⚑ **`run_suite`** — `apps/desktop/test/memory-write-fold.test.ts` |
| `M22`-`M26` | ⚑ **`run_suite`** — `apps/desktop/test/dom/the-memory-write-we-render-as-a-file.dom.test.ts` |
| `M27`-`M28` | ⚑ **`run_suite`** — `apps/desktop/test/instructions.test.ts` + the same DOM file |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row labels a `Bash` command.** `M7` is the mutation that TRIES to, because 330 §3.3 named it
as the way a label becomes a lie; there is no row anywhere that asserts the opposite.

⛔ **No row gives a sub-agent card row the field.** That absence is a ruling with its own test
(`M20`), not an oversight, and a row that added it would be pinning a surface change 330 refused.

⛔ **No row flips `recallsReported`.** 319 owns that flag and 330 does not reopen it; `M27`/`M28` are
about the SECOND flag and about the two staying independent, which is the whole of 310's rule here.

⛔ **No row models §3.1's design — re-deriving `claudeAutoMemoryDir(providerHome)` — and it cannot.**
`ClaudeMemoryStore` has no provider home to re-derive from; that is the CHANGE, not an omission. The
two designs differ only when the CLI's resolver disagrees with what this app sent (`policySettings`
outranks `flagSettings`), which no fixture on this machine can produce. ⚠️ A row pretending to model
it would have been a no-op recording as a survivor — `a-mutation-that-changes-nothing-reports-as-a-
survivor` — and the first draft of this table contained exactly that. The argument lives in the
response and in `memory-store.ts`, where it can be read rather than mis-measured.
"""

MEM = "packages/runtime/src/claude/memory-store.ts"
NORM = "packages/runtime/src/claude/normalize.ts"
EVENTS = "packages/runtime/src/events.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
ENTRY = "apps/desktop/src/renderer/src/components/ToolEntry.vue"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
INSTR = "apps/desktop/src/main/runtime/instructions.ts"

MUTATIONS = [
    # ── the defect itself ─────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · nothing is ever labelled, so a memory write is an ordinary "
        "file row again — the whole ticket",
        [
            (
                MEM,
                "    if (root === null || realRoot === null) return null",
                "    if (root === null || realRoot === null) return null\n    return null",
            )
        ],
    ),
    (
        "M2 · ⛔ containment becomes a string PREFIX · `<store>-evil/x.md` has `<store>` as a prefix "
        "and is somewhere else entirely, so a directory beside the store is reported as memory",
        [
            (
                MEM,
                "      if (!isWithin(root, lexical)) continue\n"
                "      const real = realResolve(lexical)\n"
                "      if (real === null || !isWithin(realRoot, real)) continue",
                "      if (!lexical.startsWith(root)) continue\n"
                "      const real = realResolve(lexical)\n"
                "      if (real === null || !real.startsWith(realRoot)) continue",
            )
        ],
    ),
    # ── containment: the real-path half ───────────────────────────────────────────────────────
    (
        "M3 · ⛔ the store root is trusted as spelled · 170's finding undone — `<home>/memory -> "
        "<home>` makes the profile's own CLAUDE.md a memory file by construction",
        [(MEM, "    const attested = attestedRoot(auto)", "    const attested = resolve(auto)")],
    ),
    (
        "M4 · ⛔ only the lexical spelling is compared · a symlink INSIDE the store that leads out of "
        "it is labelled as a memory",
        [
            (
                MEM,
                "      if (real === null || !isWithin(realRoot, real)) continue",
                "      if (real === null) continue",
            )
        ],
    ),
    (
        "M5 · ⛔ only the REAL spelling is compared · the label reaches further than the permission "
        "layer does, so a row claims memory about a file the card would still raise",
        [
            (
                MEM,
                "      if (!isWithin(root, lexical)) continue\n",
                "",
            )
        ],
    ),
    (
        "M6 · ⛔ an unresolvable path is labelled · 183's rule undone — *we could not tell* and *it "
        "is a memory* become one answer",
        [
            (
                MEM,
                "      const real = realResolve(lexical)\n"
                "      if (real === null || !isWithin(realRoot, real)) continue",
                "      const real = realResolve(lexical) ?? lexical\n"
                "      if (!isWithin(realRoot, real)) continue",
            )
        ],
    ),
    # ── which string is the target ────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 §3.3's lie, built · the predicate reads a shell command string, so `Bash ls` of the "
        "store becomes a memory row and the label stops being about a file at all",
        [
            (
                MEM,
                "      if (typeof value !== 'string' || !namesATarget(value, key)) continue",
                "      if (typeof value !== 'string') continue\n"
                "      if (!namesATarget(value, key) && !value.includes(root)) continue",
            )
        ],
    ),
    (
        "M8 · ⛔ any absolute string is a target · 190 H1's split classifier, as a label — a `content` "
        "string that happens to be a path labels the row",
        [
            (
                MEM,
                "      if (typeof value !== 'string' || !namesATarget(value, key)) continue",
                "      if (typeof value !== 'string' || !value.startsWith('/')) continue",
            )
        ],
    ),
    # ── the shape of the answer ───────────────────────────────────────────────────────────────
    (
        "M9 · ⛔ the store DIRECTORY names itself · a `Read` of the store gets an empty label, which "
        "is a badge with nothing beside it",
        [
            (
                MEM,
                "      const rel = relative(root, lexical)\n      if (rel !== '') return rel",
                "      return relative(root, lexical)",
            )
        ],
    ),
    (
        "M10 · ⛔ the relative path is sliced rather than derived · the provider's trailing separator "
        "leaks into the answer and every label starts with `/`",
        [
            (
                MEM,
                "      const rel = relative(root, lexical)",
                "      const rel = lexical.slice(root.length)",
            )
        ],
    ),
    # ── the registry's lifecycle ──────────────────────────────────────────────────────────────
    (
        "M11 · ⛔ any frame may set the store · a `result` frame carrying no `memory_paths` withdraws "
        "the labelling mid-turn",
        [
            (
                MEM,
                "    if (message.type !== 'system' || message.subtype !== 'init') return",
                "    if (message.type === 'assistant') return",
            )
        ],
    ),
    (
        "M12 · ⛔ the store LATCHES · a build that stopped naming its memory directory goes on being "
        "labelled from the last frame that did",
        [
            (
                MEM,
                "    if (typeof auto !== 'string' || auto === '') {\n      this.root = null",
                "    if (typeof auto !== 'string' || auto === '') {\n      if (this.root !== null) return\n      this.root = null",
            )
        ],
    ),
    (
        "M13 · ⛔ an EMPTY `memory_paths.auto` is accepted · `resolve('')` is the process cwd, so "
        "every write under it is reported as this profile's memory",
        [
            (
                MEM,
                "    if (typeof auto !== 'string' || auto === '') {",
                "    if (typeof auto !== 'string') {",
            )
        ],
    ),
    (
        "M14 · ⛔ a relative `file_path` becomes a target by being resolved against the store first · "
        "the SDK's own tool schema says it may not be one, so this labels a string the call never wrote",
        [
            (
                MEM,
                "      if (typeof value !== 'string' || !namesATarget(value, key)) continue\n"
                "      const lexical = resolve(value)",
                "      if (typeof value !== 'string' || !namesATarget(resolve(root, value), key)) continue\n"
                "      const lexical = resolve(root, value)",
            )
        ],
    ),
    # ── the normalizer ────────────────────────────────────────────────────────────────────────
    (
        "M15 · ⛔ the init frame is never read · the registry is handed every message except the one "
        "that carries the store, so nothing is ever labelled",
        [(NORM, "  memory.noteInit(message)", "  if (message.type === 'assistant') memory.noteInit(message)")],
    ),
    (
        "M16 · ⛔ the key is written even when there is nothing to say · every ordinary tool row "
        "carries `memoryPath: undefined`, which the ledger round-trips as a field nobody set",
        [
            (
                NORM,
                "              ...(memoryPath === null ? {} : { memoryPath }),",
                "              memoryPath: memoryPath ?? undefined,",
            )
        ],
    ),
    (
        "M17 · ⛔ the registry is asked about the BLOCK rather than the call's input · the tool_use "
        "envelope declares no path field, so nothing is ever labelled and every runtime unit passes "
        "the store around for nothing",
        [
            (
                NORM,
                "            const memoryPath = memory.target(block['input'])",
                "            const memoryPath = memory.target(block)",
            )
        ],
    ),
    (
        "M18 · ⛔ the cap goes · a relative path four kilobytes long rides into a one-line row and "
        "the ledger accepts it",
        [(EVENTS, "export const MAX_MEMORY_PATH = 512", "export const MAX_MEMORY_PATH = 65_536")],
    ),
    # ── the fold ──────────────────────────────────────────────────────────────────────────────
    (
        "M19 · ⛔ the fold drops it · the event carries the label and the row never sees it, which is "
        "the defect that is invisible to every runtime test",
        [
            (
                FOLD,
                "        ...(event.memoryPath === undefined ? {} : { memoryPath: event.memoryPath }),",
                "",
            )
        ],
    ),
    (
        "M20 · ⛔ a sub-agent card row is given the field · 327 D13's shape — a conditional spread "
        "writing past a type that does not declare it, storing what nothing renders",
        [
            (
                FOLD,
                "        owner.body.push({\n          kind: 'tool',\n          callId: event.id,\n          name: event.name,\n          summary: event.summary,\n        })",
                "        owner.body.push({\n          kind: 'tool',\n          callId: event.id,\n          name: event.name,\n          summary: event.summary,\n          ...(event.memoryPath === undefined ? {} : { memoryPath: event.memoryPath }),\n        } as never)",
            )
        ],
    ),
    (
        "M21 · ⛔ the raw stream stops naming the target · the debug tab and the conversation stop "
        "being the same fact, which is what `provider_commands`' rule exists to prevent",
        [
            (
                "apps/desktop/src/renderer/src/lib/describe-event.ts",
                "      return `${event.name} · ${event.id}${event.memoryPath === undefined ? '' : ` · memory: ${event.memoryPath}`}`",
                "      return `${event.name} · ${event.id}`",
            )
        ],
    ),
    # ── the row ───────────────────────────────────────────────────────────────────────────────
    (
        "M22 · ⛔ the badge goes · the row is back to a tool name and a path, which is exactly what "
        "the person was looking at when he told us it was *maybe good enough*",
        [
            (
                ENTRY,
                '          <span class="memory-badge" data-cy="tool-memory">this profile’s memory</span>\n',
                "",
            )
        ],
    ),
    (
        "M23 · ⛔ the badge is drawn on every row · a `Bash` call and an ordinary `Write` both claim "
        "to be this profile's memory, which is 086 in the direction that costs trust",
        [(ENTRY, '        <template v-if="item.memoryPath">', "        <template v-if=\"true\">")],
    ),
    (
        "M24 · ⛔ a labelled row shows the whole path again · §3.5's half-fix, which the dispatch "
        "names by name: *a label plus the same unreadable path is half a fix*",
        [
            (
                ENTRY,
                '          <code :title="item.summary" data-cy="tool-memory-path">{{ item.memoryPath }}</code>',
                '          <code :title="item.summary" data-cy="tool-memory-path">{{ item.summary }}</code>',
            )
        ],
    ),
    (
        "M25 · ⛔ the whole path becomes unreachable · the short form is all there is, so the row "
        "traded the record away for the readability rather than adding it",
        [
            (
                ENTRY,
                '          <code :title="item.summary" data-cy="tool-memory-path">{{ item.memoryPath }}</code>',
                '          <code data-cy="tool-memory-path">{{ item.memoryPath }}</code>',
            )
        ],
    ),
    (
        "M26 · ⛔ the ordinary branch loses its summary · every non-memory row goes blank, which no "
        "assertion about the memory rows would ever notice",
        [(ENTRY, '        <code v-else>{{ item.summary }}</code>', "")],
    ),
    # ── the panel, and the two flags ──────────────────────────────────────────────────────────
    (
        "M27 · ⛔ the write sentence rides the RECALL flag · 310's defect rebuilt — one fact wearing "
        "two names, so a provider that reports one is promised both",
        [
            (
                PANEL,
                '        <span v-if="instructions.writesReported" data-cy="memory-store-write-is-shown">',
                '        <span v-if="instructions.recallsReported" data-cy="memory-store-write-is-shown">',
            )
        ],
    ),
    (
        "M28 · ⛔ the provider that publishes no item for a write is told its writes are shown · 316's "
        "fifteen arms said otherwise, and a disk observation is not the conversation showing the write",
        [(INSTR, "      writesReported: false,", "      writesReported: true,")],
    ),
]
