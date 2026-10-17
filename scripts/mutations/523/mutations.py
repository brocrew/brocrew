"""523 · a look he can take back — each row is the defect, put back (132).

⛔ **What these rows protect is one property**, and `HO-045` §1 states it whole:

> ⚑ *He can see what a conversation is doing; doing so is REVERSIBLE; and stopping leaves the
> conversation exactly as he found it.*

⚠️ **Until `523` there was no reversal a person could perform.** `RuntimeHost.release` existed and
was private, called from one place — `closeSessionsForOwner`, which fires on `did-navigate`,
`render-process-gone` and `destroyed`. ⛔ Production creates ONE `BrowserWindow` and denies every
`window.open`, so the only one of those three a person can produce deliberately is quitting the app.
🔴 *"Let me look"* therefore cost ownership until the app was closed, which is what `HO-045` §1.2
calls *the thing making claiming unusable for watching*.

## 🔴 The five properties these rows guard

 1. **Two clauses decide the press, and one of them cannot move** — `M1`, `M2`, `M3`. ⛔
    `mayHandBack` is `owner AND born-without-a-surface`: the first is reversible and the second is
    frozen at reservation. ⚠️ `M3` is the ORDER, and it is the row that needs a session where BOTH
    clauses refuse — a stranger asking about a conversation somebody else STARTED. Every other
    refusal pairing gives the same sentence either way round, which is
    `a-comparison-tested-where-both-sides-agree-measures-nothing`.
 2. **The answer is computed from the outcome, never from the ask** — `M5`, `M6`, `M7`. 🔴 Standing
    rule 18: *a surface may not report an act as done until the act is RECORDED.* The word in
    `ReleasedSession.running` is `runningStateOf` read AFTER the write, so a release that cleared no
    owner reports `in-a-window` and the pane says so.
 3. **The two facts `519` item 3 asked to be exposed actually reach the surface** — `M8`, `M9`. ⚑
    `bornWithoutASurface` had eleven references before `523` and not one was in `renderer/` or
    `shared/`; a person could not tell a conversation they had taken over from one they started.
 4. **The control is absent where the press would be refused, and says what it costs** — `M10`,
    `M11`, `M12`, `M15`. ⚠️ `HO-037` §1 *tell, don't clamp*: the press stays available while somebody
    is being waited on, and the cost stands beside it where it can be read BEFORE the press.
 5. **A refused hand-back leaves the conversation where it was** — `M13`, `M14`.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`, `M2`, `M3`, `M4` | ⚑ **`apps/desktop/test/a-look-he-can-take-back.test.ts` §3** — what it refuses, each paired with the same call one fact over |
| `M5` | ⚑ **`apps/desktop/test/the-word-the-poll-cannot-say.test.ts` §4** — the call-site census on `runningStateOf`, which `523` took from four to five |
| `M6`, `M7` | ⚑ **§4** — the question that is standing, and the pair that stops it being a constant |
| `M8`, `M9` | ⚑ **§1** — the two fields on the hand-over itself |
| `M10`, `M11`, `M12`, `M15` | ⚑ **`apps/desktop/test/a-look-he-can-take-back.render.test.ts`** |
| `M13` | ⚑ **`apps/desktop/test/session-store.test.ts`** — a refused hand-back leaves the record |
| `M14` | ⚑ **`apps/desktop/test/shutdown-door.test.ts`** |

⚠️ **`M15`'s second anchor was CORRECTED at `520` relay 2, not retired.** It quoted the ending
button as `523` found it — `@click="emit('close')"` with the bare word `Close` — and the merge with
`520` put `ending.press()` and `{{ ending.view.value.label }}` there. ⛔ The row is unchanged in what
it does (the hand-back moved next to the ending); only the bytes it anchors on moved, and it was
re-verified RED after the correction rather than inheriting a verdict it never earned.

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from held bytes with a SHA-256 re-check — `verify-each-mutation-row`,
which is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

 * **A row on `RuntimeHost.release`'s four assignments.** ⛔ `336` owns that method and `523` did not
   move a line of it — the public door decides WHO may ask, and the write is the app's. ⚑ `336` §7
   already names the one mutation nobody could drive there (*"dropping `lastDisclosures` from
   `release` — a real defect nothing in this suite drives"*), and `523` made it drivable: §1's
   release-then-reclaim row is the sample it wanted. The row stays `336`'s to add.
 * **A row on the preload binding.** ⚠️ `{ kind: 'release', ...input }` mis-spelled as `'claim'` would
   be caught by nothing: there is no census over `RuntimeBridge`, which `runtime-ipc.ts` says in as
   many words, and `401` shipped a verb that stopped dead at exactly that line. 🔴 Named here as a
   finding rather than written as a phantom survivor
   (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
 * **A row that renders the window clause on a pane where it is false.** ⚑ The defect is real —
   `520` refused to write *"closing the window is safe"* because it is false on half the panes, and
   `523` may say it only because the control is drawn where the birth fact is true. ⛔ **But it is
   not expressible as one edit to this tree**: the template reads `handBack.line`, so escaping the
   guard needs `KEEPS_RUNNING` imported into the component — an import the product does not need,
   carried only so a mutation could compile. ⚠️ The rule is measured instead, from both directions,
   in `a-look-he-can-take-back.render.test.ts` §2: the clause is on the claimed pane and absent from
   the one where it would be a lie.
 * **A row on the six stale sentences.** ⛔ They are prose, and a mutation on prose measures the
   assertion's regex rather than a rule (`a-mutation-on-a-census-is-invisible-to-that-census`).
 * **A row flipping `mayHandItBack` to `slot.bornWithoutASurface` at the CLAIM site.** ⚑ The claimer
   is the owner by construction three lines up, so the two expressions agree for every input that
   site can produce — `a-true-mutation-measures-nothing`. `M2` measures that conjunct where it can
   differ, in the predicate itself.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
COPY = "apps/desktop/src/renderer/src/lib/handing-it-back.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
HEADER = "apps/desktop/src/renderer/src/components/SessionHeader.vue"

MUTATIONS = [
    # ── the two clauses, and the order they are asked in ──────────────────────────────────────
    (
        "M1 · 🔴 a conversation this window STARTED becomes handable back · the press returns a slot "
        "that was born owned to nobody, so a provider goes on running for a surface that is still "
        "there and nothing will ever close it — `062`'s defect, asked for on purpose",
        [
            (
                HOST,
                "  return slot.ownerId === by.ownerId && slot.bornWithoutASurface",
                "  return slot.ownerId === by.ownerId",
            )
        ],
    ),
    (
        "M2 · ⛔ any window may hand back any conversation · ownership stops deciding who may give a "
        "conversation away, so a surface holding an id it was never given can take a person's "
        "conversation out from under them and the refusal that says so never fires",
        [
            (
                HOST,
                "  return slot.ownerId === by.ownerId && slot.bornWithoutASurface",
                "  return slot.bornWithoutASurface",
            )
        ],
    ),
    (
        "M3 · ⛔ the birth fact is asked BEFORE entitlement · a stranger naming a guessed id is told "
        "*you started this conversation*, which is both false of them and a disclosure about "
        "somebody else's conversation — `refuse-on-entitlement-before-refusing-on-existence`",
        [
            (
                HOST,
                "    this.assertMayControl(slot, by)\n    if (!mayHandBack(slot, by)) {",
                "    if (!slot.bornWithoutASurface) {\n      throw this.refusalTranslated(\n"
                "        new SessionUnavailable(\n          'started-here',\n"
                "          `session ${sessionId} was not handed back: it was started with a surface`,\n"
                "        ),\n        'hand a conversation back',\n      )\n    }\n"
                "    this.assertMayControl(slot, by)\n    if (!mayHandBack(slot, by)) {",
            )
        ],
    ),
    (
        "M4 · ⚠️ a conversation on its way out is handed back · its provider is stopping and its "
        "ledger is about to be terminalized, and the room is told it is `unwatched` — a word that "
        "invites the next person to take over a conversation that is already gone",
        [
            (
                HOST,
                # ⚠️ **ANCHOR CORRECTED IN PLACE BY 659**: every phase comparison in this file now goes
                # through one predicate, `onItsWayOut`, so the quoted line changed and the SUBJECT did
                # not. The replacement reproduces the same defect in the new spelling; re-verified RED
                # by hand against its killer.
                "    if (onItsWayOut(slot)) {\n"
                "      throw this.refusalTranslated(\n        new SessionUnavailable(\n"
                "          'still-closing',",
                "    if (false) {\n      throw this.refusalTranslated(\n        new SessionUnavailable(\n"
                "          'still-closing',",
            )
        ],
    ),
    # ── the answer is the outcome, not the ask ────────────────────────────────────────────────
    (
        "M5 · 🔴 the report is a CONSTANT rather than a measurement · standing rule 18 exactly: the "
        "pane draws *handed back* from the absence of a throw, so a release that cleared no owner "
        "is reported as one that did",
        [(HOST, "      running: this.runningStateOf(sessionId),", "      running: 'unwatched',")],
    ),
    (
        "M6 · ⛔ a standing question is never reported · the one cost this gesture has is silent, so "
        "a person hands back a conversation somebody is waiting on and learns only later that "
        "nobody could answer it — `HO-037` §1's *tell* with nothing told",
        [
            (
                HOST,
                "      waitingForAHuman: session.handle.status() === 'waiting_permission',\n    }\n  }",
                "      waitingForAHuman: false,\n    }\n  }",
            )
        ],
    ),
    (
        "M7 · ⚠️ every hand-back claims a question is waiting · the warning stops being information "
        "and becomes decoration, which is the other way to lose it: a sentence that is always there "
        "is a sentence nobody reads",
        [
            (
                HOST,
                "      waitingForAHuman: session.handle.status() === 'waiting_permission',\n    }\n  }",
                "      waitingForAHuman: true,\n    }\n  }",
            )
        ],
    ),
    # ── the two facts 519 item 3 asked to be exposed ──────────────────────────────────────────
    (
        "M8 · ⛔ the ORIGIN never reaches the person who took the conversation over · the one certain "
        "answer this app holds to *did an agent start this* goes back to being main-process only, "
        "which is where `519` item 1 found it",
        [
            (
                HOST,
                "      startedWithoutAWindow: slot.bornWithoutASurface,\n      mayHandItBack: mayHandBack(slot, sink),\n    })\n  }\n\n  /**\n   * **Every session this surface owns",
                "      startedWithoutAWindow: false,\n      mayHandItBack: mayHandBack(slot, sink),\n    })\n  }\n\n  /**\n   * **Every session this surface owns",
            )
        ],
    ),
    (
        "M9 · 🔴 the claim never says the press can be undone · the control is absent on exactly the "
        "conversations it exists for, so the door is built, reachable and drawn nowhere — `519` "
        "item 3's *expose RELEASABILITY*, silently unexposed",
        [
            (
                HOST,
                "      startedWithoutAWindow: slot.bornWithoutASurface,\n      mayHandItBack: mayHandBack(slot, sink),\n    })\n  }\n\n  /**\n   * **Every session this surface owns",
                "      startedWithoutAWindow: slot.bornWithoutASurface,\n      mayHandItBack: false,\n    })\n  }\n\n  /**\n   * **Every session this surface owns",
            )
        ],
    ),
    # ── the surface: absent where refused, and what it says it costs ──────────────────────────
    (
        "M10 · ⛔ the control is drawn on every conversation · a person pressing it on one they "
        "started meets a refusal instead of a control that was never offered — `106`'s rule, and the "
        "press a surface makes is a promise the host has to keep",
        [(COPY, "  if (session === null || !session.mayHandItBack) return null", "  if (session === null) return null")],
    ),
    (
        # The hand-back offer’s explanatory line and its warning constants are gone. The after-press
        # handedBackSays sentence describes a different measured fact, so it is not a replacement
        # anchor for this retired row.
        "M11 · ⚠️ the cost line never changes · *it keeps running without you* is true and is not "
        "what a person needs to know while a question is standing: the one sentence that would have "
        "changed the decision is the one that never renders",
        [
            (
                COPY,
                "    line: status === 'waiting_permission' ? NOBODY_CAN_ANSWER : KEEPS_RUNNING,",
                "    line: KEEPS_RUNNING,",
            )
        ],
    ),
    (
        "M12 · 🔴 a release that did NOT take is reported as one that did · the arm that exists "
        "entirely to keep standing rule 18 honest is removed, and the sentence becomes the cheerful "
        "one for every outcome",
        [
            (
                COPY,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "  if (released.running !== 'unwatched') {\n    return 'BroCrew did not hand this conversation back — it is still open in this window.'\n  }\n",
                "",
            )
        ],
    ),
    # ── a refused hand-back leaves the conversation where it was ──────────────────────────────
    (
        "M13 · ⛔ the window forgets the conversation BEFORE the host agrees · a refused hand-back "
        "takes the pane away from a person who still owns the conversation — the mirror of `close`'s "
        "*marking it ended here would hide a live conversation behind an error message*",
        [
            (
                STORE,
                "      const released = await bridge.release({ sessionId })\n",
                "      sessions.delete(sessionId)\n      const released = await bridge.release({ sessionId })\n",
            )
        ],
    ),
    (
        "M14 · ⚠️ a hand-back is answered during a quit · `closeAll` is already ending every session "
        "this host holds, so the press takes a window's name off a conversation that is going away "
        "and reports `unwatched` for a slot one step from `not-running`",
        [(IPC, "  release: 'refused',", "  release: 'answered',")],
    ),
    # ── the placement, which is the whole of Q1 ───────────────────────────────────────────────
    # ⚑ **The anchors below were corrected at `578`, subject unmoved.** That dispatch wrapped this
    # bar's controls in a `.header-acts` group (`EXT-010` §1.2 — the acts may not shrink), which
    # moved every one of them two spaces right and nothing else. ⛔ The ORDER this row is about —
    # the reversible press first, the destructive one last, three controls between — is untouched,
    # and the row was re-verified RED by hand at the correction
    # (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row plants the hand-it-back button
        # beside the close-session (End) button, which pairs two endings. D-017b removed the End
        # press and the ending door from SessionHeader.vue ("D-017b · there is no End."), so the
        # pairing defect cannot be built. The hand-it-back button survives but has no destructive
        # neighbour, and the header's placement comment was rewritten. Its anchor is left stale, so
        # the census records it retired.
        "M15 · 🔴 the two endings are drawn as a pair · the reversible press lands next to the one "
        "that stops the provider and terminalizes the row, which is `519` F2's defect — *a person "
        "cannot tell the safe act from the destructive one* — rebuilt with a second button",
        [
            (
                HEADER,
                '      <button\n        v-if="handBack"\n        class="ghost-button"\n        type="button"\n        :title="handBack.line"\n        data-cy="hand-it-back"\n        @click="emit(\'handBack\')"\n      >\n        <svg class="icon"><use href="#i-revert" /></svg>{{ handBack.action }}\n      </button>\n',
                "",
            ),
            (
                HEADER,
                '      <button\n        v-if="session && !ended"\n        class="ghost-button"\n        type="button"\n        data-cy="close-session"\n        :aria-expanded="ending.view.value.confirming"\n        @click="ending.press()"\n      >\n',
                '      <button\n        v-if="session && !ended"\n        class="ghost-button"\n        type="button"\n        data-cy="close-session"\n        :aria-expanded="ending.view.value.confirming"\n        @click="ending.press()"\n      >\n        <svg class="icon"><use href="#i-x" /></svg>{{ ending.view.value.label }}\n      </button>\n\n      <button\n        v-if="handBack"\n        class="ghost-button"\n        type="button"\n        :title="handBack.line"\n        data-cy="hand-it-back"\n        @click="emit(\'handBack\')"\n      >\n        <svg class="icon"><use href="#i-revert" /></svg>{{ handBack.action }}\n      </button>\n\n      <button\n        v-if="false"\n        class="ghost-button"\n        type="button"\n        data-cy="close-session-unused"\n        @click="ending.press()"\n      >\n',
            ),
        ],
    ),
]
