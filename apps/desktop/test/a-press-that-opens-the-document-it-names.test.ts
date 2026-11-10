import type { TranscriptEvent } from '../src/shared/conversation-events'
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

const REAL = 'res_4c2f0e1a111142228333444455556666'
const WISHED_FOR = 'res_99999999111142228333444455556666'

const asChat = (markdown: string): string => `<p>${markdown}</p>\n`

const CONTROL = /data-cy="open-the-document"/

describe('a press that opens the document it names', () => {
  describe('a real id, one that names nothing, and a code span that is not an id', () => {
    it('an id this app kept becomes a control that carries it back unchanged', () => {
      const out = documentsNamedIn(asChat(`The answer is in ${REAL}.`), [REAL])
      expect(out).toContain(`data-document="${REAL}"`)
      expect(out).toContain(`>${REAL}</button>`)
      expect(out).toContain(`title="${READ_THE_DOCUMENT_NAMED}"`)
    })

    it('a WELL-FORMED id this app never kept stays exactly the text it was', () => {
      const html = asChat(`I have put it in ${WISHED_FOR} for you.`)
      expect(documentsNamedIn(html, [REAL])).toBe(html)
      expect(documentsNamedIn(html, [REAL, WISHED_FOR])).toMatch(CONTROL)
    })

    it('a code span that is not an id at all is returned byte for byte', () => {
      const html = '<p>Run <code>pnpm run ci</code> and read <code>README.md</code>.</p>\n'
      expect(documentsNamedIn(html, [REAL])).toBe(html)
      const quoted = documentsNamedIn(`<p>see <code>${REAL}</code></p>`, [REAL])
      expect(quoted).toMatch(CONTROL)
      expect(quoted).toContain(`<code><button`)
    })

    it('an empty roster returns the html untouched, which is every surface with no reader', () => {
      const html = asChat(`The answer is in ${REAL}.`)
      expect(documentsNamedIn(html, [])).toBe(html)
      expect(documentsNamedIn(html, [''])).toBe(html)
    })
  })

  describe('the roster is the app’s own typed field, and it is ONE derivation', () => {
    const piece = { piece: 'work_9', label: 'W1.4', title: 'the notes', owner: 'sess_child' }
    const holder = 'Ada'
    const reported = (resource: string | null): TranscriptEvent =>
      ({
        type: 'user_turn',
        text: replyText(
          piece,
          holder,
          { outcome: 'done', summary: 'Done.', needsUserAction: false },
          resource === null ? [] : [{ resource, name: 'notes.md' }],
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

    it('the id a real reply kept reaches the roster through the real fold', () => {
      const items = fold(reported(REAL))
      expect(items.some((item) => item.kind === 'workReport')).toBe(true)
      expect(everyResourceAReportNames(items, true)).toEqual([REAL])
    })

    it('a surface with no reader behind it has an EMPTY roster, not a control that cannot act', () => {
      const items = fold(reported(REAL))
      expect(everyResourceAReportNames(items, false)).toEqual([])
      expect(everyResourceAReportNames(items, true)).toEqual([REAL])
    })

    it('a reply that kept nothing contributes nothing, and that is the commonest row', () => {
      const items = fold(reported(null))
      expect(everyResourceAReportNames(items, true)).toEqual([])
      expect(items.filter((item) => item.kind === 'workReport')).toHaveLength(1)
    })

    it('it is the SAME predicate the work report’s own press reads — one decision about when', () => {
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

    it('the same resource named by two reports is in the roster once', () => {
      const items = fold(reported(REAL), reported(REAL))
      expect(items.filter((item) => item.kind === 'workReport')).toHaveLength(2)
      expect(everyResourceAReportNames(items, true)).toEqual([REAL])
    })

    it('and the app’s own sentence is what the roster is matched against', () => {
      const said = replyText(
        piece,
        holder,
        { outcome: 'done', summary: 'Done.', needsUserAction: false },
        [{ resource: REAL, name: 'notes.md' }],
        false,
      )
      expect(said).toContain(`Its resources: ${REAL} (notes.md). Read one with read_document.`)
      expect(said).not.toContain('`')
      expect(documentsNamedIn(asChat(said), [REAL])).toMatch(CONTROL)
    })
  })

  describe('the walk, where it must not reach', () => {
    it('the FULL STOP a sentence puts after the id is not part of it', () => {
      const out = documentsNamedIn(asChat(`…it is kept as ${REAL}. Read it with read_document.`), [
        REAL,
      ])
      expect(out).toMatch(CONTROL)
      expect(out).toContain(`</button>. Read it`)
    })

    it('a HYPHEN is part of it, so a shorter id does not eat a longer one', () => {
      const longer = `${REAL}-2`
      const out = documentsNamedIn(asChat(`see ${longer} today`), [REAL])
      expect(out).not.toMatch(CONTROL)
      expect(documentsNamedIn(asChat(`see ${REAL} today`), [REAL])).toMatch(CONTROL)
    })

    it('the longer id wins where both could start', () => {
      const longer = `${REAL}-two`
      const out = documentsNamedIn(asChat(`see ${longer}`), [REAL, longer])
      expect(out).toContain(`data-document="${longer}"`)
      expect(out).not.toContain(`data-document="${REAL}"`)
    })

    it('nothing inside a fence, inside a link, or inside a tag is rewritten', () => {
      const fenced = `<pre><code>read ${REAL}</code></pre>`
      expect(documentsNamedIn(fenced, [REAL])).toBe(fenced)
      const linked = `<a href="https://x/${REAL}" title="${REAL}">link</a>`
      expect(documentsNamedIn(linked, [REAL])).toBe(linked)
      const both = documentsNamedIn(`${fenced}<p>${REAL}</p>`, [REAL])
      expect(both.match(/data-document/g)).toHaveLength(1)
      expect(both.indexOf('data-document')).toBeGreaterThan(both.indexOf('</pre>'))
    })

    it('an id is matched LITERALLY, so a dot in a roster member is not a wildcard', () => {
      const dotted = 'res_a.b'
      expect(documentsNamedIn(asChat(`see res_axb`), [dotted])).toBe(asChat('see res_axb'))
      expect(documentsNamedIn(asChat(`see ${dotted}`), [dotted])).toContain(
        `data-document="${dotted}"`,
      )
    })

    it('one pattern serves a code span and the prose after it, and both are marked', () => {
      const out = documentsNamedIn(
        `<p>The long first paragraph mentions <code>${REAL}</code> well past its start.</p><p>${REAL}</p>`,
        [REAL],
      )
      expect(out.match(/data-document/g)).toHaveLength(2)
    })

    it('an HTML entity is walked around, and the id is escaped on the way out', () => {
      const hostile = 'res_a"b'
      const out = documentsNamedIn(`<p>see ${hostile}</p>`, [hostile])
      expect(out).toContain('data-document="res_a&quot;b"')
      expect(out).toContain('>res_a&quot;b</button>')
      expect(out).not.toContain('data-document="res_a"b')
    })
  })

  describe('the mechanism is shared, so a vocabulary cannot drift from it', () => {
    it('a resource id is one pattern in both contexts', () => {
      expect(documentsNamedIn(asChat(`By ${REAL}, the branch is main.`), [REAL])).toMatch(CONTROL)
    })

    it('an HTML entity is walked AROUND, measured where that can actually fire', () => {
      expect(documentsNamedIn('<p>Use <code>A &amp; B</code> today</p>', ['amp'])).toBe(
        '<p>Use <code>A &amp; B</code> today</p>',
      )
      expect(documentsNamedIn('<p>Use <code>amp today</code></p>', ['amp'])).toContain(
        'data-document="amp"',
      )
    })
  })

  describe('what each surface that opens a document derives its target from', () => {
    it('the two presses say different words, and each sentence is true of its own row', () => {
      expect(OPEN_THE_DOCUMENT).toBe('Open the file kept with this reply')
      expect(READ_THE_DOCUMENT_NAMED).toBe('Open this file')
      expect(READ_THE_DOCUMENT_NAMED).not.toBe(OPEN_THE_DOCUMENT)
    })
  })
})
