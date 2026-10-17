import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import BackgroundBar from '../src/renderer/src/components/BackgroundBar.vue'
import ToolEntry from '../src/renderer/src/components/ToolEntry.vue'
import { BACKGROUND_COMMAND_CHARS } from '../src/shared/agent-state'

/**
 * 248 · The registry and the card, server-rendered.
 *
 * ⚠️ **SSR renders the first frame and nothing else** — what happens when Stop is PRESSED is
 * `dom/background-stop.dom.test.ts`, because SSR cannot click. Every negative here is paired with a
 * positive from the same render, so a selector that silently stopped existing fails rather than
 * passing over nothing.
 */

const RUNNING = [
  { id: 'b6uoyo82k', kind: 'local_bash', description: 'Run the 30-second timer' },
  { id: 'aae1d6bfc8bbb6ad1', kind: 'local_agent', description: 'Run Node.js command and report' },
]

async function bar(props: Record<string, unknown>): Promise<string> {
  // ⚠️ `conversation` is required since 287 finding 4 — it is what scopes an in-flight stop to one
  // record. It changes nothing SSR can see, so it is defaulted here rather than at ten call sites.
  return renderToString(createSSRApp(BackgroundBar, { conversation: 'sess_1', ...props }))
}

async function tool(props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(ToolEntry, props))
}

/**
 * 🔴 **The rendered TEXT of one registry cell, comments stripped** — and this exists because three
 * assertions in this file were passing over BackgroundBar's own prose (found by the adversarial pass
 * over 251's diff). SSR emits template comments verbatim, and that component's comments quote
 * `local_bash` and *"demo monitor emitting 3 ticks then exiting"* by name — so
 * `expect(html).toContain('local_bash')` held whatever the row rendered.
 */
function cellText(html: string, cy: string): string {
  const markup = html.replace(/<!--[\s\S]*?-->/g, '')
  const found = new RegExp(`data-cy="${cy}"[^>]*>([\\s\\S]*?)</span>`).exec(markup)?.[1] ?? ''
  expect(found, `nothing rendered for data-cy="${cy}"`).not.toBe('')
  // Entities decoded, because the point of this helper is what a PERSON reads: Vue escapes every
  // text node, so a command with `&&` and quotes in it arrives here as `&amp;&amp;` and `&quot;`.
  return found
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

describe('248 §3 · the registry above the composer', () => {
  it('⛔ says what is running, in the ONE vocabulary the card uses', async () => {
    const html = await bar({ registry: { running: RUNNING, dropped: 0 }, canStop: true })
    expect(html).toContain('data-cy="background-bar"')
    expect(html).toContain('still running')
    expect(html).toContain('data-cy="background-count"')
    expect(html).toContain('>2<')
    expect(html).toContain('Run the 30-second timer')
    // ⚑ A SUB-AGENT row, and it is there because 248 §5 measured that agents join the level set —
    // 21.7 s of false-settled turn on Haiku, 21.5 s on Sonnet. Filtering them out would leave this
    // bar silent during the exact window it exists for.
    expect(html).toContain('local_agent')
    expect(html).toContain('data-cy="background-row-aae1d6bfc8bbb6ad1"')
  })

  it('⛔ nothing running, nothing on screen — and the bar really can render', async () => {
    const empty = await bar({ registry: { running: [], dropped: 0 }, canStop: true })
    expect(empty).not.toContain('data-cy="background-bar"')
    // The paired positive: the same component with one row DOES draw, so the line above is a fact
    // about the empty set rather than about a component that never renders.
    const one = await bar({ registry: { running: [RUNNING[0]], dropped: 0 }, canStop: true })
    expect(one).toContain('data-cy="background-bar"')
    expect(one).toContain('thing is')
  })

  it('🔴 a registry that is UNDERSTATING itself says so (247 `dropped`, 092 no-silent-cap)', async () => {
    const html = await bar({ registry: { running: RUNNING, dropped: 3 }, canStop: true })
    expect(html).toContain('data-cy="background-dropped"')
    expect(html).toContain('3 more are running that this list cannot name')
    // …and it is absent when nothing was dropped, so its presence means something.
    const clean = await bar({ registry: { running: RUNNING, dropped: 0 }, canStop: true })
    expect(clean).not.toContain('data-cy="background-dropped"')
    expect(clean).toContain('data-cy="background-bar"')
  })

  it('⛔ no stop where the adapter cannot stop — ABSENT, not greyed (106, 118)', async () => {
    const cannot = await bar({ registry: { running: RUNNING, dropped: 0 }, canStop: false })
    expect(cannot).not.toContain('data-cy="background-stop-b6uoyo82k"')
    // 118: *"a greyed button still says 'this is the thing to do here, later' and there is no
    // later."* The ROW is still there — the registry's job is to say what is running whether or not
    // anything can be done about it — which is the paired positive for the line above.
    expect(cannot).toContain('data-cy="background-row-b6uoyo82k"')
    // ⚑ **563 · and the row that stayed is READ.** The hook above proves the element, not the
    // sentence: a registry that drew every row blank would keep it, and *"the row is still there"*
    // would then be a claim about an empty strip. ⛔ `cellText` exists in this file precisely
    // because a `toContain` over the raw string was reading the component's own prose.
    expect(cellText(cannot, 'background-what-b6uoyo82k')).toBe('Run the 30-second timer')
    const can = await bar({ registry: { running: RUNNING, dropped: 0 }, canStop: true })
    expect(can).toContain('data-cy="background-stop-b6uoyo82k"')
    expect(can).toContain('data-cy="background-stop-aae1d6bfc8bbb6ad1"')
  })
})

describe('248 §2 · the tool card', () => {
  const CALL = {
    kind: 'tool' as const,
    id: 'tool-1',
    callId: 'toolu_1',
    name: 'Bash',
    summary: 'node -e "setTimeout(…, 30000)"',
    at: 1_000,
  }

  it('🔴 a detached call does NOT read as finished — the dot is not green and the row says why', async () => {
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
    // ⛔ The correlation with the registry row, on screen. Without a shared key a reader cannot tell
    // that the row saying "still running" is the row the bar is offering to stop.
    expect(html).toContain('data-background-id="b6uoyo82k"')
    // ⛔ The defect, pinned: before 248 this row was `done` and carried a duration for the DETACH —
    // "1.2 s" beside work that ran for half a minute.
    expect(html).not.toContain('data-status="done"')
    expect(html).not.toContain('data-cy="tool-took"')
  })

  it('⛔ …and it becomes the completion record, with the WORK’s duration', async () => {
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
    // ⛔ The provider's own sentence about the ending, BESIDE the detachment receipt rather than
    // instead of it — the two together are the whole record, and 245 measured neither arriving.
    expect(html).toContain('data-cy="tool-background-summary"')
    expect(html).toContain('completed (exit code 0)')
    expect(html).toContain('Command running in background with ID')
    // 36 150 − 1 000, not 6 102 − 1 000. The receipt's duration is when it LEFT.
    expect(html).toContain('>35.1 s<')
    // …and NOT 5.1 s, which is what the detach's own duration would have printed. Anchored on the
    // element boundaries because `35.1 s` contains `5.1 s` — the first draft of this line was a
    // negative that could never hold.
    expect(html).not.toContain('>5.1 s<')
  })

  it('⚠️ an ordinary call is untouched — the row still reads exactly as it did', async () => {
    const html = await tool({
      item: { ...CALL, result: { summary: 'ok', ok: true, at: 1_400 } },
    })
    expect(html).toContain('data-status="done"')
    expect(html).toContain('400 ms')
    expect(html).not.toContain('data-cy="tool-background"')
    // …and it carries no correlation key either, because there is nothing in the registry to point
    // at. ⚠️ Matched as an ATTRIBUTE rather than as a bare string: SSR emits template comments
    // verbatim, and the comment above that div names the attribute — so the loose form was a
    // negative that could never hold.
    expect(html).not.toContain('data-background-id="')
  })

  it('⛔ stopped and unreported are their own words, and neither is a failure', async () => {
    const stopped = await tool({
      item: {
        ...CALL,
        result: { summary: 'x', ok: true, at: 2 },
        background: { outcome: 'stopped' },
      },
    })
    expect(stopped).toContain('data-status="stopped"')
    // ⚠️ Anchored on the element, not on the bare word: `toContain('stopped')` was satisfied by the
    // attribute on the line above it, so the only assertion covering `BACKGROUND_WORD.stopped`
    // reaching the DOM passed over nothing. Found by the adversarial pass over this diff.
    expect(stopped).toContain('>stopped</span>')
    const unknown = await tool({
      item: {
        ...CALL,
        result: { summary: 'x', ok: true, at: 2 },
        background: { outcome: 'unknown' },
      },
    })
    expect(unknown).toContain('data-status="unknown"')
    // `WorkflowEntry`'s own word for the same fact — one vocabulary across the two kinds of run.
    expect(unknown).toContain('>ended, outcome not reported</span>')
    expect(unknown).not.toContain('data-status="error"')
  })
})

/**
 * # 🔴 251 §2 · the command, on screen
 *
 * `background-command.test.ts` proves the JOIN and the words; this proves they reach the DOM. The
 * dispatch is explicit about why that is a separate assertion: ⚠️ *"assert what the row SAYS —
 * `248`'s live step went green over a defect because it only excluded two words."*
 */
describe('251 §2 · the row names what it is running', () => {
  const COMMAND = 'test -f ~/Desktop/person.txt && echo "EXISTS"'

  it('🔴 prints the COMMAND, in the card’s own two-part shape', async () => {
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
    // The command itself, HTML-escaped by Vue as any text node is — asserted through the same
    // escaping so this pins the string rather than the encoding.
    expect(cellText(html, 'background-what-b6uoyo82k')).toBe(`Bash ${COMMAND}`)
    expect(html).toContain('>Bash</strong>')
    // Vue’s `whitespace: 'condense'` removes a whitespace-only node between elements if it
    // contains a newline. Separate `<strong>` and `<code>` lines can therefore render
    // `Bashnode -e "…"` as one word. Read the DOM’s text, which is what the person and screen
    // reader receive, to require a space between the name and command.
    const cell = /data-cy="background-what-[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(
      html.replace(/<!--[\s\S]*?-->/g, ''),
    )?.[1]
    expect(cell?.replace(/<[^>]+>/g, '')).toMatch(/^Bash test -f/)
    // The replacement omits the description, preventing a second answer and a taller row
    // where the actual command remains hard to find.
    expect(html).not.toContain('waiting for person.txt to appear on Desktop')
    // The provider's word for the kind is untouched beside it (251 §1: a Monitor IS a shell).
    // ⚠️ Read out of the `.bg-kind` element: the component's own comment names `local_bash`, and a
    // loose `toContain` was satisfied by that prose whatever the row rendered.
    expect(html.replace(/<!--[\s\S]*?-->/g, '')).toMatch(/class="bg-kind"[^>]*>local_bash</)
  })

  it('⚠️ a row with no command shows the provider’s description, and says which answer that is', async () => {
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
    // No tool name, because there was no call to have got one from — the `<strong>` is absent rather
    // than empty. Paired with the positive above, which rendered one from the same component.
    expect(html).not.toContain('>Bash</strong>')
  })

  it('⛔ …and a row with neither is still NAMED, by the id the Stop sends (106)', async () => {
    const html = await bar({
      registry: { running: [{ id: 'b1' }], dropped: 0 },
      canStop: true,
      onStop: async () => true,
    })
    expect(html).toContain('data-from="id"')
    expect(cellText(html, 'background-what-b1')).toBe('b1')
  })

  it('🔴 a long command is CUT WITH A COUNT, never with a silent ellipsis (092)', async () => {
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
    // ⛔ The whole thing is on the row as its `title`, unclipped — so the count describes a string
    // this surface really holds.
    expect(html).toContain(`title="${long}"`)
    // …and the counted note is ABSENT when nothing was cut, so its presence means something.
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

  it('⛔ a command carrying a newline cannot turn one row into two (232 §2)', async () => {
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
    // ⚠️ Read out of the `<code>` element, not out of the whole cell. SSR emits template comments
    // VERBATIM, newlines included, so a cell-wide negative would have failed on this component's own
    // prose — the same trap 248's `data-background-id` line fell into one file over.
    const after = html.slice(html.indexOf('data-cy="background-what-b1"'))
    // ⚠️ **Comments stripped FIRST, and both earlier drafts of this line needed it.** SSR emits
    // template comments verbatim, the comment inside this very cell quotes `<code>` and spans
    // several lines — so both `indexOf('<code')` and a plain regex matched inside the prose and the
    // negative below failed on a newline the component had written rather than rendered.
    const markup = after.replace(/<!--[\s\S]*?-->/g, '')
    const code = /<code[^>]*>([\s\S]*?)<\/code>/.exec(markup)?.[1] ?? ''
    expect(code).not.toBe('')
    expect(code).toContain('echo one\\necho two')
    expect(code).not.toContain('\n')
  })
})
