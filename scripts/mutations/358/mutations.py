"""358 · The tools nobody can see — each row is one way the app lies about what it has.

⛔ **The subject is a JOIN between two facts that must never be merged.** `declared` is what BroBot
handed a session; `published` is what the child says it can see. `353` proved the ordinary path
really does turn the first into the second and that a launch without the toolset delivers none — and
the reason that investigation had to happen is that a declaration can be made and not arrive. Every
row below is either the two halves being confused, or one of the three registry states being drawn
as another.

## ⚑ 444 corrected `M2`'s anchor in place — BOTH sides — and this table has no artefact

⛔ **`M2`'s DEFECT is unchanged.** `444` relay 1 gave `ToolRegistry` a REQUIRED `at: number | null`
— when the conversation stated its inventory, read off the ledger row's own `created_at`, which the
renderer's fold had been receiving and discarding. `createTranscript`'s literal gained the field, so
`M2`'s anchor gained it too.

🔴 **The REPLACEMENT gained it as well, and that is the half a census cannot see.** `mutations:check`
validates the anchor and never the new side, so a replacement that constructs a `ToolRegistry`
without the new required field would have become silently unrunnable — a `--check` that stays green
for ever over a row that no longer compiles (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).

⚠️ **This table is `unrun`: no `mutations.txt`, no recorded verdict**, so nothing was measured
against the old text. ⛔ **The corrected row was still applied ALONE and watched go RED against its
named killer file before being recorded** (444 §7).


## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M9` | ⚑ **`apps/desktop/test/tool-inventory.test.ts`** |
| `M10`, `M12`-`M15` | ⚑ **`packages/runtime/test/claude-runtime.test.ts`** |
| `M11`, `M16` | ⚑ **`packages/runtime/test/codex-runtime.test.ts`** |
| `M17`, `M18` | ⚑ **`packages/runtime/test/tool-inventory.test.ts`** — the BOUNDS live in the runtime |
| `M19`, `M20` | ⚑ **`apps/desktop/test/tool-inventory.test.ts`** — the carry |
| `M21`-`M25` | ⚑ **`apps/desktop/test/dom/session-tools.dom.test.ts`** |

## ⚠️ Four rows survived the first pass, and every one of them moved a TEST

⛔ **`M8`** — dropping the prefix check. Every ordinary built-in (`Bash`, `Read`, `Task`) has no
separator at all and answers `null` whether or not the prefix is tested, so the two readings agreed
on the whole fixture. The state where they diverge is a name with the separator and NO prefix; two
cases now exist for it, one at the split and one at the whole reading.

⛔ **`M17`, `M18`** — the bounds. Their killer was named as the renderer's test, and `boundInventory`
is a RUNTIME function the renderer never calls: the desktop suite could not have seen either row.
`packages/runtime/test/tool-inventory.test.ts` is new, and it is where they are killed.

⛔ **`M24`** — counting declared instead of confirmed. Every fixture on the sheet confirmed all
three tools, so `confirmed === ours` and the two arithmetics gave the same answer — `a-comparison-
tested-where-both-sides-agree-measures-nothing`. The DOM test's partial-publication case now asserts
the summary as well, which is the one reading where they differ.

⚑ **And a fifth defect fell out of writing the runtime test rather than out of a row**: `typeWordOf`
read `type` before `enum`, and zod 4 emits an enum as `{type:'string', enum:[…]}` — so
`approval_mode` presented as `string` and lost the two values that are its whole meaning.

## ⛔ The three states, and why more than half the table is about them

⚠️ **`provider_commands` needed `null ≠ []`; this needs one state more.** Codex will never publish
an inventory, so *"the provider does not report one"* is permanently different from *"nobody has
told us yet"* — and both are different from *"the agent has none"*. Nine rows below turn one of
those three into another, because every one of them is a sentence a person would believe.

## ⛔ What this table deliberately does NOT contain

⛔ **No row swapping `z.looseObject` for `z.object` in `parametersOf`.** Both spellings produce the
same `properties` and the same `required`; only `additionalProperties` differs, and nothing this
surface draws reads it. ⚑ **A line no mutation can kill is not carrying its rule** — but here the
line IS carrying one, just not one this table's gates can see: it keeps the flattening derived from
the same document `codex/agent-tools.ts` hands the child, and `348` measured what a strict object
costs at the door. The row is recorded as absent rather than written as a mutation nothing kills.

⛔ **No row on the sheet's spacing, gaps or chip radii.** They are real and a person sees them, and
a wrong one is a cosmetic defect on a surface whose other defects are false claims about what an
agent can do.

⛔ **No row that makes the Claude adapter emit on a frame with no tool list.** `M12` is its
opposite — publishing `[]` — because that is the direction that LIES. Emitting nothing on a frame
that carried a list would be caught by `M12`'s own killer from the other side, and a row for it
would be the same assertion twice.
"""

VOCAB = "packages/runtime/src/tool-inventory.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
JOIN = "apps/desktop/src/renderer/src/lib/tool-inventory.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
CARRY = "apps/desktop/src/renderer/src/lib/transcript-window.ts"
SHEET = "apps/desktop/src/renderer/src/components/SessionTools.vue"
HEADER = "apps/desktop/src/renderer/src/components/SessionHeader.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the three states, each drawn as another ───────────────────────────────────────────
    (
        "M1 · 🔴 `published: null` is normalized into an empty inventory, so a Codex conversation "
        "reads as one whose tools did not arrive",
        [
            (
                FOLD,
                "          published:\n            event.published === null\n              ? null\n              : {",
                "          published:\n            event.published === null\n              ? { tools: [], servers: [] }\n              : {",
            )
        ],
    ),
    (
        "M2 · ⛔ the registry starts holding a statement nobody made — every fresh conversation "
        "says 'the provider publishes no inventory' before any adapter has spoken "
        "⚑ ANCHOR CORRECTED IN PLACE BY 444",
        [
            (
                FOLD,
                "    tools: { set: null, dropped: 0, at: null },",
                "    tools: { set: { naming: { prefix: '', separator: '__' }, declared: null, published: null }, dropped: 0, at: null },",
            )
        ],
    ),
    (
        "M3 · ⛔ 'nobody has told us' is given the sentence that means 'this provider does not "
        "report' — a session that has not started reads as a permanent limitation",
        [
            (
                JOIN,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "      kind: 'untold',\n      provenance:\n        'BroCrew has not been told what this conversation has.",
                "      kind: 'unpublished',\n      provenance:\n        'This provider publishes no tool inventory. BroCrew has not been told what this conversation has.",
            )
        ],
    ),
    # ── §2 · offered is not confirmed ──────────────────────────────────────────────────────────
    (
        "M4 · 🔴 a provider that publishes NOTHING is taken to have confirmed everything — the "
        "whole Codex arm becomes a claim it cannot make",
        [
            (
                JOIN,
                "                published === null\n                  ? ('unconfirmable' as const)",
                "                published === null\n                  ? ('confirmed' as const)",
            )
        ],
    ),
    (
        "M5 · 🔴 a tool the agent did NOT list is drawn as confirmed — the exact failure this "
        "surface exists to make visible",
        [
            (
                JOIN,
                "                  : listedUnderOurs.has(qualified)\n                    ? ('confirmed' as const)\n                    : ('offered' as const),",
                "                  : ('confirmed' as const),",
            )
        ],
    ),
    (
        "M6 · ⛔ the join compares BARE names, so on Claude nothing ever matches and every tool "
        "reads as one the agent was never given",
        [
            (
                JOIN,
                "                  : listedUnderOurs.has(qualified)",
                "                  : listedUnderOurs.has(tool.name)",
            )
        ],
    ),
    # ── §3 · the spelling is data, and it has to be the right data ─────────────────────────────
    (
        "M7 · ⛔ a tool name that contains the separator loses its tail, so `srv__a__b` is filed "
        "under a tool called `a`",
        [
            (
                JOIN,
                "  const tool = body.slice(at + naming.separator.length)\n  if (tool === '') return null\n  return { server: body.slice(0, at), tool }",
                "  const parts = body.split(naming.separator)\n  const tool = parts[1] ?? ''\n  if (tool === '') return null\n  return { server: body.slice(0, at), tool }",
            )
        ],
    ),
    (
        "M8 · ⛔ every built-in is read as a qualified name, so the agent's own tools are filed "
        "under invented servers",
        [
            (
                JOIN,
                "  if (!name.startsWith(naming.prefix)) return null\n  const body = name.slice(naming.prefix.length)",
                "  const body = name.startsWith(naming.prefix) ? name.slice(naming.prefix.length) : name",
            )
        ],
    ),
    (
        "M9 · ⛔ a status word nobody enumerated is counted as connected, so an unknown state "
        "reads as a working one",
        [
            (
                JOIN,
                "  return STATUS_WORDS[status] ?? { label: status, tone: 'unknown', connected: false }",
                "  return STATUS_WORDS[status] ?? { label: status, tone: 'unknown', connected: true }",
            )
        ],
    ),
    # ── §4 · what the adapters publish ─────────────────────────────────────────────────────────
    (
        "M10 · ⛔ Claude's spelling loses its prefix, so every qualified name the child publishes "
        "stops matching what the app says the model must type",
        [
            (
                VOCAB,
                "export const CLAUDE_TOOL_NAMING: ToolNaming = { prefix: 'mcp__', separator: '__' }",
                "export const CLAUDE_TOOL_NAMING: ToolNaming = { prefix: '', separator: '__' }",
            )
        ],
    ),
    (
        "M11 · ⛔ Codex is given Claude's spelling — `353` measured the five arriving UNPREFIXED, "
        "and a surface using `mcp__` there would name tools the model does not answer to",
        [
            (
                VOCAB,
                "export const CODEX_TOOL_NAMING: ToolNaming = { prefix: '', separator: '__' }",
                "export const CODEX_TOOL_NAMING: ToolNaming = { prefix: 'mcp__', separator: '__' }",
            )
        ],
    ),
    (
        "M12 · 🔴 a frame that published NO tool list publishes an empty one instead — 'we have "
        "not been told' becomes 'this conversation has no tools'",
        [
            (
                CLAUDE,
                "    if (!Array.isArray(tools)) return\n    const servers = frame['mcp_servers']",
                "    const servers = frame['mcp_servers']",
            ),
            (
                CLAUDE,
                "    const namedTools = tools.filter((one): one is string => typeof one === 'string')",
                "    const namedTools = (Array.isArray(tools) ? tools : []).filter(\n      (one): one is string => typeof one === 'string',\n    )",
            ),
        ],
    ),
    (
        "M12b · 🔴 the rows the defensive read sheds stop being counted, so a server frame with no "
        "`status` prints 'the agent did not list this server' about one the child DID list — with "
        "the shortfall banner silenced",
        [
            (
                CLAUDE,
                "    const dropped = bounded.dropped + shedBeforeBounding",
                "    const dropped = bounded.dropped",
            )
        ],
    ),
    (
        "M13 · ⛔ every `system/init` writes a row, so a cron waking a session three times fills "
        "the ledger with four identical statements that nothing happened",
        [
            (
                CLAUDE,
                "    if (key === this.lastInventory) return\n    this.lastInventory = key",
                "    this.lastInventory = key",
            )
        ],
    ),
    (
        "M14 · ⛔ the emit inherits the neighbouring branch's `message.model` guard, so a frame "
        "that named no model silently carries its tool list to nobody",
        [
            (
                CLAUDE,
                # Source-only re-anchor; the mutation verdict has not been re-verified.
                "        if (message.type === 'system' && message.subtype === 'init') {\n          this.skillCatalogueConfirmed = false",
                "        if (message.type === 'system' && message.subtype === 'init' && message.model) {\n          this.skillCatalogueConfirmed = false",
            )
        ],
    ),
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M15 · ⛔ the declaration is never taken, so every Claude conversation reports tools it "
        "cannot describe — names with no sentence and no arguments",
        [('packages/runtime/src/claude/claude-runtime.ts', '    this.declaredToolset =\n      toolset === undefined', '    this.declaredToolset =\n      true || toolset === undefined')],
    ),
    (
        "M16 · 🔴 Codex claims to have published an inventory — the one thing this whole event "
        "exists to say it never does",
        [
            (
                CODEX,
                "      // ⛔ **The whole point of the arm.** See the docblock.\n      published: null,",
                "      published: { tools: [], servers: [] },",
            )
        ],
    ),
    # ── §5 · the bounds, and the carry no compiler could check ─────────────────────────────────
    (
        "M17 · ⛔ a row dropped for a bad name is not counted, so the inventory understates what "
        "the conversation has with nothing saying so",
        [
            (
                VOCAB,
                "    dropped += sent.published.tools.length - tools.length\n    dropped += sent.published.servers.length - servers.length",
                "    dropped += sent.published.servers.length - servers.length",
            )
        ],
    ),
    (
        "M18 · ⛔ a nameless row survives bounding, so the sheet draws a tool that cannot be "
        "joined on and cannot be typed",
        [
            (
                VOCAB,
                "function usableName(name: string): boolean {\n  return name.trim() !== '' && name.length <= MAX_TOOL_NAME",
                "function usableName(name: string): boolean {\n  return name.length <= MAX_TOOL_NAME",
            )
        ],
    ),
    (
        "M19 · 🔴 the registry is not carried across a window release, so a conversation long "
        "enough to roll its window forgets the five tools it was launched with — and NOTHING in "
        "the typechecker could have said so, because `FoldCarry` is hand-written",
        [
            (
                CARRY,
                "    state.commands = carry.commands\n    state.tools = carry.tools",
                "    state.commands = carry.commands",
            )
        ],
    ),
    (
        "M20 · ⛔ the carry ALIASES the published list instead of copying it, so two folds share "
        "one array and can disagree about it later",
        [
            (
                CARRY,
                "                      tools: [...state.tools.set.published.tools],",
                "                      tools: state.tools.set.published.tools,",
            )
        ],
    ),
    # ── §6 · what the surface says ─────────────────────────────────────────────────────────────
    (
        "M21 · 🔴 the header count reports the child's WHOLE published list, so `37` stands where "
        "`5` belongs and BroBot's own tools are buried in the provider's built-ins",
        [
            (
                HEADER,
                "const toolCount = computed(() => toolsRead.value?.own?.tools.length ?? null)",
                "const toolCount = computed(() => toolsRead.value?.builtins.length ?? null)",
            )
        ],
    ),
    (
        "M22 · ⛔ the count renders `0` on a conversation nobody has reported on — a number that "
        "says 'this conversation has no tools' about one that has not been asked",
        [
            (
                HEADER,
                "const toolCount = computed(() => toolsRead.value?.own?.tools.length ?? null)",
                "const toolCount = computed(() => toolsRead.value?.own?.tools.length ?? 0)",
            )
        ],
    ),
    (
        "M23 · ⛔ BroBot's own tools are swept into the provider's built-in list, so the one "
        "grouping this sheet exists to get right is the one it gets wrong",
        [
            (
                JOIN,
                "    const split = splitQualified(set.naming, name)\n    if (split === null) {\n      builtins.push(name)\n      continue\n    }",
                "    const split = splitQualified(set.naming, name)\n    builtins.push(name)\n    if (split === null) {\n      continue\n    }",
            )
        ],
    ),
    (
        "M24 · ⛔ the summary counts what was DECLARED rather than what was confirmed, so a "
        "conversation whose tools never arrived reports full strength",
        [
            (
                JOIN,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "      : `${confirmed} of ${ours} BroCrew tools confirmed`",
                "      : `${ours} of ${ours} BroCrew tools confirmed`",
            )
        ],
    ),
    (
        "M25 · ⛔ a cap that bit says nothing, so the sheet quietly understates the inventory — "
        "`247` §3: a registry that undercounts is worse than none",
        [
            (
                SHEET,
                '      <p v-if="reading.dropped > 0" class="shortfall" data-cy="tools-dropped" role="alert">',
                '      <p v-if="false" class="shortfall" data-cy="tools-dropped" role="alert">',
            )
        ],
    ),
]
