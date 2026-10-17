"""663 · Wake one conversation: `resume_agent`.

⚑ **`HO-018` §2.3's *ask the child to continue* had no door.** After a restart a parent could
re-assign, close or wait (`646` §7.2); it could not ask its child to CARRY ON, because `message_agent` answers `no-such-agent` for a
conversation that is not running. `resume_agent` wakes exactly ONE conversation through
`resumeSession(id, null)` (`652`), so it comes back `unwatched` and claimable.

## 🔴 A · what the dispatch CHANGED

 1. **The door** — `RuntimeHost.wakeSession`, in the order its docblock argues: a conversation the
    caller may already reach is answered by what it is — a launch in flight `that-conversation-has-not-started`,
    a RUNNING one `that-conversation-is-running` only once `message_agent`'s project boundary has been
    asked too (review), one on its way out goes on; every id that is not the caller's own child
    still holding the caller's open work is ONE answer, `no-such-agent` — given to a listed one on its
    way out only once its teardown is over (PM Ruling 1; review, both rounds); reach's
    project boundary is asked as `message_agent` meets it; then the launch rails, with the fold and
    reach asked once more after the teardown wait (review). The caller's own id is `that-agent-is-you`,
    answered by the tool.
 2. **The fold has TWO clauses, and the first is not in the brief** — `spawnProvenance(id).parentSessionId
    === me`. ⛔ A giver is not always the parent (`can_assign_work: any`, or any caller giving into a
    receiver that takes work from many callers), so open work alone admitted a PERSON's conversation and another agent's
    child — measured by §2.1.
 3. **The launch rails, in `resumeSession`'s synchronous window** — `admitWake` (`spawn-rails.ts`),
    handed in as `admit` and asked after the teardown wait and before `reserve`, so two wakes in one
    turn, or a wake and a spawn, cannot both take one free place (§3.9, §3.10). ⚑ R13a (`not-in-can-spawn`,
    both arms), R13's concurrency three, and — this dispatch's reading of *"spawn_agent's rails apply
    unchanged"* — `spawning-disabled`, `too-deep` and `wider-than-its-parent`; `too-deep`,
    `no-such-parent` and `wider-than-its-parent` each with a wake sentence of its own (review).
 4. **The tool** — `resume_agent`, `beyondItsRails: it-starts-something-outside-this-app` (R13b), the
    standing wall first, one argument and every other key refused, and `aWakeThatDidNotHappen`: three
    new words (`that-conversation-is-running`, `-is-still-stopping`, `-could-not-be-resumed`, the last
    `until-a-person-changes-it` because a person can fix some of what a resume fails on — review;
    priced first on Codex wrapping an expired sign-in, which `673` stopped)
    and `657`'s launch words for the rest, by type, the host's text to the log.
 5. **The double `661` built, lifted** to `apps/desktop/test/lib/provider-double.ts` and adopted by
    `661`'s file; §1 runs on both provider shapes.

## ⛔ B · what has NO row, said rather than left out

⚠️ **`unknown-profile` is not asked at a wake**, so there is no clause to mutate: `removeAgentIdentity`
throws on an identity a conversation still points at, so the identity a woken conversation ran as
always has its row.

⚠️ **Codes a null reopen can reach in general that get no word, and no row**: `not-recorded`,
`read-only`, `restored-elsewhere`, `no-input-end`. ⛔ Behind the fold none is reachable — a child this
app spawned has a profile and a row it created, and was never adopted or restored — so each falls
through and is rethrown. ⚠️ **Nor `run-by-another-host`**: production builds one `RuntimeHost` per
process (`index.ts`), so only a test with two hosts over one ledger meets it. ⚠️ **Nor
`held-by-nobody` / `already-open-elsewhere`**, which the wake answers before `reserve` can (a slot can
appear only inside the teardown wait, which every reopen of that id waits on in the order it asked;
a racer meets `still-opening`).

⚠️ **`still-closing` HAS a word and no row** (review): the reopen waits twice the close bound on a
teardown whose finalizer archive has no bound of its own, so `reserve` can refuse it — reasoned from
the code, not measured, because no rig here holds an archive open. A row on the arm would survive, so
it is named here rather than claimed.

⚠️ **No row on `projectSlug` as `profile-already-live`'s third key at a wake.** Mutated to `null` the
rail gets STRICTER — a blocker's project then matches any — and only a parent holding one identity
live in two projects at once could tell; §2.7's rig builds a second project but no second live
child in it. Named rather than claimed.

⚠️ **No row on the developer prose this dispatch corrected** (the `no-such-agent` notes, the
`resumeSession` docblocks, the question rail's note, the cost bound `661` wrote) — prose measured by
nothing is not a row. ⚑ The MODEL-read sentences this dispatch wrote have rows on their load-bearing
clauses (`M22`, `M42`, `M49`, `M51`–`M55`); ⚠️ the malformed-request problem strings and the
description's last clause (*"the refusal says why"*) have none.

⚠️ **No row on `provider: row.provider` in `admitTheWake`** — the provider half of
`wider-than-its-parent` at a wake. ⛔ Every wake here is Claude beside Claude, so a Codex child
recorded `auto` beside a Claude `auto` parent — the arm where the comparison sees the sandbox too —
is not built; mutated, it would survive. Named rather than claimed (review, round two).

## ⚑ D · corrected in place BY 677

**M9**'s anchor was the wake's one-line `resumeSession(…)` call; `677` added a fifth argument (`R25`
§1.3, a wake reads the person's current model choice) and the call now spans lines. ⚑ The subject is
untouched, the replacement keeps `677`'s argument and moves only the rails, and the row was re-verified
RED alone — see the row's own note.

## ⚑ C · another table's prose, corrected in place

`644` **M4**'s label said a spawned child whose conversation has ENDED *"is refused by every door
that takes an id"*; since `resume_agent` it is every door that takes an id from `list_agents`. ⚑ The
label only — its anchor and replacement are unchanged, so its verdict is the one it earned.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

MUTATIONS = [
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The commit removes resume_agent and its
        # RuntimeHost.wakeSession door entirely (commit message: "end_agent and resume_agent are
        # gone"); wakeSession has zero references left in runtime-host.ts. A running conversation is
        # now delivered to directly by deliverWhenItRuns once reach was already checked upstream at
        # the tool layer, so there is no separate wake→reserve→held-by-nobody path left to break.
        # Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 a RUNNING conversation is woken rather than pointed at `message_agent` · the wake goes on to `reserve`, which refuses it `held-by-nobody` in a window's words, and the tool rethrows it as a broken tool",
        # ⚑ **RE-ANCHORED at 690, not retired**: `690` asks the running state again after the
        # sign-in read, one indent deeper, so the bare line matched twice; the comment under it pins
        # this one. The row still takes the running arm away.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired —
        # `runningStateOf(sessionId) !== 'not-running'` was renamed to the equivalent helper
        # `this.runsNow(sessionId)` (slot exists, session live, not on its way out, status not
        # ended/errored) at the same branch point in `wakeSession`. The branch and its consequence —
        # skip the running-conversation arm and fall into the launch/reserve path — are otherwise
        # unchanged, so the plant re-anchors onto the renamed condition.
        [
            (HOST, "      if (this.runsNow(sessionId)) {\n        // 🔴 **`message_agent`'s SECOND question, asked before a word that names it** — found by", "      if (false) {\n        // 🔴 **`message_agent`'s SECOND question, asked before a word that names it** — found by"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** wakeSession and its aReachRefusal
        # helper are gone (0 references). A launch in flight is no longer answered with an immediate
        # refusal from a separate wake door; startForADelivery now WAITS out the in-flight launch
        # (`await slot.arrived`) before proceeding, an architecturally different flow with no
        # early-return branch to delete for this defect. Its anchor is left stale, so the census
        # records it retired.
        "M2 · ⛔ a launch in flight is not answered before the wake asks anything · a third call learns it at the reservation instead, from a code the classifier had to catch",
        # ⚑ **RE-ANCHORED at `681`, not retired** — PM ruling R30b asks `message_agent`'s second
        # question before the word, so the branch is a block. ⛔ The DEFECT is unchanged: the branch
        # goes. Re-applied and re-run individually after the correction.
        [(HOST, "      if (slot.session === null) {\n        return this.aReachRefusal(sessionId, by) ?? said('that-conversation-has-not-started')\n      }\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** wakeSession's running-conversation
        # branch (which is what M3 targeted) no longer exists. Reach is now asked uniformly for
        # every message, running or not, at the agent-tools.ts tool layer (host.whyItIsOutOfReach)
        # before any delivery/start logic runs, so there is no wake-specific 'running answered
        # without reach' branch left to reintroduce. Its anchor is left stale, so the census records
        # it retired.
        "M3 · 🔴 the running answer forgets REACH · a running conversation the caller may not reach is answered *running* — the wake becomes the way to learn that a conversation `message_agent` folds into `no-such-agent` is alive",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** 675's `aWakeWouldBeAsked` asks the same line, so the anchor now carries the comment below it in `wakeSession`; The DEFECT this row plants is unchanged.
            (
                HOST,
                "    if (slot !== undefined && this.withinMessagingReach(sessionId, by, me)) {\n      // ⚑ **A launch in flight is `message_agent`'s own word for it** (650), shared on purpose: it",
                "    if (slot !== undefined) {\n      // ⚑ **A launch in flight is `message_agent`'s own word for it** (650), shared on purpose: it",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `holdsOpenWork` and the
        # `provenance?.parentSessionId === me` wake-admission fold are both gone (zero matches in
        # runtime-host.ts). Reach for messaging — which now also decides whether a delivery may
        # start a stopped conversation — is `withinMessagingReach`, built from `mayCommand` (a
        # static `ownerId`/`commandedBy` fixed at reservation) plus the `can_message` grant's
        # `reachesWhatItDidNotStart`; "holds open work" is not a factor anywhere in that path. Its
        # anchor is left stale, so the census records it retired.
        "M4 · 🔴 OPEN WORK alone admits a wake · a person's own conversation, and another agent's child, are woken by any caller that holds work in them — `646` §6's *\"admits exactly the agent whose end it would be undoing\"* false the moment a giver is not the parent",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** 675 made the fold ONE predicate, `theWakesFoldAdmits`, asked by the wake and by `aWakeWouldBeAsked`; The DEFECT this row plants is unchanged.
            (
                HOST,
                '    return provenance?.parentSessionId === me && holdsOpenWork()\n',
                '    return holdsOpenWork()\n',
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same redesign as M4: the fold this row
        # widened (`provenance?.parentSessionId === me` alone) no longer exists.
        # `withinMessagingReach`'s `mayCommand` check is `slot.ownerId === by.ownerId ||
        # slot.commandedBy === by.ownerId`, a static commander relationship fixed at reservation —
        # being the historical parent of a conversation the caller no longer commands (e.g. after a
        # hand-back) is not on its own sufficient, but there is no `holdsOpenWork`-gated fold left
        # for "being the parent alone" to widen into. Its anchor is left stale, so the census
        # records it retired.
        "M5 · ⛔ being the parent alone admits a wake · a child whose work is answered is woken, and ONE becomes every conversation the caller ever started",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** 675 made the fold ONE predicate, `theWakesFoldAdmits`, asked by the wake and by `aWakeWouldBeAsked`; The DEFECT this row plants is unchanged.
            (
                HOST,
                '    return provenance?.parentSessionId === me && holdsOpenWork()\n',
                '    return provenance?.parentSessionId === me\n',
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The whole TASK_IS_OPEN-gated
        # wake-admission fold (`theWakesFoldAdmits`/`whyThisCallerMayNotWakeIt`) this row anchored
        # through many prior refactors (675, 677, 681, 690, landing 45a11477) is deleted outright in
        # this commit along with `resume_agent` — confirmed by the diff removing those functions
        # wholesale. Reach for a caller's own child now runs through
        # `mayCommand`/`withinMessagingReach`, which never conditions on open work at all, so 'open
        # work must stay OPEN to admit a wake' is not a rule this build states anymore. Its anchor
        # is left stale, so the census records it retired.
        "M6 · ⛔ open work stops meaning OPEN · an answered or withdrawn task still admits the wake",
        [(HOST, "        .some((task) => task.assignedTo === sessionId && TASK_IS_OPEN[task.state])", "        .some((task) => task.assignedTo === sessionId)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same deleted subsystem as M6
        # (`theWakesFoldAdmits`'s TASK_IS_OPEN scan): gone with `resume_agent`. Reach no longer keys
        # off held work at all — a caller's own child is reachable unconditionally via `mayCommand`,
        # and a child it did not start is never reachable regardless of work — so 'work held in one
        # child admits waking any other' cannot recur in this shape. Its anchor is left stale, so
        # the census records it retired.
        "M7 · ⛔ open work anywhere admits a wake everywhere · work held in ONE child admits waking any other the caller started",
        [(HOST, "        .some((task) => task.assignedTo === sessionId && TASK_IS_OPEN[task.state])", "        .some((task) => TASK_IS_OPEN[task.state])")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The wake-only reach fallback
        # (`whyThisCallerMayNotWakeIt`'s own `aReachRefusal` call, separate from the message door's
        # own reach check) is deleted with the whole wake fold. `message_agent` now asks exactly ONE
        # reach check (`whyItIsOutOfReach`/`withinMessagingReach`) unconditionally, before any
        # running/starting/stopped branching (confirmed by reading `withinMessagingReach`, which
        # handles a running and a startable target through the same body) — the two-path divergence
        # this row measured (an admitted wake that message_agent then refuses) can no longer exist.
        # Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 reach's project boundary is not asked of a conversation that is not running · a caller a person narrowed to its own project wakes a child in another — and `message_agent` then refuses the very message the wake was for",
        [(HOST, "    return this.aReachRefusal(sessionId, by)\n  }", "    return null\n  }")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `admitTheWake` (the spawn-like
        # admission run synchronously inside the reservation window, to close a check-then-act race)
        # is deleted along with `resume_agent`/`admitWake`. A reopen of an existing conversation no
        # longer re-runs spawn-facts admission at all — there is no admission step left that needs
        # that atomicity. The new `ensureRunning`'s own docblock states the replacement design
        # directly: "It asks no rail: every rail a message meets is asked before this is called."
        # Its anchor is left stale, so the census records it retired.
        "M9 · 🔴 the rails asked BEFORE the teardown wait · two wakes in one turn, or a wake and a spawn, both read one free place and both take it — the check-then-act race the window exists to close",
        # ⚑ **ANCHOR CORRECTED IN PLACE BY 677, not retired.** The wake's `resumeSession` call gained a
        # fifth argument — `'as-its-identity-is-now'`, `R25` §1.3's *a wake reads the person's CURRENT
        # model choice* — and prettier split the call over lines, so the one-line anchor matched
        # nothing. ⛔ **The subject is untouched**: the rails are still handed in as `admit` and
        # asked after the teardown wait. The replacement keeps 677's argument and moves ONLY the
        # rails ahead of the wait, so the row measures what it always measured; re-verified RED
        # alone with `verify_row.py` against `wake-one-conversation.test.ts`.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The wake's rails are
        # still handed through as an `admit` callback and invoked synchronously right before
        # `reserve()` inside `resumeSession`, after the `settleTeardown` await and with nothing
        # awaited in between (line ~24705, comment: "a wake's rails, HERE") — same shape and same
        # reason as before, just reached now via `ensureRunning` → `startForADelivery` →
        # `resumeSession` instead of a direct `resumeSession` call from `wakeSession`. Calling
        # `admitTheWake` eagerly, before any await, recreates the exact check-then-act race the row
        # measures.
        [
            (HOST, '      await this.ensureRunning(sessionId, null, me, () => this.admitTheWake(me, sessionId, by))', '      this.admitTheWake(me, sessionId, by)\n      await this.ensureRunning(sessionId, null, me, null)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The admit?.() launch-rail callback is
        # gone along with admitTheWake. RuntimeHost.ensureRunning's own docblock now states the rule
        # directly: "It asks no rail: every rail a message meets is asked before this is called"
        # (D-017 R1) — the very defect this row protected against (skipping launch rails at a wake)
        # is now the deliberate, documented design. Its anchor is left stale, so the census records
        # it retired.
        "M10 · 🔴 the window asks nothing · every launch rail is skipped and a wake exceeds every grant a spawn cannot",
        [(HOST, "      admit?.()\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Per R1 ("a delivery's start asks no
        # launch rail", spawn-rails.ts's admitAReplacement docblock), a delivery-triggered start no
        # longer counts against profile-already-live or any spawn-admission slot at all. The
        # `this.slots.has(sessionId)` guard inside the old admitTheWake no longer exists anywhere in
        # spawn-rails.ts. Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ a slot that arrived during the wait is counted against its own wake · the second of two wakes in one turn is refused `profile-already-live` naming the conversation it asked to bring back",
        [(HOST, "    if (this.slots.has(sessionId)) return\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** theConversationAWakeResumes is gone (0
        # references). resumeSession now throws
        # SessionUnavailable('cannot-be-reopened'/'never-started', ...) directly, and
        # startForADelivery's catch either replaces it via replaceWhatCanNeverBeReopened (D-017 R10)
        # or rethrows to the classifier — there is no 'return null silently, losing the reason'
        # pattern left to plant. Its anchor is left stale, so the census records it retired.
        "M12 · ⛔ a row with nothing to resume breaks the wake instead of being answered · the reopen's own `cannot-be-reopened` never reaches the caller",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** 675 moved the row into `theConversationAWakeResumes`, which the wake and `aWakeWouldBeAsked` share; The DEFECT this row plants is unchanged.
            (
                HOST,
                '    const woken = this.theConversationAWakeResumes(sessionId)\n    if (woken === null) return\n',
                "    const woken = this.theConversationAWakeResumes(sessionId)\n    if (woken === null) throw new Error('nothing to wake')\n",
            ),
        ],
    ),
    (
        # ⚑ Landing D-017 (5206d835) · killer: `a-resume-that-needs-no-window.test.ts`.
        "M13 · 🔴 the rail judges `ask` where the reopen resumes the RECORDED mode · a child recorded `auto` is woken beside a parent a person moved back to `ask` — HO-036 through the wake",
            # ⚠️ **RE-ANCHORED at 675, not retired.** 675 moved the row into `theConversationAWakeResumes`, which the wake and `aWakeWouldBeAsked` share; The DEFECT this row plants is unchanged.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired —
        # theConversationAWakeResumes is gone, but the exact rule it enforced (a reopen must use the
        # conversation's RECORDED approval mode, not a hardcoded 'ask' — HO-036) survives unchanged
        # inside the shared RuntimeHost.resumeSession, still invoked by every delivery-triggered
        # start. HO-036 is cited live at spawn-rails.ts:1396 as still-active doctrine, so the
        # surface moved but the rule did not.
        [
            (HOST, "    const approvalMode = row.approvalMode ?? 'ask'\n", "    const approvalMode = 'ask'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The WakeRefused exception class no
        # longer exists anywhere (only the unrelated function aWakeRefused remains, a different
        # identifier). It wrapped launch-rail refusals raised by admitTheWake during a wake; since
        # no launch rail is asked at a delivery-triggered start any more (R1), there is nothing left
        # to raise WakeRefused or to catch it. Its anchor is left stale, so the census records it
        # retired.
        "M14 · ⛔ a rail's refusal escapes as a throw · every launch rail reaches the model as a broken tool rather than as its word",
        [(HOST, "      if (error instanceof WakeRefused) return error.outcome\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The restriction this row protected
        # ("only an agent wakes a conversation this way; a person reopens it") is now false by
        # design: D-017 makes a person's own message equally capable of starting a stopped
        # conversation, through the same deliverWhenItRuns/resumeSession/replacement machinery a
        # person's Reopen uses (see aPersonsStart). wakeSession, the door that drew this agent-only
        # line, is gone. Its anchor is left stale, so the census records it retired.
        "M15 · ⛔ a person's window is answered through the agent's door · a caller with no ledger is told a folded word instead of being refused the door",
        [(HOST, "    if (me === null)\n      throw new Error('only an agent wakes a conversation this way; a person reopens it')", "    if (me === null) return { ok: false, refusedBy: 'what-it-is', rail: 'no-such-agent' }")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Quoting spawn-rails.ts's
        # admitAReplacement docblock directly: "No rail is asked, and that is the ruling rather than
        # a gap ... a delivery's start asks no launch rail (R1)" — spawningEnabled is asked only
        # inside admitSpawn for an actual spawn_agent call now, never for a
        # delivery/message-triggered resume, so the kill switch was deliberately detached from
        # waking rather than forgotten. Its anchor is left stale, so the census records it retired.
        "M16 · 🔴 the kill switch does not reach a wake · a person who turned spawning off still has provider processes started by agents",
        [(RAILS, "  if (!facts.spawningEnabled()) return refuse('spawning-disabled')\n  const parent = facts.liveParent(parentSessionId)", "  const parent = facts.liveParent(parentSessionId)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same R1 ruling as M16: no launch rail,
        # including the live-parent/no-such-parent check, is asked at a delivery-triggered start.
        # admitTheWake (the function this row's liveParent check lived in) no longer exists in
        # spawn-rails.ts. Its anchor is left stale, so the census records it retired.
        "M17 · ⛔ a parent that is not running wakes anyway · a conversation on its way out, or closed, starts a child it cannot command",
        [(RAILS, "  if (parent === null) {\n    return { ...refuse('no-such-parent'), reason: A_WAKE_WITH_NO_PARENT_RUNNING }\n  }", "  if (parent === null) return null")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same R1 ruling: maxDepth is a
        # launch/spawn rail, and "a delivery's start asks no launch rail" — this depth check is no
        # longer asked when a stopped conversation is started by a message, only when spawn_agent
        # actually creates a new child. Its anchor is left stale, so the census records it retired.
        "M18 · ⛔ a depth a person narrowed does not reach a wake · off by one at the parent's own limit",
        [(RAILS, "  if (wouldSitAt > grants.maxDepth) {", "  if (wouldSitAt > grants.maxDepth + 1) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted R13a's list arm
        # (`!grants.canSpawn.includes(wanted)` is gone from spawn-rails.ts). The card: 'no can_spawn
        # / not-in-can-spawn', and any agent starts any existing profile. The subject was removed on
        # purpose. Its anchor is left stale, so the census records it retired.
        "M19 · 🔴 R13a undone on the LIST · a name a person took out of the parent's `can_spawn` is still woken",
        [(RAILS, "    !grants.canSpawn.includes(wanted) &&", "    false &&")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted `staffingAdmits` and the
        # staffing arm of R13a ('the staffing carve-out [is] gone'; can_staff unread). No wake rail
        # refuses a name, so there is no arm left to forget. Its anchor is left stale, so the census
        # records it retired.
        "M20 · 🔴 R13a's other arm forgotten · a name the parent brought into being, admitted by its staffing reach, is refused its wake",
        [(RAILS, "    !staffingAdmits(\n      grants.canStaff,\n      { holder: foldProfileName(parent.profileId), whoCreated: facts.whoCreated },\n      wanted,\n    )", "    true")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same R1 ruling: wider-than-its-parent
        # is a launch rail asked only by admitSpawn now. The wake path that used to route through
        # this check (admitTheWake) is gone, so there is no wake-time reachability of this branch to
        # protect. Its anchor is left stale, so the census records it retired.
        "M21 · 🔴 `wider-than-its-parent` does not reach a wake · a child recorded `auto` resumes beside a parent now asking, with a protection off its parent has",
        [(RAILS, "  if (itWouldAlsoRemove.length > 0) {", "  if (itWouldAlsoRemove.length > 1) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same R1 basis as M21 — a delivery/wake
        # no longer reaches the wider-than-its-parent rail at all, so the specific defect ("the wake
        # gets the SPAWN's advice") can't occur any more: there is no wake-worded sentence for this
        # rail because the rail is never asked of a wake. Its anchor is left stale, so the census
        # records it retired.
        "M22 · ⛔ the wake gets the SPAWN's advice · *send this again without that setting* — a setting a wake does not have",
        [(RAILS, "    return { ...refuse('wider-than-its-parent', detail), reason: aWakeWiderThanItsParent(detail) }", "    return refuse('wider-than-its-parent', detail)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted the per-parent
        # concurrency rail (`livingUnderIt >= grants.maxConcurrent.perParent`). The card: 'no
        # fan-out cap', and max_concurrent is an unread column. Its anchor is left stale, so the
        # census records it retired.
        "M23 · 🔴 the parent's own limit admits one more at a wake · `>=` became `>`",
        [(RAILS, "  if (livingUnderIt >= grants.maxConcurrent.perParent) {", "  if (livingUnderIt > grants.maxConcurrent.perParent) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted the app-wide concurrency
        # rail (`livingAppWide >= grants.maxConcurrent.global`) for the same reason: 'no fan-out
        # cap', with max_concurrent unread and unwritten. Its anchor is left stale, so the census
        # records it retired.
        "M24 · 🔴 the app-wide limit admits one more at a wake · `>=` became `>`",
        [(RAILS, "  if (livingAppWide >= grants.maxConcurrent.global) {", "  if (livingAppWide > grants.maxConcurrent.global) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** profile-already-live's admission check
        # (renamed `alreadyLive`, no more `theOneAlreadyLive`) lives solely inside admitSpawn, used
        # only by spawn_agent. Per R1, a delivery-triggered resume never asks it, so the specific
        # defect this row planted (an identity-already-live rail not stopping a wake) has no
        # reachable wake-time code left. Its anchor is left stale, so the census records it retired.
        "M25 · ⛔ an identity already live under this parent does not stop the wake · the parent that re-assigned ends up with two of one identity in one project — the forgetting `428` keyed this rail for",
        [(RAILS, "  if (theOneAlreadyLive !== null) {", "  if (theOneAlreadyLive === woken.sessionId) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** resume_agent's own tool `call`
        # implementation — which asked the standing wall before destructuring its single `agent`
        # argument — is deleted along with the tool (git show of the parent commit confirms this
        # exact code existed there and is absent now). message_agent has a superficially similar
        # wall-check-first line, but that is a separate, pre-existing door and not this row's
        # anchor; conflating them would mislabel the row's subject. Its anchor is left stale, so the
        # census records it retired.
        "M26 · 🔴 the standing wall is not asked first · a caller a person cut off from messaging is told about the argument it sent before it is told about the wall",
        [(TOOLS, "          const wall = host.mayReachAtAll('message', by)\n          if (wall !== null) {\n            return answer(carryMessageRefusal(wall), `refused (${wall.rail}): ${wall.reason}`)\n          }\n          const { agent } = args\n          // ⛔ **Every other key is REFUSED", "          const { agent } = args\n          // ⛔ **Every other key is REFUSED")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** resume_agent's own "every other key is
        # refused" validation (`Object.keys(args).filter((key) => key !== 'agent')`) is deleted
        # along with the tool. message_agent never had a one-argument-only shape to protect this way
        # (it always takes `agent` and `text`), so there is no equivalent construct to re-anchor
        # onto. Its anchor is left stale, so the census records it retired.
        "M27 · ⛔ words sent with a wake are dropped rather than refused · a model told `ok` believes its message went with it — `303` B's defect",
        [(TOOLS, "          const unknown = Object.keys(args).filter((key) => key !== 'agent')", "          const unknown: string[] = []")],
    ),
    (
        "M28 · 🔴 the provider's `ResumeError` is not classified · a conversation the provider lost reaches the model as a broken tool",
        [(TOOLS, "  if (error instanceof ResumeError) {\n    return {\n      rail: 'that-conversation-could-not-be-resumed',\n      because: 'the-provider-could-not-resume-it',\n    }\n  }\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Quoting the retained
        # wake-one-conversation.test.ts docblock directly: "§4 (the wake's failure words ... and a
        # conversation that can never be reopened is REPLACED now, R10)" is listed under what was
        # "Retired with the tool." In the ordinary case a conversation with no provider id
        # (never-started) is now silently replaced (R10) rather than reaching the model as a
        # refusal. The classifier code (agent-tools.ts:2553, `aWakeThatDidNotHappen`) still contains
        # a 'cannot-be-reopened' branch, but it is now reachable only through a narrow,
        # non-replaceable edge case (e.g. an adopted child, per aRowADeliveryCanStart) that no
        # current test exercises via message_agent, so there is no live killer to re-anchor on. Its
        # anchor is left stale, so the census records it retired.
        "M29 · ⛔ a conversation with no provider id is not classified · `cannot-be-reopened` reaches the model as a broken tool",
        [(TOOLS, "  if (reason === 'cannot-be-reopened') {\n    return { rail: 'that-conversation-could-not-be-resumed', because: reason }\n  }\n", "")],
    ),
    (
        "M30 · 🔴 the retry `agent-took-too-long-to-start` recommends meets an unclassified refusal · the launch it gave up on is still held, and the model is told the tool broke",
        [(TOOLS, "  if (reason === 'not-confirmed-stopped' || reason === 'still-closing') {", "  if (reason === 'still-closing') {")],
    ),
    (
        "M31 · ⛔ the second of two wakes in one turn is a broken tool · `still-opening` is not given `message_agent`'s own word for a launch in flight",
        [(TOOLS, "  if (reason === 'still-opening')\n    return { rail: 'that-conversation-has-not-started', because: reason }\n", "")],
    ),
    (
        "M32 · 🔴 a launch's own failures are not asked · a timeout, the parent's own `end_agent`, a sign-in the home cannot use — every one a broken tool at the wake though `657` gave each a word",
        # ⚑ **716 · re-anchored in place, not retired** — `716` asks the launch's classifier into a local, maps what a person must fix to the wake's word, and returns the rest; the fall-through is this `return`.
        [(TOOLS, "  return launch\n}", "  return null\n}")],
    ),
    (
        # ⚑ Landing D-017 (5206d835) · killer:
        # `a-store-that-failed-is-not-dressed-as-a-word.test.ts` (the landing added it).
        "M33 · ⛔ what is not recognised is dressed as a word · a store that failed reads as a launch that did not start (`650`'s catch-all, undone)",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The unrecognised-error
        # catch-all moved out of resume_agent's own path (gone with the tool) into message_agent's
        # AStartThatDidNotHappen handler, but the rule is unchanged:
        # `aWakeThatDidNotHappen(error.cause)` returning null must be rethrown as a broken tool,
        # never dressed up as a structured refusal. The exact `if (unwoken === null) throw
        # error.cause` guard still exists verbatim at agent-tools.ts:4464-4465, immediately after
        # `const unwoken = aWakeThatDidNotHappen(error.cause)`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a cause aWakeThatDidNotHappen does not recognise (a failed store read) is
        # rethrown as a broken tool, never dressed as a refusal. message_agent's
        # AStartThatDidNotHappen handler in agent-tools.ts still has 'if (unwoken === null) throw
        # error.cause', at a shallower indent than the old anchor. The landing added a killer for
        # this. Killed by `a-store-that-failed-is-not-dressed-as-a-word.test.ts`.
        [
            (TOOLS, '    const unwoken = aWakeThatDidNotHappen(error.cause)\n    if (unwoken === null) throw error.cause\n', "    const unwoken = aWakeThatDidNotHappen(error.cause) ?? {\n      rail: 'agent-did-not-start' as const,\n      because: 'unrecognised',\n    }\n"),
        ],
    ),
    (
        "M34 · 🔴 the host's text reaches the model · a provider's own sentence, with its ids, lands in the refusal's detail (`657` §2)",
        # ⚑ **716 · re-anchored in place, not retired** — `716` builds the wake's refusal in `aWakeRefused` (a program or a folder says which); the host's text reaching the detail is the same defect.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the host's own text (a provider's sentence with its ids) must not reach the
        # model in the wake refusal's detail. The refusal is still built by aWakeRefused in
        # message_agent's start-failed arm, and the killer of M50 asserts the raw string is absent
        # from the whole answer. Only the return line's indent changed. Killed by
        # `the-wakes-raw-words-reach-only-the-log.test.ts`.
        [
            (TOOLS, '    return refusalAnswer(aWakeRefused(unwoken, agent))', '    return refusalAnswer({\n      ...aWakeRefused(unwoken, agent),\n      detail: { agent, because: String(error) },\n    })'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The internal `{ refusedBy: 'its-reach'
        # | 'a-launch-rail' }` discriminated union that agent-tools.ts had to pattern-match and
        # re-translate is gone: `outcome.refusedBy === 'its-reach'` has zero matches anywhere in the
        # file now. Per the commit ("a refused message is refused before it waits for a start"),
        # reach is now thrown directly as a `MessagingRefused` that already carries a model-readable
        # `.rail`, and `carryMessageRefusal` copies it through unconditionally — there is no
        # internal-only tag left to leak untranslated. Its anchor is left stale, so the census
        # records it retired.
        "M35 · ⛔ a reach refusal is not carried in its own vocabulary · the project boundary reaches the model with no rail it can read",
        [(TOOLS, "            if (outcome.refusedBy === 'its-reach') {", "            if (outcome.refusedBy === 'its-reach' && agent.length < 0) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same redesign as M35:
        # `outcome.refusedBy === 'a-launch-rail'` has zero matches. Launch-rail failures now arrive
        # through `AStartThatDidNotHappen` → `aWakeThatDidNotHappen` → `aWakeRefused`, which always
        # returns an already-formed, model-readable rail; there is no longer a raw internal
        # launch-rail tag that agent-tools.ts must gate on and translate. Its anchor is left stale,
        # so the census records it retired.
        "M36 · ⛔ a launch rail's refusal is not carried in its own vocabulary · every rail reaches the model with no rail it can read",
        [(TOOLS, "            if (outcome.refusedBy === 'a-launch-rail') {", "            if (outcome.refusedBy === 'a-launch-rail' && agent.length < 0) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** D-017 rule 1, verbatim on the card: "no
        # message between agents is ever refused because the recipient isn't running. The app starts
        # it and delivers the message in order." message_agent's own docblock (agent-tools.ts, the
        # "486" and "553" notes right above `beyondItsRails: 'nothing-its-rails-do-not-cover'`)
        # explicitly keeps that value even though the door now silently starts a stopped
        # conversation, arguing the messaging rails are the whole gate. Gating that start behind the
        # R13b standing wall — what this row protects — would directly contradict the shipped
        # decision. Its anchor is left stale, so the census records it retired.
        "M37 · 🔴 R13b undone · a wake starts a provider with no card in a conversation that asks — the one verb besides a spawn that spends an account, gated by nobody",
        [(TOOLS, "      beyondItsRails: 'it-starts-something-outside-this-app',\n      input: {\n        agent: z", "      beyondItsRails: 'nothing-its-rails-do-not-cover',\n      input: {\n        agent: z")],
    ),
    (
        "M38 · ⛔ a stop in flight is priced as final · the model is told the same call will never work, about a state that clears with nobody acting",
        [(TOOLS, "  'that-conversation-is-still-stopping': 'while-this-holds',", "  'that-conversation-is-still-stopping': 'permanent',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `'that-conversation-is-running'` has
        # zero matches anywhere in agent-tools.ts now. There is no more special "this conversation
        # is already running, retry the wake" refusal at all: a message to a running conversation is
        # simply delivered (or held behind its current turn), so the permanence table entry this row
        # mispriced no longer exists to mis-price. Its anchor is left stale, so the census records
        # it retired.
        "M39 · ⛔ *already running* is priced as a wait · the model is told to retry a wake that will never happen, instead of messaging the conversation",
        [(TOOLS, "  'that-conversation-is-running': 'permanent',", "  'that-conversation-is-running': 'while-this-holds',")],
    ),
    (
        "M40 · ⛔ a conversation the provider could not bring back is priced as never · the model is told never to retry a wake a person's fix would let through (review; since `673` an expired sign-in is not among them — it gets the sign-in word)",
        [(TOOLS, "  'that-conversation-could-not-be-resumed': 'until-a-person-changes-it',", "  'that-conversation-could-not-be-resumed': 'permanent',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** resume_agent's own "woke
        # ${outcome.sessionId}" answer shape is gone with the tool. message_agent's success answer
        # always echoes back the caller-supplied `agent` argument (`{ outcome: 'ok', delivery: ...,
        # agent, kind: says, ... }`, agent-tools.ts ~4394-4410) by construction — there is no
        # separate `outcome.sessionId`-derived field a wake response could drop, so "a parent that
        # woke two cannot tell which answered" has no surface left to plant. Its anchor is left
        # stale, so the census records it retired.
        "M41 · ⛔ the answer drops the id it woke · a parent that woke two cannot tell which answered",
        [(TOOLS, "                { outcome: 'ok', agent: outcome.sessionId },\n                `woke ${outcome.sessionId}.", "                { outcome: 'ok' },\n                `woke ${outcome.sessionId}.")],
    ),
    (
        "M42 · 🔴 the description stops naming the KIND that continues the work · a model re-sends the task as work and is refused `agent-already-has-work-open`, which §1.1 met first",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The
        # `agent-already-has-work-open` remedy sentence was reworded but keeps the same defect
        # surface: it still names the KIND that continues the work ("as a follow-up"), and
        # `a-refusal-carries-its-remedy.test.ts` §4 asserts `refused.reason).toContain('as a
        # follow-up')` against exactly this sentence. Dropping that clause reproduces M42's original
        # defect — a model told only to "send this again" with no kind named, which would re-open
        # the loop into `agent-already-has-work-open`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The label (the description stops naming the KIND that continues the work) lost its anchor
        # agent-already-has-work-open, but the rule survives in spawn-rails.ts: the
        # its-work-has-stalled sentence tells the giver 'Follow up <labels> with message_agent (kind
        # follow-up, naming the ...'. Plant: delete 'kind follow-up, ' from that sentence. Killers:
        # a-question-is-not-work.test.ts asserts expect(sentence).toContain('kind follow-up') and
        # a-refusal-carries-its-remedy.test.ts asserts expect(refused.reason).toContain('kind
        # follow-up'). Killed by `a-question-is-not-work.test.ts`,
        # `a-refusal-carries-its-remedy.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece, so the same defect lands on that answer. NOT VERIFIED
            (RAILS, "message_agent (kind follow-up), or take", "message_agent, or take"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `aReachRefusal`/`whatAMessageWouldMeet`
        # and the old two-branch wakeSession (a RUNNING id answered directly, a stopped id answered
        # through message_agent's own checks) are gone. message_agent's reach and project-boundary
        # checks (`whyItIsOutOfReach`, `assertMayReach`, `assertMayAssign`) are now asked once,
        # unconditionally, for every target whether it is running or not — an already-running
        # conversation gets exactly the same checks as one this door has to start, so there is no
        # more "RUNNING is answered without the second question" branch to break. Its anchor is left
        # stale, so the census records it retired.
        "M43 · 🔴 a RUNNING conversation is answered *running* without `message_agent`'s second question · a child its commander placed in another project is pointed at `message_agent`, which refuses it `message-outside-your-project` — `402` (review)",
        # ⚑ **RE-ANCHORED at 690, not retired**: the running arm asks what a message would meet
        # after reach (`675` F-a), so its return spans lines; the row still drops the reach question.
        [(HOST, "          this.aReachRefusal(sessionId, by) ?? (await this.whatAMessageWouldMeet(slot.session))\n", "          await this.whatAMessageWouldMeet(slot.session)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `onItsWayOut`/`settleTeardown` gating
        # before a reach answer is gone from the wake path;
        # `whyItIsOutOfReach`/`withinMessagingReach` now read the slot (which still exists, with its
        # static `ownerId`/`commandedBy`, while a conversation is tearing down) or the stored row
        # synchronously, with no async wait required at all. There is no longer a "no-such-agent
        # answered before teardown settles" race for this row's edit to defeat. Its anchor is left
        # stale, so the census records it retired.
        "M44 · 🔴 a listed conversation on its way out is refused at once · `no-such-agent` about an id `list_agents` still names — PM Ruling 1 broken for exactly the window it draws as *ending* (review, both rounds)",
        [(HOST, "      if (onItsWayOut) await this.settleTeardown(sessionId)\n", "")],
    ),
    (
        # ⚠️ Landing D-017 (5206d835) · a KNOWN SURVIVOR: the second pre-start check only differs
        # from the first for a message queued behind another to a conversation still not running,
        # and no test can hold it there without a stall. Kept so the rule stays written down.
        "M45 · 🔴 the window does not ask the fold and reach again · a person narrows the caller inside a teardown wait and the wake starts a provider anyway (review)",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The rule — a message
        # waiting its turn must have its rails re-asked once it is actually about to start a
        # provider, not just on arrival — survives in `RuntimeHost.deliverWhenItRuns`:
        # `refuseBeforeAStart` is asked once in `onArrival` and again inside
        # `afterWhatArrivedFirst`'s callback right before `ensureRunning`. Dropping the second call
        # reproduces the original defect: a caller narrowed (or otherwise disqualified) while its
        # message waited in line would start a provider anyway.
        [
            (HOST, '      await this.refuseBeforeAStart(to, text, by, attachments, says)\n      const waker = sessionSpeakingAs(by)', '      const waker = sessionSpeakingAs(by)'),
        ],
    ),
    (
        "M46 · ⛔ the caller's own id is pointed at `message_agent` · which refuses exactly that id `that-agent-is-you` (review) · killed by `the-wake-says-only-what-is-true.test.ts` (named by W4.154)",
        # ⚑ **RE-ANCHORED at 690, not retired**: the self-wake says a wake's sentence now (`675`
        # F-h), so the check is a block; the row still removes it whole.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The self-message check
        # moved into message_agent's own handler (its wake-specific `A_WAKE_OF_ITSELF` reason
        # override went, since it is no longer wake-only) but the guard is identical in shape: `if
        # (agent === me) { return refusalAnswer(refuseTool('that-agent-is-you', { agent })) }` at
        # agent-tools.ts:4281-4283, unique in the file. Removing it lets a self-targeted call fall
        # through to the host's own gate and come back as a different, less specific refusal.
        [
            # ⚑ **W4.150 · re-anchored in place, not retired** — F091 widened the self check to a conversation the caller took the place of; the plant still removes the whole check, so a self-targeted call falls through to the host's own gate
            (TOOLS, "          if (agent === me || host.tookItsPlace(agent) === me) {\n            return selfRefusal(spelled, agent)\n          }\n", ''),
        ],
    ),
    (
        # ⚑ Landing D-017 (5206d835) · killer: `the-folder-it-ran-in-is-gone.test.ts`
        # (`message_agent` hands the wake refusal its `cause`).
        "M47 · 🔴 the classifier reads the error and never its cause · every `SessionUnavailable` a wake meets arrives translated for a person with the original as `cause`, so `still-opening`, `not-confirmed-stopped` and `cannot-be-reopened` all become broken tools (review)",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The exact
        # `unavailableOf(error) ?? (error instanceof Error ? unavailableOf(cause) : null)` pattern
        # still exists verbatim inside `aWakeThatDidNotHappen`, feeding the same `reason` variable
        # used for `cannot-be-reopened`/`never-started`, `not-confirmed-stopped`/`still-closing` and
        # `still-opening`. I could not confirm from static reading alone that any currently shipped
        # test forces the value through the second (`.cause`) term rather than the first — every
        # concrete throw site I traced (`reserve`, `aFolderThatIsGoneAsARefusal`, `reopenSession`)
        # throws `SessionUnavailable` as the top-level error, which the first term already catches —
        # so this row's real-world killer needs confirming on an actual run rather than by
        # inspection.
        [
            (TOOLS, "  const reason =\n    unavailableOf(error) ??\n    (error instanceof Error ? unavailableOf((error as { cause?: unknown }).cause) : null)\n  if (reason === 'cannot-be-reopened' || reason === 'never-started') {", "  const reason =\n    unavailableOf(error) ??\n    null\n  if (reason === 'cannot-be-reopened' || reason === 'never-started') {"),
        ],
    ),
    (
        "M48 · ⛔ a stop in flight carries no act · the retryable word with nothing to do, which the biconditional forbids (review)",
        [(TOOLS, "  'that-conversation-is-still-stopping': 'make-the-same-call-when-this-settles',", "  'that-conversation-is-still-stopping': null,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The sentence this row targeted ("so
        # there was nothing to wake and nothing was done to it. message_agent reaches it.") belonged
        # to the now-gone `that-conversation-is-running` refusal — there is no more "already
        # running, use message_agent instead" branch to word (see M39). Grepping agent-tools.ts for
        # any fragment of that sentence returns nothing. Its anchor is left stale, so the census
        # records it retired.
        "M49 · ⛔ *already running* stops naming the door that reaches it · the model is told a wake was refused and not what to do instead (review)",
        [(TOOLS, "so there was nothing to wake and nothing was done to it. message_agent reaches it.", "so there was nothing to wake and nothing was done to it.")],
    ),
    (
        # ⚑ Landing D-017 (5206d835) · killer: `the-wakes-raw-words-reach-only-the-log.test.ts` (the
        # landing added it).
        "M50 · ⛔ the host's own words are written nowhere · kept out of the model's answer and out of the log both — `657` M22's edit on this door (review)",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The
        # `resume_agent`-specific log line is gone with the tool, but the equivalent diagnostic log
        # for message_agent's own wake-start failure survives at agent-tools.ts:4466-4470
        # (`console.warn(\`message_agent: the start did not happen (${unwoken.because}): ...\`)`),
        # directly after the M33 guard. The same defect — silencing the log by swapping
        # `console.warn(` for `String(` — still applies; I could not find an existing test that
        # asserts on the spy's call content (only tests that mock console.warn as a no-op without
        # checking calls), so confidence on the killer is lower and should be confirmed on a run.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the provider's raw words go to the log with console.warn and never to the model.
        # The warn line in message_agent's start-failed arm now reads 'the start did not happen'
        # with the tool name interpolated. The killer the landing added spies on console.warn and
        # asserts the call carries the raw text. Killed by
        # `the-wakes-raw-words-reach-only-the-log.test.ts`.
        [
            (TOOLS, '    console.warn(\n      `${tool}: the start did not happen', '    String(\n      `${tool}: the start did not happen'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `aWakeTooDeep` and `admitWake` no
        # longer exist in spawn-rails.ts. The new `admitAReplacement` (spawn-rails.ts, D-017 · R10)
        # says so explicitly in its own docblock: "No rail is asked, and that is the ruling rather
        # than a gap... a delivery's start asks no launch rail (R1)." A wake/replacement no longer
        # goes through spawn-rails' too-deep check at all, so there is no wake-specific
        # `aWakeTooDeep` sentence left to swap out for the spawn's own. Its anchor is left stale, so
        # the census records it retired.
        "M51 · ⛔ `too-deep` at a wake gives the spawn's advice · *ask the conversation that started you* — which the wake's own fold refuses (review)",
        [(RAILS, "    return { ...refuse('too-deep', detail), reason: aWakeTooDeep(detail) }", "    return refuse('too-deep', detail)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same ruling as M51:
        # `A_WAKE_WITH_NO_PARENT_RUNNING` no longer exists in spawn-rails.ts, and
        # `admitAReplacement`'s docblock states no rail — including `no-such-parent` — is asked when
        # a delivery starts or replaces a conversation. There is no wake-specific `no-such-parent`
        # sentence left for this row's edit to defeat. Its anchor is left stale, so the census
        # records it retired.
        "M52 · ⛔ `no-such-parent` at a wake names a spawn · *this spawn's parent*, said to a caller that asked for no spawn (review)",
        [(RAILS, "    return { ...refuse('no-such-parent'), reason: A_WAKE_WITH_NO_PARENT_RUNNING }", "    return refuse('no-such-parent')")],
    ),
    (
        "M53 · ⛔ *could not be resumed* loses the clause that sends the model to a person · it reads as *never*, the pricing round two withdrew (review)",
        # ⚑ **716 · re-anchored in place, not retired** — `716`'s two wake sentences share the clause, so the anchor names the one sentence it is about.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The rule (a 'could not be
        # resumed' sentence must keep the clause that sends the model to a person, not read as
        # 'never') still holds; the OLD sentence tied to `resume_agent`'s wording moved into the
        # general `that-conversation-could-not-be-resumed` sentence in TOOL_REFUSALS, now worded
        # 'Sending again' (message-triggered start) instead of 'Waking it again', with an added 'or
        # could not be started' clause. It is still reachable (e.g. a generic ResumeError /
        # sign-in-style failure at a message-triggered start) and is still asserted against by the
        # ACT census.
        [
            (TOOLS, "    'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: its provider may need signing in again, or could not be started.',", "    'that conversation could not be started again, so nothing was sent. Sending again will not help: its provider may need signing in again, or could not be started.',"),
        ],
    ),
    (
        "M54 · ⛔ *still stopping* gives the state and not the rule · a model told only *not yet* reaches for another way in, and there is none that is safe (review)",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
            (
                TOOLS,
                "Make the same call again in a moment: two runs of one conversation must never overlap.',",
                "Make the same call again in a moment.',",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** This is `resume_agent`'s own success
        # sentence ('woke ... Nothing from you was sent to it'), and the commit's own words are
        # explicit: "end_agent and resume_agent are gone (21 tools)." message_agent's own success
        # sentences ('...has been sent it straight away as...' / 'held for ... as ...') never claim
        # a started conversation was sent nothing, so there is no equivalent false claim left for
        # this row to guard. Its anchor is left stale, so the census records it retired.
        "M55 · 🔴 the answer claims the woken conversation was sent NOTHING · false for one that gave out work, which the app tells about that work as it comes back (review, round two)",
        [(TOOLS, "`woke ${outcome.sessionId}. Nothing from you was sent to it;", "`woke ${outcome.sessionId}. It is idle and has been sent nothing;")],
    ),
]
