"""545 · A relayed row names the conversation that relayed it.

⛔ **`HO-054` §3, and it is a REVERSAL rather than a repair:**

> ***`413` §4's premise expired at `449` and the ruling goes with it. A relayed row names the
> relaying conversation's identity.***

## 🔴 Which half of `413` §4 survives, because half of this table guards it

⚑ **The clause is untouched:** *"No invented actor … a turn attributed to the app is not a turn
attributed to a named agent unless the ledger holds that name."* ⛔ What expired is the REASON the
docblock gave for stopping there — *"the only thing the renderer could print is a `sess_…` handle,
and a handle dressed as a sender is an actor invented out of an id"* — because `449` made a
conversation resolvable to an identity and `537` made five surfaces ask `agentName` for the words.

⚠️ **So the rows below guard TWO directions at once.** A row that put the CONVERSATION on a bubble
would be `413` §4's own defect; a row that named nobody, or named the app, is `HO-054` §3's. ⛔ **A
table that only pushed one way would pass a repair that swapped one lie for the other.**

## ⛔ The defect in the person's own words, and why the photograph hid it

> ⚑ **the person:** *"BroBot messages say **BroBot** which is correct."*

⚠️ **Correct by coincidence.** His run went BroBot → project manager → worker, and every hop below
the first read `BroBot` — *"a lie about a project manager"* (`HO-054` §3). ⛔ **Which is why every
surface row here carries TWO relayers**: one this app can name and one it cannot. A table measured
on a single resolvable relayer cannot tell a correct resolution from a lucky constant.

## 🔴 The second relayer is a REAL state and not a contrivance

⛔ **Every relayed row written before `545` carries the conversation and no identity at all**, so a
person reopening last week's conversation meets `AN_UNNAMED_RELAYER` for as long as they keep it.
⚑ It is also what a relaying conversation with no binding answers — the same `null`
`SessionStore.identityOf` returns.

## ⛔ What this table does NOT cover

 1. **Who may read what** (`HO-054` §2.2/§2.3) and **where a supervisor's notes live** — both ruled,
    both queued, neither this dispatch's.
 2. **The composed instructions** (`544`) and **the relationship read** (`543`) — other layers, in
    flight while this ran.
 3. **`NewConversation`'s literal `BroBot`** — `545` §5 decided to leave it and PINNED it against
    `DEFAULT_PROFILE_LABEL` instead, so no row here edits bytes this dispatch deliberately did not
    repair.
"""

WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
WORDS = "apps/desktop/src/renderer/src/lib/relayed-turn.ts"
STREAM = "apps/desktop/src/renderer/src/lib/describe-event.ts"
ENTRY = "apps/desktop/src/renderer/src/components/RelayedEntry.vue"
QUEUED = "apps/desktop/src/renderer/src/components/QueuedMessage.vue"
VIEW = "apps/desktop/src/renderer/src/components/TranscriptView.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"

MUTATIONS = [
    # ── §1 · the surface, where the defect was photographed ─────────────────────────────────
    (
        "M1 · 🔴 THE SHIPPED DEFECT, PUT BACK · the relayed bubble stops resolving and heads every "
        "row with one constant. ⛔ This is `HO-054` §3 exactly — a word that is right for one hop "
        "and *a lie about a project manager* on every hop below it",
        [
            (
                ENTRY,
                "  relayedSender(props.item.relayedFromProfile, props.identities ?? null),\n",
                "  relayedSender(undefined, props.identities ?? null),\n",
            )
        ],
    ),
    (
        "M2 · ⛔ THE HELD ROW, PUT BACK · the row a person meets FIRST when a target is busy goes "
        "back to a constant, so a task reads one name while it waits and another the second it "
        "flushes — `WORK_REPORT_MARK`'s own *the two spellings had already diverged*",
        [
            (
                QUEUED,
                # ⚑ **RE-POINTED at 624, not retired** — the heading grew a THIRD arm (the app's
                # own notice, `HO-095` §6.1) and the relayed arm became an early `return`, so the
                # ternary's `? ` prefix is gone. ⛔ The row's subject is unchanged: the held row's
                # name goes back to a constant while the turn it becomes names somebody.
                # `correct-a-stale-mutation-anchor-dont-retire-it`.
                "    return relayedSender(props.item.relayedFromProfile, props.identities ?? null)\n",
                "    return relayedSender(undefined, props.identities ?? null)\n",
            )
        ],
    ),
    (
        "M3 · 🔴 the naming function's `undefined` guard goes · an unnameable relayer falls through "
        "to `agentName(null, …)`, which answers **BroBot (default)**. ⛔ That is `HO-054` §3's own "
        "defect re-entering in a friendlier spelling, on every row written before this dispatch",
        [
            (
                WORDS,
                "  return relayedFromProfile === undefined\n    ? AN_UNNAMED_RELAYER\n    : agentName(relayedFromProfile, identities)\n",
                "  return agentName(relayedFromProfile ?? null, identities)\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ the naming function stops reading the roster · a name a person TYPED into the "
        "identity sheet never reaches the row, so `537`'s *one field moves every surface* stops "
        "being true of the fourth surface",
        [(WORDS, "    : agentName(relayedFromProfile, identities)\n", "    : agentName(relayedFromProfile, null)\n")],
    ),
    (
        "M5 · ⛔ the unnameable relayer is called BroBot again · the constant alone, with the "
        "resolution left intact — the one row that still names the APP for words the app did not "
        "write. ⚑ A repair that only fixed the resolvable hop would survive every other row here",
        [(WORDS, "export const AN_UNNAMED_RELAYER = 'Another agent'\n", "export const AN_UNNAMED_RELAYER = 'BroBot'\n")],
    ),
    (
        "M6 · 🔴 the FOLD puts the conversation where the identity goes · `413` §4's surviving half, "
        "inverted: a `sess_…` handle dressed as a sender, which is the actor invented out of an id "
        "that ruling forbids — and the thing a renderer-side *fix* would have shipped. ⚑ Written at "
        "the FOLD because that is the only place the handle is in scope: the item does not carry it, "
        "so a component could not print one without the fold handing it over first",
        [
            (
                FOLD,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the call wrapped and hands `says` too (`687` H1); anchored on the relayer
                # argument and the WHOLE comment line after it, which the replacement re-emits. The row is unchanged.
                "          relayerIdentity(event.relayedFromProfile),\n"
                "          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.\n",
                "          relayerIdentity(event.relayedFromProfile) ?? event.relayedFrom,\n"
                "          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.\n",
            )
        ],
    ),
    # ── §2 · the plumbing, which a prop census cannot see ───────────────────────────────────
    (
        "M7 · ⛔ the view stops handing the relayed row the roster · the heading then draws the "
        "SLUG for an identity somebody has named, so the transcript and the rail disagree about "
        "one agent — `169` §1's two answers to one question",
                # ⚑ **667 re-anchored and the ROW is unchanged** — the entry is handed `ownAgent`
                # where it was handed `who` (`658`'s G4); the roster line is the one removed.
        # ⚑ Landing D-026, PE-007 and the ui files batch · re-anchored in place, not retired — The
        # rule survives: TranscriptView must hand the relayed row the roster so the heading draws a
        # display name and not the slug (RelayedEntry still computes
        # relayedSender(item.relayedFromProfile, identities)). UI-002's 1a1ec11a added `:kept`,
        # `:can-open-document`, `:taken-in` and an `@open-document` handler to the same RelayedEntry
        # element, so the old whole-block anchor (ending in `:own-agent=... />`) no longer matches.
        # The new anchor is the three leading lines of the element (`v-else-if relayed`, `:item`,
        # `:identities`), once, and the plant drops only the `:identities` line. Killed by
        # `a-relayed-row-names-who-relayed-it.render.test.ts`.
        [
            (VIEW, '          v-else-if="row.item.kind === \'relayed\'"\n          :item="row.item"\n          :identities="props.identities ?? null"\n', '          v-else-if="row.item.kind === \'relayed\'"\n          :item="row.item"\n'),
        ],
    ),
    (
        "M8 · ⚠️ the view stops handing the HELD row the roster · the same disagreement, one row "
        "earlier — and the held row is the one a person watches while an agent actually works",
        [
            (
                VIEW,
                # ⚑ **Anchor corrected at `587`, subject unmoved** — see `332 M25`'s note.
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. d96cd5232 inserted limit props before the queued identities binding; keep them and omit only its roster.
                "          :identities=\"props.identities ?? null\"\n          :own-agent=\"props.ownAgent ?? null\"\n          :may-carry-on=\"mayCarryOn.has(row.item.id)\"",
                "          :own-agent=\"props.ownAgent ?? null\"\n          :may-carry-on=\"mayCarryOn.has(row.item.id)\"",
            )
        ],
    ),
    (
        "M9 · ⛔ the pane stops forwarding the roster at all · one line above the two rows, so both "
        "of them fall back together and a census addressed to either component would see nothing "
        "wrong — `a-payload-census-must-read-call-sites-not-types`, one prop over",
        [
            (
                PANE,
                # ⚑ **667 re-anchored and the ROW is unchanged** — `:own-agent` now sits between.
                '          :who="who"\n          :own-agent="ownAgent"\n          :identities="props.identities ?? null"\n',
                '          :who="who"\n          :own-agent="ownAgent"\n',
            )
        ],
    ),
    # ── §3 · the fold, and the trust boundary in it ────────────────────────────────────────
    (
        "M10 · 🔴 the TURN's fold arm drops the identity · the ledger holds the name, the item does "
        "not, and every relayed bubble reads *another agent* — the defect with the repair landed "
        "one layer down, which is the shape a component test alone would miss",
        [
            (
                FOLD,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the call wrapped and hands `says` too (`687` H1); anchored on the relayer
                # argument and the WHOLE comment line after it, which the replacement re-emits. The row is unchanged.
                "          relayerIdentity(event.relayedFromProfile),\n"
                "          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.\n",
                "          undefined,\n"
                "          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.\n",
            )
        ],
    ),
    (
        "M11 · ⛔ the HELD row's fold arm drops it · the same loss on `message_queued`, where the "
        "row is read first and for longest",
        [
            (
                FOLD,
                "      const relayer = wasRelayed(event.relayedFrom)\n        ? relayerIdentity(event.relayedFromProfile)\n        : undefined\n",
                "      const relayer: string | undefined = undefined\n",
            )
        ],
    ),
    (
        "M12 · ⚠️ the REBUILD branch drops it · `054` pages the transcript, so a window can hold an "
        "ending with no beginning — and this is the branch that never saw the `message_queued`. ⛔ "
        "A person scrolling back meets it and nothing else does",
        [
            (
                FOLD,
                "      const rebuiltRelayer = wasRelayed(event.relayedFrom)\n        ? relayerIdentity(event.relayedFromProfile)\n        : undefined\n",
                "      const rebuiltRelayer: string | undefined = undefined\n",
            )
        ],
    ),
    (
        "M13 · ⛔ the identity is read as TRUTHY rather than as a string · replay is a trust "
        "boundary and an imported ledger validates a row as `{ type: string }.passthrough()`, so a "
        "`{}` on disk heads a bubble. ⚑ `wasRelayed`'s own lesson, one field over",
        [
            (
                FOLD,
                "  return typeof relayedFromProfile === 'string' && relayedFromProfile.length > 0\n    ? relayedFromProfile\n    : undefined\n",
                "  return relayedFromProfile ? (relayedFromProfile as string) : undefined\n",
            )
        ],
    ),
    (
        "M14 · 🔴 the identity is read WITHOUT the relay beside it · a row carrying only a profile "
        "heads a person's own bubble with another agent's name, which is `413`'s defect arriving "
        "from the opposite direction",
        [
            (
                FOLD,
                "      const relayer = wasRelayed(event.relayedFrom)\n        ? relayerIdentity(event.relayedFromProfile)\n        : undefined\n",
                "      const relayer = relayerIdentity(event.relayedFromProfile)\n",
            )
        ],
    ),
    # ── §4 · the door, where the fact is resolved ──────────────────────────────────────────
    (
        "M15 · 🔴 the door stops writing the identity · one spread arm, and the ledger goes back to "
        "holding a handle nobody can resolve. ⛔ Every surface then says *another agent* forever, "
        "and no renderer change could ever fix it — which is why the repair is here",
        [
            (
                HOST,
                "    ...(named === undefined ? {} : { relayedFromProfile: named }),\n",
                "",
            )
        ],
    ),
    (
        "M16 · ⛔ the door writes the CONVERSATION as the identity · `two-questions-about-one-"
        "address`: the row then carries a handle in the field a heading is drawn from, which is "
        "`413` §4's invented actor reaching the bubble through the new key",
        [
            (
                HOST,
                "  const named = wroteIt === undefined ? undefined : (identityOf(wroteIt) ?? undefined)\n",
                "  const named = wroteIt\n",
            )
        ],
    ),
    (
        "M17 · ⚠️ the resolver is asked on EVERY turn · a person's own turn costs a ledger read it "
        "never needed — `originOf`'s own *both nulls are decided before the store is asked*, "
        "undone",
        [
            (
                HOST,
                "  const named = wroteIt === undefined ? undefined : (identityOf(wroteIt) ?? undefined)\n",
                "  const named = identityOf(wroteIt ?? '') ?? undefined\n",
            )
        ],
    ),
    (
        "M18 · ⛔ the host resolves the PROJECT instead of the identity · a plausible field on the "
        "same row of the same read, and the heading then names the project a conversation is "
        "placed in — `a-column-name-is-a-claim`, on a property access",
        [
            (
                HOST,
                "    this.deps.store.identityOf(conversation)?.profileSlug ?? null\n",
                "    this.deps.store.identityOf(conversation)?.projectSlug ?? null\n",
            )
        ],
    ),
    (
        "M19 · ⚠️ the held row's authorship is LISTED rather than derived by removal · the fourth "
        "key stops reaching `message_queued`, so a held task names nobody one second before the "
        "turn it becomes names somebody. ⛔ The exact failure `413`'s own docblock predicted",
        # The busy-mailbox message_queued row must preserve relayedFromProfile with the rest of held
        # authorship. The spread appears at several writers, so include surrounding queueMessage
        # context to select this one. Drop only the relaying identity: removing other keys would
        # test a different rule.
        [
            (HOST, "      // is a fact about the words. 🔴 **657 · the entry's own authorship, not a second read of it**.\n      ...held.authorship,\n", "      // is a fact about the words. 🔴 **657 · the entry's own authorship, not a second read of it**.\n      ...(({ relayedFromProfile: _identity, ...rest }) => rest)(held.authorship),\n"),
        ],
    ),
    # ── §5 · the bound, because this field had a transcript reader from birth ───────────────
    (
        "M20 · 🔴 the bound leaves the composition · an imported ledger row can then put a megabyte "
        "of text where a person reads a name. ⛔ `518`'s class, entered at BIRTH rather than later: "
        "`runtime-ipc.ts`'s own *the day either of these gains a reader outside `describe-event.ts`*",
                # ⚑ **671 · anchor corrected in place** — `boundTurnTask` joined the composition.
                # Subject unchanged: the relayer's bound leaves it. Re-verified RED alone.
                # ⚑ **687 · anchor corrected in place** — `boundTaskNumber` joined the composition,
                # which now spans three lines. Subject unchanged: the relayer's bound leaves it.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The relayer
        # bound still leads `boundStoredEvent`'s composition as `boundRelayedIdentity`, and the rule
        # (a stored slug that is not a path segment is dropped, the relay stays) still holds. The
        # composition is now one line,
        # `boundStoredPayloads(boundWorkReport(boundRelayedIdentity(boundPieceNamed(event))))`,
        # because `boundTurnTask` and `boundTaskNumber` were replaced by `boundPieceNamed`. Killed
        # by `a-relayed-row-names-who-relayed-it.render.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The relayed-identity bound is still one of the stored-event bounds
        # and still strips relayedFromProfile from what is stored; only its line changed (it now
        # sits inside boundTheDrive and boundStoredPayloads). The plant drops boundRelayedIdentity
        # from the composition and keeps the other bounds. Killed by
        # `a-relayed-row-names-who-relayed-it.render.test.ts`.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 32981d722 wrapped the composition; still remove only boundRelayedIdentity.
            (STORE, "    boundCardFacts(boundWorkReport(boundRelayedIdentity(boundTheDrive(boundPieceNamed(event))))),\n", "    boundCardFacts(boundWorkReport(boundTheDrive(boundPieceNamed(event)))),\n"),
        ],
    ),
    (
        "M21 · ⛔ the bound asks for a LENGTH and not for the slug's own rule · `<script>x</script>` "
        "is short, so a row edited on disk reaches a heading drawn verbatim. ⚑ A number here would "
        "also be a second opinion about a format `runtime-ipc.ts` owns",
        [
            (
                STORE,
                "  if (typeof slug === 'string' && isPathSegment(slug)) return event\n",
                "  if (typeof slug === 'string' && slug.length <= 64) return event\n",
            )
        ],
    ),
    (
        "M22 · ⚠️ the bound covers the TURN only · `boundStoredPayloads`' own rule for attachments — "
        "*a bound that covered one of the three would leave the gap exactly where the next one is "
        "added* — and the held row is the one a person meets first",
        [
            (
                STORE,
                "    event.type === 'user_turn' ||\n    event.type === 'message_queued' ||\n    event.type === 'message_unqueued'\n",
                "    event.type === 'user_turn'\n",
            )
        ],
    ),
    # ── §6 · the raw stream, which is the one surface the ids belong on ────────────────────
    (
        "M23 · ⛔ the debug stream stops naming the relayer · `413` §4's *the ledger holds the name* "
        "is the whole argument for printing the ids HERE, and a debugger joining a relayed turn to "
        "the agent that sent it would go back to resolving a handle by hand",
        [(STREAM, "  profile === undefined ? '' : ` as ${profile}`\n", "  profile === undefined ? '' : ''\n")],
    ),
]
