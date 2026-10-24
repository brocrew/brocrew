"""428 · the rail, keyed to the parent that forgot — each row is THE DEFECT, put back (131).

🔴 **HO-023 §4:** *"**Key it to parent + identity.** A parent spawning an identity it already has
live is refused — that is the forgetting. **Two different parents, in the same project or different
ones, is demand.**"*

⛔ **Until this dispatch the rail was keyed to NOTHING.** `liveSessionAs(profileSlug)` scanned every
live slot in the host with no owner, project, parent or entitlement clause — so a conversation a
PERSON opened refused an agent's spawn, and one parent's child refused another parent's. `426` built
the harness that made each of those an executed assertion of the wrong answer, and `422` measured the
consequence at the payload: *"`profile-already-live` names a session the caller may not reach, and
its remedy answers `no-such-agent`."*

## ⚠️ The hazard these rows are written against

⛔ **`a-comparison-tested-where-both-sides-agree-measures-nothing`, which the brief named as the
direct one.** A row that swaps one parent for another parent in the same project measures nothing
unless the key really is the parent — and, worse, **a key on *was this spawned by an agent at all*
gives the same answer as the correct key everywhere a person is the blocker.** ⚑ **`M2` and `M4` are
that pair, built so the two readings DIVERGE:** `M2` keeps every agent-spawned conversation blocking
every parent, `M4` keeps every person's conversation blocking, and each is killed by the half of
HO-023 §4 the other satisfies.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M5` | ⚑ **`run_suite`** — `the-five-tools.test.ts` §3/§3.1, `the-rails-before-anything-can-reach-them.test.ts` §1, `two-sessions-of-one-agent.demo.test.ts` §3/§4, `an-identity-that-outlives-a-project.test.ts` §5 |
| `M6`–`M7` | ⚑ **`run_suite`** — `two-sessions-of-one-agent.demo.test.ts` §3, which pins the sentence a model is handed, word for word |

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row putting `profile-already-live` back to `while-this-holds`.** That is `424` `M8`, it still
applies, and it was re-run RED against this tree — `428` §4 re-asked the question and left the word
where `424` put it, so a second copy of that row would measure `424`'s decision twice and this
dispatch's not at all.

⛔ **No row on the reservation's own `spawnedBy`, or on the resume that re-derives it.** Those are
`341` `M-` and `373` `M2`, and both are `428`'s dependencies rather than its decisions. ⚑ **`373`
`M2` gained a second killer here** — the reopen test in `the-five-tools.test.ts` §3, which is red
without the derivation because a restart would otherwise be the way round a parent's own rail.

⛔ **No row on the identity fold inside the scan.** `341` `M-` anchors that exact line and the line
did not move; adding the parent clause above it changed which slots are asked, not how a slug is
compared.

⛔ **No row adding a remedy to this rail.** The act is real now and writing it would break HO-024
criterion 30's biconditional — which is `425`'s partition and a finding in `428`'s response, not a
mutation.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"

THE_KEY = "          if (slot.spawnedBy !== parentSessionId) return false"
# ⚑ ANCHOR CORRECTED IN PLACE BY 459 — the call took a third argument (the project the child will
# land in, HO-027 §2.1). The row below still swaps the first two, which is still the defect it names.
THE_CALL = "  const alreadyLive = facts.liveChildAs(parent.sessionId, asked.profileId, projectSlug)"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── the key itself ─────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the parent clause is gone and the scan is app-wide again, so "
        "one identity may hold ONE live conversation anywhere in the app: a person talking to "
        "`worker` refuses every agent that asks for it, and a second parent is refused for a "
        "conversation it did not open and — `422` measured — cannot reach",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The parent clause is
        # still the whole of HO-023 §4's key; only its shape moved. D-017 R10 generalised the single
        # `parentSessionId` comparison into a `parents` set via `theIdsItStandsFor`, so the anchor
        # is `if (slot.spawnedBy === null || !parents.has(slot.spawnedBy)) return false` now.
        # Deleting it re-opens the app-wide scan the row names.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — HO-023 section
        # 4's rule (a give finds only a conversation the SAME giver started, never a person's or
        # another giver's) survives as `helperAs` in runtime-host.ts, where the parent clause is now
        # `slot.spawnedBy === null || !theirs.has(slot.spawnedBy)`. Deleting it makes the scan
        # app-wide again, so a person's conversation of the identity or a second giver's is found
        # and reached. Killed by `the-five-tools.test.ts`,
        # `the-rails-before-anything-can-reach-them.test.ts`,
        # `two-sessions-of-one-agent.demo.test.ts`, `an-identity-that-outlives-a-project.test.ts`.
        [
            (HOST, '      if (slot.spawnedBy === null || !theirs.has(slot.spawnedBy)) return false\n', ''),
        ],
    ),
    (
        "M2 · ⛔ keyed on *was this spawned by an AGENT* instead of on WHICH parent · the half-fix "
        "that passes every person-blocker case in the tree and answers HO-023 §4 backwards: two "
        "different parents asking for one identity is demand, and this makes the second one wait on "
        "a child it has no way to reach or end",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same reshaped anchor as
        # M1. Dropping only the `!parents.has(...)` half (keeping the null check) reproduces 'keyed
        # on was this spawned by an agent at all', which blocks every parent by any agent-spawned
        # conversation of that identity rather than only this parent's.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # (keyed on WHICH giver, not on 'was this started by an agent') survives in `helperAs`: the
        # parent clause is still `!theirs.has(slot.spawnedBy)`. The plant keeps only the null-parent
        # test, so a person's conversation is skipped but another giver's conversation of the
        # identity is found and reached. Killed by `the-five-tools.test.ts`,
        # `the-rails-before-anything-can-reach-them.test.ts`,
        # `two-sessions-of-one-agent.demo.test.ts`.
        [
            (HOST, '      if (slot.spawnedBy === null || !theirs.has(slot.spawnedBy)) return false', '      if (slot.spawnedBy === null) return false'),
        ],
    ),
    (
        "M3 · ⚠️ the parent clause REPLACES the identity clause instead of joining it · the shape a "
        "conjunct arrives in when the old one is lost with it — a parent that already has ANY live "
        "child is refused every other identity, which is `too-many-for-this-parent`'s job done by "
        "the wrong rail and with `maxConcurrent` ignored. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 459: the identity comparison became an early return when "
        "the project clause joined it below — the defect this row names is unchanged",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — 459 already corrected
        # this anchor in place once (identity check became an early return once the project clause
        # joined below); the defect — the parent clause swallowing the identity+project checks
        # instead of joining them — is unchanged. Today's block is the parent line, the identity
        # check, and the project check together; replacing everything after the parent line with
        # `return true` reproduces the same over-admission.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — `liveChildAs` still has
        # the parent clause then the identity clause, but D-016 removed the project clause, so the
        # old four-line anchor is gone. Replacing the identity comparison with `return true` keeps
        # the defect: a parent with any live child is refused every other identity. The
        # `other-worker` spawn beside a live `worker` child then comes back refused.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # parent clause joins the identity clause and never replaces it) survives: `helperAs` still
        # filters on parent first and then on the folded profile identity. The plant returns true in
        # place of the identity comparison, so a giver that holds any live child finds it for every
        # other identity. Killed by `the-five-tools.test.ts`,
        # `the-rails-before-anything-can-reach-them.test.ts`,
        # `two-sessions-of-one-agent.demo.test.ts`.
        [
            (HOST, '      const identity = slot.profileId ?? slot.session?.profileId ?? null\n      return identity !== null && foldProfileName(identity) === wanted\n', '      return true\n'),
        ],
    ),
    (
        "M4 · 🔴 a person's conversation keeps blocking · the other half-fix, and the one that "
        "preserves the exact defect `428` §3 exists to close: the blocker is again a conversation "
        "the caller may neither message nor end, so the id in the payload goes back to being a lie "
        "about entitlement in the one door whose payload is allowed to carry an id",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same reshaped anchor as
        # M1/M2. The mutation keeps root/person-started conversations (`spawnedBy === null`) as
        # candidate blockers instead of excluding them, while still excluding other parents'
        # children — the De Morgan-equivalent of the original row's swap — so a person's own
        # conversation of an identity blocks every agent's spawn of it again.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # person's conversation must never be the blocker or the one a give reaches) survives in
        # `helperAs`. The plant keeps a null-parent conversation, so a person's conversation of the
        # identity is found again, the exact defect 428 section 3 closes. Killed by
        # `the-five-tools.test.ts`, `the-rails-before-anything-can-reach-them.test.ts`,
        # `two-sessions-of-one-agent.demo.test.ts`, `an-identity-that-outlives-a-project.test.ts`.
        [
            (HOST, '      if (slot.spawnedBy === null || !theirs.has(slot.spawnedBy)) return false', '      if (slot.spawnedBy !== null && !theirs.has(slot.spawnedBy)) return false'),
        ],
    ),
    (
        "M5 · ⛔ the two arguments swapped · a parent asked about by identity and an identity asked "
        "about by session id — the rail then matches nothing ever, so a parent may open the same "
        "worker as many times as it likes and HO-005 §3 is deleted rather than re-keyed. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 459: the call took a third argument, and the REPLACEMENT "
        "moved with it — dropping the third would have been a type error rather than the swap this "
        "row measures, which is the blind spot `366` found in a row's NEW side",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The call in
        # spawn-rails.ts lost its third argument (projectSlug) in D-016 and is now
        # `facts.liveChildAs(parent.sessionId, asked.profileId)`. Swapping the two arguments keeps
        # the label's defect. It is a swap of two strings, so there is no signature change and no
        # TypeError, and the rail matches nothing.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # giver's own child of one identity is looked up by giver then identity) survives as
        # `facts.helperAs(giving.sessionId, asked.profile)` in `admitGive`. The two arguments are
        # both strings, so the swap throws nothing (foldProfileName is a plain lowercase) and the
        # lookup matches nothing, so every give starts a new conversation and HO-005 section 3 is
        # lost. Killed by `the-five-tools.test.ts`, `two-sessions-of-one-agent.demo.test.ts`,
        # `an-identity-that-outlives-a-project.test.ts`.
        [
            # ⚑ **parallel-workers · re-anchored in place, not retired** — Parallel-worker selection moves or repeats this text. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
            (RAILS, "  const worker = facts.workerAt?.(\n    giving.sessionId,\n    asked.profile,\n    asked.parallel === true && asked.new !== true,\n    provider ?? undefined,\n  )\n  if (worker?.is === 'full') return no('no-free-worker-at-capacity', { profileId: asked.profile })\n  if (worker?.is === 'unknown') return no('worker-binding-is-unknown', { profileId: asked.profile })\n  const found =\n    worker?.is === 'known'\n      ? worker.conversation\n      : facts.helperAs(giving.sessionId, asked.profile, provider ?? undefined)\n", "  const worker = facts.workerAt?.(\n    asked.profile,\n    giving.sessionId,\n    asked.parallel === true && asked.new !== true,\n    provider ?? undefined,\n  )\n  if (worker?.is === 'full') return no('no-free-worker-at-capacity', { profileId: asked.profile })\n  if (worker?.is === 'unknown') return no('worker-binding-is-unknown', { profileId: asked.profile })\n  const found =\n    worker?.is === 'known'\n      ? worker.conversation\n      : facts.helperAs(asked.profile, giving.sessionId, provider ?? undefined)\n"),
        ],
    ),
    # ── what the model is told ─────────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 the sentence promises a retry again · the clause `424` deleted, restored on top of "
        "`428`'s key — a model told to come back, over a blocker that is its OWN child and will sit "
        "idle for ever unless this very model does something about it",
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1), and narrowed after 675’s review so it plants only its own defect; The DEFECT this row plants is unchanged.
                # ⚑ **710 · re-anchored in place, not retired** — `710` R53 named the wake's identity on this line; the row still restores the retry clause `424` deleted.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — 675 already reshaped this
        # anchor once (reordered the sentence, dropped the stale `detail.named ??` alternation); the
        # defect — restoring a false retry promise over a blocker that is the caller's own idle
        # child — is unchanged and the current sentence still ends '...Starting a different agent is
        # the other way; waiting is not.' immediately after 'drive. It is “...”.'
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds. The rule is that the sentence for a blocker that is the caller's OWN
        # idle child must not promise that retrying or waiting will work. Such a child sits idle
        # until the caller acts. Today that blocker is a stalled helper piece, refused as
        # its-work-has-stalled, and its sentence says to follow up or take back and nothing about
        # waiting. The plant restores the false promise by appending 'Or try again once it has
        # finished.' The current sentence has no 'waiting is not' clause to swap, so the plant
        # appends. NO existing test asserts that this sentence promises no retry: the
        # act-inside-the-cut census only checks the act appears early, a-question-is-not-work
        # asserts contains-checks only, and a-refusal-carries-its-remedy checks PERMANENCE_SAID for
        # the person's notice, not the model's sentence. MISSING TEST (add to
        # a-question-is-not-work.test.ts section 2, next to the sentence test). It builds
        # refuseSpawn('its-work-has-stalled', {profileId:'worker', stalled:['W1.1']}) and the
        # two-label arm. It asserts each reason contains 'withdraw_task' and does NOT match /try
        # again|once it has finished|wait/i. Paired positive: the same regex DOES match a rail whose
        # sentence is meant to promise a retry (for example 'Make the same call again in a moment'
        # from the act-inside-the-cut census), so the regex is shown able to see a retry promise. ⚠️
        # No test kills it yet: the landing owes one (D-016b part 2).
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — describeRail's
        # 'its-work-has-stalled' act is only ever checked with toContain, so a promise to retry
        # appended to it goes unseen; the plant adds 'Or try again once it has finished.', which is
        # false because a stalled piece never finishes by waiting. A pure describeRail test with two
        # stalled labels asserts that the act names both labels, message_agent and withdraw_task,
        # and that no sentence promises a retry or a wait. A paired positive runs the same regex
        # over a known retry-promising sentence so the regex is shown to see one. The plant fails on
        # the assertion that no retry is promised. Killed by
        # `the-survivors-the-tree-landing-left.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece, so the same defect lands on that answer. NOT VERIFIED
            (RAILS, "or take ${them} back with withdraw_task.`", "or take ${them} back with withdraw_task. Or try again once it has finished.`"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the withdrawn
        # hedge 'which may not be yours to do' inside the `profile-already-live` sentence, and that
        # sentence went with the rail and `spawn_agent`. The two-sessions demo test records it: the
        # case about the sentence's advertised remedy ('message the blocker') 'went with the
        # sentence'. Its anchor is left stale, so the census records it retired.
        "M7 · ⚠️ the withdrawn hedge comes back · *\"which may not be yours to do\"* was honest while "
        "the blocker could be anybody's and is false the moment the rail is keyed to the parent — a "
        "caller told it may not be able to act on the one conversation it certainly can, which is "
        "the `425`-shaped defect pointing the other way",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1), and narrowed after 675’s review so it plants only its own defect; The DEFECT this row plants is unchanged.
            (
                RAILS,
                "'it this work, or ask what it is doing: it is a conversation you started, and yours to ' +",
                "'it this work, or ask what it is doing: it is a conversation which may not be yours to ' +",
            ),
        ],
    ),
]
