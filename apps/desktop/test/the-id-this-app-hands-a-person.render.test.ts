import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import CanonicalDocumentViewer from '../src/renderer/src/components/CanonicalDocumentViewer.vue'
import TranscriptView from '../src/renderer/src/components/TranscriptView.vue'
import WorkReportEntry from '../src/renderer/src/components/WorkReportEntry.vue'
import { OPEN_THE_DOCUMENT } from '../src/renderer/src/lib/the-document-a-report-names'
import type { ResourceReading } from '../src/shared/runtime-ipc'
import type { WorkReport } from '../src/shared/tasks'

/**
 * 🔴 **510 · the press that opens the document, and the panel behind it** — rendered.
 *
 * A `.render.test.ts` because it imports SFCs: those are checked by `vue-tsc` under the web
 * project rather than by the node one.
 *
 * ⛔ **Every negative below is paired with a positive from the SAME render.** `not.toContain`
 * also passes against a component that rendered nothing at all, and this repo has found that
 * three times in one file.
 *
 * ⚠️ **Every assertion runs over markup with the template comments STRIPPED.** SSR emits them
 * verbatim, and this component's comments quote the words the negatives name — *"Read one with
 * `read_document`"* appears in `the-document-a-report-names.ts`'s own docblock, and a comment
 * that quoted it here would make the plant in §2 pass for the wrong reason.
 */

const NOW = 1_700_000_000_000
/** ⚑ A resource id as `keepResource` mints one — `res_<32 hex>` (D-016). */
const DOCUMENT = 'res_4c2f0e1a111142228333444455556666'

const report = (over: Partial<WorkReport> = {}): WorkReport => ({
  piece: 'work_1',
  label: 'W1.5',
  owner: 'sess_child',
  state: 'answered',
  outcome: 'done',
  // A report starts closed unless a person has to act on it, and a server render cannot open one,
  // so the row is drawn in the state that shows its body. The mark adds a pill to the facts line
  // and changes nothing this file measures.
  needsUserAction: true,
  ...over,
})

async function row(
  over: { report?: WorkReport; text?: string; canOpenDocument?: boolean } = {},
): Promise<string> {
  const item = {
    kind: 'workReport' as const,
    id: 'work-1',
    text:
      over.text ??
      `W1.5 · the answer was answered by sess_child: done.\n\nIts resources: ${DOCUMENT} (response.md). Read one with read_document.`,
    report: over.report ?? report({ resources: [DOCUMENT] }),
    at: NOW,
  }
  // ⛔ **The prop is OMITTED rather than passed as `undefined`** where the surface has no reader,
  // because that is the difference this file measures — and a `Record<string, unknown>` spread
  // would also have hidden the shape from `vue-tsc`, which is how `506` went red at the gate.
  const html = await renderToString(
    createSSRApp({
      render: () =>
        h(
          WorkReportEntry,
          // ⚑ **658 · the recipient is required** — `ownAgent` since 667, which every `TranscriptView` mount passes.
          over.canOpenDocument === undefined
            ? { item, ownAgent: 'BroBot' }
            : { item, ownAgent: 'BroBot', canOpenDocument: over.canOpenDocument },
        ),
    }),
  )
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

const panel = async (result: ResourceReading): Promise<string> => {
  const html = await renderToString(
    createSSRApp({ render: () => h(CanonicalDocumentViewer, { result }) }),
  )
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

describe('510 · the row opens the document it names', () => {
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the press, and its three absences
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 a report that names a document, on a surface that can read one · the press is drawn', async () => {
    const html = await row({ canOpenDocument: true })
    expect(html).toContain('data-cy="work-report-document"')
    expect(html).toContain(`data-document="${DOCUMENT}"`)
    expect(html).toContain(OPEN_THE_DOCUMENT)
  })

  it('⛔ a report with NO document draws no press — and the row is still there', async () => {
    const html = await row({ canOpenDocument: true, report: report() })
    expect(html).not.toContain('data-cy="work-report-document"')
    expect(html).not.toContain(OPEN_THE_DOCUMENT)
    // ⚑ **The paired positive from the same render**: the row rendered, so the negative above is
    // about the control rather than about the component.
    expect(html).toContain('data-cy="work-report-heading"')
  })

  it('⛔ a surface with no reader draws no press, even where the report names one', async () => {
    // ⚠️ **The prop omitted entirely** — `ChildWorkViewer`'s mount, and `106`'s rule: a control
    // that reaches nothing when pressed is worse than no control at all.
    const html = await row()
    expect(html).not.toContain('data-cy="work-report-document"')
    expect(html).toContain('data-cy="work-report-heading"')
  })

  it('⚠️ the id is in the BODY either way, which is why the field had to exist', async () => {
    // ⛔ **The defect, still visible on the row.** `replyText`'s sentence is correct and stays;
    // what `510` added is somewhere to press. A test that only asserted the press would not have
    // recorded that the id was already on screen and unopenable.
    const html = await row()
    expect(html).toContain(DOCUMENT)
    expect(html).toContain('Read one with read_document')
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · where it is drawn — the meta row, never the facts line and never the body
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it('⛔ the press is in the META row, and the facts line holds no control', async () => {
    const html = await row({ canOpenDocument: true })
    const meta = html.slice(html.indexOf('msg-meta'), html.indexOf('msg-body'))
    expect(meta).toContain('data-cy="work-report-document"')
    // 🔴 **`WorkFacts` carries *"No control, no count, no live region"* as its own ruling** and is
    // shared with the queued twin — a row that only appears once the parent's turn ends. A press
    // there would be invisible in the window a person is watching.
    const facts = html.slice(html.indexOf('data-cy="work-facts"'), html.indexOf('msg-body'))
    expect(facts.includes('<button')).toBe(false)
  })

  it('⚑ both presses share the meta row, and the document one comes after the conversation one', async () => {
    // ⚠️ **Order matters and is asserted with BOTH landmarks present**, because `506 M13` survived
    // its first verification on an `indexOf` that returned `-1` for a string the mutation deleted.
    const html = await row({ canOpenDocument: true })
    const where = html.indexOf('data-cy="work-report-where"')
    const document = html.indexOf('data-cy="work-report-document"')
    const clock = html.indexOf('class="time"')
    // ⛔ `held` is not bound here, so the conversation press is absent — which is what makes the
    // `-1` guard below a real check rather than a formality.
    expect(where).toBe(-1)
    expect(document).toBeGreaterThan(-1)
    expect(clock).toBeGreaterThan(-1)
    expect(document).toBeLessThan(clock)
  })

  it('🔴 `TranscriptView`’s DEFAULT is no reader, and that default is the ruling', async () => {
    // ⛔ **The press is mounted through the view here, not directly** — because the thing being
    // measured is `canOpenDocument`'s default, and a test that hands `WorkReportEntry` the prop
    // itself cannot see it. ⚑ `510 M13` SURVIVED its first verification for exactly that reason:
    // it flips `TranscriptView`'s default to `true` and every assertion in this file passed,
    // because nothing in it had ever mounted the view. `canOpenStore`'s own ruling, one prop up,
    // has the same hole and the same remedy.
    const item = {
      kind: 'workReport' as const,
      id: 'work-1',
      text: 'W1.5 · the answer was answered by sess_child: done.',
      report: report({ resources: [DOCUMENT] }),
      at: NOW,
    }
    const through = async (props: Record<string, unknown>): Promise<string> =>
      (
        await renderToString(
          createSSRApp({
            render: () => h(TranscriptView as never, { items: [item], mode: 'normal', ...props }),
          }),
        )
      ).replace(/<!--[\s\S]*?-->/g, '')

    // ⚠️ The prop OMITTED — `ChildWorkViewer`'s mount, and the default it relies on.
    const byDefault = await through({})
    expect(byDefault).not.toContain('data-cy="work-report-document"')
    // ⚑ **563 · the pair is what the ROW says, not that the view mounted.** ⛔ A hook on the
    // positive below proves an element; it does not prove the row a person is looking at drew any
    // words — and this block's whole subject is a press that is missing FROM a row that is there.
    expect(byDefault).toContain('was answered by sess_child: done.')
    // ⚑ The paired positive from the same component: the view can draw it, so the negative above
    // is about the default rather than about the mount.
    expect(await through({ canOpenDocument: true })).toContain('data-cy="work-report-document"')
  })

  it('⛔ the press says what it opens and never what it costs', async () => {
    // 🔴 **`taking-over.ts` exists because opening a CONVERSATION is two acts and a person must be
    // told which.** Reading a document is one act: it claims nothing, ends when the panel closes,
    // and borrowing that disclosure would be describing a cost this gesture does not have.
    const html = await row({ canOpenDocument: true })
    for (const words of [
      'Take it over',
      'take it over',
      'Open the conversation',
      'nobody is watching',
    ])
      expect(html, words).not.toContain(words)
    expect(html).toContain(OPEN_THE_DOCUMENT)
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the panel — the document, and each of the four refusals
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 the document is drawn on the app’s own paper, with Markdown and Raw', async () => {
    const html = await panel({
      ok: true,
      form: 'markdown',
      resourceId: DOCUMENT,
      name: 'response.md',
      text: '# the answer\n\nall of it\n',
      bytes: 24,
    })
    // ⛔ **`DocumentBody` whole** — the document-viewer standard, and the same component every
    // other document in this app is read through.
    expect(html).toContain('data-cy="document-body"')
    expect(html).toContain('data-cy="doc-view-markdown"')
    expect(html).toContain('data-cy="doc-view-raw"')
    // ⚑ **The white island is the component's own** — `data-on-white`, not a second
    // `data-chat-theme` carrier, which `091` asserts there is exactly one of per surface.
    expect(html).toContain('data-on-white')
    expect(html).toContain('response.md')
    expect(html).toContain(DOCUMENT)
    expect(html).not.toContain('data-cy="canonical-document-refusal"')
  })

  it('⛔ each of the four refusals says a different true thing, and none of them says the others', async () => {
    const said = new Map<string, string>()
    for (const reason of ['no-such-resource', 'no-store', 'unreadable', 'changed'] as const) {
      const html = await panel({ ok: false, reason })
      expect(html, reason).toContain('data-cy="canonical-document-refusal"')
      // ⚑ The paired positive: no paper is drawn, so the refusal is instead of the document
      // rather than beside it.
      expect(html, reason).not.toContain('data-cy="document-body"')
      said.set(reason, html.slice(html.indexOf('canonical-document-refusal')))
    }
    // 🔴 **Four distinct sentences** (D-016: a resource has four ways not to open). A vocabulary whose members can render the same words is a
    // vocabulary with fewer members than it claims — `an-enumeration-whose-members-must-differ`.
    expect(new Set(said.values()).size).toBe(4)
    // ⛔ **And `unreadable` must not promise the file is gone.** ⚑ **517 · `documentBytes` now
    // tells absent from present-but-unreadable apart** (HO-043 §1.5) and this door still folds the
    // two, deliberately — both end with a person going to look — so the word must keep covering a
    // file that is sitting there and too large.
    expect(said.get('unreadable')).not.toContain('is gone')
    expect(said.get('unreadable')).toContain('could not read')
  })

  it('⚠️ a reason this panel has never heard of still reads as something true', async () => {
    // ⛔ A `.brobot` bundle is `.passthrough()`d and `toPersistedEvents` casts, so a word from a
    // build this one has never met is bytes rather than a hypothesis — `403`'s fallback rule.
    const html = await panel({
      ok: false,
      reason: 'the-sun-went-out',
    } as unknown as ResourceReading)
    expect(html).toContain('That file could not be opened.')
  })
})
