import { afterEach, describe, expect, it, vi } from 'vitest'
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
    /** Holds every answer until this resolves. */
    held?: Promise<void>
  } = {},
): FakeMain {
  const main: FakeMain = { asks: [], opens: [], reveals: [] }
  const missing = new Set(options.missing ?? [])
  const existing = options.existing ? new Set(options.existing) : null
  ;(window as unknown as { api?: unknown }).api = {
    runtime: {
      resolveMessagePaths: async (ask: MessagePathAsk): Promise<MessagePath[]> => {
        main.asks.push(ask)
        await options.held
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
/** The drawn path beside an Open control: plain text, never a control itself. */
const textOf = (control: HTMLElement): HTMLElement =>
  control.closest('.message-path')!.querySelector<HTMLElement>('.message-path-text')!
const textFor = (view: Mounted, text: string): HTMLElement | undefined => {
  const control = controlFor(view, text)
  return control ? textOf(control) : undefined
}
const copyFor = (view: Mounted, text: string): HTMLButtonElement =>
  controlFor(view, text)!
    .closest('.message-path')!
    .querySelector<HTMLButtonElement>('[data-cy="message-path-copy"]')!

describe('a path main found becomes a control', () => {
  it('links Application Support in prose and inline code without swallowing the sentence', async () => {
    const path = '/Users/fictional/Library/Application Support/BroBot/my report.md'
    const main = installMain({ existing: [path] })
    const text = `See ${path} for details. Then \`${path}\` again.`
    const { view } = await transcript([said(text)])
    const links = controls(view)
    expect(links).toHaveLength(2)
    const texts = view.all('message-path-text')
    expect(texts.map((one) => one.textContent)).toEqual([path, path])
    expect(texts.every((one) => one.title === path)).toBe(true)
    expect(view.q('assistant-markdown').textContent?.trim()).toBe(text.replaceAll('`', ''))
    expect(view.q('assistant-markdown').querySelector('code .message-path-text')?.textContent).toBe(
      path,
    )
    links[0]!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
    expect(main.reveals).toEqual([])
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
    expect(view.all('message-path-text').map((one) => one.textContent)).toEqual([path])
    expect(view.q('assistant-markdown').textContent?.trim()).toBe(`See ${path}${after}`)
  })
  it('draws the path as written, with the full path in its hover', async () => {
    installMain()
    const { view } = await transcript([said('The message is in projects/x/report.md now.')])
    const control = controlFor(view, 'projects/x/report.md')
    expect(control, 'the found path drew no control').toBeDefined()
    expect(textOf(control!).textContent).toBe('projects/x/report.md')
    expect(textOf(control!).title).toBe(`${HERE}/projects/x/report.md`)
    expect(control!.type).toBe('button')
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

describe('the path and its two icons', () => {
  it('Open asks main to open the text as written, in this conversation', async () => {
    const main = installMain()
    const { view } = await transcript([said('See projects/x/report.md')])
    controlFor(view, 'projects/x/report.md')!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: 'projects/x/report.md' }])
    expect(main.reveals).toEqual([])
    expect(view.all('message-path-failure')).toHaveLength(0)
  })

  it('the path itself is coloured text, neither a link nor a control', async () => {
    const main = installMain()
    const { view } = await transcript([said('See projects/x/report.md')])
    const text = textFor(view, 'projects/x/report.md')!
    expect(text.tagName).toBe('SPAN')
    expect(text.closest('a, button')).toBeNull()
    expect(getComputedStyle(text).color).not.toBe(
      getComputedStyle(view.q('assistant-markdown')).color,
    )
    text.click()
    await settle()
    expect(main.opens).toEqual([])
    expect(main.reveals).toEqual([])
  })

  it('Copy writes the path as drawn, then says Copied on the icon', async () => {
    const main = installMain()
    const written = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    try {
      const { view } = await transcript([said('See projects/x/report.md')])
      const copy = copyFor(view, 'projects/x/report.md')
      expect(copy.getAttribute('aria-label')).toBe('Copy path')
      expect(copy.title).toBe('Copy path')
      copy.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await settle()
      expect(written).toHaveBeenCalledWith('projects/x/report.md')
      expect(copy.getAttribute('aria-label')).toBe('Copied')
      expect(copy.querySelector('use')!.getAttribute('href')).toBe('#i-check')
      expect(main.opens).toEqual([])
    } finally {
      written.mockRestore()
    }
  })

  it('keeps Copied for its whole time after a second copy, then puts Copy back', async () => {
    installMain()
    const written = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const { view } = await transcript([said('See projects/x/report.md')])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const copy = copyFor(view, 'projects/x/report.md')
      copy.click()
      await settle()
      vi.advanceTimersByTime(1000)
      copy.click()
      await settle()
      // Past the first copy's 1600 ms, inside the second's.
      vi.advanceTimersByTime(700)
      expect(copy.getAttribute('aria-label')).toBe('Copied')
      expect(copy.querySelector('use')!.getAttribute('href')).toBe('#i-check')
      vi.advanceTimersByTime(1000)
      expect(copy.getAttribute('aria-label')).toBe('Copy path')
      expect(copy.title).toBe('Copy path')
      expect(copy.querySelector('use')!.getAttribute('href')).toBe('#i-copy')
      expect(written).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
      written.mockRestore()
    }
  })

  it('says what to do when the clipboard refuses the copy', async () => {
    installMain()
    const written = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('no'))
    try {
      const { view } = await transcript([said('See projects/x/report.md')])
      copyFor(view, 'projects/x/report.md').click()
      await settle()
      expect(view.q('message-path-failure').textContent?.trim()).toBe(
        "That path didn't copy. Select its text and copy it instead.",
      )
    } finally {
      written.mockRestore()
    }
  })

  it('a click on the glyph inside Open lands on it', async () => {
    const main = installMain()
    const { view } = await transcript([said('See projects/x/report.md')])
    const icon = controlFor(view, 'projects/x/report.md')!.querySelector('svg')!
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(main.opens).toHaveLength(1)
  })

  it('Tab reaches Copy, then Open, and Enter presses them', async () => {
    const main = installMain()
    const written = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    try {
      const { view } = await transcript([typed('Look at projects/x/report.md')])
      view.q('before').focus()
      await userEvent.tab()
      expect(document.activeElement).toBe(copyFor(view, 'projects/x/report.md'))
      await userEvent.keyboard('{Enter}')
      await settle()
      expect(written).toHaveBeenCalledWith('projects/x/report.md')
      await userEvent.tab()
      expect(document.activeElement).toBe(controlFor(view, 'projects/x/report.md'))
      await userEvent.keyboard('{Enter}')
      await settle()
      expect(main.opens).toEqual([{ sessionId: 'sess_1', text: 'projects/x/report.md' }])
    } finally {
      written.mockRestore()
    }
  })

  it('names Open "Open file" where main opens it, and "Show in" the file manager where it only shows', async () => {
    installMain()
    const { view } = await transcript([said('Read projects/x/report.md, then run bin/go.command')])
    const opens = controlFor(view, 'projects/x/report.md')!
    expect(opens.getAttribute('aria-label')).toBe('Open file')
    expect(opens.title).toBe('Open file')
    const shows = controlFor(view, 'bin/go.command')!
    expect(shows.getAttribute('aria-label')).toBe(`Show in ${FILE_MANAGER}`)
    expect(shows.title).toBe(`Show in ${FILE_MANAGER}`)
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
    expect(control!.getAttribute('aria-label')).toBe(`Show in ${FILE_MANAGER}`)
    control!.click()
    await settle()
    expect(bridge.pathsShown).toEqual([{ sessionId: 'conv-header', text: 'projects/x/report.md' }])
  })

  it('is named Show even where main would say a file opens', async () => {
    // Planted: this window has no open call, so an `opens: true` cannot make it one.
    const { view } = await history({ paths: (ask) => ask.texts.map((text) => found(text)) })
    expect(controlFor(view, 'projects/x/report.md')!.getAttribute('aria-label')).toBe(
      `Show in ${FILE_MANAGER}`,
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
      expect(textOf(control!).textContent).toBe(path)
      expect(textOf(control!).title).toBe(path)
      expect(control!.getAttribute('data-opens')).toBe('false')
      expect(view.q('assistant-markdown').textContent).toContain('The app, version 1.2.3')
      expect(control!.getAttribute('aria-label')).toBe('Show in Explorer')
      expect(anchors(view)).toHaveLength(0)
      control!.click()
      await settle()
      expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
    })

    it('copies a drive path with its backslashes, never as %5C', async () => {
      onWindows()
      const path = 'C:\\Users\\fictional\\AppData\\Roaming\\@brobot2\\desktop\\out\\app.apk'
      installMain({ existing: [path] })
      const written = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
      try {
        const { view } = await transcript([said(link('The app', path))])
        copyFor(view, path).click()
        await settle()
        expect(written).toHaveBeenCalledWith(path)
        expect(written.mock.calls[0]![0]).not.toContain('%5C')
      } finally {
        written.mockRestore()
      }
    })

    it('keeps `\\_` and spaces in an angle-bracketed destination', async () => {
      onWindows()
      const path = 'C:\\Users\\fictional\\My Files\\a\\_b\\notes.md'
      installMain({ existing: [path] })
      const { view } = await transcript([said(link('notes', `<${path}>`))])
      expect(textFor(view, path)?.textContent).toBe(path)
      expect(textFor(view, path)?.title).toBe(path)
      expect(controlFor(view, path)?.getAttribute('aria-label')).toBe('Open file')
    })

    it('takes a forward-slash drive path the same way', async () => {
      onWindows()
      const path = 'C:/Users/fictional/out/report.md'
      const absolute = 'C:\\Users\\fictional\\out\\report.md'
      const main = installMain({ existing: [path], resolved: { [path]: absolute } })
      const { view } = await transcript([said(link('the report', path))])
      expect(textFor(view, path)?.textContent).toBe(absolute)
      expect(textFor(view, path)?.title).toBe(absolute)
      controlFor(view, path)!.click()
      await settle()
      expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
    })

    it('draws a share with Copy and a disabled Open that says why: main opens no share', async () => {
      onWindows()
      const path = '\\\\fileserver\\team\\out\\report.md'
      const main = installMain()
      const written = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
      try {
        const { view } = await transcript([said(link('the report', path))])
        expect(main.asks.flatMap((ask) => ask.texts)).not.toContain(path)
        expect(controls(view)).toHaveLength(0)
        expect(anchors(view)).toHaveLength(0)
        const share = view.q('message-path-network')
        const text = share
          .closest('.message-path')!
          .querySelector<HTMLElement>('.message-path-text')!
        expect(text.textContent).toBe(path)
        expect(text.title).toBe(path)
        expect(share.getAttribute('aria-disabled')).toBe('true')
        expect(share.title).toBe("Network paths can't be opened here.")
        share.click()
        text.click()
        await settle()
        expect(main.opens).toEqual([])
        expect(main.reveals).toEqual([])
        share
          .closest('.message-path')!
          .querySelector<HTMLButtonElement>('[data-cy="message-path-copy"]')!
          .click()
        await settle()
        expect(written).toHaveBeenCalledWith(path)
      } finally {
        written.mockRestore()
      }
    })
  })

  it('on the Mac, a rooted link opens as a path in the text does', async () => {
    onPlatform('MacIntel')
    const path = '/Users/fictional/out/report.md'
    const main = installMain({ existing: [path] })
    const { view } = await transcript([said(link('the report', path))])
    await capture(view, 'mac')
    expect(textFor(view, path)?.textContent).toBe(path)
    expect(textFor(view, path)?.title).toBe(path)
    expect(controlFor(view, path)?.getAttribute('aria-label')).toBe('Open file')
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
    expect(textOf(control).textContent).toBe(absolute)
    expect(textOf(control).title).toBe(absolute)
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
    expect(textFor(view, path)?.textContent).toBe(path)
    expect(textFor(view, path)?.title).toBe(path)
  })

  it.each(['report.md', 'notes/x.md', 'x'])(
    'resolves the explicit relative destination %s',
    async (path) => {
      const absolute = `${HERE}/${path}`
      const main = installMain({ existing: [path], resolved: { [path]: absolute } })
      const { view } = await transcript([said(link('the report', path))])
      expect(main.asks.flatMap((ask) => ask.texts)).toEqual([path])
      expect(textFor(view, path)?.textContent).toBe(absolute)
      expect(textFor(view, path)?.title).toBe(absolute)
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
    expect(view.all('message-link-text').map((one) => one.title)).toEqual(['https://example.com/a'])
    expect(anchors(view).map((a) => a.getAttribute('href'))).toEqual([
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
      expect(textOf(control!).textContent).toBe(path)
      expect(textOf(control!).title).toBe(path)
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
      expect(textFor(view, path)?.textContent).toBe(path)
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

  it('draws a link to a file as plain path text while main has not answered, never as a link', async () => {
    const path = '/tmp/report.md'
    let release!: () => void
    const main = installMain({
      existing: [path],
      held: new Promise<void>((done) => (release = done)),
    })
    const { view } = await transcript([said(`See [${path}](${path}).`)])
    expect(main.asks.flatMap((ask) => ask.texts)).toEqual([path])
    const body = view.q('assistant-markdown')
    expect(body.querySelector('a')).toBeNull()
    const pending = view.q('message-path-text')
    expect(pending.textContent).toBe(path)
    expect(pending.closest('a, button')).toBeNull()
    expect(getComputedStyle(pending).color).not.toBe(getComputedStyle(body).color)
    expect(view.all('message-path-copy')).toHaveLength(0)
    expect(controls(view)).toHaveLength(0)
    pending.click()
    await settle()
    expect(main.opens).toEqual([])
    release()
    await settle()
    expect(body.querySelector('a')).toBeNull()
    expect(textFor(view, path)?.textContent).toBe(path)
    expect(copyFor(view, path)).toBeDefined()
    controlFor(view, path)!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
  })

  it('draws a picture on this computer as its path with Copy and Open, never loading or linking it', async () => {
    const path = '/tmp/report.png'
    const main = installMain({ existing: [path] })
    const { view } = await transcript([said(`See ![screenshot](${path}).`)])
    const body = view.q('assistant-markdown')
    expect(main.asks.flatMap((ask) => ask.texts)).toEqual([path])
    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('a[href]')).toBeNull()
    expect(textFor(view, path)?.textContent).toBe(path)
    expect(textFor(view, path)?.closest('a, button')).toBeNull()
    expect(copyFor(view, path)).toBeDefined()
    expect(body.textContent?.trim()).toBe(`See screenshot ${path}.`)
    controlFor(view, path)!.click()
    await settle()
    expect(main.opens).toEqual([{ sessionId: 'sess_1', text: path }])
  })

  it('acts on where the link goes, not on what it says, and shows where it goes', async () => {
    const path = '/Users/fictional/private/keys.txt'
    const main = installMain({ existing: [path] })
    const { view } = await transcript([said(`See [report.pdf](${path} "report.pdf").`)])
    const control = controlFor(view, path)!
    expect(textOf(control).textContent).toBe(path)
    expect(textOf(control).title).toBe(path)
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

  it('does not ask main about a web link or draw a script link as one', async () => {
    const main = installMain()
    const { view } = await transcript([
      said('See [site](https://example.com/a) and [x](javascript:alert(1)).'),
    ])
    expect(controls(view)).toHaveLength(0)
    expect(main.asks.flatMap((ask) => ask.texts)).not.toContain('https://example.com/a')
    expect(anchors(view)).toHaveLength(0)
    expect(view.all('message-link-text').map((one) => one.textContent)).toEqual(['site'])
  })
})

describe('a web link in a message shows its text, then Copy and Open', () => {
  const url = 'https://docs.example.org/guide?topic=a%20b&page=2#setup'
  const anchors = (view: Mounted): HTMLAnchorElement[] => [
    ...view.q('assistant-markdown').querySelectorAll('a'),
  ]

  it('draws the text as plain text with the address on hover, Copy before Open', async () => {
    installMain()
    const { view } = await transcript([said(`Read [the guide](${url}) or ${url}.`)])
    expect(anchors(view)).toHaveLength(0)
    const texts = view.all('message-link-text')
    expect(texts).toHaveLength(2)
    expect(texts[0]!.textContent).toBe('the guide')
    expect(texts.every((one) => one.title === url)).toBe(true)
    const group = texts[0]!.closest('.message-path')!
    const buttons = [...group.querySelectorAll('button')]
    expect(buttons.map((one) => one.getAttribute('aria-label'))).toEqual(['Copy link', 'Open link'])
    expect(buttons.map((one) => one.title)).toEqual(['Copy link', 'Open link'])
  })

  it('copies the exact address, query and fragment included, and says Copied', async () => {
    installMain()
    const written = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const { view } = await transcript([said(`Read [the guide](${url}).`)])
    const copy = view.q('message-link-copy') as HTMLButtonElement
    copy.click()
    await settle()
    expect(written).toHaveBeenCalledWith(url)
    expect(copy.getAttribute('aria-label')).toBe('Copied')
  })

  it('says what to do when the clipboard refuses the copy', async () => {
    installMain()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('no'))
    const { view } = await transcript([said(`Read [the guide](${url}).`)])
    ;(view.q('message-link-copy') as HTMLButtonElement).click()
    await settle()
    expect(view.q('message-path-failure').textContent).toBe(
      "That link didn't copy. Select its text and copy it instead.",
    )
  })

  it('opens the address through the window-open route', async () => {
    installMain()
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const { view } = await transcript([said(`Read [the guide](${url}).`)])
    ;(view.q('message-link-open') as HTMLButtonElement).click()
    await settle()
    expect(opened).toHaveBeenCalledWith(url, '_blank', 'noopener')
  })

  it('leaves a web image as the link it is', async () => {
    installMain()
    const { view } = await transcript([said('![chart](https://cdn.example.org/chart.png)')])
    expect(anchors(view).map((a) => a.getAttribute('href'))).toEqual([
      'https://cdn.example.org/chart.png',
    ])
    expect(view.all('message-link-text')).toHaveLength(0)
  })
})
