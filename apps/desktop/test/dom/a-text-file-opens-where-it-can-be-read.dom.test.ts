import { afterEach, describe, expect, it } from 'vitest'
import ChildWorkViewer from '../../src/renderer/src/components/ChildWorkViewer.vue'
import WorkflowOutputViewer from '../../src/renderer/src/components/WorkflowOutputViewer.vue'
import type { ChildWorkResult, WorkflowOutputResult } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 🔴 **731 · a text file opens on the pane it can be read in, and a refusal says what is true.**
 *
 * ⛔ Until `731` a workflow's output had to carry one of eight text extensions, so only prose and
 * four data formats ever arrived, and `startRaw` named the four. The PM ruled the list away (`726`
 * §9: *"a text viewer opens any readable text file a person names"*), and the review found what the
 * list had been doing by accident: a `.sh` now arrived on the Markdown pane, its `# comment` a
 * heading. ⚑ So the pane is asked of PROSE (`shared/documents.ts` `textViewFor`), and a page is source only, as the
 * documents viewer has it (`HO-097` §1.3).
 */

afterEach(unmountAll)

const read = (name: string, text = '# not a heading\necho hi\n'): WorkflowOutputResult => ({
  ok: true,
  name,
  text,
  truncated: false,
  bytes: text.length,
})

const open = (result: WorkflowOutputResult) =>
  mount(WorkflowOutputViewer, { result, workflow: 'find-flaky-tests' }, { width: 900, height: 700 })

describe('731 · the pane a text file opens on', () => {
  it('🔴 a script opens on Raw — the Markdown pane would make its comment a heading', () => {
    // ⛔ On `main` `run.sh` opened on the Markdown pane (only `.jsonl|.json|.log|.csv` were Raw).
    const m = open(read('run.sh'))
    expect(m.q('document-body').dataset.view).toBe('raw')
    expect(m.all('doc-view-markdown'), 'the toggle is still there').toHaveLength(1)
  })

  it('🔴 a page is its source only — no Markdown pane at all', () => {
    // ⛔ On `main` `report.html` opened on the Markdown pane, with the toggle.
    const m = open(read('report.html', '<h1>x</h1>'))
    expect(m.q('document-body').dataset.view).toBe('raw')
    expect(m.all('doc-view-markdown')).toHaveLength(0)
  })

  it('⚑ THE CONTROL — the old list opens exactly as it did: prose on Markdown, data on Raw', () => {
    // Asked through the viewer, so the same file measures `main` and this tree alike.
    const pane = (name: string): string | undefined => {
      const m = open(read(name))
      const view = m.q('document-body').dataset.view
      expect(m.all('doc-view-markdown'), name).toHaveLength(1)
      m.unmount()
      return view
    }
    for (const name of ['wq1demo.output', 'notes.md', 'notes.markdown', 'notes.txt']) {
      expect(pane(name), name).toBe('markdown')
    }
    for (const name of ['journal.jsonl', 'data.json', 'run.log', 'table.csv']) {
      expect(pane(name), name).toBe('raw')
    }
  })
})

describe('731 · what a refusal says', () => {
  it('🔴 a file that cannot be drawn as text is said to be exactly that — never a policy', () => {
    // ⛔ On `main`: *"That path is not something this app will open."*
    const m = open({ ok: false, reason: 'not-readable' } as WorkflowOutputResult)
    const said = m.q('workflow-output-refusal').textContent ?? ''
    expect(said).toContain('That file cannot be shown as text here.')
    expect(said).not.toMatch(/will not open|not something this app will open/)
  })

  it('🔴 …and a child’s file says the same — a Codex rollout is no longer refused for its name', () => {
    // ⛔ On `main`: *"That path is not something this app will open."*
    const m = mount(
      ChildWorkViewer,
      { result: { ok: false, reason: 'not-readable' } as ChildWorkResult, label: 'fixture:child' },
      { width: 900, height: 700 },
    )
    const said = m.q('child-work-refusal').textContent ?? ''
    expect(said).toContain('That file cannot be shown as text here.')
    expect(said).not.toMatch(/will not open|not something this app will open/)
  })
})
