"""578 · The conversation header.

⛔ **`EXT-010` §1, built directly because there is no designer.** ⚠️ The PO named five defects and
no shapes; the treatment decisions are this dispatch's, so the rows below are about the rules those
decisions became rather than about pixels.

## 🔴 A · the flex IS the priority, and that is `EXT-010` §1.2's whole repair

⛔ **The defect was a FLAT ROW.** *"`End conversation` clipped to `con`, on a window that is not
narrow… the header is a fixed row of pills competing for horizontal space with the one control a
person actually reaches for, and the pills are winning."* ⚑ Every item had the default
`flex-shrink: 1`, so the button a person reaches for gave way at exactly the same rate as a pill
nobody presses. **Three groups now, and which of them may give is the fix.**

⚑ **`M1` lets the ACTS shrink again** — the shipped defect, restored — and **`M2` lets the STANDING
shrink**, which is §1.4's *"if something has to give, it is not this"* given away in one line.

🔴 **Both are measured against a PLANTED hazard, and saying why is the honest half of this table.**
⛔ **Today's bar cannot overflow at any width the app can be**, because moving the three warnings
into their own band took ~500px of unshrinkable `nowrap` text out of the row — so the two rules
above are what keeps the priority true for the NEXT pill somebody adds, not what is holding the
line today. ⚠️ `the-conversation-header.dom.test.ts` §1 therefore puts a wide, unshrinkable element
into the state group and asks the question the rules answer (`put-the-hazard-on-the-path-the-code-walks`);
without it neither row could go red, and a row nothing can kill is not carrying its rule.

⛔ **A third row was WRITTEN HERE AND WITHDRAWN, and it is worth more than the row.** It removed a
`flex: 0 0 auto` on the lockup's CHILDREN, expecting the plate and the word to slide into each
other. 🔴 **It survived, because a `flex: 0 0 auto` group is sized by its own content** — nothing
inside it is ever under shrinking pressure, so the declaration changed no layout for any input
(`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ **The declaration was REMOVED rather
than kept with a row that measures nothing**: a redundant guard is a claim that the case exists,
which is `BackgroundTasks.detachedAs`' own lesson one component over.

## ⛔ B · a state word may not be styled as a control

🔴 **`EXT-010` §1.3**: *"All of them are state; none of them is pressable."* ⚑ Three bordered,
filled, 24px pills sat in a row with three bordered, filled, 30px buttons.

⛔ **`M3` gives the pill its box back** and **`M4` drops the standing to the size of everything
else** — the two halves of the same complaint, and `M4` is the one the PO said they would not trade
away for space.

## ⚠️ C · one fact, one location — and the DERIVATION, which nobody had noticed was two

⛔ **`M5` joins the host's rows back into the chip**, which is §1.1 verbatim: a summary sitting on
top of the detail it summarises.

🔴 **`M6`, `M7` and `M8` are about the half of §1.1 the PO could not have seen.** The chip rendered
`liveness.agent` — `describeModel`/`describeReasoning`, which answer *the provider's report, else
our request marked `(requested)`, else the not-reported token* — and the shelf rendered
`settings.model`, which is only the middle of those three. ⚑ **Two derivations of one word, six
inches apart** (`099`'s defect class). ⛔ `M6` puts the weaker one back, so a conversation nobody
picked a model for reads `Not reported` while the provider has named one. ⚠️ `M7` keys the row by
INDEX rather than by label, which is `a-fixed-width-slice-runs-into-the-next-region` with a
subscript: the day a third row is added, the effort is drawn under `MODEL`. ⛔ `M8` stops mapping
{@link PROVIDER_HAS_NOT_REPORTED}, so the host's own *nothing to say* token is drawn as a VALUE —
which is the shelf's founding rule (`389 §3`: a missing value is visibly missing ON ITS OWN) broken
by a string that looks like one.

## ⛔ D · the band, and the two ways it stops being honest

⚑ **`M9` draws it whenever there is a session**, which is `086`'s permanent claim charging height
to report the ordinary case — an empty amber strip on every conversation. ⛔ **`M10` takes the
grants out of the tooltip**, which is the one cut on this surface: the list is the only mark that
grows without bound, and a cut with nothing behind it is what `531`'s sweep exists to find.

## 🔴 E · the label announces, the attribute states

⛔ **`M11` reads `pendingPlanMode` where the cell states `planMode`** — `034/076`'s rule, which came
off the header's pill WITH the fact. ⚠️ A requested change would then read as a landed one, on the
one setting whose whole purpose is that a person can check it (`140`).

## ⛔ What this table does NOT cover

 1. **`standingOf` and `STANDING_LABEL`.** The vocabulary is `099`/`250`/`258`'s and this dispatch
    changed no byte of it; §2.2 of the brief asked whether it was COMPLETE, and
    `the-conversation-header.test.ts` §3 answers by driving every facet combination through it.
 2. **The yolo mark's words.** `367`'s disclosure ships unchanged and `a-mode-that-says-what-it-does.test.ts`
    pins it to the byte; what moved is which element it sits in.
 3. **`describeModel` / `describeReasoning`.** `179` owns them. ⚑ This dispatch replaced two `'…'`
    literals with the constant they now share with the renderer, and a row on that substitution
    would be `a-true-mutation-measures-nothing` — the value is identical either way. ⛔ The
    consequence is a TEST instead: `the-conversation-header.dom.test.ts` §5 plants the token on a
    host row and asserts the cell draws the map's word and not the token.
"""

HEADER = "apps/desktop/src/renderer/src/components/SessionHeader.vue"
STANDING_GRANTS = "apps/desktop/src/renderer/src/lib/standing-grants.ts"
SHELF = "apps/desktop/src/renderer/src/components/SessionShelf.vue"

MUTATIONS = [
    # ---- A · the flex is the priority ------------------------------------------------------------
    (
        "M1 · ⛔ **the acts may shrink again** · the shipped defect, restored: `End conversation` "
        "clipped to `con` on a window that is not narrow, because the button a person reaches for "
        "gives way at the same rate as a pill nobody presses",
        [
            (
                HEADER,
                ".header-acts {\n  display: flex;\n  flex: 0 0 auto;\n",
                ".header-acts {\n  display: flex;\n",
            )
        ],
    ),
    (
        "M2 · 🔴 **the standing may shrink** · `EXT-010` §1.4's *\"if something has to give, it is "
        "not this\"*, given away in one declaration — the most consequential fact on the screen "
        "yields to a provider name",
        [
            (
                HEADER,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 3edbf0629 added stable height; preserve it while restoring the same shrinking-standing defect.
                ".agent-standing {\n  display: flex;\n  min-height: calc(24px * 1.09 + 3px);\n  flex: 0 0 auto;\n",
                ".agent-standing {\n  display: flex;\n  min-height: calc(24px * 1.09 + 3px);\n",
            )
        ],
    ),
    # ---- B · state is text, controls are boxes ---------------------------------------------------
    (
        "M3 · ⛔ **a state word gets its button chrome back** · `EXT-010` §1.3: three bordered, "
        "filled pills in a row with three bordered, filled buttons, and the PO read the row as a "
        "toolbar because it looks like one",
        [
            (
                HEADER,
                "\n.liveness {\n  display: inline-flex;\n  flex: 0 0 auto;\n  align-items: center;\n",
                "\n.liveness {\n  display: inline-flex;\n  flex: 0 0 auto;\n  align-items: center;\n  border: 1px solid var(--line);\n  border-radius: var(--radius-pill);\n  background: var(--wash-1);\n",
            )
        ],
    ),
    (
        "M4 · 🔴 **the standing is drawn at the size of every other state word** · the defect "
        "`EXT-010` §1.4 is about, in one token: *\"same size, same weight, same treatment as "
        "`not planning`\"*",
        [
            (
                HEADER,
                # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
                # ⚑ **W4.638 · re-anchored in place, not retired** — the standing word is now cut at a bounded width, its whole on its title, so the rule opens with that; the plant still draws it at the size of every other state word
                ".standing-word {\n  overflow: hidden;\n  max-width: 56ch;\n  color: var(--text);\n  font-size: var(--type-small);\n",
                ".standing-word {\n  overflow: hidden;\n  max-width: 56ch;\n  color: var(--text);\n  font-size: var(--text-4xs);\n",
            )
        ],
    ),
    # ---- C · one fact, one location, and the derivation ------------------------------------------
    (
        "M5 · ⛔ **the chip joins the host's rows back in** · `EXT-010` §1.1 verbatim — a summary "
        "line sitting directly on top of the detail it summarises, an inch above the two cells "
        "that draw the same two facts",
        [
            (
                HEADER,
                "  if (!props.session) return props.defaultProvider ?? ''\n  return props.session.provider\n})",
                "  if (!props.session) return props.defaultProvider ?? ''\n  const rows = props.session.liveness.agent ?? []\n  return [props.session.provider, ...rows.map((row) => row.value)].join(' · ')\n})",
            )
        ],
    ),
    (
        "M6 · 🔴 **the cells read `settings` instead of the HOST'S row** · the weaker of the two "
        "derivations put back: on the ordinary conversation — nobody picked a model, the provider "
        "has named one — the strip says `Not reported` about a model that is running",
        [
            (
                SHELF,
                "    { key: 'model', label: 'Model', value: running('model'), absent: 'Not reported' },\n    {\n      key: 'reasoning',\n      label: 'Reasoning effort',\n      value: running('reasoning'),",
                "    { key: 'model', label: 'Model', value: reported(settings.model), absent: 'Not reported' },\n    {\n      key: 'reasoning',\n      label: 'Reasoning effort',\n      value: reported(settings.reasoningEffort),",
            )
        ],
    ),
    (
        "M7 · ⚠️ **the host's row is taken by INDEX rather than by label** · "
        "`a-fixed-width-slice-runs-into-the-next-region` with a subscript: `describeAgent` composes "
        "the array main-side, and the day a third row is added the effort is drawn under `MODEL`",
        [
            (
                SHELF,
                "  const row = (props.session.liveness.agent ?? []).find((one) => one.label === label)\n",
                "  const rows = props.session.liveness.agent ?? []\n  const row = rows[label === 'model' ? 0 : 1]\n",
            )
        ],
    ),
    (
        "M8 · ⛔ **the host's not-reported token is drawn as a VALUE** · the shelf's founding rule "
        "(`389 §3`: a missing value is visibly missing ON ITS OWN) broken by a string that looks "
        "like one — the cell reads `…` where it should read the map's own word",
        [
            (
                SHELF,
                "  if (row === undefined || row.value === PROVIDER_HAS_NOT_REPORTED) return null\n",
                "  if (row === undefined) return null\n",
            )
        ],
    ),
    # ---- D · the band ----------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # removed the band this row guards: "Out: the header's warnings band", with the `warned`
        # computed, the `header-warnings` element and its CSS. the-conversation-header.dom.test.ts
        # now pins that `header-warnings` is drawn for no fact at all, so an always-drawn amber
        # strip is the opposite of the shipped rule and has nothing to plant into. Its anchor is
        # left stale, so the census records it retired.
        "M9 · ⚑ **the band is drawn whenever there is a session** · `086`'s permanent claim "
        "charging height to report the ordinary case — an empty amber strip on every conversation "
        "that has nothing to warn about. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 579 relay 3, and the correction has a story worth the "
        "line: the OR lost its `approvalMode === 'auto'` term because the yolo mark moved onto the "
        "bar. ⛔ **`579` shipped the defect this row describes, for one commit** — mark moved, term "
        "left behind, and an ordinary yolo conversation drew a 13px amber strip with no text in "
        "it. ⚠️ **This row did not catch it, because the anchor had already gone stale in the same "
        "edit** — which is rule 27's shape exactly, and why the census refusing to write is worth "
        "more than the row. "
        "🔴 RE-VERIFIED BY HAND AT 579: applied alone, RED 1 — `the-conversation-header.test.ts` "
        "§2; restored from bytes and hash-checked",
                # ⚑ 739 · ANCHOR CORRECTED IN PLACE — the band gained a third mark (`736` F-1: the
                # grants *Always allow* kept, drawn apart), so the OR has three terms; the subject,
                # a band drawn whenever there is a session, is unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The header band rule
        # survives: `SessionHeader.vue`'s `warned` computed still returns `false` for a null session
        # and then ORs the marks that draw in the band, and `the-conversation-header.test.ts` §2
        # still pins it. Only the OR shrank to three terms on one line (`(hasACommander && !ended)`
        # became `session.hasACommander`), so the plant now replaces that one return with `return
        # true` (band drawn whenever there is a session).
        [
            (HEADER, '  return (session.blanketGrants?.length ?? 0) > 0 || props.kept.length > 0 || session.hasACommander\n', '  return true\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # removed the header-only grant titles on purpose: "Out: the header's warnings band (another
        # caller, not asked again, kept beyond this conversation) ... the header-only grant titles".
        # `notAskedAgainTitle` is deleted with the mark it titled; Info lists the grants in full, so
        # there is no cut left to lose the only copy. Its anchor is left stale, so the census
        # records it retired.
        "M10 · ⛔ **the grants leave the tooltip** · the one mark on this surface that grows without "
        "bound loses its recovery, so a cut takes the only copy — which is exactly the pattern the "
        "clipped-text census calls `shortened-on-purpose` and this row removes",
        [
            (
                # ⚑ 739 · ANCHOR CORRECTED IN PLACE — the title moved into `standing-grants.ts`
                # (`notAskedAgainTitle`, `730` F-1: *not asked again*, never *always allowed*); the
                # subject, the grants leaving the tooltip, is unchanged.
                STANDING_GRANTS,
                "  return `Not asked again here: ${listed.join(', ')}. ${HOW_THESE_GRANTS_END} Listed in the drawer, under Info.`",
                "  return `${HOW_THESE_GRANTS_END} Listed in the drawer, under Info.`",
            )
        ],
    ),
    # ---- E · the label announces, the attribute states --------------------------------------------
    (
        "M11 · 🔴 **the cell STATES what was requested** · `034/076`'s rule, which came off the "
        "header's pill with the fact: a queued plan change would read as a landed one on the one "
        "setting whose whole purpose is that a person can check it (`140`) · killed by `live-settings.render.test.ts` · killed by `the-agent-panels-plan-and-approval-mode.dom.test.ts`",
        [
            (
                "apps/desktop/src/renderer/src/composables/useConversationControls.ts",
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · the plan chip's rule moved to the controls composable; the plant reads the pending turn-on as the live mode, so a pending switch shows as planning
                "    if (settings.planMode) {\n      return text(PLANNING_WORD, pending === false ? 'stopping' : 'planning', planningTitle)",
                "    if (settings.pendingPlanMode ?? settings.planMode) {\n      return text(PLANNING_WORD, pending === false ? 'stopping' : 'planning', planningTitle)",
            )
        ],
    ),
]
