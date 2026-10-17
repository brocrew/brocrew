import { readFileSync } from 'node:fs'
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

  it('spends NO amber anywhere, and the tokens it does spend are already declared', () => {
    /**
     * ⚠️ **Read from the component's SOURCE, not from its rendered markup — and the first version
     * of this test read the markup.** Scoped styles are compiled to a separate stylesheet, so
     * `renderToString` output contains no `<style>` block at all: `expect(html).not.toContain(
     * '--waiting')` passed over a string that could never have contained it, on a component with no
     * CSS whatsoever. A negative with nothing behind it is the failure mode this whole hunt is for.
     *
     * 080's line is the claim: `--waiting` IS the attention channel, so a workflow that is merely
     * BUSY may not spend it. The one amber this feature is allowed rides on `AgentState`'s needing
     * badge, which is a different component and reached only through a real permission.
     */
    const source = readFileSync(
      new URL('../src/renderer/src/components/WorkflowEntry.vue', import.meta.url),
      'utf8',
    )
    const styles = source.slice(source.indexOf('<style'))
    // Non-vacuity: the slice has to be the real stylesheet, not an empty tail.
    expect(styles.length, 'the style block was not found').toBeGreaterThan(500)
    const used = [...styles.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!)
    expect(used.length, 'no tokens found — the scan is reading the wrong text').toBeGreaterThan(15)

    expect(used).not.toContain('--waiting')
    expect(used).not.toContain('--warning') // 105 proved this is declared nowhere
    expect(used).not.toContain('--wash-4') // no light value; a consumer vanishes on paper
    expect(used).not.toContain('--ended') // does not exist
    // …and the paired positive: the surface is not simply colourless. All four state registers 107
    // assigned are actually spent here. The second accent's words are drawn in its text form.
    for (const token of ['--accent', '--accent-2-text', '--success', '--danger', '--faint']) {
      expect(used, `${token} is the register 107 assigned and nothing uses it`).toContain(token)
    }
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
