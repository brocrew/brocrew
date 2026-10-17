"""384 · Something the person can look at.

⛔ **Three claims, three shapes of failure.** This commit lifts a sentence so two surfaces can
render one string, settles what `status` is and measures the settlement's cost, and moves the
workspace's geometry without moving a binding. Each of those fails differently, and the rows below
are grouped by which.

## 🔴 The three shapes

1. **A lift that leaves a copy behind.** The whole point of moving `PROFILE_OWNS` into `lib/` is
   that a drift needs two strings; a lift that leaves a second one has bought nothing and reads as
   done. ⚑ `M1`-`M4`.
2. **A settlement that stops measuring.** The `status` decision is only worth what the loss
   measurement is worth: a projection that answers everything, a space that reaches one standing, or
   an amber check that passes on a projection returning `waiting` for the whole world. ⚑ `M5`-`M9`.
3. **Geometry that costs something it said it did not.** The tuck's entire justification is that it
   takes no horizontal pixels and forms no containing block. ⚑ `M10`-`M14`.

## ⛔ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1` | ⚑ **`the-layer-a-file-belongs-to.test.ts`** — a surface holding the sentence as a literal |
| `M2` | ⚑ **…** — the counter that stops at its first hit, caught by the two-plant control |
| `M3` | ⚑ **…** — the constant losing a clause the two surfaces are held to |
| `M4` | ⚑ **`profile-picker.dom.test.ts`** — the launcher rendering something that is not the constant |
| `M5` | ⚑ **`a-sentence-the-product-can-be-held-to.test.ts`** — the overstatement the sentence exists to avoid |
| `M6` | ⚑ **…** — a producer that carries a credential's contents out of the home |
| `M7`, `M8` | ⚑ **`one-word-and-what-it-drops.test.ts`** §2/§3 — amber, and the two holes |
| `M9` | ⚑ **…** §3 — the projection re-deciding rather than renaming |
| `M10`, `M11` | ⚑ **`app-frame-window.test.ts`** — the tuck taking pixels, and forming a containing block |
| `M12` | ⚑ **`the-paper-and-its-ground.dom.test.ts`** — a wash past the bound a translucent band imposes |
| `M13` | ⚑ **…** — the wash escaping its scope onto the dark ramp |
| `M14` | ⚑ **`the-map-before-the-move.test.ts`** §6 — the paste census, which caught this dispatch once already |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row on the tuck's VALUE.** `--surface-tuck: 20px` → `24px` is a taste, and nothing asserts a
number; a row would be a no-op reporting as a survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`).

⛔ **No row on `PROFILE_IS_NOT` or `CREDENTIAL_FILES_ARE_NOT_READ` being RENDERED.** They are not,
deliberately — `384 §0` fences the commit at *"every surface keeps rendering exactly what it renders
today"* — so there is no render site to break. ⚠️ The day one is drawn, that row becomes writable and
should be written.

⛔ **No row turning `V23_HOLES` into a nearest-word guess** (`background` → `in-flight`). The
projection's `switch` has no arm for those standings, so the mutation would have to ADD one — a row
that writes new code rather than weakening existing code, which this harness does not do. ⚑ `M8`
attacks the same claim from the assertion's side instead, which is the reachable half.

## 🔴 The row that could not be written, and it is a property rather than an omission

⛔ **`M7` was first written as *"the control that measures where the two readings DIVERGE is
removed"* — and it SURVIVED, because weakening an assertion cannot make a test red.** A mutation
harness applies an edit and asks whether a suite goes from green to red; deleting a check leaves it
green by construction, which is `a-mutation-on-a-census-is-invisible-to-that-census` in its most
literal form.

⚑ **So the row attacks the product instead**, and the control it was written about is what would fire
if the projection ever answered `waiting` for everything. ⚠️ **Nothing in this harness can demonstrate
that a control is load-bearing** — that needs a second instrument, and naming the gap is the honest
substitute for one.

## 🔴 The one row whose absence is a finding

⛔ **There is no row for *"the wash is applied to five of the six light surfaces"*.** Nothing counts
the consumers: each surface opts in with its own `background-image` line, and a surface that never
got one simply has no ground. ⚠️ `surface-boundaries.dom.test.ts` walks all five carriers for THEME,
not for this. Closing it needs a census over the light-scope roots; named here so the six is not
read as enforced.
"""

WORDS = "apps/desktop/src/renderer/src/lib/profile-words.ts"
CREDENTIAL = "apps/desktop/src/renderer/src/lib/credential-words.ts"
PROJECTION = "apps/desktop/src/renderer/src/lib/status-projection.ts"
CONFIG = "apps/desktop/src/main/runtime/provider-config.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
INFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
TOKENS = "apps/desktop/src/renderer/src/assets/tokens.css"
CENSUS = "apps/desktop/test/the-layer-a-file-belongs-to.test.ts"
LOSS = "apps/desktop/test/one-word-and-what-it-drops.test.ts"

MUTATIONS = [
    # ── 1 · a lift that leaves a copy behind ──────────────────────────────────────────────────
    (
        "M1 · 🔴 the drawer goes back to typing the sentence out · the lift's whole purchase is that "
        "a drift needs two strings, and this restores the second one while both surfaces still read "
        "identically today",
        [
            (
                INFO,
                "          {{ PROFILE_OWNS }} The variable beside it is what pins that home.",
                "          A profile is an agent’s own home: the conversations it runs there, its own instruction\n"
                "          file, and what it remembers — across every project it works in. The variable beside it is\n"
                "          what pins that home.",
            )
        ],
    ),
    (
        "M2 · ⛔ the copy census stops at its first hit · `split(…).length - 1` becomes an `includes` "
        "so a second literal in a second file is invisible — the exact defect standing rule 12 names, "
        "planted in the census written to obey it",
        [
            (
                CENSUS,
                "    sources.reduce((total, source) => total + rendered(source).split(OPENING).length - 1, 0)",
                "    sources.some((source) => rendered(source).includes(OPENING)) ? 1 : 0",
            )
        ],
    ),
    (
        "M3 · ⛔ the constant loses the clause 356 put in it · `its own instruction file` becomes one "
        "provider's filename again, which is the correction that had to be made in two places the "
        "last time and in one place now",
        [
            (
                WORDS,
                "  'A profile is an agent’s own home: the conversations it runs there, its own instruction file, '",
                "  'A profile is an agent’s own home: the conversations it runs there, its own CLAUDE.md, '",
            )
        ],
    ),
    (
        "M4 · ⚠️ the launcher renders a paraphrase instead of the constant · the mock's own shorter "
        "wording, which is exactly the sentence a person copies across when the constant is one import "
        "away and the paraphrase is already in their head",
        [
            (
                LAUNCHER,
                '<p class="note advice" data-cy="profile-owns">{{ PROFILE_OWNS }}</p>',
                '<p class="note advice" data-cy="profile-owns">A profile is an agent’s continuing home.</p>',
            )
        ],
    ),
    # ── 2 · a settlement that stops measuring ─────────────────────────────────────────────────
    (
        "M5 · 🔴 the profile sentence takes the shorter, false claim · *a profile grants nothing* is "
        "the thing v2.3 invites and `capabilities.ts` refuses: two ruled defaults are wider than the "
        "narrowest value, so a new identity starts with reach nobody gave it",
        [
            (
                WORDS,
                "  'A profile is a home, not a rank. What an agent may do is read from its own capability grants — '",
                "  'A profile is a home, not a rank. It grants nothing on its own — '",
            )
        ],
    ),
    (
        "M6 · ⛔ the provider-config reader starts carrying the file's contents · one extra field on a "
        "content-blind producer, and every surface downstream inherits a credential it never asked for "
        "— the promise is about the WIRE, not about a template",
        [
            (
                CONFIG,
                "      return { name, path, note, exists: present(path) }",
                "      return { name, path, note, exists: present(path), body: readFileSafely(path) }",
            )
        ],
    ),
    (
        "M7 · 🔴 a blocked conversation stops going to amber · the projection sends `waiting` to the "
        "blue in-flight word, so a person with a permission card open reads as a running turn — the "
        "exact loss the PM's constraint on this decision was written about",
        [
            (
                PROJECTION,
                "    case 'waiting':\n      return 'waiting'",
                "    case 'waiting':\n      return 'in-flight'",
            )
        ],
    ),
    (
        "M8 · ⛔ the two homeless standings are re-filed as a design taste · `V23_HOLES` empties, so "
        "`background` — which has a Stop button behind it — stops being reported as a state v2.3 "
        "cannot say, and `250`/`258`'s defect is re-opened as a rounding error",
        [
            (
                PROJECTION,
                # ⚑ **636 · anchor CORRECTED, subject unchanged.** `elsewhere` is a THIRD
                # standing v2.3 has no word for, for the same reason the two beside it are — so
                # the list GREW and *the homeless standings are re-filed as a design taste* is
                # the identical claim. ⛔ Re-verified RED by hand at `636`.
                "export const V23_HOLES: readonly Standing[] = ['background', 'scheduled', 'elsewhere']",
                "export const V23_HOLES: readonly Standing[] = []",
            )
        ],
    ),
    (
        "M9 · ⚠️ the projection re-decides instead of renaming · a second derivation of one fact, "
        "which is what `099` spent a dispatch removing — and it goes green on every assertion that "
        "does not compare it to `standingOf`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule (the projection
        # renames standingOf's answer and never re-decides it) is still the note on v23StateOf and
        # still asserted; only the old `case 'unstarted':` arm is gone, because D-017b removed the
        # `unstarted` standing ("the one pair there was went with the standing that said whether a
        # process runs"). The plant re-decides the `idle` arm from a facet, `being === 'unstarted'`,
        # which still exists as a Being, so idle facets get the word `unknown` that standingOf gives
        # only to the `unknown` standing.
        [
            (PROJECTION, "    case 'idle':\n      return 'ready'", "    case 'idle':\n      return facets.being === 'unstarted' ? 'unknown' : 'ready'"),
        ],
    ),
    # ── 3 · geometry that costs something it said it did not ──────────────────────────────────
    (
        "M10 · 🔴 the tuck grows a gutter · v2.3's own `padding: 18px 16px 8px 22px`, copied across — "
        "and at the app's opening width it takes `.pane-body` under 940, so the drawer narrows from "
        "380 to 320 as a side effect of a background change",
        [
            (
                SCREEN,
                "  border-top-left-radius: var(--surface-tuck);",
                "  border-top-left-radius: var(--surface-tuck);\n  padding: 18px 16px 8px 22px;",
            )
        ],
    ),
    (
        "M11 · ⛔ the sheet gets a containing block · `backdrop-filter` is the reasonable-looking way "
        "to make a translucent sheet, and it makes `.main` a containing block for `position: fixed` "
        "— every overlay in the app would then scroll with `#app` below 1180",
        [
            (
                SCREEN,
                # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme border widths now use tokens; the same defect retains all other declarations.
                "  box-shadow: inset var(--border-width) var(--border-width) 0 0 var(--surface-edge);",
                "  backdrop-filter: blur(2px);",
            )
        ],
    ),
    (
        "M12 · 🔴 the wash goes back to the alpha that failed · `0.72` is what this dispatch shipped "
        "first: the page moves to `rgb(253, 239, 215)` and the header band, at `0.86` alpha, stops "
        "belonging to the page it sits on — measured 26.04 against a bound of 16",
        [
            (
                TOKENS,
                "      rgba(255, 234, 196, 0.34),\n      rgba(255, 234, 196, 0) 72%",
                "      rgba(255, 236, 201, 0.72),\n      rgba(255, 236, 201, 0) 72%",
            )
        ],
    ),
    (
        # ⛔ RETIRED BY RULING: the paper has no wash any more (`--paper-wash: none` in `:root`
        # only), so there is no scoped wash left to escape; planting one would add new code. The
        # anchor names the scoped wash that was removed, so the census records it retired.
        "M13 · ⛔ the wash escapes its scope · declared at `:root` like every other `--paper-*` token, "
        "which is the reasonable-looking edit — and it tints the dark ramp to `rgb(186, 172, 148)`, "
        "taking faded prose from 3:1 to 1.16:1",
        [
            (
                TOKENS,
                "  --paper-wash:\n    radial-gradient(\n      ellipse 78% 62% at 99% -14%,",
                "  --paper-wash:\n    radial-gradient(\n      ellipse 78% 62% at 99% -14%,\n      rgba(255, 234, 196, 0.34),\n      rgba(255, 234, 196, 0) 72%\n    );",
            )
        ],
    ),
    (
        "M14 · ⚠️ a docblock quotes the design sentence it replaces · verbatim rather than as a "
        "fragment, which is what this dispatch actually did once — a comment is one edit from a "
        "template, and `382 §9.2`'s census reads raw source for that reason",
        [
            (
                CREDENTIAL,
                # ⚑ Corrected in place at `733` (rule 27): the docblock it lived in went with `CREDENTIAL_FILES_ARE_NOT_READ`;
                # the module's new docblock names the same promise, and the rule — a docblock quotes a
                # design sentence as a fragment, never verbatim — is measured on it.
                " * Finder rather than opening it\"* — the promise the design's paths view makes by hand. ⚑ The PM, on\n",
                " * Finder rather than opening it\"* — *\"Credential file contents are never previewed here.\"* ⚑ The PM, on\n",
            )
        ],
    ),
]
