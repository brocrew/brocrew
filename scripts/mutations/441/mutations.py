#!/usr/bin/env python3
"""441 · a project that exists because he described the work — each row is THE DEFECT, put back (131).

🔴 **Two criteria and one gate.** HO-024 §4 row 21 — *the person describes work in a conversation and a
project exists at the end of it, with his approval as the only gate; he names nothing the app could
have known* — and row 25, *BroBot chooses the right shape and explains which and why before he
approves*. ⛔ §3's measurement is what decided the shape of both: the person-facing door asks for
four things and three of them are facts about STORAGE, and there was no name→slug derivation
anywhere in this repository at all.

## ⚑ The rulings these rows are written around

1. ⛔ **A proposal is not a question and not a permission.** It has its own two events, its own hold
   and its own launch repair — see `shared/proposals.ts` for the three measured reasons, of which
   the third is the load-bearing one: with no `because`, a routed request is answerable through
   `answer_question` by whatever conversation it names as parent, and *his approval as the only
   gate* is not a gate another agent can open.
2. 🔴 **The bound releases the model's TURN and nothing else.** `PROPOSAL_BOUND_MS` is how long a
   call parks, not how long a person has — `M17` is the first draft put back, and it turned *his
   approval as the only gate* into *his approval, within five minutes*.
3. ⛔ **Everything the app can derive, it derives**, and the negative is structural: there is no
   argument through which a slug, a folder, a provider or an agent could arrive.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M9`, `M11`-`M16`, `M18`-`M22`, `M24`-`M27` | `apps/desktop/test/a-project-he-described.test.ts` |
| `M10`, `M17` | the same file, §3 and §5 |
| `M28`-`M31` | `apps/desktop/test/dom/a-decision-with-nothing-to-fill-in.dom.test.ts` |
| `M32` | `apps/desktop/test/transcript-window.test.ts` |
| `M33` | `apps/desktop/test/a-refusal-carries-its-remedy.test.ts` |
| `M34` | `apps/desktop/test/shutdown-door.test.ts` |
| `M35` | `apps/desktop/test/creating-an-agent.test.ts` |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from bytes with a SHA-256 check — which is what `verify-each-mutation-row`
is for and is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

⛔ **No row on `create_agent`'s own ungated mint.** `419` shipped that and `441` did not close it;
a row here would be this dispatch claiming a guard it did not build. ⚑ It is a FINDING in the
response instead.

⛔ **No row on the attention queue.** A proposal is in none of `434`'s surfaces, which is a stated
gap rather than a rule — and a mutation cannot make a hole redder than it already is.

## ⚑ `446` corrected ONE anchor in place — same defect, same kill

⛔ **`M17` moved because `446` releases a wait in the same `finally`.** `441`'s parked call now joins
the session machine's own wait count — `SessionHandle.waitForAPerson` — so the conversation says a
person is being asked while the call is parked, and the release sits beside `stopClock()`. ⚑ **The
DEFECT is unchanged and it is still criterion 21's**: the bound closing the HOLD, so the card goes on
drawing Approve while the door behind it refuses for ever. Applied alone and watched go RED against
`a-project-he-described.test.ts`.

"""

WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
FOLD = "apps/desktop/src/shared/proposals.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
CARD = "apps/desktop/src/renderer/src/components/ProposalCard.vue"
VIEW = "apps/desktop/src/renderer/src/lib/transcript.ts"
WINDOW = "apps/desktop/src/renderer/src/lib/transcript-window.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0028_broad_the_stranger.sql"
OWN_INSTRUCTIONS = "apps/desktop/src/shared/own-instructions.ts"

MUTATIONS: list[tuple[str, str, list[tuple[str, str, str]]]] = [
    # ── §1 · the derivation that replaces the question ────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `slugFromName` (the name-to-slug
        # derivation whose NFC step this row plants against) was deleted with `create_project` and
        # the proposal door; no caller derives a slug from a typed name any more, and
        # `normalize('NFC')` appears nowhere in src. Commit bd70d693: "create_project and
        # list_projects ... are removed. Proposals go end to end". Its anchor is left stale, so the
        # census records it retired.
        "M1 · ⛔ the name is not composed first · a project pasted from Finder and the same project "
        "typed into a box derive two different slugs, two rows and no collision for the door to "
        "refuse — macOS hands out DECOMPOSED filenames and nothing downstream can tell them apart",
        "node",
        [(WIRE, "foldProfileName(name.trim().normalize('NFC'))", "foldProfileName(name.trim())")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `slugFromName` and its
        # `foldProfileName` step were deleted with `create_project`; `Ticket 73314` is no longer
        # turned into a project slug anywhere. `foldProfileName` itself survives for identities and
        # is protected by profile-collision and its own rows. Its anchor is left stale, so the
        # census records it retired.
        "M2 · ⛔ the name is not folded · `Ticket 73314` becomes `Ticket-73314`, which is a legal "
        "path segment and a DIFFERENT row from the one a second spelling would make — 208 H1's "
        "defect arriving through a door that did not exist when it was measured",
        "node",
        [(WIRE, "foldProfileName(name.trim().normalize('NFC'))", "name.trim().normalize('NFC')")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The slug separator lived in
        # `slugFromName`, deleted with `create_project`; no name-to-slug derivation is left in
        # runtime-ipc.ts. The only file the row named for its edit no longer contains the old
        # string. Its anchor is left stale, so the census records it retired.
        "M3 · ⛔ the separator is an underscore · `ticket_73314` is a legal segment and is not the "
        "slug anybody would predict from the name, so what a person is shown stops being derivable "
        "from what they read",
        "node",
        [(WIRE, ".replace(/[^a-z0-9._-]+/g, '-')", ".replace(/[^a-z0-9._-]+/g, '_')")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `slugFromName` was the name-to-slug
        # derivation for `propose_project`. bd70d693 deleted it from `shared/runtime-ipc.ts` (the
        # diff removes the whole function, including the `collapsed.replace(/^[^a-z0-9]+/, '')`
        # line). No product code derives a slug from a name any more, since projects are no longer
        # created and 'Proposals go end to end'. Its anchor is left stale, so the census records it
        # retired.
        "M4 · 🔴 the leading run is not trimmed · a name beginning with punctuation yields a slug "
        "`PATH_SEGMENT_PATTERN` refuses, so `slugFromName`'s one contract — the answer is a segment "
        "or it is empty — stops holding and an unusable string reaches `INSERT`",
        "node",
        [(WIRE, "collapsed.replace(/^[^a-z0-9]+/, '')", "collapsed")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row anchors the trailing-trim
        # after the 64-character cut in `slugFromName`, which bd70d693 deleted from
        # `runtime-ipc.ts`. `PATH_SEGMENT_MAX_LENGTH` and `isPathSegment` remain, but nothing
        # produces a slug from a name to cut. The killer `a-project-he-described.test.ts` was
        # deleted with the feature. Its anchor is left stale, so the census records it retired.
        "M5 · ⚠️ the cut is not trimmed afterwards · a name whose 64th character lands on a "
        "separator yields `…-`, and two names that differ only by a character this app appended "
        "become two projects",
        "node",
        [
            (
                WIRE,
                "return trimmed.slice(0, PATH_SEGMENT_MAX_LENGTH).replace(/[._-]+$/, '')",
                "return trimmed.slice(0, PATH_SEGMENT_MAX_LENGTH)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row removes the 64-character cut
        # inside `slugFromName`, which D-016 deleted along with `propose_project`. The bound
        # survives only as the validation rule `isPathSegment` and in the MCP server-name schemas,
        # which have their own rows. A 400-character project name can no longer arrive, because no
        # verb takes a project name. Its anchor is left stale, so the census records it retired.
        "M6 · ⛔ the slug is unbounded · a 400-character name becomes a 400-character directory "
        "name under `provider-homes/` and a column `isPathSegment` would refuse",
        "node",
        [
            (
                WIRE,
                "return trimmed.slice(0, PATH_SEGMENT_MAX_LENGTH).replace(/[._-]+$/, '')",
                "return trimmed.replace(/[._-]+$/, '')",
            )
        ],
    ),
    # ── §2 · what the door refuses to take ────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The check `slugFromName(named) === ''`
        # sat in `propose_project`'s argument validation in agent-tools.ts. bd70d693 removed the
        # import, the function and the verb ('Proposals go end to end'). No tool that takes a
        # project name remains, so accepting a name with no segment in it cannot happen. Its anchor
        # is left stale, so the census records it retired.
        "M7 · ⛔ a name with nothing a segment can be made of is accepted · `!!!` folds to the empty "
        "string and the proposal carries a slug no row can hold, which the store finds out at the "
        "moment a person presses Approve",
        "node",
        [(TOOLS, "slugFromName(named) === ''", "named === ''")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The anchor is `propose_project`'s
        # required `why` (`PROPOSE_WHY_ARGUMENT`), which bd70d693 deleted from agent-tools.ts along
        # with the verb and the proposal card. Criterion 25 (explain the shape and why before he
        # approves) was about proposing a project. `propose_agent_rules` still asks its own `why`,
        # but that is a separate check the row itself notes was ambiguous with this one, and other
        # tables own it. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 the reasoning stops being required · criterion 25 is *explains which and why before "
        "he approves*, and a proposal with no reasoning is the form with a Create button this verb "
        "exists instead of",
        "node",
        # ⚑ **582 · the anchor is WIDENED, not retired** (standing rule 27). ⛔ `propose_agent_rules`
        # asks its own `why` for the same reason and spells the check identically, so the bare
        # predicate became AMBIGUOUS — two matches, which is the shape `a-source-census` rows go
        # dark in. ⚠️ **The subject never moved**: the line above it is what makes this one
        # `propose_project`'s, and it is now part of the anchor. Re-verified RED by hand.
        [
            (
                TOOLS,
                "          const why = args[PROPOSE_WHY_ARGUMENT]\n"
                "          if (typeof why !== 'string' || why.trim().length === 0) {",
                "          const why = args[PROPOSE_WHY_ARGUMENT]\n"
                "          if (typeof why !== 'string') {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row chains `propose_project`'s two
        # name problems (blank name and a name whose slug is empty). Both were in the verb bd70d693
        # removed, and `slugFromName` no longer exists. Nothing in today's tools validates a project
        # name, so the every-problem-at-once rule has nothing to apply to here. Its anchor is left
        # stale, so the census records it retired.
        "M9 · ⚠️ the two name problems chain again · a 300-character string of punctuation reports "
        "one of its two problems, which is `325`'s every-problem-at-once rule broken by the code "
        "directly under the comment that states it",
        "node",
        [
            (
                TOOLS,
                "          if (typeof named === 'string' && named.trim().length > 0 && slugFromName(named) === '') {",
                "          } else if (typeof named === 'string' && slugFromName(named) === '') {",
            )
        ],
    ),
    # ── §3 · the rails ────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject, the `canCreateProjects`
        # grant asked by `proposeProject`, was removed on purpose. can_create_projects is a dead
        # column, and a-project-he-described.test.ts now asserts
        # `expect(host_).not.toContain('canCreateProjects')`. Its anchor is left stale, so the
        # census records it retired.
        "M10 · 🔴 the grant is not asked · any identity may put a durable creation in front of a "
        "person, so `canCreateProjects` stops being a grant and the seed stops being a decision",
        "node",
        [(HOST, "allowed.canCreateProjects === 'none'", "allowed.canCreateProjects === 'never'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The proposal door and its `mints`
        # shape check (`SHAPE_CREATES`, the card that could mint an agent) are gone with proposals.
        # The `create_agent` grant rail (`may-not-create-agents`, runtime-host.ts ~19388) still
        # exists, but this row's defect is 'a card about projects is the way round', which has no
        # surface left; create_agent's grant is protected by its own tables. Its anchor is left
        # stale, so the census records it retired.
        "M11 · 🔴 the agent grant is not asked for the shape that mints an agent · a control "
        "labelled *projects* becomes the way around a control labelled *agents*, and a person who "
        "set `May add new agents` to `none` gets one minted through a card about projects",
        "node",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: a person may
        # still set `canCreateAgents` to `none` (ruled 'any', narrowest 'none'), and
        # `proposeProject` still refuses the agent-minting shape with may-not-create-agents.
        # Re-verified RED alone.
        [
            (HOST, "    if (mints) {\n      const allowed = this.deps.store.capabilitiesOf(caller.profileId)\n      if (allowed === null || allowed.canCreateAgents === 'none') {\n        return no('may-not-create-agents', { you: caller.profileId })\n      }\n    }\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `no-person-to-ask` admission was
        # the proposal door's rail and is gone (0 hits in src). The row's own label says the verb
        # 'puts a project in front of you'; D-016 removed that verb: "Proposals go end to end". Its
        # anchor is left stale, so the census records it retired.
        "M12 · ⛔ a conversation with nobody at it is admitted · the card is published where no "
        "window can see it, nothing can answer it, and the tool call parks for its whole bound — "
        "the grant's own help says this verb puts a project *in front of you*",
        "node",
        [(HOST, "if (!slot.ownerIsAPerson) return no('no-person-to-ask', {})", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The one-proposal-at-a-time rail
        # (`a-proposal-is-already-waiting`, `PROPOSAL_IS_WAITING`, `proposalsThisAppHolds`) no
        # longer exists anywhere in src. A proposal is not a thing a conversation can hold any more
        # ("Proposals go end to end"). Its anchor is left stale, so the census records it retired.
        "M13 · ⚠️ the one-at-a-time rail forgets that a decided proposal is not waiting · the first "
        "proposal a conversation ever makes blocks every one after it for the life of the host",
        "node",
        [
            (
                HOST,
                "if (held.session === me && held.waiting) return no('a-proposal-is-already-waiting', {})",
                "if (held.session === me) return no('a-proposal-is-already-waiting', {})",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** A taken project name was refused at
        # the proposal door via `store.project(slug)`; there is no project name to take, no
        # `store.project(` call in runtime-host.ts, and no proposal to refuse. Card D-016a: "no
        # Projects anywhere". Its anchor is left stale, so the census records it retired.
        "M14 · ⛔ a taken project name is not refused · the proposal reaches a person, they approve "
        "it, and the store refuses at the one moment nothing can be done about it",
        "node",
        [
            (
                HOST,
                "} else if (this.deps.store.project(slug) !== null) {",
                "} else if (this.deps.store.project(slug) === null) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `SHAPE_CREATES` and the `mints` split
        # between an agent-shape and a project-shape proposal are deleted; there is one namespace
        # left (identities) and no proposal to check it for. The whole proposal door went in
        # bd70d693. Its anchor is left stale, so the census records it retired.
        "M15 · ⚠️ the name is checked in the wrong namespace · the shape that mints an AGENT asks "
        "whether a PROJECT holds the slug, so a collision with an identity is discovered after the "
        "person has already pressed Approve",
        "node",
        [(HOST, "    const mints = SHAPE_CREATES[said.shape] === 'an agent'", "    const mints = false")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The proposal row that carried a
        # derived `slug` (the object built in the proposal door) is gone, along with `slugFromName`
        # and the card the slug was shown on. Nothing shows a person a slug now and waits for a
        # click on it. Its anchor is left stale, so the census records it retired.
        "M16 · 🔴 the row carries the name instead of the derived slug · what a person was shown and "
        "what is later written come apart between the card and the click, which is the one thing "
        "putting the slug on the row exists to prevent",
        "node",
        [
            (
                HOST,
                "      slug,\n      ...(said.description === null ? {} : { description: said.description }),",
                "      slug: said.name,\n      ...(said.description === null ? {} : { description: said.description }),",
            )
        ],
    ),
    # ── §4 · the gate ─────────────────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 the bound closes the HOLD · five minutes after a proposal is made the card goes on "
        "drawing Approve while the door behind it refuses for ever — *his approval as the only "
        "gate* becomes *his approval, within five minutes*, and the model has been told not to "
        "propose it again. ⚠️ This is `441`'s first draft, put back",
        "node",
        [
            (
                HOST,
                # ⚑ **Re-anchored by `446`**, then by `615`, which added the CALL's own flag to the
            # same `finally` and made the entry reachable by name. ⛔ The DEFECT is unchanged: the
            # bound closing the HOLD, which is what `441`'s criterion 21 forbids.
            "      holding.aCallIsStillWaiting = false\n    }",
                "      holding.aCallIsStillWaiting = false\n      holding.waiting = false\n    }",
            )
        ],
    ),
    (
        "M18 · ⛔ the ledger's state is not asked · a proposal another host's launch already "
        "stranded is approved anyway, writing the project AND a second ending the fold discards — "
        "so every reader says *BroBot2 stopped before you answered* about a project that exists",
        "node",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The proposal ledger is gone, but the rule survives: the ledger's ended
        # set decides which instruction asks are waiting. That fold, `waitingOnAPerson`, is what
        # both decideInstruction's guard (runtime-host.ts:20519-20528) and settleInstructionAskTx
        # (session-store.ts:8759) read. Planting the guards themselves would only TypeError on
        # `waiting.asked`, so the plant drops the `!ended.has` filter. A settled ask then still
        # reads as waiting, and a second press would write a second version and a second ending. The
        # existing §4 tests should go red on `expect(now.waiting).toEqual([])` after approve and
        # after refuse, and the SUPERSEDES test on its `waiting` assertion. Optionally add a second
        # decideInstructi
        [
            (OWN_INSTRUCTIONS, '  return [...open.values()].filter((one) => !ended.has(one.asked.askId)).sort((a, b) => a.at - b.at)', '  return [...open.values()].sort((a, b) => a.at - b.at)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The holder check `holding.session !==
        # sessionId` belonged to `decideProposal` and is gone (no `holding` map remains in
        # runtime-host.ts). The 'one window settles another window's card' rule for questions and
        # permissions lives in `requireToAnswer` and its own tables; this row's subject was the
        # proposal card. Its anchor is left stale, so the census records it retired.
        "M19 · ⛔ only the id is compared · one window settles another window's card, so a person "
        "decides something they never read",
        "node",
        [(HOST, "if (holding === undefined || holding.session !== sessionId) {", "if (holding === undefined) {")],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-no-pressed-on-a-request-is-written-down-as-a-no.test.ts` (the landing added it; no
        # existing test observed this plant).
        "M20 · 🔴 a refusal is recorded as an approval · a person presses No and the app creates the "
        "thing anyway, which is the worst reading of `413`'s *words the person did not say*",
        "node",
        # ⚑ **Re-anchored by `615`**, which hoisted the word to a `const` so the ledger row, the
        # settled promise and the delivered turn cannot disagree. ⛔ The DEFECT is unchanged.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The refutation holds. decideInstruction still records the person's No as
        # the ending word via `approve ? 'approved' : 'refused'` (runtime-host.ts:20561), so a No
        # recorded as Yes is a live defect. NO EXISTING TEST KILLS THE PLANT: §4 'REFUSING writes
        # nothing at all' checks only the outcome, no version, and an empty `waiting`, and all of
        # those hold when the ask is ended as approved. Add to that test a read of the settled ask's
        # `instruction_settled` row (events table via `db`, or the asker's transcript) and expect
        # `ending: 'refused'`. Reading the row before host.close is the safe order.
        [
            (HOST, "    if (!this.endInstructionAsk(askId, approve ? 'approved' : 'refused', actor)) {", "    if (!this.endInstructionAsk(askId, 'approved', actor)) {"),
        ],
    ),
    (
        "M21 · ⚠️ the parked call is never told · a person decides, the row is written, and the "
        "model waits out its whole bound and reports *nobody answered* about a project that exists",
        "node",
        # ⚑ **Re-anchored by `615`** — the settle now spends the hoisted `ending`.
        [(HOST, "    holding.settle({ ending, created })", "    holding.settle(null)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `shared/proposals.ts`
        # (`projectFromProposal`) was deleted whole (count_now -1), and with it the project row's
        # `displayName`. Card D-016a: projects and proposals go, "no Projects anywhere". Its anchor
        # is left stale, so the census records it retired.
        "M22 · ⛔ the name a person read is thrown away · the project keeps only the derived slug, so "
        "the split `NewProject.vue` asks a person to make is not made at all and every surface shows "
        "`ticket-73314` where they wrote *Ticket 73314 refunds*. ⚑ **Re-anchored by `471`**, which "
        "moved this object out of `bringItIntoExistence` and into `projectFromProposal` — a pure "
        "fold, so that the approval site has no field of its own through which a folder could "
        "arrive (HO-028 §4). ⛔ The ROW is unchanged and it is now measured one module over",
        "node",
        [(FOLD, "    displayName: proposal.name,\n    description: proposal.description,", "    displayName: null,\n    description: proposal.description,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `shared/proposals.ts` is deleted, and
        # 'project folders and their rails' were removed on purpose ("project folders and their
        # rails ... are removed"). There is no project to give a folder to and no card that declares
        # one. Its anchor is left stale, so the census records it retired.
        "M23 · ⚠️ the project is given a folder nobody chose · the project's NAME is written into "
        "the column every session under it inherits. ⚑ **Re-anchored by `471`, and the RULE is "
        "unchanged while its reason moved.** ⛔ It read *HO-023 §3 is that a project is where a "
        "conversation is PLACED and the folder is the project sheet's later decision; null is "
        "nobody has chosen* — and HO-028 §4 overturned that: a proposal now DECLARES the folder and "
        "a person reads it before approving. ⚠️ **What this row protects survives the ruling whole**: "
        "the folder must be the one on the card, so a value invented at the write is exactly as "
        "wrong as it ever was — and `471` M1 is the same rule from the other side, with the literal "
        "`null` restored",
        "node",
        [(FOLD, "    description: proposal.description,\n    cwd: proposal.folder,", "    description: proposal.description,\n    cwd: proposal.name,")],
    ),
    # ── §5 · what happens when nobody decides ─────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `releaseProposalsOf` (called from the
        # Stop path) is gone with the proposal hold; the surrounding routed-requests loop is
        # unchanged and belongs to other tables. Nothing a Stop could leave waiting exists as a
        # proposal now. Its anchor is left stale, so the census records it retired.
        "M24 · 🔴 a Stop leaves the proposal waiting · the one-at-a-time rail then refuses every new "
        "proposal in that conversation with *only their answering the first one ends this*, about a "
        "card belonging to a turn the person already stopped — `437` had to fix this for questions",
        "node",
        # \u26a1 **477 re-anchored this in place**: `releaseProposalsOf` takes the caller now, so the
        # row it writes can say who stopped the work. The rule is unchanged.
        # ⛔ **608 · CORRECTED IN PLACE, not retired.** `608` removed `437`'s release loop from
        # `askTheWorkToStop` — no tool call parks on a question any more (`HO-084` §4) — so the
        # line this anchored BELOW is gone. ⚑ The SUBJECT is untouched: a Stop must release the
        # proposal hold, and the row still deletes exactly that call. Re-verified RED by hand.
        [
            (
                HOST,
                "    this.releaseProposalsOf(session, 'withdrawn', by)\n"
                "    for (const request of this.deps.store.routedRequestsOf(session.id)) {\n"
                "      if (!REQUEST_IS_OPEN[request.state]) continue",
                "    for (const request of this.deps.store.routedRequestsOf(session.id)) {\n"
                "      if (!REQUEST_IS_OPEN[request.state]) continue",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The release loop that settled
        # proposals (`PROPOSAL_IS_WAITING[proposal.state]` guard plus `proposalsThisAppHolds`) is
        # deleted, so a second ending for a settled proposal cannot be appended. Proposals go end to
        # end (bd70d693). Its anchor is left stale, so the census records it retired.
        "M25 · ⛔ the release settles a proposal that is already over · a second ending is appended "
        "for every settled proposal every time anybody presses Stop, and the fold's first-ending-"
        "wins rule is the only thing hiding it",
        "node",
        [(HOST, "      if (!PROPOSAL_IS_WAITING[proposal.state]) continue\n      const held = this.proposalsThisAppHolds.get(proposal.proposalId)", "      const held = this.proposalsThisAppHolds.get(proposal.proposalId)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `settleStrandedProposals` and its
        # `ending: 'stranded'` transaction were deleted from session-store.ts in bd70d693 (the
        # launch-sweep tx and the no-database stub). The request equivalent
        # (`settleStrandedRequests` / `request_stranded`) remains and is covered by its own tables
        # (395, 400). Its anchor is left stale, so the census records it retired.
        "M26 · ⚠️ a crash is recorded as a withdrawal · the launch sweep says somebody stopped the "
        "work when what happened is that the process died, which is `395`'s ruling that folding two "
        "endings into one word is how a word comes to imply something nobody said",
        "node",
        # \u26a1 **477 re-anchored this in place**: the sweep's row is spread over four lines now and
        # carries `THE_APP_DID_IT`. The rule is unchanged \u2014 a crash must not be called a withdrawal.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The launch sweep for
        # stranded proposals still writes ending: 'stranded' (never 'withdrawn') with by:
        # THE_APP_DID_IT — HO-029's ruling that a crash is not a withdrawal is intact. D-017's
        # try/catch wrap moved this pair of lines from 14 to 16 spaces indent, so the pre-existing
        # byte-exact anchor (already once corrected in place by 477) no longer matches.
        [
            (STORE, "                ending: 'stranded',\n                by: THE_APP_DID_IT,", "                ending: 'withdrawn',\n                by: THE_APP_DID_IT,"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `whatElseApprovingDoes` and
        # `ProposalNotice` were the proposal door's disclosure of what approving does beyond the
        # row; both are gone with proposals and the seeded-slug/adopted-folder cases they described.
        # Its anchor is left stale, so the census records it retired.
        "M27 · ⛔ what approving does BEYOND making the row is not disclosed · the card's *and "
        "nothing else* is false for a slug this app seeds and for one a folder is waiting for, and "
        "`NewAgent.vue` has carried both sentences since `423`",
        "node",
        [(HOST, "    const notices = this.whatElseApprovingDoes(said.shape, slug)", "    const notices: readonly ProposalNotice[] = []")],
    ),
    # ── the surface ───────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProposalCard.vue` was deleted
        # (count_now -1; 895 lines removed). The card whose reasoning label this row plants against
        # no longer exists, and the digest's register words are covered by digest rows. Its anchor
        # is left stale, so the census records it retired.
        "M28 · 🔴 the reasoning is drawn as an OBSERVATION · a person reads an agent's claim wearing "
        "the label this app uses for things its engine watched happen, which is `438`'s whole "
        "subject inverted at the one surface where a durable creation is at stake",
        "dom",
        [(CARD, "REGISTER_WORDS.claimed.label", "REGISTER_WORDS.observed.label")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProposalCard.vue` and its buttons are
        # deleted; a proposal card settled by a note cannot keep lit buttons that no longer exist.
        # Card: "proposals and their card ... go". Its anchor is left stale, so the census records
        # it retired.
        "M29 · ⛔ a card settled by a NOTE keeps its buttons · every press reaches a door that "
        "refuses, and the sentence saying why is on the card the buttons are still lit under",
        "dom",
        [(CARD, "props.item.ending !== null || props.item.note !== null", "props.item.ending !== null")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProposalCard.vue` is deleted, so its
        # `v-for="notice in notices"` disclosure of an adopted folder or a seeded name has no
        # surface. The disclosures themselves belonged to the proposal shape, which is removed. Its
        # anchor is left stale, so the census records it retired.
        "M30 · ⚠️ the card stops disclosing what approving does BEYOND making the row · an "
        "adopted folder brings whatever is already in it, and a seeded name brings the role and "
        "the grants this app gives it — `HO-027` §1.2 ranges over both, and a card that draws "
        "neither is a durable creation nobody declared",
        "dom",
        # ⚡ **595 re-anchored this in place** (142's rule, standing rule 27) — ⛔ **and `595`
        # relay 3 is why it is a REPAIR and not the retirement `595` first proposed.** ⚠️ The
        # first reading was that the subject died with the CLAUSE: `595` deleted *"and nothing
        # else"* because `NOTHING_IS_STARTED` is unconditional now. ⚑ **The PM ruled the subject
        # is the DISCLOSURE, not the clause** — *"an adopted folder brings whatever is already in
        # it, and a seeded name brings the role and the grants"* — and that behaviour is still on
        # the card. **The bytes moved; the rule did not.**
        #
        # 🔴 **Anchored where the rule lives and NOT where the rename happened** (relay 3 §2.2).
        # ⛔ `const alsoDoes` became `const notices` — a rename, and a row against it would be
        # measuring a variable name (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
        # ⚠️ The `v-if` on the block is taken: `595` M1 and `595` M17 own its two arms. ⚑ **The
        # `v-for`'s SOURCE is the site where the card stops disclosing at all** — on every card,
        # settled or not, folded or not, which is this row's own claim at full strength.
        #
        # ⚠️ **Re-verified RED by hand, alone, against
        # `a-decision-with-nothing-to-fill-in.dom.test.ts`** — a corrected anchor keeps a verdict
        # it never earned until somebody re-takes it, and this anchor had never been measured.
        [(CARD, 'v-for="notice in notices"', 'v-for="notice in []"')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `kind: 'proposal'` transcript
        # item, `proposalItems` and the `'released'` settle branch in `transcript.ts` were removed
        # in bd70d693; settlePending now only handles permissions and questions, which have their
        # own rows. Nothing renders a proposal decision that a released turn must settle. Its anchor
        # is left stale, so the census records it retired.
        "M31 · 🔴 a turn that ended does not settle the card · a proposal whose hold was released goes "
        "on offering a decision, and `ReadingPane` draws a live Approve button whose press reaches "
        "no listener at all — `106`'s dead control with a durable creation behind it",
        "dom",
        # 631/622 · ⚑ **the arm is CONDITIONAL since `622`** — `settlePending` takes `TheProposal`
        # and only a `'released'` ending settles one, because `616` removed the hold a turn used to
        # end. ⛔ **The row's claim is unchanged**: deleting the arm stops a proposal settling where
        # it should, and `a-decision-with-nothing-to-fill-in` arms 2 and 3 (a Stop, a recording) are
        # what kill it. ⚠️ Anchor corrected, row re-verified RED — it was inherited stale by `622`.
        [(VIEW, "    if (\n      proposal === 'released' &&\n      item.kind === 'proposal' &&\n      item.ending === null &&\n      item.note === null\n    ) {\n      item.note = reason\n    }\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `FoldCarry.proposals` and the
        # `project_proposed` carry loop in `transcript-window.ts` were deleted in bd70d693 (the
        # `proposals.push` line the row plants against is gone). A window release can no longer drop
        # a waiting proposal, because none is waiting. Its anchor is left stale, so the census
        # records it retired.
        "M32 · ⛔ a waiting proposal is dropped by a window release · the transcript is the only "
        "surface in this app that shows it exists, so the decision is waiting on somebody with "
        "nothing anywhere to press",
        "node",
        [(WINDOW, "    proposals.push({ event: item.proposal, ...(item.at !== undefined ? { at: item.at } : {}) })", "    void item")],
    ),
    # ── the vocabularies and the doors ────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `a-proposal-is-already-waiting`
        # rail is removed from `RAIL_PERMANENCES` with the rail itself. The rule 'a rail waiting on
        # a person says until-a-person-changes-it' survives for `a-person-is-being-asked` and is
        # already planted by 424 and 496 rows on `interrupt-rails.ts`. Its anchor is left stale, so
        # the census records it retired.
        "M33 · ⛔ the one-at-a-time rail promises a retry · *wait and call again* is the one act a "
        "model cannot perform, and `424` spent a dispatch removing exactly that loop from "
        "`a-person-is-being-asked`, which this rail copies",
        "node",
        [(TOOLS, "  'a-proposal-is-already-waiting': 'until-a-person-changes-it',", "  'a-proposal-is-already-waiting': 'while-this-holds',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row flips `decideProposal:
        # 'refused'` in the quit-door map in ipc.ts. D-016 (bd70d693) removed the `decideProposal`
        # command, its host method and its entry in that map, and `shutdown-door.test.ts` had its
        # `decideProposal` sample deleted. The commit message says 'Proposals go end to end', so the
        # row's subject is gone by decision, not moved. Its anchor is left stale, so the census
        # records it retired.
        "M34 · ⚠️ the decision door is answered during a quit · a person is told a project was "
        "created in the moment the app stops being able to act on it, about a row nothing will read "
        "before the process ends",
        "node",
        [(IPC, "  decideProposal: 'refused',", "  decideProposal: 'answered',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row deleted the seed
        # UPDATE of agent_identity.can_create_projects in migration 0028. 5e931be8 says 'the
        # project, proposal, binding, home and document tables go' and 'ONE migration
        # 0000_the_tree', and its agent_identity has no can_create_projects column and no seed
        # UPDATE (its only data statement seeds app_policy). The killer target
        # creating-an-agent.test.ts still exists but is about can_create_agents. Its anchor is left
        # stale, so the census records it retired.
        "M35 · 🔴 the migration's seed never runs · criterion 21's front door is dead on every "
        "already-installed database and alive on every fresh one, because `parseChoice` folds NULL "
        "to `none` — the class `0026` was written to prevent, inherited without its measurement",
        "node",
        [
            (
                MIGRATION,
                "UPDATE `agent_identity` SET `can_create_projects` = 'any' WHERE `slug` = 'default' AND `can_create_projects` IS NULL;",
                "SELECT 1;",
            )
        ],
    ),
    # ── the fold ──────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The anchor is in
        # `apps/desktop/src/shared/proposals.ts`, the proposal fold. bd70d693 deleted that file (700
        # lines) and the commit message says 'Proposals go end to end'. The
        # overwrite-under-a-live-id defect is in the deleted fold, and nothing in today's code folds
        # proposals. Its anchor is left stale, so the census records it retired.
        "M36 · ⛔ a second proposal under a live id overwrites the one a person is looking at · the "
        "card they read and the row that gets created stop being the same thing",
        "node",
        [(FOLD, "      if (rows.has(event.proposalId)) continue", "      void rows")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The anchor is in the deleted
        # `shared/proposals.ts`, where the fold ignored a second ending on a proposal that was not
        # waiting. A proposal no longer exists, so the first-ending-wins rule has no subject. The
        # card says 'Proposals go end to end' and bd70d693 deleted the fold and its killer file
        # `a-project-he-described.test.ts`. Its anchor is left stale, so the census records it
        # retired.
        "M37 · 🔴 the LAST ending wins · a launch sweep and a person's click race across a restart "
        "and the fold reports *he approved it and then the app said it was stranded*",
        "node",
        [(FOLD, "      if (held === undefined || held.state !== 'waiting') continue", "      if (held === undefined) continue")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's defect is a proposal notice
        # drawn without the `isProposalNotice` filter, in the deleted `shared/proposals.ts`. The
        # proposal notice vocabulary and its card (`ProposalCard.vue`) were removed by bd70d693
        # ('Proposals go end to end'). `NOTICE_MEANS` still exists in `app-notice.ts`, but that is a
        # different vocabulary (`AppNotice`) with its own guard (`isAppNotice`) and rows. Its anchor
        # is left stale, so the census records it retired.
        "M38 · ⚠️ an unrecognised notice is drawn · a ledger read from a FILE indexes `NOTICE_MEANS` "
        "to `undefined` and paints an empty warning line where a warning belongs",
        "node",
        [(FOLD, "        notices: (event.notices ?? []).filter(isProposalNotice),", "        notices: (event.notices ?? []) as readonly ProposalNotice[],")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The reader query `AND type IN
        # ('project_proposed', 'proposal_ended')` was removed from `session-store.ts` in bd70d693,
        # together with the launch sweep over `project_proposed` events and the `proposal_ended`
        # writer. The only remaining mentions are comments and the `events_project_proposed_idx`
        # index in schema.ts, kept because the commit runs on today's database with no schema
        # change. The replay-reads-waiting defect has no reader left. Its anchor is left stale, so
        # the census records it retired.
        "M39 · ⛔ the reader stops selecting the ending row · every proposal reads `waiting` for ever "
        "on the replayed path, which is every path after a restart — silently, and only there",
        "node",
        [(STORE, "AND type IN ('project_proposed', 'proposal_ended')", "AND type IN ('project_proposed')")],
    ),
]
