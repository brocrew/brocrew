"""347 · The five tools — each row is THE DEFECT, put back verbatim (131).

⛔ **The ordering this dispatch arrives under** (347 §0). `341` landed twelve rails at the
session-creation chokepoint, *"so a tool arrives into a door that already refuses"*. These tools
validate arguments and call that door. ⚑ **So the rows below are overwhelmingly about the tool layer
NOT acquiring a rule of its own** — a refusal that stops being carried, an entitlement that starts
being decided twice, a shape that stops being what the door sees.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M20`, `M23`-`M28` | ⚑ **`run_suite`** — `apps/desktop/test/the-five-tools.test.ts` |
| `M21`, `M22` | ⚑ **`run_suite`** — `apps/desktop/test/disclosure-answers-to-the-code.test.ts` |
| `M23`, `M24` | ⚑ **`run_suite`** — `packages/runtime/test/claude-agent-tools.test.ts` |
| `M29`, `M30` | ⚑ **`run_suite`** — `apps/desktop/test/the-caller-that-may-command-but-not-watch.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row mutates a rail.** `341`'s table owns all twelve, and duplicating one here would put the
same rule under two tables — the very drift `169` §1 names. What this table asserts about the rails
is only that their answers are CARRIED (`M5`-`M8`), never re-decided.

⛔ **No row deletes the `catch` in the Claude translator.** Its contract says a handler must not
throw; the `catch` exists because *"must not"* is not *"cannot"*. Nothing in the suite can reach it
without a deliberately broken tool, so a row would record as a phantom survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`).

⛔ **No row widens `mayCommand`, `mayControl` or `mayClaim`.** 340 owns those and 341 §5 is explicit.
`M12` is the row that proves 347's ONE added clause is load-bearing, and it lives at the call site
where 347 put it rather than in the shared predicate.

⛔ **No row lets `spawn_agent` name a parent the CALLER chose.** It was written (`M2`) and RETIRED
at the per-row check, because nothing can make it red — and why is worth more than the row was.
⚑ **The tool's parent-fill is unforgeable twice over, and both defences belong to the door.** A
smuggled `parent` key is an undocumented key, so rail 1 refuses the whole request before the value is
ever read; and if it somehow got through, naming a session you do not command is `not-your-parent`.
⚠️ Both are measured in `the-five-tools.test.ts` — the second directly at `spawnSession`, since the
tool offers no way to express it. A mutation here would have recorded as a survivor while changing
nothing, which is the phantom this check exists to catch.

⛔ **No row on the Codex half.** There is no Codex half: `347` ships Claude only and says so. A row
about a translator that does not exist would be a row about nothing.

## ⚑ What the per-row killer check changed, before this table was ever run

🔴 **The live rig found a defect in ITSELF, not in the product, and that is recorded rather than
tidied away.** The first `an-agent-spawns-an-agent.smoke.ts` captured the parent's tool-call list the
moment the child appeared, then asserted `message_agent` against that snapshot seconds later — so it
reported a live run that had actually worked as a product failure. `M27` is the shape of that defect
placed where a cheap gate can see it.
"""

TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
TRANSLATE = "packages/runtime/src/claude/agent-tools.ts"
CFG = "apps/desktop/src/main/runtime/provider-config.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the tools stop reaching the door ──────────────────────────────────────────────────
    (
        "M1 · 🔴 THE defect this ordering exists to prevent: the tool layer decides for itself "
        "whether the caller may spawn, instead of calling the door · `169` §1 — one rule in two "
        "places drifts, and the copy that drifts is the one further from what it protects",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The tool layer
        # must still call the door (`host.giveWork`) and add no rail (the-five-tools §2 'the tools
        # add no rail', and the `.strict()` note in the give_work handler). The plant makes the tool
        # decide for itself, refusing a profile before the door is asked. Killed by
        # `the-five-tools.test.ts`.
        [
            (TOOLS, '            given = await host.giveWork(args, by)', "            if (String(args.profile) === 'worker') {\n              return refusalAnswer(refuseTool('no-such-agent', { agent: String(args.profile) }))\n            }\n            given = await host.giveWork(args, by)"),
        ],
    ),
    (
        "M3 · ⛔ the spawn request is REBUILT from known keys, so an undocumented one is stripped "
        "before the door can refuse it · `303` B verbatim: eight keys arrive, seven are parsed, and "
        "the agent never starts, *looking exactly like a slow provider*",
                # ⚠️ **Anchor corrected by 371**, which replaced the destructure-and-spread with
                # `spawnRequestFrom` so HO-010 §2.1's *"the schema's keys and the advertised
                # arguments are the same set"* could be asserted in both directions. ⛔ The DEFECT is
                # unchanged and is still the CALL SITE rebuilding the request from keys it knows —
                # deliberately NOT 371's own `M10`, which leaves the loop in place and filters inside
                # it. Two spellings of one defect, in the two shapes this tree has held.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The tool must
        # hand the door the request verbatim so the door's `.strict()` can name an undocumented key
        # (303 B); the give_work handler still says so, and the-five-tools tests it with `priority`,
        # `parent`, `parentSessionId` and `approval_mode`. The plant rebuilds the request from its
        # six documented keys, so an undocumented one is stripped before the door can refuse it.
        # Killed by `the-five-tools.test.ts`.
        [
            (TOOLS, '            given = await host.giveWork(args, by)', '            given = await host.giveWork(\n              {\n                profile: args.profile,\n                title: args.title,\n                brief: args.brief,\n                ...(args.folder === undefined ? {} : { folder: args.folder }),\n                ...(args.piece === undefined ? {} : { piece: args.piece }),\n                ...(args.new === undefined ? {} : { new: args.new }),\n              },\n              by,\n            )'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row protects
        # `spawn_agent`'s create-only rule ("sends nothing"), which D-016 inverted: the-five-tools
        # now says the brief is "the new conversation's FIRST turn — it was create-only, sent
        # nothing until give_work replaced spawn_agent", and asserts exactly one brief turn. The
        # commit says "spawn_agent is gone." Its anchor is left stale, so the census records it
        # retired.
        "M4 · ⚠️ `spawn_agent` also sends the first message · 347 §1's *create-only* rule, and "
        "`303` B measured that a spawn could not carry one anyway",
        [
            (
                TOOLS,
                "          return answer(\n            { outcome: 'ok', agent: outcome.sessionId },",
                "          await host.queueMessage(outcome.sessionId, String(purpose), by)\n"
                "          return answer(\n            { outcome: 'ok', agent: outcome.sessionId },",
            )
        ],
    ),
    # ── §2 · the refusal stops being readable as policy ────────────────────────────────────────
    (
        "M5 · 🔴 a rail's refusal is THROWN instead of returned · `307` measured both shapes on both "
        "providers: a thrown handler becomes transport `-32603` and *carries no machine-readable "
        "policy meaning*, so the child learns a tool broke rather than which rule stopped it",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — A rail's
        # refusal is returned and never thrown: `give_work` still carries a refusal through
        # `carryRailRefusal`/`carryMessageRefusal` and answers it, and the-five-tools 'a refusal is
        # a SUCCESSFUL call: no tool throws, on any path' stands. The plant throws the refusal's
        # reason where the handler returns its answer. Killed by `the-five-tools.test.ts`.
        [
            (TOOLS, '          if (!given.ok) {\n            const { refusal } = given\n', '          if (!given.ok) {\n            throw new Error(given.refusal.reason)\n            const { refusal } = given\n'),
        ],
    ),
    (
        "M6 · ⛔ the carried refusal loses the rail's name · the payload still says *refused* and no "
        "longer says WHAT refused, which is criterion 4's whole content",
        # ⚑ **Anchor widened by 374, not retired.** `374` added `carryMessageRefusal` beside
        # `carryRailRefusal`, so the bare line now occurs twice and an anchor that matches two places
        # proves nothing about which one it hit. ⛔ The row still measures the SPAWN carrier, which
        # is what `347` wrote it for; the messaging carrier is `374`'s to measure.
        #
        # ⚠️ **Anchor CORRECTED again at `405`, and NOT retired.** That dispatch gave the carriers a
        # return type — `PublishedRefusal` — so a durable ledger row could be derived from one of
        # these payloads, which moved this signature and nothing else. ⛔ The row's rule is unchanged
        # and it was re-verified RED against `the-five-tools.test.ts` after the correction
        # (`a-corrected-mutation-anchor-keeps-a-verdict-it-never-earned`).
        [
            (
                TOOLS,
                "function carryRailRefusal(refusal: SpawnRefusal): PublishedRefusal {\n"
                "  return {\n"
                "    outcome: 'refused',\n"
                "    rail: refusal.rail,",
                "function carryRailRefusal(refusal: SpawnRefusal): PublishedRefusal {\n"
                "  return {\n"
                "    outcome: 'refused',\n"
                "    rail: 'refused',",
            )
        ],
    ),
    (
        "M7 · ⛔ `retryable` is written independently of `permanence` · two fields that can now "
        "disagree, and a model told a permanent refusal is worth retrying",
        [
            (
                TOOLS,
                "    retryable: retryableOf(refusal.rail),",
                "    retryable: true,",
            )
        ],
    ),
    (
        "M8 · ⚠️ the tool vocabulary stops deriving `retryable` from `permanence` · a model is told "
        "a permanent refusal is worth retrying, which is the one thing criterion 4 says must never "
        "pay off. ⛔ Written as `rail !== \'malformed-request\'` first, and RETIRED at the per-row "
        "check: with only two permanences in this vocabulary that expression is the derivation "
        "spelled differently, and the row recorded as a survivor while changing nothing observable",
        [(TOOLS, "    retryable: permanence === 'while-this-holds',", "    retryable: true,")],
    ),
    # ── §3 · entitlement, and the enumeration it must not permit ───────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** This is exactly the pattern the task
        # names as deliberately retired: "no-such-agent for a conversation that exists but is out of
        # reach." D-017 · R12 explicitly UNFOLDS existence from entitlement in `interruptAgent` now
        # ("no-such-agent only for an id no conversation has ... not-below-you for one that is not
        # below the caller ... The fold that answered both in one word is gone"), and
        # `a-reach-you-can-see.test.ts`'s own docstring says the re-aim is deliberate: "So a caller
        # learns that an id EXISTS." The old anti-enumeration rule this row protected is the
        # opposite of the current ruling. Its anchor is left stale, so the census records it
        # retired.
        "M9 · 🔴 `end_agent` distinguishes *not yours* from *not there* · the refusal becomes an "
        "enumerator, and walking ids tells a caller which sessions the app is running",
        # ⚠️ **RE-ANCHORED at 692, not retired.** 692 asks `end_agent`'s entitlement of `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
        # ⚑ Landing D-014 · re-anchored in place, not retired — `endAgent` still answers
        # `'no-such-agent'` both for a caller that may not reach the target and for an id that is
        # not there. The docblock says 'One answer for "not yours" and "not there", deliberately'.
        # Re-verified RED alone.
        [
            (HOST, "      !mayInterruptDownTheChain(by, this.ancestorsAsItWillRun(sessionId))\n    ) {\n      return 'no-such-agent'\n    }\n    if (slot === undefined) return this.endWhatTheQuitClosed(sessionId, by)", '      !mayInterruptDownTheChain(by, this.ancestorsAsItWillRun(sessionId))\n    ) {\n      throw new Error(`not yours: ${sessionId}`)\n    }\n    if (slot === undefined) return this.endWhatTheQuitClosed(sessionId, by)'),
        ],
    ),
    (
        "M10 · ⛔ `agentCard` asks existence BEFORE entitlement · 341's ordering ruling inverted, so "
        "a stranger learns an id is real from the shape of the refusal",
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692's no-slot branch now answers what the quit closed; the row still asks existence first for every other missing id. The DEFECT this row plants is unchanged.
                # ⚑ **Re-anchored at 433, NOT retired** —
                # `correct-a-stale-mutation-anchor-dont-retire-it`. `433` §B moved `agentCard`'s
                # entitlement clause onto `withinMessagingReach` (*a caller may SEE exactly what it
                # may SEND to*), so the second line of this anchor changed spelling. ⛔ **The defect
                # is unchanged and so is what kills it**: existence asked before entitlement, at the
                # same door, with the same throw.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — D-017 renamed
        # `keptOpenCardFor`→`stoppedCardFor` and `keptOpen`→`startable` but kept the exact two-line
        # shape `agentCard` plants into. The 341 ordering rule (entitlement before existence) still
        # holds and is still tested the same way by `the-five-tools.test.ts`, so this is a straight
        # rename re-anchor, the row's third (433, 692 were the first two).
        [
            (HOST, '    if (slot === undefined) return this.stoppedCardFor(sessionId, by, me)\n    if (!this.withinMessagingReach(sessionId, by, me)) return null', '    if (slot === undefined && this.startable(sessionId) === null)\n      throw new Error(`no such session: ${sessionId}`)\n    if (slot === undefined) return this.stoppedCardFor(sessionId, by, me)\n    if (!this.withinMessagingReach(sessionId, by, me)) return null'),
        ],
    ),
    (
        "M11 · ⛔ `list_agents` reports every session the host holds · the entitlement filter is "
        "gone and an agent can see a person's private conversations",
        [
            (
                HOST,
                # ⚑ **Re-anchored at 433, NOT retired.** The filter is the same filter and the
                # defect is the same defect — every session the host holds, handed to a caller
                # entitled to none of them. ⛔ What moved is which predicate answers it: `433` §B
                # put both readers on `withinMessagingReach`, which asks `mayCommand` as its clause
                # 2 and a person's grant after it.
                "      .filter((slot) => this.withinMessagingReach(slot.id, by, me))",
                "      .filter(() => true)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the spawn
        # door's `not-your-parent` clause, which named a parent session. `give_work` takes no parent
        # (the-five-tools: "an attempt to supply a parent is an undocumented key and dies on the
        # first rail"), and the test that stands in its place says "an agent giving from its own
        # conversation is the only thing `give_work` can ever mean"; the commit says "spawn_agent is
        # gone." No self-clause exists in `runtime-host.ts` to mutate. Its anchor is left stale, so
        # the census records it retired.
        "M12 · 🔴 the spawn door's self-clause is gone · an agent can no longer name its OWN session "
        "as the parent, because `mayCommand` compares owner ids and a person's window owns it — the "
        "clause 347 added at the call site rather than inside the predicate",
        [
            (
                HOST,
                "        return mayCommand(slot, by) || slot.id === sessionSpeakingAs(by)",
                "        return mayCommand(slot, by)",
            )
        ],
    ),
    (
        "M13 · ⛔ …and the same clause moved INTO the shared predicate instead · `340` §5: *an "
        "entitlement widening must be opt-in at the call site*. `mayCommand` also gates `send`, the "
        "queue, the cancel and `endAgent`, so a session that commands itself can give ITSELF a "
        "turn — a capability nobody asked for and a loop nobody bounded",
        [
            (
                HOST,
                "  if (by === THE_APP_ITSELF) return true\n"
                "  return slot.ownerId === by.ownerId || slot.commandedBy === by.ownerId",
                "  if (by === THE_APP_ITSELF) return true\n"
                "  return (\n"
                "    slot.ownerId === by.ownerId ||\n"
                "    slot.commandedBy === by.ownerId ||\n"
                "    (slot as { id?: string }).id === sessionSpeakingAs(by)\n"
                "  )",
            )
        ],
    ),
    (
        "M14 · ⛔ an agent's caller id stops being namespaced · `agent:sess_1` becomes `sess_1`, and "
        "the two id spaces can now meet — `mayControl` compares owner ids by equality, so anything "
        "that can spell a window's id inherits a window's entitlement",
        [(TOOLS, "export const agentCallerId = (sessionId: string): string => `agent:${sessionId}`",
          "export const agentCallerId = (sessionId: string): string => sessionId")],
    ),
    (
        "M15 · ⚠️ the decoder accepts any caller as an agent · a window now decodes as the session "
        "whose id it happens to spell",
        [
            (
                TOOLS,
                "  if (typeof ownerId !== 'string' || !ownerId.startsWith('agent:')) return null\n"
                "  const said = ownerId.slice('agent:'.length)",
                "  if (typeof ownerId !== 'string') return null\n"
                "  const said = ownerId.replace(/^agent:/, '')",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The row's whole subject is
        # `end_agent`'s own outcome check, and `end_agent` is gone: the commit message says so
        # directly ("end_agent and resume_agent are gone (21 tools)") and agent-tools.ts has no
        # `end_agent` registration or `host.endAgent` call left. `interrupt_agent`'s analogous check
        # (`if (outcome.refusal === 'no-such-agent')`) is a different shape guarded by its own
        # comment ("there is no catch"), so nothing carries this defect forward. Its anchor is left
        # stale, so the census records it retired.
        "M16 · ⛔ `end_agent` reports `ended` for a session this host never held · `close()`'s "
        "tolerance is right for a person pressing Close twice and wrong as a tool's answer — an "
        "unenumerated state counting as success",
        [
            (
                TOOLS,
                "          if (outcome === 'no-such-agent') {\n            return refusalAnswer(refuseTool('no-such-agent', { agent }))\n          }",
                "          void outcome",
            )
        ],
    ),
    (
        # ⚠️ **EQUIVALENT MUTANT since D-016c commit 7 (c1a79abe), recorded rather than removed
        # (landing, verified SURVIVED):** the host's one resolver now answers an out-of-reach caller
        # with the door's own `may-not-message` answer, so deleting this tool's precheck changes
        # nothing a caller reads — `the-five-tools.test.ts` stays 36/36 under the plant. The rule
        # holds; this row can no longer show it.
        "M17 · ⚠️ `message_agent` skips the reader and lets the host THROW at a stranger · the "
        "sentence a person wrote for a window becomes transport `-32603` for a model",
                # ⚑ **Re-anchored by 431, not retired.** The reader this door asks is
                # `withinMessagingReach` now and no longer `agentCard`: the card answers
                # `mayCommand`, which refused BroBot a project manager a PERSON opened in
                # another project (`430`). ⛔ The rule this row measures is untouched — the
                # door asks a reader and ANSWERS, instead of letting the host throw a
                # window's sentence at a model. Re-applied and re-run individually.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `message_agent` still
        # exists and still must ask a reader before touching the host, on pain of a raw throw
        # reaching a model as transport -32603 — only the reader's name changed
        # (`withinMessagingReach` → `host.whyItIsOutOfReach`) and the answer now wraps via
        # `outOfReachAnswer`. The two-line reader check at the top of `message_agent`'s handler is
        # the exact same gate, just renamed.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: `message_agent` asks the reach reader and answers
        # a stranger with the `may-not-message` rail, rather than letting the host throw a plain
        # Error that surfaces as `agent-cannot-take-a-message`. The precheck is now
        # `host.whyItIsOutOfReach` plus `outOfReachAnswer`, and the plant deletes those two lines.
        # Killed by `the-five-tools.test.ts`.
        [
            # ⚑ **service reach · re-anchored in place, not retired** — the reach check now asks for a message, which admits the caller whose piece a service is on; the defect is the same: the check goes. NOT VERIFIED.
            (TOOLS, "          // naming the bound narrowly is what keeps it honest.\n          const out = host.whyItIsOutOfReach(agent, by, me, true)\n          if (out !== null) return outOfReachAnswer(out, agent)\n", '          // naming the bound narrowly is what keeps it honest.\n'),
        ],
    ),
    # ── §4 · the race 341 named, re-opened ─────────────────────────────────────────────────────
    (
        "M18 · 🔴 the reservation stops recording which identity it is going to be · 341's named "
        "race is back: `liveSessionAs` sees only sessions that have ARRIVED, so two spawns in one "
        "tick are both admitted for one agent",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The race the
        # row protects survives: "Two gives in one tick must find one conversation", found by the
        # lookup's reservation arm, whose slot records `profileId` before the first await. The old
        # anchor moved to 6-space indentation inside `helperAs`. The plant stops the reservation
        # recording its identity, so a launch in flight is invisible to the lookup. Killed by
        # `the-five-tools.test.ts`.
        [
            (HOST, '      if (slot.spawnedBy === null || !theirs.has(slot.spawnedBy)) return false\n      const identity = slot.profileId ?? slot.session?.profileId ?? null\n', '      if (slot.spawnedBy === null || !theirs.has(slot.spawnedBy)) return false\n      const identity = slot.session?.profileId ?? null\n'),
        ],
    ),
    (
        "M19 · ⛔ the reservation's profile is read AFTER the default is applied elsewhere · "
        "`createSession` records `undefined`, so every unnamed launch is invisible to the rail",
        [
            (
                HOST,
                "          profileId: input.profileId ?? DEFAULT_PROFILE_ID,",
                "          profileId: input.profileId ?? null,",
            )
        ],
    ),
    (
        "M20 · ⚠️ a REOPEN no longer tells the rail which identity it is bringing back · a person "
        "resuming a conversation is invisible to a spawn racing it",
        [
            (
                HOST,
                "            profileId: this.deps.store.find(sessionId)?.profileId ?? null,",
                "            profileId: null,",
            )
        ],
    ),
    # ── §5 · the disclosure, and the seam it describes ─────────────────────────────────────────
    (
        "M21 · 🔴 the adapter stops passing the toolset · every session silently loses its tools, "
        "and the config block goes on promising a person that they are handed over at launch",
        [(CLAUDE, "    if (mcpServers) options.mcpServers = mcpServers", "    void mcpServers")],
    ),
    (
        "M22 · ⛔ …and RESUME stops re-supplying them · the Claude half of `307`'s asymmetry, "
        "forgotten exactly where 347 §3 said forgetting it would be invisible: a child whose tools "
        "vanished looks identical to a model that chose not to call them",
        [
            (
                HOST,
                # ⚑ **W4.579 · re-anchored in place, not retired** — the resume's toolset is now built once before the launch and handed to the launch and its record; the defect, a resume handed no toolset, is unchanged
                "          // omitting it here is an act rather than an oversight.\n          agentTools,\n",
                "          // omitting it here is an act rather than an oversight.\n",
            )
        ],
    ),
    (
        "M23 · ⚠️ an empty toolset is still advertised as a server · the child's inventory carries a "
        "capability block that promises a catalogue and lists none — acceptance #7 as a handshake. "
        "⚠️ **Re-anchored by `516`**, which gave the function a second source and split the early "
        "return into an `ownServer` term; the DEFECT is unchanged — an empty toolset still names a "
        "server — and only the expression it is measured on moved",
        [
            (
                TRANSLATE,
                "  const ownServer = toolset === undefined || toolset.tools.length === 0 ? null : toolset.server",
                "  const ownServer = toolset === undefined ? null : toolset.server",
            )
        ],
    ),
    (
        "M24 · ⛔ the in-process server is built TWICE · `createSdkMcpServer` returns a live "
        "instance, so two are constructed and one is dropped on the floor. ⚠️ Nothing observable "
        "separates them — both are perfectly valid objects — so the guard is a source census, which "
        "is the only place the difference exists. ⚠️ **Re-anchored by `516`**, which gave the call a "
        "second argument; the row builds the server twice exactly as it always did",
        [
            (
                CLAUDE,
                "    const mcpServers = claudeMcpServersFor(agentTools, externalMcp?.servers ?? [], managedPluginMcp)",
                "    const mcpServers =\n"
                "      claudeMcpServersFor(agentTools, externalMcp?.servers ?? [], managedPluginMcp) ??\n"
                "      claudeMcpServersFor(agentTools, externalMcp?.servers ?? [], managedPluginMcp)",
            )
        ],
    ),
    # ── §6 · criterion 6, and the inventory it is measured against ─────────────────────────────
    (
        "M25 · 🔴 a sixth tool that hands work to nobody in particular · criterion 6 is *there is no "
        "dispatch tool*, and the census over the published inventory is what makes that a "
        "measurement rather than a sentence",
        [
            (
                TOOLS,
                # ⚠️ **Re-anchored by `383`.** `380` added `read_document` after `'end_agent'`, so
                # the old anchor — the list's last name — stopped matching and this row went dark on
                # `380`'s branch. The rule is unchanged: a name appended to the published inventory.
                # ⚠️ **Anchor moved by `393`, and re-verified rather than assumed.** `380` appended
                # `read_document` and `393` appended two more, so an anchor on the list's LAST member
                # dies every time the inventory grows — `an-anchor-on-a-lists-last-member-dies-when-
                # anything-appends`, met for the second time on this exact constant. ⛔ The row is
                # unchanged in what it does: it appends a seventh… now a TENTH… name that hands
                # work to nobody in particular. ⛔ `394` moved it a THIRD time, which is the reading
                # this comment was written for: an anchor on a list's last member is an anchor that
                # every dispatch publishing a tool has to move.
                #
                # 🔴 **`396` was the FIFTH move, and it moved the anchor OFF the last member instead**
                # (142's rule — corrected in place, never retired). ⛔ Four dispatches had each
                # rewritten this line to name whatever they had just appended, which is a treadmill
                # rather than a rule: the row's claim was never *"after `interrupt_agent`"*, it was
                # *"a name in the published inventory that hands work to nobody in particular"*, and
                # the census it breaks asserts the whole list rather than its order.
                # ⚑ **So it is anchored on the FIRST member**, which no house convention appends
                # after — `347` wrote `list_agents` first and every dispatch since has appended.
                "export const TOOL_NAMES = [\n  'list_agents',",
                "export const TOOL_NAMES = [\n  'list_agents',\n  'dispatch_work',",
            )
        ],
    ),
    (
        "M26 · ⛔ `message_agent` stops naming its recipient · a message with no target is a "
        "dispatch, whatever the tool is called",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: `message_agent` must publish its recipient
        # argument. The `agent` field is now described 'by the piece it owns (W1.2) or by its id
        # from list_agents' over three lines, and the plant drops it from the input schema. Killed
        # by `the-five-tools.test.ts`.
        [
            # NOT VERIFIED: typed input wrapping shifted indentation; the same defect is retained.
            (TOOLS, "          agent: z\n            .string()\n            .describe('The agent, by the piece it owns (W1.2) or by its id from list_agents.'),\n          text: z.string().describe('What to say to it.'),\n", "          text: z.string().describe('What to say to it.'),\n"),
        ],
    ),
    (
        "M27 · ⚠️ the live rig reads the parent's tool calls ONCE, before the second act · the "
        "defect the rig found in itself: a run that worked is reported as a product failure, "
        "because the question was asked of a snapshot taken before the answer could exist",
        [
            (
                "apps/desktop/smoke/an-agent-spawns-an-agent.smoke.ts",
                "      const called = await until('message_agent in the parent transcript', 180_000, () =>\n"
                "        parentToolCalls().some((name) => name.includes('message_agent')),\n"
                "      )",
                "      const called = parentToolCalls().some((name) => name.includes('message_agent'))",
            )
        ],
    ),
    (
        "M28 · ⛔ the refusal sentences stop being distinct · two rules answer with one sentence and "
        "a model reading the payload cannot tell which stopped it",
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads, and again after 675’s review (675 §1); The DEFECT this row plants is unchanged.
        # ⚑ Landing PE-006, D-018 and D-025 · re-anchored in place, not retired — PE-006 (3c0c4280)
        # rewrote the `agent-cannot-take-a-message` sentence, so the old anchor is gone, but the
        # rule survives: the-five-tools.test.ts still asserts no two TOOL_REFUSALS share a sentence.
        # The old plant's replacement ('already holding a message...') is the sentence of a rail
        # D-010 deleted, so it no longer exists anywhere in src and would have collided with
        # nothing; the new plant instead gives the rule the exact sentence of
        # `that-conversation-has-not-started` (the rail 650 split out of it), which is a real
        # collision and also the dangerous one, since it tells a caller to retry when only a person
        # can fix it. Killed by `the-five-tools.test.ts`.
        [
            (TOOLS, "  'agent-cannot-take-a-message':\n    'ask a person to inspect why that conversation cannot take a message; do what you can here. Nothing was queued, and retrying will not help until its state changes.',", "  'agent-cannot-take-a-message':\n    'that conversation has not started yet, so nothing was done to it. It comes up or fails to launch on its own: make the same call again in a moment.',"),
        ],
    ),
    # ── §7 · 340's census, answered rather than silenced ───────────────────────────────────────
    (
        "M29 · 🔴 the tool layer takes a claiming sink · `340`'s open door walked through: a caller "
        "that presents a `RuntimeEventSink` can claim its own child and then answer that child's "
        "permission prompts legally",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The census
        # that the tools never hand a claiming sink survives ('the tools never hand a claiming sink
        # to anything (340's census, answered)'), and `AgentToolHost` still opens the tool layer's
        # host surface. The old anchor moved because `giveWork` replaced `spawnSession` as the first
        # member, so the plant puts `claimSession` at the top of the interface. Killed by
        # `the-five-tools.test.ts`.
        [
            (TOOLS, 'export interface AgentToolHost {\n', "export interface AgentToolHost {\n  claimSession: RuntimeHost['claimSession']\n"),
        ],
    ),
    (
        "M30 · ⛔ the claim census narrows back to a hand-listed set · a new surface calling "
        "`host.claimSession(...)` leaves it green while doing the one thing it exists to forbid. "
        "⚑ The row mutates the SWEEP rather than the count, because narrowing the count alone gives "
        "the same answer today and would have recorded as a survivor",
        [
            (
                "apps/desktop/test/the-caller-that-may-command-but-not-watch.test.ts",
                "      const sources = readdirSync(mainRoot, { recursive: true, encoding: 'utf8' })\n"
                "        .filter((entry) => entry.endsWith('.ts'))\n"
                "        .map((entry) => join(mainRoot, entry))",
                "      const sources = ['runtime/runtime-host.ts', 'runtime/ipc.ts', 'index.ts'].map(\n"
                "        (entry) => join(mainRoot, entry),\n"
                "      )",
            )
        ],
    ),
]
