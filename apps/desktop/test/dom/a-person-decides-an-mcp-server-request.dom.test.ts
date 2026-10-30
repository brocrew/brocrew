import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import McpServerRequests from '../../src/renderer/src/components/McpServerRequests.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import ToolsRegister from '../../src/renderer/src/components/ToolsRegister.vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import type {
  AgentIdentities,
  McpServerRequestForAPerson,
  RuntimeBridge,
  AnswerAck,
} from '../../src/shared/runtime-ipc'
import { EXTERNAL_MCP_EVERYONE_MEANS } from '../../src/shared/external-mcp'
import { mount, unmountAll } from './harness'

const REACHES = 'Read fictional notes. <a href="https://fictional.example">Not a link</a>'
const URL = 'http://127.0.0.1:8765/mcp/a/very/long/fictional/path?note=sample&all=true'
const REQUEST: McpServerRequestForAPerson = {
  conversation: 'fictional-writer',
  at: 100,
  askerCalled: 'Fictional note writer',
  requested: {
    type: 'mcp_server_requested',
    requestId: 'fictional-request',
    name: 'fictional-notes',
    url: URL,
    reaches: REACHES,
    whoGetsIt: 'everyone',
    requestedBy: 'writer',
  },
}
const REGISTER: AgentIdentities = {
  identities: [],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}
const pressed = vi.fn<(input: { requestId: string; approve: boolean }) => Promise<AnswerAck>>(
  async () => ({ outcome: 'refused', reason: 'Fictional retry.', stillOpen: true }),
)

function supply(rows: readonly McpServerRequestForAPerson[] | null, lastLookAnswered = true) {
  usePersonsQueue().supply(
    { rows: [], walk: 'every-conversation-that-routed', ledgers: 0, rowsUnread: 0 },
    { rows: [], walk: 'every-conversation-that-routed', ledgers: 0, rowsUnread: 0 },
    {
      held: new Set(),
      answerable: new Map(),
      answeredFromHere: new Set(),
      now: 1000,
      lastLookAnswered: { questions: true, decisions: true },
    },
    {
      travel() {},
      settle() {},
      takeOver() {},
      open() {},
      async decideMcpServerRequest(requestId, approve) {
        return await pressed(structuredClone({ requestId, approve }))
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    {
      walked: rows,
      lastLookAnswered,
      nameOf: (name) => (name === 'writer' ? 'Fictional Writer' : name),
    },
  )
}

beforeEach(() => {
  usePersonsQueue().forget()
  pressed.mockClear()
  supply([REQUEST])
})
afterEach(() => {
  unmountAll()
  usePersonsQueue().forget()
})

describe('the person’s MCP server card', () => {
  it('shows the full address, labelled plain-text reach and everyone’s permission sentence', async () => {
    const m = mount(McpServerRequests, {}, { width: 420, height: 650 })
    await nextTick()
    expect(m.host.querySelector('code')?.textContent).toBe(URL)
    expect(m.host.textContent).toContain('Fictional Writer asks you to add an MCP server')
    expect(m.host.textContent).toContain(`It says this server can: “${REACHES}”`)
    expect(m.host.querySelector('a')).toBeNull()
    expect(m.host.textContent).toContain(`Who gets it: every agent. ${EXTERNAL_MCP_EVERYONE_MEANS}`)
    expect(m.host.textContent).not.toContain('BroCrew has not contacted this address yet.')
    expect(m.host.textContent).toContain(
      'unless that would stop its background work or end its planning',
    )
  })

  it('preserves the canonical punycode host and full path from a fictional ledger row', async () => {
    const canonical = new globalThis.URL('http://BÜCHER.EXAMPLE:8765/mcp?note=fictional').href
    supply([{ ...REQUEST, requested: { ...REQUEST.requested, url: canonical } }])
    const m = mount(McpServerRequests, {})
    await nextTick()
    expect(m.host.querySelector('code')?.textContent).toBe(
      'http://xn--bcher-kva.example:8765/mcp?note=fictional',
    )
    // This renderer fixture measures display only; it does not admit a non-loopback server.
    expect(pressed).not.toHaveBeenCalled()
  })

  it('names only the approved agents without the everyone sentence or an asker reopen claim', async () => {
    supply([
      {
        ...REQUEST,
        requested: { ...REQUEST.requested, whoGetsIt: 'only-these-agents', agents: ['editor'] },
      },
    ])
    const m = mount(McpServerRequests, {})
    await nextTick()
    expect(m.host.textContent).toContain('Who gets it: only editor.')
    expect(m.host.textContent).not.toContain(EXTERNAL_MCP_EVERYONE_MEANS)
    expect(m.host.textContent).not.toContain('reopens Fictional note writer')
  })

  it.each([
    ['approve', true],
    ['refuse', false],
  ] as const)('the %s button carries only the id and the decision', async (verb, approve) => {
    const m = mount(McpServerRequests, {})
    await nextTick()
    m.host
      .querySelector<HTMLButtonElement>(
        `[data-cy="waiting-server-request-${verb}-fictional-request"]`,
      )!
      .click()
    await nextTick()
    expect(pressed).toHaveBeenCalledExactlyOnceWith({ requestId: 'fictional-request', approve })
    expect(Object.keys(pressed.mock.calls[0]![0]).sort()).toEqual(['approve', 'requestId'])
  })

  it.each([
    `The server at ${URL} refused the MCP check (HTTP 500). Nothing was registered.`,
    `Couldn't read the server's MCP reply at ${URL}. Nothing was registered.`,
  ])('the approval card draws the safe host refusal: %s', async (reason) => {
    pressed.mockResolvedValueOnce({ outcome: 'refused', reason, stillOpen: true })
    const page = mount(McpServerRequests, {})
    await nextTick()
    page.q('waiting-server-request-approve-fictional-request').click()
    await expect
      .poll(() => page.all('waiting-server-request-pressed-fictional-request').length)
      .toBe(1)
    const words = page.q('waiting-server-request-pressed-fictional-request')
    expect(words.textContent).toBe(reason)
    expect(getComputedStyle(words).display).not.toBe('none')
    expect(page.host.textContent).not.toContain(
      'fictional internal detail must not reach the window',
    )
    expect(page.all('waiting-server-request-settled-fictional-request')).toHaveLength(0)
    expect(
      (page.q('waiting-server-request-approve-fictional-request') as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('disables both presses while one decision is pending and permits a retry when it settles', async () => {
    let release!: () => void
    pressed.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { outcome: 'refused', reason: 'Fictional retry.', stillOpen: true }
    })
    const m = mount(McpServerRequests, {})
    await nextTick()
    const buttons = [...m.host.querySelectorAll<HTMLButtonElement>('button')]
    buttons[0]!.click()
    buttons[0]!.click()
    buttons[1]!.click()
    await nextTick()
    expect(pressed).toHaveBeenCalledTimes(1)
    expect(buttons.every((button) => button.disabled)).toBe(true)
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    expect(buttons.every((button) => !button.disabled)).toBe(true)
    buttons[1]!.click()
    await nextTick()
    expect(pressed).toHaveBeenLastCalledWith({ requestId: 'fictional-request', approve: false })
  })

  it('never claims a contact history on the request card', async () => {
    supply([REQUEST])
    const m = mount(McpServerRequests, {})
    await nextTick()
    expect(m.host.textContent).not.toContain('BroCrew has not contacted this address yet.')
    expect(m.host.querySelector('code')?.textContent).toBe(URL)
    expect(m.host.querySelectorAll('button')).toHaveLength(2)
  })

  it('the Tools request band disappears after the last request is settled', async () => {
    const bridge = { agentIdentities: async () => REGISTER } satisfies Pick<
      RuntimeBridge,
      'agentIdentities'
    >
    const store = createAgentStore(bridge as RuntimeBridge)
    await store.load()
    const m = mount(ToolsRegister, { store }, { width: 900, height: 900 })
    await nextTick()
    expect(m.host.querySelector('[data-cy="tools-asked-for"]')?.textContent).toContain(
      'Asked for by agents',
    )
    expect(m.host.querySelector('[data-cy="tools-server-requests"]')).not.toBeNull()
    supply([])
    await nextTick()
    expect(m.host.querySelector('[data-cy="tools-asked-for"]')).toBeNull()
    expect(m.host.textContent).toContain('Registered servers')
  })

  it('the Waiting on you request group disappears when empty', async () => {
    const m = mount(WaitingOnYou, { needsYou: [], clock: 1000, agents: REGISTER })
    await nextTick()
    expect(m.host.querySelector('[data-cy="server-requests-count"]')?.textContent).toBe('1')
    expect(m.host.querySelector('[data-cy="waiting-server-requests"]')).not.toBeNull()
    supply([])
    await nextTick()
    expect(m.host.querySelector('[data-cy="server-requests-count"]')).toBeNull()
    expect(m.host.querySelector('[data-cy="waiting-server-requests"]')).toBeNull()
  })

  it('the corner copy shows the same complete request and sends its own decision', async () => {
    const m = mount(PersonsQueue, { floating: true }, { width: 420, height: 800 })
    await nextTick()
    m.q('persons-queue-toggle').click()
    await nextTick()
    expect(m.host.querySelector('[data-cy="persons-queue-server-requests"]')).not.toBeNull()
    expect(m.host.querySelector('.request-url')?.textContent).toBe(URL)
    expect(m.host.textContent).toContain(EXTERNAL_MCP_EVERYONE_MEANS)
    m.host
      .querySelector<HTMLButtonElement>(
        '[data-cy="persons-queue-server-request-refuse-fictional-request"]',
      )!
      .click()
    await nextTick()
    expect(pressed).toHaveBeenCalledExactlyOnceWith({
      requestId: 'fictional-request',
      approve: false,
    })
    supply([])
    await nextTick()
    expect(m.host.querySelector('[data-cy="persons-queue-server-requests"]')).toBeNull()
  })
  it.each([
    'Registered. It offers: read_notes, search_notes.',
    'Registered. It offers: no tools.',
    'Refused. Nothing was registered.',
  ])(
    'keeps the settled outcome %s on page and corner without actions or counts',
    async (reason) => {
      const page = mount(WaitingOnYou, { needsYou: [], clock: 1000, agents: REGISTER })
      const corner = mount(PersonsQueue, { floating: true })
      pressed.mockResolvedValueOnce({ outcome: 'taken', reason })
      await nextTick()
      corner.q('persons-queue-toggle').click()
      await nextTick()
      page.q('waiting-server-request-approve-fictional-request').click()
      await expect
        .poll(() => page.all('waiting-server-request-settled-fictional-request').length)
        .toBe(1)
      expect(page.q('waiting-server-request-settled-fictional-request').textContent).toBe(reason)
      expect(corner.q('persons-queue-server-request-settled-fictional-request').textContent).toBe(
        reason,
      )
      expect(page.all('waiting-server-request-approve-fictional-request')).toHaveLength(0)
      expect(corner.all('persons-queue-server-request-refuse-fictional-request')).toHaveLength(0)
      expect(page.q('server-requests-count').textContent).toBe('0')
      expect(corner.all('persons-queue-count')).toHaveLength(0)
      supply([])
      await nextTick()
      expect(page.q('waiting-server-request-settled-fictional-request').textContent).toBe(reason)
      corner.q('persons-queue-server-request-dismiss-fictional-request').click()
      await nextTick()
      expect(page.all('waiting-server-requests')).toHaveLength(0)
      expect(corner.all('persons-queue-server-requests')).toHaveLength(0)
    },
  )

  it('the Tools band keeps a settled result with zero waiting count, then Dismiss hides the band', async () => {
    const bridge = { agentIdentities: async () => REGISTER } satisfies Pick<
      RuntimeBridge,
      'agentIdentities'
    >
    const store = createAgentStore(bridge as RuntimeBridge)
    await store.load()
    const m = mount(ToolsRegister, { store })
    await nextTick()
    pressed.mockResolvedValueOnce({
      outcome: 'taken',
      reason: 'Registered. It offers: read_notes.',
    })
    m.q('tools-server-request-approve-fictional-request').click()
    await expect.poll(() => m.all('tools-server-request-settled-fictional-request').length).toBe(1)
    expect(m.q('tools-server-request-settled-fictional-request').textContent).toBe(
      'Registered. It offers: read_notes.',
    )
    expect(m.q('tools-asked-for-count').textContent).toBe('0')
    supply([])
    await nextTick()
    m.q('tools-server-request-dismiss-fictional-request').click()
    await nextTick()
    expect(m.all('tools-asked-for')).toHaveLength(0)
  })

  it('one shared in-flight guard disables simultaneous page and corner copies', async () => {
    let release!: () => void
    pressed.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return {
        outcome: 'refused',
        reason: 'Start the fictional server and approve again.',
        stillOpen: true,
      }
    })
    const page = mount(McpServerRequests, {})
    const corner = mount(McpServerRequests, { floating: true })
    await nextTick()
    page.q('waiting-server-request-approve-fictional-request').click()
    corner.q('persons-queue-server-request-refuse-fictional-request').click()
    await nextTick()
    expect(pressed).toHaveBeenCalledTimes(1)
    expect(
      [
        ...page.host.querySelectorAll<HTMLButtonElement>('button'),
        ...corner.host.querySelectorAll<HTMLButtonElement>('button'),
      ].every((one) => one.disabled),
    ).toBe(true)
    release()
    await expect
      .poll(() => page.all('waiting-server-request-pressed-fictional-request').length)
      .toBe(1)
    expect(page.q('waiting-server-request-pressed-fictional-request').textContent).toBe(
      'Start the fictional server and approve again.',
    )
    expect(corner.q('persons-queue-server-request-pressed-fictional-request').textContent).toBe(
      'Start the fictional server and approve again.',
    )
    expect(page.all('waiting-server-request-settled-fictional-request')).toHaveLength(0)
    expect(
      [...page.host.querySelectorAll<HTMLButtonElement>('button')].every((one) => !one.disabled),
    ).toBe(true)
  })

  it('keeps only the newest ten settled outcomes, in newest-first order', async () => {
    const m = mount(McpServerRequests, {})
    for (let n = 0; n < 12; n++) {
      const id = `fictional-${n}`
      supply([{ ...REQUEST, requested: { ...REQUEST.requested, requestId: id } }])
      await nextTick()
      pressed.mockResolvedValueOnce({ outcome: 'taken', reason: `Refused fictional request ${n}.` })
      m.q(`waiting-server-request-refuse-${id}`).click()
      await expect
        .poll(() => usePersonsQueue().serverRequestsSettled.value[0]?.row.requestId)
        .toBe(id)
    }
    supply([])
    await nextTick()
    const outcomes = [
      ...m.host.querySelectorAll('[data-cy^="waiting-server-request-settled-"]'),
    ].map((one) => one.textContent)
    expect(outcomes).toEqual(
      Array.from({ length: 10 }, (_, n) => `Refused fictional request ${11 - n}.`),
    )
    expect(m.host.querySelectorAll('[data-cy^="waiting-server-request-approve-"]')).toHaveLength(0)
  })

  it('a failed first read says requests may be missing rather than asserting an empty list', async () => {
    supply(null, false)
    const m = mount(McpServerRequests, {})
    await nextTick()
    expect(m.q('waiting-server-requests-unread').textContent?.trim()).toBe(
      'The requests to add MCP servers could not be read just now, so one may be missing.',
    )
    expect(m.all('waiting-server-requests')).toHaveLength(0)
  })

  it('a stale read retains the last request and says that another may be missing', async () => {
    supply([REQUEST], false)
    const m = mount(McpServerRequests, {})
    await nextTick()
    expect(m.q('waiting-server-requests-unread').textContent).toContain('one may be missing')
    expect(m.host.querySelector('code')?.textContent).toBe(URL)
    expect(m.all('waiting-server-request-approve-fictional-request')).toHaveLength(1)
  })

  it('wraps the complete long address inside a narrow card without clipping', async () => {
    const url = URL + '&title=' + 'fictional-note-'.repeat(70)
    supply([{ ...REQUEST, requested: { ...REQUEST.requested, url } }])
    const m = mount(McpServerRequests, {}, { width: 360, height: 1200 })
    await nextTick()
    const code = m.host.querySelector<HTMLElement>('code')!
    expect(code.textContent).toBe(url)
    const line = code.parentElement!
    expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth + 1)
    expect(getComputedStyle(line).textOverflow).not.toBe('ellipsis')
    expect(getComputedStyle(code).overflowWrap).toBe('anywhere')
    expect(code.getBoundingClientRect().height).toBeGreaterThan(40)
  })

  it('Tab and Shift-Tab reach both decisions with visible focus, and Enter and Space press them', async () => {
    const m = mount(McpServerRequests, {})
    await nextTick()
    const approve = m.q('waiting-server-request-approve-fictional-request')
    const refuse = m.q('waiting-server-request-refuse-fictional-request')
    approve.focus()
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(refuse)
    expect(refuse.matches(':focus-visible')).toBe(true)
    expect(getComputedStyle(refuse).outlineStyle).not.toBe('none')
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    expect(document.activeElement).toBe(approve)
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => pressed.mock.calls.length).toBe(1)
    expect(pressed).toHaveBeenLastCalledWith({ requestId: 'fictional-request', approve: true })
    await expect.poll(() => (refuse as HTMLButtonElement).disabled).toBe(false)
    refuse.focus()
    await userEvent.keyboard(' ')
    await expect.poll(() => pressed.mock.calls.length).toBe(2)
    expect(pressed).toHaveBeenLastCalledWith({ requestId: 'fictional-request', approve: false })
  })

  it('settling a focused corner button moves focus to its retained Dismiss button', async () => {
    const m = mount(McpServerRequests, { floating: true })
    await nextTick()
    pressed.mockResolvedValueOnce({ outcome: 'taken', reason: 'Refused. Nothing was registered.' })
    m.q('persons-queue-server-request-refuse-fictional-request').focus()
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => m.all('persons-queue-server-request-dismiss-fictional-request').length)
      .toBe(1)
    expect(document.activeElement).toBe(
      m.q('persons-queue-server-request-dismiss-fictional-request'),
    )
  })

  it('the healthy empty card component draws no request list or stale disclosure', async () => {
    supply([])
    const m = mount(McpServerRequests, {})
    await nextTick()
    expect(m.all('waiting-server-requests')).toHaveLength(0)
    expect(m.all('waiting-server-requests-unread')).toHaveLength(0)
    expect(m.host.querySelectorAll('button')).toHaveLength(0)
  })
})
