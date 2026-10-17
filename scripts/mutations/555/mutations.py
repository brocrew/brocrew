"""555 · The sentence a withdrawn ruling left behind.

⛔ **`HO-023` §7, August, WITHDRAWN:** *"The factory layer propagates verbatim by construction
because the app renders it — that is now a safety property, not a convenience."* ⚑ **`HO-062` §2
replaces it: *The factory layer carries BEHAVIOUR. Safety lives in the rails.*** ⚠️ This table is
about the two halves of that ruling and the instrument that holds them.

## 🔴 A · the reader, which was silently blind THREE times before it was measured

⛔ **Every row here is a way a prose census reads a tree and reports it clean.** `M1` drops the
per-line `*`, so any phrase that WRAPS is invisible — the failure that made the first draft of this
census green on a tree carrying the sentence. `M2` drops the blockquote strip, so a ruling quoted
in a `> ` block cannot be found by the census that enforces it. `M3` stops folding runs of `//`
lines, so a four-line inline note becomes four spans and no sentence in it is longer than its span.
`M4` folds them regardless of adjacency, which is the same instrument failing the other way — a
span swallowing remarks nobody wrote together. `M5` folds BLOCK comments, so `spanCarrying` answers
about a span neither author wrote. `M6` stops reading the comments that lead the EOF token, which
is every trailing note in the repository. `M7` answers `[]` for a template it cannot read instead
of throwing (standing rule 27). `M8` drops the position dedup, so one comment is two spans and
every *exactly one span* assertion below goes from measuring to guessing.

## ⛔ B · the withdrawn framing, put back — a rule is proven by VIOLATING it

⚑ **`498`'s closure, on this subject** (*"a census nobody has made fail is a census nobody has
measured"*). ⚠️ Each of these restores, verbatim, a sentence that shipped on `main` `b688a9b2` and
that §2 found there: `M9` `instructions.ts`' *that is a safety property rather than an omission*;
`M10` the Claude adapter's *the tool/permission instructions the 001 approval profile depends on*;
`M11` the Codex adapter's *the built-in tool/approval behaviour the 001 profile relies on*; `M12`
the conformance suite's *strip the 001 approval behaviour with it*.

## ⚠️ C · the limit, where the guarantee is

⛔ `M13` restores the derivation that DIED — the Codex adapter's citation of `workspaceSystemHint`,
a function `158` deleted, which the sentence went on naming for four months. `M14` puts back
*the string on screen and the string in the prompt cannot disagree*, which claims one step past the
hand-off. `M15` deletes the Codex limit from the neutral contract, leaving the guarantee alone.

## 🔴 D · HO-062's own argument, in the tree

⛔ `M16` deletes the limit from the capability-facts row — the one the verification found weakest,
where an agent that does NOT attempt produces nothing at all. `M17` deletes §3's measurement
trigger, which turns a deferral back into a shrug. `M18` widens the census's escape from a CITATION
to the word *withdrawn*, so a span could carry the claim and point at nothing. `M19` drops `the
preset` from the subject gate, which is the clause that made the conformance sentence visible at
all — the first draft of this census walked past it.

## ⛔ What this table does NOT cover

 1. **The three mechanisms the degradation table names.** `tellIfNobodyHasYet`, `reply_to_parent`'s
    rails and the capability rails are `400`/`404`, `393` and `341`'s tables; this one asserts they
    exist and quotes what they do, and a row breaking one would be measuring those dispatches.
 2. **`HINT_PREAMBLE` and the factory text itself.** Nothing in this dispatch changed a byte an
    agent reads — `the-text-a-child-is-actually-told.test.ts` owns that text and its own censuses.
 3. **`553`'s five files.** `shared/capabilities.ts` carries two withdrawn-`HO-042` citations; they
    are NAMED in the response and left, and no row here touches that file.
"""

READER = "apps/desktop/test/lib/prose-spans.ts"
CENSUS = "apps/desktop/test/the-sentence-a-withdrawn-ruling-left-behind.test.ts"
INSTRUCTIONS = "apps/desktop/src/main/runtime/instructions.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
CONFORMANCE = "packages/runtime/test/conformance.test.ts"
CONTRACT = "packages/runtime/src/runtime.ts"
WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"

MUTATIONS = [
    # ---- A · the reader ------------------------------------------------------------------------
    (
        "M1 · 🔴 **a wrapped phrase goes invisible** · the per-line `*` stays in the span, so "
        "*a safety* + newline + ` * ` + *property* is not `safety property` and the census that "
        "exists to find that sentence reports a clean tree",
        [(READER, "    .replace(/^[ \\t]*\\*/gm, '')\n", "")],
    ),
    (
        "M2 · ⛔ **a ruling quoted in a `> ` block cannot be found** · the blockquote marker stays, "
        "and this repository writes every PO ruling it enforces inside one",
        [(READER, "    .replace(/^[ \\t]*>+[ \\t]?/gm, '')\n", "")],
    ),
    (
        "M3 · ⚠️ **a run of `//` lines stays N spans** · a four-line inline note holds no sentence "
        "longer than one line, which is every inline comment in the repository",
        [
            (
                READER,
                "    if (!runs) {\n      out.push(span)\n      continue\n    }\n",
                "    if (!runs || true) {\n      out.push(span)\n      continue\n    }\n",
            )
        ],
    ),
    (
        "M4 · ⛔ **the fold stops asking whether the lines are ADJACENT** · two remarks a statement "
        "apart become one span, so a census reports a claim in a comment that does not carry it",
        [
            (
                READER,
                "      last.file === span.file &&\n"
                "      span.line === last.line + last.text.split('\\n').length\n",
                "      last.file === span.file\n",
            )
        ],
    ),
    (
        "M5 · ⚠️ **BLOCK comments fold too** · two docblocks become one span neither author wrote, "
        "and every *exactly one span* assertion is then about a thing nobody said",
        [
            (
                READER,
                "      last.kind === 'line' &&\n      span.kind === 'line' &&\n",
                "      last.kind === span.kind &&\n",
            )
        ],
    ),
    (
        "M6 · \u26d4 **a `.vue` comment is reported at its line INSIDE the `<script>` block** \u00b7 the "
        "block's own offset is dropped, so every finding in a single-file component cites a line "
        "number a person cannot open \u2014 and a span's line is the only thing a census can cite",
        [
            (
                READER,
                "    if (block) fromScript(block.content, filename, block.loc.start.line - 1, out, seen)\n",
                "    if (block) fromScript(block.content, filename, 0, out, seen)\n",
            )
        ],
    ),
    (
        "M7 · 🔴 **a template this reader cannot see answers EMPTY instead of throwing** · standing "
        "rule 27, and an empty list is the quietest possible green",
        [
            (
                READER,
                "  if (template && !template.ast)\n"
                "    throw new Error(`${filename}: a <template> this reader cannot see — an out-of-file src=`)\n",
                "",
            )
        ],
    ),
    (
        "M8 · ⚠️ **one comment becomes two spans** · the position dedup goes, a parent's leading "
        "trivia is collected again from its child, and *is in exactly one span* stops measuring",
        [
            (
                READER,
                "      if (seen.has(range.pos)) continue\n      seen.add(range.pos)\n",
                "      seen.add(range.pos)\n",
            )
        ],
    ),
    # ---- B · the withdrawn framing, put back ----------------------------------------------------
    (
        "M9 · \U0001f534 **the sentence this dispatch removed, restored** \u00b7 *the Codex branch of this "
        "reader still injects nothing, and that is a safety property rather than an omission* \u2014 "
        "HO-062 \u00a72's withdrawn framing, on the app's own instruction layer, with BOTH citations that "
        "would excuse it gone along with the repair",
        [
            (
                INSTRUCTIONS,
                " * **The Codex branch of this reader still injects nothing, and that is a DECISION rather than an\n"
                " * omission**",
                " * **The Codex branch of this reader still injects nothing, and that is a safety property rather\n"
                " * than an omission**",
            ),
            (
                INSTRUCTIONS,
                " *    rail** \u2014 it is this branch, in code \u2014 and it is what HO-062 \u00a72 means by *safety lives in the\n"
                " *    rails*.\n",
                " *    rail** \u2014 it is this branch, in code.\n",
            ),
            (
                INSTRUCTIONS,
                " * \u2691 **`HO-023` \u00a77 called an arrangement like this one *\"a safety property, not a convenience\"* and\n"
                " * HO-062 \u00a72 withdrew that framing.** The word is spent here on the half that is enforced by a\n"
                " * branch, and not on the half that is a judgement about cost.\n"
                " *\n",
                "",
            ),
        ],
    ),
    (
        "M10 · \u26d4 **safety rests on the prompt again, in the Claude adapter** \u00b7 *strip the "
        "tool/permission instructions the 001 approval profile depends on* \u2014 and the profile is "
        "`promptGuardHooks` plus `canUseTool`, neither of which a system prompt reaches",
        [
            (
                CLAUDE,
                "    // never a bare string, which would REPLACE the preset and strip the tool GUIDANCE the\n"
                "    // model reads.\n",
                "    // never a bare string, which would REPLACE the preset and strip the tool/permission\n"
                "    // instructions the 001 approval profile depends on.\n",
            ),
            (
                CLAUDE,
                "    // approval profile depends on\"*, and HO-062 \u00a72 withdraws the framing under it:** *\"The factory\n",
                "    // approval profile depends on\"*, and a later note says:** *\"The factory\n",
            ),
            (
                CLAUDE,
                "    // KNOWS, which is exactly the class HO-062 \u00a72 puts the factory layer in, and it is why the\n",
                "    // KNOWS, and it is why the\n",
            ),
        ],
    ),
    (
        "M11 · \u26d4 **and in the Codex adapter** · *would strip the built-in tool/approval behaviour "
        "the 001 profile relies on* \u2014 the profile is three fields of the same `ThreadStartParams` "
        "object `baseInstructions` does not touch",
        [
            (
                CODEX,
                "  // prompt, which would strip the built-in tool guidance the model reads.\n",
                "  // prompt, which would strip the built-in tool/approval behaviour the 001 profile\n"
                "  // relies on.\n",
            ),
            (
                CODEX,
                "  // \U0001f534 **555 · that clause used to say the 001 PROFILE relies on it, and HO-062 \u00a72 withdraws\n"
                "  // the framing:**",
                "  // \U0001f534 **555 · a note about the framing:**",
            ),
        ],
    ),
    (
        "M12 · \u26a0\ufe0f **and in the suite that pins the hand-off** · *replace the agent's base prompt and "
        "strip the 001 approval behaviour with it*, on the RESUME path, where a Codex thread may "
        "already have switched mode",
        [
            (
                CONFORMANCE,
                "    // replace the agent's base prompt and the tool guidance in it.\n",
                "    // replace the agent's base prompt and strip the 001 approval behaviour with it.\n",
            ),
            (
                CONFORMANCE,
                "    // \u26d4 **555 · not \"the 001 approval behaviour\"** (HO-062 \u00a72): a resume re-sends\n",
                "    // \u26d4 **555 · a note on the resume path:** a resume re-sends\n",
            ),
        ],
    ),
    # ---- C · the limit, where the guarantee is ---------------------------------------------------
    (
        "M13 · 🔴 **the derivation that DIED, restored** · the sentence names `workspaceSystemHint` "
        "again, which `158` deleted — `a-number-can-survive-the-death-of-its-derivation` at sentence "
        "scale, which is this whole dispatch in one line",
        [
            (
                CODEX,
                " * here so that whoever first sends Codex a hint finds this instead of the bug.\n",
                " * here so that whoever first sends Codex a hint finds this instead of the bug\n"
                " * (`workspaceSystemHint` returns undefined for this provider).\n",
            )
        ],
    ),
    (
        "M14 · ⛔ **one step past the hand-off** · *the string on screen and the string in the prompt "
        "cannot disagree* — what the composition root establishes is that the adapter was handed it",
        [
            (
                WIRE,
                "   * `StartOptions.systemHint` — so the string on screen and the string HANDED OVER cannot\n",
                "   * `StartOptions.systemHint` — so the string on screen and the string in the prompt cannot\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ **the guarantee without the limit, on the neutral contract** · the one document "
        "both adapters are written against states what the layer is and stops there",
        [
            (
                CONTRACT,
                "   * 🔴 **The limit, on one provider, measured by `552`:** a Codex `collaborationMode` update TAKES\n"
                "   * PRECEDENCE over `developerInstructions`, so a hint sent at `thread/start` stops being in force\n",
                "   * 🔴 **On one provider, measured by `552`:** a Codex `collaborationMode` update is sent\n"
                "   * alongside `developerInstructions`, and a hint sent at `thread/start` stays in force\n",
            )
        ],
    ),
    # ---- D · HO-062's argument, in the tree ------------------------------------------------------
    (
        "M16 · 🔴 **the weakest row loses its limit** · the capability-facts row keeps *a rail "
        "refuses it by name* and drops *loud only on the ATTEMPT branch* — and for a DROPPED "
        "instruction the non-attempt branch is at least as likely as the other",
        [
            (
                FACTORY,
                " * | its capability facts | it attempts something and a rail refuses it BY NAME, with the grant named and `retryable: false` | ⛔ **loud only on the ATTEMPT branch.**",
                " * | its capability facts | it attempts something and a rail refuses it BY NAME, with the grant named and `retryable: false` | ⚑ **nothing further.**",
            )
        ],
    ),
    (
        "M17 · ⛔ **the trigger goes and the deferral becomes a shrug** · HO-062 §3's whole point is "
        "that the symptom is observable in the product we already have",
        [
            (
                FACTORY,
                " * > ⛔ **Measure it when an agent starts behaving as though it never read its instructions on\n"
                " * > Codex** — not replying, not quoting a task id, not knowing it has a parent — **and doing so\n"
                " * > AFTER A MODE TRANSITION rather than from the start.**\n",
                " * > ⛔ **It is not measured, and there is no plan to measure it.**\n",
            )
        ],
    ),
    (
        "M18 · ⚠️ **the census's escape becomes an adjective** · a span may carry the withdrawn "
        "framing by saying *withdrawn* and pointing at nothing — the escape has to be harder to "
        "satisfy by accident than the claim is to write",
        [
            (
                CENSUS,
                "const CITES_THE_RULING_THAT_WITHDREW_IT = /\\bHO-062\\b/",
                "const CITES_THE_RULING_THAT_WITHDREW_IT = /\\bwithdraw\\w*\\b/i",
            )
        ],
    ),
    (
        "M19 · ⛔ **the subject gate loses the clause that made the shipped sentence visible** · "
        "`the preset` is in the list because the conformance comment names no API field, and the "
        "first draft of this census walked straight past it",
        [(CENSUS, "|the preset|preset\\+append", "|preset\\+append")],
    ),
]
