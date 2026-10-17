"""461 · ride the provider's door — HO-027 §1.

⛔ **What this table is aimed at.** `461` answered a question and made one change, and both are
rules a mutation can delete without breaking a type:

 1. **Nothing in the provider's payload binds a plan to a proposal, and nothing needs to** — so an
    approved plan settles NOTHING. That is a decision, not code, and the only thing standing in
    front of it is `ride-the-providers-door.test.ts` §2. `M8` and `M9` are what a future dispatch
    would write if it decided otherwise, so the decision has a red light in front of it.
 2. **A planning Claude session may call the tools that create nothing** — `140`'s read-only floor
    refused `mcp__brobot__create_project` with everything else, which made HO-027 §1's own shape
    (*the declaration is the proposal*) unbuildable. `M1`–`M7` are the ways that exemption goes
    wrong: deleted, widened, unqualified, unscoped, or turned into an approval.

⚠️ **The class is one property and not a list** — *a tool that creates nothing and whose only
effect is to put a decision in front of a person*. `M6` and `M7` aim at the membership itself,
because a set that grows in silence is how a floor stops being one.

⛔ **The last row is about a SENTENCE**, and it earns its place: HO-027 §2 was briefed from a
docblock that had been false for two dispatches, and the only thing that can keep it corrected is a
census that fails when the claim comes back.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/shared/runtime-ipc.ts"

# ⚑ The third exemption, as its own line, so a row can take exactly it away.
THE_EXEMPTION = "              !asksAPerson.has(input.tool_name) &&"

# ⚑ The qualification, whole — the half that makes the set a fact about THIS session.
# ⚑ **486 corrected this anchor and not this rule.** `asksAPersonOnly` now states its question
# and hands the qualification to `qualifiedWhere`, which two callers share; the intersection this
# row exists to remove is the `toolset === undefined` line inside that helper, and removing it
# there removes it for this class exactly as before.
THE_QUALIFIER = (
    # ⚑ **W4.78 · re-anchored in place, not retired** — e419c240 replaced the Set (built with a `wanted` class filter) by a per-call predicate over the session's toolset; the replacement is the old one in today's shape: a fixed class name list qualified with a hard-coded server, ignoring the session's catalogue
    "  if (toolset === undefined) return () => false\n  const byName = new Map(\n    toolset.tools.map((one) => [qualifyWith(CLAUDE_TOOL_NAMING, toolset.server, one.name), one]),\n  )\n  return (toolName, toolInput) => {\n    const tool = byName.get(toolName)\n    return (\n      tool !== undefined && beyondItsRailsOf(tool, toolInput) === 'nothing-its-rails-do-not-cover'\n    )\n  }\n"
)

# ⚑ The rendered clause — standing rule 8's shape, and the thing a literal would replace.
THE_RENDERED_CLAUSE = (
    "  const asks =\n"
    "    stillOpen.size === 0\n"
    "      ? ''\n"
    "      : `, and it may still call ${[...stillOpen].sort().join(' and ')} because calling one ` +\n"
    "        'creates nothing'"
)

# ⚑ The plan-phase recorder's whole body — §2's decision, in the two statements it is made of.
# ⚑ **740 · the recorder's anchor corrected, not retired** (M8, M9): `recordPlanPhase` compares the
# handle against what the ledger holds (`planAsRecorded`) rather than a value read before one answer,
# so `before` is `session.planAsRecorded` and `after` is `effective`. Each mutation injects the same
# settle at the same place, after the recorder's early returns.
THE_RECORDER = (
    "    const { effective, requested } = session.handle.settings.planMode\n"
    "    if (effective !== requested) return\n"
    "    if (effective === session.planAsRecorded) return"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the exemption itself ───────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, restored · the third exemption goes and the floor is `140`'s again, so "
        "a planning Claude session is refused `mcp__brobot__create_project` — the declaration "
        "HO-027 §1 rests on cannot be made, and the refusal tells the model to wait for the very "
        "approval it was about to declare for",
        [(CLAUDE, THE_EXEMPTION + "\n", "")],
    ),
    (
        "M2 · ⛔ widened to EVERY app tool · the reading somebody reaches for the next time this "
        "floor is in the way — `spawn_agent`, `create_agent` and `end_agent` all pass while the "
        "product promises *brobot2 refuses every tool that would change anything*",
        [(CLAUDE, THE_EXEMPTION,
          "              input.tool_name.startsWith('mcp__') &&")],
    ),
    (
        "M3 · ⚠️ the set is matched UNQUALIFIED · the exemption is computed from the tool's own name "
        "instead of the name the model must say, so it matches nothing the hook ever sees — green "
        "on the membership test, green on the refusal's own wording, and dead at the wire · killed by `claude-runtime.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — e419c240 made railsAreTheWholeGate return a predicate over a name->tool Map (class read per call), so the qualification now keys the Map; the auto-guess replacement had a syntax error
        [(CLAUDE, "    toolset.tools.map((one) => [qualifyWith(CLAUDE_TOOL_NAMING, toolset.server, one.name), one]),\n",
          "    toolset.tools.map((one) => [one.name, one]),\n")],
    ),
    (
        "M4 · ⚠️ qualified against a HARD-CODED server · the second spelling `qualifyWith` exists to "
        "prevent, and it is invisible on the shipped toolset — every session whose server is not "
        "`brobot` (a probe's, a future rename's) silently loses the exemption while looking as if it "
        "has one",
        [(CLAUDE, "qualifyWith(CLAUDE_TOOL_NAMING, toolset.server, one.name)",
          "qualifyWith(CLAUDE_TOOL_NAMING, 'brobot', one.name)")],
    ),
    (
        # ⚑ **728 · replacement corrected in place, not retired** — R93 removed the class this row
        # first built from (`TOOLS_THAT_ONLY_ASK_A_PERSON`); the intersection lives on in 486's
        # rails set, which reads the same function, so the stale name is now one of ITS verbs.
        "M5 · ⛔ the intersection goes · the set is built from the class rather than from the "
        "session's own catalogue, so a session offered NO toolset still exempts a name it does not "
        "have — a stale entry that can open a door, which is exactly what the intersection is for · killed by `claude-runtime.test.ts` (named by W4.78)",
        [(CLAUDE, THE_QUALIFIER,
          "  void toolset\n  void beyondItsRailsOf\n  const exempt = new Set(\n    ['reply_to_parent'].map((one) => qualifyWith(CLAUDE_TOOL_NAMING, 'brobot', one)),\n  )\n  return (toolName) => exempt.has(toolName)\n")],
    ),
    (
        "M6 · 🔴 a MINTING verb joins the class · `create_agent` writes an identity row the moment "
        "it is called and `419` shipped it as an ungated mint — a floor that lets it through while "
        "planning is a floor that has stopped being one, and nothing about the tool's own "
        "description would have said so",
        [(CLAUDE, "new Set<string>(['create_project'])",
          "new Set<string>(['create_project', 'create_agent'])")],
    ),
    (
        "M7 · ⚠️ the class is EMPTY · the wiring survives and answers nothing, which is the shape a "
        "refactor leaves behind — every test about the floor's other exemptions stays green and the "
        "one thing `461` added is gone",
        [(CLAUDE, "new Set<string>(['create_project'])", "new Set<string>([])")],
    ),
    # ── §2 · the decision that an approved plan settles nothing ─────────────────────────────────
    (
        "M8 · 🔴 THE MECHANISM `461` REFUSED TO BUILD · the plan-phase recorder settles whatever "
        "proposal the conversation happens to be holding, which is the guess the brief asked for an "
        "answer instead of — a refactor plan approved while a proposal waits creates a project "
        "nobody declared on the card they pressed",
        [(HOST, THE_RECORDER,
          THE_RECORDER + "\n"
          "    if (session.planAsRecorded && !effective) {\n"
          "      for (const held of this.deps.store.proposalsOf(session.id)) {\n"
          "        if (!PROPOSAL_IS_WAITING[held.state]) continue\n"
          "        this.bringItIntoExistence(held)\n"
          "        this.publishOurs(session, {\n"
          "          type: 'proposal_ended',\n"
          "          proposalId: held.proposalId,\n"
          "          ending: 'approved',\n"
          "        })\n"
          "      }\n"
          "    }")],
    ),
    (
        "M9 · ⚠️ the same settle, written as the app's own ledger row · the bypass no census could "
        "see before `461` — `448`'s walk reads `renderer`, `shared` and `preload` and never "
        "`src/main`, so a `proposal_ended` appended here makes the fold say *approved* with nothing "
        "created and no project row anywhere",
        [(HOST, THE_RECORDER,
          THE_RECORDER + "\n"
          "    for (const held of this.deps.store.proposalsOf(session.id)) {\n"
          "      if (!PROPOSAL_IS_WAITING[held.state]) continue\n"
          "      this.publishOurs(session, {\n"
          "        type: 'proposal_ended',\n"
          "        proposalId: held.proposalId,\n"
          "        ending: 'approved',\n"
          "      })\n"
          "    }")],
    ),
    # ── §3 · what the model is told, and what the next reader is told ───────────────────────────
    (
        "M10 · ⚠️ the open door is named by a LITERAL instead of rendered · standing rule 8 at the "
        "one surface where it is cheapest to break — the sentence stops moving with the class, so a "
        "session offered no toolset is told about a tool it does not have, and a tool added to the "
        "class is never advertised at all",
        [(CLAUDE, THE_RENDERED_CLAUSE,
          "  const asks = ', and it may still call mcp__brobot__create_project because calling one ' +\n"
          "    'creates nothing'")],
    ),
    (
        "M11 · ⛔ the refusal stops naming the way out · `086`'s rule, deleted — the model learns "
        "that planning blocks it and not that the proposing door is open beside it, which is the "
        "state `445` F1 measured BroBot resolving by reaching for the provider's plan mode instead",
        [(CLAUDE, THE_RENDERED_CLAUSE, "  const asks = ''")],
    ),
    (
        "M12 · 🔴 the sentence HO-027 §2 was briefed from, put back · a docblock that answers a "
        "capability question a descriptor owns — false since `057`, corrected by `044` in four "
        "other places and missed here, and read as ground truth by a Product Owner two dispatches "
        "later",
        [(IPC, "   * 🔴 **BOTH PROVIDERS, and this block is the argument for the descriptor said a third time**",
          "   * ⚠️ **Claude only for now — because ours is not built, NOT because Codex lacks one.**")],
    ),
]
