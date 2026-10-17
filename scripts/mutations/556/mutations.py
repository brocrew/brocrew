"""556 · A mount is not a reading.

⛔ **`536` F5:** *"`the-half-nobody-lists.dom.test.ts` opens with 'Every negative below is paired
with a positive about the SAME element' — and then its fresh-identity test had TWO NEGATIVES AND A
MOUNT."* ⚑ **A rule a file states about itself is not a rule anything checks**, and this table has
two halves because the dispatch shipped two things: an instrument, and fifteen repaired pairs.

## 🔴 A · the instrument, disarmed

⚠️ **A census nobody has made fail is a census nobody has measured** (standing rule 20). ⛔ `M1`
stops the reader at the first block in a file, which is the defect standing rule 12 exists for and
the reason the plant plants TWO. ⚑ `M2` and `M3` widen and narrow what counts as a reading — a hook
becomes words, and an SSR render becomes offstage — and each moves the pinned backlog rather than
the enforced roster, so the ratchet is what fires. ⛔ `M4` and `M5` attack the POPULATION instead of
the predicate: a case-sensitive declaration reader loses 19 of the 41 files that state the rule
(measured, in this dispatch's own first hour), and a reader that takes the sentence off raw source
enrols every file that merely quotes it.

## ⛔ B · the words the repairs now read

🔴 **Fifteen blocks stopped counting elements and started reading them**, and every row here is a
sentence the app draws that one of those blocks now pins. ⚠️ `M9`–`M11` are the three sentences on
`the-half-nobody-lists.dom.test.ts`'s own surface — `536`'s F5 instance, its neighbour and 318's
line, which had been counted for two dispatches and never read. ⛔ `M12` is the one a person types:
the palette's miss heading stops naming the query, which is `238`'s defect exactly. ⚑ `M13`–`M15`
are a heading, a button's word and a refusal's word — the three shapes an empty element passes a
`not.toBeNull()` with.

## ⚠️ What this table does NOT cover

 1. **The 279-block sweep.** Only the declared population is enforced; the rest is a ranked finding
    in the response document and a counted backlog in `DECLARED_AND_STILL_UNPAIRED`.
 2. **Weakening the ratchet itself.** A row that turns the exact backlog equality into
    `toBeLessThanOrEqual` passes the assertion it mutates —
    `a-mutation-on-a-census-is-invisible-to-that-census`, and the reason the equality is stated in
    the docblock rather than only in the code.
 3. **`src/` behaviour.** Group B mutates COPY the repaired tests now read; none of it changes what
    the app does, and this dispatch changed no source file.
"""

CENSUS = "apps/desktop/test/a-mount-is-not-a-reading.test.ts"
TOLD = "apps/desktop/src/renderer/src/lib/told.ts"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
# ⚑ **583 · where a memory row is built now** — see M16.
GROUPS = "apps/desktop/src/renderer/src/lib/whose-groups.ts"
INFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"
PALETTE = "apps/desktop/src/renderer/src/lib/command-palette.ts"
LOADED = "apps/desktop/src/renderer/src/components/MemoryLoadedEntry.vue"

MUTATIONS = [
    # ---- A · the instrument, disarmed ----------------------------------------------------------
    (
        "M1 · 🔴 **the reader stops at the first block in a file** · standing rule 12's defect, and "
        "the reason the plant plants TWO. ⛔ A census that reads only the first `it` in a suite is "
        "blind to exactly the file `536` found — where the rule is stated at the top and broken "
        "four tests down",
        [
            (
                CENSUS,
                "export function unpaired(filename: string, source: string): Block[] {\n  return blocksOf(filename, source).filter((block) => {",
                "export function unpaired(filename: string, source: string): Block[] {\n  return blocksOf(filename, source).slice(0, 1).filter((block) => {",
            )
        ],
    ),
    (
        "M2 · ⛔ **a hook counts as a reading** · `toContain('data-cy=\"yolo-means\"')` says the "
        "node is in the markup and says nothing a person reads. ⚑ Without this line the SSR half "
        "of the tier table collapses and the backlog shrinks without a repair",
        [(CENSUS, "    !HOOK_ONLY.test(arg) &&\n", "")],
    ),
    (
        "M3 · ⚠️ **an SSR render is offstage** · the markup lives in the ARGUMENT there, so a "
        "reader that asks only about the subject calls every `.render.test.ts` in the tree a "
        "payload test and stops measuring the population `536` §3.2 called the worse case",
        [
            (
                CENSUS,
                "const MARKUP = /data-[a-z-]+\\s*[=\\]]|<\\/?[a-z]/",
                "const MARKUP = /$^/",
            )
        ],
    ),
    (
        "M4 · 🔴 **the declaration is read case-sensitively** · `grep -rn \"Every negative\"` found "
        "22 files and the population is 41. ⛔ A gate that silently drops 19 declaring suites is "
        "`a-case-sensitive-grep-became-a-false-capability-claim` wearing a roster",
        [
            (
                CENSUS,
                "const DECLARATION = /Every negative[\\s\\S]{0,60}?\\bpaired\\b/i",
                "const DECLARATION = /Every negative[\\s\\S]{0,60}?\\bpaired\\b/",
            )
        ],
    ),
    (
        "M5 · ⛔ **the declaration is taken off raw source** · rule 26 §1: a raw-file census counts "
        "docblock words as code, and here it counts CODE as a docblock — a fixture string holding "
        "the sentence enrols a file that never claimed the rule",
        [
            (
                CENSUS,
                "export const declaresTheRule = (file: string, source: string): boolean =>\n  DECLARATION.test(commentsOf(file, source))",
                "export const declaresTheRule = (file: string, source: string): boolean =>\n  DECLARATION.test(source)",
            )
        ],
    ),
    (
        "M6 · ⚠️ **a name never becomes the surface** · an SSR suite binds its markup to a plain "
        "`const html`, and nothing about that name says *surface* until another assertion in the "
        "same block puts markup on the right of it. ⛔ Dropping the block-scoped set makes one name "
        "carry two verdicts",
        [
            (
                CENSUS,
                "      .filter((one) => MARKUP.test(one.args.join(' ')) || SURFACE.test(one.subject))",
                "      .filter((one) => SURFACE.test(one.subject))",
            )
        ],
    ),
    (
        "M7 · 🔴 **local helpers stop being inlined** · `metaOf(host, cy)` and `cell(html, cy)` put "
        "every reading one hop away, so a reader that stops at the call calls a suite that reads "
        "all of its rows through one helper unpaired in full "
        "(`a-second-function-in-the-same-shape-disarms-a-file-scoped-census`)",
        [(CENSUS, "        if (depth < 4 && name !== null", "        if (depth < 0 && name !== null")],
    ),
    (
        "M8 · ⛔ **the walk reads one tree** · standing rule 20: the category is *a test file that "
        "declares the rule*, and two of the declarations are outside `apps/desktop`. A walk "
        "addressed to one tree leaves the hole exactly where the other runners are",
        # ⚠️ **RE-ANCHORED at 706, not retired.** `706` added the two `gate-only/` trees to `ROOTS`, so
        # the array spans lines. The DEFECT this row plants is unchanged: the walk reads one tree.
        [
            (
                CENSUS,
                "const ROOTS = [\n  'apps/desktop/test',\n  'apps/desktop/gate-only',\n  'packages/runtime/test',\n"
                "  'packages/shared/test',\n  'scripts/test',\n  'scripts/gate-only',\n]",
                "const ROOTS = ['apps/desktop/test']",
            )
        ],
    ),
    # ---- B · the words the repairs now read ----------------------------------------------------
    (
        "M9 · 🔴 **the sentence a fresh identity reads is written at the fold instead of NAMED** "
        "· standing rule 5, and `536` F5's own instance: that block had three absences and a mount, "
        "`536` gave it a second `not.toBeNull()`, and only now does anything fail when the words "
        "on screen stop being the constant the product declares",
        [
            (
                TOLD,
                "    remembers: memory.length === 0 ? TOLD_REMEMBERS_NOTHING : null,",
                "    remembers: memory.length === 0 ? 'No memory of this agent is shown here.' : null,",
            )
        ],
    ),
    (
        "M10 · ⛔ **the composition sentence loses the clause about the FILES** · the one thing the "
        "sheet draws unconditionally, and therefore the pair every absence on that surface now "
        "leans on. ⚑ Three suites read it; none read it before",
        [
            (
                TOLD,
                "    says: TOLD_IS_THE_LAST_LAUNCH,",
                "    says: 'Composed at this conversation’s most recent launch.',",
            )
        ],
    ),
    (
        "M11 · ⚠️ **318's sentence loses the clause that makes it 322's** · *\"which of these\"* is "
        "what makes it about the STORE rather than one file in it, and the block whose title is "
        "*318's sentence still stands* counted its carrier for two dispatches without reading it",
        [
            (
                PANEL,
                "          Nothing here says which of these the agent has actually looked up.",
                "          Nothing here says what the agent has looked up.",
            )
        ],
    ),
    (
        "M12 · 🔴 **the palette's miss stops naming what was searched for** · `238`'s defect "
        "exactly — *\"quoting, in its own heading, a string nobody had searched\"* — and the test "
        "for a real miss had only counted that the panel was there",
        [
            (
                PALETTE,
                "  return `Nothing matches “${query.trim()}”`",
                "  return 'Nothing matches that'",
            )
        ],
    ),
    (
        "M13 · ⛔ **the memory row's heading stops saying what happened** · the row is a launch "
        "fact, and a row present-but-silent satisfied `toHaveLength(1)` on both of the blocks that "
        "guard `106` here",
        [
            (
                LOADED,
                "        This conversation opened with this profile’s memory index in the prompt",
                "        Memory",
            )
        ],
    ),
    (
        "M14 · ⚠️ **the surviving affordance loses its word** · *two of something* is not *two of "
        "Finder*, and the whole point of that pair is that a person can still see the affordance "
        "the missing callback did not take away",
        [
            (
                PANEL,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 08371e44e made the file-manager word platform-aware; omit only that same visible affordance word.
                "                <svg class=\"icon\"><use href=\"#i-folder\" /></svg>\n                {{ fileManager }}",
                "                <svg class=\"icon\"><use href=\"#i-folder\" /></svg>",
            )
        ],
    ),
    (
        "M15 · 🔴 **a refusal becomes an empty box** · what a conversation swap CLEARS has to have "
        "been readable before the swap, or the two absences after it are measuring the reset of "
        "nothing",
        [
            (
                INFO,
                # ⚑ Corrected in place at `733` (rule 27): `733`'s Open brought a second map with the same `gone` line,
                # so the anchor names the reveal's own map by the line above it.
                "  'no-path': 'this session has no such path',\n  gone: 'there is nothing there any more',",
                "  'no-path': 'this session has no such path',\n  gone: '',",
            )
        ],
    ),
    (
        "M16 · ⛔ **the memory rows stop carrying their paths** · *draws exactly what it drew before* "
        "is a claim about WORDS, and `not.toBeNull()` on the row was true of a row rendered blank. "
        "⚑ **583: mutated where a whole-file BLOCK is built**, which is where the memory rows come "
        "from now — the two loops became one and the anchor moved with them",
        [
            (
                # ⚑ **583 · the two loops became one** (standing rule 27,
                # `correct-a-stale-mutation-anchor-dont-retire-it`). The panel builds BLOCKS now —
                # whole files and bundle sections through one path — and a memory row is a
                # whole-file block. ⛔ **The row's own caveat still holds and is now enforced by
                # the code rather than by the anchor**: the 8-space arm is the whole-file one, so
                # this moves the memory rows and leaves a bundle section's address alone.
                # ⛔ **Corrected in place and re-verified RED by hand.**
                GROUPS,
                "        path: item.path,\n",
                "        path: '',\n",
            )
        ],
    ),
]
