import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import WorkflowEntry from '../src/renderer/src/components/WorkflowEntry.vue'

/**
 * 108 · The workflow tree's COLLAPSED face, server-rendered.
 *
 * ⚠️ Split from `workflow-tree.test.ts` because this file imports an SFC, and the desktop project's
 * tsconfig routes `*.render.test.ts` to `vue-tsc` and everything else to plain `tsc`. What the tree
 * looks like once it is OPEN is `dom/workflow-tree.dom.test.ts` — SSR cannot click.
 */

const PHASES = [
  { index: 1, title: 'Draft' },
  { index: 2, title: 'Judge' },
]

const run = {
  taskId: 'wq1demo',
  toolUseId: 'toolu_wf',
  name: 'demo-panel',
  description: 'Three drafters, then a judge',
  phases: PHASES,
  agents: [
    { agentId: 'a1', label: 'drafter:one', phaseIndex: 1, state: 'done' as const },
    { agentId: 'a2', label: 'drafter:two', phaseIndex: 1, state: 'done' as const },
    { agentId: 'a3', label: 'judge', phaseIndex: 2, state: 'running' as const, attempt: 2 },
  ],
  usage: { tokens: 30982, toolCalls: 4, ms: 20985 },
  running: true,
}

async function render(props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(WorkflowEntry, props))
}

describe('the tree as it renders (108)', () => {
  it('is COLLAPSED by default — the head is there, the tree is not', async () => {
    const html = await render({ run })
    expect(html).toContain('data-cy="workflow-head"')
    expect(html).toContain('demo-panel')
    // The paired positive for the negative below: the head really did render.
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('data-cy="workflow-tree"')
  })

  it('the head says which phase, how many agents, and the run total', async () => {
    const html = await render({ run })
    expect(html).toContain('phase 2 of 2')
    expect(html).toContain('1 running')
    expect(html).toContain('2 done')
    expect(html).toContain('31k tokens')
  })

  it('carries no data-chat-theme — the tree renders INSIDE the existing surface', async () => {
    // 091 asserts exactly one carrier per view; a second one here would silently re-scope the
    // theme for everything beneath it.
    const html = await render({ run })
    expect(html).not.toContain('data-chat-theme')
  })

  // ⚠️ **What a finished phase collapses to, and what the running one lists, is asserted in
  // `dom/workflow-tree.dom.test.ts` and deliberately NOT here.** The tree only exists once the head
  // is clicked, and SSR cannot click. A version of this test that rendered the collapsed component
  // and asserted over the head's tally would have been named for the restraint and measured
  // something else entirely.
})
