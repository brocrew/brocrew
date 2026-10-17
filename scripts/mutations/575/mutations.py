"""575 · What each agent is DOING.

⛔ **`HO-063` §3:** *"A person looking at a project gets `working`, and nothing else, for as long as
the work takes."* 🔴 **BroBot said the same of itself:** *"I could not distinguish thinking from
stuck in a loop from waiting on a prompt nobody will answer."*

⚑ **The answer is a per-session fold in MAIN, fed from the line that already feeds
`LivenessTracker`, plus a read of the slot map that touches no database.** ⛔ **It produces no
WORD**: `agent-state.ts`' `sessionDoing` is *"the ONLY answer to 'what is it doing right now' in the
app"* (089) and `042`/`089`/`099` are three dispatches spent removing second ones — so every row
below is about a FACT the one derivation was missing, never about a word.

## 🔴 A · the fold, and every row of it is `transcript.ts`' rule read from the same events

⛔ **`M1` stops the phase arriving at all**, which is the state the complaint is about: two
conversations that are both `working` and nothing between them. ⚑ **`M2` takes the sub-agent guard
off** — `029`'s rule, *"a call made BY a sub-agent belongs to that sub-agent's card, not to the
conversation"* — so a parent would be drawn running its child's `Grep`. ⚠️ **`M3` keeps the phase
past the turn that produced it**, which is the pill `activityLine` had to be taught to stop drawing.

🔴 **`M4` and `M5` are the two halves of the status rule and each one is wrong in a DIFFERENT
direction, which is why both rows exist.** ⛔ `M4` clears on EVERY status, so `123`'s out-of-turn
burst blanks a live tool call in the middle of one; ⛔ `M5` never clears, so `099`'s measured 32% —
*208 of 657 `activity` events arrived with no turn open* — travels into the next turn and is drawn
there. ⚠️ **A single row on that `if` would have measured only one of them**, which is
`a-comparison-tested-where-both-sides-agree-measures-nothing` asked about a boundary instead of
about an equality.

⛔ **`M6` and `M7` are the same pair one arm over.** `M6` treats EVERY `unknown` as an unreadable
activity, so recognised provider chatter — a `reasoning` frame, which both adapters emit constantly
— would blank the phase; `M7` treats none as one, so a frame that claimed to be an activity and
could not be read leaves the LAST WORD THIS BUILD DID HAVE on screen, which is
`an-unenumerated-state-counts-as-success` and is the defect `575` §4's first bullet names.

⚑ **`M8` leaves `streaming` latched**, which is `089`'s *"running Bash"* into the middle of the
reply arriving through the other field. ⛔ **`M9` lets `nothing-has-arrived` come back**, so a
conversation that has spoken reads as one that never has — and `whatAPlateCanDraw` would then
withhold a status that is perfectly good. ⚠️ **`M10` stamps on every event**, so
{@link ConversationAtWork.since} stops being *when this became true* and becomes *when anything last
happened*, which is `a-measured-fact-has-a-time-it-becomes-available` with the time made useless.

## ⛔ B · the fold a surface calls, and the one DECISION on it

🔴 **`M11` lets the recorded status through for a conversation that has said nothing**, which is
`a-door-that-answers-before-it-can-know` exactly: the column reads `idle`, `idle` in this app means
*we are no longer driving a turn* (`042`), and the conversation has never had one. ⚑ **`M12` writes
a `detail` key with a null in it**, which `activityLine` branches on with `!== undefined` — so the
tool-name clause would fire for a phase that never carried one.

⚠️ **`M13` folds an identity's conversations to ONE.** ⛔ An identity running two conversations is
doing two things, this app has no ruling that says which to show, and a fold that picked would take
the decision in the one place that has no room for the sentence.

## 🔴 C · the read, and the population it may speak about

⛔ **`M14` drops the `runningStateOf` ask**, so a conversation the band beside it draws as *this app
is not running it* would carry a doing line — two surfaces disagreeing about one question (`304`),
and the thing `livenessStateOf`'s *"the pair is decided ONCE"* exists to prevent. ⚑ **`M15` names
the conversation where the identity belongs**, so a Team page grouping by identity would get one
group per conversation and the project band would join on nothing.

## ⚠️ D · the vocabulary

⛔ **`M16` drops a phase from the list**, which the type-level pin catches at `typecheck` and vitest
cannot see (`vitest-cannot-see-a-type-only-import`) — so the runtime census that reads the schema's
own options back out of the discriminated union is what has to kill it, and this row is the proof
that it does.

## ⛔ What this table does NOT cover

 1. **`sessionDoing`'s precedence.** `099` owns it and this dispatch did not change a byte of it.
    ⚑ That the new facts reach a person THROUGH it is asserted instead —
    `what-each-agent-is-doing.test.ts` draws every word in §§1–3 through that function.
 2. **`runningStateOf` itself.** `421` and `509` own its rows; `M14` is about this read's ASK, not
    about that method's answer.
 3. **The `session === null` line in the read.** ⚠️ It is unreachable — `runningStateOf` answers
    `not-running` for a slot with no session — so no mutation on it can change an answer
    (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⛔ It is TYPESCRIPT'S NARROWING and
    the code says so rather than pretending a row covers it, which is `livenessStateOf`'s own
    precedent one method over.
"""

TRACKER = "apps/desktop/src/main/runtime/being-done.ts"
SHARED = "apps/desktop/src/shared/what-is-being-done.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS = [
    # ---- A · the fold ---------------------------------------------------------------------------
    (
        "M1 · ⛔ **the phase never arrives** · the state `HO-063` §3 was filed about — two "
        "conversations that are both `working`, with nothing between them, for as long as the work "
        "takes",
        [
            (
                TRACKER,
                "      case 'activity':\n"
                "        told = { said: 'an-activity', phase: event.phase, detail: event.detail ?? null }\n"
                "        break\n",
                "      case 'activity':\n        break\n",
            )
        ],
    ),
    (
        "M2 · ⛔ **a sub-agent's tool call becomes the conversation's own** · `029`'s rule "
        "inverted — the parent is drawn running the child's `Grep`, which is the misattribution "
        "with nothing on screen to betray it",
        [
            (
                TRACKER,
                "        if (event.parentToolCallId === undefined) {\n"
                "          told = { said: 'an-activity', phase: 'tool', detail: event.name }\n"
                "          streaming = false\n"
                "        }\n",
                "        told = { said: 'an-activity', phase: 'tool', detail: event.name }\n"
                "        streaming = false\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ **the turn that produced the phase does not clear it** · the pill `activityLine` "
        "had to be taught to stop drawing: a finished call's name, held past the call",
        [
            (
                TRACKER,
                "      case 'turn':\n        told = NOTHING_RIGHT_NOW\n        streaming = false\n        break\n",
                "      case 'turn':\n        streaming = false\n        break\n",
            )
        ],
    ),
    (
        "M4 · ⛔ **every status clears, not only a transition** · `123` made `status: working` "
        "reachable from a burst the provider started itself, so this blanks a live tool call in the "
        "middle of one · killed by `the-avatar-is-the-status.test.ts` (named by W4.78)",
        [
            (
                TRACKER,
                # ⚑ **W4.78 · re-anchored in place, not retired** — cadf9a5a turned the one-line transition guard into an if/else-if after the card branch; the plant clears on every non-card status, so a repeated `working` blanks a live tool call (approval-is-activity.md's re-anchor). Killer: the-avatar-is-the-status.test.ts:738; what-each-agent-is-doing.test.ts:602 too.
                "        } else if (event.state !== this.status) {\n",
                "        } else {\n",
            )
        ],
    ),
    (
        "M5 · 🔴 **no status ever clears** · `099`'s measured 32% — *208 of 657 `activity` events "
        "arrived with no turn open* — travels into the NEXT turn and is drawn as that turn's work; "
        "this stream has no `user_turn` to catch it · killed by `the-avatar-is-the-status.test.ts` (named by W4.78)",
        [
            (
                TRACKER,
                # ⚑ **W4.78 · re-anchored in place, not retired** — cadf9a5a moved the clear into the else-if branch; deleting it means no status ever clears (approval-is-activity.md's re-anchor). Killer: the-avatar-is-the-status.test.ts:730; what-each-agent-is-doing.test.ts:587 too.
                "          told = NOTHING_RIGHT_NOW\n        }\n        this.status = event.state\n",
                "        }\n        this.status = event.state\n",
            )
        ],
    ),
    (
        "M6 · ⛔ **every `unknown` is read as an unreadable activity** · recognised provider "
        "chatter — a `reasoning` frame, which both adapters emit constantly — would blank the "
        "phase, so the feature goes quiet on exactly the conversations that are busiest",
        [
            (
                TRACKER,
                "        if (event.degradedFrom === 'activity') {\n"
                "          told = { said: 'nothing', because: 'a-frame-this-app-could-not-read' }\n"
                "        }\n",
                "        told = { said: 'nothing', because: 'a-frame-this-app-could-not-read' }\n",
            )
        ],
    ),
    (
        "M7 · 🔴 **a degraded activity frame leaves the last word this build DID have** · "
        "`an-unenumerated-state-counts-as-success`, and `575` §4's first bullet: *do not let doing "
        "something I have no word for render as the last word you did have*",
        [
            (
                TRACKER,
                "        if (event.degradedFrom === 'activity') {\n"
                "          told = { said: 'nothing', because: 'a-frame-this-app-could-not-read' }\n"
                "        }\n",
                "",
            )
        ],
    ),
    (
        "M8 · ⛔ **the authoritative message does not close the stream** · `089` arriving through "
        "the other field: the row keeps claiming text is arriving after the reply is complete",
        [
            (
                TRACKER,
                "      case 'assistant_message':\n        streaming = false\n        break\n",
                "      case 'assistant_message':\n        break\n",
            )
        ],
    ),
    (
        "M9 · ⛔ **`nothing-has-arrived` can come back** · a conversation that has spoken reads as "
        "one that never has, and `whatAPlateCanDraw` then withholds a status that is perfectly good",
        [
            (
                TRACKER,
                "    if (told.said === 'nothing' && told.because === 'nothing-has-arrived') told = NOTHING_RIGHT_NOW\n",
                "",
            )
        ],
    ),
    (
        "M10 · ⚠️ **the stamp moves on every event** · {@link ConversationAtWork.since} stops being "
        "*when this became true* and becomes *when anything last happened*, which is a time a "
        "surface cannot say anything with · killed by `the-avatar-is-the-status.test.ts` (named by W4.78)",
        [
            (
                TRACKER,
                # ⚑ **W4.78 · re-anchored in place, not retired** — approval-is-activity (cadf9a5a) added `!aCardSettled &&` to the early return; deleting it restarts the stamp on every event (approval-is-activity.md's proposed re-anchor). Killer: the-avatar-is-the-status.test.ts:743 (since stays 4_000 on a repeated status); what-each-agent-is-doing.test.ts:539 also kills it.
                "    if (!aCardSettled && streaming === this.streaming && theSame(told, this.told)) return\n",
                "",
            )
        ],
    ),
    # ---- B · the fold a surface calls -----------------------------------------------------------
    (
        "M11 · 🔴 **the recorded status is let through for a conversation that has said nothing** · "
        "`a-door-that-answers-before-it-can-know`: the column reads `idle`, and `idle` in this app "
        "means *we are no longer driving a turn* (`042`) about one that has never had one",
        [
            (
                SHARED,
                "    status: nothingHasArrived ? null : recorded,\n",
                "    status: recorded,\n",
            )
        ],
    ),
    (
        "M12 · ⚑ **a `detail` key is written even when nobody published one** · `activityLine` "
        "branches on `!== undefined`, so the tool-name clause fires for a phase that carries no name",
        [
            (
                SHARED,
                "  return { phase: told.phase, ...(told.detail === null ? {} : { detail: told.detail }) }\n",
                "  return { phase: told.phase, detail: told.detail ?? undefined }\n",
            )
        ],
    ),
    (
        "M13 · ⛔ **an identity's conversations fold to ONE** · an identity running two "
        "conversations is doing two things and this app has no ruling that says which to show — a "
        "fold that picks takes the decision in the one place with no room for the sentence",
        [
            (
                SHARED,
                "    const held = grouped.get(one.identity)\n"
                "    if (held === undefined) grouped.set(one.identity, [one])\n"
                "    else held.push(one)\n",
                "    grouped.set(one.identity, [one])\n",
            )
        ],
    ),
    # ---- C · the read ---------------------------------------------------------------------------
    (
        # ⚑ **Anchor CORRECTED by `621`, not retired** — `correct-a-stale-mutation-anchor-dont-retire-it`.
        # ⛔ `621` added `whatEachConversationIsWaitingOn` beside this read, DELIBERATELY spelling
        # its population gate the same way (*the pair is decided ONCE*, one question over) — so this
        # one line became `anchor-ambiguous` while its SUBJECT did not move an inch. ⚠️ The anchor
        # now carries `whatIsBeingDone`'s own `ConversationAtWork[]` signature, which is what tells
        # the two apart. 🔴 **Re-verified RED by hand against `what-each-agent-is-doing.test.ts`.**
        "M14 · ⛔ **the read speaks about conversations this app is not running** · a doing line on "
        "a row the band beside it draws as *this app is not running it* — two surfaces disagreeing "
        "about one question (`304`), which `livenessStateOf`'s *the pair is decided ONCE* forbids",
        [
            (
                HOST,
                "      ([conversation, slot]): ConversationAtWork[] => {\n"
                "        // \u26d4 **The ONE decision on this read** \u2014 see the note above for why it is asked and not\n"
                "        // re-derived.\n"
                "        if (this.runningStateOf(conversation) === 'not-running') return []\n",
                "      ([conversation, slot]): ConversationAtWork[] => {\n"
                "        // \u26d4 **The ONE decision on this read** \u2014 see the note above for why it is asked and not\n"
                "        // re-derived.\n",
            )
        ],
    ),
    (
        # ⚑ **Anchor CORRECTED by `621`, not retired** — the row above's note, same cause: the new
        # read publishes the same field off the same object, so one line became two. ⛔ The anchor
        # now carries the comment `575` wrote above its own line, which no other row has.
        # 🔴 **Re-verified RED by hand against `what-each-agent-is-doing.test.ts`.**
        "M15 · ⚑ **the row names the conversation where the identity belongs** · a Team page "
        "grouping by identity would get one group per conversation, and the project band would join "
        "the two lists on nothing",
        # ⚑ **ANCHOR CORRECTED IN PLACE BY 637, and the reason is this row's own subject.**
        # ⛔ The two comment lines the anchor spanned said *"the same value `ProjectConversation.identity`
        # carries, so the two lists join"* — and `637` measured that FALSE: this field is
        # `HostedSession.profileId`, the launcher's raw spelling, while the neighbour is
        # `agent_profile.slug`, folded under a CHECK. ⚠️ The sentence was corrected in place under
        # standing rule 19, so the anchor moved with it.
        # 🔴 **Corrected and not retired** — the row's subject is unchanged and it was re-verified
        # RED by hand against `what-each-agent-is-doing.test.ts`
        # (`correct-a-stale-mutation-anchor-dont-retire-it`).
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # `ConversationAtWork.identity` must be the slug the session runs as and not the
        # conversation id, or a Team page grouping by identity gets one group per conversation. Only
        # the 'project band' half of the label is stale, because it now joins against
        # `ListedConversation.identity`. The anchor is shortened to the `identity:` line and its
        # next line, because the comment above it was reworded.
        [
            (HOST, '            identity: session.profileId,\n            ...session.beingDone.current,\n', '            identity: conversation,\n            ...session.beingDone.current,\n'),
        ],
    ),
    # ---- D · the vocabulary ---------------------------------------------------------------------
    (
        "M16 · ⛔ **a phase this app can be told about is missing from the list** · the "
        "compile-time pin catches it and VITEST CANNOT SEE A TYPE "
        "(`vitest-cannot-see-a-type-only-import`), so the runtime census that reads the schema's "
        "own options back out of the discriminated union is what has to kill it",
        [
            (
                SHARED,
                "export const ACTIVITY_PHASES = [\n  'thinking',\n  'tool',\n  'waiting',\n  'compacting',\n] as const satisfies readonly PublishedPhase[]\n",
                "export const ACTIVITY_PHASES = [\n  'thinking',\n  'tool',\n  'waiting',\n] as const satisfies readonly PublishedPhase[]\n",
            )
        ],
    ),
]
