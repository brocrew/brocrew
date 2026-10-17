import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import RecoveryApp from '../../src/renderer/src/components/RecoveryApp.vue'
import {
  runtimePathCalls,
  useMessagePaths,
} from '../../src/renderer/src/composables/useMessagePaths'
import { fileManagerWord } from '../../src/renderer/src/lib/message-paths'
import type {
  MessagePath,
  MessagePathAsk,
  MessagePathTarget,
  OpenMessagePathResult,
  RevealResult,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import type { HistoryEvent } from '../../src/shared/recovery'
import { mount, paneProps, permission, record, unmountAll, type Mounted } from './harness'
import {
  CONVERSATIONS,
  fakeRecoveryBridge,
  HISTORY_ONLY,
  type FakeRecoveryBridge,
  type RecoveryScript,
} from './recovery-fake'

/**
 * A path a message names becomes a control once main says it is there: the main control opens it
 * (main decides whether that means opening or showing), the second always shows it, and a press
 * sends the conversation and the text as written, never a path.
 *
 * The bridge is a fake on `window.api.runtime`, behind the DOM project's wire, so every argument is
 * cloned the way the real IPC clones it.
 */

const HERE = '/Users/someone/work'
const FILE_MANAGER = fileManagerWord(navigator.platform)

const said = (text: string): TranscriptEvent => ({ type: 'assistant_message', text }) as never
const typed = (text: string): TranscriptEvent => ({ type: 'user_turn', text }) as never

/** What main would answer: a file under the working folder, unless the text is listed as missing. */
function found(text: string, over: Partial<MessagePath> = {}): MessagePath {
  return {
    text,
    found: true,
    absolute: /^(\/|[A-Za-z]:)/.test(text) ? text : `${HERE}/${text.replace(/^\.\//, '')}`,
    name: text.split(/[\\/]/).filter(Boolean).at(-1) ?? text,
    kind: text.endsWith('/') ? 'folder' : 'file',
    opens: /\.(md|txt|pdf)$/.test(text),
    ...over,
  } as MessagePath
}

interface FakeMain {
  asks: MessagePathAsk[]
  opens: MessagePathTarget[]
  reveals: MessagePathTarget[]
}

function installMain(
  options: {
    missing?: readonly string[]
    existing?: readonly string[]
    opened?: OpenMessagePathResult
    revealed?: RevealResult
    resolved?: Readonly<Record<string, string>>
  } = {},
): FakeMain {
  const main: FakeMain = { asks: [], opens: [], reveals: [] }
  const missing = new Set(options.missing ?? [])
  const existing = options.existing ? new Set(options.existing) : null
  ;(window as unknown as { api?: unknown }).api = {
    runtime: {
      resolveMessagePaths: async (ask: MessagePathAsk): Promise<MessagePath[]> => {
        main.asks.push(ask)
        return ask.texts.map((text) =>
          missing.has(text) || (existing !== null && !existing.has(text))
            ? { text, found: false }
            : found(text, options.resolved?.[text] ? { absolute: options.resolved[text] } : {}),
        )
      },
      openMessagePath: async (target: MessagePathTarget): Promise<OpenMessagePathResult> => {
        main.opens.push(target)
        return options.opened ?? { ok: true, did: 'opened' }
      },
      revealMessagePath: async (target: MessagePathTarget): Promise<RevealResult> => {
        main.reveals.push(target)
        return options.revealed ?? { ok: true, path: `${HERE}/${target.text}` }
      },
    },
  }
  return main
}

afterEach(() => {
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
})

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

/** Re-renders every message: the heading of an agent's reply is a prop of each one. */
const tick = ref(0)

/** A transcript with this window's paths, as `ConversationPane` hands them, and a button before it. */
async function transcript(events: TranscriptEvent[]): Promise<{
  view: Mounted
  add(event: TranscriptEvent): Promise<void>
}> {
  const seen = [...events]
  const items = shallowRef(record(seen).transcript.items)
  const Holder = defineComponent({
    setup() {
      const paths = useMessagePaths(() => 'sess_1', runtimePathCalls)
      return () =>
        h('div', { style: 'display: grid; width: 100%' }, [
          h('button', { type: 'button', 'data-cy': 'before' }, 'before'),
          h(TranscriptView, {
            items: items.value,
            mode: 'normal',
            who: `Agent ${tick.value}`,
            paths: paths.value,
          }),
        ])
    },
  })
  const view = mount(Holder, {}, { width: 1000, height: 700 })
  await settle()
  return {
    view,
    async add(event) {
      seen.push(event)
      items.value = record(seen).transcript.items
      await settle()
    },
  }
}

const controls = (view: Mounted): HTMLButtonElement[] =>
  view.all('message-path') as HTMLButtonElement[]
const controlFor = (view: Mounted, text: string): HTMLButtonElement | undefined =>
  controls(view).find((button) => button.dataset.messagePath === text)
const showFor = (view: Mounted, text: string): HTMLButtonElement | undefined =>
  (view.all('message-path-show') as HTMLButtonElement[]).find(
    (button) => button.dataset.messagePathShow === text,
  )

describe('a path main found becomes a control', () => {
  it('links Application Support in prose and inline code without swallowing the sentence', async () => {
    const path = '/Users/fictional/Library/Application Support/BroBot/my report.md'
    const main = installMain({ existing: [path] })
    const text = `See ${path} for details. Then \`${path}\` again.`
    const { view } = await transcript([said(text)])
    const links = controls(view)
    expect(links).toHaveLength(2)
    expect(links.map((button) => button.textContent)).toEqual([path, path])
    expect(links.every((button) => button.title === path)).toBe(true)
    expect(view.q('assistant-markdown').textContent?.trim()).toBe(text.replaceAll('`', ''))
    expect(view.q('assistant-markdown').querySelector('code button')?.textContent).toBe(path)
    links[0]!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
    showFor(view, path)!.click()
    await settle()
    expect(main.reveals).toEqual([{ sessionId: 'sess_1', text: path }])
    expect(main.asks).toHaveLength(1)
    expect(main.asks[0]!.texts).toContain(path)
    expect(main.asks[0]!.texts.length).toBeLessThanOrEqual(50)
  })

  it('keeps two spaced paths on one line, leaves missing paths plain and preserves Windows text', async () => {
    const first = '/Users/fictional/Library/Application Support/BroBot/first.md'
    const second = 'C:\\Users\\First Last\\Documents\\second report.md'
    const missing = '/tmp/No Such Folder/missing.md'
    installMain({ existing: [first, second] })
    const text = `Read ${first} and \`${second}\` for details; missing ${missing}.`
    const { view } = await transcript([said(text)])
    expect(controls(view).map((button) => button.dataset.messagePath)).toEqual([first, second])
    expect(controlFor(view, missing)).toBeUndefined()
    expect(view.q('assistant-markdown').textContent?.trim()).toBe(text.replaceAll('`', ''))
  })

  it('keeps candidate IPC bounded for a burst of spaced names', async () => {
    const paths = Array.from({ length: 80 }, (_, i) => `/tmp/Some Folder/report${i}.md`)
    const main = installMain({ existing: paths })
    await transcript([said(paths.join('\n'))])
    expect(main.asks).toHaveLength(1)
    expect(main.asks[0]!.texts).toHaveLength(50)
    expect(main.asks[0]!.texts.every((text) => text.length <= 1024)).toBe(true)
    tick.value += 1
    await settle()
    expect(main.asks).toHaveLength(1)
  })

  it('keeps a long complete spelling after the prefix slots fill with filename-like prose', async () => {
    const path = '/tmp/one two three four five six seven eight/report.md'
    const after = ` and ${Array.from({ length: 20 }, (_, i) => `README${i}.md`).join(' ')}.`
    const main = installMain({ existing: [path] })
    const { view } = await transcript([said(`See ${path}${after}`)])
    expect(main.asks[0]!.texts).toContain(path)
    expect(controls(view).map((button) => button.textContent)).toEqual([path])
    expect(view.q('assistant-markdown').textContent?.trim()).toBe(`See ${path}${after}`)
  })
  it('draws the path as written, with the full path in its hover', async () => {
    installMain()
    const { view } = await transcript([said('The message is in projects/x/report.md now.')])
    const control = controlFor(view, 'projects/x/report.md')
    expect(control, 'the found path drew no control').toBeDefined()
    expect(control!.textContent).toBe('projects/x/report.md')
    expect(control!.title).toBe(`${HERE}/projects/x/report.md`)
    expect(control!.type).toBe('button')
    expect(showFor(view, 'projects/x/report.md')!.title).toBe(`${HERE}/projects/x/report.md`)
    // The sentence reads as it did: the full stop stays after the control.
    expect(view.q('assistant-markdown').textContent?.trim()).toBe(
      'The message is in projects/x/report.md now.',
    )
  })

  it('leaves a path main did not find as plain text', async () => {
    installMain({ missing: ['gone/missing.md'] })
    const { view } = await transcript([said('Read projects/x/report.md and gone/missing.md.')])
    expect(controlFor(view, 'gone/missing.md')).toBeUndefined()
    expect(view.q('assistant-markdown').textContent).toContain('gone/missing.md.')
    // The control for the found one beside it shows the missing one was asked about and refused.
    expect(controlFor(view, 'projects/x/report.md')).toBeDefined()
  })

  it('draws plain text, and asks nothing, where the bridge does not carry the calls', async () => {
    ;(window as unknown as { api?: unknown }).api = { runtime: {} }
    const { view } = await transcript([said('Read projects/x/report.md'), typed('see src/a.ts')])
    expect(controls(view)).toHaveLength(0)
    expect(view.q('assistant-markdown').textContent?.trim()).toBe('Read projects/x/report.md')
    expect(view.q('user-message').textContent).toBe('see src/a.ts')
  })

  it("draws the person's own message the same way, with its words unchanged", async () => {
    installMain()
    const { view } = await transcript([typed('Where is projects/x/report.md?')])
    expect(controlFor(view, 'projects/x/report.md')).toBeDefined()
    expect(view.q('user-message').textContent).toBe('Where is projects/x/report.md?')
  })

  it("marks a path in a permission card's scope", async () => {
    installMain()
    const { view } = await transcript([permission('req_1')])
    const control = controlFor(view, '/work')
    expect(control, 'the scope folder drew no control').toBeDefined()
    expect(view.q('permission-card').contains(control!)).toBe(true)
  })
})

describe('asking main', () => {
  it('asks once per message with the sessionId, and not again when the message redraws', async () => {
    const main = installMain()
    const { view, add } = await transcript([
      typed('see src/a.ts'),
      said('Done in src/b.ts and `src/c.ts`.'),
    ])
    expect(main.asks).toEqual([
      { sessionId: 'sess_1', texts: ['src/a.ts'] },
      { sessionId: 'sess_1', texts: ['src/b.ts', 'src/c.ts'] },
    ])
    tick.value += 1
    await settle()
    tick.value += 1
    await settle()
    // A real wait too, so an ask put off to a timer would have landed by now.
    await new Promise((done) => setTimeout(done, 100))
    await settle()
    expect(view.all('assistant-author').map((el) => el.textContent)).toEqual([
      `Agent ${tick.value}`,
    ])
    expect(main.asks).toHaveLength(2)
    // A new message with a new path is asked about, so the count above can move.
    await add(said('And src/d.ts.'))
    expect(main.asks).toHaveLength(3)
    expect(main.asks[2]).toEqual({ sessionId: 'sess_1', texts: ['src/d.ts'] })
  })

  it('does not ask about, or mark, a path in a fenced block or a link', async () => {
    const main = installMain()
    const { view } = await transcript([
      said(
        '```\ncat inside/fence.md\n```\n[inside/link.md](https://example.com/x)\nbut src/out.md',
      ),
    ])
    const texts = main.asks.flatMap((ask) => ask.texts)
    expect(texts).toEqual(['src/out.md'])
    expect(view.q('assistant-markdown').querySelector('pre button')).toBeNull()
    expect(view.q('assistant-markdown').querySelector('a button')).toBeNull()
    expect(controlFor(view, 'src/out.md')).toBeDefined()
  })
})

describe('the two presses', () => {
  it('the main control asks main to open the text as written, in this conversation', async () => {
    const main = installMain()
    const { view } = await transcript([said('See projects/x/report.md')])
    controlFor(view, 'projects/x/report.md')!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: 'projects/x/report.md' }])
    expect(main.reveals).toEqual([])
    expect(view.all('message-path-failure')).toHaveLength(0)
  })

  it('the second control asks main to show it, and never to open it', async () => {
    const main = installMain()
    const { view } = await transcript([said('See projects/x/report.md')])
    showFor(view, 'projects/x/report.md')!.click()
    await settle()
    expect(main.reveals).toEqual([{ sessionId: 'sess_1', text: 'projects/x/report.md' }])
    expect(main.opens).toEqual([])
  })

  it('a click on the folder icon inside the second control lands on it', async () => {
    const main = installMain()
    const { view } = await transcript([said('See projects/x/report.md')])
    const icon = showFor(view, 'projects/x/report.md')!.querySelector('svg')!
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(main.reveals).toHaveLength(1)
  })

  it('Tab reaches both controls and Enter presses them', async () => {
    const main = installMain()
    const { view } = await transcript([typed('Look at projects/x/report.md')])
    view.q('before').focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(controlFor(view, 'projects/x/report.md'))
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: 'projects/x/report.md' }])
    await userEvent.tab()
    expect(document.activeElement).toBe(showFor(view, 'projects/x/report.md'))
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(main.reveals).toEqual([{ sessionId: 'sess_1', text: 'projects/x/report.md' }])
  })

  it('names a file main may open "Open", and one it only shows "Show … in" the file manager', async () => {
    installMain()
    const { view } = await transcript([said('Read projects/x/report.md, then run bin/go.command')])
    expect(controlFor(view, 'projects/x/report.md')!.getAttribute('aria-label')).toBe(
      'Open report.md',
    )
    expect(showFor(view, 'projects/x/report.md')!.getAttribute('aria-label')).toBe(
      `Show report.md in ${FILE_MANAGER}`,
    )
    expect(controlFor(view, 'bin/go.command')!.getAttribute('aria-label')).toBe(
      `Show go.command in ${FILE_MANAGER}`,
    )
  })

  it('a press on a path that is gone says so, and what to do', async () => {
    installMain({ opened: { ok: false, reason: 'gone' } })
    const { view } = await transcript([said('See projects/x/report.md')])
    expect(view.all('message-path-failure')).toHaveLength(0)
    controlFor(view, 'projects/x/report.md')!.click()
    await settle()
    expect(view.q('message-path-failure').textContent?.trim()).toBe(
      "That file isn't there any more. Ask the agent where it is now.",
    )
  })
})

describe('through the conversation pane', () => {
  it('the pane hands its own conversation to the presses', async () => {
    const main = installMain()
    const view = mount(
      ConversationPane,
      paneProps({ record: record([said('See projects/x/report.md')], 'sess_pane') }),
      { width: 1200, height: 808 },
    )
    await settle()
    expect(main.asks).toEqual([{ sessionId: 'sess_pane', texts: ['projects/x/report.md'] }])
    controlFor(view, 'projects/x/report.md')!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_pane', text: 'projects/x/report.md' }])
  })
})

describe('the recovery window', () => {
  const events: readonly HistoryEvent[] = [
    { event: said('The draft is in projects/x/report.md'), at: Date.parse('2026-09-01T10:00:00Z') },
  ]

  async function history(
    over: Partial<RecoveryScript> = {},
  ): Promise<{ view: Mounted; bridge: FakeRecoveryBridge }> {
    const bridge = fakeRecoveryBridge({
      verdict: HISTORY_ONLY,
      conversations: CONVERSATIONS,
      transcripts: { 'conv-header': events },
      ...over,
    })
    const view = mount(RecoveryApp, { bridge }, { width: 1200, height: 800 })
    await settle()
    view.all('recovery-conversation')[1]!.click()
    await settle()
    return { view, bridge }
  }

  it('only ever shows a path, in words that say so', async () => {
    const { view, bridge } = await history({
      paths: (ask) => ask.texts.map((text) => found(text, { opens: false })),
    })
    expect(bridge.pathAsks).toEqual([{ sessionId: 'conv-header', texts: ['projects/x/report.md'] }])
    const control = controlFor(view, 'projects/x/report.md')
    expect(control, 'the found path drew no control').toBeDefined()
    expect(control!.getAttribute('aria-label')).toBe(`Show report.md in ${FILE_MANAGER}`)
    expect(view.all('message-path-show')).toHaveLength(0)
    control!.click()
    await settle()
    expect(bridge.pathsShown).toEqual([{ sessionId: 'conv-header', text: 'projects/x/report.md' }])
  })

  it('is named Show even where main would say a file opens', async () => {
    // Planted: this window has no open call, so an `opens: true` cannot make it one.
    const { view } = await history({ paths: (ask) => ask.texts.map((text) => found(text)) })
    expect(controlFor(view, 'projects/x/report.md')!.getAttribute('aria-label')).toBe(
      `Show report.md in ${FILE_MANAGER}`,
    )
  })

  it('draws plain text, and no error, when main refuses to read the copy', async () => {
    const { view, bridge } = await history({
      pathsError: new Error('There is no restored copy to read now.'),
    })
    expect(bridge.pathAsks).toHaveLength(1)
    expect(view.host.textContent).toContain('The draft is in projects/x/report.md')
    expect(controls(view)).toHaveLength(0)
    expect(view.all('message-path-failure')).toHaveLength(0)
    expect(view.host.textContent).not.toContain('There is no restored copy')
  })
})

describe('a link to a file on this computer offers the same controls as a path in the text', () => {
  /** The link a fictional agent wrote, and the destination it names, exactly as written. */
  const link = (label: string, destination: string): string => `See [${label}](${destination}).`
  const anchors = (view: Mounted): HTMLAnchorElement[] => [
    ...view.q('assistant-markdown').querySelectorAll('a'),
  ]
  const previousPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')
  afterEach(() => {
    if (previousPlatform) Object.defineProperty(navigator, 'platform', previousPlatform)
    else Reflect.deleteProperty(navigator, 'platform')
  })
  function onPlatform(value: string): void {
    Object.defineProperty(navigator, 'platform', { value, configurable: true })
  }

  async function capture(view: Mounted, name: string): Promise<void> {
    const phase = import.meta.env.VITE_W4454_CAPTURE
    if (phase) {
      const target = view.q('assistant-markdown').querySelector<HTMLElement>('button, a')!
      const original = { width: window.innerWidth, height: window.innerHeight }
      try {
        await page.viewport(1200, 800)
        await userEvent.hover(target)
        console.info(
          'file-link-hover',
          JSON.stringify({
            phase,
            name,
            title: target.title,
            href: target.getAttribute('href'),
            text: target.textContent,
          }),
        )
        await page.screenshot({
          element: view.q('assistant-markdown'),
          path: `__screenshots__/file-link-${phase}-${name}.png`,
        })
      } finally {
        await page.viewport(original.width, original.height)
      }
    }
  }

  describe('on Windows', () => {
    function onWindows(): void {
      onPlatform('Win32')
    }

    it('keeps a drive path whole, backslashes and `\\@` included, and opens it by its destination', async () => {
      onWindows()
      const path = 'C:\\Users\\fictional\\AppData\\Roaming\\@brobot2\\desktop\\out\\app.apk'
      const main = installMain({ existing: [path] })
      const { view } = await transcript([said(link('The app, version 1.2.3', path))])
      await capture(view, 'windows')
      expect(main.asks.flatMap((ask) => ask.texts)).toContain(path)
      const control = controlFor(view, path)
      expect(control, 'the link drew no control').toBeDefined()
      expect(control!.textContent).toBe(path)
      expect(control!.title).toBe(path)
      expect(control!.getAttribute('data-opens')).toBe('false')
      expect(view.q('assistant-markdown').textContent).toContain('The app, version 1.2.3')
      expect(showFor(view, path)!.getAttribute('aria-label')).toBe('Show app.apk in Explorer')
      expect(anchors(view)).toHaveLength(0)
      control!.click()
      await settle()
      expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
      showFor(view, path)!.click()
      await settle()
      expect(main.reveals).toEqual([{ sessionId: 'sess_1', text: path }])
    })

    it('keeps `\\_` and spaces in an angle-bracketed destination', async () => {
      onWindows()
      const path = 'C:\\Users\\fictional\\My Files\\a\\_b\\notes.md'
      installMain({ existing: [path] })
      const { view } = await transcript([said(link('notes', `<${path}>`))])
      expect(controlFor(view, path)?.textContent).toBe(path)
      expect(controlFor(view, path)?.title).toBe(path)
      expect(showFor(view, path)?.getAttribute('aria-label')).toBe('Show notes.md in Explorer')
    })

    it('takes a forward-slash drive path the same way', async () => {
      onWindows()
      const path = 'C:/Users/fictional/out/report.md'
      const absolute = 'C:\\Users\\fictional\\out\\report.md'
      const main = installMain({ existing: [path], resolved: { [path]: absolute } })
      const { view } = await transcript([said(link('the report', path))])
      expect(controlFor(view, path)?.textContent).toBe(absolute)
      expect(controlFor(view, path)?.title).toBe(absolute)
      controlFor(view, path)!.click()
      await settle()
      expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
    })

    it('leaves a share a link with a readable hover: main opens no share', async () => {
      onWindows()
      const path = '\\\\fileserver\\team\\out\\report.md'
      const main = installMain()
      const { view } = await transcript([said(link('the report', path))])
      expect(main.asks.flatMap((ask) => ask.texts)).not.toContain(path)
      expect(controls(view)).toHaveLength(0)
      expect(anchors(view)[0]!.title).toBe(path)
      expect(anchors(view)[0]!.hasAttribute('href')).toBe(false)
      anchors(view)[0]!.click()
      await settle()
      expect(main.opens).toEqual([])
      expect(main.reveals).toEqual([])
    })
  })

  it('on the Mac, a rooted link opens as a path in the text does', async () => {
    onPlatform('MacIntel')
    const path = '/Users/fictional/out/report.md'
    const main = installMain({ existing: [path] })
    const { view } = await transcript([said(link('the report', path))])
    await capture(view, 'mac')
    expect(controlFor(view, path)?.textContent).toBe(path)
    expect(controlFor(view, path)?.title).toBe(path)
    expect(showFor(view, path)?.getAttribute('aria-label')).toBe('Show report.md in Finder')
    controlFor(view, path)!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
  })

  it.each([
    ['reports/x.md', `${HERE}/reports/x.md`],
    ['./x', `${HERE}/x`],
    ['../x', '/Users/someone/x'],
  ])('shows main’s resolved destination for the relative link %s', async (path, absolute) => {
    onPlatform('MacIntel')
    const main = installMain({ existing: [path!], resolved: { [path!]: absolute! } })
    const { view } = await transcript([said(link('report.pdf', path!))])
    expect(main.asks.flatMap((ask) => ask.texts)).toEqual([path])
    const control = controlFor(view, path!)!
    expect(control.textContent).toBe(absolute)
    expect(control.title).toBe(absolute)
    expect(view.q('assistant-markdown').textContent).toContain('report.pdf')
    control.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
  })

  it('preserves literal percent and escaped HTML characters in a local destination', async () => {
    const path = '/Users/fictional/My Files/100%20 & quoted.md'
    const main = installMain({ existing: [path] })
    const { view } = await transcript([said(link('notes', `<${path}>`))])
    expect(main.asks.flatMap((ask) => ask.texts)).toEqual([path])
    expect(controlFor(view, path)?.textContent).toBe(path)
    expect(controlFor(view, path)?.title).toBe(path)
  })

  it.each(['report.md', 'notes/x.md', 'x'])(
    'resolves the explicit relative destination %s',
    async (path) => {
      const absolute = `${HERE}/${path}`
      const main = installMain({ existing: [path], resolved: { [path]: absolute } })
      const { view } = await transcript([said(link('the report', path))])
      expect(main.asks.flatMap((ask) => ask.texts)).toEqual([path])
      expect(controlFor(view, path)?.textContent).toBe(absolute)
      expect(controlFor(view, path)?.title).toBe(absolute)
      controlFor(view, path)!.click()
      await settle()
      expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
    },
  )

  it.each(['report.md', 'x'])(
    'keeps the missing basename %s as plain destination text',
    async (path) => {
      const main = installMain({ missing: [path] })
      const { view } = await transcript([said(link('the report', path))])
      expect(main.asks.flatMap((ask) => ask.texts)).toEqual([path])
      expect(controls(view)).toHaveLength(0)
      expect(anchors(view)).toHaveLength(0)
      expect(view.q('assistant-markdown').textContent?.trim()).toBe(`See the report ${path}.`)
    },
  )

  it('keeps schemes, fragments and empty destinations outside the local route', async () => {
    const main = installMain()
    const { view } = await transcript([
      said(
        '[web](https://example.com/a) [mail](mailto:test@example.com) [anchor](#part) [empty]() [other](custom:thing) [script](javascript:alert(1))',
      ),
    ])
    expect(main.asks).toEqual([])
    expect(controls(view)).toHaveLength(0)
    expect(anchors(view).map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/a',
      'mailto:test@example.com',
      '#part',
      '',
      'custom:thing',
    ])
  })

  it('does not turn basename words in ordinary prose into file candidates', async () => {
    const main = installMain()
    const { view } = await transcript([said('Read report.md and x.')])
    expect(main.asks).toEqual([])
    expect(controls(view)).toHaveLength(0)
  })

  it('never turns a known path in the link label into a second target', async () => {
    const label = 'docs/private.md'
    const path = '/tmp/report.md'
    const main = installMain({ existing: [label, path] })
    const { view } = await transcript([said(`${label}; [${label}](${path})`)])
    expect(controls(view)).toHaveLength(2)
    expect(controls(view).filter((one) => one.dataset.messagePath === label)).toHaveLength(1)
    const caption = view.q('assistant-markdown').querySelector('.message-path-label')!
    expect(caption.textContent).toBe(label)
    expect(caption.querySelector('button')).toBeNull()
    controlFor(view, path)!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
  })

  it('preserves rich labels while acting only on their destination', async () => {
    const path = '/tmp/report.md'
    const main = installMain({ existing: [path] })
    const { view } = await transcript([said(`[**report** and \`details\`](${path})`)])
    const caption = view.q('assistant-markdown').querySelector('.message-path-label')!
    expect(caption.querySelector('strong')?.textContent).toBe('report')
    expect(caption.querySelector('code')?.textContent).toBe('details')
    expect(controls(view)).toHaveLength(1)
    controlFor(view, path)!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
  })

  it('keeps a refused image label complete and outside the single local control', async () => {
    const path = '/tmp/report.md'
    const main = installMain({ existing: [path] })
    const { view } = await transcript([
      said(`Before [![badge](https://example.com/badge.png)](${path}) after.`),
    ])
    const body = view.q('assistant-markdown')
    expect(controls(view)).toHaveLength(1)
    expect(anchors(view)).toHaveLength(0)
    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('.message-path-label .refused-image')?.tagName).toBe('SPAN')
    expect(body.querySelector('button button, a button, button a')).toBeNull()
    expect(body.textContent?.trim()).toBe(
      `Before badge — https://example.com/badge.png ${path} after.`,
    )
    controlFor(view, path)!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
  })

  it.each(['$&', '$`', "$'"])(
    'keeps the literal replacement token %s in the destination and action',
    async (token) => {
      const path = `/Users/fictional/${token}.md`
      const main = installMain({ existing: [path] })
      const { view } = await transcript([said(`Before [document](<${path}>) after.`)])
      const control = controlFor(view, path)
      expect(control).toBeDefined()
      expect(control!.textContent).toBe(path)
      expect(control!.title).toBe(path)
      expect(anchors(view)).toHaveLength(0)
      expect(view.q('assistant-markdown').textContent?.trim()).toBe(
        `Before document ${path} after.`,
      )
      control!.click()
      await settle()
      expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
    },
  )

  it.each(['$&', '$`', "$'"])(
    'keeps a literal replacement token %s in the label without copying surrounding markup',
    async (token) => {
      const path = '/Users/fictional/notes.md'
      const main = installMain({ existing: [path] })
      const label = `document ${token}`
      const sourceLabel = label.replaceAll('`', '\\`')
      const { view } = await transcript([said(`Before [${sourceLabel}](<${path}>) after.`)])
      expect(view.q('assistant-markdown').textContent?.trim()).toBe(
        `Before ${label} ${path} after.`,
      )
      expect(anchors(view)).toHaveLength(0)
      expect(controlFor(view, path)?.textContent).toBe(path)
      controlFor(view, path)!.click()
      await settle()
      expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
    },
  )

  it('keeps a missing dollar destination as literal plain text', async () => {
    const path = '/Users/fictional/$&.md'
    const main = installMain({ missing: [path] })
    const { view } = await transcript([said(`Before [document](<${path}>) after.`)])
    expect(view.q('assistant-markdown').textContent?.trim()).toBe(`Before document ${path} after.`)
    expect(controls(view)).toHaveLength(0)
    expect(anchors(view)).toHaveLength(0)
    expect(main.opens).toEqual([])
    expect(main.reveals).toEqual([])
  })

  it('acts on where the link goes, not on what it says, and shows where it goes', async () => {
    const path = '/Users/fictional/private/keys.txt'
    const main = installMain({ existing: [path] })
    const { view } = await transcript([said(`See [report.pdf](${path} "report.pdf").`)])
    const control = controlFor(view, path)!
    expect(control.textContent).toBe(path)
    expect(control.title).toBe(path)
    expect(controlFor(view, 'report.pdf')).toBeUndefined()
    control.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
  })

  it('leaves a missing destination as plain text without a control', async () => {
    const path = '/Users/fictional/gone/report.md'
    installMain({ missing: [path] })
    const { view } = await transcript([said(link('the report', path))])
    expect(controls(view)).toHaveLength(0)
    expect(anchors(view)).toHaveLength(0)
    expect(view.q('assistant-markdown').textContent).toContain(path)
    expect(view.q('assistant-markdown').querySelector('span[title]')?.getAttribute('title')).toBe(
      path,
    )
  })

  it('does not touch a web or script link', async () => {
    const main = installMain()
    const { view } = await transcript([
      said('See [site](https://example.com/a) and [x](javascript:alert(1)).'),
    ])
    expect(controls(view)).toHaveLength(0)
    expect(main.asks.flatMap((ask) => ask.texts)).not.toContain('https://example.com/a')
    expect(anchors(view).map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a'])
  })
})
