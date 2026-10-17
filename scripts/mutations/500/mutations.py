"""500 · the setting he should only ever make once — HO-036 §3.1, Slice 5.

⛔ **The ruling:** *"A person sets their approval mode once, and every conversation they start
begins there."*

⚑ **the person, from live use:** *"He opens a new conversation, forgets to set yolo, and BroBot asks
permission for every read and every command… stopping every 3 seconds to allow something is shitty
experience."* ⚠️ **The front door already applied a default and offered the control; the default is
the part nobody had given him.**

## 🔴 The one property every row here is about

⛔ **The default is a PERSON's, it is spent ABOVE the IPC boundary, and a spawn cannot reach it.**
`HO-036` §2 rules that a child takes its PARENT's mode, and the half the withdrawal did NOT withdraw
is *a child cannot grant itself more than its parent holds*. ⚠️ A person's default and a parent's
mode are two different inputs to one field, and a feature that let the first win would reverse a
rail the PO deliberately kept.

⚑ **So the value is resolved in `RuntimeScreen`, handed to the two person-doors as a prop, and
arrives at the host as an ordinary `approvalMode` on a `createSession` a WINDOW sent.** A spawn never
crosses that boundary — `agent-tools.ts` calls `host.spawnSession` in process — so there is no
mechanism, not merely no call. **M1 and M2 are the two ways that could break.**

## ⚠️ The fail-safe direction, four times

⛔ **The column carries no CHECK** — `0030`'s header measured the price: a constraint on an existing
SQLite table forces drizzle's 12-step rebuild — so the READER is the vocabulary and it folds
anything it cannot read to `ask`, the NARROWEST meaning. ⚑ The same direction is taken three more
times: the write folds the way the read does, the door reads back what the DATABASE says rather than
echoing the request, and a launch made before the policy read lands sends `ask`.
**M3, M4, M5, M6 and M10 are those.**

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1, M2 | `apps/desktop/test/the-setting-he-should-only-make-once.test.ts` §3 + §4 |
| M3, M4, M5 | …the same file's §1 |
| M6, M7 | …§2, the door a person presses |
| M8, M9, M10 | `apps/desktop/test/dom/the-setting-he-should-only-make-once.dom.test.ts` §1 |
| M11, M12 | …the dom file's §2, the second door a person starts from |
| M13, M14 | `apps/desktop/test/the-setting-he-should-only-make-once.test.ts` §5, the words |

## ⛔ What this table deliberately does NOT contain

 - ⛔ **No second row moving the resolution below the boundary.** **M1** is that defect, edited in
   the place a later dispatch would actually make it; a row spelling the same move differently would
   measure one thing twice.
 - ⚠️ **No row on `spawn-rails.ts`.** `499` owns `HO-036` §2 and that file; a row there would assert
   a rule this dispatch does not hold, and the PM said not to pre-empt the merge.
 - ⚠️ **No row adding a CHECK to the column.** That is a migration rather than a source edit, and a
   row changing `schema.ts` alone would leave every database untouched — *a mutation that changes
   nothing reports as a survivor*.
 - ⛔ **No row on the cross-provider sentence `500` relay 1 describes.** `499` owns the derivation
   and had landed nothing to import when this shipped; a row guarding a paraphrase would be guarding
   the defect the relay names.
 - ⚠️ **No row flipping `requireAPerson` on the new door.** The gate is `setSpawningEnabled`'s and is
   already carried by `the-grant-nobody-can-give.test.ts`'s live `it.each`, which `500` joined —
   duplicating it here would pin one rule in two tables.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
DOOR = "apps/desktop/src/renderer/src/components/NewConversation.vue"
PLACED = "apps/desktop/src/renderer/src/components/StartAsAgent.vue"
WORDS = "apps/desktop/src/renderer/src/lib/front-door-words.ts"

MUTATIONS = [
    # ── the placement, which is the whole safety property ───────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT the placement exists to prevent · the person's default is resolved in "
        "the HOST instead of the renderer, so it stands in front of every launch — including a "
        "spawn's, the moment anything makes `AdmittedSpawn.approvalMode` optional. `HO-036` §2's "
        "rail, reversed by a convenience",
        [
            (
                HOST,
                "    const approvalMode = input.approvalMode === 'auto' ? 'auto' : 'ask'\n",
                "    const approvalMode =\n"
                "      (input.approvalMode ?? this.deps.store.defaultApprovalMode()) === 'auto' ? 'auto' : 'ask'\n",
            )
        ],
    ),
    (
        "M2 · ⛔ the spawn arm stops naming the admitted mode · the child's `createSession` omits "
        "the field, so whatever resolves an absent one decides what a spawned conversation asks "
        "before acting — the coupling `spawn-rails.ts`'s `ParentSession` docblock exists to deny",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # arm that starts a conversation for a give must name the admitted mode, not leave it to the
        # default) survives in `giveWork`'s start arm: `approvalMode: start.approvalMode`. The old
        # `admitted.approvalMode` anchor went dark because the arm now reads `start`. The plant
        # omits the field, so `createSession` resolves an absent one to `ask`. Killed by
        # `the-setting-he-should-only-make-once.test.ts`,
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (HOST, '        approvalMode: start.approvalMode,\n', ''),
        ],
    ),
    # ── the fold, which is the vocabulary a CHECK-less column does not have ──────────────────────
    (
        "M3 · 🔴 the fold widens · a word this build cannot read becomes `auto` instead of `ask`, so "
        "a typo in a column with no CHECK grants every new conversation the mode that asks nothing "
        "— `0030`'s trade, taken in the dangerous direction",
        [
            (
                STORE,
                "      return row?.default_approval_mode === 'auto' ? 'auto' : 'ask'\n",
                "      return row?.default_approval_mode === 'ask' ? 'ask' : 'auto'\n",
            )
        ],
    ),
    (
        "M4 · ⛔ absence becomes a decision · a NULL column — a first-time install, and every row "
        "`0017`'s seed created — reads as `auto`, so a person who has never been asked has already "
        "consented",
        [
            (
                STORE,
                "      return row?.default_approval_mode === 'auto' ? 'auto' : 'ask'\n",
                "      return row === undefined || row.default_approval_mode === null\n"
                "        ? 'auto'\n"
                "        : row.default_approval_mode === 'auto'\n"
                "          ? 'auto'\n"
                "          : 'ask'\n",
            )
        ],
    ),
    (
        # 🔴 **REPLACED, and the replacement is what the first version FOUND.** ⛔ M5 originally broke
        # a fold on the way IN — `mode === 'auto' ? 'auto' : 'ask'` in the writer — and it SURVIVED,
        # because `mode` is already one of two words: a `z.enum` on the wire, a union in the
        # signature, and every caller this app's own code. ⚑ *A line no mutation can kill is a line
        # carrying no rule*, so `500` DELETED that fold rather than leaving a row that measures
        # nothing, and this row took its place on the property that is real.
        "M5 · ⛔ the two writers on one row stamp each other's decision · the default is written "
        "through the kill switch's statement, so pressing one control moves the other and the "
        "person's mode is never recorded at all — the `ownerId` defect in miniature, on the one row "
        "in this schema that already answers two questions",
        [
            (
                STORE,
                "      spawnSql().writeApprovalDefault.run(mode)\n",
                "      spawnSql().writePolicy.run(mode === 'auto' ? 1 : 0, now())\n",
            )
        ],
    ),
    # ── the door a person presses ───────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 the door echoes the request · `setDefaultApprovalMode` answers what was ASKED FOR "
        "rather than what the database now says, so a write that could not land draws a control "
        "reading *yolo* over a row that will hand the next launch an `ask`",
        [
            (
                HOST,
                "    this.deps.store.setDefaultApprovalMode(mode)\n"
                "    return { defaultApprovalMode: this.deps.store.defaultApprovalMode() }\n",
                "    this.deps.store.setDefaultApprovalMode(mode)\n"
                "    return { defaultApprovalMode: mode }\n",
            )
        ],
    ),
    (
        "M7 · ⛔ the roster stops carrying it · `agentIdentities` answers a constant, so the front "
        "door never learns what the person set and every conversation begins in `ask` — the feature "
        "silently absent, with nothing refusing and nothing to notice it by",
        [
            (
                HOST,
                "      defaultApprovalMode: this.deps.store.defaultApprovalMode(),\n",
                "      defaultApprovalMode: 'ask',\n",
            )
        ],
    ),
    # ── the front door ──────────────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 the payload stops reading the prop · the front door goes back to `417`'s hard-coded "
        "`'ask'` while the control beside it still says *yolo* — the sentence and the payload come "
        "apart, which is the one thing `frontDoorProvider`'s ruling forbids",
        [
            (
                DOOR,
                "  approvalMode: props.defaultApprovalMode ?? 'ask',\n",
                "  approvalMode: 'ask',\n",
            )
        ],
    ),
    (
        "M9 · ⛔ the press asks for the mode it is already in · read off the current state rather "
        "than the view's `next`, so the control can be turned on and never off",
        [
            (
                DOOR,
                "  const next = approvalView.value.next\n"
                "  if (next !== null) emit('setApprovalDefault', next)\n",
                "  if (props.defaultApprovalMode !== null) emit('setApprovalDefault', 'auto')\n",
            )
        ],
    ),
    (
        "M10 · 🔴 the unread row launches in yolo · `null` — *the policy read has not landed* — is "
        "resolved to `auto` instead of `ask`, so the window before a database read answers decides "
        "what an agent may do without asking",
        [
            (
                DOOR,
                "  approvalMode: props.defaultApprovalMode ?? 'ask',\n",
                "  approvalMode: props.defaultApprovalMode ?? 'auto',\n",
            )
        ],
    ),
    # ── the second door a person starts a conversation from ─────────────────────────────────────
    (
        "M11 · ⛔ the second door stops reading the setting · `StartAsAgent` goes back to sending "
        "`'ask'`, so *every conversation they start* becomes *every conversation they start from one "
        "screen* — the re-scoping `app_policy`'s own docblock refuses",
        [
            (
                PLACED,
                "      approvalMode: props.defaultApprovalMode ?? 'ask',\n",
                "      approvalMode: 'ask',\n",
            )
        ],
    ),
    (
        "M12 · ⚠️ the second door launches unattended and says nothing · the disclosure goes while "
        "the launch keeps the mode — `367`'s gap reopened at the one door that has no control to "
        "carry the sentence instead",
        [
            (
                PLACED,
                'data-cy="yolo-means">',
                'data-cy="yolo-was-here">',
            )
        ],
    ),
    # ── the words ───────────────────────────────────────────────────────────────────────────────
    (
        "M13 · ⛔ the bound stops saying it is every conversation · the clause that distinguishes "
        "a SETTING from the three per-launch choices beside it, weakened to describe this launch — "
        "`482`'s once-per-control sentence, made false. "
        "⚠️ LABEL CORRECTED BY 579, and only the label: it read *the ONE clause*, and `EXT-010` "
        "§2.2 made that false. ⛔ `579` put this sentence behind a press and EXTRACTED its scope "
        "onto the control as `LAUNCH_APPROVAL_GOVERNS` — *Every new conversation* — always on "
        "screen and inside the button's accessible name, precisely so that folding the paragraph "
        "could not take the distinction with it. ⚑ **The row still goes RED and its recorded "
        "verdict stands**: `the-setting-he-should-only-make-once.test.ts` §5 pins the three "
        "clauses of this constant by name and none of them survives the replacement. ⚠️ What "
        "changed is the CONSEQUENCE a reader should draw from its red — the screen no longer goes "
        "silent about scope when this sentence does",
        [
            (
                WORDS,
                "  `This is a setting, not a choice about one conversation: it applies to every conversation you ` +\n"
                "  `start, until you change it back. A conversation already open keeps the mode it began in — that ` +\n"
                "  `one changes in ${CHANGEABLE_LIVE_IN}.`\n",
                "  `This conversation will run in the mode shown above.`\n",
            )
        ],
    ),
    (
        "M14 · 🔴 the press stops naming the consequence · *stop being asked* loses *will run "
        "commands and edit files unattended*, so the dangerous direction reads as a preference "
        "rather than as a consequence — `482`'s register with the half that matters removed",
        [
            (
                WORDS,
                # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) says the planning exception in the same sentence; the row's subject is unchanged
                "  auto: 'Press to stop being asked — new conversations will run commands and edit files unattended, except what a provider’s own plan mode asks while it plans.',\n",
                "  auto: 'Press to stop being asked.',\n",
            )
        ],
    ),
]
