"""486 · the doors our own verbs do not need — HO-031 §2.4 and §2.5.

⛔ **Two rulings, one commit, and the rows below are split between them.**

| § | the defect | rows |
|---|---|---|
| §2.4 | a project manager needed a human click to answer its own parent | `M1`-`M8` |
| §2.5 | a policy wall arrived as `malformed-request` + `permanent` | `M9`-`M15` |

## 🔴 §2.4 · the split is DECLARED, so a name list cannot drift from it

⚑ **The ruling:** *"The brobot tools are gated by RAILS. Permissions are for acts that reach
outside this app."* ⚠️ *"Double-gating them means every task needs a human click to close, which
breaks the loop the tools exist to make."*

⛔ **`beyondItsRails` is required on every `AgentToolDefinition`**, so a verb added later cannot
arrive un-classified, and BOTH adapters read that one word rather than holding a list of names.
🔴 **`M1` is the whole design in one row**: move the word on one verb's declaration and both
providers change their minds together.

## 🔴 §2.5 · entitlement before argument shape

⚑ **Measured:** the PM sent `{profile_slug:'project-manager', role:'DEV-75297'}`, the argument check
answered first, and `malformed-request · permanent` sent a model that obeys this app's own advice —
*read a permanent refusal rather than retrying one* — to the false conclusion. ⛔ **The real rail was
`may-not-create-agents`, and it was only ever found because the PM disobeyed.**

## ⛔ What this table deliberately does NOT contain

⚠️ **No row on the PLAN-mode floor.** `461` owns `TOOLS_THAT_ONLY_ASK_A_PERSON` and its rows live
with that dispatch; this one sits BELOW that branch and moving it would be `486` holding an opinion
about a class somebody else measured. ⚑ `M4` is the nearest this table comes, and it asserts the
ORDER rather than the class.

⚠️ **No row on `no-such-agent`'s fold.** Whether *not there* and *not yours* are one answer is
`341`'s ruling and `TOOL_REFUSALS`' own note; `486` changed which question is asked FIRST and never
what the fold says.

⚠️ **No row repricing `cwd-outside-parent`, `not-your-project` or `spawn-must-prompt`.** Each was
read adversarially while `M13`/`M14` were written and each survived: a folder, a project the parent
never created, and a mode nobody can grant are facts about the CALL. ⛔ A row here would be this
dispatch repricing rails it argued should keep their word.

⚠️ **No row on `document-bytes-missing` / `document-bytes-changed`.** Both are unargued `permanent`
rows whose wall only a person can clear — ⛔ **and neither is a POLICY wall**, which is the class
HO-031 §2.5 ruled on. They are reported as a finding rather than repriced here.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1` | ⚑ **`apps/desktop/test/the-doors-our-own-verbs-do-not-need.test.ts`** §1 — the split read off the real toolset, by name |
| `M2`, `M3` | ⚑ **`packages/runtime/test/claude-runtime.test.ts`** §486 — `reply_to_parent` answers `allow`, and a yield is not an allow |
| `M4`, `M5` | ⚑ the same file — the plan floor and the name-blind path scan both still answer FIRST |
| `M6` | ⚑ the same file — the exemption is the session's own toolset, spelled its own way |
| `M7`, `M8` | ⚑ **`packages/runtime/test/codex-runtime.test.ts`** §348 — the second enforcer, and a verb nobody declared |
| `M9`, `M10` | ⚑ **the desktop file** §2 and §3 — the wall answers first, and answering first is not an oracle |
| `M11` | ⚑ the desktop file §2 — the kill switch at the spawn door |
| `M12` | ⚑ the desktop file §2 — `may-not-end` / `may-not-interrupt` before the shape |
| `M13`, `M14` | ⚑ the desktop file §4, and `the-rails-a-message-passes.test.ts` §5 |
| `M15` | ⚑ **`apps/desktop/test/the-rails-a-message-passes.test.ts`** — the project comparison |

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes — the whole table has NOT been run under the
driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
MESSAGE = "apps/desktop/src/main/runtime/message-rails.ts"
SPAWN = "apps/desktop/src/main/runtime/spawn-rails.ts"

# The path scan underlying this rails exemption is gone. Retain the absent anchor as retired instead
# of moving the row onto another guard.
MUTATIONS = [
    # ── §2.4 · the declaration, and the two enforcers that read it ──────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, restored, from the one place it can be · `reply_to_parent` says it "
        "starts something outside this app, so BOTH providers put a card in front of an agent "
        "answering its own parent — HO-031 §2.9 exactly, and one word is all it takes",
        [
            (
                # ⛔ **The FIRST draft of this row INSERTED a second `beyondItsRails` key** after the
                # description, and the real one a few lines below overrode it — a duplicate key in
                # an object literal, so the mutation changed nothing and reported as a SURVIVOR.
                # ⚑ `a-mutation-that-changes-nothing-reports-as-a-survivor`, found by running the
                # row against its own killer rather than by reading it. ⚠️ **The anchor now moves
                # the EXISTING word**, and it carries the tail of this verb's own docblock because
                # thirteen declarations share the value on its own.
                TOOLS,
                "*breaks the loop the tools exist to make*.\n"
                "       */\n"
                "      beyondItsRails: 'nothing-its-rails-do-not-cover',",
                "*breaks the loop the tools exist to make*.\n"
                "       */\n"
                "      beyondItsRails: 'it-starts-something-outside-this-app',",
            ),
        ],
    ),
    (
        "M2 · ⛔ the Claude floor forgets our own verbs · the branch is gone, so every verb falls "
        "through to *brobot2 requires explicit approval for consequential tools* and the loop the "
        "tools exist to make needs a human click at every step · killed by `claude-runtime.test.ts` (named by W4.78)",
        [
            (
                CLAUDE,
                # ⚑ **W4.78 · re-anchored in place, not retired** — e419c240 turned the `railsGateThese` Set into the `railsGateThis(name, input)` predicate; the branch is otherwise the same
                "            if (railsGateThis(input.tool_name, input.tool_input)) {\n              return allowFor('BroCrew gates its own tools with rails, not with a card')\n            }\n",
                "",
            )
        ],
    ),
    (
        "M3 · 🔴 a YIELD instead of an allow · `{continue:true}` hands the call to the SDK's "
        "permission engine — and with `settingSources: []` there is no rule to find, so "
        "`canUseTool` is consulted and the card appears anyway. ⚑ The exemption reads as shipped "
        "and does nothing, which is the shape the memory carve-out's docblock warned about · killed by `claude-runtime.test.ts` (named by W4.78)",
        [
            (
                CLAUDE,
                # ⚑ **W4.78 · re-anchored in place, not retired** — e419c240 turned the `railsGateThese` Set into the `railsGateThis(name, input)` predicate; same branch
                "            if (railsGateThis(input.tool_name, input.tool_input)) {\n              return allowFor('BroCrew gates its own tools with rails, not with a card')\n            }",
                "            if (railsGateThis(input.tool_name, input.tool_input)) {\n              return { continue: true }\n            }",
            )
        ],
    ),
    (
        "M4 · ⛔ the exemption jumps the PLAN floor · a planning session may now call every verb "
        "whose rails are the whole gate, including the ones that create — `461` exempted exactly "
        "one and refused the two wider readings by name",
        [
            (
                CLAUDE,
                "            if (\n"
                "              planning() &&",
                "            if (railsGateThese.has(input.tool_name)) {\n"
                "              return allowFor('brobot2 gates its own tools with rails, not with a card')\n"
                "            }\n"
                "            if (\n"
                "              planning() &&",
            )
        ],
    ),
    (
        "M5 · 🔴 the exemption jumps the name-blind PATH SCAN · a verb of ours naming a file inside "
        "the app's own data is ALLOWED rather than denied, in every mode — which turns sixteen "
        "tools into a way into `userData` and is the one refusal `auto` cannot skip",
        [
            (
                CLAUDE,
                "            const scan = scanForProtected(input.tool_input, confinement)",
                "            if (railsGateThese.has(input.tool_name)) {\n"
                "              return allowFor('brobot2 gates its own tools with rails, not with a card')\n"
                "            }\n"
                "            const scan = scanForProtected(input.tool_input, confinement)",
            )
        ],
    ),
    (
        "M6 · ⚠️ the exemption keyed on a BARE name · the qualification is dropped, so the set "
        "holds `reply_to_parent` and the hook compares it against `mcp__brobot__reply_to_parent` — "
        "nothing matches, every verb cards, and the set LOOKS populated · killed by `claude-runtime.test.ts` (named by W4.78)",
        [
            (
                CLAUDE,
                # ⚑ **W4.78 · re-anchored in place, not retired** — e419c240 made railsAreTheWholeGate key a name->tool Map instead of a Set of names; dropping the qualification on the key is the same bare-name defect (same edit as 461 M3)
                "    toolset.tools.map((one) => [qualifyWith(CLAUDE_TOOL_NAMING, toolset.server, one.name), one]),\n",
                "    toolset.tools.map((one) => [one.name, one]),\n",
            )
        ],
    ),
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M7 · ⛔ the SECOND enforcer forgets · Codex keeps carding every verb, so the same app "
        "answers *does answering my parent need a human* one way on one provider and the other way "
        "on the other · killed by `codex-runtime.test.ts` (named by W4.78)",
        [('packages/runtime/src/codex/codex-runtime.ts', "    const offered = this.agentTools?.tools.find((one) => one.name === call.tool)\n    if (\n      offered !== undefined &&\n      beyondItsRailsOf(offered, call.arguments) === 'nothing-its-rails-do-not-cover'\n    ) {\n      this.respondToProvider(id, await answerCodexToolCall(this.agentTools, call, completed))\n      return\n    }\n", '')],
    ),
    (
        "M8 · 🔴 Codex exempts a name nobody declared · the toolset lookup goes, so ANY "
        "`item/tool/call` runs with no card — a verb this session never offered included, which is "
        "the one shape the fail-closed answer exists for · killed by `codex-runtime.test.ts` (named by W4.78)",
        [
            (
                CODEX,
                # ⚑ **W4.78 · re-anchored in place, not retired** — e419c240 split the toolset lookup into `offered` + beyondItsRailsOf(offered, args); the condition is replaced exactly as before, leaving `offered` unused
                "      offered !== undefined &&\n      beyondItsRailsOf(offered, call.arguments) === 'nothing-its-rails-do-not-cover'\n",
                "      call.tool !== 'spawn_agent'\n",
            )
        ],
    ),
    # ── §2.5 · entitlement before argument shape ────────────────────────────────────────────────
    (
        "M9 · 🔴 THE SECOND DEFECT, restored · `create_agent` validates its arguments before it "
        "asks whether the caller may create anything, so a standing grant answers in the "
        "vocabulary of a typo and `permanent` sends the model to fix arguments that were never the "
        "wall — HO-031 §7.2 exactly · killed by `the-doors-our-own-verbs-do-not-need.test.ts` (named by W4.78)",
                # ⚑ **RE-ANCHORED at `598`**: the door answers a discriminated union now, so this
                # layer reads `ok` rather than an absence (`HO-084` §1). ⛔ Same two statements,
                # same defect — the wall is deleted from in front of the argument check.
                # ⚑ **RE-ANCHORED at `618`**: `create_agent` takes the new identity's own rules
                # (`HO-078` §4), so this call is written over five lines. ⛔ **CORRECTED, not
                # retired** — the subject is the ORDER of the standing wall and the argument check,
                # and it is exactly where `486` left it. ⚠️ Re-verified RED by hand against
                # `the-doors-our-own-verbs-do-not-need.test.ts`, because a corrected anchor keeps a
                # verdict it never earned until somebody re-takes it.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — create_agent
        # still asks the standing wall before it reads an argument, and the 486 suite pins it both
        # by behaviour and by a source census. The wall call lost its `by` argument
        # (`host.mayCreateAgents(me)`), which is why the first anchor moved; the createAgentFor
        # anchor is unchanged, and the plant moves the wall behind the shape check. Killed by
        # `the-doors-our-own-verbs-do-not-need.test.ts`.
        [
            (TOOLS, '          const wall = host.mayCreateAgents(me)\n          if (!wall.ok) return refusalAnswer(refuseTool(wall.rail, wall.detail))\n', ''),
            # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 (0c50fe0b) gave createAgentFor a fifth argument, itsDefault; edit 0 (deleting the wall at the top) still applies, and this edit re-inserts the wall after the shape check and the model judgement.
            (TOOLS, "          const outcome = host.createAgentFor(\n            me,\n            said,\n            by,\n            rules === undefined ? null : (rules as string),\n            itsDefault,\n          )", "          const wall = host.mayCreateAgents(me)\n          if (!wall.ok) return refusalAnswer(refuseTool(wall.rail, wall.detail))\n          const outcome = host.createAgentFor(\n            me,\n            said,\n            by,\n            rules === undefined ? null : (rules as string),\n            itsDefault,\n          )"),
        ],
    ),
    (
        "M10 · ⛔ the reorder becomes an ORACLE · the NAME is asked before the grant, so an "
        "unentitled caller learns which identities exist from the shape of its refusal — `341`'s "
        "entitlement-before-existence, broken by the fix for the order rather than by the order",
                # ⚑ **RE-ANCHORED at `598`**: the grant door answers a union and the creation
                # reads its creator off it (`HO-084` §1). ⛔ **The row still moves the NAME in
                # front of the wall**, which is what it measures — the reorder must not become an
                # oracle. ⚠️ The mutated creation names the person's origin because there is no
                # grant answer above it to read from, which is the reorder's own consequence.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — createAgentFor
        # still asks the switch and the grant through mayCreateAgents before the name, so an
        # unentitled caller cannot learn which identities exist. The only change is that
        # mayCreateAgents takes just `me`, so the anchor lost `by`; the plant moves the name in
        # front of the wall and writes the creator as a person. Killed by
        # `the-doors-our-own-verbs-do-not-need.test.ts`.
        [
            # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the creation now keeps a provider, read between the grant and the name; the plant still writes the name before the grant is asked.
            (HOST, "    const may = this.mayCreateAgents(me)\n    if (!may.ok) return may\n    // 3 · the name, last — and its provider kept from the start: the one it names, else its\n    // default's, else the creator's.\n    const provider = said.provider ?? itsDefault?.provider ?? this.theProviderOfConversation(me)\n    const created = this.deps.store.createAgentIdentity({ ...said, provider }, may.creator)\n    if (created === null) {\n      return { ok: false, rail: 'agent-name-taken', detail: { agent: foldProfileName(said.slug) } }\n    }", "    const provider = said.provider ?? itsDefault?.provider ?? this.theProviderOfConversation(me)\n    const created = this.deps.store.createAgentIdentity({ ...said, provider }, { by: 'a-person' })\n    if (created === null) {\n      return { ok: false, rail: 'agent-name-taken', detail: { agent: foldProfileName(said.slug) } }\n    }\n    const may = this.mayCreateAgents(me)\n    if (!may.ok) return may"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The defect, a malformed
        # request answered before the kill switch, is now the ruled order. 5e931be8's message says
        # give_work's admission (R2) is 'piece, may-not-assign-work, depth 6 on the tree, the lookup
        # ..., the stall rule on a conversation found, then the switch', and R2 step 1 is 'Malformed
        # request'; admitGive in spawn-rails.ts asks the shape at step 1 and the switch only at step
        # 7. The doors suite says so directly: 'spawn_agent's case (the kill switch answers before
        # the shape) went with the tool: give_work asks the shape FIRST by ruling (R2 step 1) ... so
        # there is no switch-before-shape order to pin.' Its anchor is left stale, so the census
        # records it retired.
        "M11 · ⛔ the kill switch goes back BEHIND the shape at the spawn door · a malformed spawn "
        "sent while a person has spawning switched off is told `malformed-request · permanent`, "
        "which is the same false lesson one door over — and it is the door `341`'s ordering was "
        "proven at",
        [
            (
                SPAWN,
                "  if (!facts.spawningEnabled()) return no('spawning-disabled')\n"
                "\n"
                "  // 2 · the shape\n"
                "  const parsed = spawnRequestSchema.safeParse(request)",
                "  // 2 · the shape\n"
                "  const parsed = spawnRequestSchema.safeParse(request)",
            ),
            (
                SPAWN,
                "  const asked = parsed.data\n",
                "  const asked = parsed.data\n"
                "  if (!facts.spawningEnabled()) return no('spawning-disabled')\n",
            ),
        ],
    ),
    (
        "M12 · 🔴 the argument-independent wall stops answering · `admitReachAtAll` returns `null` "
        "for a reach of `none`, so `may-not-end` and `may-not-message` fall back behind the shape "
        "check and behind `no-such-agent` — both of which are `permanent`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # grant of `none` must be refused by `admitReachAtAll` before anything argument-dependent,
        # and only the anchor text changed (`rails.none` became `RAIL_OF[act]`). The label's
        # `may-not-end` no longer exists, and the two acts now are message and assign. The plant
        # deletes the `none` refusal, so `admitReachAtAll` returns null for `none` and
        # `admitAssignment`'s wall lets it through.
        [
            (MESSAGE, "  if (reach === 'none') return refuseMessage(RAIL_OF[act], { reach })\n  return null", '  return null'),
        ],
    ),
    (
        "M13 · ⛔ the four boundary rails go back to `permanent` · a caller is told *this exact call "
        "can never succeed* about a wall a person clears by widening one column — and its "
        "`may-not-` sibling, the SAME column one value narrower, keeps the honest word",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: an
        # `-outside-your-project` rail that a person clears by widening one column must not claim
        # `permanent`. It still holds for message- and read-outside-your-project. Re-verified RED
        # alone.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The four
        # `-outside-your-project` rails are gone (D-016), but the rule survives: a wall a person
        # clears by widening one column must not read `permanent`. The nearest surviving rail is
        # `may-not-assign-work`, which `can_assign_work` decides. Plant it `permanent`, leaving
        # `may-not-message` and the one truly permanent rail
        # (`assign-work-to-one-you-did-not-start`) as they are. The label's "four boundary rails"
        # wording is stale, but the defect planted is the same.
        [
            (MESSAGE, "  'may-not-assign-work': 'until-a-person-changes-it',", "  'may-not-assign-work': 'permanent',"),
        ],
    ),
    (
        "M14 · ⚠️ `too-deep` goes back to `permanent` · the one row in the spawn table that had no "
        "argument beside it, telling a caller to change a call it cannot compose — the parent is "
        "its own conversation and the door refuses `parentSessionId` outright",
        [
            (
                SPAWN,
                "  'too-deep': 'until-a-person-changes-it',",
                "  'too-deep': 'permanent',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `same-project` reach was removed on
        # purpose by bd70d693 ("same-project reach ... removed"). `MessagingReach` is now only
        # none|any, and admitMessaging's project comparison is gone, so the inverted comparison has
        # no anchor and no defect to plant. The surviving `reachesWhatItDidNotStart` table is a
        # different rule. Its anchor is left stale, so the census records it retired.
        "M15 · ⛔ the reach that reads a project is inverted · `same-project` is admitted outright "
        "and `any` is compared against the target's project, so the widest grant refuses across a "
        "boundary and the narrow one crosses it",
        [
            (
                # ⚑ **LENGTHENED by `553` and not moved.** `admitAssignment` opens with the same
                # guard — the two doors deliberately share one fall-through shape — so the short
                # form matched twice and a row that matches twice applies to nothing. ⛔ The
                # second line is `admitMessaging`'s own and nobody else's.
                MESSAGE,
                "  if (reach !== 'same-project') return null\n"
                "  // ⚑ **`same-project`, and an unknown project on EITHER side is a miss.**",
                "  if (reach === 'same-project') return null\n"
                "  // ⚑ **`same-project`, and an unknown project on EITHER side is a miss.**",
            )
        ],
    ),
]
