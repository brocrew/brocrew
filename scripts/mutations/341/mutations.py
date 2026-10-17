"""341 · The rails, before anything can reach them — each row is THE DEFECT, put back verbatim (131).

⛔ **The ordering ruling this dispatch exists to honour** (341 §0). *"Tools and rails together —
**NOT tools first.** A rail added afterwards is a rail that was optional once."* This is rails
FIRST, which is the strictly safer half: nothing on any wire can reach `RuntimeHost.spawnSession`
today, so by the time a `spawn_agent` tool exists the chokepoint it calls already refuses.

## ⚑ What is being protected

**HO-005 criterion 3, which the PO said they would protect if the slice ran long:** *"a gate nobody
has watched fail is a claim."* So every rail in `spawn-rails.ts` is performed in a test — the same
call, one fact over, allowed and then refused — and every row below is one of those rails, deleted
or inverted.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| every row | ⚑ **`run_suite`** — `apps/desktop/test/the-rails-before-anything-can-reach-them.test.ts` |

⚠️ **One file, and that is not a smell.** The rails are one mechanism with one door; a second suite
would be a second reading of the same rule, which is the thing 169 §1 is about.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row deletes the 64-hop bound on the depth CTE.** A cycle in `parent_session_id` is not
reachable through any code path this dispatch builds — the parent is always an older, live,
registered row — so the mutation changes nothing observable and would record as a phantom survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). The bound is about a database somebody
edited by hand, and `M30` covers the query being read at all.

⛔ **No row makes `parseSlugList` fall back to `DEFAULT_CAPABILITIES.canSpawn` on garbage.** That
constant IS `[]`, so `return []` and `return DEFAULT_CAPABILITIES.canSpawn` are the same value and
the row would be a literal no-op. `M27` is the observable version of the same rule, on
`can_message`, whose default is deliberately NOT the narrowest value.

⛔ **No row touches `mayControl`, `mayCommand`, `mayClaim` or `require`.** 203, 336 and 340 own
those, and 341 §5 is explicit: *"do not widen `require`."* This dispatch READS `mayCommand` and
widens nothing — `M2` is the row that proves the read is load-bearing.

⛔ **No row adds a `can_message` rail.** The column is shape only in 341 (Slice 4 owns messaging),
and a mutation on a rule that does not exist would be a row about nothing.

## ⚑ What the per-row killer check changed, before this table was ever run

🔴 **`spawned_at` was assertable only as `<=`, and one mutation walked straight through it.** The
column's whole claim is that it is a DIFFERENT fact from `created_at` — the moment the rails
admitted the spawn, before the home, the launch and the first event — and with a `FakeRuntime` both
can land inside the same millisecond. So `record.spawn.at` → `at` (write the transaction's own clock
into both) was unobservable. The suite now drives host and store from one strictly-increasing clock,
the assertion is a `<`, and `M30` is red against it.

🔴 **Three rows survived the first pass, and all three were the same mistake: the rule was measured
only where it could not fail.**

  * `M17` — *an omitted approval mode is INHERITED rather than defaulted to the strictest.* The
    paired positive ran against a parent already on `ask`, so inheriting and defaulting gave the same
    answer. There is now a case with the parent on `auto` and the child saying nothing, and the child
    still prompts.
  * `M18` — *a parent on its way back to prompting still counts as `auto`.* Nothing drove a session
    into the state the clause exists for: `effective: 'auto'`, `requested: 'ask'`, which is 034's
    next-turn contract and a real state rather than a transition. A test now sets the mode and spawns
    inside that window.
  * `M22` — *the per-parent count is taken over every spawned slot rather than this parent's.* The
    concurrency test had ONE parent, so *this parent's children* and *every spawned slot* were the
    same number and the count could be taken over either. There are two parents now.

🔴 **And one guard was deleted rather than covered.** `liveSessionAs` carried a `slot.phase !==
'closing'` clause that no mutation could make red: `close()` resolves only after the slot has left
the map, so there is no moment a test can stand a spawn beside a closing session. ⛔ 341 §5 —
*"a rail that cannot be made red is not carrying its rule; delete it and say so"* — and removing it
is also the stricter answer, because a conversation still tearing down is a provider still running,
which is exactly what `liveChildrenOf` counts.

## ⛔ What `366` did to this table, recorded here rather than left to be discovered

⚑ **`M16` is RETIRED IN PLACE, deliberately, and its rule is gone rather than moved.** It mutated
`if (approvalMode === 'auto' && parent.approvalMode === 'ask')` — the `laxer-approval-mode` rail.
HO-011 §3.1 replaced that comparison with an absolute (`spawn-must-prompt`: never `auto`, regardless
of parent), so a spawn can no longer be laxer than anything and there is no defect left for this row
to put back. ⛔ **Not a moved anchor**: correcting it would mean inventing a rule the door lacks.

⚠️ **`M17` is CORRECTED rather than retired, and the rule it carries is unchanged** — *absent means
the strictest*. Its replacement used to be `?? parent.approvalMode`, and `366` removed the approval
mode from `ParentSession` so that no rail could weigh it, which makes the old replacement a compile
error and this row unrunnable — **silently**, because a stale REPLACEMENT is invisible to the
census's stale-ANCHOR check. It is now `?? 'auto'`: same line, same rule, a defect that still exists.
⚑ **This table is `unrun`, so neither edit inherits a verdict it never earned.**

⚑ **`M18` is RETIRED IN PLACE for the same reason as `M16`, and finding out why is the whole point
of writing these notes.** It mutated `effectiveApprovalOf` — *"a parent on its way BACK to prompting
still counts as `auto`"*, `034`'s next-turn contract, a careful clause with a real state behind it.
⛔ **After `366` that function had exactly one caller left and it was a comment.** The only thing
that ever asked what a parent counted as was the rail that compared two modes, so removing the
comparison orphaned the helper, and a helper nothing calls whose docblock states a rule the app does
not have is the same defect as a rail nothing reaches. It was deleted; this row retires with it.

⚠️ **Three of this table's thirty-eight rows were about one rule, and none of them is replaced
here.** `366` writes its own table. What `341` still attests is everything else at this door.

## 🔴 …and `499` moved all three again, because HO-036 WITHDREW the rule that moved them

⛔ **The PO withdrew `HO-011` §3.1** — *"my override of the rule you had already built, and it does
not survive contact with the person using it"* — and restored **a spawned session inherits its
parent's approval mode and may never be wider than it**. ⚑ So every paragraph above is now a record
of a round trip, and each of the three rows landed somewhere different:

⚑ **`M18` HEALED, and it is the only row in this project to have done so.** `499` restored
`effectiveApprovalOf` byte-identically — same body, same clause, same reason — because the rail that
compares two modes exists again and it must read the strict fold rather than
`approvalDisclosure`'s laxer one. ⛔ **The paragraph above is therefore no longer the reason this
row is retired; it is the reason it came back.** ⚠️ It re-enters the census as an UNRUN live row,
which is the honest state: its rule is enforced again and nobody has re-run it.

⛔ **`M16` STAYS RETIRED, and its paragraph above is now half wrong.** *"There is no defect left for
this row to put back"* has stopped being true — a spawn CAN be wider than its parent again — but its
anchor is the literal `laxer-approval-mode` comparison, and `499`'s rail compares what each mode
REMOVES rather than the two words. ⚑ **Correcting it would mean re-aiming it at a different rule**,
and `499` writes that row in its own table (`499` M1). The retirement is unchanged; the reason for it
is.

⛔ **`M17` RETIRES, and it is the row whose DEFECT became the FEATURE.** It said *an omitted approval
mode is INHERITED rather than defaulted to the strictest*, and inheritance is exactly what HO-036
restored: `admitSpawn` now reads `asked.approvalMode ?? parent.approvalMode`. ⚠️ **The inverse is the
live defect** — an omitted mode defaulted to the strictest, quietly ignoring the parent — and `499`
M2 is that row. ⛔ **Not a corrected anchor**: the polarity flipped, and a row re-aimed through a
polarity flip is a new row wearing an old id.
"""

RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

MUTATIONS = [
    # ── §0 · the chokepoint itself ────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim (341 §0) · the admitted-spawn token is no longer checked, so "
        "anything that can cast an object can record a parent and spend no rail at all — the "
        "ungated chokepoint this whole dispatch exists to make unreachable",
        [
            (
                HOST,
                "    if (spawn !== null && !wasAdmitted(spawn)) {",
                "    if (spawn !== null && !wasAdmitted(spawn) && (false as boolean)) {",
            )
        ],
    ),
    (
        "M2 · ⛔ a caller that may not command the parent may spend it anyway · `can_spawn` becomes "
        "keyed on an identity anybody can claim to be by naming its session id",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — `spawn_agent`
        # and its `not-your-parent` rail are gone ("spawn_agent is gone"), but the rule the row
        # protects, that only the giving conversation can spend its own capability and not a
        # commander or stranger, is now the `giver` seam in `giveFacts`, and the rails test 'a
        # caller that is not the giving conversation — its commander, or a stranger — may not spend
        # it' was rewritten for it. The plant hands a caller that speaks as no conversation the
        # first running conversation as its giver, so PLANNER (which commands `parent`) and STRANGER
        # can spend it. Killed by `the-rails-before-anything-can-reach-them.test.ts`.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule survives: only the giving conversation may spend its own capability, and a
        # commander or stranger may not. After D-016c ruling (b) the seam moved out of giveFacts
        # (which is now `giver: () => giving`, non-null) into giveWork's `const giver = speaking ===
        # null ? null : this.runningAs(speaking)`, and the plant hands a caller that speaks as no
        # conversation the first registered conversation as its giver. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (HOST, '    const giver = speaking === null ? null : this.runningAs(speaking)\n', "    const giver = this.runningAs(speaking ?? this.sessionIds[0] ?? '')\n"),
        ],
    ),
    (
        "M3 · ⚠️ a spawn may carry a second commanding caller as well as its token · two answers to "
        "*who may drive this*, which is the defect 340 split `ownerId` to avoid",
        [
            (
                HOST,
                "      throw new Error('a spawn carries its own commanding caller; do not pass a second one')",
                "      void 0",
            )
        ],
    ),
    (
        "M4 · ⛔ the slot forgets which conversation asked for it · both concurrency bounds then "
        "count nothing, because `spawnedBy` is null on every slot in the map",
        [(HOST, "          spawnedBy: spawn?.parentSessionId ?? null,", "          spawnedBy: null,")],
    ),
    # ── §1 · criterion 7 · the kill switch ────────────────────────────────────────────────────
    (
        "M5 · 🔴 criterion 7 · the global kill switch is consulted and then INVERTED · spawning "
        "works only while it is switched off, which is the one rail that must hold regardless of "
        "who asked or what for",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The kill
        # switch survives as the first START rail (`spawning-disabled`, R2 step 7), and the rails
        # test 'criterion 7 · the kill switch refuses a START mid-session ...' asserts it. The plant
        # inverts the consult, so starting works only while the switch is off. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, "  if (!facts.spawningEnabled()) return no('spawning-disabled', { profileId: asked.profile })", "  if (facts.spawningEnabled()) return no('spawning-disabled', { profileId: asked.profile })"),
        ],
    ),
    (
        "M6 · ⛔ the switch fails OPEN · a database with no policy row, an older schema or a host "
        "with no database at all all read as *enabled*, so every way of losing the row turns the "
        "kill switch on",
        [(STORE, "      return { spawningEnabled: row !== undefined && row.spawning_enabled === 1 }",
          "      return { spawningEnabled: row === undefined || row.spawning_enabled === 1 }")],
    ),
    # ── §2 · HO-005 Q3 · depth ────────────────────────────────────────────────────────────────
    (
        "M7 · ⛔ a spawn is its parent's depth rather than its parent's depth + 1 · every chain is "
        "one shorter than it is, so a worker at the bound spawns for ever",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The commit
        # keeps depth on the tree ("depth 6 on the tree"), computed as the parent piece's depth plus
        # 1 in `admitGive`. The plant drops the plus one, so every chain is one shorter than it is
        # and a giver at the bound gives for ever. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, '  const depth = facts.depthOf(under.piece) + 1', '  const depth = facts.depthOf(under.piece) + 0'),
        ],
    ),
    (
        "M8 · ⚠️ the depth bound is off by one in the lax direction · `max_depth: 2` admits a "
        "conversation at depth 3, which is exactly the spawn HO-005 Q3 names as refused",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The bound
        # survives as `depth > giver.maxDepth` (R2 step 4, default 6, overridable per profile). The
        # plant lets a giver at the bound through by one. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, '  if (depth > giver.maxDepth) {', '  if (depth > giver.maxDepth + 1) {'),
        ],
    ),
    (
        "M9 · ⛔ depth is read as a constant 0 · the ledger walk is never asked, so every "
        "conversation looks like one a person opened",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The depth read
        # survives as `depthOf(piece)` in session-store.ts (the tree's chain length), and the old
        # `row?.depth ?? 0` line is gone. The plant returns a constant 0 so the chain walk is never
        # asked and every piece looks like a root. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: a chain's depth is counted from the piece's real
        # ancestry, so the depth rail can refuse the seventh hop. `depthOf` is now
        # `chainUp(row).findIndex((one) => one.given_by_session_id === null)`, and the plant makes
        # every chain depth 0. Killed by `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (STORE, '      return chainUp(row).findIndex((one) => one.given_by_session_id === null)', '      return 0'),
        ],
    ),
    (
        "M10 · ⚠️ the ancestry walk answers its SHALLOWEST hop instead of its deepest · a chain of "
        "three reports depth 0, and the bound can never be reached",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # depth is the DEEPEST hop of the chain survives: `depthOf(piece)` in session-store.ts now
        # counts the piece chain (`chainUp(row).length - 1`) and the SQL `max(depth)` aggregate over
        # the session ancestry is gone. The commit says "depth 6 on the tree" (R2 step 4), so a
        # chain that reports only its nearest hop still must not stand. The plant answers the first
        # hop's depth and never the deepest, so a chain of three reports 1 and the bound of 6 can
        # never be reached. Killed by `the-rails-before-anything-can-reach-them.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: depth must keep counting up the whole chain rather
        # than saturate, so a deep chain is still refused. The anchor moved to the new `findIndex`
        # body and the plant caps the count at 1. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (STORE, '      return chainUp(row).findIndex((one) => one.given_by_session_id === null)', '      return Math.min(chainUp(row).findIndex((one) => one.given_by_session_id === null), 1)'),
        ],
    ),
    # ── §3 · can_spawn, and criterion 12 ──────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is the `can_spawn`
        # comparison, which D-014 removed on purpose. The card says: "no roles, no fan-out cap, and
        # no `can_spawn` / `not-in-can-spawn`". Its anchor is left stale, so the census records it
        # retired.
        "M11 · 🔴 `can_spawn` is inverted · an identity may create exactly the profiles it was not "
        "granted, and none of the ones it was",
        [
            (
                RAILS,
                "  if (!spawner.canSpawn.includes(foldProfileName(asked.profileId))) {",
                "  if (spawner.canSpawn.includes(foldProfileName(asked.profileId))) {",
            )
        ],
    ),
    (
        "M12 · 🔴 criterion 12 · an unknown profile slug is CREATED instead of refused · a typo "
        "becomes a new durable identity with an empty memory and its own provider home",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The commit
        # keeps the existence rule: "An unknown profile is refused no-such-profile unless the giver
        # passes new: true, and a known one with new: true is refused that-profile-exists (R3)." The
        # label's defect (a typo becomes a new durable identity) is planted by making the
        # no-such-profile refusal unreachable while leaving the `new` arms alone. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, "  if (!known && asked.new !== true) return no('no-such-profile', { profileId: asked.profile })", "  if (!known && asked.new !== true && (false as boolean)) return no('no-such-profile', { profileId: asked.profile })"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The 'entitlement' this row asks before
        # existence was `can_spawn`, and D-014 deleted it. There is no identity 'it was never
        # granted' any more. Its anchor is left stale, so the census records it retired.
        "M13 · ⛔ existence is asked BEFORE entitlement · the refusal now tells a caller whether an "
        "identity it was never granted exists, so this door can be used to enumerate the app's "
        "agents by spelling names at it",
        [
            (
                RAILS,
                # ⚑ **RE-ANCHORED at `511`, and the ROW is unchanged.** That dispatch gave rail 7 a
                # second grant (`canStaff`) as a NESTED `if`, so the entitlement half is three lines
                # deep now. ⛔ **What this row breaks is still the ORDER**: existence is asked before
                # entitlement, so the door tells a caller whether an identity it was never granted
                # exists. ⚠️ Anchored on code lines alone — `511` put its own comment ABOVE the outer
                # `if` precisely so this block stayed contiguous code
                # (`a-source-census-that-pins-a-line-kills-every-row-on-it`). Re-verified RED
                # individually.
                # ⚡ **RE-ANCHORED at `598`.** `HO-084` §1 gave `staffingAdmits` a facts
                # argument, so the entitlement half is now nine lines rather than three and the two
                # rails are no longer one contiguous slice. ⛔ **The ROW is unchanged and is
                # still the ORDER**: it is spelled as TWO edits — lift the existence rail out, put
                # it back in FRONT of the entitlement rail — because an anchor spanning both would
                # have to quote this dispatch's own comment. Re-verified RED individually.
                "  if (facts.capabilitiesOf(asked.profileId) === null) {\n"
                "    return no('unknown-profile', { profileId: asked.profileId })\n"
                "  }\n",
                "",
            ),
            (
                RAILS,
                "  if (!spawner.canSpawn.includes(foldProfileName(asked.profileId))) {",
                "  if (facts.capabilitiesOf(asked.profileId) === null) {\n"
                "    return no('unknown-profile', { profileId: asked.profileId })\n"
                "  }\n"
                "  if (!spawner.canSpawn.includes(foldProfileName(asked.profileId))) {",
            )
        ],
    ),
    (
        "M14 · ⛔ an identity nothing has ever run as reads as *configured with the defaults* rather "
        "than as absent · criterion 12's referent disappears, and so does the reason a person has "
        "to bring an identity into being before an agent can be spawned into it",
        # ⚑ Landing D-014 · re-anchored in place, not retired — Criterion 12 survives D-014: "any
        # agent may start a conversation as any EXISTING profile", and `admitSpawn` refuses
        # `unknown-profile` when `capabilitiesOf(asked.profileId) === null`. Re-verified RED alone.
        [
            (STORE, '    if (row === undefined) return null\n    return {\n      maxDepth: parseBound(row.max_depth, DEFAULT_CAPABILITIES.maxDepth),', '    if (row === undefined) return { ...DEFAULT_CAPABILITIES }\n    return {\n      maxDepth: parseBound(row.max_depth, DEFAULT_CAPABILITIES.maxDepth),'),
        ],
    ),
    (
        "M15 · ⚠️ granting a capability CREATES the identity it names · configuring a typo mints the "
        "durable agent the spawn rail refuses to mint, through the door that writes the rule",
        # ⚠️ **Anchor CORRECTED at 355, not retired.** The row is unchanged — `return false` becomes
        # `return true`, and the defect it names is unchanged with it. What moved is the LINE AFTER
        # it: 355 put the per-field `written` map between this guard and the `.run(` call, so the
        # two-line anchor stopped matching. `correct-a-stale-mutation-anchor-dont-retire-it`: the
        # second line is now the comment above the guard, which is what makes this occurrence unique
        # (there is a second `if (row === undefined) return false` in `refreshAdopted`).
        # ⛔ **Re-verified by hand at 355** — applied alone, `the-rails-before-anything-can-reach-them`
        # goes red on *"🔴 criterion 12 · an unknown profile slug is REFUSED, and no identity is created
        # for it"*, at its `expect(store.setCapabilities('ghost', ...)).toBe(false)`.
        [(STORE, "      // criterion 12 arriving through the configuration door.\n      if (row === undefined) return false",
          "      // criterion 12 arriving through the configuration door.\n      if (row === undefined) return true")],
    ),
    # ── §4 · HO-005 Q2 · authority does not delegate down the tree ────────────────────────────
    (
        "M16 · 🔴 HO-005 Q2 · a spawn may run with FEWER permission prompts than the conversation "
        "asking for it · a parent with prompts hands its child an `auto` life, which is *deciding "
        "every permission that child will ever be asked* without any agent answering one",
        [(RAILS, "  if (approvalMode === 'auto' && parent.approvalMode === 'ask') {",
          "  if (approvalMode === 'auto' && parent.approvalMode === 'auto') {")],
    ),
    (
        "M17 · ⛔ an omitted approval mode is INHERITED rather than defaulted to the strictest · an "
        "`auto` conversation quietly makes a tree of them and nobody ever asked for one "
        "⛔ RETIRED BY 499 — HO-036 MADE INHERITANCE THE RULE; THE INVERSE IS `499` M2",
        [(RAILS, "  const approvalMode = asked.approvalMode ?? 'ask'",
          "  const approvalMode = asked.approvalMode ?? 'auto'")],
    ),
    (
        "M18 · ⚠️ a parent on its way BACK to prompting still counts as `auto` · the entitlement it "
        "is giving up is spent on a child that will outlive the window in which it was true",
        [(HOST, "  return effective === 'auto' && requested === 'auto' ? 'auto' : 'ask'",
          "  return effective === 'auto' ? 'auto' : 'ask'")],
    ),
    # ── §5 · max_concurrent, both bounds ──────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The per-parent concurrency bound is
        # removed on purpose. The card says "no fan-out cap", the commit says "with no fan-out cap",
        # and `maxConcurrent` is "unread and unwritten". `forThisParent`, `liveChildrenOf` and
        # `too-many-live-spawns` no longer exist in src. Its anchor is left stale, so the census
        # records it retired.
        "M19 · ⛔ the per-parent bound is off by one · a parent runs one more conversation than it "
        "may, for ever, because the bound is compared as *more than* rather than *at least*",
        [(RAILS, "  if (forThisParent >= spawner.maxConcurrent.perParent) {",
          "  if (forThisParent > spawner.maxConcurrent.perParent) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The global concurrency bound was
        # removed with the per-parent one. The card and commit say "no fan-out cap", and
        # `globally`/`liveSpawns` are gone from src. Its anchor is left stale, so the census records
        # it retired.
        "M20 · ⛔ the global bound is off by one, the same way · the two bounds must both hold and "
        "this row proves the second one is asked at all",
        [(RAILS, "  if (globally >= spawner.maxConcurrent.global) {",
          "  if (globally > spawner.maxConcurrent.global) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is how the global bound
        # counts, through `liveSpawns`, and that bound is gone. The card says "no fan-out cap", and
        # `liveSpawns` no longer exists in `runtime-host.ts`. Its anchor is left stale, so the
        # census records it retired.
        "M21 · 🔴 the global bound counts EVERY live conversation instead of the spawned ones · a "
        "person with nine windows open disables spawning, which is a rail refusing a human act — "
        "the one shape of rail HO-005 says this slice must not ship",
        [(HOST, "      liveSpawns: () => slots().filter((slot) => slot.spawnedBy !== null).length,",
          "      liveSpawns: () => slots().length,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is the per-parent count
        # feeding the fan-out cap, and D-014 removed it on purpose ("no fan-out cap"). The
        # `spawnedBy === parentSessionId` counter no longer exists in src. Its anchor is left stale,
        # so the census records it retired.
        "M22 · ⚠️ the per-parent count is taken over every spawned slot rather than this parent's · "
        "one busy parent exhausts every other parent's allowance",
        [(HOST, "        slots().filter((slot) => slot.spawnedBy === parentSessionId).length,",
          "        slots().filter((slot) => slot.spawnedBy !== null).length,")],
    ),
    # ── §6 · HO-005 §3 · one live conversation per identity ───────────────────────────────────
    (
        "M23 · 🔴 HO-005 §3 · a profile that already has a live conversation gets a second · the "
        "rail the PO believed `(agent_profile_id, rotation)` already gave, and does not",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `profile-already-live` was replaced on purpose by the lookup ("the lookup (rows and slots
        # in flight, in the give's synchronous stretch)"), but the rule it enforced, one live
        # conversation per helper per giver, survives as: a second give to an identity the giver
        # already has REACHES that conversation and never starts a second. The plant makes the
        # lookup find nothing, so a profile that already has a live conversation gets another.
        # Killed by `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (HOST, '      helperAs: (giver, profileSlug) => this.helperAs(giver, profileSlug),', '      helperAs: () => null,'),
        ],
    ),
    (
        "M24 · ⛔ the refusal no longer names the live conversation · it is still right and it is no "
        "longer actionable, so the caller cannot message that conversation instead of spawning",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The old
        # refusal named the live conversation so the caller could message it instead; that duty
        # survives on the stall rule, which "NAMES" the stalled pieces (`its-work-has-stalled`
        # carries `stalled` labels, and the sentence says Follow up W1.x). The plant drops the
        # labels from the refusal detail: the refusal is still right and no longer actionable.
        # Killed by `the-rails-before-anything-can-reach-them.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece, so the same defect lands on that answer. NOT VERIFIED
            # ⚑ **W4.495 · re-homed onto the give's answer in the host, not retired** — F146: the stalls a give names are read when its answer is formed (`stallsIn`), not admitted by the rail, so the same defect lands there. NOT VERIFIED
            (HOST, "        ...(stalled.length === 0 ? {} : { stalled }),\n", "        ...(stalled.length === 0 ? {} : {}),\n"),
        ],
    ),
    (
        "M25 · ⚠️ the live-conversation check compares spellings rather than identities · a live "
        "`Worker` does not stop a spawn of `worker`, which 187/238 rule are one agent over one home. "
        "⚑ Anchor corrected by 347, which gave the reservation its own identity so the rail can see "
        "a launch in flight — the rule this row protects is unchanged and the line it lives on moved. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 459: the clause became an early return when the project "
        "clause joined it, so BOTH sides moved — the rule is still that the comparison folds",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Verified byte-identical
        # in today's tree: `if (identity === null || foldProfileName(identity) !== wanted) return
        # false` still appears exactly twice (the running-slot arm and D-017's own new 'a stopped
        # child counts too' arm added right beside it), matching the row's own recorded count_now of
        # 2. The comparison-folds rule is unchanged and, if anything, D-017 extended its surface
        # rather than removing it.
        # ⚠️ Widened by the landing to the LIVE check: 5206d835 added a second, stopped-children copy of
        # this line (profile-already-live counts stopped children), which the old anchor also matched.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # `liveChildAs` still compares a slot's spelling to `wanted` through `foldProfileName`, so a
        # live `Worker` must block a spawn of `worker`. bd70d693 reshaped the running-slot arm from
        # an early return into `return identity !== null && foldProfileName(identity) === wanted`,
        # and D-017's stopped-child arm keeps a second copy of the old line, so the anchor is made
        # unique by including the trailing `if (held !== undefined) return held.id` and the plant
        # hits only the running-slot arm.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # the live-conversation check compares identities, not spellings, survives in the lookup
        # (`Developer` and `developer` are one identity, and the rails test 'the lookup folds case'
        # stands). The old anchor is gone, and a plant on the reservation arm alone would SURVIVE
        # because the sequential test is answered by `newestChildAs`, whose identity id also folds.
        # So the plant compares the raw spelling on BOTH arms of `helperAs`. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (HOST, '      return identity !== null && foldProfileName(identity) === wanted\n    })\n    const found = reserved?.id ?? this.deps.store.newestChildAs(parents, profileSlug)\n    return found === null ? null : this.theOneInItsPlace(found)', '      return identity !== null && identity === profileSlug\n    })\n    const inRows = this.deps.store.newestChildAs(parents, profileSlug)\n    const found =\n      reserved?.id ??\n      (inRows !== null && this.deps.store.find(inRows)?.profileId === profileSlug ? inRows : null)\n    return found === null ? null : this.theOneInItsPlace(found)'),
        ],
    ),
    # ── §7 · criterion 11 · the folder ────────────────────────────────────────────────────────
    (
        "M26 · 🔴 criterion 11 · the folder is assumed usable instead of verified · 339's rule is "
        "replaced by a second, friendlier copy that always says yes, and the failure then arrives "
        "from the provider in the provider's words (303 C)",
        # ⚠️ **Anchor corrected by 371**, which reads the requested folder into a local so the
        # containment arms either side of this line can name it. ⛔ The DEFECT is unchanged.
        # ⚑ **…and again, in place, by `726`**: a relative folder is now made absolute from the
        # parent's own first (`placedAt`), and that is what the check is asked of.
        # ⚑ W4.189 · re-anchored in place, not retired — give_work's folder now also grants a
        # conversation the giver already has; the defect planted is the same.
        [(RAILS, "  const folder = facts.checkFolder(placedFrom(requested, giving.cwd))",
          "  const folder = { ok: true as const, path: placedFrom(requested, giving.cwd) }")],
    ),
    # ── §8 · criterion 10 · the request shape ─────────────────────────────────────────────────
    (
        "M27 · 🔴 criterion 10 · `.strict()` is gone, so an unrecognised key is STRIPPED · 303 B "
        "verbatim: a command arrives with eight keys, parses to seven, and the agent it spawned "
        "never starts, *looking exactly like a slow provider*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The commit
        # keeps the request shape as the first rail of R2 ("piece, may-not-assign-work, depth 6"
        # come after it), and `giveRequestSchema` is still `.strict()` so an undocumented key is
        # refused by name (303 B). The plant drops `.strict()` so the key is stripped. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, '  })\n  .strict()\n\nexport type GiveRequest', '  })\n\nexport type GiveRequest'),
        ],
    ),
    (
        "M28 · ⛔ criterion 8 · a spawn may arrive with no reason · *the parent gave no reason* and "
        "*this was not a spawn* become one row, and the provenance stops being auditable",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The why of a
        # give is now the piece's brief, and the rails test 'criterion 8 · a give with no brief is
        # refused by the schema, before anything exists' was rewritten from this row's killer. The
        # plant lets a whitespace-only brief through, so a give with no reason is admitted and the
        # provenance is unauditable. Killed by `the-rails-before-anything-can-reach-them.test.ts`.
        [
            ('apps/desktop/src/main/runtime/spawn-rails.ts', "  .refine((value) => value.trim() !== '', 'must say something')", "  .refine(() => true, 'must say something')"),
        ],
    ),
    # ── §9 · criterion 8 · the provenance ─────────────────────────────────────────────────────
    (
        "M29 · ⛔ the provenance is never written · `parent_session_id` goes back to being a shape "
        "204 landed and nothing writes, which is the sentence this dispatch exists to delete",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Provenance is
        # one column now, `provider_session.parent_session_id`, and the rails test 'criterion 8 ·
        # who created this ... is still there after a second host over one ledger' asserts
        # `reborn.parentOf(given.owner)` equals the giver. The old `record.spawn` branch is gone, so
        # the plant writes NULL where the parent belongs, leaving the column a shape nothing fills.
        # Killed by `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (STORE, '      spawnSql().writeParent.run(record.parentSessionId, record.id)', '      spawnSql().writeParent.run(null, record.id)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The killer test records it:
        # "D-016 · three cases went with the three provenance columns — `spawned_at` earlier than
        # the row, a row holding only PART of the provenance, and no row holding one column without
        # the other two. The one migration made `parent_session_id` the only column left, and the
        # piece holds the why." The commit message says "The database is ONE migration,
        # 0000_the_tree", and `spawned_at` appears nowhere in apps/desktop/src. Its anchor is left
        # stale, so the census records it retired.
        "M30 · 🔴 `spawned_at` becomes a second copy of `created_at` · the transaction's own clock "
        "is written into both, so the one timestamp that says when the DECISION was made is lost "
        "and the column carries nothing `parent_session_id IS NOT NULL` did not already",
        [(STORE, "        record.spawn.at,\n        record.spawn.reason,",
          "        at,\n        record.spawn.reason,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Same D-016 note in the rails
        # test: the row "holding only PART of the provenance" case went with the three provenance
        # columns, and `spawned_at` and `spawn_reason` no longer exist in the one migration
        # `0000_the_tree` (grep of apps/desktop/src finds neither). With `parent_session_id` the
        # only column left, a partial provenance row cannot be made. Its anchor is left stale, so
        # the census records it retired.
        "M31 · ⚠️ a row holding only PART of the provenance is reported as a spawn · *who created "
        "this* is answered and *why* is null, and criterion 8 asks for both",
        [
            (
                STORE,
                "      if (row.parent_session_id === null || row.spawned_at === null || row.spawn_reason === null) {",
                "      if (row.parent_session_id === null) {",
            )
        ],
    ),
    # ── §10 · the payload, and the vocabulary ─────────────────────────────────────────────────
    (
        "M32 · ⛔ every refusal claims to be retryable · a model is told to come back against a rail "
        "only a person can change, which is how a permanent refusal becomes a spin",
        [(RAILS, "  return permanenceOf(rail) === 'while-this-holds'", "  return true")],
    ),
    (
        "M33 · ⚠️ a permanent rail is reported as transient · `unknown-profile` — a typo — tells the "
        "caller the world will change on its own, and nothing about it will",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The permanence
        # table survives in spawn-rails.ts, and the typo rail is now `no-such-profile` (R3,
        # permanent), so the row re-anchors on the renamed key. The plant reports it as
        # `while-this-holds`, telling a caller the world will change on its own. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, "  'no-such-profile': 'permanent',", "  'no-such-profile': 'while-this-holds',"),
        ],
    ),
    (
        "M34 · 🔴 one rail answers with another rail's sentence · 340's `M24` in this vocabulary: "
        "the refusal is right and every word of the reason is a lie, and only a distinctness census "
        "over the whole list can see it",
        # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads, and again after 675’s review (675 §1); The DEFECT this row plants is unchanged.
        # ⚑ **710 · re-anchored in place, not retired** — `710` R53 named the wake's identity in this sentence's last line; the row still answers with another rail's sentence.
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives, and so does its
        # census: no two spawn rails may answer with the same sentence ('no two rails answer with
        # the same sentence'). Only the carrier rail `not-in-can-spawn` was deleted. Re-verified RED
        # alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # distinctness census over the whole vocabulary survives ('no two rails answer with the same
        # sentence'), and `too-deep` and `no-such-profile` are both in the give's vocabulary. The
        # plant gives `too-deep` the no-such-profile sentence verbatim, so the refusal is right and
        # its reason is a lie. Killed by `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, "    case 'too-deep':\n      return (\n        `Too deep to give: under ${detail.label ?? '?'} it would sit at depth ${String(detail.depth ?? '?')}, ` +\n        `past the ${String(detail.maxDepth ?? '?')} this agent may give. ` +\n        'Do it yourself, or ask whoever gave you your piece.'\n      )", "    case 'too-deep':\n      return (\n        'There is no agent by that name, so nothing was given: check the spelling — list_profiles ' +\n        'names every agent. To bring a new agent into existence under this name, give it again with ' +\n        `new: true. It asked for “${detail.profileId ?? '?'}”.`\n      )"),
        ],
    ),
    # ⚑ **`M35`'s anchor was CORRECTED by 374, and again by 419 — not retired either time.** `419`
    # widened `parseChoice` from *every column holding a `MessagingReach`* to *every column holding
    # ONE WORD*, and made its return the field's own value type — so the cast in the line below is
    # now `ProfileCapabilities[K]`. ⛔ **The rule is unchanged and now covers a THIRD choice column**:
    # an unreadable value folds to `narrowest`, never to `ruled`. ⚠️ **Re-applied and re-run
    # individually after the correction**, because a corrected anchor otherwise keeps a verdict it
    # never earned.
    #
    # ⚑ **`M35`'s anchor was CORRECTED by 374, not retired.** `374` generalised `parseCanMessage`
    # into `parseChoice`, which reads the field's own `vocabulary` and `narrowest` off the descriptor
    # instead of spelling three words in its body — so the line this row replaced no longer exists
    # and the row would otherwise have gone stale through a refactor rather than through a decision.
    # ⛔ **The rule is the same rule and it now covers BOTH choice columns**: an unreadable value
    # folds to `narrowest`, never to `ruled`. The replacement is the same defect said through the
    # descriptor. ⚠️ **Re-applied and re-run individually after the correction** — apply, run the
    # killer suite, restore from bytes — because a corrected anchor otherwise keeps a verdict it
    # never earned.
    (
        "M35 · ⛔ an unreadable choice column falls back to the ruled DEFAULT instead of the "
        "narrowest value · a typo in a column `schema.ts` could not afford a CHECK for becomes a "
        "widening, which is the property that fold exists to buy — and after `374` it is the "
        "widening of a MESSAGING rail rather than of a column nothing reads",
        [
            (
                STORE,
                "  return words.includes(stored) ? (stored as ProfileCapabilities[K]) : field.narrowest",
                "  return words.includes(stored) ? (stored as ProfileCapabilities[K]) : field.ruled",
            )
        ],
    ),
    (
        "M36 · ⚠️ an unreadable `max_concurrent` falls back to the ruled default · a corrupt column "
        "restores an allowance rather than removing one",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — the rule (an
        # unreadable count folds to the narrowest value, never back to the ruled allowance) survives
        # on the one count column left, max_depth. Re-verified RED alone.
        [
            (STORE, '  return Number.isInteger(stored) && stored >= 0 ? stored : 0', '  return Number.isInteger(stored) && stored >= 0 ? stored : fallback'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is the `can_spawn`
        # comparison's folding of the request, and that comparison was removed on purpose (card: "no
        # `can_spawn` / `not-in-can-spawn`"). Its anchor is left stale, so the census records it
        # retired.
        "M38 · ⛔ the `can_spawn` comparison stops folding the REQUEST · a grant of `worker` no longer "
        "admits a request spelled `Worker`, so an agent is told it may not be itself over a "
        "difference 187 and 238 rule is not a difference at all",
        [
            (
                RAILS,
                "  if (!spawner.canSpawn.includes(foldProfileName(asked.profileId))) {",
                "  if (!spawner.canSpawn.includes(asked.profileId)) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is how the `can_spawn` list
        # is stored and read (`parseSlugList`). D-014 made `can_spawn` "unread and unwritten" and
        # the card says "no `can_spawn`", so the fold is gone. Its anchor is left stale, so the
        # census records it retired.
        "M37 · ⛔ a `can_spawn` list is stored and read UNFOLDED · a grant spelled `Worker` grants "
        "nothing, because the identity the database keys is `worker`",
        [(STORE, "    return parsed.map((entry: string) => foldProfileName(entry))",
          "    return parsed.map((entry: string) => entry)")],
    ),
]
