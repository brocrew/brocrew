"""1014 · D-014 · no roles, and the same permissions for every agent (`010f9426`).

⚑ **Why `1014`**: a table id must be a positive integer, so card D-00N's table is `100N`.

D-014 gave every agent one default set, and no rule names an agent: roles, the seeded grants, role
templates and the staffing carve-out are gone (their columns stay in the schema, unread). Any agent may
start a conversation as any existing profile, create agents and propose projects, with no fan-out cap,
to a depth of 6 below the root, on spawn and wake. End and interrupt reach the chain below the caller,
with no grant and no project floor. Work goes only to a conversation the caller started
(`assign-work-to-one-you-did-not-start`), and a many-callers receiver no longer admits other givers'
work. The CLIs' own sub-agents stay on for every agent.

Rows M1–M13 are the rails and the host; M14–M27 are what agents and people are told and
can do (the tools, the providers' own sub-agents, the grants sheet, New agent). Designed read-only by
the landing agent and verified one at a time.

## ⚠️ What has no row here, and why (rails side)

- **interrupt-rails.ts**: D-014 changed only docblocks. No code to row.
- **end-rails.ts beyond R13**: the rails, permanence and remedy tables did not change.
- **Depth limit 6**: the number is DEFAULT_CAPABILITIES.maxDepth in shared/capabilities.ts, which is
  the other side. The spawn and wake comparisons are already rowed on live anchors: 341 (`depth >
  spawner.maxDepth + 1`), 544 (`>=`) and 663 (`wouldSitAt > grants.maxDepth + 1`).
- **No fan-out cap**: the count facts (`liveChildrenOf`/`liveSpawns`) are gone, so a cap cannot be
  re-planted in one edit without new facts. The one-live-per-identity rail (`liveChildAs`) is rowed
  by 341/428.
- **Same-project admitting an own-project peer the caller did not start** (`!startedIt && reach !==
  'same-project'`): this would SURVIVE, because no test gives work with `can_assign_work:
  same-project` to a conversation in the caller's project that it did not start. Its subject is
  553's composite: `553` `M2` now plants it, and the landing added its killer to anyone-may-ask §1b.
- **Host `slot !== undefined && mayCommand(slot, by)` → `slot !== undefined`**: the same defect as
  R1, one layer up.
- **startWhatTheQuitClosed's `assertMayAssign(sessionId, by, says)`**: the same gate as R3/R4.
- **proposeProject `if (caller === null) return no('no-person-to-ask', {})`**: unreachable from the
  tool, because a caller mid-tool-call has a live slot.
- **The did-not-start sentence text**: pinned by the-act-inside-the-cut and by anyone-may-ask's
  `toContain('you started yourself')`. R2 covers its permanence.
- **Native sub-agent switch**: the host no longer passes a key, and the runtime package dropped the
  option (other side). Re-adding `disableNativeMultiAgentDelegation: true` in the host would plant
  no behaviour, and a-parent-that-survives-a-restart §8 pins its absence anyway.
- **admitSpawn/admitWake `?? DEFAULT_CAPABILITIES` for the spawner**: unreachable (a live parent has
  a row), and 544 anchors it.
- **`A_WAKE_WAITS_OUT_A_COUNT = ['profile-already-live']`**: 675 rows anchor its
  `.includes(refusal.rail)` use.
- **The `unknown-profile` sentence ('list_profiles names every agent')**: text only, pinned by
  the-act-inside-the-cut ('check the spelling').

## ⚠️ What has no row here, and why (surface side)

- **end_agent's reach**: the tool-door wall, the description 'End an agent below you…' and the
  list_agents clause about end/interrupt. The card note says end_agent moves to D-017, so I spent
  nothing on it. Killers already exist if wanted: a-stop-reaches-down-the-whole-chain §5
  (`toContain('below you')`) and the-rails-a-message-passes ('did NOT stop seeing its child':
  `end_agent` returns ok at `can_message: none`).
- **Removals with nothing left to plant**: New agent's role select, the role tag on the Team card
  and project room, the Team card's grant pair and `grantsAsAPersonReadsThem`, the sheet's
  `profile-list`/`concurrency` editors, `tooManyGrants`/`MAX_GRANTED_PROFILES`,
  `SPAWN_NATIVE_DELEGATION_MEANS`, `STARTING_IS_NOT_ADDING`, `may-not-create-projects`,
  `create_agent:role`, `granted_but_not_here`, `NATIVE_MULTI_AGENT_DELEGATION_TOOLS`. Each subject
  was removed on purpose, and a plant would have to recreate deleted types or data (retired by
  ruling).
- **ProjectWorkspace band note** ('Identity · current work' → '… role …'): unpinned.
  the-drawing-arrives only counts the reproductions, so this would survive. It is low value, and the
  missing test is one `toContain`.
- **`PROFILE_IS_NOT` 'never from its role'**: killed by a-sentence-the-product-can-be-held-to
  (`not.toMatch(/\brole\b/)`). It is the same class as S14.
- **`SPAWN_RAIL_MEANS` 'latitude in its approval mode'**: reverting to 'can never be given more — …'
  is caught only by the-drawing-arrives length pin (274). consent-never-containment and
  a-mode-a-child-inherits match 'can never be given more', which the old wording also has.
- **The ruled defaults** (maxDepth 6; `any` on canMessage, canAssignWork and canCreateAgents),
  `admitSpawn`/`mayCreateAgents`, the new message rail, and the host's `profilesVisibleTo`: these
  belong to the rails and host side.
- **`may-not-create-agents` sentence and `no-such-agent` 'names the ones you can see'**: text
  changes that are not a D-014 rule.
- **Dark rows on my side, left to the census**: 408 (ARGV and the deny list, retired by ruling: the
  subject was removed; `408` `M6` was re-anchored after review, since the rule survives), 516 M13 (two derivations of `disallowedTools`, retired: the native half is
  gone), 488's rows on `profilesVisibleTo(me, by)` and 'This counts every agent this app holds.'
  (re-anchor where the rule survives, e.g. M17 is still live).

## Verification

The landing agent verified every row alone with `verify_row.py` (applied, its own killer files
run, restored from bytes). The table has not been run.
- RED on D-014's own tests: 24 of 27.
- ⚠️ **M4, M16 and M23 survived D-014's own tests**, and the landing added the missing test for each
  (all RED now): a grandparent may not give its grandchild work, while the parent may
  (`a-stop-reaches-down-the-whole-chain.test.ts` §2); the real Codex factory launches exactly
  `codex app-server`, nothing appended (`codex-runtime.test.ts`); message_agent's description says work
  goes only to a conversation you started (`anyone-may-ask-work-needs-a-relationship.test.ts` §3).
"""

MESSAGE_RAILS = 'apps/desktop/src/main/runtime/message-rails.ts'
RUNTIME_HOST = 'apps/desktop/src/main/runtime/runtime-host.ts'
SPAWN_RAILS = 'apps/desktop/src/main/runtime/spawn-rails.ts'
END_RAILS = 'apps/desktop/src/main/runtime/end-rails.ts'
CLAUDE_RUNTIME = 'packages/runtime/src/claude/claude-runtime.ts'
CODEX_RUNTIME = 'packages/runtime/src/codex/codex-runtime.ts'
AGENT_TOOLS = 'apps/desktop/src/main/runtime/agent-tools.ts'
FACTORY_TEXT = 'apps/desktop/src/main/runtime/factory-text.ts'
ASK_AND_WAIT = 'apps/desktop/resources/built-in-skills/ask-and-wait/SKILL.md'
CAPABILITIESSHEET = 'apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue'
CAPABILITIES = 'apps/desktop/src/shared/capabilities.ts'
STANDING_GRANTS = 'apps/desktop/src/renderer/src/lib/standing-grants.ts'
NEWAGENT = 'apps/desktop/src/renderer/src/components/NewAgent.vue'

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **`any` gives work to a conversation the caller did not start.** The relationship is asked only under `same-project`, so the ruled default hands work to a conversation a person opened, or to a stranger's child (HO-060 §2.2's second arm is back). · killed by `anyone-may-ask-work-needs-a-relationship.test.ts` and `the-rails-a-message-passes.test.ts` and `a-message-that-crosses-a-project.test.ts` and `one-session-and-a-queue.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — "Work goes
        # only to a conversation the giver started" is now structural: `helperAs` finds only the
        # giver's own children (slot `spawnedBy` in `theirs`). The plant removes that line, so a
        # give also finds a conversation the giver did not start. Killed by
        # `anyone-may-ask-work-needs-a-relationship.test.ts`.
        [
            (RUNTIME_HOST, '      if (slot.spawnedBy === null || !theirs.has(slot.spawnedBy)) return false\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The rail
        # `assign-work-to-one-you-did-not-start` and its permanent refusal are gone, since a give
        # names an agent and only reaches one the giver started. The killer's comment says it was
        # "the `permanent` refusal a grant could not move, and a give names an agent, so there is no
        # call that reaches a conversation the giver did not start for any grant to admit." Its
        # anchor is left stale, so the census records it retired.
        'M2 · ⛔ **The did-not-start rail sends the caller to ask a person for a grant.** `assign-work-to-one-you-did-not-start` is priced `until-a-person-changes-it`, but no grant changes who started a conversation, so the promise is false. · killed by `the-rails-a-message-passes.test.ts` and `anyone-may-ask-work-needs-a-relationship.test.ts` and `the-doors-our-own-verbs-do-not-need.test.ts`',
        [
            (MESSAGE_RAILS, "  'assign-work-to-one-you-did-not-start': 'permanent',\n", "  'assign-work-to-one-you-did-not-start': 'until-a-person-changes-it',\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Commit bd70d693
        # "refactor(D-016): projects and proposals go" removed `takes_work_from` end to end
        # ("Proposals go end to end, with the demo seed, the renderer fixtures and takes_work_from
        # (the one-open-task rail now refuses on any open task)"). The
        # `one-session-and-a-queue.test.ts` header says D-016 took `takesWorkFrom` "end to end". Its
        # anchor is left stale, so the census records it retired.
        "M3 · 🔴 **A many-callers receiver takes work from a giver that did not start it.** 565's disjunct is back at the host: the receiver's own `takesWorkFrom` admits any giver's work. · killed by `one-session-and-a-queue.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `assertMayAssign` (the
        # 'may this caller give that conversation WORK' gate, D-014) is unchanged in shape — its
        # `mayCommand(slot, by)` call is now `mayCommand(this.commandedNow(slot), by)` (D-017's
        # replaced-conversation lookup), but the gate and the rule it enforces are identical.
        # `one-session-and-a-queue.test.ts` still has the exact paired test ('…and at many-callers
        # the SAME call is refused the same way — the receiver's word admits no giver') asserting a
        # `many-callers` grant admits no extra giver.
        [
            (RUNTIME_HOST, '      slot !== undefined && mayCommand(this.commandedNow(slot), by),\n', "      slot !== undefined && (mayCommand(this.commandedNow(slot), by) || this.howManyCallersItTakesWorkFrom(sessionId) === 'many-callers'),\n"),
        ],
    ),
    (
        "M4 · ⛔ **A grandparent gives work to its grandchild.** The chain below the caller (end's and interrupt's reach) counts as a conversation it started at the give door, so work skips the manager in between · killed by `a-stop-reaches-down-the-whole-chain.test.ts` (the test the landing added)",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same `assertMayAssign`
        # gate as M3, same anchor line, just a different widening (whole ancestor chain instead of
        # `many-callers`). `a-stop-reaches-down-the-whole-chain.test.ts` still has 'REFUSED · the
        # chain grants no WORK — a grandparent may not give its grandchild work'
        # (`assign-work-to-one-you-did-not-start`), which this plant would turn green/wrong.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # a chain grants no give survives: `giveFacts.held` is what the giver holds, and a
        # grandparent may not give a piece its descendants hold. The plant widens `held` with
        # everything held by conversations below the giver in the chain, so the grandparent's give
        # is admitted. Killed by `a-stop-reaches-down-the-whole-chain.test.ts`.
        [
            (RUNTIME_HOST, '      held: (giver) => this.heldBy(giver),\n', '      held: (giver) => [\n        ...this.heldBy(giver),\n        ...[...this.slots.keys()]\n          .filter((below) => this.mayReadTheTranscriptOf(below, giver))\n          .flatMap((below) => this.heldBy(below)),\n      ],\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** This row plants a narrower reach
        # directly into `endAgent`'s existence/entitlement check, and `endAgent` (and end-rails.ts,
        # 236 lines) is entirely deleted by this commit — the commit message says so outright
        # ('end_agent and resume_agent are gone'). Its reach question is now `interruptAgent`'s
        # ('not-below-you'), a genuinely different refusal word and code path, not a reshaping of
        # this line. Its anchor is left stale, so the census records it retired.
        "M5 · 🔴 **End reaches only the conversations the caller started, not the chain below it.** A grandparent's `end_agent` on its grandchild is `no-such-agent` again (the pre-D-014 reach). · killed by `a-stop-reaches-down-the-whole-chain.test.ts`",
        [
            (RUNTIME_HOST, "    if (target === undefined || target === null) return 'no-such-agent'\n", "    if (target === undefined || target === null) return 'no-such-agent'\n    if (by !== THE_APP_ITSELF && target.ownerId !== by.ownerId && target.commandedBy !== by.ownerId) return 'no-such-agent'\n"),
        ],
    ),
    (
        'M6 · 🔴 **A grant stands in front of ending again.** A caller a person narrowed to `can_message: none` (or `same-project` across a project) may no longer end the conversations below it. · killed by `the-rails-a-message-passes.test.ts`',
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — D-014's rule ('no grant
        # stands in front of stop/interrupt reach') is untouched and now lives in `interruptAgent`'s
        # own entitlement check, since `endAgent` inherited it and is gone; the class docblock even
        # says 'Stopping is not asked it (D-014): interruptAgent reaches the chain below the caller,
        # whatever it may message.' `the-rails-a-message-passes.test.ts` still has the exact paired
        # test calling `interrupt_agent` under `can_message: none` and expecting `outcome: 'ok'`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule stands (D-014: no grant stands in front of stop/interrupt
        # reach) and lives in `RuntimeHost.interruptAgent`, but the old plant called
        # `this.reachRefusalOf`, which no longer exists and would throw a TypeError. The new plant
        # refuses with the same `not-below-you` rail whenever `this.mayReachAtAll('message', by)` is
        # non-null, right after the `mayInterrupt` block, so a caller narrowed to `can_message:
        # none` can no longer stop its child. Killed by the-rails-a-message-passes' 'it did NOT stop
        # seeing its child' test, where `interrupt_agent` is `ok` at `can_message: none`. Killed by
        # `the-rails-a-message-passes.test.ts`.
        [
            (RUNTIME_HOST, "    if (!this.mayInterrupt(sessionId, by)) {\n      return { ok: false, refusal: refuseInterrupt('not-below-you', { agent: sessionId }) }\n    }\n", "    if (!this.mayInterrupt(sessionId, by)) {\n      return { ok: false, refusal: refuseInterrupt('not-below-you', { agent: sessionId }) }\n    }\n    if (this.mayReachAtAll('message', by) !== null) {\n      return { ok: false, refusal: refuseInterrupt('not-below-you', { agent: sessionId }) }\n    }\n"),
        ],
    ),
    (
        "M7 · 🔴 **Interrupting needs a grant again.** A caller refused `can_message` may no longer stop what it commands, so a person's narrowing of words also takes away the stop. · killed by `the-rails-a-message-passes.test.ts`",
        [
            (RUNTIME_HOST, '    const session = this.requireToCommand(sessionId, by)\n    // 🔴 **723 · R83', "    const session = this.requireToCommand(sessionId, by)\n    this.assertMayReach('message', sessionId, by)\n    // 🔴 **723 · R83"),
        ],
    ),
    (
        'M8 · 🔴 **Interrupt stops at the project boundary again.** An agent above a conversation that sits in another project may not interrupt it, so BroBot cannot stop a worker in the project it staffed. · killed by `a-stop-reaches-down-the-whole-chain.test.ts`',
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — D-014's 'no project
        # floor' rule for stop/interrupt still holds and is still `interruptAgent`'s job (its
        # predecessor `endAgent` is gone, but the rule moved wholesale).
        # `a-stop-reaches-down-the-whole-chain.test.ts` §3 ('BroBot's conversation is OUTSIDE the
        # project it staffed') still calls `interrupt_agent` across a project boundary expecting
        # `outcome: 'ok'`, `asked: true` — a wrongful project check placed before
        # `nothingToInterrupt` would flip that to refused.
        [
            (RUNTIME_HOST, '    if (slot === undefined || onItsWayOut(slot)) return this.nothingToInterrupt(sessionId)\n', "    if (sessionSpeakingAs(by) !== null && this.deps.store.identityOf(sessionSpeakingAs(by) ?? '')?.projectSlug !== this.targetAsItWillRun(sessionId)?.projectSlug) return { ok: false, refusal: refuseInterrupt('not-below-you', { agent: sessionId }) }\n    if (slot === undefined || onItsWayOut(slot)) return this.nothingToInterrupt(sessionId)\n"),
        ],
    ),
    (
        "M9 · ⛔ **A rule names BroBot: no agent may start a conversation as BroBot's own profile** (the person, `04` §5: guards are emergent, not hardcoded). · killed by `the-five-tools.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The guard that
        # no agent may start a conversation as BroBot's own profile still has a subject:
        # `DEFAULT_PROFILE_ID` is `'brobot'` and the start rails still run at step 7 of `admitGive`.
        # The plant hardcodes a refusal of the folded name `brobot` before the model choice is read.
        # Killed by `the-five-tools.test.ts`.
        [
            (SPAWN_RAILS, '  const chosen = known ? facts.modelChoiceOf(asked.profile) : null\n', "  if (foldProfileName(asked.profile) === 'brobot') return no('no-such-profile', { profileId: asked.profile })\n  const chosen = known ? facts.modelChoiceOf(asked.profile) : null\n"),
        ],
    ),
    (
        'M10 · 🔴 **list_profiles is folded again.** It names only identities an agent created (a staffing-style fold), so an agent is not told about agents it may start. · killed by `who-exists-and-what-they-were-told.test.ts`',
        [
            (RUNTIME_HOST, '      profiles: this.deps.store.agentIdentities().map((one): ProfileReport => {\n', "      profiles: this.deps.store.agentIdentities().filter((one) => one.createdBy?.by === 'an-agent').map((one): ProfileReport => {\n"),
        ],
    ),
    (
        'M11 · 🔴 **A first launch is told it may do nothing.** With no row yet, the instructions carry the NARROWEST grants instead of the one default set every agent holds. · killed by `the-text-a-child-is-actually-told.test.ts`',
        [
            (RUNTIME_HOST, '          : (this.deps.store.capabilitiesOf(profileSlug) ?? DEFAULT_CAPABILITIES),\n', '          : (this.deps.store.capabilitiesOf(profileSlug) ?? NARROWEST_CAPABILITIES),\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row is about whether PROPOSING A
        # PROJECT needs the agent grant. D-016a removed 'create_project and list_projects' and
        # 'Proposals go end to end', so the `mints` branch and the project-proposal shape no longer
        # exist. The killer, a-project-he-described.test.ts, is deleted with them. Its anchor is
        # left stale, so the census records it retired.
        "M12 · ⛔ **Proposing a PROJECT needs a grant again.** The agent grant is asked for every shape, so a caller a person set to 'May add new agents: none' may no longer propose a bounded project. · killed by `a-project-he-described.test.ts`",
        [
            (RUNTIME_HOST, '    if (mints) {\n      const allowed = this.deps.store.capabilitiesOf(caller.profileId)\n', '    {\n      const allowed = this.deps.store.capabilitiesOf(caller.profileId)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):**
        # `apps/desktop/src/main/runtime/end-rails.ts` (the file this edit targets) is deleted
        # outright — 236 lines removed, nothing left — because `end_agent` no longer exists. No
        # refusal anywhere in the current tree says 'take the work back with withdraw_task, and
        # their question stays where it is'; `withdraw_task`'s own refusals are unrelated text with
        # no equivalent sentence to mis-word this way. Its anchor is left stale, so the census
        # records it retired.
        'M13 · ⛔ **The end refusal tells ANY ender to take the work back itself.** `withdraw_task` refuses anyone who did not give the work, and since D-014 an ender may be any conversation above the target. · killed by `the-act-inside-the-cut.test.ts`',
        [
            (END_RAILS, 'Nothing was ended: carry on with something else, or say that you are blocked on it. Whoever gave it the work can take it back with withdraw_task, and their question stays where it is.', 'Nothing was ended: to stop its work instead, take the work back with withdraw_task — their question stays where it is.'),
        ],
    ),
    (
        "M14 · 🔴 **Claude's own sub-agents switched off again**: every Claude launch denies `Agent`, `Workflow` and `Task` through `disallowedTools`, so no agent keeps the CLI's own sub-agents · killed by `claude-runtime.test.ts`, `external-mcp.test.ts`",
        [
            # ⚑ **the providers' question tools are off · re-anchored in place, not retired** — NOT VERIFIED and HELD: the list now leads with Claude's own question tool, off on every launch; the row still adds Agent, Workflow and Task; its file is a runtime seat no mutant runs on without a written lift
            (CLAUDE_RUNTIME, "    const deniedToolNames = [...CLAUDE_TOOLS_TURNED_OFF, ...forbiddenExternalSpellings(externalMcp)]\n", "    const deniedToolNames = [\n      'Agent',\n      'Workflow',\n      'Task',\n      ...CLAUDE_TOOLS_TURNED_OFF,\n      ...forbiddenExternalSpellings(externalMcp),\n    ]\n"),
        ],
    ),
    (
        "M15 · 🔴 **Codex's own agents switched off again**: the app-server argv carries `--config agents.enabled=false` for every launch · killed by `codex-runtime.test.ts`",
        [
            (CODEX_RUNTIME, "  return ['app-server']\n", "  return ['app-server', '--config', 'agents.enabled=false']\n"),
        ],
    ),
    (
        'M16 · 🔴 **the same override, at the CALL SITE**: `createSpawnTransportFactory` appends `--config agents.enabled=false` to the argv it spawns, while `codexAppServerArgs()` stays clean · killed by `codex-runtime.test.ts` (the test the landing added)',
        [
            (CODEX_RUNTIME, '    return new SpawnCodexTransport(command, codexAppServerArgs(), {\n', "    return new SpawnCodexTransport(command, [...codexAppServerArgs(), '--config', 'agents.enabled=false'], {\n"),
        ],
    ),
    (
        'M17 · 🔴 **a rule names BroBot, and list_profiles is folded again**: the listing hides the one name this app ships, so an agent is told it may start every agent except BroBot · killed by `who-exists-and-what-they-were-told.test.ts`',
        [
            (AGENT_TOOLS, '          const reading = host.profilesVisibleTo()\n', "          const reading = { profiles: host.profilesVisibleTo().profiles.filter((report) => report.profile !== 'brobot') }\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It plants `mayCreateAgents` ahead of
        # create_project's arguments, and D-016a removed create_project ('create_project and
        # list_projects ... are removed'). agent-tools.ts no longer has `PROPOSE_NAME_ARGUMENT`. The
        # surviving grant rule, that spawn_agent asks `mayCreateAgents`, is not this row's subject,
        # and the row's second killer a-project-he-described.test.ts is gone. Its anchor is left
        # stale, so the census records it retired.
        'M18 · ⛔ **proposing a project needs the agent grant again**: create_project asks `mayCreateAgents` before any argument, for every shape, so an agent a person narrowed on *May add new agents* can no longer propose even a bounded project · killed by `the-doors-our-own-verbs-do-not-need.test.ts`, `a-project-he-described.test.ts`',
        [
            (AGENT_TOOLS, '          const problems: string[] = []\n          const named = args[PROPOSE_NAME_ARGUMENT]\n', '          const wall = host.mayCreateAgents(me, by)\n          if (!wall.ok) return refusalAnswer(refuseTool(wall.rail, wall.detail))\n          const problems: string[] = []\n          const named = args[PROPOSE_NAME_ARGUMENT]\n'),
        ],
    ),
    (
        'M19 · ⛔ **interrupting reads a grant again**: interrupt_agent asks the messaging wall before it interrupts, so a parent a person narrowed to `can_message: none` can no longer stop the chain below it · killed by `the-doors-our-own-verbs-do-not-need.test.ts`',
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The `interrupt_agent` door now reads `host.interruptAgent(addressed,
        # by)` after `theConversationAddressed`, so the old `interruptAgent(agent, by)` anchor is
        # gone. The plant asks the messaging wall (`host.mayReachAtAll('message', by)`) as the first
        # statement of the door's body rather than next to the call, because the census slices only
        # 700 characters of the comment-stripped body. The census then finds a standing wall in
        # `interrupt_agent`, which D-014 ruled it must not have. Killed by
        # `the-doors-our-own-verbs-do-not-need.test.ts`.
        [
            (AGENT_TOOLS, "          const { agent, reason } = args\n          if (typeof agent !== 'string' || typeof reason !== 'string' || reason.length === 0) {\n", "          const { agent, reason } = args\n          const wall = host.mayReachAtAll('message', by)\n          if (wall !== null) return answer(carryMessageRefusal(wall), `refused (${wall.rail}): ${wall.reason}`)\n          if (typeof agent !== 'string' || typeof reason !== 'string' || reason.length === 0) {\n"),
        ],
    ),
    (
        'M20 · ⛔ **the model is told taking back a stalled piece needs messaging**: ask-and-wait offers `withdraw_task` only when messaging is allowed, so an agent narrowed on messaging is never told it may take back its own stalled piece · killed by `built-in-skills-rules.test.ts`',
            # ⚠️ The join D-014 dropped comes back with the branch: without it an agent left one door
            # is told "…instead:  and read it with list_tasks." and a grammar check kills the row
            # for the wrong reason.
        # ⚑ Landing PE-004 (758d967c) · re-anchored in place, not retired — PE-004 replaced
        # interrupt_agent in the stall advice with take-back (`withdraw_task`, 'only messaging needs
        # a grant'). The rule survives reshaped: an agent narrowed on messaging must still be told
        # it may take back a stalled piece. The plant offers withdraw_task only to an agent that may
        # message. Killed by `what-an-agent-is-told-about-its-work.test.ts`,
        # `the-text-a-child-is-actually-told.test.ts`.
        # ⚑ **W4.481 · re-homed onto the skill that carries the rule, not retired** — the v6 core leaves this rule to the ask-and-wait skill, so the plant makes taking a stalled piece back depend on messaging there. NOT VERIFIED. Killed by `built-in-skills-rules.test.ts`.
        # ⚑ **W4.564 · relabelled to what its edit does; the edit is unchanged** — the label named
        # interrupt_agent and two files that no longer read this text. Verified RED alone: killed
        # by `built-in-skills-rules.test.ts` ("ask-and-wait carries each of its rules, word for word").
        [
            (
                ASK_AND_WAIT,
                # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
                "Follow up with its holder when allowed, or deliberately take it back; neither choice requires the other.",
                "Follow up with its holder when allowed, or deliberately take it back when messaging is allowed.",
            ),
        ],
    ),
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M21 · 🔴 **create_agent's answer says a new name needs a grant to start**: the success answer again ends 'Creating a name adds it to nobody's grant… only a person can grant you', which is false now that any agent may start any existing profile · killed by `two-verbs-one-sentence.test.ts`",
        [('apps/desktop/src/main/runtime/agent-tools.ts', "}${wrote === null ? '' : ` ${ITS_RULES_ARE_SAVED}`}`", "}${wrote === null ? '' : ` ${ITS_RULES_ARE_SAVED}`} Creating a name adds it to nobody's grant — spawn_agent starts a conversation only as an agent your own grant admits, which list_profiles will tell you, and a name it does not list is one only a person can grant you.`")],
    ),
    (
        "M22 · 🔴 **spawn_agent's description says the name must be one your own grant admits**: every agent is told a grant decides whom it may start · killed by `two-verbs-one-sentence.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # `give_work` description is a model-visible sentence that says a name this app does not
        # hold is refused without `new`. The plant replaces it with a sentence about grants that is
        # false for the give rails. Killed by `two-verbs-one-sentence.test.ts`.
        [
            (AGENT_TOOLS, 'without it, a name this app does not hold is refused.', 'without it, the name must be one your own grant admits.'),
        ],
    ),
    (
        "M23 · ⛔ **message_agent's description offers work to a conversation you did not start**: 'unless a person has granted you more or that agent takes work from anybody' comes back, so a model is told of two ways in that the new permanent rail `assign-work-to-one-you-did-not-start` refuses · killed by `anyone-may-ask-work-needs-a-relationship.test.ts` (the test the landing added)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # `message_agent` description sends work to `give_work` and must not promise work to
        # anybody. The plant makes it say work goes to conversations you started unless a person
        # granted more or an agent takes work from anybody, which is the removed `takes_work_from`
        # teaching. Killed by `anyone-may-ask-work-needs-a-relationship.test.ts`.
        [
            (AGENT_TOOLS, 'To give work, use give_work; to ask something', 'To give work, use give_work, which goes to conversations you started, unless a person has granted you more or that agent takes work from anybody; to ask something'),
        ],
    ),
    (
        "M24 · 🔴 **the grants sheet no longer says any agent may start this identity**: the owner line goes back to 'Any other identity named among them is one these grants point at — … open its own sheet', a sentence about a grant picker that no longer exists · killed by `the-grant-a-person-meant-to-give.test.ts`, `an-identity-named-and-a-clear-said-first.dom.test.ts`",
        [
            (CAPABILITIESSHEET, 'conversation is running as {{ called }}. Any agent may start a conversation as\n          {{ called }}, and that conversation holds these grants.</small', 'conversation is running as {{ called }}. Any other identity named among them is one these\n          grants point at — to change what that one may do, open its own sheet.</small'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It plants the *Serves* help sentence
        # ('Many callers also means any agent may give this identity work'), whose column
        # `takesWorkFrom` D-016a deleted end to end ('takes_work_from (the one-open-task rail now
        # refuses on any open task)'). capabilities.ts no longer has the field or the sentence, and
        # one-session-and-a-queue.test.ts records that its section on the mark went with it. Its
        # anchor is left stale, so the census records it retired.
        "M25 · ⛔ **the *Serves* help says a shared service takes other givers' work again**: the grants sheet tells a person that marking an identity many-callers lets any agent give it work, which the rail now refuses · killed by `one-session-and-a-queue.test.ts`",
        [
            (CAPABILITIES, 'It admits nobody: work goes only to a conversation the giver started, and a giver is refused a second piece while its first is open.', 'Many callers also means any agent may give this identity work, including one that did not start the conversation; either way, a giver is refused a second piece while its first is open.'),
        ],
    ),
    (
        "M26 · ⛔ **a person is told a commander's reach is a grant a person made**: the session header's paragraph says so again, but stopping and ending now read no grant (the chain decides) · killed by `a-person-is-told-an-agent-can-still-drive-it.render.test.ts`, `three-sentences-that-describe-an-older-app.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired —
        # `ANOTHER_CALLER_MAY_REACH_IN` in standing-grants.ts still exists and still needs to say
        # stopping is NOT a person's grant (D-014: it's the chain) — it only dropped the now-false
        # 'and ending it' clause (`end_agent` is gone). Both killer tests still explicitly assert
        # `.not.toContain('is a grant a person made')` against this exact constant, which is
        # precisely the false claim this row plants.
        [
            (STANDING_GRANTS, "  'conversation while you have it open. It can go as far as sending messages here and stopping ' +\n", "  'conversation while you have it open. What it may do is a grant a person made, and it can go as far as sending messages here and stopping ' +\n"),
        ],
    ),
    (
        "M27 · ⛔ **New agent promises a role**: the note for BroBot's slug again says 'a role chosen here replaces the one this app would have given it…' on a form that has no role · killed by `a-gesture-that-creates-an-agent.dom.test.ts`",
        [
            (NEWAGENT, "on, and you can change it later on this agent's own sheet.\n        </p>", "on, and you can change it later on this agent's own sheet; a role chosen here replaces the\n          one this app would have given it, and that cannot be changed afterwards.\n        </p>"),
        ],
    ),
]
