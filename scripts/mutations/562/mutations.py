"""562 · A press that opens the document it names.

⚑ **the person:** *"the resources should be visible to the user, **the hyperlinks in the conversation
transcript are not clickable right now**."* ⛔ **`548` §Q4 is the rule this table is built on:**
*"Do not regex every code span into a button … carry a typed document reference in the
transcript/work-report shape, validate it against the canonical document door, and render the
button only after that validation."*

## 🔴 A · the roster — the difference between a validation and a pattern

⛔ **Every row here turns the control back into something a model can conjure.** `M1` drops the
surface's reader from the question, so a pane with nowhere to send the press draws one anyway —
`106`'s dead control, on the surface `510` wrote the default for. `M2` is the forbidden version
itself: the id is harvested out of the report's SENTENCE instead of read off its field, which is
what `work-report.ts` forbids by name and what the app's own full stop immediately breaks. `M3`
drops the type guard, so `documentId: 42` off an imported bundle reaches the roster. `M4` drops the
dedupe. `M5` is the row `the-document-a-report-names.ts` names in its own docblock — a SECOND
predicate, agreeing with the press on every input but one, which is how two controls over one
viewer come to be two decisions about when.

## ⛔ B · the walk, which is shared with `439` since this dispatch

⚠️ **`M6` removes `button` from the leave-alone set**, and the failure is specific: a document id
is `doc:<project>:<sequence>:<kind>`, so it SPELLS a project slug between two colons and the
second pass tears the id in three. `M7` and `M8` move the word boundary — `.` in (which refuses
the one occurrence this dispatch exists for, because `reply-rails.ts` ends the sentence with it)
and `:` out (which lets a shorter id eat the head of a longer one). `M9` drops the empty-roster
guard, and an empty alternation matches at every position. `M10` drops longest-first. `M11` drops
the escape on a value that is BYTES OFF A LEDGER rather than a string this app validated. `M12`
inverts the nesting counters. `M13` stops making a roster member's characters literal, so a `.` in
a project slug becomes a wildcard inside the id that carries it — and it is killed by `439`'s
suite as well as by this one, which is the measurement that the walk really is one mechanism and
not a copy.

⛔ **`439`'s own `M17`, `M18`, `M21` and `M27` are the rows for the leave-alone set, the
whole-word check, the escape and the entity walk-around.** ⚠️ They moved with the walk and were
CORRECTED rather than retired, and re-verified RED at their new addresses — so this table does not
restate them.

## ⚠️ C · the wiring, and the hops nobody would notice going missing

⛔ **`M14` flips the order in `AssistantMessage`**, which is the composition `M6` guards from the
other side. `M15` builds the roster from the MODE's list rather than from the window's, so a
control appears and disappears as a person flips the transcript mode. `M16` sends a different id
than the one pressed. `M17` and `M18` cut the prop at each of its two hops. `M19` takes the
affordance off the control, which is `562` §3.3 — whether a person can tell a pressable id from
one that is not. `M20` puts the work report's words on it, which are false of a prompt.

## ⛔ What this table does NOT cover

⚠️ **The door.** `readCanonicalDocument` is `510`'s and `549`'s; nothing here mutates it, and the
five refusals it answers with are pinned by `the-id-this-app-hands-a-person.render.test.ts`.
⚠️ **The delegation's `closest`.** A click always lands on the button element in this harness —
the button's only child is a text node and `HTMLElement.click()` targets the element — so a row
that swapped `closest` for `getAttribute` would be a row no test can kill, and
`a-line-no-mutation-can-kill-is-not-carrying-its-rule` says to say so rather than to write it.
"""

WALK = "apps/desktop/src/renderer/src/lib/named-in-a-reply.ts"
ROSTER = "apps/desktop/src/renderer/src/lib/the-document-a-report-names.ts"
NAMED = "apps/desktop/src/renderer/src/lib/the-documents-a-reply-names.ts"
MESSAGE = "apps/desktop/src/renderer/src/components/AssistantMessage.vue"
VIEW = "apps/desktop/src/renderer/src/components/TranscriptView.vue"

MUTATIONS = [
    # ---- A · the roster ------------------------------------------------------------------------
    (
        "M1 · 🔴 **the surface's reader stops deciding** · a pane with nowhere to send the press "
        "draws one anyway, which is `106`'s dead control on the surface `510` wrote the default for",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: the roster must ask the surface's own reader (canOpen) and never assume one. The
        # call now lives in everyResourceAReportNames as
        # found.push(...theResourcesAReportNames(item.report, canOpen)); the plant hard-wires
        # canOpen to true so a pane with nowhere to send the press still gets a roster. Killed by
        # `a-press-that-opens-the-document-it-names.test.ts`,
        # `a-press-that-opens-the-document-it-names.dom.test.ts`.
        [
            (ROSTER, 'theResourcesAReportNames(item.report, canOpen)', 'theResourcesAReportNames(item.report, true)'),
        ],
    ),
    (
        "M2 · ⛔ **the id is harvested out of the PROSE** · `548` §Q4's forbidden version, and "
        "`work-report.ts` forbids it by name — the app's own sentence ends the id with a full stop, "
        "so the harvested string is not the id it names",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 548 §Q4 (never
        # harvest an id out of prose) still governs the roster, which is the typed
        # WorkReport.resources field only. The plant harvests res_ tokens from item.text instead of
        # reading the field; the label's full-stop clause is stale (the app's sentence now reads
        # 'res_… (name), … . Read one…'), but the harvest is still red because the same-predicate
        # test feeds rows whose text is empty. Killed by
        # `a-press-that-opens-the-document-it-names.test.ts`.
        [
            (ROSTER, 'found.push(...theResourcesAReportNames(item.report, canOpen))', 'if (canOpen) found.push(...(item.text.match(/res_\\S+/g) ?? []))'),
        ],
    ),
    (
        "M3 · ⚠️ **the type guard is bypassed** · `documentId: 42` off a `.passthrough()`'d bundle "
        "reaches the roster, and a number is handed to the bridge",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The type guard
        # survives, but it moved inside theResourcesAReportNames (typeof id === 'string' &&
        # id.length > 0), which the roster now calls. The plant keeps the empty-string check and
        # drops the typeof check, so a passthrough'd .brobot bundle with a number or object in
        # resources reaches the roster; the 562 same-predicate test cannot see it because both sides
        # share the function, so the killer is the-id-this-app-hands-a-person section 3. Killed by
        # `the-id-this-app-hands-a-person.test.ts`.
        [
            (ROSTER, "typeof id === 'string' && id.length > 0", "id !== ''"),
        ],
    ),
    (
        "M4 · ⚑ **the dedupe goes** · two replies on one task each register a document, and a "
        "roster with a duplicate builds an alternation that matches the same string twice",
        [(ROSTER, "return [...new Set(found)]", "return found")],
    ),
    (
        "M5 · 🔴 **a SECOND predicate** · the row this function's own docblock names: the prose "
        "control and the work report's button stop being one decision about WHEN, and they agree "
        "on every input but the empty string",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # prose control and the work report's own press are one decision about WHEN) still holds and
        # is the docblock's own stated subject. The plant inlines a second predicate in the roster
        # that agrees with theResourcesAReportNames on every input except the empty string. Killed
        # by `a-press-that-opens-the-document-it-names.test.ts`.
        [
            (ROSTER, 'found.push(...theResourcesAReportNames(item.report, canOpen))', "if (canOpen && Array.isArray(item.report.resources)) found.push(...item.report.resources.filter((id) => typeof id === 'string'))"),
        ],
    ),
    # ---- B · the walk --------------------------------------------------------------------------
    (
        "M6 · 🔴 **a control this app already wrote is read as prose** · the second pass finds the "
        "project slug between two colons inside `doc:sample-web:4:response` and tears the id in three",
        [(WALK, "new Set(['pre', 'a', 'button'])", "new Set(['pre', 'a'])")],
    ),
    (
        "M7 · ⛔ **the full stop becomes part of the id** · which refuses the one occurrence this "
        "dispatch exists for, because `reply-rails.ts` ends the sentence immediately after it",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The full-stop
        # rule is stated in the current PART_OF_AN_ID docblock ('. and : are OUT, measured rather
        # than tidy'), because the app's sentence ends its list of ids with a full stop. The class
        # is now /[A-Za-z0-9_-]/, so the plant adds the dot to it and refuses the one occurrence
        # this module exists for. Killed by `a-press-that-opens-the-document-it-names.test.ts`.
        [
            (NAMED, 'const PART_OF_AN_ID = /[A-Za-z0-9_-]/', 'const PART_OF_AN_ID = /[A-Za-z0-9_.-]/'),
        ],
    ),
    (
        "M8 · ⚠️ **the colon stops being part of the id** · so a roster holding `doc:a:1:response` "
        "marks the head of `doc:a:1:response:2` and the press carries an id nobody named",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The label (a colon stops being part of the id) is stale: the colon is already out of the
        # class, and the current class is /[A-Za-z0-9_-]/. The live analogue of a character wrongly
        # leaving the id set is the hyphen, which is the only tested member left (dot is M7,
        # underscore is untested so not used). Plant: drop the hyphen from PART_OF_AN_ID. Killer:
        # a-press-that-opens-the-document-it-names.test.ts, 'a HYPHEN is part of it, so a shorter id
        # does not eat a longer one': with [REAL] on the roster, the text `${REAL}-2` must NOT match
        # (with the plant the boundary is now at the hyphen and REAL matches), and its paired
        # positive (`${REAL}` alone matches) stays green. Not a duplicate of M7 (which adds the
        # dot). Killed by `a-press-that-opens-the-document-it-names.test.ts`.
        [
            (NAMED, 'const PART_OF_AN_ID = /[A-Za-z0-9_-]/', 'const PART_OF_AN_ID = /[A-Za-z0-9_]/'),
        ],
    ),
    (
        "M9 · ⛔ **the empty-roster guard goes** · an empty alternation matches the empty string at "
        "every position, so a surface with no reader turns every character of every reply into a "
        "control — the widest possible version of the defect `548` §Q4 refuses",
        [(NAMED, "  if (named.length === 0) return html\n", "")],
    ),
    (
        "M10 · ⚠️ **longest-first goes** · a shorter id silently eats the head of a longer one and "
        "leaves its tail dangling beside the control",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Longest-first
        # ordering still matters: the roster is joined into one alternation and a boundary failure
        # moves the walk past the match, so a shorter id listed first hides a longer one. The plant
        # drops the .sort on documentsNamedIn's roster. Killed by
        # `a-press-that-opens-the-document-it-names.test.ts`.
        [
            (NAMED, '  const named = [...new Set(resourceIds.filter((id) => id.length > 0))].sort(\n    (a, b) => b.length - a.length,\n  )\n', '  const named = [...new Set(resourceIds.filter((id) => id.length > 0))]\n'),
        ],
    ),
    (
        "M11 · 🔴 **the escape goes** · a `documentId` is BYTES OFF A LEDGER rather than a string "
        "this app validated, so the one thing standing between a row with a quote in it and "
        "reopened markup is this call",
        [(NAMED, "      const safe = escaped(id)\n", "      const safe = id\n")],
    ),
    (
        "M12 · ⛔ **the nesting counters step the wrong way** · `<pre>` decrements to the clamp and "
        "`</pre>` increments, so nothing before a fence is marked and everything inside one is — "
        "the skip inverted rather than removed",
        [
            (
                WALK,
                "      const step = tag.startsWith('</') ? -1 : 1\n",
                "      const step = tag.startsWith('</') ? 1 : -1\n",
            )
        ],
    ),
    (
        "M13 · ⚠️ **a roster member's own characters stop being literal** · nothing validates an id "
        "against this walk's regex vocabulary, so `doc:a.b:1:response` in the roster would mark "
        "`doc:axb:1:response` in the words and the press would carry a document nobody named",
        [
            (
                WALK,
                "  return source.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')\n",
                "  return source\n",
            )
        ],
    ),
    # ---- C · the wiring ------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The two-roster order the row swaps no
        # longer exists. D-016 removed the `places` prop and `projectsNamedIn` from
        # AssistantMessage.vue, so only `documentsNamedIn(renderChatMarkdown(props.item.text),
        # props.documents ?? [])` is left and there is no second roster to reorder. The commit line
        # is 'the project rooms, board, sheet and picker, project folders and their rails ... are
        # removed'. Its anchor is left stale, so the census records it retired.
        "M14 · 🔴 **the two rosters run in the other order** · `places` claims the slug inside the "
        "id before the id can claim its own characters — `M6`'s failure from the other side",
        [
            (
                MESSAGE,
                "  const named = documentsNamedIn(renderChatMarkdown(props.item.text), props.documents ?? [])\n"
                "  return projectsNamedIn(named, props.places ?? [])\n",
                "  const named = projectsNamedIn(renderChatMarkdown(props.item.text), props.places ?? [])\n"
                "  return documentsNamedIn(named, props.documents ?? [])\n",
            )
        ],
    ),
    (
        "M15 · ⛔ **the roster is built from the MODE's list** · so a control appears and "
        "disappears as a person flips the transcript mode, which is a fact about a document "
        "answered by a display setting",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The roster
        # must be built from the window's items (props.items), not the mode's list, so a control
        # does not appear and disappear as the transcript mode flips. TranscriptView.vue still
        # builds it at everyResourceAReportNames(props.items, props.canOpenDocument), and the plant
        # feeds it shown.value instead. Killed by
        # `a-press-that-opens-the-document-it-names.test.ts`.
        [
            (VIEW, '  everyResourceAReportNames(props.items, props.canOpenDocument),', '  everyResourceAReportNames(shown.value, props.canOpenDocument),'),
        ],
    ),
    (
        "M16 · ⚠️ **the press sends a different id than the one it names** · the panel then echoes "
        "a document nobody pressed, which is what `CanonicalDocumentResult.documentId` exists to "
        "make visible",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The press must
        # send the id it names, unchanged. AssistantMessage.vue still emits emit('openDocument',
        # resourceId) from the delegated click; the plant upper-cases the id (resource ids are
        # lower-case hex) so the panel would open something nobody pressed. Killed by
        # `a-press-that-opens-the-document-it-names.dom.test.ts`,
        # `a-press-that-opens-the-document-it-names.test.ts`.
        [
            (MESSAGE, "emit('openDocument', resourceId)", "emit('openDocument', resourceId.toUpperCase())"),
        ],
    ),
    (
        "M17 · ⛔ **the message ignores the roster it was handed** · the leaf hop, where every "
        "control in the transcript disappears at once · killed by `a-press-that-opens-the-document-it-names.dom.test.ts`",
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 619f250d renders the markdown once into its own computed and marks paths after the roster; the plant still hands the reply an empty roster, so no id in it becomes a press.
        [(MESSAGE, "documentsNamedIn(markdown.value, props.documents ?? [])", "documentsNamedIn(markdown.value, [])")],
    ),
    (
        "M18 · ⚑ **the view stops passing it** · the middle hop, which is `439`'s own note: a prop "
        "nobody would notice going missing",
        [(VIEW, '        :documents="documentsNamed"\n', "")],
    ),
    (
        "M19 · 🔴 **the affordance goes** · `562` §3.3 — a pressable id and one that is not render "
        "identical ink, which is `530`'s family arriving by accident rather than by design",
        [
            (
                MESSAGE,
                "  text-decoration: underline;\n  text-underline-offset: 2px;\n  cursor: pointer;\n}\n.msg-body :deep(.open-the-document:hover),",
                "  cursor: pointer;\n}\n.msg-body :deep(.open-the-document:hover),",
            )
        ],
    ),
    (
        "M20 · ⚠️ **the work report's words on a row that may be a PROMPT** · `Read the full "
        "response` over `004-prompt.md`, which is the counter-example `550` wrote "
        "`READ_THE_DOCUMENT` under",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # work report's word on a row that may be a prompt must be 'Read this document' and not the
        # report's 'Read the full response'. The constant is now a plain literal in
        # the-documents-a-reply-names.ts instead of an alias of `READ_THE_DOCUMENT`, and the plant
        # is that literal replaced with the report's word.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (an
        # id inside somebody else's sentence must not wear the work report's 'kept with this reply'
        # words) is the READ_THE_DOCUMENT_NAMED docblock's own argument and is asserted today. The
        # constant is now 'Open this file' (D-016a's 'Read this document' literal is stale); the
        # plant gives it the work report's OPEN_THE_DOCUMENT words. Killed by
        # `a-press-that-opens-the-document-it-names.test.ts`.
        [
            (NAMED, "export const READ_THE_DOCUMENT_NAMED = 'Open this file'", "export const READ_THE_DOCUMENT_NAMED = 'Open the file kept with this reply'"),
        ],
    ),
]
