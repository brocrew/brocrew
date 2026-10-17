"""635 · Documents hold what agents produce — each row is THE DEFECT, put back verbatim (131).

⛔ **What 635 did, in one sentence.** `HO-097` §1 widened the document store past Markdown — a
report, a page, an image, a PDF — on machinery that already worked, and `HO-097` §1.3 put one
constraint on it that is not negotiable: **viewing a document never executes its code inside
BroBot.**

| rows | what they are |
|---|---|
| `M1`-`M3` | 🔴 **the allow-list** — the gate opened, the extension dropped, and the form guessed instead of derived |
| `M4`-`M5` | ⛔ **canonicalisation** — a picture decoded as text, and an empty file taken |
| `M6`-`M7` | ⚑ **the bounds** — one number for every form, and the reader's ceiling written twice |
| `M8`-`M10` | 🔴 **what a model is handed** — the union collapsed back to a string, the silent arm made silent, and a page handed over as Markdown |
| `M11`-`M12` | ⛔ **the refusal** — the act taken off a permanent rail, and a remedy field put on one |
| `M13`-`M14` | 🔴 **THE CONSTRAINT** — the page rendered as HTML, and the Markdown view offered over one |

## ⛔ What this table cannot reach, said out loud

⚠️ **No row covers the image or PDF DISPLAY, because `635` did not build it.** ⛔ Registration,
listing and agent-readability all cover every form; what a person sees for a picture is a sentence
saying the window cannot draw it yet. ⚑ **A row for a thing that was not built measures nothing**
(`a-line-no-mutation-can-kill-is-not-carrying-its-rule`), and the response names the design the
display needs instead.

⚠️ **No row mutates `markdown.ts`.** `html: false` is `050`'s and its own module calls it *"the
whole security story"*; a row there would be measuring somebody else's work — and `M13` reaches the
same property from this dispatch's side, which is where `635` could have broken it.

⚠️ **No row mutates the `HO-057` rewording.** It is prose in six places and a docblock is not a
rail; what would catch a wrong wording is a reader, and `549`'s own suite is that reader.
"""

DOC = "apps/desktop/src/main/documents/canonical-document.ts"
SHARED = "apps/desktop/src/shared/documents.ts"
REGISTRY = "apps/desktop/src/main/documents/document-registry.ts"
VIEWER = "apps/desktop/src/renderer/src/components/CanonicalDocumentViewer.vue"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"

MUTATIONS = [
    # ── the allow-list ────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the gate takes ANYTHING · the allow-list stops deciding and every extension is "
        "admitted, so a `.zip`, a `.app` and an executable are copied into a tree this app keeps "
        "forever. ⛔ A deny-list is the wrong shape for untrusted input and this is the absence of "
        "any list at all",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives, lifted into `readOfferedResource` in `resources/resources.ts`, whose docblock
        # says the allow-list and the per-form bound are 'theirs, unchanged in what they refuse'. A
        # file whose extension is not on `FORM_OF_EXTENSION` is still refused
        # `resource-not-a-form-this-app-keeps`. The plant guesses `markdown` instead of refusing. It
        # replaces the deleted `canonical-document.ts` anchor. Killed by
        # `documents-hold-what-agents-produce.test.ts`.
        [
            (RESOURCES, "  const form = formOfName(name)\n  if (form === null) {\n    return {\n      ok: false,\n      refusal: refuseResource('resource-not-a-form-this-app-keeps', { path: realPath }),\n    }\n  }", "  const form: DocumentForm = formOfName(name) ?? 'markdown'"),
        ],
    ),
    (
        "M2 · ⛔ the canonical copy loses the source's extension · every document is named `.md` "
        "again, so a PNG is filed as Markdown and `formOfName` reads every registered document "
        "back as a report. ⚑ The derivation has ONE writer and this is that writer lying",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives as 'the kept copy keeps the source's own extension, so `formOfName` reads the
        # form back from the kept name'. `resources.ts` stores `<sha256>/<file's own name>` and
        # derives the form from the name, with no column. The old canonical-name builder is gone, so
        # the plant is the returned `name`: the extension is rewritten to `.md`. Killed by
        # `documents-hold-what-agents-produce.test.ts`.
        [
            (RESOURCES, '  return { ok: true, name, form, bytes, sha256: sha256Hex(bytes) }', "  return { ok: true, name: name.replace(/\\.[^.]+$/, '.md'), form, bytes, sha256: sha256Hex(bytes) }"),
        ],
    ),
    (
        "M3 · ⚠️ the form is GUESSED where it cannot be read · a canonical name this build has no "
        "word for folds to `markdown` instead of refusing, so bytes written by a later build are "
        "handed to a model as text. ⛔ `an-unenumerated-state-counts-as-success`, on the read side",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives on the read side of `resourceBytes`: a kept name this build has no word for reads
        # `resource-bytes-unreadable` and is never guessed as text. The comment in the code says so
        # and the check is unchanged in effect. The plant folds an unknown name to `markdown` and
        # disables the refusal. Killed by `documents-hold-what-agents-produce.test.ts`.
        [
            (RESOURCES, "  const form = formOfName(row.name)\n  if (form === null) return refused('resource-bytes-unreadable')", "  const form = formOfName(row.name) ?? 'markdown'\n  if (false as boolean) return refused('resource-bytes-unreadable')"),
        ],
    ),
    # ── canonicalisation ──────────────────────────────────────────────────────────────────────
    (
        "M4 · 🔴 a PICTURE is canonicalised as text · every form goes through the UTF-8 decoder "
        "again, so a PNG is refused as `resource-not-text` and an image can never be registered. "
        "⛔ The widening undone at the one line that made it possible",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in `readOfferedResource`: the UTF-8 decode runs only when `CONTENT_OF_FORM[form]
        # !== 'not-for-a-model'`, so pictures and PDFs are kept as bytes. The plant makes the guard
        # unconditional, so every form goes through the fatal UTF-8 decoder and a PNG or PDF header
        # is refused `resource-not-text`. Killed by `documents-hold-what-agents-produce.test.ts`.
        [
            (RESOURCES, "  if (CONTENT_OF_FORM[form] !== 'not-for-a-model') {", '  if (true as boolean) {'),
        ],
    ),
    (
        "M5 · ⛔ an EMPTY picture is registered · the one rule that still applies to a binary form "
        "goes, so a zero-byte file is copied, hashed and listed as a deliverable. ⚠️ "
        "`resource-empty`'s own sentence — *an empty document is not a reply* — is true whatever "
        "the type is",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives, now as one empty-file refusal that applies to every form (`resource-empty`), and
        # `work_resource_bytes_ck` refuses `bytes >= 1` in the database too. The plant deletes the
        # application-level check, so an empty picture is no longer refused by the app. Killed by
        # `documents-hold-what-agents-produce.test.ts`.
        [
            (RESOURCES, "  if (bytes.length === 0) {\n    return { ok: false, refusal: refuseResource('resource-empty', { path: realPath }) }\n  }\n", ''),
        ],
    ),
    # ── the bounds ────────────────────────────────────────────────────────────────────────────
    (
        "M6 · ⚑ ONE bound for every form · the per-form table collapses to the text number, so a "
        "screenshot is refused as too large and `HO-097` §1.4's whole complaint comes back. ⛔ "
        "*1 MiB was sized for reports and is small for an image or a PDF*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in `MOST_BYTES_OF_FORM`: the per-form bound (text 1 MiB, image and PDF 16 MiB) is
        # kept in the lifted module. The plant collapses image and pdf to the text bound, so a
        # screenshot over 1 MiB is refused as too large. Killed by
        # `documents-hold-what-agents-produce.test.ts`.
        [
            (RESOURCES, '  image: 16_777_216,\n  pdf: 16_777_216,', '  image: MAX_TEXT_RESOURCE_BYTES,\n  pdf: MAX_TEXT_RESOURCE_BYTES,'),
        ],
    ),
    (
        "M7 · ⚠️ the READER's ceiling stops following the writer · it is written as the old literal "
        "again, so every document over 1 MiB registers and then cannot be read back — the app "
        "refuses its own files. ⛔ A number written twice is two numbers",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the reader's ceiling `MOST_BYTES_OF_ANY_FORM` is derived from the widest form,
        # and `readOwnFile` refuses anything above it. The plant writes it as the text literal, so a
        # picture over 1 MiB is kept and then cannot be read back. Killed by
        # `documents-hold-what-agents-produce.test.ts`.
        [
            (RESOURCES, 'export const MOST_BYTES_OF_ANY_FORM = Math.max(...Object.values(MOST_BYTES_OF_FORM))', 'export const MOST_BYTES_OF_ANY_FORM = MAX_TEXT_RESOURCE_BYTES'),
        ],
    ),
    # ── what a model is handed ────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 **THE DEFECT `HO-097` §1.2 NAMES** · every form is handed over as text, so a model "
        "reading a PNG gets the bytes decoded as UTF-8 — mojibake presented as a document. ⛔ "
        "*Where a type cannot be handed to a model, the tool says so plainly rather than returning "
        "something useless*",
        [
            (
                SHARED,
                "  image: 'not-for-a-model',\n  pdf: 'not-for-a-model',",
                "  image: 'source',\n  pdf: 'source',",
            )
        ],
    ),
    (
        "M9 · ⛔ the silent arm says the wrong thing about itself · a PDF reports that a picture is "
        "not text. ⚠️ The member exists, the union compiles, and the model is told a fact about a "
        "different file — `a-closed-vocabulary-guards-what-a-member-says`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in `contentOf`: the two silent arms each say their own reason,
        # `a-picture-is-not-text` for an image and `a-pdf-is-not-text` for a PDF. The plant reports
        # the picture's reason for both, so a PDF is described as a picture. Killed by
        # `documents-hold-what-agents-produce.test.ts`.
        [
            (RESOURCES, "        because: form === 'image' ? 'a-picture-is-not-text' : 'a-pdf-is-not-text',", "        because: 'a-picture-is-not-text',"),
        ],
    ),
    (
        "M10 · ⚠️ a PAGE is handed over as MARKDOWN · the source arrives under a word that says it "
        "is a rendered document, so a model reading HTML is told it read a report. ⛔ The two arms "
        "carry the same string and differ only in what they CLAIM, which is the whole of `as`",
        [
            (
                SHARED,
                "  page: 'source',",
                "  page: 'markdown',",
            )
        ],
    ),
    # ── the refusal ───────────────────────────────────────────────────────────────────────────
    (
        "M11 · 🔴 the refusal names no act · the PO's own words go and the sentence stops at what is "
        "wrong. ⛔ `HO-097` §1.4: *whatever is still refused gets a refusal that names a performable "
        "act* — and `PM-095` §3.2 found this was the one resource rail with none",
            # ⚑ **Corrected in place at `731`** onto the lines that replaced the one this was
            # anchored on: the act's constant is `KEEP_IT_AND_NAME_ITS_PATH` now (the PM, ruling on
            # `726` §9: its folder became a habit). The subject — the sentence names an act — did
            # not move; re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in `RESOURCE_SENTENCES`: the `resource-not-a-form-this-app-keeps` refusal still
        # names a performable act (`KEEP_IT_AND_NAME_ITS_PATH`), in the PO's words from HO-097
        # section 1.4. The plant drops the act from the sentence. Killed by
        # `documents-hold-what-agents-produce.test.ts`, `the-last-folder-words.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: the refusal for a file type this app does not keep names a performable act.
        # D-016c made the sentences door-neutral, changing 'the reply was not recorded' to 'nothing
        # was recorded', so the old anchor stopped matching. The corrected anchor matches once. The
        # plant drops the act from the sentence. Killed by
        # `documents-hold-what-agents-produce.test.ts`, `the-last-folder-words.test.ts`.
        [
            (RESOURCES, "    'this app does not keep files of that type, so nothing was kept and nothing was recorded.' +\n    KEEP_IT_AND_NAME_ITS_PATH,\n", "    'this app does not keep files of that type, so nothing was kept and nothing was recorded.',\n"),
        ],
    ),
    (
        "M12 · ⛔ the act becomes *write another file* · a deliverable this store will never hold is "
        "answered with the remedy for a file that was unreadable, so a model rewrites a PDF as "
        "Markdown and loses the work. ⚠️ The two acts are different and the difference is the point · killed by `the-last-folder-words.test.ts` · killed by `documents-hold-what-agents-produce.test.ts`",
            # ⚑ **Corrected in place at `731`**: the same act under its new name and words
            # (`KEEP_IT_AND_NAME_ITS_PATH`, the folder a habit after it); re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `KEEP_IT_AND_NAME_ITS_PATH` is the act for a file the store will never hold, and
        # it differs from `OFFER_ANOTHER_FILE`, the act for a file that could be held. Its text is
        # unchanged in `resources.ts`. The plant makes the never-held act say to write another file.
        # Killed by `documents-hold-what-agents-produce.test.ts`, `the-last-folder-words.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: the act for a file the store will never hold must differ from the act for an
        # unreadable one. The KEEP_IT_AND_NAME_ITS_PATH constant's words changed ('Keep it where it
        # is and name its path in what you write instead'), so the old anchor stopped matching. The
        # table's note that its text was unchanged is now out of date. The plant makes the
        # never-held act say to write another file. Killed by
        # `documents-hold-what-agents-produce.test.ts`, `the-last-folder-words.test.ts`.
        [
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 4fe481a6 made the refusal say to name the file's full path and dropped 'instead'; the plant still answers a file the store will never hold with the remedy for an unreadable one.
            # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the refusal repeats the v6 core's folder habit now
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
            # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 says the core's folder clause as 'Use the assigned folder', and the refusal repeats it; the same defect on the new words
            (RESOURCES, "const KEEP_IT_AND_NAME_ITS_PATH =\n  ' Keep it where it is and name its full path in what you write. Use the assigned folder.'", "const KEEP_IT_AND_NAME_ITS_PATH = OFFER_ANOTHER_FILE"),
        ],
    ),
    # ── the constraint ────────────────────────────────────────────────────────────────────────
    (
        "M13 · 🔴 **THE CONSTRAINT `HO-097` §1.3 FORBIDS** · the page is put into the document as "
        "HTML, so an agent-written script runs in the window that holds the person's approvals. ⛔ This "
        "is the row the whole dispatch is written against, and `documents-hold-what-agents-produce"
        ".dom.test.ts` is what catches it",
        [
            (
                VIEWER,
                '        :source-only="result.form !== \'markdown\'"\n      />',
                '        :source-only="result.form !== \'markdown\'"\n      />\n      <div v-html="result.text"></div>',
            )
        ],
    ),
    (
        "M14 · ⚠️ a page is offered a MARKDOWN view · the toggle comes back over a file that is not "
        "Markdown, so a person pressing it is promised a rendering of the page and shown its source "
        "with characters eaten. ⛔ Safe, and a word that is not true of what it does",
        [
            (
                VIEWER,
                '        :source-only="result.form !== \'markdown\'"',
                '        :source-only="false"',
            )
        ],
    ),
]
