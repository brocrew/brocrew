"""544 · Prove the rail still fires, and kill the number that made it unreadable.

⛔ **The defect, in the words of the agent that produced it** (BroBot, on a clean base, relayed in
`00-HO-053` §1 and ruled on in `HO-054` §1.1):

> ⛔ *"My launch instructions say **`Deepest chain: 2`**. I read that as: me (1), project manager
> (2), and no worker below. I explicitly told the project manager to report the refusal if it could
> not spawn a worker. **It spawned one with no refusal at all**, producing a three-deep chain: me →
> `project-manager` → `web-builder`. Either 'deepest chain' counts something other than what it
> reads as, or it was not enforced here. **Nothing told me which, and I could not check.**"*

🔴 **The chain was legal and the rail was never the problem.** `HO-005` §2 Q3 counts a
person-created conversation as depth 0, so BroBot 0 → project-manager 1 → `web-builder` 2 is inside
a bound of 2. ⚑ **What shipped was a number counted from an origin the bundle never named** — the
sentence that names it, `CapabilityField.help`, has one reader and it is a person's sheet.

## ⚠️ So there are two subjects here and the rows are in two halves

**The sentence** (M1-M9, M13). `maxDepth` renders what rail 5 will do to the next conversation this
one tries to start, and nothing else: no number, no position to hold, and nothing to project one
level down — which is precisely what BroBot projected. ⛔ **The bound is the SPAWNER's own row**
(`schema.ts`: *"Read from the SPAWNER's row, not the child's"*), so a sentence about what the
conversations you start may do in turn would have to read their grant rows, which `488` already
refused at the tool.

**The rail** (M10-M12). `540` created the doubt — *"spawn depth is not capped at three"* — and its
own search shape could not have seen this rail: `too-deep`, `max_depth` and `maxDepth` appear zero
times in that response. ⚑ Rows 10-12 break the three facts the sentence rests on: the comparison,
whose row it reads, and where the counting starts.

## ⛔ What this table does NOT cover

 1. **`maxConcurrent`.** `- At once: 3 from one conversation, 8 in this app at once` is the same
    shape — two absolute numbers and no way to locate yourself against either — and it is NOT
    repaired here, because how many children a conversation is running moves during the
    conversation while its depth never does. 544's response files it as a finding.
 2. **Any live run.** Nothing below launches Electron or opens a provider; every row is killed by a
    suite over a real store, a real `RuntimeHost` and a `FakeRuntime`.
"""

CAPS = "apps/desktop/src/shared/capabilities.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
SIDERAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
# 🔴 **570 · the AGENTS section left the navigation column** (`EXT-008` §4.4), and the roster
# row it drew is `TeamWorkspace`'s card. ⛔ **Every row below that pointed into that block is
# CORRECTED IN PLACE and re-verified RED one at a time, never retired** — the subject moved and
# only the bytes changed (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
TEAM = "apps/desktop/src/renderer/src/components/TeamWorkspace.vue"

SAYS = """    says: (held, at) =>
      at === null ? String(held) : at.depth >= held ? CHAIN_ENDS_HERE : CHAIN_MAY_GO_ON,"""

# ⚠️ **One line, and it was two until prettier reflowed it** — 89 characters against a
# `printWidth` of 100. ⛔ Re-anchored before this table was ever run, not retired: the subject is
# the same expression (standing rule 27 / `528`).
HOST_DEPTH = (
    "      depth: parentSessionId === null ? 0 : this.deps.store.depthOf(parentSessionId) + 1,"
)

MUTATIONS = [
    # ── the sentence ───────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE SHIPPED DEFECT, PUT BACK · the bundle prints `Deepest chain: 2` again — an "
        "absolute depth handed to a model that is never told its own, which is the line BroBot "
        "misread out loud and the whole subject of `HO-054` §1.2",
        [(CAPS, SAYS, "    says: (held) => String(held),")],
    ),
    (
        "M2 · ⛔ the two arms are swapped · a conversation at the bound is told it may start "
        "another and one above the bound is told it may not, so every reader of this line is "
        "told the opposite of what the door will do",
        [(CAPS, "at.depth >= held ? CHAIN_ENDS_HERE : CHAIN_MAY_GO_ON", "at.depth >= held ? CHAIN_MAY_GO_ON : CHAIN_ENDS_HERE")],
    ),
    (
        "M3 · 🔴 off by one at the boundary · `>` instead of `>=`, so the one conversation that "
        "IS at the bound reads *not reached* and is refused the moment it tries. ⚑ `HO-054` §1.3 "
        "asked for exactly this to be measured rather than assumed, in both directions",
        [(CAPS, "at.depth >= held ? CHAIN_ENDS_HERE", "at.depth > held ? CHAIN_ENDS_HERE")],
    ),
    (
        "M4 · ⛔ a conversation a PERSON started counts as 1 · `HO-005` §2 Q3 says 0, and this is "
        "the reading BroBot had. ⚠️ Every sentence still looks right and the top of every chain "
        "is now one step nearer the bound than the rail thinks it is",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # a person-started conversation is depth 0 survives in `instructionContext`. Its expression
        # is now `parentSessionId === null ? 0 : this.deps.store.ancestorsOf(parentSessionId).length
        # + 1`, because `depthOf(parent)` is now a piece count. The plant makes the person's root 1.
        # Killed by `what-a-chain-is-told-about-its-own-depth.test.ts`.
        [
            (HOST, '      depth: parentSessionId === null ? 0 : this.deps.store.ancestorsOf(parentSessionId).length + 1,', '      depth: parentSessionId === null ? 1 : this.deps.store.ancestorsOf(parentSessionId).length + 1,'),
        ],
    ),
    (
        "M5 · 🔴 the launch drops the `+ 1` · every spawned conversation is told it sits where its "
        "PARENT sits, so the last one in a chain is told it may start another and the door "
        "refuses it. ⛔ The arithmetic rail 5 performs, performed one step short",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives and the `+ 1` is still there, on the same `instructionContext` line, now written
        # as `ancestorsOf(parentSessionId).length + 1`. The plant drops it, so a spawned
        # conversation is told it sits where its parent sits. Killed by
        # `what-a-chain-is-told-about-its-own-depth.test.ts`.
        [
            (HOST, '      depth: parentSessionId === null ? 0 : this.deps.store.ancestorsOf(parentSessionId).length + 1,', '      depth: parentSessionId === null ? 0 : this.deps.store.ancestorsOf(parentSessionId).length,'),
        ],
    ),
    (
        "M6 · ⚠️ the composer freezes the placement at the top · the walk asks about depth 0 "
        "whatever it is composing for, which is a sentence that ignores the conversation exactly "
        "as the number ignored it — the same defect with better words",
        [(FACTORY, "capabilityLines(context.capabilities, { depth: context.depth })", "capabilityLines(context.capabilities, { depth: 0 })")],
    ),
    (
        "M7 · ⛔ the reader asks the GRANT SHEET's question for everybody · `says` is handed `null` "
        "at the one call site that is composing for a conversation, so a model reads the count a "
        "person edits. ⚑ `485`'s M2 one argument over: the sentence is right and it is answering "
        "the wrong question",
        [(CAPS, "  return says(allowed[field.key], at)", "  return says(allowed[field.key], null)")],
    ),
    (
        "M8 · ⚠️ the refusing arm loses its consequence · *reached* alone names a state and not "
        "what follows from it, which is standing rule 8's distinction: factory text instructs, it "
        "does not describe",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The refusing
        # arm still exists as `CHAIN_ENDS_HERE` in capabilities.ts; D-016 reworded it ('this
        # identity may not give work deeper than this, so this app will refuse any piece you give
        # from here'). The rule that the arm states its consequence and not just 'reached' survives,
        # and the constant is now a two-line concatenation. Killed by
        # `what-a-chain-is-told-about-its-own-depth.test.ts`.
        [
            (CAPS, "const CHAIN_ENDS_HERE =\n  'reached — this identity may not give work deeper than this, so this app will refuse any ' +\n  'piece you give from here'", "const CHAIN_ENDS_HERE = 'reached'"),
        ],
    ),
    (
        "M9 · 🔴 the other arm promises a spawn · *not reached* becomes permission, and the rail "
        "it is about is one of twelve — an identity that may start nobody is not too deep and is "
        "still refused. ⛔ A sentence wider than the rail it describes is `HO-054` §2.3's shape",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The permissive
        # arm is still `CHAIN_MAY_GO_ON`, reworded to 'not reached — work you give from here is not
        # too deep'. The rule that it promises only the absence of the `too-deep` refusal survives,
        # out of twelve rails in `SPAWN_RAILS`. The plant turns it into a promise that a give will
        # work. Killed by `what-a-chain-is-told-about-its-own-depth.test.ts`.
        [
            (CAPS, "const CHAIN_MAY_GO_ON = 'not reached — work you give from here is not too deep'", "const CHAIN_MAY_GO_ON = 'you may give work from here'"),
        ],
    ),
    # ── the rail ───────────────────────────────────────────────────────────────────────────────
    (
        "M10 · ⛔ rail 5 over-refuses by one · `>=` instead of `>`, so the last legal conversation "
        "in a ruled chain is refused — and the sentence, which is computed the other way, tells it "
        "the opposite. ⚑ The direction `HO-054` §1.3 calls *just as real*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Rail 5 is now
        # the `too-deep` step of `admitGive`, counted on `work` against the giver's own `maxDepth`,
        # and the off-by-one rule still holds. Only the variable name changed, from `spawner` to
        # `giver`. The plant `>=` refuses the sixth give, the last legal one on the default bound of
        # 6. Killed by `what-a-chain-is-told-about-its-own-depth.test.ts`.
        [
            (RAILS, '  if (depth > giver.maxDepth) {', '  if (depth >= giver.maxDepth) {'),
        ],
    ),
    (
        "M11 · 🔴 rail 5 reads the CHILD's row instead of the spawner's · the fact `schema.ts` "
        "states in its own words — *Read from the SPAWNER's row, not the child's* — and the fact "
        "that decides how far this sentence may reach. ⚠️ Measured where the two readings diverge, "
        "because every seeded row holds the ruled 2",
        # ⚑ **Anchored on the line that RESOLVES the row rather than on rail 5's arithmetic.**
        # ⛔ `341 M7` and `341 M8` already anchor `const depth = …` and `if (depth > …) {`; a row of
        # ours on either would put four rows across two tables on two lines, so one reflow would
        # darken all four and `528`'s write rail could not say which repair moved which.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the depth bound is the GIVER's own capability row and not the receiving
        # profile's. The row read in `admitGive` is now `facts.capabilitiesOf(giving.profileId)`,
        # and the plant reads `asked.profile` (the receiver) instead. It diverges from the correct
        # read exactly where the test moves one row, `grant('w6', { maxDepth: 7 })`. Killed by
        # `what-a-chain-is-told-about-its-own-depth.test.ts`.
        [
            (RAILS, '  const giver = facts.capabilitiesOf(giving.profileId) ?? DEFAULT_CAPABILITIES', '  const giver = facts.capabilitiesOf(asked.profile) ?? DEFAULT_CAPABILITIES'),
        ],
    ),
    (
        "M12 · ⛔ the ledger counts the root as 1 · the recursive ancestry anchors at 1, so "
        "`depthOf` answers one deeper for every conversation there is and `HO-005` §2 Q3's own "
        "sentence — *a conversation a person creates is depth 0* — stops being true of the store",
        # ⚑ **RE-POINTED at 629, not retired** — that dispatch added a SECOND recursive walk of
        # the same edge (`ancestors`, for `SessionStore.ancestorsOf`) whose seed row is byte-
        # identical, so the one-line anchor matched twice.
        # ⛔ `a-sibling-read-makes-its-neighbours-anchors-ambiguous`, and the fix is the same one
        # that memory names: include the line that names WHICH statement this is.
        # ⚠️ **The row's subject is unchanged** — `depthOf` answers one deeper for every
        # conversation — and it is deliberately still pointed at `depth` alone, because that is
        # the statement `HO-005` §2 Q3's sentence is about.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # a conversation a person creates is depth 0 survives, and `depthOf` now counts on `work`:
        # it returns `chainUp(row).length - 1`, so a root piece is 0. The recursive
        # `provider_session` ancestry it used to anchor on is gone. The plant drops the `- 1`, so
        # every piece reads one deeper. Killed by
        # `what-a-chain-is-told-about-its-own-depth.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — depthOf still answers how deep a conversation sits, and a
        # conversation a person creates is still depth 0; D-016c commit 6 changed the computation to
        # the index of the nearest piece up the chain that a person gave. The plant adds one to that
        # index, so every conversation reads one deeper than it is. Killed by
        # `what-a-chain-is-told-about-its-own-depth.test.ts`.
        [
            (STORE, '      return chainUp(row).findIndex((one) => one.given_by_session_id === null)\n', '      return chainUp(row).findIndex((one) => one.given_by_session_id === null) + 1\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The roster row's grant interpolation
        # with `null` placement went when D-014 deleted the card's canSpawn/canStaff pair.
        # TeamWorkspace no longer imports grantLine, and the only caller left is factory-text.ts,
        # which draws for a conversation by design. Its anchor is left stale, so the census records
        # it retired.
        "M13 · ⚠️ the roster row composes a conversation of its own · a person's surface starts "
        "asking what SOME conversation may do rather than what this identity holds. ⛔ Nothing a "
        "person can see moves today, because neither grant this row draws reads the placement — "
        "which is why the source census is what refuses it",
        # ⚑ **570 · MOVED** — the roster row is `TeamWorkspace`'s card (`EXT-008` §4.4).
        [
            (
                TEAM,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41: the Team card hands `grantLine` the grant as a
                # person reads it (`namedGrants`, every identity NAMED); the defect planted is unchanged.
                "grantLine(field, namedGrants(member.identity.capabilities), null) }}</small",
                "grantLine(field, namedGrants(member.identity.capabilities), { depth: 0 }) }}</small",
            )
        ],
    ),
    (
        "M14 · 🔴 the bound is read as an EQUALITY · a conversation sitting PAST its identity's "
        "bound is told the chain may go on, and the door refuses it. ⛔ Reachable because the bound "
        "is the SPAWNER's: a wide spawner places a child deeper than the child's own row allows — "
        "the state every other assertion in this family used to sit below "
        "(`a-comparison-tested-where-both-sides-agree-measures-nothing`)",
        [(CAPS, "at.depth >= held ? CHAIN_ENDS_HERE", "at.depth === held ? CHAIN_ENDS_HERE")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Like M13: the `:title` it widens was on
        # the deleted grant pair (D-014, "no `can_spawn`", staffing carve-out gone). No roster
        # attribute calls grantLine any more. Its anchor is left stale, so the census records it
        # retired.
        "M15 · ⚠️ the roster row's TITLE composes a conversation · the same widening as M13 on the "
        "attribute beside it, and the one nothing else pins: `485 M7` keeps the `null` while "
        "swapping the identity, `530 M11` deletes the line, and M13 moves only the interpolation",
        [
            (
                # ⚑ **570 · MOVED**, with M13 above and for the same reason.
                TEAM,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41: the Team card hands `grantLine` the grant as a
                # person reads it (`namedGrants`, every identity NAMED); the defect planted is unchanged.
                ':title="grantLine(field, namedGrants(member.identity.capabilities), null)"',
                ':title="grantLine(field, namedGrants(member.identity.capabilities), { depth: 0 })"',
            )
        ],
    ),
    (
        "M16 · ⛔ a REOPENED conversation forgets where it sits · the resume path stops passing the "
        "parent the ledger recorded, so every reopened spawn is told the chain may go on and is "
        "refused `too-deep` on its first tool call. ⚑ `instructionContext` has two callers and this "
        "is the one a restart takes — `373` made the parent survive one, and this sentence rests on "
        "that",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # reopened conversation must still be handed the parent the ledger recorded, or the depth
        # sentence says 'not reached' while rail 5 refuses `too-deep`. D-016 only dropped the
        # `projectSlug` argument, so the two-line call collapsed to
        # `this.instructionContext(row.profileId, row.cwd, slot.spawnedBy),` inside `reopenSession`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a reopened conversation must be handed the parent the ledger recorded, or its
        # depth sentence says 'not reached' while the rail refuses `too-deep`. The call in
        # `reopenSession` now has four arguments, `this.instructionContext(row.profileId, row.cwd,
        # slot.spawnedBy, sessionId)`, because D-016 added the conversation id for its root. The
        # plant passes `null` for the parent. Killed by
        # `what-a-chain-is-told-about-its-own-depth.test.ts`.
        [
            (HOST, '      this.instructionContext(row.profileId, row.cwd, slot.spawnedBy, sessionId),', '      this.instructionContext(row.profileId, row.cwd, null, sessionId),'),
        ],
    ),
]
