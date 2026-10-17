"""520 · the button between looking and killing it — each row is THE DEFECT, put back (131).

⛔ **The defect, in two sentences from `519` §1:**

> ⚑ **Closing the WINDOW is safe for a claimed live agent-born child.** ⛔ **Pressing the claimed
> pane's ordinary `Close` button ENDS it.**

⚠️ **And the press that gets a person there is labelled *"Take it over and open it"***, so the
sequence a person actually performs is claim → watch → press the button labelled `Close`. 🔴 **The
behaviour is intended and tested** (`the-door-a-session-can-be-created-through.test.ts:295-307`);
what was wrong is the WORD and the absence of a door in front of it.

## ⚑ The scope decision these rows pin, and why it is not conditional

⛔ **`Close` is this renderer's word for *dismiss this view* everywhere else it appears** — measured,
not asserted: no component that says the bare word reaches `store.close`, and the app's other
`Close` a person can read on the same screen is the title bar's, which really does close a window.
🔴 **So the word changes on every pane.** ⚠️ **One of the four reasons it rested on died at `523`**
(relay 2 §1): *the two-word alternative is unbuildable here* was true while
`SessionSlot.bornWithoutASurface` was host-only, and `523` put the origin on the wire as
`CreatedSession.startedWithoutAWindow`. ⛔ **The decision did not move, and these rows are why it did
not need to**: the press performs the same `RuntimeHost.close` on both panes, so a word keyed on the
origin would name something other than its own effect. ⚑ **The consequence is still in the
sentence** — it names NAVIGATION and not the window — but that silence is now a DECISION rather than
a limit, and `M13` is the row that pins it either way.

## ⛔ The seven properties these rows guard

 1. **The word says what the press does** — `M1`, `M17`, `M18`.
 2. **The press opens a question and calls NOTHING** — `M2`, `M3`, `M10`.
 3. **The answer is the only thing that ends a conversation, and only when it was asked** — `M4`,
    `M5`, `M6`. ⚑ `M6` is the double-click: armed-and-fired on one target is answered by a mouse
    bounce, which is why the answer is a different element from the press.
 4. **An open question belongs to the conversation it was opened on** — `M7`, `M9`. ⛔ `RuntimeScreen`
    mounts ONE `ConversationPane` with no `:key`.
 5. **…and it does not shut itself** — `M8`, the control for the two above. A `supply` that disarmed
    unconditionally passes both of them and closes the door on the frame after it opened.
 6. **The sentence says what is lost, what is not, and names NAVIGATION rather than the window** —
    `M11`, `M12`, `M13`.
 7. **The live driver presses BOTH** — `M16`. ⚠️ `smoke:ui` is not in `ci`, so this is the row that
    exists because a live-only instrument needs pinning from a cheap gate.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`, `M17`, `M18` | ⚑ **`the-button-between-looking-and-killing-it.dom.test.ts` §1/§3** and the node file's §2/§3/§6 |
| `M2`, `M3`, `M10` | ⚑ **the DOM file's §2** — the press, counted against a spy standing where `store.close` stands |
| `M4`, `M5`, `M6`, `M14`, `M15` | ⚑ **the node file's §1** — the gate with nothing drawn around it |
| `M7`, `M8` | ⚑ **the node file's §1 AND the DOM file's §4** |
| `M9` | ⛔ **the node file's §1 ONLY.** ⚠️ Measured, not assumed: the DOM's ended-case is satisfied by the door's own `v-if`, so it stays green with the gate's `endable` half removed. Review found that, and the control beside it |
| `M11`, `M12`, `M13` | ⚑ **the node file's §5** |
| `M16` | ⚑ **the node file's §4** — the smoke read as source |
| `M19` | ⚑ **the DOM file's §5** — the two answers, in both palettes |
| `M20`, `M21`, `M22` | ⚑ **the node file's §2** — each word against its own act |
| `M23`, `M24` | ⚑ **the DOM file's §6** — the reader's own position, before and after the press |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from held bytes with a SHA-256 re-check — `verify-each-mutation-row`,
which is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

 * **A row that renames `data-cy="close-session"`.** ⛔ The hook is deliberately unchanged (three
   suites and eleven live steps address it), so a row there would measure churn rather than a rule.
 * **A row on `ConversationPane`'s reopen tooltip.** ⚑ *"Close this conversation and open it again"*
   names a different act — `closeAndReopen` — and keeps its word on purpose; the node file's §3
   guards the half that matters, that the sentence says what happens next.
 * **A row that weakens an assertion in either test file.** ⛔ A mutation on a census is invisible
   to that census.
 * **A row that makes `ending-a-conversation.ts` READ `CreatedSession.startedWithoutAWindow`.** ⚑
   The fork `523` made buildable, and the re-aimed §5 assertion that pins the decision against it was
   verified by hand instead: the field taken off the wire, and a real per-origin fork written into the
   module, each turned §5 red ALONE and were restored byte-for-byte with a SHA-256 re-check. ⛔ It is
   not a row because a fork this module could actually ship has to change `endingView`'s signature —
   which is `M14` — and a second row on one property is one defect counted twice.
 * **`endingView(confirming, agentBorn = true)`** — a DEFAULTED second parameter. ⚠️ Measured and
   discarded: default parameters do not count toward `Function.length`, and every existing caller
   would take the default, so §6 and §2 would both stay green. ⛔ A row whose replacement is still
   TRUE measures nothing. `M14` takes the same property with a REQUIRED parameter, where the verdict
   is deterministic.
"""

LIB = "apps/desktop/src/renderer/src/lib/ending-a-conversation.ts"
HEAD = "apps/desktop/src/renderer/src/components/SessionHeader.vue"
SMOKE = "scripts/ui-live-smoke.mjs"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
UI_LIVE_SMOKE = "scripts/ui-live-smoke.mjs"

MUTATIONS = [
    # ── the word ────────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The End conversation button and the
        # constant that spelled it went on purpose: the commit says "No End conversation button" and
        # deletes ending-a-conversation.ts. The test docblock says 520's §1/§2/§5/§6 "went with
        # their subject", and §3 now asserts no component spells 'End conversation' or renders
        # data-cy="close-session". Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 THE DEFECT, verbatim · the word goes back to `Close`, the one this renderer uses "
        "everywhere else for *dismiss this view* — and `519` §1's person presses it expecting the "
        "view to go away",
        [
            (
                LIB,
                "export const END_CONVERSATION = 'End conversation'",
                "export const END_CONVERSATION = 'Close'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The button whose label the header
        # spelled was deleted (data-cy="close-session" is absent from every component). A census in
        # 520 §3 now asserts that no component draws 'End conversation', which is the opposite of
        # this row's plant. Its anchor is left stale, so the census records it retired.
        "M17 · ⛔ the header spells its own word · one string in two places drifts (`169` §1), and "
        "the drift here is a button promising something the door behind it does not say",
        [
            (
                HEAD,
                '<svg class="icon"><use href="#i-x" /></svg>{{ ending.view.value.label }}',
                '<svg class="icon"><use href="#i-x" /></svg>End conversation',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** There is no bar label left to fork on
        # hasACommander; the End button is gone. The scoped-versus-unscoped word question it
        # protected was decided by removing the press. Its anchor is left stale, so the census
        # records it retired.
        "M18 · 🔴 the word is SCOPED after all · the bar forks on `hasACommander`, which is the "
        "scoped alternative `520` argued against — a person who learns `Close` on their own pane "
        "carries that reading to the claimed one, which is `519`'s harm from the other direction",
        [
            (
                HEAD,
                "{{ ending.view.value.label }}",
                "{{ session?.hasACommander ? ending.view.value.label : 'Close' }}",
            )
        ],
    ),
    # ── the press opens a question and calls nothing ─────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The bar's press (ending.press()) and
        # the second element it opened are gone from SessionHeader.vue; D-017b: "there is no End".
        # No control on the bar can be wired to answer for a question that no longer exists. Its
        # anchor is left stale, so the census records it retired.
        "M2 · ⛔ THE DEFECT with a new word on it · the bar's press answers the question itself, so "
        "the label changed and nothing else did — the shape a repair that stopped at the word "
        "would have shipped",
        [(HEAD, '@click="ending.press()"', '@click="endIt()"')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** endIt(), the gate and the `close` emit
        # were deleted from SessionHeader.vue (the header no longer declares `close` at all). The
        # card says "no End conversation button", so the defect (an unconfirmed End) has no surface.
        # Its anchor is left stale, so the census records it retired.
        "M3 · 🔴 the answer stops asking the gate · `endIt` emits whatever state the door is in, so "
        "a caller that reached it without a press ends a conversation nobody confirmed",
        [(HEAD, "  if (ending.answer(true)) emit('close')", "  emit('close')")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The .ending-door element and its v-if
        # were deleted from SessionHeader.vue with the End question. "No End conversation button" is
        # the card's ask, so a door drawn permanently has no subject. Its anchor is left stale, so
        # the census records it retired.
        "M10 · ⚠️ the door is drawn whether or not it was opened · a confirmation permanently on "
        "screen is furniture, and furniture is not a decision",
        [
            (
                HEAD,
                'v-if="session && !ended && ending.view.value.confirming"',
                'v-if="session && !ended"',
            )
        ],
    ),
    # ── only an answer that was asked for ends anything ──────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** createEndingGate lived only in the
        # deleted ending-a-conversation.ts; nothing in the renderer ends a conversation from a press
        # any more, so there is no answer() to weaken. 520's §1 (the gate) was deleted with its
        # subject. Its anchor is left stale, so the census records it retired.
        "M4 · 🔴 the gate stops being a gate · `answer` reports what it was handed rather than "
        "whether the question was open, so a surface wired straight to the answer ends a "
        "conversation with no door in front of it at all",
        [(LIB, "      return open && ending", "      return ending")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The gate's answer/disarm behaviour
        # existed only in the deleted module. The commit removes the End question entirely ("No End
        # conversation button"), so a stale second press cannot end a second conversation. Its
        # anchor is left stale, so the census records it retired.
        "M5 · ⛔ the door stays open behind the answer · a second press on a stale handle ends a "
        "second conversation, which is the state a pane reused across conversations reaches",
        [
            (
                LIB,
                "      const open = confirming.value\n      confirming.value = false\n      return open && ending",
                "      const open = confirming.value\n      return open && ending",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** press() toggling was a property of the
        # deleted gate, and the double-click hazard existed only because End had a two-step press.
        # With no End press the hazard is gone by decision. Its anchor is left stale, so the census
        # records it retired.
        "M6 · 🔴 the press ARMS AND FIRES · `press` toggles, so the question a double-click opens is "
        "shut by the same double-click — the reason the answer is a different element and not a "
        "second press on the same pixel",
        [
            (
                LIB,
                "    press() {\n      confirming.value = true\n    },",
                "    press() {\n      confirming.value = !confirming.value\n    },",
            )
        ],
    ),
    # ── an open question belongs to one conversation ─────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** supply() and the open question that
        # could travel to another conversation lived in the deleted gate. The door is not rendered
        # anywhere (SessionHeader.vue has no ending state), so nothing can be carried between
        # conversations. Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ an open question TRAVELS · nothing shuts it when the pane is handed another "
        "conversation, and `RuntimeScreen` mounts one pane with no `:key` — so the answer lands on "
        "a conversation the person pressed nothing on",
        [
            (
                LIB,
                "      if (sessionId !== standingIn.value || !endable) confirming.value = false",
                "      confirming.value = confirming.value",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b deleted
        # apps/desktop/src/renderer/src/lib/ending-a-conversation.ts (264 lines) together with the
        # End conversation button and its confirmation door, so the row's file is gone (count -1)
        # and its `sessionId !== standingIn.value || !endable` gate has nothing left to guard.
        # Commit 3af91dcb: "No End conversation button, no kept-open pane, no reading-only pane, no
        # Reopen / Take it over / Read the recording presses". SessionHeader.vue's docblock now says
        # "D-017b · there is no End." Its anchor is left stale, so the census records it retired.
        "M8 · ⚠️ the door shuts itself · `supply` disarms on every render, so the question closes on "
        "the frame after it opened. ⛔ **The control row**: it passes `M7`'s and `M9`'s killers and "
        "is invisible to both",
        [
            (
                LIB,
                "      if (sessionId !== standingIn.value || !endable) confirming.value = false",
                "      confirming.value = false",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Same subject as M8: the confirming
        # gate lived in the deleted ending-a-conversation.ts and the End press it confirmed no
        # longer exists (commit 3af91dcb: "No End conversation button"). No surviving code holds a
        # `confirming` flag that could stay armed across a conversation switch. Its anchor is left
        # stale, so the census records it retired.
        "M9 · ⛔ a question stands over a conversation that has already ended · the press that "
        "opened it is gone, the door is not, and answering it calls a verb with nothing to do",
        [
            (
                LIB,
                "      if (sessionId !== standingIn.value || !endable) confirming.value = false",
                "      if (sessionId !== standingIn.value) confirming.value = false",
            )
        ],
    ),
    # ── the sentence ─────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** ENDING_LINE ("…again and is sent. The
        # recording stays…") was in the deleted module and no sentence about ending is drawn now.
        # D-017b: "A conversation is never ended — a stop is not an ending, and a message continues
        # it", and no sentence says whether a process runs. Its anchor is left stale, so the census
        # records it retired.
        "M11 · ⛔ the sentence stops saying what SURVIVES · it names only the damage, so a person "
        "weighing the press cannot tell whether the transcript goes with it",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — ENDING_LINE still exists
        # and still contains the survives-clause; the commit didn't touch this file, but the
        # mutation's exact old text (with a leading quote) no longer matches because the two
        # concatenated string literals split the sentence differently than the table assumed. The
        # rule — a person must be told what survives ending — is untouched and `§5 'names what
        # survives it'` in the test still pins `toContain('The recording stays')`.
        [
            (LIB, "'again and is sent. The recording stays. Going Home or opening another conversation does none of that.'", "'again and is sent. Going Home or opening another conversation does none of that.'"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The 'Going Home or opening another
        # conversation does none of that' clause was part of the End door's sentence, which is
        # deleted. 520 §5 (the sentence) went with its subject, and the leaving-versus-ending
        # confusion has no press left to attach to. Its anchor is left stale, so the census records
        # it retired.
        "M12 · 🔴 the sentence stops naming the thing it is confused WITH · `519`'s finding is that "
        "people cannot tell leaving from ending, and without this clause the door describes the act "
        "without distinguishing it from the gesture beside it",
        [
            (
                LIB,
                " Going Home or opening another conversation does none of that.'",
                "'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The sentence that could wrongly claim
        # the window is safe no longer exists. What survives of this rule is the title bar's 'Close
        # this window' naming the window, which 520 §3's second test still pins, but that is not
        # this row's defect. Its anchor is left stale, so the census records it retired.
        "M13 · ⛔ the sentence claims the WINDOW is safe · true of a claimed agent-born child and "
        "FALSE of a conversation this window started — `closeSessionsForOwner` splits on the birth "
        "fact, and since `523` the renderer can read it, so an unconditional clause is a choice to "
        "say something false rather than an accident",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same file/constant, same
        # split issue as M11. The defect is still live and explicitly guarded: the docblock (520
        # F1/relay 2) and the test's §5 'says nothing about the window' both argue this is a
        # decision not yet spent — adding an unconditional window clause is exactly what must not
        # happen.
        [
            (LIB, "'again and is sent. The recording stays. Going Home or opening another conversation does none of that.'", "'again and is sent. The recording stays. Closing the window does not end it. Going Home or opening another conversation does none of that.'"),
        ],
    ),
    # ── the module's shape ───────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** endingView(confirming) was a function
        # of the deleted ending-a-conversation.ts, so there is no signature to fork. The card
        # removes the End press and its words together. Its anchor is left stale, so the census
        # records it retired.
        "M14 · 🔴 the words fork on a second reading · the scoped word, built — and every existing "
        "caller passes nothing for it, so the pane a person meets first is labelled from `undefined`",
        [
            (
                LIB,
                "export function endingView(confirming: boolean): EndingView {\n  return {\n    confirming,\n    label: END_CONVERSATION,",
                "export function endingView(confirming: boolean, agentBorn: boolean): EndingView {\n  return {\n    confirming,\n    label: agentBorn ? END_CONVERSATION : 'Close',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** forget() on the gate went with the
        # gate, and SessionHeader.vue has no ending gate to unmount. No open End question can
        # outlive a pane when none can be opened. Its anchor is left stale, so the census records it
        # retired.
        "M15 · ⚠️ `forget` forgets nothing · an unmounted surface leaves an open question behind, "
        "and the next thing to read that gate is answering a press nobody made",
        [
            (
                LIB,
                "    forget() {\n      confirming.value = false\n      standingIn.value = null\n    },",
                "    forget() {\n      standingIn.value = standingIn.value\n    },",
            )
        ],
    ),
    # ── the two answers ──────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The .ending-door .danger rule was
        # deleted from SessionHeader.vue along with the door (the diff removes the whole
        # .ending-door CSS block). With no destructive answer on screen there is no keep/end pair to
        # draw alike. Its anchor is left stale, so the census records it retired.
        "M19 · 🔴 THE DEFECT THIS DISPATCH SHIPPED AND MEASURED OUT AGAIN · the door's own danger "
        "rule goes, so `base.css`'s global `button.danger` (0,1,1) loses to the scoped "
        "`.ghost-button[data-v-…]` (0,2,0) and the answer that ENDS the conversation is drawn "
        "pixel-for-pixel like the answer that keeps it running. ⚠️ No assertion about markup can "
        "see this; only a mount with the real cascade can",
        [
            (
                HEAD,
                ".ending-door .danger {\n  border-color: var(--danger-border);",
                ".ending-door .not-danger {\n  border-color: var(--danger-border);",
            )
        ],
    ),
    # ── the words are pinned to their acts, not to themselves ───────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** ENDING_HEADING was a constant in the
        # deleted module and no End question is drawn. The test docblock says the words' section
        # (§5/§2) went with their subject. Its anchor is left stale, so the census records it
        # retired.
        "M20 · ⛔ the QUESTION reuses the retired word · `End this conversation?` becomes `Close "
        "this conversation?`, so the door a person opened to be told what the press does greets "
        "them with the word the press stopped using. ⚠️ Every check on these five strings compared "
        "rendered text to the constant until review found it — a tautology this row exists to break",
        [
            (
                LIB,
                "export const ENDING_HEADING = 'End this conversation?'",
                "export const ENDING_HEADING = 'Close this conversation?'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** END_IT was the destructive answer's
        # word in the deleted module; that answer is not drawn. Card: "No End conversation button",
        # one press only, "Open the conversation". Its anchor is left stale, so the census records
        # it retired.
        "M21 · 🔴 the destructive ANSWER reuses it · `End it` becomes `Close`, so the last word "
        "before a provider child stops is the one this renderer uses for dismissing a view",
        [(LIB, "export const END_IT = 'End it'", "export const END_IT = 'Close'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** KEEP_IT, the safe answer's word, went
        # with the door, so there is no pair of answers left whose words could stop being a choice.
        # Its anchor is left stale, so the census records it retired.
        "M22 · ⛔ the two answers stop being a choice · the safe one is spelled with the ending "
        "verb, so a person scanning left to right reads two ways of saying the same thing",
        [(LIB, "export const KEEP_IT = 'Keep it running'", "export const KEEP_IT = 'End it later'")],
    ),
    # ── the door and the fold ────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The ending bit is gone from
        # ConversationPane's paneFootprint (it is now activityFootprint|unanswered), and the door
        # that took 47px of transcript height no longer exists. The footprint rule for the remaining
        # siblings belongs to other tables (027/737). Its anchor is left stale, so the census
        # records it retired.
        "M23 · 🔴 the door leaves the follow signal · `027`'s footprint goes back to the pill alone, "
        "so opening the door takes 47px of the transcript's height while its `scrollTop` stays put "
        "and a reader pinned to the newest line loses it to the fold — at the exact moment they are "
        "reading the conversation to decide about it. ⚠️ Found by review, measured at `gap: 0 → 47`",
        [
            (
                PANE,
                # ⚑ 739 · ANCHOR CORRECTED IN PLACE — the footprint gained a third sibling (the
                # no-answer line, `737` F-6); the subject, the ending door leaving the follow signal,
                # is unchanged, and the replacement still drops only the door's bit.
                "    `${activityFootprint.value}|${endingOpen.value ? 'ending' : ''}|${props.record.unanswered > 0 ? 'unanswered' : ''}`,",
                "    `${activityFootprint.value}||${props.record.unanswered > 0 ? 'unanswered' : ''}`,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The update:ending emit and the watch
        # that sent it were deleted from SessionHeader.vue, and the pane no longer reads an ending
        # bit. There is no wire left to cut. Its anchor is left stale, so the census records it
        # retired.
        "M24 · ⛔ the header stops telling the pane · the bit travels nowhere, so the pane's "
        "footprint never moves and `M23`'s defect returns from the other end of the same wire",
        [
            (
                HEAD,
                "  (open) => emit('update:ending', open),",
                "  () => {},",
            )
        ],
    ),
    # ── the live driver ──────────────────────────────────────────────────────────────────────────
    (
        "M16 · ⛔ the live smoke presses the bar and walks away · eleven steps wait out their whole "
        "budget on a conversation that never ended. 🔴 `smoke:ui` is not in `ci`, so without a row "
        "here the day this breaks is the day somebody runs it",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The two presses
        # (close-session then ending-end) are gone, but the rule that eleven steps depend on
        # survives: endTheConversation must really stop the on-screen conversation, now through
        # window.api.runtime.close. DEV rewrote 520 §4 to pin exactly that ("the assertion that says
        # so in seconds"), so the plant is a helper that stops nothing, leaving steps to wait out
        # their budget as the label says. The label's 'presses the bar' wording is historical; do
        # not relabel, since the label keys the recorded run.
        [
            (UI_LIVE_SMOKE, '    `void window.api.runtime.close({ sessionId: ${JSON.stringify(closing)} }).catch(() => {})\n    return true`,', '    `return true`,'),
        ],
    ),
]
