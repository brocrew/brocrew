import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { decode, shown } from './helpers/rendered-markup'
import BackgroundBar from '../src/renderer/src/components/BackgroundBar.vue'
import ToolEntry from '../src/renderer/src/components/ToolEntry.vue'
import { BACKGROUND_COMMAND_CHARS } from '../src/shared/agent-state'

const RUNNING = [
  { id: 'b6uoyo82k', kind: 'local_bash', description: 'Run the 30-second timer' },
  { id: 'aae1d6bfc8bbb6ad1', kind: 'local_agent', description: 'Run Node.js command and report' },
]

async function bar(props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(BackgroundBar, { conversation: 'sess_1', ...props }))
}

async function tool(props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(ToolEntry, props))
}

function cellText(html: string, cy: string): string {
  const markup = shown(html)
  const found = new RegExp(`data-cy="${cy}"[^>]*>([\\s\\S]*?)</span>`).exec(markup)?.[1] ?? ''
  expect(found, `nothing rendered for data-cy="${cy}"`).not.toBe('')
  return decode(found.replace(/<[^>]+>/g, ''))
}

describe('the registry above the composer', () => {
  it('says what is running, in the ONE vocabulary the card uses', async () => {
    const html = await bar({ registry: { running: RUNNING, dropped: 0 }, canStop: true })
    expect(html).toContain('data-cy="background-bar"')
    expect(html).toContain('still running')
    expect(html).toContain('data-cy="background-count"')
    expect(html).toContain('>2<')
    expect(html).toContain('Run the 30-second timer')
    expect(html).toContain('local_agent')
    expect(html).toContain('data-cy="background-row-aae1d6bfc8bbb6ad1"')
  })

  it('nothing running, nothing on screen — and the bar really can render', async () => {
    const empty = await bar({ registry: { running: [], dropped: 0 }, canStop: true })
    expect(empty).not.toContain('data-cy="background-bar"')
    const one = await bar({ registry: { running: [RUNNING[0]], dropped: 0 }, canStop: true })
    expect(one).toContain('data-cy="background-bar"')
    expect(one).toContain('thing is')
  })

  it('a registry that is UNDERSTATING itself says so', async () => {
    const html = await bar({ registry: { running: RUNNING, dropped: 3 }, canStop: true })
    expect(html).toContain('data-cy="background-dropped"')
    expect(html).toContain('3 more are running that this list cannot name')
    const clean = await bar({ registry: { running: RUNNING, dropped: 0 }, canStop: true })
    expect(clean).not.toContain('data-cy="background-dropped"')
    expect(clean).toContain('data-cy="background-bar"')
  })

  it('no stop where the adapter cannot stop — ABSENT, not greyed', async () => {
    const cannot = await bar({ registry: { running: RUNNING, dropped: 0 }, canStop: false })
    expect(cannot).not.toContain('data-cy="background-stop-b6uoyo82k"')
    expect(cannot).toContain('data-cy="background-row-b6uoyo82k"')
    expect(cellText(cannot, 'background-what-b6uoyo82k')).toBe('Run the 30-second timer')
    const can = await bar({ registry: { running: RUNNING, dropped: 0 }, canStop: true })
    expect(can).toContain('data-cy="background-stop-b6uoyo82k"')
    expect(can).toContain('data-cy="background-stop-aae1d6bfc8bbb6ad1"')
  })
})

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
    expect(stopped).toContain('>stopped</span>')
    const unknown = await tool({
      item: {
        ...CALL,
        result: { summary: 'x', ok: true, at: 2 },
        background: { outcome: 'unknown' },
      },
    })
    expect(unknown).toContain('data-status="unknown"')
    expect(unknown).toContain('>ended, outcome not reported</span>')
    expect(unknown).not.toContain('data-status="error"')
  })
})

describe('the row names what it is running', () => {
  const COMMAND = 'test -f ~/Desktop/person.txt && echo "EXISTS"'

  it('prints the COMMAND, in the card’s own two-part shape', async () => {
    const html = await bar({
      registry: {
        running: [
          {
            id: 'b6uoyo82k',
            kind: 'local_bash',
            toolCallId: 'toolu_1',
            description: 'waiting for person.txt to appear on Desktop',
            command: { name: 'Bash', text: COMMAND },
          },
        ],
        dropped: 0,
      },
      canStop: true,
      onStop: async () => true,
    })
    expect(html).toContain('data-from="command"')
    expect(cellText(html, 'background-what-b6uoyo82k')).toBe(`Bash ${COMMAND}`)
    expect(html).toContain('>Bash</strong>')
    const cell = /data-cy="background-what-[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(shown(html))?.[1]
    expect(cell?.replace(/<[^>]+>/g, '')).toMatch(/^Bash test -f/)
    expect(html).not.toContain('waiting for person.txt to appear on Desktop')
    expect(shown(html)).toMatch(/class="bg-kind"[^>]*>local_bash</)
  })

  it('a row with no command shows the provider’s description, and says which answer that is', async () => {
    const html = await bar({
      registry: {
        running: [{ id: 'b1', kind: 'local_bash', description: 'demo monitor emitting 3 ticks' }],
        dropped: 0,
      },
      canStop: true,
      onStop: async () => true,
    })
    expect(html).toContain('data-from="description"')
    expect(cellText(html, 'background-what-b1')).toBe('demo monitor emitting 3 ticks')
    expect(html).not.toContain('>Bash</strong>')
  })

  it('…and a row with neither is still NAMED, by the id the Stop sends', async () => {
    const html = await bar({
      registry: { running: [{ id: 'b1' }], dropped: 0 },
      canStop: true,
      onStop: async () => true,
    })
    expect(html).toContain('data-from="id"')
    expect(cellText(html, 'background-what-b1')).toBe('b1')
  })

  it('a long command is CUT WITH A COUNT, never with a silent ellipsis', async () => {
    const long = `echo ${'x'.repeat(400)}`
    const html = await bar({
      registry: {
        running: [{ id: 'b1', toolCallId: 'toolu_1', command: { name: 'Bash', text: long } }],
        dropped: 0,
      },
      canStop: true,
      onStop: async () => true,
    })
    expect(html).toContain('data-cy="background-cut-b1"')
    expect(html).toContain(`+${405 - BACKGROUND_COMMAND_CHARS} more characters`)
    expect(html).toContain(`title="${long}"`)
    const short = await bar({
      registry: {
        running: [{ id: 'b1', toolCallId: 'toolu_1', command: { name: 'Bash', text: COMMAND } }],
        dropped: 0,
      },
      canStop: true,
      onStop: async () => true,
    })
    expect(short).not.toContain('data-cy="background-cut-b1"')
    expect(short).toContain('data-cy="background-what-b1"')
  })

  it('a command carrying a newline cannot turn one row into two', async () => {
    const html = await bar({
      registry: {
        running: [
          {
            id: 'b1',
            toolCallId: 'toolu_1',
            command: { name: 'Bash', text: 'echo one\necho two' },
          },
        ],
        dropped: 0,
      },
      canStop: true,
      onStop: async () => true,
    })
    const after = html.slice(html.indexOf('data-cy="background-what-b1"'))
    const markup = shown(after)
    const code = /<code[^>]*>([\s\S]*?)<\/code>/.exec(markup)?.[1] ?? ''
    expect(code).not.toBe('')
    expect(code).toContain('echo one\\necho two')
    expect(code).not.toContain('\n')
  })
})
