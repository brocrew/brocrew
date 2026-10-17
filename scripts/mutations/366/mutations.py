"""366 · Nothing an agent creates runs unsupervised — each row is THE DEFECT, put back verbatim (131).

`341` shipped a rail called `laxer-approval-mode`: a spawn may not ask for a laxer approval mode than
the conversation asking for it. ⛔ **That is a COMPARISON, and a comparison inherits.** The moment
BroBot itself runs in `auto` — which it does — every descendant could be spawned into `auto` too, and
on Codex `auto` is `danger-full-access`: this machine's whole reach, nothing asked, nobody watching.

⚑ **HO-011 §3.1 replaced it with an absolute:** a conversation an agent creates may **never** run
without prompts, regardless of parent, regardless of BroBot's own mode. `spawn-must-prompt` is that
rail, asked third — after the shape and the kill switch, and before anything that touches the world.

🔴 **The rail it replaced could no longer fire, and nothing in the suite noticed.** Every §2 guard
still passed: it had a permanence, a distinct sentence, a row in the derivation table. All of them
ask what a rail SAYS; none of them asked whether anything reaches it. `M8` is that gap, closed.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`, `M4`, `M5`, `M7` | ⚑ **`run_suite desktop`** — `the-rails-before-anything-can-reach-them.test.ts` §1/§2 |
| `M2`, `M3` | ⚑ **`run_suite desktop`** — the same file's two ORDER tests, which is all that can see a placement |
| `M6` | ⚑ **`run_suite desktop`** — `the-five-tools.test.ts`, the only place a dropped tool argument shows |
| `M8` | ⚑ **`run_suite desktop`** — the reachability census, against a rail nothing refuses with |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `const approvalMode = asked.approvalMode ?? 'ask'` becoming the literal `'ask'`.**
With `M1` intact the two are the same value on every path, so the row would change nothing and report
as a survivor — `a-mutation-that-changes-nothing-reports-as-a-survivor`. ⚠️ **The line still earns
its comment**: it is what keeps `M1` killable, because a hardcoded `'ask'` would go on producing
prompting children with the door standing open.

⛔ **No row that re-introduces the parent comparison.** `ParentSession` no longer carries an approval
mode, so `parent.approvalMode === 'ask'` is a COMPILE error rather than a red suite — measured:
`spawn-rails.ts(497,81): error TS2339`. This harness's gates are the vitest projects, so such a row
is unkillable here by construction (`361`'s rule). The type is the guard; `M2` covers the placement.

⛔ **No row on the census's prose strip being removed.** A strip that stops stripping is invisible
until a retired rail exists, and retiring one turns §1 red first — so the row would be killed by
something other than the rule it is about. `M8` mutates the DOOR instead, which is the shape that
actually measures the census.

## 🔴 499 · THE RULE THIS TABLE WAS WRITTEN FOR IS WITHDRAWN

⛔ **`HO-036` withdrew `HO-011` §3.1 and restored inherit-never-widen.** The PO's own words: *"my
override of the rule you had already built, and it does not survive contact with the person using
it"*, against the person's experience — *"stopping every 3 seconds to allow something is shitty
experience"* — from a person who turns yolo on for BroBot **knowing BroBot creates projects and
staffs them**. ⚑ `spawn-must-prompt` is gone; `wider-than-its-parent` stands in its place and
compares what each mode REMOVES rather than what it is called, because `499` §2 measured that `auto`
takes an OS sandbox off on Codex and never had one to take off on Claude.

⚠️ **Three of these eight rows died with the rule and five survived it.** The split is the whole of
what this section records, and it is the test of whether an anchor correction is honest.

⛔ **RETIRED — the defect each names is now the SHIPPED behaviour, so correcting the anchor would
mean inventing a rule the door lacks:**

 - **`M1`** — *the door stops refusing, so an agent in yolo spawns children in yolo.* ⚑ That is
   precisely what HO-036 asks for. The live rule it becomes — *the door stops COMPARING* — is
   `499` M1, which is a different mutation with a different killer.
 - **`M2`** — *the rail is asked LAST instead of third.* ⛔ **Last is now the shipped placement**, and
   deliberately: a comparison needs the parent's mode and the child's provider, and the provider is
   not resolvable until `unknown-profile` has agreed the identity exists. `499` M3 carries the
   placement claim that survives — the kill switch still answers first.
 - **`M5`** — *the refusal says a person could change it.* 🔴 **A person CAN**: their own approvals
   button is the switch this row's own argument said did not exist anywhere in the app, so
   `until-a-person-changes-it` is the shipped word and `permanent` is the defect. `499` M8 is that
   row, pointed the other way.

⚑ **CORRECTED IN PLACE — the rule survives HO-036 word for word and only the rail it fires on moved.
Table `366` has NO run artefact, so none of these inherits a verdict it did not earn:**

 - **`M3`** — the kill switch must still answer before this rail. Unchanged claim, new anchor.
 - **`M4`** — `THE_APP_ITSELF` is still not exempt, and `the-rails-before-anything-can-reach-them`
   still performs it.
 - **`M7`** — a rail wearing a retired rule's sentence is still the `340` defect, and the retired
   sentence is now **this dispatch's own**.
 - **`M8`** — a rail nothing refuses with still passes every §2 guard.
 - **`M6`** — untouched; `spawn_agent` still forwards `approval_mode`, and dropping it still means
   answering `ok` to a request the door would have refused.
"""

from __future__ import annotations

RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

# ⛔ **499 · every constant below was re-aimed or retired** (HO-036). The rail this table was
# written for — `spawn-must-prompt`, *never `auto`, regardless of parent* — was WITHDRAWN by the PO,
# and `wider-than-its-parent` stands in its place with a comparison instead of an absolute. See the
# docstring's 499 section for which of the eight rows survived that and which did not.
THE_RAIL = """  if (alsoRemoves.length > 0) {
    return no('wider-than-its-parent', {
      asked: approvalMode,
      spawnerRunsAs: parent.approvalMode,
      alsoRemoves,
    })
  }
"""
THE_SWITCH = "  if (!facts.spawningEnabled()) return no('spawning-disabled')\n"
THE_DERIVATION = "  const approvalMode = asked.approvalMode ?? parent.approvalMode"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 THE DEFECT, verbatim: the door stops refusing, so an agent in yolo spawns children "
        "in yolo — HO-011 §3.1's whole subject, and `341`'s behaviour restored exactly "
        "⛔ RETIRED BY 499 — THE RULE IS WITHDRAWN, NOT THE ANCHOR",
        [(RAILS, "  if (asked.approvalMode === 'auto') return no('spawn-must-prompt')\n", "")],
    ),
    (
        "M2 · ⛔ the rail is asked LAST instead of third · the plausible mistake: it reads like the "
        "authority check it replaced, which lived down there — and now a spawn wanting `auto` is "
        "told its parent is gone, or that a name it spelled belongs to nobody, before it is refused "
        "⛔ RETIRED BY 499 — LAST IS NOW THE SHIPPED PLACEMENT",
        [
            (RAILS, "  if (asked.approvalMode === 'auto') return no('spawn-must-prompt')\n", ""),
            (
                RAILS,
                "  const approvalMode = asked.approvalMode ?? 'ask'",
                "  if (asked.approvalMode === 'auto') return no('spawn-must-prompt')\n  const approvalMode = asked.approvalMode ?? 'ask'",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** D-038
        # rewrote `wider-than-its-parent` to compare reach, and its own docblock in spawn-rails.ts
        # now says '⚠️ **No give meets it today.** A conversation a give starts runs in its giver's
        # mode, and a same-mode pair is never wider … ⏸ It stands as the guard on that inheritance'
        # (held for a ruling, D-038 F-A and F-B). The order of the kill switch against an arm that
        # cannot fire is unobservable, so any plant of this row is an equivalent mutant that no test
        # can turn red. The rail's own rule is re-anchored on its derivation under 499 M1. A second
        # agent found the rail kept as a guard and its order still observable with the comparison
        # planted; that defect, the kill switch asked after the rail, is now row 1038 M10 on today's
        # text, with a killer, so this row is retired rather than duplicated. Its anchor is left
        # stale, so the census records it retired.
        "M3 · ⛔ the rail is asked BEFORE the kill switch · the plausible mistake: strictest first "
        "looks like the safe order — and it shadows the one sentence a caller needs when spawning "
        "is switched off app-wide, sending it to fix a mode that was never going to be the reason",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The order rule
        # survives: the commit message gives give_work's admission as "...then the switch,
        # can_create_agents, wider-than-its-parent and the profile rule", and the test 'the kill
        # switch still answers first, because that is the more important sentence' still stands. The
        # old `approvalMode`/`parent` names are gone and the rail's inputs (`provider`,
        # `approvalMode`) are derived after the switch, so a literal move would hit a TDZ
        # ReferenceError. The plant therefore deletes the switch line first and re-inserts it after
        # the wider rail block, so the rail is asked first. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, "  if (!facts.spawningEnabled()) return no('spawning-disabled', { profileId: asked.profile })\n", ''),
            (RAILS, "  if (alsoRemoves.length > 0) {\n    return no('wider-than-its-parent', {\n      asked: approvalMode,\n      spawnerRunsAs: giving.approvalMode,\n      alsoRemoves,\n      profileId: asked.profile,\n    })\n  }\n", "  if (alsoRemoves.length > 0) {\n    return no('wider-than-its-parent', {\n      asked: approvalMode,\n      spawnerRunsAs: giving.approvalMode,\n      alsoRemoves,\n      profileId: asked.profile,\n    })\n  }\n  if (!facts.spawningEnabled()) return no('spawning-disabled', { profileId: asked.profile })\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-027, the ui stretch to 3ef68f7f and D-038):** Same cause
        # as 366 M3: after D-038 (`dc5f3f4c`) the rail compares reach and no give the door can make
        # meets it, because a child always starts in its giver's mode and a same-mode pair is never
        # wider. Exempting the app itself (`by !== null && …`) from an arm that never fires changes
        # no verdict, so no test can fail. The rail's rule lives on in 499 M1's re-anchor at
        # `whatTheChildWouldLack`. Its anchor is left stale, so the census records it retired.
        "M4 · 🔴 the app itself is exempted · the plausible mistake: `THE_APP_ITSELF` already walks "
        "past `not-your-parent`, so trusting it here reads like consistency — and it re-opens the "
        "whole rule, because everything the app does on an agent's behalf comes through that symbol",
        [
            (
                # ⚑ ANCHOR CORRECTED IN PLACE BY 499 — the rule survives HO-036 word for word
                # (`the-rails-before-anything-can-reach-them.test.ts` still performs it); only the
                # rail it fires on has changed. ⚠️ Table `366` has NO run artefact, so this
                # correction inherits no verdict it did not earn.
                RAILS,
                "  if (alsoRemoves.length > 0) {",
                "  if (by !== null && alsoRemoves.length > 0) {",
            )
        ],
    ),
    (
        "M5 · ⛔ the refusal says a person could change it · the plausible mistake: it SOUNDS like "
        "the stronger word — and it is the grant nobody can give, sending a model off to ask for a "
        "switch that does not exist anywhere in this app "
        "⛔ RETIRED BY 499 — THE SWITCH NOW EXISTS AND THE SHIPPED WORD IS THE OTHER ONE",
        [
            (
                RAILS,
                "  'spawn-must-prompt': 'permanent',",
                "  'spawn-must-prompt': 'until-a-person-changes-it',",
            )
        ],
    ),
    (
        "M6 · 🔴 `spawn_agent` drops `approval_mode` before the door sees it · the plausible "
        "mistake: the rail refuses it anyway, so why forward it — and the tool then answers `ok` to "
        "a request for yolo, starts a prompting child, and the model never learns the rule exists",
                # ⚠️ **Anchor corrected by 371**, which replaced the destructure with a
                # data-driven translation. ⛔ The DEFECT is unchanged: the field is dropped on the way
                # to the door, so rail 3 never sees the value it exists to refuse.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds. Rail 3 on spawn_agent (approval_mode refused) is now the door's
        # `.strict()` giveRequestSchema refusing the key `approval_mode` as malformed-request. That
        # is only true while the tool layer hands args to host.giveWork VERBATIM (agent-tools.ts
        # says so), so dropping the key on the way to the door is still the plausible mistake: the
        # tool then answers ok to a request it should refuse, and the model never learns a give
        # carries no approval mode. The plant strips only approval_mode (Object.fromEntries over
        # Object.entries), not the whole key set. That keeps it apart from 371's row on the same
        # call, and the `priority` case still refuses, so the red is specific to approval_mode. It
        # compiles: giveWork takes `input: unknown`. Killed by `the-five-tools.test.ts`.
        [
            (TOOLS, '            given = await host.giveWork(args, by)\n', "            given = await host.giveWork(\n              Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'approval_mode')),\n              by,\n            )\n"),
        ],
    ),
    (
        "M7 · ⛔ the rail wears the retired rule's sentence · the plausible mistake: the old words "
        "were already written and still read well — and they state a COMPARISON, so the refusal is "
        "right and the reason is a lie (340), which the distinctness walk cannot see",
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `wider-than-its-parent` is still in the admission and its sentence must state
        # the comparison, not the retired 'always asks before it acts' claim. The sentence moved to
        # 'Giving this would have started a conversation that runs with fewer protections than you,
        # ' in `describeRail`. The plant puts the retired rule's opening back on that line. Killed
        # by `the-rails-before-anything-can-reach-them.test.ts`.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-038's commit says 'The refusal puts the act first ("Do this work here, or ask a person
        # whether to change your approval mode.") and says which protections the giver keeps', so
        # the old 'Giving this would have started…' anchor is gone. The rule survives: the rail's
        # sentence must state the rule in force, not the retired spawn-must-prompt one, and the
        # distinctness walk alone cannot see that. The plant puts the retired rule's sentence in
        # place of the act-first clause, reachable because describeRail is called directly with
        # planted details. Killed by `the-rails-before-anything-can-reach-them.test.ts`,
        # `a-mode-a-child-inherits.test.ts`, `a-refusal-carries-its-remedy.test.ts`.
        [
            (RAILS, "        'Do this work here, or ask a person whether to change your approval mode. ' +\n", "        'A conversation you start always asks before it acts, and this one was asked to run with no questions. ' +\n"),
        ],
    ),
    (
        "M8 · 🔴 a rail in the vocabulary that nothing refuses with · THE GAP THIS DISPATCH FOUND: "
        "`laxer-approval-mode` sat here unreachable and every guard in §2 passed it, because they "
        "all ask what a rail SAYS and none asked whether the door reaches it. ⚠️ The planted rail is "
        "given a permanence and a sentence of its own on purpose — a bare name is caught by the "
        "sentence walks too, and would make this row a weaker instrument than the real defect was",
            # ⚑ ANCHORS CORRECTED IN PLACE BY 499 — the GAP is unchanged: a rail nothing refuses
            # with still passes every §2 guard, because they all ask what a rail SAYS.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: D-016's SPAWN_RAILS vocabulary still has the twin test 'every rail in the
        # vocabulary is REACHED by the door', which strips prose and requires `no('<rail>'` for
        # every rail. The old third anchor `case 'no-such-parent':` went with `spawn_agent`, so the
        # sentence is now planted before `case 'no-such-profile':`. The planted rail keeps its own
        # permanence, remedy and sentence so only the reachability walk can see it. Killed by
        # `the-rails-before-anything-can-reach-them.test.ts`.
        [
            (RAILS, "  'wider-than-its-parent',\n", "  'wider-than-its-parent',\n  'a-rail-nothing-reaches',\n"),
            (RAILS, "  'wider-than-its-parent': 'until-a-person-changes-it',", "  'wider-than-its-parent': 'until-a-person-changes-it',\n  'a-rail-nothing-reaches': 'permanent',"),
            (RAILS, "  'wider-than-its-parent': null,\n", "  'wider-than-its-parent': null,\n  'a-rail-nothing-reaches': null,\n"),
            (RAILS, "    case 'no-such-profile':", "    case 'a-rail-nothing-reaches':\n      return 'A rule that reads perfectly well and that nothing in this door has ever applied.'\n    case 'no-such-profile':"),
        ],
    ),
]
