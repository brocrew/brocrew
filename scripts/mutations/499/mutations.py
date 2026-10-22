"""499 · A mode a child inherits, and a word that is not the same word — each row is THE DEFECT (131).

`366` shipped `spawn-must-prompt`: *a conversation an agent creates may never run without prompts,
regardless of parent, regardless of BroBot's own mode.* ⛔ **`HO-036` withdrew it**, in the PO's own
words — *"my override of the rule you had already built, and it does not survive contact with the
person using it"* — against the person's: *"stopping every 3 seconds to allow something is shitty
experience"*, from a person who turns yolo on for BroBot **knowing BroBot creates projects and staffs
them**. ⚑ **What stayed is the half that was always the real rail**: a child cannot grant itself more
than its parent holds.

🔴 **And the thing the withdrawal did not know: `auto` is two acts with one spelling.** Measured, per
provider — on **Claude** it removes the CARD and nothing else (`permissionModeFor` returns
`'plan' | 'default'` and `bypassPermissions` has not been requested since `076`/`140`); on **Codex**
it removes the card **and an OS sandbox** (`read-only` → `danger-full-access`, on `thread/start`,
`thread/resume` and every `turn/start`). ⛔ So copying the word across a provider boundary WIDENS, and
`wider-than-its-parent` compares what each mode REMOVES.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`, `M2`, `M4`, `M5`, `M6`, `M7` | ⚑ **`run_suite desktop`** — `a-mode-a-child-inherits.test.ts` §1/§5, which walks all sixteen (parent, child) pairs through the real door |
| `M3` | ⚑ **`run_suite desktop`** — `the-rails-before-anything-can-reach-them.test.ts`, the kill-switch ordering test, which is all that can see a placement |
| `M8` | ⚑ **`run_suite desktop`** — `the-doors-our-own-verbs-do-not-need.test.ts` §4 and this dispatch's §5 policy-facts row |
| `M9` | ⚑ **`run_suite runtime`** — `a-mode-a-child-inherits.test.ts`'s biconditional against `APPROVAL_PROFILES` |
| `M10` | ⚑ **`run_suite desktop`** — the §3 census over the two shipped provider notes |
| `M11` | ⚑ **`run_suite desktop`** — §4's two-direction census over `YOLO_MEANS_FOR_AGENTS_IT_STARTS` |
| `M12` | ⚑ **`run_suite desktop`** — the restored `effectiveApprovalOf`'s strict fold, which `341` M18 also guards |

## ⛔ What this table deliberately does NOT contain

⛔ **No row that puts `spawn-must-prompt` back.** It is a retired vocabulary member; re-adding it
fails `a-mode-a-child-inherits.test.ts` §6 for the WRONG reason — the census reads the word, not the
rule — and `a-mutation-on-a-census-is-invisible-to-that-census` is the shape that would produce.

⛔ **No row on `MODE_REMOVALS` losing a member.** Dropping `'the-sandbox-around-an-act'` is a
compile error in three places at once (`WHAT_A_MODE_REMOVES`'s Codex row, `MODE_REMOVAL_SAID`'s
exhaustive `Record`, and the runtime test's `axes`), and `361`'s rule is that a row the gates cannot
make red is not carrying its rule. `M9` mutates the TABLE's row instead, which is the shape that
measures the binding.

⛔ **No row on the rail's position in `SPAWN_RAILS`.** The vocabulary's order is asserted directly by
`a-narrowing-that-means-something.test.ts` §7, so a row would be killed by a census reading a list
rather than by a door behaving differently. `M3` mutates the CALL's placement, which is the half only
a behaving door can see.

⛔ **No row making `whatTheModeRemoves` return `[]` for everything.** That is the emptied-field
control this dispatch reports under §3.1 of its brief, performed once and restored byte-exact — not a
row, because a table row must name a PLAUSIBLE mistake and hard-wiring a derivation to nothing is not
one.

⛔ **No row on the two `ask` entries.** `ask` removes nothing on either provider by construction, so
a mutation there is `a-true-mutation-measures-nothing` — the comparison reads the same on every pair.
"""

from __future__ import annotations

RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
MODES = "packages/runtime/src/approval-mode.ts"
CAPS = "apps/desktop/src/shared/capabilities.ts"
YOLO = "apps/desktop/src/renderer/src/lib/approval-mode.ts"

THE_RAIL = """  if (alsoRemoves.length > 0) {
    return no('wider-than-its-parent', {
      asked: approvalMode,
      spawnerRunsAs: parent.approvalMode,
      alsoRemoves,
    })
  }
"""
THE_SWITCH = "  if (!facts.spawningEnabled()) return no('spawning-disabled')\n"
THE_COMPARISON = """  const alsoRemoves = whatTheChildWouldRemoveAlso(
    { provider, approvalMode },
    { provider: parent.provider, approvalMode: parent.approvalMode },
  )
"""

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 THE DEFECT, verbatim: the door stops comparing, so a child may be given more than "
        "the conversation that started it — the half HO-036 explicitly did NOT withdraw, put back "
        "exactly as `341` had it before `366`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 499's rule (a
        # conversation a give starts may never be wider than its giver) survives as the
        # `wider-than-its-parent` rail in `admitGive`, now fed by `giving` (the giver) instead of
        # `parent`. The plant deletes the whole refusal block, so a wider child is admitted. This is
        # the D-016 card's own rail order: '...wider-than-its-parent, then the profile rule'. Killed
        # by `a-mode-a-child-inherits.test.ts`, `the-rails-before-anything-can-reach-them.test.ts`.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-038 renamed the comparison to `whatTheChildWouldLack`, and the door's refusal arm in
        # admitGive can no longer be made to fire (a child always runs in its giver's mode, so every
        # same-mode pair passes), so deleting it there is an equivalent mutant. The rule 'a child
        # may never be given more than its giver, any against none' survives in the derivation the
        # door calls and is pinned directly. The plant makes that derivation always answer 'no
        # wider', which is the comparison no longer being made. Killed by
        # `a-mode-a-child-inherits.test.ts`, `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (MODES, '  if (keeps(child).length > 0) return []\n  const kept = keeps(parent)\n  return PROTECTIONS.filter((one) => kept.includes(one))\n', '  return []\n'),
        ],
    ),
    (
        "M2 · ⛔ an omitted mode is defaulted to the strictest instead of INHERITED · the plausible "
        "mistake: `?? 'ask'` is what stood on this line from `366` until HO-036 and it is the safe-"
        "looking value — and it is the whole experience the PO withdrew a ruling to fix, because "
        "every child BroBot staffs a project with stops on its first command while its parent does "
        "not. ⚠️ Silent: nothing refuses, nothing is logged, and the child simply prompts",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # child's mode is always the giver's, never an omitted value defaulting to the strictest)
        # survives as `const approvalMode = giving.approvalMode` in `admitGive`. A give takes no
        # approval argument, so the plant pins the mode to `'ask'`. An `auto` giver's child then no
        # longer inherits its mode. Killed by `a-mode-a-child-inherits.test.ts`,
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, '  const approvalMode = giving.approvalMode\n', "  const approvalMode = 'ask'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** Same cause
        # as 366 M3: D-038's rewritten rail is a guard no give can reach ('No give meets it today',
        # spawn-rails.ts docblock added by dc5f3f4c; DEV's F-B holds it for a ruling), so the order
        # of the kill switch against it cannot be observed. The old anchor is also gone with
        # `alsoRemoves`. If a ruling makes the rail reachable (F-A refusing Claude ask → Codex ask),
        # the row should be re-planted then. A second agent found the rail kept as a guard and its
        # order still observable with the comparison planted; that defect, the kill switch asked
        # after the rail, is now row 1038 M10 on today's text, with a killer, so this row is retired
        # rather than duplicated. Its anchor is left stale, so the census records it retired.
        "M3 · ⛔ the rail is asked BEFORE the kill switch · the plausible mistake: strictest first "
        "looks like the safe order — and it shadows the one sentence a caller needs when spawning "
        "is switched off app-wide, sending it to fix a mode that was never going to be the reason",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # kill switch answers first, so spawning-off is never shadowed by a mode sentence) survives:
        # `spawning-disabled` is still checked before the start rails, with `wider-than-its-parent`
        # after it. The plant moves the switch to after the rail. It moves the switch rather than
        # the rail because `provider` and `approvalMode` are declared after the switch, and hoisting
        # the rail would throw a ReferenceError instead of failing for the label's reason. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, "  if (!facts.spawningEnabled()) return no('spawning-disabled', { profileId: asked.profile })\n", ''),
            (RAILS, "  const alsoRemoves = whatTheChildWouldRemoveAlso(\n    { provider, approvalMode },\n    { provider: giving.provider, approvalMode: giving.approvalMode },\n  )\n  if (alsoRemoves.length > 0) {\n    return no('wider-than-its-parent', {\n      asked: approvalMode,\n      spawnerRunsAs: giving.approvalMode,\n      alsoRemoves,\n      profileId: asked.profile,\n    })\n  }\n", "  const alsoRemoves = whatTheChildWouldRemoveAlso(\n    { provider, approvalMode },\n    { provider: giving.provider, approvalMode: giving.approvalMode },\n  )\n  if (alsoRemoves.length > 0) {\n    return no('wider-than-its-parent', {\n      asked: approvalMode,\n      spawnerRunsAs: giving.approvalMode,\n      alsoRemoves,\n      profileId: asked.profile,\n    })\n  }\n  if (!facts.spawningEnabled()) return no('spawning-disabled', { profileId: asked.profile })\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** The
        # subject, 'what each mode REMOVES', was removed on purpose: D-038's message says 'The
        # removal vocabulary (WHAT_A_MODE_REMOVES, whatTheChildWouldRemoveAlso, isNoWiderThan and
        # the rest) is gone' and that Claude auto → Codex auto, the pair this row's plant used to
        # separate, 'now passes'. The approval-mode.ts docblock states that today's verdicts equal a
        # comparison of the two words, so a words-reading plant is equivalent and cannot go red. Its
        # anchor is left stale, so the census records it retired.
        "M4 · 🔴 the comparison reads the two WORDS instead of what each mode REMOVES · THE DEFECT "
        "THIS DISPATCH FOUND, and the one a reader of HO-036 would write: `auto` is no laxer than "
        "`auto`, so a Claude parent's yolo authorises a Codex child's — and the child gets "
        "`danger-full-access`, a sandbox the person was never shown because Claude has none to show",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rail
        # compares what each mode REMOVES via `whatTheChildWouldRemoveAlso`, and that survives in
        # `admitGive`. The plant replaces the call with the naive `auto`-child-of-`ask`-giver
        # comparison, which misses the cross-provider cases (for example a Codex OS sandbox) that
        # the every-pair test enumerates. Killed by `a-mode-a-child-inherits.test.ts`,
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, '  const alsoRemoves = whatTheChildWouldRemoveAlso(\n    { provider, approvalMode },\n    { provider: giving.provider, approvalMode: giving.approvalMode },\n  )\n', "  const alsoRemoves =\n    approvalMode === 'auto' && giving.approvalMode === 'ask'\n      ? (['the-card-before-an-act'] as const)\n      : []\n"),
        ],
    ),
    (
        "M5 · ⛔ the child's provider is the PARENT's when the comparison is made · the plausible "
        "mistake: the token resolves it three lines down anyway, so reading `parent.provider` here "
        "looks like the same value one step earlier — and the rail then compares a Codex child "
        "against a Codex ceiling it does not have, which is `M4` arriving by a second route",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rail must
        # compare the CHILD's provider against the giver's provider, since a mode removes different
        # protections on different providers. That survives in the arguments to
        # `whatTheChildWouldRemoveAlso`. The plant passes the giver's provider for both sides, so a
        # cross-provider give is judged as same-provider. Killed by
        # `a-mode-a-child-inherits.test.ts`, `the-rails-before-anything-can-reach-them.test.ts`.
        [
            # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the comparison is asked only when the start has a provider (an agent whose conversations ran on both has none until a person chooses), so it is indented under that condition; same plant.
            (RAILS, "          { provider, approvalMode },\n          { provider: giving.provider, approvalMode: giving.approvalMode },", "          { provider: giving.provider, approvalMode },\n          { provider: giving.provider, approvalMode: giving.approvalMode },"),
        ],
    ),
    (
        "M6 · ⛔ the refusal's detail drops what the child would ALSO remove · the plausible "
        "mistake: `asked` and `spawnerRunsAs` look like the whole story and the rail's name says "
        "the rest — and on the cross-provider arm both are `auto`, so the caller is handed a "
        "contradiction with no way to tell why it was refused",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The refusal
        # detail must say WHAT the child would remove (`alsoRemoves`), since
        # `describeRail('wider-than-its-parent')` builds its sentence from it and falls back to 'a
        # protection you still have'. That field survives in the detail object. The plant drops it
        # from the detail. The wording code reads `detail.alsoRemoves ?? []`, so it degrades to the
        # generic phrase and does not throw. Killed by `a-mode-a-child-inherits.test.ts`,
        # `the-rails-before-anything-can-reach-them.test.ts`.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-038 renamed the detail key `alsoRemoves` to `wouldLack`, and the door can no longer
        # produce the refusal, so a plant on the detail object inside admitGive is unreachable. The
        # rule survives where it is observable: the refusal's sentence names the protections the
        # giver keeps ('with the card before you act'), and D-038's message says it 'says which
        # protections the giver keeps'. The plant makes describeRail ignore `wouldLack`, so the
        # caller reads only the generic 'a protection'. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`, `a-mode-a-child-inherits.test.ts`.
        [
            (RAILS, '(detail.wouldLack ?? []).map(', '[].map('),
        ],
    ),
    (
        "M7 · ⚠️ the set difference becomes a set EQUALITY · the plausible mistake: *never wider* "
        "reads like *the same* — and it refuses the narrowing direction too, so a yolo parent can "
        "no longer start a child that prompts, which is the one act nobody has ever needed to bound",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — `isNoWiderThan` went with D-038's removal vocabulary, but the rule 'never wider is not
        # the same' holds in `whatTheChildWouldLack`: a parent that keeps nothing lacks nothing, so
        # narrowing is never refused. The plant makes it a symmetric comparison, which refuses a
        # child that keeps what its parent does not. A second agent refuted the retirement. Killed
        # by `a-mode-a-child-inherits.test.ts`.
        [
            (MODES, '  if (keeps(child).length > 0) return []\n  const kept = keeps(parent)\n  return PROTECTIONS.filter((one) => kept.includes(one))\n', '  return PROTECTIONS.filter((one) => keeps(parent).includes(one) !== keeps(child).includes(one))\n'),
        ],
    ),
    (
        "M8 · ⛔ the refusal says this call can never succeed · the plausible mistake: `366` priced "
        "the door it replaced `permanent` and the word was right THEN — and now it tells a model "
        "*change the call, not the world* about a call the parent's own approvals button unblocks",
        [
            (
                RAILS,
                "  'wider-than-its-parent': 'until-a-person-changes-it',",
                "  'wider-than-its-parent': 'permanent',",
            )
        ],
    ),
    (
        "M9 · 🔴 the table stops saying Codex `auto` takes the sandbox off · the plausible mistake: "
        "the two rows look like they should be symmetric, and the sentence a person reads says it "
        "anyway — and the cross-provider widening then passes the rail silently",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — WHAT_A_MODE_REMOVES became the absolute WHAT_STANDS_PAST_ITS_FOLDER, where Codex `ask`
        # keeps the card and the sandbox and `auto` keeps nothing; the disclosure reads `ask` less
        # `auto`, which is the old 'Codex auto takes the sandbox off'. The rule survives: the table
        # must say Codex has an OS sandbox that auto removes. The plant drops the sandbox from
        # Codex's ask row. Killed by `a-mode-a-child-inherits.test.ts`,
        # `a-mode-a-child-inherits.test.ts`.
        [
            # This row follows the same behavior after provider facts moved into the registry.
            # ⚑ **provider registry · re-anchored in place, not retired** — The protection declaration is now a descriptor field; removing the sandbox from Codex Ask preserves the original incomplete disclosure.
            ("packages/shared/src/providers.ts", "        ask: ['the-card-before-an-act', 'the-sandbox-around-an-act'],\n        auto: [],\n", "        ask: ['the-card-before-an-act'],\n        auto: [],\n"),
        ],
    ),
    (
        "M10 · ⛔ the person-facing sentence states the WITHDRAWN rule · the plausible mistake: it "
        "is the sentence the capability sheet has rendered since `368` and it reads well — and it "
        "promises a person that a spawned conversation always prompts, on a door that now hands "
        "the parent's own mode down",
        # ⚑ Landing D-014 · re-anchored in place, not retired — D-014 re-wrapped SPAWN_RAIL_MEANS
        # and added 'latitude in its approval mode', which breaks the old one-line anchor.
        # Re-verified RED alone.
        [
            (CAPS, "  'A conversation an agent starts runs the way that agent does and can never be given more ' +\n  'latitude in its approval mode — the door refuses that. That buys the decision and not a ' +\n", "  'A conversation an agent starts can never open without prompts — the door refuses that, ' +\n  'whatever this app is running as. That buys the decision and not a ' +\n"),
        ],
    ),
    (
        "M11 · ⛔ HO-037 §1's half about the TREE names the wrong provider · the plausible mistake: "
        "Claude is the app's own default and the sentence has to name somebody — and a person "
        "reading it on a Codex conversation is told the sandbox stays on, which is the `086` defect "
        "in the direction that matters",
        [
            (
                YOLO,
                "  'Agents this conversation starts run in this mode too — and on Codex that also takes the ' +",
                "  'Agents this conversation starts run in this mode too — and on Claude that also takes the ' +",
            )
        ],
    ),
    (
        "M12 · ⚠️ a parent on its way BACK to prompting still counts as `auto` · `341` M18's rule, "
        "restored with the function `366` deleted · the plausible mistake: `approvalDisclosure` "
        "already reads `handle.approval` and reaching for `effective` alone looks like the same "
        "answer — and it is the LAXER of the two, so the entitlement a parent is giving up is spent "
        "on a child that will outlive the window in which it was true",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # giver on its way back to prompting counts as `ask` already) survives: `runningAs` in
        # runtime-host.ts still reads `approvalMode: effectiveApprovalOf(session)`. The plant
        # restores the laxer `handle.approval.effective` read that the function replaced. The
        # 'giving up its laxness' case in the rails test catches it. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (HOST, '      approvalMode: effectiveApprovalOf(session),\n', '      approvalMode: session.handle.approval.effective,\n'),
        ],
    ),
]
