import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { workAnswered, replyText } from '../src/main/runtime/reply-rails'
import {
  applyEvent,
  createTranscript,
  type TranscriptItem,
} from '../src/renderer/src/lib/transcript'
import {
  everyResourceAReportNames,
  theResourcesAReportNames,
} from '../src/renderer/src/lib/the-document-a-report-names'
import {
  documentsNamedIn,
  READ_THE_DOCUMENT_NAMED,
} from '../src/renderer/src/lib/the-documents-a-reply-names'
import { OPEN_THE_DOCUMENT } from '../src/renderer/src/lib/the-document-a-report-names'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 562 · a press that opens the document it names
 *
 * Resources in the conversation transcript must be visible and their links must open the
 * named document.
 *
 * ## ⛔ What this suite is about, and what `548` forbade
 *
 * `548` §Q4, verbatim: *"Do not regex every code span into a button … The safe enhancement is to
 * carry a typed document reference in the transcript/work-report shape, validate it against the
 * canonical document door, and render the button only after that validation. If no typed reference
 * exists, preserving a non-control code span is correct."*
 *
 * ⚑ **The typed reference exists and it is {@link WorkReport.resources}** — the field `510` put on
 * the work report so a person's press would not be parsed out of prose (a `documentId` until D-016
 * made a reply's files RESOURCES, each kept as `res_<32 hex>`). 🔴 **This suite's subject is the
 * roster built from it**, and the three cases the brief names are §0.
 *
 * ## ⚠️ The sections
 *
 *  - **§0** the three planted cases — a real id, a well-formed one that names nothing, and a code
 *    span that is not an id at all.
 *  - **§1** where the roster comes from, and that it is ONE derivation with the work report's own
 *    press rather than a second opinion about when a document may be opened.
 *  - **§2** what the walk will not touch, including the character the app's own sentence puts
 *    immediately after the id.
 *  - **§3** one walk and not two — the mechanism `439` wrote, now shared, measured so a second
 *    private copy cannot appear.
 *  - **§4** the wiring, in `537`'s shape: what does each surface that opens a document derive its
 *    target from.
 *
 * ⚑ **D-016 · the project half went**: `places.ts` (a project slug named in a reply), the project
 * band's `project-documents.ts` and `ProjectWorkspace.vue` are deleted, so the walk has one
 * vocabulary, §4 has three surfaces, and `READ_THE_DOCUMENT_NAMED` is spelled where it is used.
 * ⚑ **And the document registry went**: an id is a resource's, `res_<32 hex>`, and the words on both
 * presses say *file*.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SRC = (path: string): string => readFileSync(join(here, path), 'utf8')

/**
 * ⛔ **Prose stripped before any NEGATIVE is asserted** —
 * `a-source-census-must-strip-prose-before-it-asserts`, and it fired on this very suite while it
 * was being written: §3's *"a document id is one pattern in both contexts"* read `NAME_SHAPED` out
 * of the new module's own DOCBLOCK, where it is a `{@link}` explaining why that narrowing does not
 * apply. ⚑ The stripper is `534`'s, unchanged, for its reason.
 */
const withoutComments = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

/** ⚑ The code of a file, with every comment gone. */
const CODE = (path: string): string => withoutComments(SRC(path))

/** ⚑ The id the app actually mints, in the shape `newResourceId` writes it. */
const REAL = 'res_4c2f0e1a111142228333444455556666'
/** ⛔ Well formed, same shape, and no work report in this transcript ever carried it. */
const WISHED_FOR = 'res_99999999111142228333444455556666'

/** The markdown a model writes, rendered the way the transcript renders it. */
const asChat = (markdown: string): string =>
  // ⚑ A stand-in for `renderChatMarkdown`'s output shape. The real renderer is exercised in
  // `dom/a-press-that-opens-the-document-it-names.dom.test.ts`, which mounts the component.
  `<p>${markdown}</p>\n`

const CONTROL = /data-cy="open-the-document"/

describe('562 · a press that opens the document it names', () => {
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §0 · the three cases
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§0 · a real id, one that names nothing, and a code span that is not an id', () => {
    it('🔴 an id this app kept becomes a control that carries it back unchanged', () => {
      const out = documentsNamedIn(asChat(`The answer is in ${REAL}.`), [REAL])
      expect(out).toContain(`data-document="${REAL}"`)
      expect(out).toContain(`>${REAL}</button>`)
      // ⛔ **The words say what it opens and never what it costs**, and they are `550`'s rather
      // than `510`'s — an id in a sentence may name a PROMPT.
      expect(out).toContain(`title="${READ_THE_DOCUMENT_NAMED}"`)
    })

    it('⛔ a WELL-FORMED id this app never kept stays exactly the text it was', () => {
      // 🔴 **The middle case, and it is the defect the cheap version ships.** A model can write a
      // `res_…` in a sentence about a file it wishes existed; the shape is indistinguishable from
      // the real one and only the roster can tell them apart.
      const html = asChat(`I have put it in ${WISHED_FOR} for you.`)
      expect(documentsNamedIn(html, [REAL])).toBe(html)
      // ⚑ **Paired positive, one fact over**: the identical sentence with that id IN the roster
      // does draw one, so the absence is about the roster rather than about a walk that never
      // matches.
      expect(documentsNamedIn(html, [REAL, WISHED_FOR])).toMatch(CONTROL)
    })

    it('⚑ a code span that is not an id at all is returned byte for byte', () => {
      const html = '<p>Run <code>pnpm run ci</code> and read <code>README.md</code>.</p>\n'
      expect(documentsNamedIn(html, [REAL])).toBe(html)
      // ⚑ **Paired positive**: an id inside a code span IS a control, so the untouched span above
      // is about what the text says and not about `<code>` being skipped.
      const quoted = documentsNamedIn(`<p>see <code>${REAL}</code></p>`, [REAL])
      expect(quoted).toMatch(CONTROL)
      expect(quoted).toContain(`<code><button`)
    })

    it('⛔ an empty roster returns the html untouched, which is every surface with no reader', () => {
      const html = asChat(`The answer is in ${REAL}.`)
      expect(documentsNamedIn(html, [])).toBe(html)
      expect(documentsNamedIn(html, [''])).toBe(html)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · where the roster comes from
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the roster is the app’s own typed field, and it is ONE derivation', () => {
    const piece = { piece: 'work_9', label: 'W1.4', title: 'the notes', owner: 'sess_child' }
    /**
     * ⚑ **D-016 · commit 7 · R3 — what the reply calls the conversation holding the piece**: its
     * agent's name (the host passes `whatToCallTheConversation(piece.owner)`), never its id.
     */
    const holder = 'Ada'
    const reported = (resource: string | null): TranscriptEvent =>
      ({
        type: 'user_turn',
        text: replyText(
          piece,
          holder,
          { outcome: 'done', summary: 'Done.', needsUserAction: false },
          resource === null ? [] : [{ resource, name: 'notes.md' }],
          // ⚑ No new brief of the piece was held for its holder as it answered.
          false,
        ),
        work: workAnswered(
          piece,
          { outcome: 'done', needsUserAction: false },
          resource === null ? [] : [resource],
        ),
      }) as TranscriptEvent

    const fold = (...events: TranscriptEvent[]): readonly TranscriptItem[] => {
      const state = createTranscript()
      for (const event of events) applyEvent(state, event, 1_000)
      return state.items
    }

    it('🔴 the id a real reply kept reaches the roster through the real fold', () => {
      const items = fold(reported(REAL))
      expect(items.some((item) => item.kind === 'workReport')).toBe(true)
      expect(everyResourceAReportNames(items, true)).toEqual([REAL])
    })

    it('⛔ a surface with no reader behind it has an EMPTY roster, not a control that cannot act', () => {
      const items = fold(reported(REAL))
      expect(everyResourceAReportNames(items, false)).toEqual([])
      // ⚑ **The same items with a reader do carry one**, so the empty answer is about the surface.
      expect(everyResourceAReportNames(items, true)).toEqual([REAL])
    })

    it('⚠️ a reply that kept nothing contributes nothing, and that is the commonest row', () => {
      const items = fold(reported(null))
      expect(everyResourceAReportNames(items, true)).toEqual([])
      // ⚑ The row is still a work report — the absence is the FIELD's, not the fold's.
      expect(items.filter((item) => item.kind === 'workReport')).toHaveLength(1)
    })

    it('🔴 it is the SAME predicate the work report’s own press reads — one decision about when', () => {
      // ⛔ **`562` §4.4.** Two presses that open one viewer must not be two decisions about WHEN.
      // ⚑ Driven over every arm of the predicate at once: whatever
      // `theResourcesAReportNames` answers for a row is exactly what the roster holds for it.
      const rows: { readonly resources: unknown }[] = [
        { resources: [REAL] },
        { resources: [''] },
        { resources: undefined },
        { resources: 42 },
        { resources: {} },
        { resources: [7, WISHED_FOR, REAL] },
      ]
      for (const canOpen of [true, false]) {
        const byThePress = rows.flatMap((report) =>
          theResourcesAReportNames(report as { resources: string[] }, canOpen),
        )
        const items = rows.map(
          (report, index) =>
            ({ kind: 'workReport', id: `w${String(index)}`, text: '', report }) as TranscriptItem,
        )
        expect(everyResourceAReportNames(items, canOpen), `canOpen=${String(canOpen)}`).toEqual([
          ...new Set(byThePress),
        ])
      }
    })

    it('⚑ the same resource named by two reports is in the roster once', () => {
      const items = fold(reported(REAL), reported(REAL))
      expect(items.filter((item) => item.kind === 'workReport')).toHaveLength(2)
      expect(everyResourceAReportNames(items, true)).toEqual([REAL])
    })

    it('⛔ and the app’s own sentence is what the roster is matched against', () => {
      // 🔴 **The sentence a person actually reads**, composed by `reply-rails.ts` and carried on
      // the row — quoted here from the real function rather than retyped.
      const said = replyText(
        piece,
        holder,
        { outcome: 'done', summary: 'Done.', needsUserAction: false },
        [{ resource: REAL, name: 'notes.md' }],
        false,
      )
      expect(said).toContain(`Its resources: ${REAL} (notes.md). Read one with read_document.`)
      // ⚠️ **No backticks**, so the id a person is most likely to see is running prose and not a
      // code span — which is why the walk matches in both.
      expect(said).not.toContain('`')
      expect(documentsNamedIn(asChat(said), [REAL])).toMatch(CONTROL)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what the walk will not touch
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the walk, where it must not reach', () => {
    it('🔴 the FULL STOP a sentence puts after the id is not part of it', () => {
      // ⛔ **Measured, not tidy.** A sentence may end immediately after the id — the app's own ends
      // a list of them with one — so a boundary rule that counted `.` as part of a name would
      // refuse the one occurrence this dispatch exists for.
      const out = documentsNamedIn(asChat(`…it is kept as ${REAL}. Read it with read_document.`), [
        REAL,
      ])
      expect(out).toMatch(CONTROL)
      expect(out).toContain(`</button>. Read it`)
    })

    it('⛔ a HYPHEN is part of it, so a shorter id does not eat a longer one', () => {
      const longer = `${REAL}-2`
      const out = documentsNamedIn(asChat(`see ${longer} today`), [REAL])
      expect(out).not.toMatch(CONTROL)
      // ⚑ **Paired positive**: the same roster matches the same characters when nothing follows.
      expect(documentsNamedIn(asChat(`see ${REAL} today`), [REAL])).toMatch(CONTROL)
    })

    it('⚠️ the longer id wins where both could start', () => {
      const longer = `${REAL}-two`
      const out = documentsNamedIn(asChat(`see ${longer}`), [REAL, longer])
      expect(out).toContain(`data-document="${longer}"`)
      expect(out).not.toContain(`data-document="${REAL}"`)
    })

    it('⛔ nothing inside a fence, inside a link, or inside a tag is rewritten', () => {
      const fenced = `<pre><code>read ${REAL}</code></pre>`
      expect(documentsNamedIn(fenced, [REAL])).toBe(fenced)
      const linked = `<a href="https://x/${REAL}" title="${REAL}">link</a>`
      expect(documentsNamedIn(linked, [REAL])).toBe(linked)
      // ⚑ **Paired positive**: prose after the fence still matches, so the skip is the `<pre>`'s
      // and the walk really did come back out of it.
      const both = documentsNamedIn(`${fenced}<p>${REAL}</p>`, [REAL])
      expect(both.match(/data-document/g)).toHaveLength(1)
      expect(both.indexOf('data-document')).toBeGreaterThan(both.indexOf('</pre>'))
    })

    // ⚑ **D-016** — *a project slug INSIDE a document id is not torn out of it* went with
    // `places.ts`: nothing marks a project slug in a reply any more, so there is nothing to tear.

    it('🔴 an id is matched LITERALLY, so a dot in a roster member is not a wildcard', () => {
      // ⛔ **Nothing validates an id against this walk's regex vocabulary.** A resource id is bytes
      // off a ledger and may carry a `.`, so `res_a.b` in the roster would otherwise mark `res_axb`
      // in the words, and the press would carry a file nobody named.
      const dotted = 'res_a.b'
      expect(documentsNamedIn(asChat(`see res_axb`), [dotted])).toBe(asChat('see res_axb'))
      // ⚑ **Non-vacuity**: the same roster member IS matched where the characters really are its
      // own, so the answer above is about the escape and not about a roster that never matches.
      expect(documentsNamedIn(asChat(`see ${dotted}`), [dotted])).toContain(
        `data-document="${dotted}"`,
      )
    })

    it('⚑ one pattern serves a code span and the prose after it, and both are marked', () => {
      // ⚠️ **Measured rather than assumed.** The first draft allocated two `RegExp` objects
      // against a `lastIndex` carrying between contexts; the walk resets on entry and a failing
      // `exec` resets by itself, so one object is correct — and this is the case that would have
      // shown it if it were not.
      const out = documentsNamedIn(
        `<p>The long first paragraph mentions <code>${REAL}</code> well past its start.</p><p>${REAL}</p>`,
        [REAL],
      )
      expect(out.match(/data-document/g)).toHaveLength(2)
    })

    it('⚠️ an HTML entity is walked around, and the id is escaped on the way out', () => {
      // ⛔ **A resource id is BYTES OFF A LEDGER**, not a string this app validated on the way in
      // — `toPersistedEvents` casts and a `.brobot` bundle is `.passthrough()`'d — so the escape
      // is load-bearing rather than defensive.
      const hostile = 'res_a"b'
      const out = documentsNamedIn(`<p>see ${hostile}</p>`, [hostile])
      expect(out).toContain('data-document="res_a&quot;b"')
      expect(out).toContain('>res_a&quot;b</button>')
      expect(out).not.toContain('data-document="res_a"b')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · one walk, not two
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the mechanism is shared, so a vocabulary cannot drift from it', () => {
    const WALK = '../src/renderer/src/lib/named-in-a-reply.ts'
    // ⚑ **D-016** — `places.ts` went with projects, so one vocabulary calls the walk now; the census
    // still asks it not to carry a second one.
    // Paths in a message are the second vocabulary; main, not a roster, says which are real.
    const VOCABULARIES = [
      '../src/renderer/src/lib/the-documents-a-reply-names.ts',
      '../src/renderer/src/lib/the-paths-a-message-names.ts',
    ]

    it('🔴 every vocabulary calls the one walk, and none declares a second one', () => {
      // ⛔ `169`: *"The validation must be ONE rule, not two."* ⚑ `537`'s discharge: fixed at the
      // derivation rather than at the call sites.
      for (const path of VOCABULARIES) {
        const source = CODE(path)
        expect(source, path).toContain("from './named-in-a-reply'")
        expect(source, path).toContain('markNamesIn(html, {')
        // ⛔ **The walk's own moving parts, named** — a second private copy would have to bring
        // them, and `a-second-function-in-the-same-shape-disarms-a-file-scoped-census` is what it
        // would cost.
        expect(source, path).not.toContain("indexOf('<')")
        expect(source, path).not.toContain('LEAVE_ALONE')
      }
      expect(CODE(WALK)).toContain('const LEAVE_ALONE')
      expect(CODE(WALK)).toContain("html.indexOf('<', index)")
    })

    it('⛔ the walk skips a control this app already wrote, and says which tags it skips', () => {
      expect(CODE(WALK)).toContain("new Set(['pre', 'a', 'button'])")
    })

    it('⚠️ a resource id is one pattern in both contexts', () => {
      // 🔴 **The policy stayed with each caller** — that is the whole reason the walk could move.
      // ⚑ A `res_<32 hex>` is not a word anybody writes by accident, so running prose is not
      // narrowed. (⚑ D-016 — the other half, `places.ts`' `NAME_SHAPED` narrowing of a project
      // slug, went with projects.)
      // ⛔ **The CODE and not the file.** The module's docblock CITES `NAME_SHAPED` to explain why
      // it does not have one, and a raw-file read of this negative was green-then-red on that
      // sentence while this suite was being written.
      expect(CODE('../src/renderer/src/lib/the-documents-a-reply-names.ts')).not.toContain(
        'NAME_SHAPED',
      )
      // ⚑ Measured rather than asserted: an id in running prose is taken.
      expect(documentsNamedIn(asChat(`By ${REAL}, the branch is main.`), [REAL])).toMatch(CONTROL)
    })

    it('⛔ an HTML entity is walked AROUND, measured where that can actually fire', () => {
      // 🔴 **`439`'s own assertion for this cannot fail today, and this is the repair rather than
      // a second copy of it.** ⚠️ That test uses the roster `['amp', 'amp-desk']` on running
      // prose — and `NAME_SHAPED`, added by the same review, keeps a bare word like `amp` OUT of
      // the prose pattern entirely, so the entity walk is not what makes it pass. ⛔ Measured:
      // deleting the entity walk leaves `439` green.
      //
      // ⚑ **Inside an inline `<code>` every roster member matches**, which is where the guard is
      // live: markdown-it escapes a reply's `&` into `&amp;` there too. ⚑ **D-016** — measured
      // through the document vocabulary now, the walk's one caller since `places.ts` went: its id
      // boundary does not hold `&` or `;`, so without the entity walk `amp` would be marked.
      expect(documentsNamedIn('<p>Use <code>A &amp; B</code> today</p>', ['amp'])).toBe(
        '<p>Use <code>A &amp; B</code> today</p>',
      )
      // ⚑ **Non-vacuity**: the same roster member IS matched in the same code span where it is
      // not inside an entity, so the answer above is about the entity and not about a walk that
      // never reaches a `<code>`.
      expect(documentsNamedIn('<p>Use <code>amp today</code></p>', ['amp'])).toContain(
        'data-document="amp"',
      )
    })

    it('⛔ the boundary predicate may not be global, because `test` would advance it', () => {
      // ⚠️ A global `RegExp` moves `lastIndex` on every `test`, so the second hit in one text run
      // would be let through. ⚑ Every vocabulary is read, because the rule is the walk's and the
      // predicate is theirs.
      for (const path of VOCABULARIES)
        expect(CODE(path), path).not.toMatch(/boundary: \/.*\/[a-z]*g/)
      // ⚑ Non-vacuity: the two MATCH patterns do carry it, and they are in the same files.
      expect(CODE('../src/renderer/src/lib/the-documents-a-reply-names.ts')).toContain(
        ".join('|'), 'g')",
      )
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the wiring — 537's question, asked of every surface that opens a document
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · what each surface that opens a document derives its target from', () => {
    /**
     * 🔴 **`537` §3.2's shape.** ⛔ The question is not *does anything contain `res_`* — that string
     * is a legitimate fact in a dozen places. ⚑ The question is **what does each surface that opens
     * a document derive its target from**, and there are exactly two kinds. ⚑ **D-016** — the third,
     * *a row off the table* (the project band's `ProjectDocumentRow`), went with the project room.
     */
    type Kind = 'a-typed-field' | 'a-roster-of-typed-fields'
    const FROM: Readonly<Record<Kind, string>> = {
      // ⛔ The work report's own press — `WorkReport.resources`, through `theResourcesAReportNames`.
      'a-typed-field': "from '../lib/the-document-a-report-names'",
      // 🔴 **562's control** — the same predicate, folded over the window's rows into a roster and
      // handed down as a prop, which is `places.ts`' shape.
      'a-roster-of-typed-fields': "from '../lib/the-documents-a-reply-names'",
    }
    const KINDS: Readonly<Record<string, Kind>> = {
      'WorkReportEntry.vue': 'a-typed-field',
      // ⚠️ The view BUILDS the roster; the message DRAWS from it. Both are listed, because a
      // binding is a forward and says nothing about the computed behind it — `537` §3.2's reason
      // for asking in two directions.
      'TranscriptView.vue': 'a-typed-field',
      'AssistantMessage.vue': 'a-roster-of-typed-fields',
    }

    it('🔴 three surfaces, and not one of them reads an id out of prose', () => {
      expect(Object.keys(KINDS)).toHaveLength(3)
      for (const [file, kind] of Object.entries(KINDS)) {
        const source = CODE(`../src/renderer/src/components/${file}`)
        expect(source, `${file} · ${kind}`).toContain(FROM[kind])
        // ⛔ **Nobody parses.** A renderer that split an id would be a second reading of
        // `newResourceId`, free to disagree with it the day the id gains a character.
        expect(source, file).not.toContain(".split('_')")
        // ⛔ **And nobody matches the SHAPE of an id** — `548` §Q4's refusal, asked of the code
        // rather than of the prose that quotes it.
        expect(source, file).not.toContain("'res_'")
        expect(source, file).not.toMatch(/\/\\bres_/)
      }
      // ⚑ **Non-vacuity, in both directions**: every kind in the table is actually used, and the
      // two needles really are different strings.
      expect(new Set(Object.values(KINDS)).size).toBe(2)
      expect(new Set(Object.values(FROM)).size).toBe(2)
    })

    it('⛔ the new control reaches the door through the hops 510 already built', () => {
      // ⚑ **No fourth "how".** `562` adds a second place a press is DRAWN and no new route: the
      // event, the pane's handler, the panel and the five refusals are `510`'s.
      expect(CODE('../src/renderer/src/components/AssistantMessage.vue')).toContain(
        "emit('openDocument', resourceId)",
      )
      expect(CODE('../src/renderer/src/components/TranscriptView.vue')).toContain(
        '@open-document="(resourceId) => $emit(\'openDocument\', resourceId)"',
      )
      expect(CODE('../src/renderer/src/components/ConversationPane.vue')).toContain(
        'async function openResource(resourceId: string): Promise<void> {',
      )
      expect(CODE('../src/renderer/src/components/RuntimeScreen.vue')).toContain(
        ':on-read-resource="readResourceForAnySurface"',
      )
    })

    it('⚠️ the roster is built from the WINDOW’s items and not from the mode’s list', () => {
      // ⛔ A roster built from `shown` would make a control appear and disappear as a person flips
      // the transcript mode — a fact about a document answered by a display setting.
      const view = CODE('../src/renderer/src/components/TranscriptView.vue')
      expect(view).toContain('everyResourceAReportNames(props.items, props.canOpenDocument)')
      expect(view).not.toContain('everyResourceAReportNames(shown')
    })

    it('🔴 the two presses say different words, and each sentence is true of its own row', () => {
      // ⛔ `169` cuts both ways. ⚑ `OPEN_THE_DOCUMENT` says the file is *"kept with this reply"* and
      // is true only on the reply's own row; an id in a sentence sits in somebody else's words,
      // which is the argument `READ_THE_DOCUMENT` was written under.
      expect(OPEN_THE_DOCUMENT).toBe('Open the file kept with this reply')
      expect(READ_THE_DOCUMENT_NAMED).toBe('Open this file')
      expect(READ_THE_DOCUMENT_NAMED).not.toBe(OPEN_THE_DOCUMENT)
      // ⚑ **D-016** — `READ_THE_DOCUMENT` was shared with the project band (`project-documents.ts`);
      // the band went, and its one remaining reader spells the sentence itself.
    })
  })
})
