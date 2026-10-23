"""442 · what an agent was actually told — each row is THE DEFECT, put back (131).

🔴 **Criterion 24 has two halves and they are priced differently** (HO-024 §4):

> **24** — *An agent's instructions are legible to him: what it was told, composed, as sent — and
> what a running session was given at its launch, kept with that session.*

⛔ **The second half is a durable write nobody has made**, and `442` §2.3 prices it rather than
building it. ⚑ **So the whole of this table is about the FIRST half and about the sentence that
keeps the second one honest** — because a surface that draws today's composition beside yesterday's
turns, with nothing saying which it is, is criterion 15's shape and is worse than a gap: it looks
correct.

## ⚑ The shape of the fix, and therefore the shape of this table

- **§1 · the sentence** (`M1`–`M6`) — `442` §2.2 calls it the deliverable *even if nothing else
  lands*. Six ways to lose it: soften it, reverse it, draw the earlier-life line when there is no
  earlier life, hide it when there is one, and put the whole thing behind a fold.
- **§2 · the registers** (`M7`–`M12`) — `438`'s vocabulary, reused rather than forked. An opaque
  layer that acquires bytes, a claim that loses its speaker, an observation that gains an author,
  and the fail-CLOSED filter going fail-open or going silent.
- **§3 · the layers** (`M14`–`M21`) — the order, the opaque base drawn rather than omitted, the
  positive *appended nothing*, and the paths-not-content rule.
- **§4 · the derived count** (`M22`–`M24`) — `442` §3.3: *derive it; never type a count*. The
  roster has grown twice this slice.
- **§5 · composed, as sent** (`M25`–`M27`) — the bytes the panel shows must be the bytes the
  adapter was handed, from one composition and not two.
- **§6 · the panel and its wiring** (`M28`–`M32`) — the chip, the attribute, the zero that must
  not be printed, the body an opaque layer must never grow, and the one place the relaunch fact is
  derived.

⚑ **The composition is its OWN row in the Info list, not a widening of the instructions block.**
The first draft widened it — retiring `158`'s rule 2 along with twelve other dispatches' anchors —
and the second one did not need to: rule 2 governs *what BroBot appended* and draws nothing when it
appended nothing, and this row answers a different question that has an answer on every
conversation. ⛔ **Nothing empty is drawn here either**, which is the only reason it may be
unconditional.
- **§7 · what reviewing this diff found** (`M33`) — a comparison against `null` that a shape
  predating the field walks straight past.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M5`, `M7`–`M12`, `M14`–`M27`, `M32`, `M33` | ⚑ **`run_suite desktop`** — `apps/desktop/test/what-an-agent-was-told.test.ts` |
| `M6`, `M28`–`M31` | ⚑ **`run_suite dom`** — `apps/desktop/test/dom/what-an-agent-was-told.dom.test.ts` |
| `M33` | ⚑ also **`run_suite dom`** — `apps/desktop/test/dom/instructions.dom.test.ts` |

⚠️ **Nineteen of the thirty-two are red in BOTH projects**, which is the shape of the criterion
rather than redundancy: a register spelled wrong is wrong in the projection that builds it and
wrong on the chip that draws it.

🔴 **`M23` was red in `dom` ALONE on its first pass, and the assertion was written rather than the
row re-aimed.** `verbsPublished` returns early for a registry that is absent, so its `: 0` branch
is reached only by a conversation whose frame arrived with **no declaration** — which the drawer
harness's transcript happens to be and which no unit case covered. ⚑ That case is now in
`what-an-agent-was-told.test.ts` §3 by name, and the row is red in both.

⚠️ **`M32` is a SOURCE census row and is caught in the `desktop` project**, not by a mount: the
pane is the only component that holds a `SessionRecord`, and no test in this app mounts it with
one. ⛔ That is a real limit of the guard and is written down rather than hidden — see the
response's findings.

⚠️ **Every row names the FILE that kills it, not the project**, and each was applied ALONE and
watched go red against that file — `verify-each-mutation-row-without-running-the-table`.
⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the durable snapshot.** `442` §2.3 forbids building it, so there is nothing to
mutate — a row there would be red against nothing and green against everything.

⛔ **No row on the block's LAYOUT.** The chip's box, the wrap at both real drawer widths and the
containment inside the info column are measured in
`test/dom/what-an-agent-was-told.dom.test.ts`; a CSS mutation lands on the BASE variant
(`a-style-mutations-control-is-the-state-it-falls-back-to`) and the census could not attribute the
red to a rule. ⚑ Filed rather than planted.

🔴 **`M13` was written, SURVIVED, and was REMOVED rather than re-aimed — with its reason.** It
zeroed `toldView`'s pass-through of the withheld count. ⛔ **No test could kill it, and the reason
is a property rather than a hole**: `toldView` builds every layer through the three constructors,
so it cannot produce an unlabellable one, and the count it forwards is therefore `0` on every
input the function can receive (`a-true-mutation-measures-nothing`, arriving through the input
rather than through the replacement). ⚑ **The rule it was reaching for is carried by `M12`**,
which mutates `drawableLayers` — the function that really does the filtering, exported for exactly
this reason and measured directly with a planted alien register. ⚠️ **The ids are not renumbered**:
this table has no `M13`, and that is the record.

⛔ **No row that makes `appendedNothing` read `injected.length === 0`.** It is a TRUE mutation:
`composeSystemHint([])` returns nothing, so the two expressions cannot disagree on any value this
app can build (`a-true-mutation-measures-nothing`).

🔴 **The hazard this table was written against, by name.** The five layers differ by ONE WORD in
places — *the provider's own instructions* / *files the provider found for itself* — and
`a-file-level-contains-cannot-tell-sibling-declarations-apart` is exactly that shape: a
`toContain` over the projection's file would be satisfied by a neighbour. ⚑ **So every §3 row is
killed by an assertion that looks up its own layer by KIND and reads that layer's own field**,
which is N assertions rather than one.
"""

from __future__ import annotations

import sys
from pathlib import Path

SHARED = "apps/desktop/src/shared/told.ts"
VIEW = "apps/desktop/src/renderer/src/lib/told.ts"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
READER = "apps/desktop/src/main/runtime/instructions.ts"
ROOT = "apps/desktop/src/main/index.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"

MUTATIONS = [
    # ── §1 · the sentence ──────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the surface claims to show WHAT THIS SESSION WAS GIVEN. "
        "⛔ `430` measured that nothing keeps it — *a resume rereads current files* — so the "
        "sentence is a confident-wrong claim about a conversation whose earlier turns were had "
        "with different text",
        [
            (
                SHARED,
                "  'Composed at this conversation’s most recent launch, from the files as they were then. ' +",
                "  'This is what this session was given at its launch. ' +",
            )
        ],
    ),
    (
        "M2 · ⛔ the clause that says nothing is KEPT is dropped, so the sentence describes a "
        "launch without admitting there is no record of any other one",
        [
            (
                SHARED,
                "  'The files are read again at every launch and no earlier composition is kept, so this is ' +\n  'what this identity is told now — not a record of what earlier turns were given.'",
                "  'This is what this identity is told now.'",
            )
        ],
    ),
    (
        "M3 · ⚠️ the earlier-life line says the app KEPT the older composition — the one thing "
        "`430` measured it does not do",
        [
            (
                SHARED,
                "  'as they were at that launch, and this app kept none of it.'",
                "  'as they were at that launch, and this app kept a copy of it.'",
            )
        ],
    ),
    (
        "M4 · ⛔ the earlier-life line is drawn on EVERY conversation, so a conversation opened "
        "once is told it has a history nobody kept — a hedge where the app actually knows",
        [
            (
                VIEW,
                "    earlier: relaunched ? TOLD_HAS_AN_EARLIER_LIFE : null,",
                "    earlier: TOLD_HAS_AN_EARLIER_LIFE,",
            )
        ],
    ),
    (
        "M5 · 🔴 …and the same line is drawn on NONE of them, which is the silent direction: the "
        "conversation the person reopens from last Tuesday says nothing at all about the turns above "
        "having been given different text",
        [
            (
                VIEW,
                "    earlier: relaunched ? TOLD_HAS_AN_EARLIER_LIFE : null,",
                "    earlier: null,",
            )
        ],
    ),
    (
        "M6 · ⛔ the scope sentence moves behind the disclosure with the documentation. ⚠️ A scope "
        "a reader has to open is a scope most readers never see, and this is the line `442` §2.2 "
        "calls the deliverable",
        [
            (
                PANEL,
                # ⚑ **583 · the sentence is on the `as sent` tab now**, at a new indentation and in
                # the `lead-short` register. ⛔ The defect is unchanged: `442` §2.2 calls this the
                # deliverable even if nothing else lands, and *not behind a fold* is the half that
                # makes it one — a scope a reader has to open is a scope most readers never see.
                # ⚑ **583's SELF-REVIEW moved it again, and this row is why the move happened.**
                # ⛔ The first version of 583 put the sentence on the `as sent` tab — and a tab is a
                # press, so `442` §2.2's rule was broken with a different lid. ⚠️ It stands above
                # the strip now, on every tab, which is the only position that satisfies the rule
                # the row enforces.
                '    <div class="muted standing" data-cy="told-sentence">{{ told.says }}</div>',
                '    <div v-if="whyTold" class="muted standing" data-cy="told-sentence">{{ told.says }}</div>',
            )
        ],
    ),
    # ── §2 · the registers ─────────────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 a layer this app READ is labelled as something else's claim — `438`'s register "
        "vocabulary inverted on the one layer whose bytes we actually hold",
        [
            (
                SHARED,
                "  return { id, kind, register: 'observed', title, says, text, paths: [], count, saidBy: null }",
                "  return { id, kind, register: 'claimed', title, says, text, paths: [], count, saidBy: null }",
            )
        ],
    ),
    (
        "M8 · ⛔ a CLAIM loses its speaker. *A claim with no author is a rumour*, and the speaker "
        "is in the signature precisely so this cannot be forgotten",
        [
            (
                SHARED,
                "  return { id, kind, register: 'claimed', title, says, text: null, paths, count, saidBy }",
                "  return { id, kind, register: 'claimed', title, says, text: null, paths, count, saidBy: null }",
            )
        ],
    ),
    (
        "M9 · 🔴 a claimed layer starts carrying TEXT — the paths we were given, presented where "
        "content belongs. ⚠️ `442` §2.1: *a path is not content, and a surface that shows a path "
        "where content belongs must say which it is showing*",
        [
            (
                SHARED,
                "  return { id, kind, register: 'claimed', title, says, text: null, paths, count, saidBy }",
                "  return { id, kind, register: 'claimed', title, says, text: paths.join('\\n'), paths, count, saidBy }",
            )
        ],
    ),
    (
        "M10 · ⛔ the OPAQUE layer is drawn as something the engine watched, which is the "
        "strongest false claim available here: this app has never held a byte of it",
        [
            (
                SHARED,
                "    register: 'unknown',\n    title,\n    says,\n    text: null,",
                "    register: 'observed',\n    title,\n    says,\n    text: null,",
            )
        ],
    ),
    (
        "M11 · 🔴 `canBeDrawn` goes FAIL-OPEN · a register this window cannot label is drawn "
        "anyway, with an empty chip beside it. ⛔ `an-unenumerated-state-counts-as-success`, with "
        "the stakes inverted",
        [
            (
                VIEW,
                "  return Object.prototype.hasOwnProperty.call(REGISTER_WORDS, layer.register)",
                "  return layer.register !== undefined",
            )
        ],
    ),
    (
        "M12 · ⚠️ the withholding becomes SILENT — the layer is dropped and the count is not "
        "stated. ⛔ A silent drop is the omission HO-024 §5.3 forbids by name",
        [
            (
                VIEW,
                "  return { layers, withheld: built.length - layers.length }",
                "  return { layers, withheld: 0 }",
            )
        ],
    ),
    # ── §3 · the layers ────────────────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 THE OMISSION `442` §2.1 FORBIDS · the provider's own layer is drawn only when "
        "the provider reported files of its own. ⛔ On every other conversation the list then "
        "reads as a complete account of the prompt while missing the largest part of it",
        [
            (
                VIEW,
                "  built.push(\n    opaqueLayer(\n      'told:provider-base',",
                "  if (instructions.provider.length > 0)\n    built.push(\n    opaqueLayer(\n      'told:provider-base',",
            )
        ],
    ),
    (
        "M15 · ⚠️ the opaque layer stops saying that this app ADDS to the provider's prompt rather "
        "than replacing it — the clause both adapters' own code is the evidence for",
        [
            (
                VIEW,
                # ⚑ **583 · the anchor's BYTES moved and its subject did not** (standing rule 27).
                # ⛔ *Underneath everything BELOW* was a claim about the page, and 583 made the
                # page a tab strip — everything this layer is underneath is now on five other
                # tabs and is not in the document while this one is selected (rule 8.1, swept
                # because the sentence was TRUE when it shipped). ⚠️ The clause this row is
                # about — *it has never held a byte of this layer* — did not move.
                "      'Underneath everything this app added. It adds to the provider\u2019s prompt and never replaces ' +\n        'it, ' +\n        'and it has never held a byte of this layer \u2014 so nothing here can show you what it says.',",
                "      'Underneath everything this app added. It probably leaves the rest alone.',",
            )
        ],
    ),
    (
        "M16 · ⛔ the app's own text is drawn UNDERNEATH the provider's own, which is the one "
        "ordering fact this app can state from its source — and states backwards",
        [
            (
                VIEW,
                "  const drawable = drawableLayers(built)",
                "  built.push(built.shift()!)\n  const drawable = drawableLayers(built)",
            )
        ],
    ),
    (
        "M17 · 🔴 a composed layer is drawn for a conversation this app appended nothing to — an "
        "`app-composed` row with no bytes in it, on the provider that reads its own files",
        [
            (
                VIEW,
                "  if (composed !== null) {",
                "  if (composed !== undefined) {",
            )
        ],
    ),
    (
        "M18 · ⚠️ …and the POSITIVE statement that nothing was appended is never made, so the "
        "absence of a layer is left to be noticed rather than said",
        [
            (
                VIEW,
                "    appendedNothing: composed === null,",
                "    appendedNothing: false,",
            )
        ],
    ),
    (
        "M19 · ⛔ the agent's memory layer stops naming the files it covers, so the one thing this "
        "app can say about a layer whose bytes it may not present is gone too",
        [
            (
                VIEW,
                "        memory.map((item) => item.path),\n        memory.length,",
                "        [],\n        memory.length,",
            )
        ],
    ),
    (
        "M20 · 🔴 the provider-discovered layer is attributed to BROBOT. ⛔ `086`: a reader who "
        "cannot tell two provenances apart edits the wrong file — and here the wrong owner is the "
        "app itself, on the one list `158` split out to avoid exactly this",
        [
            (
                VIEW,
                "        'The provider reported loading these. This app did not fetch them to build the list and ' +\n          'holds no text for them — what you have here are paths, not content.',\n        'the provider',",
                "        'The provider reported loading these. This app did not fetch them to build the list and ' +\n          'holds no text for them — what you have here are paths, not content.',\n        'BroBot',",
            )
        ],
    ),
    (
        "M21 · ⚠️ the agent-store layer is drawn as an OBSERVATION. ⛔ This app read those bytes, "
        "but that the PROVIDER put them in front of the model is the provider's statement — and "
        "`317` §2.2's reach word is the whole reason the distinction exists",
        [
            (
                VIEW,
                "      claimedLayer(\n        'told:agent-store',",
                "      observedLayer(\n        'told:agent-store',",
            )
        ],
    ),
    # ── §4 · the derived count ─────────────────────────────────────────────────────────────────
    (
        "M22 · 🔴 the verb count is TYPED. ⛔ `442` §3.3: *derive it; never type a count* — the "
        "roster went from thirteen to fifteen inside this slice, and a number spelled here would "
        "have been wrong both times (`a-title-that-names-a-count-the-assertion-never-checks`)",
        [
            (
                VIEW,
                "  return declared ? declared.tools.length : null",
                "  return declared ? 15 : null",
            )
        ],
    ),
    (
        "M23 · ⛔ a conversation that has reported no toolset is drawn as one that was handed "
        "NONE. ⚠️ Zero is a claim; null is a statement about this app, and the two must not swap",
        [
            (
                VIEW,
                "  return declared ? declared.tools.length : null",
                "  return declared ? declared.tools.length : 0",
            )
        ],
    ),
    (
        "M24 · ⚠️ an UNDERSTATING inventory is totalled anyway. ⛔ `247` §3: *a registry that "
        "quietly undercounts is worse than none* — and a count that is quietly short is exactly "
        "the confident-wrong shape criterion 18 is about",
        [
            (VIEW, "  if (!tools || tools.dropped > 0) return null", "  if (!tools) return null")
        ],
    ),
    # ── §5 · composed, as sent ─────────────────────────────────────────────────────────────────
    (
        "M25 · 🔴 THE HALF OF CRITERION 24 THAT WAS NEVER MET · the composed string is not carried "
        "at all, so the panel is back to showing the per-file rows and none of the framing this "
        "app wraps around them — the preamble telling the model these instructions OVERRIDE its "
        "defaults, and one `Contents of …` header per block",
        [
            ("apps/desktop/src/main/providers/claude/instructions.ts", "      composed,\n    },\n", "      composed: null,\n    },\n"),
        ],
    ),
    (
        "M26 · ⛔ the provider that appends nothing is told it was sent something — `null` is a "
        "MEASUREMENT on that branch and this makes it a fabrication",
        [
            ("apps/desktop/src/main/providers/codex/instructions.ts", "      composed: codexComposed,\n", "      composed: codexComposed ?? 'Codebase and user instructions are shown below.',\n"),
        ],
    ),
    (
        "M27 · 🔴 the adapter stops being handed the field the panel draws, so the string on "
        "screen and the string in the prompt become two compositions that can disagree. ⛔ The "
        "rule `blockHeader` already states about the byte budget, broken one field over",
        # ⚑ Landing D-024, D-020 and D-021 · re-anchored in place, not retired — The rule survives:
        # the composition root must hand the adapter the reader's own value, not compose a second
        # one. D-024 moved the field it reads from `read.instructions.composed` to the reader's
        # channel answers, so the line is now `systemHint: read.systemHint ?? undefined,` (same
        # value as the panel's on Claude), with `firstTurnLead` handed beside it. The plant stops
        # handing the adapter that field, and the existing source-census assertion on that exact
        # line goes red. Killed by `what-an-agent-was-told.test.ts`.
        [
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The saved-methods index is kept out of records here; original defect, ID and killer retained.
            (
                ROOT,
                '        systemHint:\n          read.systemHint === null\n            ? undefined\n            : withTheLinesSent(read.systemHint, savedMethodsLines),',
                '        systemHint: undefined,',
            ),
        ],
    ),
    # ── §6 · the panel ─────────────────────────────────────────────────────────────────────────
    (
        "M28 · ⛔ the register chip loses its WORDS and keeps its box. ⚠️ A chip a person cannot "
        "read is a layer with no register, whatever the projection says",
        [
            (
                PANEL,
                "          {{ REGISTER_WORDS[layer.register].label }}",
                "          &nbsp;",
            )
        ],
    ),
    (
        "M29 · ⚠️ the chip's attribute reports the layer's KIND instead of how the app knows it. "
        "⛔ `163`: the attribute is the answer and the word is for the person — a test reading "
        "either one alone is satisfied by a panel that is wrong in the other",
        [
            (
                PANEL,
                '          :data-register="layer.register"',
                '          :data-register="layer.kind"',
            )
        ],
    ),
    (
        "M30 · ⛔ a layer nobody has counted prints its count anyway. ⚠️ `!== null` is the whole "
        "rule: a layer that really covers nothing must print `0`, and one nobody has reported on "
        "must print nothing at all",
        [
            (
                PANEL,
                '        <span v-if="layer.count !== null" class="count" :data-cy="`told-count-${layer.kind}`">{{',
                '        <span v-if="layer.count !== undefined" class="count" :data-cy="`told-count-${layer.kind}`">{{',
            )
        ],
    ),
    (
        "M31 · 🔴 an OPAQUE layer grows a body. ⛔ `430`: the Observer *can display them, not "
        "reconstruct missing provider layers* — and a document pane under *the provider's own "
        "instructions* is that reconstruction, drawn as though this app had the bytes",
        [
            (
                PANEL,
                # 🔴 **583 · the anchor held and the ROW went inert, which is the other way a row
                # dies** (`a-true-mutation-measures-nothing`,
                # `a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⛔ **Measured**: this
                # `v-if` used to run over all five layers, where a claimed or opaque one really
                # does carry `text: null` — so `!== undefined` drew a document pane under *the
                # provider's own instructions*, which is `430`'s reconstruction. ⚠️ **583 sent the
                # four layers with an owner to their owner's tab**, and the only layer left in the
                # account is `app-composed`, which `toldView` builds ONLY when `composed !== null`.
                # 🔴 So `!== null` and `!== undefined` are now the same question, and the row was
                # a survivor that measured nothing.
                #
                # ⚑ **The GUARD still earns its place** — `ToldLayer.text` is `string | null` and
                # deleting it is a compile error, which is the strongest version of this rule — so
                # the replacement is the one that is still a defect a person can see: the
                # composition disappears from the tab that exists to show it, which is criterion
                # 24's *composed, as sent* with nothing sent.
                '            <template v-if="layer.text !== null">',
                '            <template v-if="layer.text === null">',
            )
        ],
    ),
    (
        "M32 · ⚠️ the pane stops deriving the relaunch fact from the conversation's own record and "
        "hard-codes the reassuring answer. ⛔ `SessionRecord.liveFrom` is the only thing in this "
        "app that knows there was an earlier life, and this is the wire that carries it. ⚠️ 653: "
        "the HOST knows it too now (`HostedSession.liveFrom`) and tells the renderer on an "
        "`attached` hand-over — the record is still the one place the PANE reads it",
        [
            (
                PANE,
                '        :relaunched="props.record.liveFrom !== null"',
                '        :relaunched="false"',
            )
        ],
    ),    (
        "M33 · 🔴 THE DEFECT THIS DISPATCH PUT IN AND TOOK OUT · the composed field is compared "
        "against `null` without being normalised, so a `SessionInstructions` that predates the "
        "field — the shape `instructions.dom.test.ts` builds on purpose — draws an `app-composed` "
        "layer whose bytes are `undefined` AND loses the *appended nothing* sentence. ⛔ `317`'s "
        "lesson one field over: the type is a promise about NEW values",
        [
            (
                VIEW,
                "  const composed = typeof instructions.composed === 'string' ? instructions.composed : null",
                "  const composed = instructions.composed",
            )
        ],
    ),

]


def main() -> int:
    print(f"{len(MUTATIONS)} mutations defined; run them with ./mutate.sh", file=sys.stderr)
    print(f"table: {Path(__file__).parent.name}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
