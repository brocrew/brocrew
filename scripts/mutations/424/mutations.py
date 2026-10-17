"""424 · two rulings made true — each row is THE DEFECT, put back (131).

🔴 **Both halves of this dispatch are rulings the PO made and the product then contradicted.** §A is
HO-023 §3 — *"BroBot's session always runs in BroBot's workspace, never a project folder, because
BroBot is in no project"* — which `420` §0 measured running in the PINNED PROJECT'S folder. §B is
HO-023 §2.1 — *"`retryable: true` must name something a model can do without destroying anyone's
work… either the refusal carries a legitimate remedy, or its permanence is wrong"* — of which `422`
measured **12 of 21 `while-this-holds` rails clearing only by destruction or by a door the caller
cannot reach.**

## ⛔ §A · the shape of the fix, and therefore the shape of these rows

⚑ **The discriminant is the IDENTITY**: a conversation with BroBot inherits no project's folder;
every other identity inherits the folder of the project it is placed in. ⛔ *"BroBot is in no
project"* is not representable (`417` §1.5: `agent_profile.project_id` is `NOT NULL`), so the ruling
is implemented as the narrower thing that is true — and `M4` is the other candidate discriminant,
keyed on the REQUEST, built so the reason it was rejected is measured rather than argued.

## ⛔ §B · why a permanence row needs care, and what these rows do about it

⚠️ **`a-true-mutation-measures-nothing` applies hard here.** A row that swaps one honest permanence
for another honest one measures nothing — both are non-retryable and both tell a model to stop. ⛔
**So every row in §B replaces the word with `while-this-holds`, which is the FALSE PROMISE coming
back**, and the killer is an assertion about what a model is told to do next.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M5` | ⚑ **`run_suite`** — `apps/desktop/test/where-brobots-own-conversation-runs.test.ts` |
| `M6`–`M17` | ⚑ **`run_suite`** — `what-an-agent-is-told-about-its-work.test.ts` §3's retryable roster, plus each rail's own behavioural drive |
| `M18`–`M22` | ⚑ **`run_suite`** — the sentence and the split, at the door that emits them |

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row narrowing `DOCUMENT_PERMANENCE`'s type back to two words.** That is a compile error and
not a mutation: `DocumentRefusal.permanence` is the shared `RailPermanence` now, and the row would
never reach a test.

⛔ **No row on where a BroBot in the workspace may start its children.** There was a bound —
`narrowsInto`, HO-010 ruling 4 — and `726` · R92 removed it;
`where-brobots-own-conversation-runs.test.ts` §3 now measures a child of BroBot started in the
project folder.

⛔ **No row making the identity comparison case-insensitive.** `Default` never reaches it —
`assertProfileMayBeCreated` refuses a spelling that is an existing profile in another case — so the
replacement could change no answer this app can produce and would report as a survivor.

⛔ **No row on the ledger row's own fields.** `405` owns the quartet, and `424` changed what two of
them SAY rather than whether they are carried.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"
QUESTION = "apps/desktop/src/main/runtime/question-rails.ts"
INTERRUPT = "apps/desktop/src/main/runtime/interrupt-rails.ts"
DOCUMENT = "apps/desktop/src/main/documents/canonical-document.ts"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · where BroBot's own conversation runs ──────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 removed the subject: a
        # conversation inheriting a project's folder. The commit removes 'project folders and their
        # rails', and its diff deletes both `projectCwd` and `projectFolderFor`, so the anchor
        # `profileId === DEFAULT_PROFILE_ID ? undefined : this.projectCwd(projectSlug)` is gone.
        # `startSessionInProfile` is now `this.deps.resolveCwd(id, input.cwd)`, and no launch
        # inherits a folder, whichever identity it is. Its anchor is left stale, so the census
        # records it retired.
        "M1 · 🔴 THE DEFECT, verbatim · every conversation inherits the project's folder again, so "
        "the app's own conversation runs wherever a person typed on the project sheet — HO-023 §3 "
        "*\"never a project folder\"* reduced to *\"unless somebody fills that field\"*, which is "
        "exactly the state `420` §0 measured and two gestures away on a surface that ships",
        [(HOST, "    return profileId === DEFAULT_PROFILE_ID ? undefined : this.projectCwd(projectSlug)",
          "    return this.projectCwd(projectSlug)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The discriminant (BroBot does not
        # inherit a project folder, everyone else does) went with `projectFolderFor` and
        # `projectCwd`, which bd70d693 deletes under 'project folders and their rails'. There is no
        # inheritance left for the identity comparison to invert. The test file records it: 'D-016:
        # the two readings no longer differ — no project folder'. Its anchor is left stale, so the
        # census records it retired.
        "M2 · ⛔ the discriminant INVERTED · BroBot inherits and nobody else does, so the one "
        "identity the ruling protects is the one that lands in a repository and every placed "
        "conversation loses the folder its project names — HO-009 §5.1 deleted and HO-023 §3 broken "
        "in one line",
        [(HOST, "    return profileId === DEFAULT_PROFILE_ID ? undefined : this.projectCwd(projectSlug)",
          "    return profileId === DEFAULT_PROFILE_ID ? this.projectCwd(projectSlug) : undefined")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** 'Nothing inherits a folder' is now the
        # code, not a defect. D-016 removed project folders ('project folders and their rails … are
        # removed'), so replacing the inheritance with `return undefined` deletes a function that no
        # longer exists. `project.cwd` is no longer stored or displayed either. Its anchor is left
        # stale, so the census records it retired.
        "M3 · ⚠️ NOTHING inherits a folder · the cheap way to make §A's assertions pass, and it "
        "deletes HO-009 §5.1 — *\"Default: `project.cwd`. The project is the scope; this is why that "
        "column exists\"* — leaving `project.cwd` stored, displayed and ignored by launch again, "
        "which is the defect `371` was written to close",
        [(HOST, "    return profileId === DEFAULT_PROFILE_ID ? undefined : this.projectCwd(projectSlug)",
          "    return undefined")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The candidate discriminant it priced,
        # 'nobody named a project', was keyed on `input.projectSlug` and `projectCwd`. Both went
        # with D-016's removal of project folders, and the launcher no longer sends `projectSlug`.
        # The anchor `input.cwd ?? this.projectFolderFor(profileId, projectSlug)` is gone. Its
        # anchor is left stale, so the census records it retired.
        "M4 · 🔴 keyed on the REQUEST instead of the identity · *\"nobody named a project\"* is the "
        "other candidate discriminant, and this row is why it was rejected: the launcher sends "
        "`projectSlug` on EVERY launch (*\"always sent, never omitted\"*), so the ruling goes on "
        "being false for every conversation a person can start today and becomes true only in a "
        "world where that surface has stopped asking",
        [(HOST,
          "    const cwd = this.deps.resolveCwd(id, input.cwd ?? this.projectFolderFor(profileId, projectSlug))",
          "    const cwd = this.deps.resolveCwd(\n"
          "      id,\n"
          "      input.cwd ?? (input.projectSlug === undefined ? undefined : this.projectCwd(projectSlug)),\n"
          "    )")],
    ),
    (
        "M5 · ⛔ the folder a person TYPED stops winning · the launcher's own field becomes advice, "
        "and a person who chose a directory for their conversation is silently moved — the ruling "
        "overreaching from *\"never INHERIT a project's folder\"* into *\"never run anywhere a "
        "project is not\"*",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The label's own claim
        # still holds: a folder a person typed must win, and
        # `where-brobots-own-conversation-runs.test.ts` kept the case as '⛔ a folder the person
        # TYPED still wins, for BroBot too'. What changed is that `input.cwd` is now the only
        # source, so the row is put back as `input.cwd` ignored. The plant hands `resolveCwd`
        # `undefined` instead of it.
        [
            (HOST, '    const cwd = this.deps.resolveCwd(id, input.cwd)', '    const cwd = this.deps.resolveCwd(id, undefined)'),
        ],
    ),
    # ── §B · the twelve promises, each one put back as the false promise ───────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject, the permanence of
        # `too-many-for-this-parent`, was removed with the rail. Nothing in src names it any more.
        # Card: "no fan-out cap". Commit 010f9426: "with no fan-out cap". Its anchor is left stale,
        # so the census records it retired.
        "M6 · 🔴 `too-many-for-this-parent` promises a retry again · a model is told to come back "
        "and nothing it can do lowers the count: every spawned slot counts while it is STARTING, "
        "while it is IDLE and while it is CLOSING, there is no expiry, and the only decrementing "
        "verb a caller holds is the destructive one — which is how a bound teaches a model to end "
        "somebody's conversation",
        [(RAILS, "  'too-many-for-this-parent': 'until-a-person-changes-it',",
          "  'too-many-for-this-parent': 'while-this-holds',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject, the permanence of
        # `too-many-live-spawns`, was removed with the rail and with the reading of
        # `max_concurrent`. Commit 010f9426: "max_concurrent … unread and unwritten … with no
        # fan-out cap". Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 `too-many-live-spawns` promises a retry again · the same false promise app-wide, "
        "where it is worse: the blockers are not even the caller's to reach, so the act the payload "
        "implies cannot be performed by the caller at all",
        [(RAILS, "  'too-many-live-spawns': 'until-a-person-changes-it',",
          "  'too-many-live-spawns': 'while-this-holds',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** `profile-already-live` was
        # deleted by D-016: c3-spec.md lists it under the rails deleted, and
        # what-an-agent-is-told-about-its-work.test.ts says '`profile-already-live` went (a give
        # reaches the one conversation its giver has with that agent)'. Only comments in refusals.ts
        # and runtime-ipc.ts still name it, so the entry in spawn-rails.ts that this row re-anchored
        # under D-017 no longer exists. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 `profile-already-live` promises a retry again · the rail HO-023 §2.4 traced a "
        "destroyed conversation back to — a model told the identity would free itself, a "
        "person-owned blocker it may neither message nor end, and `end_agent` the only verb that "
        "makes the refusal go away",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The rule —
        # `profile-already-live` must never be classed retryable (`while-this-holds`) — still holds
        # and is stricter now: D-017 repriced it from `until-a-person-changes-it` to `permanent`,
        # since `end_agent` (the one verb that used to clear the blocker) is gone and nothing else
        # ever frees it. The table's own hazard note says a swap between two non-retryable words
        # 'measures nothing', so the re-anchored plant keeps the table's own required shape: swap
        # the correct word for `while-this-holds`, the false promise.
        [
            (RAILS, "  'profile-already-live': 'permanent',\n", "  'profile-already-live': 'while-this-holds',\n"),
        ],
    ),
    (
        "M9 · ⛔ `no-such-agent` promises a retry again · an id that names nothing, or names "
        "something this caller may not reach, is called transient — and a model that believes it "
        "retries a `sess_<uuid4>` that no operation in the roster can make commandable",
        [(TOOLS, "  'no-such-agent': 'permanent',", "  'no-such-agent': 'while-this-holds',")],
    ),
    (
        "M10 · ⛔ `agent-cannot-take-a-message` promises a retry again · what remains in that fold "
        "after the split is a conversation that is over and a sign-in the machine has moved on "
        "from, both of them a person's to put right — so *come back later* is a model waiting on a "
        "button only a person can press",
        [(TOOLS, "  'agent-cannot-take-a-message': 'until-a-person-changes-it',",
          "  'agent-cannot-take-a-message': 'while-this-holds',")],
    ),
    (
        "M11 · ⛔ `no-task-by-that-name` promises a retry again · a task id is `task_<uuid4>` minted "
        "by this app, so the id in the refused call never becomes this conversation's — the old "
        "word answered about a DIFFERENT id arriving later, which is not the call being refused",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rail was
        # renamed, not removed: the test comment says '`no-task-by-that-name` is
        # `no-piece-by-that-name`'. It is still priced `permanent` for the same reason
        # (reply-rails.ts: a label and an id are minted by this app, never supplied by a caller, so
        # the name in this call will not start naming something), and the plant puts the false retry
        # promise back on the reply vocabulary's entry. Killed by
        # `what-an-agent-is-told-about-its-work.test.ts`.
        [
            (REPLY, "  'no-piece-by-that-name': 'permanent',", "  'no-piece-by-that-name': 'while-this-holds',"),
        ],
    ),
    (
        "M12 · ⛔ `no-question-by-that-name` promises a retry again · a request handle belongs to "
        "the request a provider raised it for, and nothing re-addresses one — so a caller that "
        "believes this word repeats a guess that can never land",
        [(QUESTION, "  'no-question-by-that-name': 'permanent',",
          "  'no-question-by-that-name': 'while-this-holds',")],
    ),
    (
        "M13 · 🔴 `a-person-is-being-asked` promises a retry again · the rail that stands between an "
        "agent and a silent denial of somebody's permission card, telling the agent to come back — "
        "and the only thing that ends the state is the person answering, which is not an act a "
        "model can perform or wait on",
        [(INTERRUPT, "  'a-person-is-being-asked': 'until-a-person-changes-it',",
          "  'a-person-is-being-asked': 'while-this-holds',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** canonical-document.ts is
        # deleted with the document registry, and `no-such-project` went with projects.
        # what-an-agent-is-told-about-its-work.test.ts says 'D-016 deleted three more and renamed
        # three: … `no-such-project` and `no-such-task` with projects and the document registry',
        # and the resource vocabulary has no project rail. Its anchor is left stale, so the census
        # records it retired.
        "M14 · ⚠️ document `no-such-project` promises a retry again · on the only path a model "
        "reaches it through, the project is DERIVED from the caller's own admitted task, so a "
        "refusal is this app's views disagreeing — and *retry* turns an invariant into a loop",
        [(DOCUMENT, "  'no-such-project': 'permanent',", "  'no-such-project': 'while-this-holds',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** `no-such-task` belonged to
        # the `(taskId, projectSlug)` pair in the document registry, which D-016 removed together
        # with projects. what-an-agent-is-told-about-its-work.test.ts lists it among the deleted
        # rails ('`no-such-project` and `no-such-task` with projects and the document registry'),
        # and resources.ts has no rail keyed on a pair. Its anchor is left stale, so the census
        # records it retired.
        "M15 · ⚠️ document `no-such-task` promises a retry again · the `(taskId, projectSlug)` pair "
        "is derived too, and the roster has no verb that re-keys or supplies one",
        [(DOCUMENT, "  'no-such-task': 'permanent',", "  'no-such-task': 'while-this-holds',")],
    ),
    (
        "M16 · ⛔ `no-such-document` promises a retry again · absent and not-yours are one answer by "
        "design, there is no `list_documents`, grant or claim verb, and a later reply registers a "
        "DIFFERENT id — so the identical read can never succeed",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rail was
        # renamed and moved: the test says 'the registry's `no-such-document` … [is] the resource
        # store's `no-such-resource`'. resources.ts prices it `permanent` for the same reason (every
        # agent may read every resource, so a missing id stays missing), and the plant puts the
        # false 'retry' promise back on that entry. Killed by
        # `what-an-agent-is-told-about-its-work.test.ts`.
        [
            (RESOURCES, "  'no-such-resource': 'permanent',", "  'no-such-resource': 'while-this-holds',"),
        ],
    ),
    (
        "M17 · 🔴 `document-registry-unavailable` promises a retry again · a full disk, a "
        "permission, a missing documents root or a file this app did not write standing on the "
        "canonical path — the caller can clear none of them, and a model that retries loses the "
        "reply it is holding to a loop",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `document-registry-unavailable` split into two resource words that still hold its causes:
        # `resource-store-unavailable` (nowhere to keep resources) and `resource-could-not-be-kept`
        # (full disk, permission, something standing at that name). Both are
        # `until-a-person-changes-it`, and the test maps the registry word to the first
        # (THE_TWELVE). The plant puts the false 'retry' promise back on both, which is the defect
        # the row planted on the one word it replaces. Killed by
        # `what-an-agent-is-told-about-its-work.test.ts`.
        [
            (RESOURCES, "  'resource-store-unavailable': 'until-a-person-changes-it',", "  'resource-store-unavailable': 'while-this-holds',"),
            (RESOURCES, "  'resource-could-not-be-kept': 'until-a-person-changes-it',", "  'resource-could-not-be-kept': 'while-this-holds',"),
        ],
    ),
    # ── §B · the clauses that were withdrawn, and the split ────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `too-many-for-this-parent` rail,
        # whose sentence this row protected, was deleted from SPAWN_RAILS, PERMANENCE and REMEDY.
        # Card: "no roles, no fan-out cap". Commit 010f9426: "Any agent may start a conversation as
        # any existing profile … with no fan-out cap". Its anchor is left stale, so the census
        # records it retired.
        "M18 · ⛔ *\"Wait for one to finish, or use one of them\"* comes back · `422` §5.1: *\"Idle "
        "sessions do not finish, message does not clear the rail, blockers may be unentitled, and "
        "`end_agent` is destructive\"* — a sentence that teaches the wrong lesson even with the "
        "permanence right",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence stopped claiming nothing the caller does lowers the number (675, 663 F7); The DEFECT this row plants is unchanged.
            (
                RAILS,
                "        'have at once, and one sitting idle still counts. Do this yourself, or say that you are ' +\n        'held up. The number falls when one you started finishes ending, or when a person raises ' +\n        'the limit.'",
                "        'have at once. Wait for one to finish, or use one of them.'",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The app-wide `too-many-live-spawns`
        # rail, whose sentence this row protected, was deleted. It read `maxConcurrent`, and
        # max_concurrent is now a dead column. Commit 010f9426: "max_concurrent … columns stay in
        # the schema, unread and unwritten … with no fan-out cap". Its anchor is left stale, so the
        # census records it retired.
        "M19 · ⛔ *\"Try again once some have finished\"* comes back · the app-wide count, where "
        "*they* are conversations the caller cannot see, reach or end",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
            (
                RAILS,
                "        `once (${detail.limit ?? '?'}). Do this yourself, or say that you are held up: they are not ` +\n        'all yours, they do not end by being waited for, and a person raises that number or ' +\n        'closes some.'",
                "        `once (${detail.limit ?? '?'}). Try again once some have finished.`",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The sentence 'Send a message
        # to that one instead' belongs to the `profile-already-live` rail's wording, and D-016
        # deleted that rail (c3-spec.md; the test says '`profile-already-live` went (a give reaches
        # the one conversation its giver has with that agent)'). The anchor `That agent is already
        # in ${detail.liveSessionId}…` is absent from spawn-rails.ts, and no remaining rail says a
        # message to the blocker clears it. Its anchor is left stale, so the census records it
        # retired.
        "M20 · ⛔ *\"Send a message to that one instead\"* comes back · HO-005 §3's clause, which "
        "HO-023 §2.1 and `422` overtook: messaging the blocker does not clear this rail — ⚑ the ID "
        "stays either way, so this row is about the instruction and not about the disclosure. "
        "⚠️ **RE-ANCHORED at `428`, not retired**: that dispatch re-keyed the rail to the parent and "
        "rewrote the sentence around it, so the words this row replaces moved. ⛔ **Its defect is "
        "unchanged and is still live** — messaging the blocker leaves it live and the identical "
        "spawn still refused — and it was re-run RED against the new sentence. ⚑ The half of the "
        "old argument `428` deleted (*a blocker a person owns is refused by `message_agent` and by "
        "`end_agent` both*) is gone because a person's conversation can no longer BE the blocker",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1), and narrowed after 675’s review so it plants only its own defect; The DEFECT this row plants is unchanged.
            (
                RAILS,
                "`That agent is already in ${detail.liveSessionId ?? '?'}, so no second one was opened. Give ` +\n        'it this work, or ask what it is doing: it is a conversation you started, and yours to ' +\n        `drive. It is",
                "`That agent is already in ${detail.liveSessionId ?? '?'}, so no second one was opened. Send a ` +\n        'message to that one instead. ' +\n        `It is",
            ),
        ],
    ),
    (
        "M21 · 🔴 the SPLIT is reverted · a caller that addresses its own real, advertised session "
        "id falls back into the catch-all and is told the receiver is busy — `422`'s second flatly "
        "false rail, restored: a sentence about somebody else for a call about itself, and "
        "`retryable: true` for ever · killed by `the-wake-says-only-what-is-true.test.ts` (named by W4.154)",
        [(TOOLS,
          # ⚑ **W4.150 · re-anchored in place, not retired** — F091 widened the self check to a conversation the caller took the place of; the plant still removes the whole check, so a caller addressing its own id falls through to the host's gate
          "          if (agent === me || host.tookItsPlace(agent) === me) {\n            return selfRefusal(spelled, agent)\n          }\n",
          "")],
    ),
    (
        "M22 · ⛔ the whitespace fold comes back · a message of spaces passes the tool's own guard, "
        "throws `NOTHING_TO_SEND` two layers down and returns wearing a sentence about the "
        "RECEIVER — 340's *a reason answering with another reason's sentence*, for a fault in the "
        "caller's own arguments",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: a message of only whitespace is the caller's fault
        # and must be refused `malformed-request`, not reach the host and come back as
        # `agent-cannot-take-a-message`. The guard is unchanged in shape but now reads `spelled`, so
        # the plant restores `text.length === 0`. Killed by
        # `the-promise-a-rail-could-not-keep.test.ts`.
        [
            # NOT VERIFIED: field diagnostics split the guard; spaces still pass the planted length check.
            (TOOLS, "          else if (!hasSomethingToSend(text, 0)) problem('text', 'send a non-blank text message')", "          else if (text.length === 0) problem('text', 'send a non-blank text message')"),
        ],
    ),
]
