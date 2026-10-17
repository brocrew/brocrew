"""368 · Consent, never containment — each row is THE DEFECT, put back verbatim (131).

🔴 **HO-012 §2**: *"'The interim rail buys consent, never containment' is the honest description,
and it should be **in the disclosure itself**, not only in this correspondence. A person reading
what a mode does deserves **the limit of the protection along with its existence**."*

⛔ **So every row below breaks the sentence in one of the three ways a sentence like this decays**:
it loses its limit and becomes a promise, it gains a protection nobody measured, or it stops being
one governed constant a test can reach and becomes markup somebody can edit past.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M6` | ⚑ **desktop** — `consent-never-containment.test.ts` §1, over the constant itself |
| `M7`-`M8` | ⚑ **desktop** — `consent-never-containment.test.ts` §2, the paste census and the reach |
| `M9`-`M12` | 🔴 **dom** — `consent-never-containment.dom.test.ts`; `M9` and `M11` are the two only a real engine can see |
| `M13`-`M14` | ⚠️ **scripts** — `capabilities-probe-reach.test.mjs`, which is the only thing in `ci` that reads a live-only instrument |

## ⚠️ What this table deliberately does NOT contain

- ⛔ **A row that rewords the sentence into another true sentence.** `171`'s lesson: a mutation whose
  replacement is also correct measures the assertion's spelling, not its rule. Every row here changes
  what the app SAYS to something that is false, silent, or ungoverned.
- ⛔ **A row that removes the `escapes()` walk in `capabilities-sheet-fits.dom.test.ts`.** That guard
  belongs to `355`, it already covers this paragraph because the paragraph is inside the sheet, and a
  row here mutating another dispatch's test would be a mutation on a census invisible to that census.
- ⚠️ **A row that reintroduces the comparison `366` retired.** `ParentSession` no longer carries an
  approval mode, so that is a **typecheck** failure rather than a red suite — `366` M2 owns the
  placement and this table cannot see a compile error.
- ⚑ **A row that flips the geometry check to `compareDocumentPosition`.** It would be a survivor
  today: `.sheet-body` paints in source order, so both readings agree and a rule measured only where
  both readings agree measures nothing. `M9` moves the element instead, which separates them.
"""

from __future__ import annotations

SHARED = "apps/desktop/src/shared/capabilities.ts"
SHEET = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"
PROBE = "scripts/capabilities-sheet-probe.mjs"

# ⚠️ **464 corrected this anchor, and the row's intent is unchanged.** The opener moved from
# `creates` to `starts` — `456` took the create verb off this act and `464` carried it onto the
# sheet — so `M1` and `M4` anchored on bytes that no longer existed. ⛔ Both were re-verified RED
# against their named killer after the correction; a corrected anchor keeps no verdict it did not
# earn (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
# 🔴 **CORRECTED IN PLACE BY 499** — `HO-036` withdrew `HO-011` §3.1, so the first clause of
# this sentence changed and its last two did not. ⚑ The requirement `368` enforces is untouched:
# **state the limit in the same breath as the protection.** ⛔ Table `368` is `unrun`, so no verdict
# travels with the correction; `M1`, `M4` and `M6` were each re-verified RED afterwards.
SENTENCE = (
    "export const SPAWN_RAIL_MEANS =\n"
    "  'A conversation an agent starts runs the way that agent does and can never be given more — ' +\n"
    "  'the door refuses that. That buys the decision and not a boundary: nothing here ' +\n"
    "  'bounds where a command it runs can reach, and what you approve is approved.'\n"
)

RENDER = '      <p class="identity-note" data-cy="spawn-rail-means">{{ SPAWN_RAIL_MEANS }}</p>\n'

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 THE DEFECT THIS DISPATCH IS NAMED AFTER: the sentence states the protection and "
        "stops · the rail's existence with no limit beside it, which is exactly the state HO-012 §2 "
        "wrote the requirement about — and it reads BETTER than the honest version, which is why "
        "nothing but an assertion would have caught it",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives in today's code.
        # Re-verified RED alone.
        [
            (SHARED, "export const SPAWN_RAIL_MEANS =\n  'A conversation an agent starts runs the way that agent does and can never be given more ' +\n  'latitude in its approval mode — the door refuses that. That buys the decision and not a ' +\n  'boundary: nothing here ' +\n  'bounds where a command it runs can reach, and what you approve is approved.'\n", "export const SPAWN_RAIL_MEANS =\n  'A conversation an agent starts runs the way that agent does and can never be given more ' +\n  'latitude in its approval mode — the door refuses that.'\n"),
        ],
    ),
    (
        "M2 · 🔴 the sentence claims what HO-012 asked for and `366` measured to be false on one "
        "provider · *a spawned session always cards its commands, so a read of a credential path "
        "surfaces as a decision a person makes* — on Codex `ask` is `read-only`, escalation happens "
        "when the sandbox DENIES, a permitted read denies nothing, and `366` read a planted file "
        "outside the workspace under every profile Codex has",
        [
            (
                SHARED,
                "  'bounds where a command it runs can reach, and what you approve is approved.'\n",
                "  'a conversation an agent starts always cards its commands, so a read of a "
                "credential path is a decision you make.'\n",
            )
        ],
    ),
    (
        "M3 · the reach clause is turned into containment · the `086` defect in its dangerous "
        "direction, on the one axis `366` measured and found empty: the sandbox narrows writes and "
        "network and narrows reads not at all",
        [
            (
                SHARED,
                "  'bounds where a command it runs can reach, and what you approve is approved.'\n",
                "  'confines what a command it runs can reach, and what you approve is approved.'\n",
            )
        ],
    ),
    (
        "M4 · the constant is emptied to the empty string · it still compiles, the sheet still draws "
        "a paragraph, and the disclosure says nothing — the shape a governed sentence decays into "
        "when nothing asserts that it SAYS something",
        # ⚑ Landing D-014 · re-anchored in place, not retired — Same constant and same surviving
        # rule as M1: the disclosure must say something. Only the declaration's bytes moved, when
        # D-014 re-wrapped the first clause. Re-verified RED alone.
        [
            (SHARED, "export const SPAWN_RAIL_MEANS =\n  'A conversation an agent starts runs the way that agent does and can never be given more ' +\n  'latitude in its approval mode — the door refuses that. That buys the decision and not a ' +\n  'boundary: nothing here ' +\n  'bounds where a command it runs can reach, and what you approve is approved.'\n", "export const SPAWN_RAIL_MEANS = ''\n"),
        ],
    ),
    (
        "M5 · it grows into the wall of caveats HO-012's own brief names as the failure mode · a "
        "third sentence about merging and production, which are not rules of this product at all "
        "— HO-035 withdrew both as product invariants and `497` took the sentence out of the "
        "factory text ⚑ REASON CORRECTED IN PLACE BY 497 (the row and its kill are unchanged; it "
        "used to cite HO-011 §5.1's *instructions until Slice 6*, which has been withdrawn)",
        [
            (
                SHARED,
                "  'bounds where a command it runs can reach, and what you approve is approved.'\n",
                "  'bounds where a command it runs can reach, and what you approve is approved. ' +\n"
                "  'It will not merge and it will not touch production.'\n",
            )
        ],
    ),
    (
        "M6 · the absolute becomes the comparison `366` retired, in the COPY · *unless this app is "
        "running without prompts itself* is the rule that inherits — and the moment BroBot runs in "
        "yolo, which is how the person runs it, the sentence promises nothing at all "
        "⛔ RETIRED BY 499 — HO-036 MADE THE COMPARISON THE RULE; THE INVERSE IS `499` M10",
        [
            (
                SHARED,
                "  'whatever this app is running as. That buys the decision and not a boundary: "
                "nothing here ' +\n",
                "  'unless this app is running without prompts itself. That buys the decision and "
                "not a boundary: nothing here ' +\n",
            )
        ],
    ),
    (
        "M7 · the sheet pastes the sentence instead of reaching for the constant · the exact thing "
        "§1 of the brief forbids — *do not inline a string in a component* — and the state four "
        "neighbouring surfaces are already in",
        [
            (
                SHEET,
                RENDER,
                '      <p class="identity-note" data-cy="spawn-rail-means">\n'
                "        A conversation an agent creates can never open without prompts — the door "
                "refuses that, whatever this app is running as. That buys the decision and not a "
                "boundary: nothing here bounds where a command it runs can reach, and what you "
                "approve is approved.\n"
                "      </p>\n",
            )
        ],
    ),
    (
        "M8 · the import stays and the render goes · `a-census-that-asks-for-the-import-must-ask-"
        "for-the-call`: an unused import satisfies an import census and lint is not a guard, so the "
        "sheet type-checks, draws an empty paragraph, and discloses nothing",
        [
            (
                SHEET,
                RENDER,
                '      <p class="identity-note" data-cy="spawn-rail-means">{{ \'\' }}</p>\n',
            )
        ],
    ),
    (
        "M9 · 🔴 the disclosure is drawn BELOW the grant it is about · every string assertion stays "
        "green — it is on the sheet, it is whole, it is the constant — and a person ticks the "
        "checkbox before reading what ticking it buys, which is `367` §2.1's rule broken one surface "
        "along",
        [
            (
                SHEET,
                RENDER,
                "",
            ),
            (
                SHEET,
                '      <!-- ⚠️ **The blind spot, named where a person meets it** — see `CapabilityOrigin`. -->\n',
                '      <!-- ⚠️ **The blind spot, named where a person meets it** — see `CapabilityOrigin`. -->\n'
                + RENDER,
            ),
        ],
    ),
    (
        "M10 · the paragraph is deleted outright · the state the app was in before this dispatch, "
        "put back — a rail nobody is told about, disclosed only in a refusal an agent reads",
        [(SHEET, RENDER, "")],
    ),
    (
        "M11 · 🔴 it is moved onto this sheet's `note` class · `.note` is `display: flex` with an "
        "icon as its first item, so the sentence becomes a flex ITEM and is blockified — `367` M18's "
        "trap, on the surface that inherited it, and every containment and height assertion stays "
        "green",
        [
            (
                SHEET,
                'class="identity-note" data-cy="spawn-rail-means"',
                'class="note" data-cy="spawn-rail-means"',
            )
        ],
    ),
    (
        "M12 · the sentence is told not to wrap · at the `460px` floor `335` guards it runs off the "
        "side of the sheet, and `escapes()` cannot see it because an overflowing inline box does not "
        "move its parent's border box",
        [
            (
                SHEET,
                ".identity-note {\n  margin: 0;\n",
                ".identity-note {\n  margin: 0;\n  white-space: nowrap;\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted the anchor file on
        # purpose. scripts/capabilities-sheet-probe.mjs was removed (-652 lines), along with its
        # package.json script (`-"probe:capabilities": "node scripts/capabilities-sheet-probe.mjs"`)
        # and its ci reach test scripts/test/capabilities-probe-reach.test.mjs. Its anchor is left
        # stale, so the census records it retired.
        "M13 · the probe checks only that the rail is MENTIONED · the limit half is dropped from the "
        "live refusal, so the one instrument that reads the shipped app would pass a page carrying "
        "the promise without the bound",
        [
            (
                PROBE,
                "    if (text.indexOf(limit) === -1) return 'the disclosure states a protection with no limit: ' + text\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Same as M13: `assertTheRailIsDisclosed`
        # lived only in scripts/capabilities-sheet-probe.mjs. D-014 deleted that probe with the
        # can_spawn grant it drove ('tests of deleted code deleted'; package.json drops
        # probe:capabilities), so no live instrument remains to mutate. Its anchor is left stale, so
        # the census records it retired.
        "M14 · the live refusal is deleted and the probe only takes the picture · `310`'s two-day "
        "dead step in miniature: the screenshots still land in the response doc and nothing asserts "
        "the sentence was on the screen when they were taken",
        [(PROBE, "    await assertTheRailIsDisclosed(cdp)\n", "")],
    ),
]
