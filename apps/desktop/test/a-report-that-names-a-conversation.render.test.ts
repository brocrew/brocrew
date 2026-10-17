import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SessionPanel from '../src/renderer/src/components/SessionPanel.vue'
import WorkReportEntry from '../src/renderer/src/components/WorkReportEntry.vue'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import type { WorkReport } from '../src/shared/tasks'

/**
 * 🔴 **The work report's row, rendered — the press and its two absences** (506).
 *
 * A `.render.test.ts` because it imports SFCs: those are checked by `vue-tsc` under the web
 * project rather than by the node one.
 *
 * ⛔ **Every negative below is paired with a positive from the SAME render**, which is
 * `schedule-bar.render.test.ts`'s rule and this repo's most-repeated finding: `not.toContain`
 * also passes against a component that rendered nothing at all.
 *
 * 🔴 **And every assertion runs over markup with the template comments STRIPPED.** SSR emits them
 * verbatim, and this component's comments quote the very words the negatives name — *"Take it
 * over"* is not in them, but *"No control, no count, no live region"* is, and a future comment
 * could be. Three assertions in `background-bar.render.test.ts` were found passing over exactly
 * this.
 */

const NOW = 1_700_000_000_000

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
  over: { report?: WorkReport; text?: string; held?: readonly string[] } = {},
): Promise<string> {
  const item = {
    kind: 'workReport' as const,
    id: 'work-1',
    text: over.text ?? 'W1.5 (work_1) was answered by sess_child: done.',
    report: over.report ?? report(),
    at: NOW,
  }
  // ⛔ **The prop is OMITTED rather than passed as `undefined`**, because that is the difference
  // this file exists to measure: `ReadingPane` does not bind it at all, and a `Record<string,
  // unknown>` spread would also have hidden the shape from `vue-tsc`.
  const html = await renderToString(
    createSSRApp({
      render: () =>
        h(
          WorkReportEntry,
          // ⚑ **658 · the recipient is required** — `ownAgent` since 667, which every `TranscriptView` mount passes.
          over.held === undefined
            ? { item, ownAgent: 'BroBot' }
            : { item, ownAgent: 'BroBot', held: new Set(over.held) },
        ),
    }),
  )
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

describe('506 · the row takes a person to the conversation it names', () => {
  it('🔴 a conversation this window holds · *Open the conversation*, and no adoption is claimed', async () => {
    const html = await row({ held: ['sess_child'] })
    expect(html).toContain('data-cy="work-report-where"')
    expect(html).toContain('Open the conversation')
    expect(html).toContain('data-held="true"')
    // ⛔ **The paired negative**: the other arm's words are the ones that disclose an adoption,
    // and claiming a conversation this window already holds is the one refusal that arm excludes.
    expect(html).not.toContain('Take it over and open it')
  })

  // ⚑ **D-017b · one press everywhere** — *Open the conversation*, whoever holds it or whether anything
  // runs it: the press opens it in its one full view, and a press there takes it for this window.
  it('🔴 a conversation it does not hold · the same one press, *Open the conversation*', async () => {
    const html = await row({ held: [] })
    expect(html).toContain('data-cy="work-report-where"')
    expect(html).toContain('>Open the conversation<')
    expect(html).toContain('data-held="false"')
    // ⛔ The press it used to be, which named a take-over this window no longer asks a person for.
    expect(html).not.toContain('Take it over')
    // ⚑ The pairing: the held arm draws the very same press — only `data-held` tells them apart.
    const heldHtml = await row({ held: ['sess_child'] })
    expect(heldHtml).toContain('>Open the conversation<')
    expect(heldHtml).toContain('data-held="true"')
  })

  it('⛔ a surface that cannot say what the window holds draws no press at all', async () => {
    const html = await row()
    // ⚠️ **`ReadingPane` and `ChildWorkViewer` render this entry over a recording** — `106`: a
    // control that cannot act is absent rather than greyed.
    expect(html).not.toContain('data-cy="work-report-where"')
    // ⛔ **The positive that makes that negative a measurement**: the row itself rendered, in full.
    expect(html).toContain('data-cy="work-report"')
    expect(html).toContain('W1.5')
    expect(html).toContain('data-cy="work-facts"')
  })

  it('⛔ a report written before 506 draws no press, and still draws everything else', async () => {
    const old = report()
    delete (old as { owner?: string }).owner
    const html = await row({ report: old, held: [] })
    expect(html).not.toContain('data-cy="work-report-where"')
    expect(html).toContain('data-cy="work-report-heading"')
    expect(html).toContain('data-cy="work-report-outcome"')
  })

  it('🔴 the press is in the META row and NOT on the facts line', async () => {
    // ⛔ **`WorkFacts` carries *"No control, no count, no live region"* as its own ruling**, and it
    // is shared with the queued twin. ⚠️ Measured by position rather than asserted in prose: the
    // facts line opens after the meta row closes, so a control inside it would appear after
    // `work-facts` in the markup.
    const html = await row({ held: [] })
    const press = html.indexOf('data-cy="work-report-where"')
    const facts = html.indexOf('data-cy="work-facts"')
    expect(press).toBeGreaterThan(-1)
    expect(facts).toBeGreaterThan(-1)
    expect(press).toBeLessThan(facts)
    // ⚑ And the facts line still holds no `<button>` of any kind.
    const line = html.slice(facts, html.indexOf('data-cy="work-report-message"'))
    expect(line).not.toContain('<button')
  })

  it('⚠️ the row still says nothing about the conversation’s STATE, because it cannot know one', async () => {
    // ⛔ **A transcript row has no per-session read of `RunningState`.** *Not held* is a residue of
    // three states — another window has it, nobody has it, nothing is running it — and a word for
    // any one of them would be `484`'s defect: a field that says the wrong quiet thing.
    const html = await row({ held: [] })
    for (const invented of [
      'nobody is watching it',
      'open in another window',
      'this app is not running it',
      'idle',
    ]) {
      expect(html).not.toContain(invented)
    }
    // ⚑ The positive from the same render: the press is there, and says only the gesture.
    expect(html).toContain('>Open the conversation<')
  })

  it('⛔ the panel band says *Sub-agents*, and its handle is unchanged', async () => {
    // Use a panel with a running sub-agent so the band itself is drawn and read; the
    // empty-section sentence is absent.
    const state = createTranscript()
    for (const event of [
      { type: 'user_turn', text: 'do the thing' },
      { type: 'tool_call', id: 'call_1', name: 'Task', summary: 'explore the tree' },
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'started',
        parentToolCallId: 'call_1',
        title: 'explore',
      },
    ] as TranscriptEvent[])
      applyEvent(state, event)
    const html = await renderToString(
      createSSRApp({ render: () => h(SessionPanel, { state, mode: 'normal' }) }),
    )
    const band = html.slice(html.indexOf('data-cy="panel-agents"'))
    expect(band.slice(0, band.indexOf('</section>'))).toMatch(/>Sub-agents</)
    // ⛔ The word this negative is about is unchanged.
    expect(html).not.toContain('Running agents')
  })
})
