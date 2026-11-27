import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ToolEntry from '../src/renderer/src/components/ToolEntry.vue'

async function tool(props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(ToolEntry, props))
}

describe('the tool card', () => {
  const CALL = {
    kind: 'tool' as const,
    id: 'tool-1',
    callId: 'toolu_1',
    name: 'Bash',
    summary: 'node -e "setTimeout(…, 30000)"',
    at: 1_000,
  }

  it('a detached call does NOT read as finished — the dot is not green and the row says why', async () => {
    const html = await tool({
      item: {
        ...CALL,
        result: {
          summary: 'Command running in background with ID: b6uoyo82k',
          ok: true,
          at: 6_102,
        },
        background: { id: 'b6uoyo82k' },
      },
    })
    expect(html).toContain('data-status="background"')
    expect(html).toContain('data-cy="tool-background"')
    expect(html).toContain('still running')
    expect(html).toContain('data-background-id="b6uoyo82k"')
    expect(html).not.toContain('data-status="done"')
    expect(html).not.toContain('data-cy="tool-took"')
  })

  it('…and it becomes the completion record, with the WORK’s duration', async () => {
    const html = await tool({
      item: {
        ...CALL,
        result: {
          summary: 'Command running in background with ID: b6uoyo82k',
          ok: true,
          at: 6_102,
        },
        background: {
          id: 'b6uoyo82k',
          outcome: 'completed',
          endedAt: 36_150,
          summary: 'Background command "the 30-second timer" completed (exit code 0)',
        },
      },
    })
    expect(html).toContain('data-status="completed"')
    expect(html).toContain('>finished</span>')
    expect(html).toContain('data-cy="tool-background-summary"')
    expect(html).toContain('completed (exit code 0)')
    expect(html).toContain('Command running in background with ID')
    expect(html).toContain('>35.1 s<')
    expect(html).not.toContain('>5.1 s<')
  })

  it('an ordinary call is untouched — the row still reads exactly as it did', async () => {
    const html = await tool({
      item: { ...CALL, result: { summary: 'ok', ok: true, at: 1_400 } },
    })
    expect(html).toContain('data-status="done"')
    expect(html).toContain('400 ms')
    expect(html).not.toContain('data-cy="tool-background"')
    expect(html).not.toContain('data-background-id="')
  })

  it('stopped and unreported are their own words, and neither is a failure', async () => {
    const stopped = await tool({
      item: {
        ...CALL,
        result: { summary: 'x', ok: true, at: 2 },
        background: { outcome: 'stopped' },
      },
    })
    expect(stopped).toContain('data-status="stopped"')
    // The ending's word is said once on the row, not again as the outcome beside it.
    expect(stopped.split('>stopped</span>')).toHaveLength(2)
    const unknown = await tool({
      item: {
        ...CALL,
        result: { summary: 'x', ok: true, at: 2 },
        background: { outcome: 'unknown' },
      },
    })
    expect(unknown).toContain('data-status="unknown"')
    expect(unknown.split('>ended, outcome not reported</span>')).toHaveLength(2)
    expect(unknown).not.toContain('data-status="error"')
  })
})
