import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, provide } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import AppNoticeEntry from '../../src/renderer/src/components/AppNoticeEntry.vue'
import ContinuationEntry from '../../src/renderer/src/components/ContinuationEntry.vue'
import WorkReportEntry from '../../src/renderer/src/components/WorkReportEntry.vue'
import ModelGotSwitch from '../../src/renderer/src/components/ModelGotSwitch.vue'
import {
  NOT_YET,
  READ_WHAT_THE_MODEL_GOT,
  wrappersOf,
  type InputMessage,
} from '../../src/renderer/src/lib/agent-inputs'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import type {
  WhatThisAgentWasGiven,
  WhatTheModelGot,
} from '../../src/shared/what-this-agent-was-given'
import { mount, record, unmountAll, type Mounted, openWorkReports } from './harness'
import { givenAnswer, modelGotAnswer } from './what-this-agent-was-given.fixture'

/**
 * 🔴 **F093 · "Instructions, memory and tools"** — each tab draws the one read, and a part the app does
 * not record yet says so rather than drawing nothing or a guess.
 */

afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
})

function popup(
  answer: WhatThisAgentWasGiven = givenAnswer(),
  events: TranscriptEvent[] = [],
  startLoaded = true,
): Mounted {
  ;(window as { api?: unknown }).api = {
    runtime: {
      whatThisAgentWasGiven: vi.fn(async () => answer),
    },
  }
  return mount(
    AgentInputPopup as never,
    {
      sessionId: 'sess_1',
      provider: 'claude',
      who: 'Ada',
      profile: 'designer',
      state: record(events).transcript,
      startLoaded,
    },
    { width: 1000, height: 800 },
  )
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await nextTick()
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}

async function press(m: Mounted, cy: string): Promise<void> {
  m.q(cy).click()
  await settle()
}

/** A part of the request, by its key, opened. */
async function openPart(m: Mounted, key: string): Promise<HTMLDetailsElement> {
  const part = m.host.querySelector<HTMLDetailsElement>(`[data-cy="input-part"][data-key="${key}"]`)
  if (part === null) throw new Error(`no part ${key}`)
  if (!part.open) {
    part.querySelector('summary')!.click()
    await settle()
  }
  return part
}

const labelOf = (part: Element, cy: string): string =>
  part.querySelector(`summary [data-cy="${cy}"]`)?.textContent?.trim() ?? ''

describe('F093 · the overview', () => {
  it('says which launch it describes, the provider version, and the sizes', async () => {
    const m = popup()
    await settle()
    expect(m.host.querySelector('#input-popup-title')?.textContent?.trim()).toBe(
      'Instructions, memory and tools',
    )
    expect(m.q('input-popup-who').textContent).toBe('Ada')
    expect(m.q('input-popup-version').textContent).toContain('2.1.287')
    expect(m.q('input-launch').textContent).toContain('What its last launch gave it')
    expect(m.q('input-share-words').textContent).toContain('200,000-token window')
  })

  it('says plainly when there is no launch record and this is composed now', async () => {
    const m = popup(
      givenAnswer({ launch: { recorded: false, why: 'before-this-build', running: false } }),
    )
    await settle()
    expect(m.q('input-launch').textContent).toContain('composed now')
  })

  it('says why, where the window size is not known', async () => {
    const answer = givenAnswer()
    const m = popup({
      ...answer,
      size: {
        ...answer.size,
        contextWindow: null,
        contextWindowWhy: 'Claude has not reported its window yet.',
      },
    })
    await settle()
    expect(m.q('input-share-words').textContent).toContain('has not reported its window')
  })
})

describe('F093 · instructions', () => {
  it('shows BroBot’s file by section, with who wrote its own instructions and when', async () => {
    const m = popup()
    await settle()
    await press(m, 'input-tab-1')
    const file = await openPart(
      m,
      'file:/Users/someone/provider-homes/designer/brobot-instructions.md',
    )
    expect(labelOf(file, 'input-part-author')).toBe('BroCrew')
    expect(labelOf(file, 'input-part-trust')).toBe('Recorded at launch')
    const how = file.querySelectorAll('[data-cy="input-section-how"]')
    expect(how[2]!.textContent).toBe('The agent’s own instructions')
    expect(file.querySelector('[data-cy="input-section-author"]')!.textContent).toContain(
      'Version 3: you wrote this',
    )
    await press(m, 'input-tab-0')
    expect(m.q('input-own-used').textContent).toContain('version 3')
  })

  it('marks a repository file that changed since the agent got it', async () => {
    const m = popup()
    await settle()
    await press(m, 'input-tab-1')
    const file = await openPart(m, 'file:/Users/someone/work/bakery/CONTRIBUTING.md')
    expect(labelOf(file, 'input-part-author')).toBe('Repository')
    expect(labelOf(file, 'input-part-trust')).toBe('Read now')
    expect(m.q('input-file-changed').textContent).toContain('changed since the agent got it')
    expect(file.textContent).toContain('Run the tests')
  })
})

describe('F093 · memory', () => {
  it('lists what its launch saw, by name and size', async () => {
    const m = popup()
    await settle()
    expect(m.q('input-memory-at-launch').textContent).toContain('MEMORY.md')
  })
})

describe('F093 · tools and the provider', () => {
  it('shows each tool in full with its arguments, and how the provider hands them over', async () => {
    const m = popup()
    await settle()
    await press(m, 'input-tab-2')
    const tools = await openPart(m, 'brobot-tools')
    expect(labelOf(tools, 'input-part-title')).toBe('BroCrew tools available to load')
    await openPart(m, 'servers')
    expect(m.q('input-tools-deferral').textContent).toContain('only their names')
    expect(m.q('input-tool').textContent).toContain('self-contained brief')
    expect(m.q('input-tool').textContent).toContain('Who gets it')
    expect(m.q('input-tools-server').textContent).toContain('search_emails')
  })

  it('shows the provider’s own parts from the snapshot this build carries', async () => {
    const m = popup()
    await settle()
    expect(m.q('input-provider-version').textContent).toContain('as of Claude Code 2.1.287')
    expect(m.q('input-copy-notice').textContent).toContain('stored copy from Claude 2.1.287')
    await press(m, 'input-tab-1')
    const prompt = await openPart(m, 'part:claude.prompt')
    expect(labelOf(prompt, 'input-part-author')).toBe('Provider')
    expect(labelOf(prompt, 'input-part-trust')).toBe('Provider copy · 2.1.287')
    // ⚑ W4.186 · a part that differs by agent says so; one that doesn't says nothing.
    expect(prompt.querySelectorAll('[data-cy="input-provider-varies"]')).toHaveLength(0)
    await press(m, 'input-tab-2')
    expect(m.q('input-provider-varies').textContent).toContain(
      'Differs from one agent to another: which built-in tools',
    )
  })

  it('says why, where this build has no snapshot for its model', async () => {
    const answer = givenAnswer()
    const m = popup({
      ...answer,
      providerParts: {
        ...answer.providerParts,
        snapshot: null,
        why: 'This build has no snapshot of claude-haiku with Claude Code 2.1.287.',
      },
    })
    await settle()
    expect(m.q('input-provider-why').textContent).toContain('no snapshot')
    await press(m, 'input-tab-1')
    expect(m.q('input-provider-prompt').textContent).toContain(NOT_YET.toLowerCase())
  })
})

describe('F093 · with each message', () => {
  it('shows the whole text a turn handed the provider', async () => {
    const m = popup(givenAnswer(), [
      {
        type: 'user_turn',
        text: 'Ship it.',
        relayedFrom: 'sess_pm',
        relayedFromProfile: 'pm',
        sent: 'From Pat (pm):\nShip it.',
      } as unknown as TranscriptEvent,
    ])
    await settle()
    await press(m, 'input-tab-3')
    expect(m.all('what-the-model-got')).toHaveLength(0)
    const [message] = m
      .all('input-part')
      .filter((one) => one.getAttribute('data-key')?.startsWith('message:'))
    expect(labelOf(message!, 'input-part-author')).toBe('Sending agent')
    expect(labelOf(message!, 'input-part-trust')).toBe('Recorded with message')
    message!.querySelector('summary')!.click()
    await settle()
    expect(m.q('what-the-model-got-sent').textContent).toBe('From Pat (pm):\nShip it.')
  })

  it('says a turn from before the whole text was kept is not recorded', async () => {
    const m = mount(
      ModelGotSwitch as never,
      { words: 'Look at this.', attached: ['/work/a.png'] },
      { width: 600 },
    )
    expect(m.all('what-the-model-got')).toHaveLength(0)
    expect(m.q('model-got-switch').textContent?.trim()).toBe('Show what was sent to the AI')
    await press(m, 'model-got-switch')
    expect(m.q('model-got-switch').textContent?.trim()).toBe('Hide what was sent to the AI')
    expect(m.q('what-the-model-got-words').textContent).toBe('Look at this.')
    expect(m.q('what-the-model-got-attached').textContent).toContain('/work/a.png')
    expect(m.q('what-the-model-got-lines').textContent).toContain(NOT_YET)
  })
})

describe('F144 · every row the model received opens with what the model got', () => {
  /** An app notice, a child's reply and the go-ahead's fallback, each with the text it was sent in. */
  const ROWS = [
    {
      type: 'user_turn',
      text: 'A person answered the question.',
      attribution: 'app_authored',
      appNotice: 'an-answer-to-a-question',
      sent: 'This app says:\nA person answered the question.',
    },
    {
      type: 'user_turn',
      text: 'Done: the menu reads well.',
      attribution: 'app_authored',
      relayedFrom: 'sess_ayo',
      relayedFromProfile: 'ayo',
      work: { piece: 'work_1', label: 'W1.1', state: 'answered', outcome: 'done' },
      sent: 'W1.1 answered by Ayo:\nDone: the menu reads well.',
    },
    {
      type: 'user_turn',
      text: 'Go ahead with the plan.',
      attribution: 'app_authored',
      sent: 'Go ahead with the plan.\n(sent with the closing block)',
    },
  ] as unknown as TranscriptEvent[]

  it('🔴 each is listed in delivery order, and opens to the whole text it was sent in', async () => {
    const m = popup(givenAnswer(), ROWS)
    await settle()
    const messages = (): HTMLElement[] =>
      m.all('input-part').filter((one) => one.getAttribute('data-key')?.startsWith('message:'))
    await press(m, 'input-tab-3')
    const first = messages()
    await press(m, 'input-tab-4')
    const later = messages()
    expect([...first, ...later].map((one) => labelOf(one, 'input-part-title'))).toEqual([
      'This app',
      'Another agent or this app',
      'This app, so the agent carries on',
    ])
    expect([...first, ...later].map((one) => labelOf(one, 'input-part-author'))).toEqual([
      'BroCrew',
      'Sending agent',
      'BroCrew',
    ])
    await press(m, 'input-tab-3')
    const [opening] = messages()
    opening!.querySelector('summary')!.click()
    await settle()
    expect(opening!.querySelector('[data-cy="what-the-model-got-sent"]')!.textContent).toBe(
      (ROWS[0] as unknown as { sent: string }).sent,
    )
    await press(m, 'input-tab-4')
    for (const [index, one] of messages().entries()) {
      one.querySelector('summary')!.click()
      await settle()
      const sent = (ROWS[index + 1] as unknown as { sent: string }).sent
      expect(one.querySelector('[data-cy="what-the-model-got-sent"]')!.textContent).toBe(sent)
    }
    // ⛔ A window that has not loaded the conversation's start does not call its first loaded
    // message the first: it says so, and every loaded message is a later one.
    unmountAll()
    const partial = popup(givenAnswer(), ROWS, false)
    await settle()
    await press(partial, 'input-tab-3')
    expect(partial.q('input-boundary').textContent?.trim()).toBe('First message not loaded.')
    await press(partial, 'input-tab-4')
    expect(
      partial
        .all('input-part')
        .filter((one) => one.getAttribute('data-key')?.startsWith('message:')),
    ).toHaveLength(3)
  })

  it('🔴 the words around them count in the totals', async () => {
    const m = popup(givenAnswer(), ROWS)
    await settle()
    const around = ROWS.reduce((sum, row) => {
      const one = row as unknown as { sent: string; text: string }
      return sum + one.sent.length - one.text.length
    }, 0)
    expect(m.q('input-total-wrappers').textContent).toContain(`≈${Math.round(around / 4)}`)
    expect(m.q('input-total-wrappers').textContent).toContain('This app’s words in messages')
  })

  it('🔴 the switch sits under an app notice, a reply and the go-ahead in the conversation', async () => {
    const item = { at: 1, ordinal: 4, sent: 'This app says:\nIt was taken back.' }
    const notice = mount(
      AppNoticeEntry as never,
      {
        item: {
          ...item,
          kind: 'appNotice',
          id: 'n1',
          text: 'It was taken back.',
          notice: 'a-take-back',
        },
      },
      { width: 700 },
    )
    await press(notice, 'model-got-switch')
    expect(notice.q('what-the-model-got-sent').textContent).toBe(item.sent)
    unmountAll()

    const goAhead = mount(
      ContinuationEntry as never,
      { item: { at: 1, kind: 'continuation', id: 'c1', text: 'Go ahead.' } },
      { width: 700 },
    )
    await press(goAhead, 'model-got-switch')
    // With no turn text kept, the go-ahead's own words are what went.
    expect(goAhead.q('what-the-model-got-sent').textContent).toBe('Go ahead.')
    unmountAll()

    const reply = mount(
      WorkReportEntry as never,
      {
        item: {
          at: 1,
          ordinal: 7,
          kind: 'workReport',
          id: 'w1',
          text: 'Done.',
          sent: 'W1.1 answered:\nDone.',
          report: { piece: 'work_1', label: 'W1.1', state: 'answered', outcome: 'done' },
        },
        ownAgent: 'BroBot',
      },
      { width: 700 },
    )
    await openWorkReports(reply)
    await press(reply, 'model-got-switch')
    expect(reply.q('what-the-model-got-sent').textContent).toBe('W1.1 answered:\nDone.')
  })
})

describe('F144 · the words around messages are counted once per turn', () => {
  const message = (over: Partial<InputMessage>): InputMessage => ({
    itemId: 'i',
    words: 'x',
    sent: 'fx',
    together: false,
    why: undefined,
    attached: [],
    from: 'A person',
    author: 'Person',
    ordinal: undefined,
    goAhead: false,
    ...over,
  })

  it('🔴 two identical turns each count their own words', () => {
    expect(
      wrappersOf([message({ itemId: 'a', ordinal: 1 }), message({ itemId: 'b', ordinal: 2 })]),
    ).toBe(2)
  })

  it('🔴 one turn of two messages counts its words once', () => {
    const sent = 'From two:\nx\ny'
    expect(
      wrappersOf([
        message({ itemId: 'a', ordinal: 3, words: 'x', sent, together: true }),
        message({ itemId: 'b', ordinal: 3, words: 'y', sent, together: true }),
      ]),
    ).toBe(sent.length - 2)
  })

  it('⛔ with no ordinal: alone is its own turn; handed over with others is left out', () => {
    expect(wrappersOf([message({ itemId: 'a' }), message({ itemId: 'b' })])).toBe(2)
    expect(wrappersOf([message({ itemId: 'a', together: true })])).toBe(0)
  })
})

describe('F144 · the tools’ namespace line', () => {
  it('🔴 shown at the head of BroBot’s tools, as sent with them, where the provider was handed one', async () => {
    const answer = givenAnswer()
    const line = 'Tools that reach the app you are running inside.'
    const m = popup({
      ...answer,
      tools: {
        ...answer.tools,
        namespace: {
          text: line,
          textIs: 'as-launched',
          size: { characters: 48, words: 9, tokens: 12 },
        },
      },
    })
    await settle()
    await press(m, 'input-tab-2')
    await openPart(m, 'brobot-tools')
    const said = m.q('input-tools-namespace')
    expect(said.textContent).toBe(line)
    // The sentence sits on its own line, under who wrote it and that the launch recorded it.
    const about = said.previousElementSibling as HTMLElement
    expect(about.textContent).toContain('Recorded at launch')
    expect(said.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      about.getBoundingClientRect().bottom,
    )
  })

  it('🔴 this build’s words, not the launch’s, are said to be so, even on a recorded launch', async () => {
    const answer = givenAnswer()
    const m = popup({
      ...answer,
      tools: {
        ...answer.tools,
        namespace: {
          text: 'Tools that reach the app you are running inside.',
          textIs: 'composed-now',
          size: { characters: 48, words: 9, tokens: 12 },
        },
      },
    })
    await settle()
    expect(answer.launch.recorded).toBe(true)
    await press(m, 'input-tab-2')
    await openPart(m, 'brobot-tools')
    const about = m.q('input-tools-namespace').previousElementSibling as HTMLElement
    expect(about.textContent).toContain('This build')
    expect(about.textContent).not.toContain('Recorded at launch')
  })

  it('⛔ absent where none was sent', async () => {
    const m = popup()
    await settle()
    await press(m, 'input-tab-2')
    await openPart(m, 'brobot-tools')
    expect(m.all('input-tools-namespace')).toHaveLength(0)
  })
})

describe('F093 · when the read fails', () => {
  it('says what to do', async () => {
    ;(window as { api?: unknown }).api = {
      runtime: { whatThisAgentWasGiven: vi.fn(async () => Promise.reject(new Error('gone'))) },
    }
    const m = mount(
      AgentInputPopup as never,
      {
        sessionId: 'sess_1',
        provider: 'claude',
        who: 'Ada',
        profile: null,
        state: null,
        startLoaded: true,
      },
      { width: 1000, height: 800 },
    )
    await settle()
    expect(m.q('input-popup-why').textContent).toContain('Try Read again')
  })
})

describe('F093 · a whole turn as the model got it', () => {
  function switchWith(read: (ordinal: number) => Promise<WhatTheModelGot>): Mounted {
    const Host = defineComponent({
      setup() {
        provide(READ_WHAT_THE_MODEL_GOT, read)
        return () => h(ModelGotSwitch, { words: 'Make the header warmer.', ordinal: 42 })
      },
    })
    return mount(Host as never, {}, { width: 700 })
  }

  it('reads it by the message’s ordinal and draws BroBot’s parts and the provider’s record', async () => {
    const read = vi.fn(async () => modelGotAnswer())
    const m = switchWith(read)
    await press(m, 'model-got-switch')
    expect(read).toHaveBeenCalledWith(42)
    expect(m.all('what-the-model-got-part')).toHaveLength(3)
    expect(m.all('what-the-model-got-part')[1]!.textContent).toContain('Kept by fingerprint only')
    expect(m.q('what-the-model-got-record').textContent).toContain('same text BroCrew handed over')
    expect(m.all('what-the-model-got-record-part')[0]!.textContent).toContain(
      'Added by the provider',
    )
  })

  it('🔴 says what the provider’s record leaves out, in its own name', async () => {
    const answer = modelGotAnswer()
    const m = switchWith(async () => answer)
    await press(m, 'model-got-switch')
    expect(m.q('what-the-model-got-record-leaves-out').textContent?.trim()).toBe(
      'Claude’s record: no system prompt, first answer only.',
    )
    unmountAll()
    const found = answer.providersRecord as Extract<typeof answer.providersRecord, { found: true }>
    const codex = switchWith(async () =>
      modelGotAnswer({
        providersRecord: { ...found, provider: 'codex', leavesOut: ['after-its-first-answer'] },
      }),
    )
    await press(codex, 'model-got-switch')
    expect(codex.q('what-the-model-got-record-leaves-out').textContent?.trim()).toBe(
      'Codex’s record: first answer only.',
    )
  })

  it('says why, where the provider’s record could not be read', async () => {
    const m = switchWith(async () =>
      modelGotAnswer({
        providersRecord: { found: false, why: 'Claude Code’s file for it is gone.' },
      }),
    )
    await press(m, 'model-got-switch')
    expect(m.q('what-the-model-got-record-why').textContent).toContain('file for it is gone')
  })

  it('falls back to what the message keeps, and says so, when the read fails', async () => {
    const m = switchWith(async () => Promise.reject(new Error('refused')))
    await press(m, 'model-got-switch')
    expect(m.q('what-the-model-got-why').textContent).toContain('Couldn’t read the whole turn')
    expect(m.q('what-the-model-got-words').textContent).toBe('Make the header warmer.')
  })
})

describe('F093 · the review’s must-fixes', () => {
  it('says the total counts only the tool names where the provider loads them on request', async () => {
    const m = popup()
    await settle()
    expect(m.q('input-total-tools-note').textContent).toContain('Their names only')
    // ⚑ W4.184 · and the other servers' tools have a card of their own, as the total counts them.
    expect(m.q('input-total-other-tools').textContent).toContain('Other servers’ tools')
  })

  it('offers a part’s whole text beside its tools, in the tab where the part sits', async () => {
    const m = popup()
    await settle()
    expect(m.q('input-provider-shape').textContent).toContain('Sent as messages')
    await press(m, 'input-tab-2')
    const tools = await openPart(m, 'part:claude.tools')
    expect(labelOf(tools, 'input-part-title')).toBe('Its built-in tools')
    expect(m.q('input-part-whole').textContent).toContain('"name":"Read"')
  })

  it('does not say a provider record part’s role twice', async () => {
    const Host = defineComponent({
      setup() {
        provide(READ_WHAT_THE_MODEL_GOT, async () => modelGotAnswer())
        return () => h(ModelGotSwitch, { words: 'Make the header warmer.', ordinal: 42 })
      },
    })
    const m = mount(Host as never, {}, { width: 700 })
    await press(m, 'model-got-switch')
    const message = m.all('what-the-model-got-record-part')[1]!
    expect(message.querySelector('.part-title')!.textContent!.trim()).toBe('The message')
  })
})

describe('F100 · a long list of rows in the popup keeps each row whole', () => {
  // Fill the popup beyond its height in both tests. A scrolling grid’s minimum height is
  // zero, which can squeeze `bb-disclosure` rows and prevent expansion; a short fixture would
  // miss that defect.
  const many = (): WhatThisAgentWasGiven => {
    const answer = givenAnswer()
    const tool = answer.tools.list[0]!
    const shot = answer.providerParts.snapshot!
    const part = shot.parts[0]!
    return {
      ...answer,
      tools: {
        ...answer.tools,
        list: Array.from({ length: 60 }, (_, at) => ({ ...tool, name: `tool_${at + 1}` })),
      },
      providerParts: {
        ...answer.providerParts,
        snapshot: {
          ...shot,
          parts: Array.from({ length: 8 }, (_, at) => ({
            ...part,
            id: `claude.part-${at}`,
            title: `Part ${at + 1}: a title long enough to take two lines in a narrow popup`,
            text: `The text of part ${at + 1}.`,
          })),
        },
      },
    }
  }

  it('every tool row shows its name, at a readable height', async () => {
    // Use a laptop-height window so the popup reaches its height limit.
    await page.viewport(1000, 700)
    const m = popup(many())
    await settle()
    await press(m, 'input-tab-2')
    await openPart(m, 'brobot-tools')
    const rows = m.all('input-tool')
    expect(rows).toHaveLength(60)
    for (const [at, row] of rows.entries()) {
      const name = row.querySelector<HTMLElement>('summary .bb-mono')!
      expect(name.textContent).toBe(`tool_${at + 1}`)
      expect(row.querySelector('summary')!.getBoundingClientRect().height).toBeGreaterThan(20)
      expect(name.getBoundingClientRect().height).toBeGreaterThan(8)
    }
  })

  it('a provider part opens on a press and shows its text', async () => {
    const m = popup(many())
    await settle()
    await press(m, 'input-tab-1')
    const parts = m.all('input-part')
    expect(parts).toHaveLength(8 + 2)
    const third = parts[2] as HTMLDetailsElement
    third.querySelector('summary')!.click()
    await settle()
    expect(third.open).toBe(true)
    const text = third.querySelector<HTMLElement>('pre')!
    expect(text.textContent).toBe('The text of part 3.')
    expect(text.getBoundingClientRect().height).toBeGreaterThan(8)
    expect(third.getBoundingClientRect().height).toBeGreaterThan(
      third.querySelector('summary')!.getBoundingClientRect().height,
    )
  })
})

describe('F144 · the approved labels', () => {
  it('🔴 the tools tab says it lists this build’s tools', async () => {
    const m = popup()
    await settle()
    await press(m, 'input-tab-2')
    const tools = await openPart(m, 'brobot-tools')
    expect(labelOf(tools, 'input-part-trust')).toBe('This build')
  })

  it('🔴 a go-ahead that went out with the closing block says so; one sent as written says that', async () => {
    const closing = mount(
      ModelGotSwitch as never,
      { words: 'Go ahead.', sent: 'Go ahead.\n(the closing block)', goAhead: true },
      { width: 600 },
    )
    await press(closing, 'model-got-switch')
    expect(closing.q('what-the-model-got-closing-block').textContent?.trim()).toBe(
      'Sent with the closing block.',
    )
    expect(closing.all('what-the-model-got-as-typed')).toHaveLength(0)
    unmountAll()
    const plain = mount(
      ModelGotSwitch as never,
      { words: 'Go ahead.', sent: 'Go ahead.', goAhead: true },
      { width: 600 },
    )
    await press(plain, 'model-got-switch')
    expect(plain.all('what-the-model-got-closing-block')).toHaveLength(0)
    expect(plain.all('what-the-model-got-as-typed')).toHaveLength(1)
  })

  it('⛔ a person’s message whose turn added lines is not called the closing block', async () => {
    const m = mount(
      ModelGotSwitch as never,
      { words: 'Ship it.', sent: 'From Pat:\nShip it.' },
      { width: 600 },
    )
    await press(m, 'model-got-switch')
    expect(m.all('what-the-model-got-closing-block')).toHaveLength(0)
  })
})
