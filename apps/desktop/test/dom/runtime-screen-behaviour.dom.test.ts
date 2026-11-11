import { registerRootProviderCases } from './runtime-screen-provider-cases'
import { registerRootAttentionCases } from './runtime-screen-attention-cases'
import {
  sessions,
  agentStore,
  runtime,
  changed,
  walk,
  forestWalk,
  installRuntimeScreenFixture,
  disposeRuntimeScreenFixture,
  agentBookAnswers,
  replaceFixtureAgentStore,
} from './runtime-screen-fixture'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { screenFacts, useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { useOverlays, type Overlay } from '../../src/renderer/src/lib/overlay-store'
import type {
  ProcessMemory,
  RuntimeBridge,
  ResumedSession,
  CreatedSession,
  RefusedLaunch,
} from '../../src/shared/runtime-ipc'
import type { ResolvedMessageLink } from '../../src/renderer/src/lib/message-links'
import { idlePanel } from './sub-agents-idle-fixture'
import { drawnReady } from './drawn'
import { conv, forestOf, forestDrawn } from './forest-fixture'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { mount, META, unmountAll } from './harness'
import { LISTED } from './delete-conversation-fixture'
import { wearTheme } from '../../look/fixtures/themes'

// Register the fixture's mocks before loading the root's composable imports.
const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

beforeEach(installRuntimeScreenFixture)

/** The window's Back, in its top strip. */
const backOf = (screen: { q: (cy: string) => HTMLElement }): HTMLButtonElement =>
  screen.q('nav-back') as HTMLButtonElement

async function screenWithLink(target = 'W2.1', working = false) {
  runtime.attachOpen.mockResolvedValueOnce([
    {
      ...META,
      sessionId: 'fictional-source',
      handover: 'attached',
      history: {
        entries: [
          ...(working
            ? [{ ordinal: 0, at: 1, event: { type: 'status', state: 'working' } as never }]
            : []),
          {
            ordinal: working ? 1 : 0,
            at: 1,
            event: { type: 'assistant_message', text: target } as never,
          },
        ],
        from: 0,
        hasOlder: false,
        turnAligned: true,
      },
    },
  ])
  expect(await sessions.attachOpen()).toEqual(['fictional-source'])
  const screen = mount(RuntimeScreen, {})
  await expect.poll(() => screen.all('message-link').length).toBe(1)
  return screen
}

it('opens a resolved conversation and returns to the original message without sending or starting', async () => {
  runtime.resolveLink.mockResolvedValueOnce({
    state: 'available',
    kind: 'piece',
    title: 'Draft',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  })
  const screen = await screenWithLink()
  // A click reads again, after the preview lookup.
  runtime.resolveLink.mockResolvedValueOnce({
    state: 'available',
    kind: 'piece',
    title: 'Draft',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  })
  screen.q('message-link').click()
  await expect.poll(() => screen.all('message-link').length).toBe(0)
  expect(runtime.look).toHaveBeenCalledWith({ sessionId: 'fictional-target', claim: true })
  expect(backOf(screen).disabled).toBe(false)
  backOf(screen).click()
  await expect.poll(() => screen.all('message-link').length).toBe(1)
  expect(runtime.startAndSend).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
  expect(runtime.resume).not.toHaveBeenCalled()
})

it('opens archived history read-only, with a way back, and never calls look or a start', async () => {
  const archived: ResolvedMessageLink = {
    state: 'archived',
    kind: 'conversation',
    title: 'Archived draft',
    status: 'Archived',
    opens: { sessionId: 'fictional-archive' },
  }
  runtime.resolveLink.mockResolvedValueOnce(archived)
  const screen = await screenWithLink('[Older draft](brocrew://conversation/fictional-archive)')
  runtime.resolveLink.mockResolvedValueOnce(archived)
  screen.q('message-link').click()
  await expect.poll(() => screen.all('linked-history').length).toBe(1)
  expect(runtime.latestHistory).toHaveBeenCalledWith({ sessionId: 'fictional-archive' })
  expect(screen.q('linked-history').querySelector('textarea')).toBeNull()
  expect(screen.q('linked-history').textContent).toContain('Archived draft')
  expect(runtime.look).not.toHaveBeenCalled()
  expect(runtime.startAndSend).not.toHaveBeenCalled()
  expect(runtime.resume).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
  backOf(screen).click()
  await expect.poll(() => screen.all('linked-history').length).toBe(0)
  expect(screen.q('message-link').textContent).toBe('Older draft')
})

it.each(['source conversation', 'previous archive'])(
  'clears an archived conversation link failure when Back returns to the %s',
  async (returnsTo) => {
    const archive = (sessionId: string, title: string): ResolvedMessageLink => ({
      state: 'archived',
      kind: 'conversation',
      title,
      status: 'Archived',
      opens: { sessionId },
    })
    const first = archive('fictional-archive-a', 'Older draft')
    const second = archive('fictional-archive-b', 'Archived notes')
    const deleted: ResolvedMessageLink = {
      state: 'deleted',
      kind: 'piece',
      title: null,
      status: null,
      opens: null,
    }
    runtime.resolveLink.mockResolvedValueOnce(first).mockResolvedValueOnce(first)
    if (returnsTo === 'previous archive')
      runtime.resolveLink.mockResolvedValueOnce(second).mockResolvedValueOnce(second)
    runtime.resolveLink.mockResolvedValueOnce(deleted).mockResolvedValueOnce(deleted)
    if (returnsTo === 'previous archive')
      runtime.resolveLink.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const history = (text: string) => ({
      entries: [
        {
          ordinal: 0,
          at: 1,
          event: {
            type: 'assistant_message',
            text,
          } as never,
        },
      ],
      from: 0,
      hasOlder: false,
      turnAligned: true,
    })
    runtime.latestHistory.mockResolvedValueOnce(
      history(returnsTo === 'previous archive' ? 'W8.2' : 'W8.3'),
    )
    if (returnsTo === 'previous archive')
      runtime.latestHistory.mockResolvedValueOnce(history('W8.3'))
    const screen = await screenWithLink('W8.1')
    screen.q('message-link').click()
    await expect.poll(() => screen.q('linked-history').textContent).toContain('Older draft')
    const archiveLink = () =>
      screen.q('linked-history').querySelector<HTMLButtonElement>('[data-cy="message-link"]')!
    if (returnsTo === 'previous archive') {
      archiveLink().click()
      await expect.poll(() => screen.q('linked-history').textContent).toContain('Archived notes')
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    archiveLink().click()
    await expect.poll(() => screen.all('message-link-failure').length).toBe(1)
    expect(screen.q('message-link-failure').textContent).toContain('This work no longer exists.')
    backOf(screen).click()
    if (returnsTo === 'previous archive') {
      await expect.poll(() => screen.q('linked-history').textContent).toContain('Older draft')
    } else {
      await expect.poll(() => screen.all('linked-history').length).toBe(0)
      expect(screen.q('message-link').textContent).toBe('W8.1')
    }
    await nextTick()
    expect(screen.all('message-link-failure')).toHaveLength(0)
    expect(runtime.send).not.toHaveBeenCalled()
    expect(runtime.startAndSend).not.toHaveBeenCalled()
  },
)

it('opens an exact identity profile and its conversation shelf and can go back', async () => {
  const answer: ResolvedMessageLink = {
    state: 'available',
    kind: 'agent',
    title: 'Editor',
    status: 'Idle',
    opens: { identityId: 'agent:editor' },
  }
  runtime.resolveLink.mockResolvedValueOnce(answer)
  const screen = await screenWithLink('[Editor](brocrew://agent/agent%3Aeditor)')
  runtime.resolveLink.mockResolvedValueOnce(answer)
  screen.q('message-link').click()
  await expect.poll(() => screen.all('team-open-editor').length).toBe(1)
  expect(screen.q('team-name-editor').textContent).toBe('Editor')
  expect((screen.q('team-shelf-editor') as HTMLDetailsElement).open).toBe(true)
  expect(screen.q('team-shelf-editor').textContent).toContain(
    'No conversation on the list runs as it.',
  )
  backOf(screen).click()
  await expect.poll(() => screen.all('message-link').length).toBe(1)
  expect(runtime.look).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
})

it('follows a link out of archived history and returns through that history to the original message', async () => {
  const archive: ResolvedMessageLink = {
    state: 'archived',
    kind: 'piece',
    title: 'Archived draft',
    status: 'Archived',
    opens: { sessionId: 'fictional-archive' },
  }
  const target: ResolvedMessageLink = {
    state: 'available',
    kind: 'piece',
    title: 'Current draft',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  }
  runtime.resolveLink
    .mockResolvedValueOnce(archive)
    .mockResolvedValueOnce(archive)
    .mockResolvedValueOnce(target)
    .mockResolvedValueOnce(target)
    // Back to the archived page asks the host first whether it is still there.
    .mockResolvedValueOnce(archive)
  runtime.latestHistory.mockResolvedValueOnce({
    entries: [{ ordinal: 0, at: 1, event: { type: 'assistant_message', text: 'W8.2' } as never }],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  })
  const screen = await screenWithLink('W8.1')
  screen.q('message-link').click()
  await expect.poll(() => screen.all('linked-history').length).toBe(1)
  const onward = screen
    .q('linked-history')
    .querySelector<HTMLButtonElement>('[data-cy="message-link"]')!
  await expect.poll(() => onward.dataset.linkState).toBe('available')
  onward.click()
  await expect.poll(() => screen.all('linked-history').length).toBe(0)
  expect(runtime.look).toHaveBeenCalledWith({ sessionId: 'fictional-target', claim: true })
  backOf(screen).click()
  await expect
    .poll(() => runtime.resolveLink.mock.calls.at(-1)?.[0])
    .toBe('brocrew://conversation/fictional-archive')
  await expect.poll(() => screen.all('linked-history').length).toBe(1)
  expect(screen.q('linked-history').textContent).toContain('Archived draft')
  expect(runtime.latestHistory).toHaveBeenCalledTimes(1)
  // The step ends once its page is drawn; a press before that is the same step's.
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0))),
  )
  backOf(screen).click()
  await expect.poll(() => screen.all('linked-history').length).toBe(0)
  expect(screen.q('message-link').textContent).toBe('W8.1')
  expect(backOf(screen).disabled).toBe(true)
  expect(runtime.resume).not.toHaveBeenCalled()
  expect(runtime.startAndSend).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
})

it('returns through a recorded conversation even after the window released its record', async () => {
  const a: ResolvedMessageLink = {
    state: 'available',
    kind: 'piece',
    title: 'Recorded A',
    status: 'Idle',
    opens: { sessionId: 'recorded-a' },
  }
  const b: ResolvedMessageLink = {
    state: 'available',
    kind: 'piece',
    title: 'Recorded B',
    status: 'Idle',
    opens: { sessionId: 'recorded-b' },
  }
  const handedA: ResumedSession = {
    ...META,
    sessionId: 'recorded-a',
    handover: 'recorded',
    history: {
      entries: [{ ordinal: 0, at: 1, event: { type: 'assistant_message', text: 'W9.2' } as never }],
      from: 0,
      hasOlder: false,
      turnAligned: true,
    },
  }
  runtime.look
    .mockResolvedValueOnce(handedA)
    .mockResolvedValueOnce({
      ...handedA,
      sessionId: 'recorded-b',
      history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
    })
    .mockResolvedValueOnce(handedA)
  runtime.resolveLink
    .mockResolvedValueOnce(a)
    .mockResolvedValueOnce(a)
    .mockResolvedValueOnce(b)
    .mockResolvedValueOnce(b)
  const screen = await screenWithLink('W9.1')
  screen.q('message-link').click()
  await expect.poll(() => screen.all('message-link')[0]?.textContent).toBe('W9.2')
  await expect.poll(() => screen.q('message-link').dataset.linkState).toBe('available')
  screen.q('message-link').click()
  await expect.poll(() => sessions.get('recorded-a')).toBeNull()
  backOf(screen).click()
  await expect.poll(() => screen.all('message-link')[0]?.textContent).toBe('W9.2')
  expect(runtime.look).toHaveBeenCalledWith({ sessionId: 'recorded-a', claim: false })
  // The step ends once its page is drawn; a press before that is the same step's.
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0))),
  )
  backOf(screen).click()
  await expect.poll(() => screen.all('message-link')[0]?.textContent).toBe('W9.1')
  expect(runtime.resume).not.toHaveBeenCalled()
  expect(runtime.startAndSend).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
})

it('leaves a closed history page closed when a link look finishes late', async () => {
  const archive: ResolvedMessageLink = {
    state: 'archived',
    kind: 'piece',
    title: 'Archived draft',
    status: 'Archived',
    opens: { sessionId: 'fictional-archive' },
  }
  const target: ResolvedMessageLink = {
    state: 'available',
    kind: 'piece',
    title: 'Current draft',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  }
  runtime.resolveLink
    .mockResolvedValueOnce(archive)
    .mockResolvedValueOnce(archive)
    .mockResolvedValueOnce(target)
    .mockResolvedValueOnce(target)
  runtime.latestHistory.mockResolvedValueOnce({
    entries: [{ ordinal: 0, at: 1, event: { type: 'assistant_message', text: 'W8.2' } as never }],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  })
  let finish!: (result: ResumedSession) => void
  runtime.look.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  const screen = await screenWithLink('W8.1')
  screen.q('message-link').click()
  await expect.poll(() => screen.all('linked-history').length).toBe(1)
  const onward = screen
    .q('linked-history')
    .querySelector<HTMLButtonElement>('[data-cy="message-link"]')!
  await expect.poll(() => onward.dataset.linkState).toBe('available')
  onward.click()
  await expect.poll(() => runtime.look.mock.calls.length).toBe(1)
  backOf(screen).click()
  await expect.poll(() => screen.all('linked-history').length).toBe(0)
  finish({
    ...META,
    sessionId: 'fictional-target',
    handover: 'recorded',
    history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
  })
  await expect.poll(() => onward.hasAttribute('aria-busy')).toBe(false)
  await nextTick()
  // Two reads of each link, and none after Back: Back keeps focus on its own button, not the link.
  expect(runtime.resolveLink).toHaveBeenCalledTimes(4)
  expect(screen.q('message-link').textContent).toBe('W8.1')
  expect(backOf(screen).disabled).toBe(true)
  expect(screen.all('message-link-failure')).toHaveLength(0)
})

it('Back from archived history returns to the working conversation without interrupting it', async () => {
  const archive: ResolvedMessageLink = {
    state: 'archived',
    kind: 'piece',
    title: 'Archived draft',
    status: 'Archived',
    opens: { sessionId: 'fictional-archive' },
  }
  runtime.resolveLink.mockResolvedValueOnce(archive).mockResolvedValueOnce(archive)
  const screen = await screenWithLink('W8.1', true)
  expect(sessions.get('fictional-source')?.control.status).toBe('working')
  screen.q('message-link').click()
  await expect.poll(() => screen.all('linked-history').length).toBe(1)
  backOf(screen).click()
  await expect.poll(() => screen.all('linked-history').length).toBe(0)
  expect(runtime.interrupt).not.toHaveBeenCalled()
  expect(runtime.send).not.toHaveBeenCalled()
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  await expect.poll(() => runtime.interrupt.mock.calls.length).toBe(1)
  expect(runtime.interrupt).toHaveBeenCalledWith({ sessionId: 'fictional-source' })
})
afterEach(disposeRuntimeScreenFixture)

it('opens Team from the rail and reads its work only when that page is shown', async () => {
  const m = mount(RuntimeScreen, {})
  await nextTick()
  expect(runtime.theWholeForest).not.toHaveBeenCalled()
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-workspace').length).toBe(1)
  await expect.poll(() => runtime.theWholeForest.mock.calls.length).toBe(1)
  expect(m.q('team-workspace').textContent).toContain('Team')
})

it('opens an agent sheet from Team and closes back to the same page', async () => {
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-open-editor').length).toBe(1)
  m.q('team-tab-roster').click()
  await nextTick()
  m.q('team-open-editor').click()
  await expect.poll(() => m.all('capabilities-sheet').length).toBe(1)
  expect(m.q('overlay-host').getAttribute('aria-label')).toBe('Editor')
  expect(m.q('capabilities-slug').textContent).toBe('editor')
  m.q('close-overlay').click()
  await nextTick()
  expect(m.all('overlay-host')).toHaveLength(0)
  expect(m.q('team-workspace')).toBeTruthy()
})

it('opens the create-agent form from Team and cancels without creating an agent', async () => {
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await nextTick()
  m.q('team-create').click()
  await nextTick()
  expect(m.q('new-agent-create').hasAttribute('disabled')).toBe(true)
  m.q('new-agent-cancel').click()
  await nextTick()
  expect(m.all('new-agent')).toHaveLength(0)
  expect(m.q('team-workspace')).toBeTruthy()
})

const keyboardSheets = [
  { overlay: { kind: 'newAgent' }, ready: 'new-agent' },
  { overlay: { kind: 'externalMcpServers' }, ready: 'external-mcp-registry' },
  { overlay: { kind: 'agentSections', profileSlug: 'editor' }, ready: 'agent-sections-sheet' },
  { overlay: { kind: 'agentCapabilities', profileSlug: 'editor' }, ready: 'capabilities-sheet' },
  { overlay: { kind: 'startAsAgent', profileSlug: 'editor' }, ready: 'start-as-agent' },
  {
    overlay: { kind: 'deleteConversation', sessionId: LISTED.conversation },
    ready: 'delete-conversation',
  },
] satisfies { overlay: Overlay; ready: string }[]

function overlayKey(key: 'Escape' | 'Tab', shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
}

it.each(keyboardSheets)(
  'traps focus and restores the connected opener for $ready in the root overlay layer',
  async ({ overlay, ready }) => {
    const viewportBefore = { width: window.innerWidth, height: window.innerHeight }
    try {
      await page.viewport(1200, 800)
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      console.info(
        'S04_OVERLAY_VIEWPORT',
        JSON.stringify({ sheet: ready, viewportBefore, viewport }),
      )
      expect(viewport).toEqual({ width: 1200, height: 800 })
      const answers = {
        ...agentBookAnswers().book,
        checkDeleteConversation: async () => LISTED,
        agentModelAndEffort: async () => null,
      }
      const previous = Object.getOwnPropertyDescriptors(runtime)
      const previousApi = window.api
      const previousAgentStore = agentStore
      try {
        Object.assign(runtime, answers)
        window.api = { ...previousApi, runtime: runtime as unknown as RuntimeBridge }
        replaceFixtureAgentStore(createAgentStore(window.api.runtime))
        const m = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
        try {
          wearTheme('defined')
          await expect.poll(() => agentStore.loaded.value).toBe(true)
          m.q('rail-team').click()
          await expect.poll(() => m.all('team-create').length).toBe(1)
          const opener = m.q('team-create')
          opener.focus()
          expect(document.activeElement).toBe(opener)
          // Supply each real sheet payload through the root's existing overlay store.
          useOverlays().open(overlay)
          await expect.poll(() => m.all(ready).length).toBe(1)
          if (overlay.kind === 'agentSections' || overlay.kind === 'agentCapabilities') {
            await expect.poll(() => m.all('own-instructions-read-at').length).toBe(1)
            expect(m.all('own-instructions-unreadable')).toHaveLength(0)
          }
          if (overlay.kind === 'agentCapabilities') {
            await expect.poll(() => m.all('agent-model-loading').length).toBe(0)
            expect(m.all('agent-model-unreadable')).toHaveLength(0)
          }
          if (overlay.kind === 'deleteConversation') {
            await expect.poll(() => m.all('delete-reading').length).toBe(0)
            expect(m.q('delete-title').textContent).toBe(`Delete ${LISTED.name}?`)
            expect(m.all('delete-refusal')).toHaveLength(0)
          }
          const host = m.q('overlay-host')
          expect(host.parentElement).toBe(m.q('overlay-layer'))
          expect(m.q('overlay-layer').children).toHaveLength(1)
          const bounds = m.q(ready).getBoundingClientRect()
          console.info(
            'S04_OVERLAY_GEOMETRY',
            JSON.stringify({ sheet: ready, viewport, bounds: bounds.toJSON() }),
          )
          expect(bounds.width).toBeGreaterThan(250)
          expect(bounds.height).toBeGreaterThan(100)
          expect(bounds.left).toBeGreaterThanOrEqual(0)
          expect(bounds.top).toBeGreaterThanOrEqual(0)
          expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
          expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight)
          await expect.poll(() => host.contains(document.activeElement)).toBe(true)
          const first = m.q('close-overlay')
          const last = m.q('overlay-spawning')
          first.focus()
          overlayKey('Tab', true)
          expect(document.activeElement).toBe(last)
          overlayKey('Tab')
          expect(document.activeElement).toBe(first)
          overlayKey('Escape')
          await expect.poll(() => m.all('overlay-host').length).toBe(0)
          expect(useOverlays().overlay.value).toBeNull()
          expect(opener.isConnected).toBe(true)
          expect(document.activeElement).toBe(opener)
        } finally {
          m.unmount()
        }
      } finally {
        for (const key of Object.keys(answers)) {
          const descriptor = previous[key]
          if (descriptor) Object.defineProperty(runtime, key, descriptor)
          else Reflect.deleteProperty(runtime, key)
        }
        window.api = previousApi
        replaceFixtureAgentStore(previousAgentStore)
      }
    } finally {
      await page.viewport(viewportBefore.width, viewportBefore.height)
      const restored = { width: window.innerWidth, height: window.innerHeight }
      console.info('S04_OVERLAY_VIEWPORT_RESTORED', JSON.stringify({ sheet: ready, restored }))
      expect(restored).toEqual(viewportBefore)
    }
  },
)

it('refreshes Team after work changes and stops requesting its forest on another page', async () => {
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await expect.poll(() => m.all('forest-empty').length).toBe(1)
  runtime.theWholeForest.mockResolvedValueOnce({
    readAt: 2,
    nodes: forestWalk(),
    conversations: 0,
    heldByNoAgent: 7,
  })
  changed({ what: 'work' })
  await expect.poll(() => m.all('forest-outside')[0]?.textContent).toContain('7 more conversations')
  m.q('new-conversation').click()
  await nextTick()
  const reads = runtime.theWholeForest.mock.calls.length
  changed({ what: 'work' })
  await nextTick()
  expect(runtime.theWholeForest).toHaveBeenCalledTimes(reads)
  expect(m.all('team-workspace')).toHaveLength(0)
  expect(m.q('prompt-input')).toBeTruthy()
})

it('shows a failed startup read without hiding the successful app information', async () => {
  runtime.capabilities.mockRejectedValueOnce(new Error('The capability list could not be read'))
  const m = mount(RuntimeScreen, {})
  await expect
    .poll(() => m.all('startup-error')[0]?.textContent)
    .toContain('The capability list could not be read')
  expect(m.q('window-title').textContent).toContain('Fictional BroBot')
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-workspace').length).toBe(1)
})

it('says the forest could not be read instead of displaying an empty Team', async () => {
  runtime.theWholeForest.mockRejectedValueOnce(new Error('The work ledger is unavailable'))
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await expect.poll(() => runtime.theWholeForest.mock.calls.length).toBe(1)
  await nextTick()
  expect(m.q('forest-not-read').textContent).toContain('Nothing has been read')
  expect(m.all('forest-empty')).toHaveLength(0)
})

it('keeps the launcher open when a Team read finishes after the person leaves', async () => {
  let finish!: (answer: Awaited<ReturnType<typeof runtime.theWholeForest>>) => void
  runtime.theWholeForest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await expect.poll(() => runtime.theWholeForest.mock.calls.length).toBe(1)
  m.q('new-conversation').click()
  await nextTick()
  finish({ readAt: 3, nodes: forestWalk(), conversations: 0, heldByNoAgent: 9 })
  await nextTick()
  await nextTick()
  expect(m.q('prompt-input')).toBeTruthy()
  expect(m.all('team-workspace')).toHaveLength(0)
  expect(m.all('forest-outside')).toHaveLength(0)
})

it('keeps the stop-spawning switch usable while an agent form is open', async () => {
  const m = mount(RuntimeScreen, {})
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-open-editor').length).toBe(1)
  m.q('team-create').click()
  await nextTick()
  expect(m.q('overlay-spawning').getAttribute('aria-pressed')).toBe('true')
  m.q('overlay-spawning').click()
  await expect.poll(() => m.q('overlay-spawning').getAttribute('aria-pressed')).toBe('false')
  expect(runtime.setSpawningEnabled).toHaveBeenCalledWith({ enabled: false })
  expect(m.q('new-agent')).toBeTruthy()
  m.q('new-agent-cancel').click()
  await nextTick()
})

it('preserves an unsent draft when the new-conversation shortcut returns from Team', async () => {
  const m = mount(RuntimeScreen, {})
  const box = m.q('prompt-input') as HTMLTextAreaElement
  box.value = 'Please review this fictional draft'
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  m.q('rail-team').click()
  await nextTick()
  expect(m.q('team-workspace')).toBeTruthy()
  const key = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true })
  window.dispatchEvent(key)
  await nextTick()
  expect(key.defaultPrevented).toBe(true)
  expect((m.q('prompt-input') as HTMLTextAreaElement).value).toBe(
    'Please review this fictional draft',
  )
  expect(m.all('team-workspace')).toHaveLength(0)
})

it('paints a theme’s window background behind everything, and the app’s own without one', async () => {
  const m = mount(RuntimeScreen, {})
  await nextTick()
  const app = m.host.querySelector('.app')!
  const own = getComputedStyle(app).backgroundColor
  expect(getComputedStyle(app).backgroundImage).toBe('none')
  applyTheme({
    format: 1,
    id: 'night-window',
    name: 'Night window',
    window: {
      background: {
        color: '#0b1020',
        layers: [
          {
            gradient: {
              type: 'linear',
              angle: 180,
              stops: [
                { color: '#0b1020', at: 0 },
                { color: '#1b2a4a', at: 100 },
              ],
            },
          },
        ],
      },
    },
  })
  expect(getComputedStyle(app).backgroundColor).toBe('rgb(11, 16, 32)')
  expect(getComputedStyle(app).backgroundImage).toMatch(
    /^linear-gradient\(rgb\(11, 16, 32\) 0%, rgb\(27, 42, 74\) 100%\)$/,
  )
  applyTheme(null)
  expect(getComputedStyle(app).backgroundColor).toBe(own)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

it.each(['launch', 'sign-in'] as const)(
  'draws the exact launcher refusal and offers sign-in help only for the matching %s word',
  async (word) => {
    const answer = deferred<CreatedSession | RefusedLaunch>()
    const check = vi.fn<RuntimeBridge['checkProviderAuth']>(async () => ({
      state: 'unknown',
      reason: 'The fictional sign-in check could not answer.',
    }))
    const catalogue = vi.fn<RuntimeBridge['modelList']>(async ({ provider }) => ({
      provider,
      notAsked: null,
      standIn: null,
      models: [
        {
          id: 'fictional-model',
          label: 'Fictional model',
          isDefault: true,
          addedBy: 'the-provider',
          efforts: [],
        },
      ],
      lastPicked: null,
      startsOn: { model: 'fictional-model', effort: null, from: 'the-providers-default' },
    }))
    const previousCatalogue = Object.getOwnPropertyDescriptor(runtime, 'modelList')
    const previous = Object.getOwnPropertyDescriptor(runtime, 'checkProviderAuth')
    const previousApi = window.api
    Object.assign(runtime, { checkProviderAuth: check, modelList: catalogue })
    window.api = { ...previousApi, runtime: runtime as unknown as RuntimeBridge }
    runtime.createSession.mockReturnValueOnce(answer.promise)
    runtime.profiles.mockResolvedValueOnce([DEFAULT_PROFILE_ID])
    const screen = mount(RuntimeScreen, {})
    try {
      await expect.poll(() => agentStore.loaded.value).toBe(true)
      const input = screen.q('prompt-input') as HTMLTextAreaElement
      input.value = 'Read the fictional draft.'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await expect.poll(() => (screen.q('send-prompt') as HTMLButtonElement).disabled).toBe(false)
      screen.q('send-prompt').click()
      await expect.poll(() => runtime.createSession.mock.calls.length).toBe(1)
      await expect.poll(() => screen.all('cancel-launch').length).toBe(1)
      expect(screen.all('command-error')).toHaveLength(0)
      expect(check).not.toHaveBeenCalled()
      const startedOn = runtime.createSession.mock.calls[0]![0].provider
      await expect
        .poll(() => catalogue.mock.calls.some(([input]) => input.provider === startedOn))
        .toBe(true)
      answer.resolve({ refused: { reason: word, said: 'The fictional launch did not open.' } })
      await expect.poll(() => screen.all('cancel-launch').length).toBe(0)
      await expect
        .poll(() => screen.q('command-error').textContent)
        .toBe('The fictional launch did not open.')
      expect(screen.all('command-error')).toHaveLength(1)
      expect(sessions.launchRefusal.value).toBe(word)
      if (word === 'sign-in') {
        await expect.poll(() => check.mock.calls.length).toBe(1)
        await expect.poll(() => screen.all('sign-in-panel').length).toBe(1)
        expect(screen.q('sign-in-reason').textContent).toBe(
          'The fictional sign-in check could not answer.',
        )
        expect(screen.q('sign-in-open-providers')).toBeTruthy()
      } else {
        await nextTick()
        expect(check).not.toHaveBeenCalled()
        expect(screen.all('sign-in-panel')).toHaveLength(0)
      }
    } finally {
      screen.unmount()
      if (previous) Object.defineProperty(runtime, 'checkProviderAuth', previous)
      else Reflect.deleteProperty(runtime, 'checkProviderAuth')
      if (previousCatalogue) Object.defineProperty(runtime, 'modelList', previousCatalogue)
      else Reflect.deleteProperty(runtime, 'modelList')
      window.api = previousApi
    }
  },
)

async function launchFromAgentSheet(words: string) {
  const answer = deferred<CreatedSession | RefusedLaunch>()
  runtime.createSession.mockReturnValueOnce(answer.promise)
  const listeners = runtime.onEvent.mock.calls.length
  const m = mount(RuntimeScreen, {})
  useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
  await expect.poll(() => m.all('start-as-agent').length).toBe(1)
  const sheet = m.q('start-as-agent')
  const input = sheet.querySelector<HTMLTextAreaElement>('[data-cy="prompt-input"]')!
  input.value = words
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const send = sheet.querySelector<HTMLButtonElement>('[data-cy="send-prompt"]')!
  await expect.poll(() => send.disabled).toBe(false)
  send.click()
  await expect.poll(() => runtime.createSession.mock.calls.length).toBe(1)
  await expect.poll(() => m.all('cancel-launch').length).toBe(1)
  expect(runtime.onEvent).toHaveBeenCalledTimes(listeners)
  return { m, answer, input }
}

it('keeps the launching sheet busy, says its refusal once and returns its typed words', async () => {
  const words = 'Read the fictional draft before editing it.'
  const { m, answer, input } = await launchFromAgentSheet(words)
  const overlay = useOverlays().overlay.value
  expect(m.all('start-as-agent-error')).toHaveLength(0)
  answer.resolve({ refused: { reason: 'launch', said: 'The fictional launch was refused.' } })
  await expect.poll(() => m.all('cancel-launch').length).toBe(0)
  await expect.poll(() => input.value).toBe(words)
  expect(useOverlays().overlay.value).toBe(overlay)
  expect(m.all('start-as-agent-error')).toHaveLength(1)
  expect(m.q('start-as-agent-error').textContent).toBe('The fictional launch was refused.')
  expect(
    m.all('toast').filter((toast) => toast.textContent?.includes('fictional launch')),
  ).toHaveLength(0)
  expect(runtime.cancelLaunch).not.toHaveBeenCalled()
})

it('does not give a same-agent replacement the old launch busy state or late refusal', async () => {
  const { m, answer } = await launchFromAgentSheet('Words belonging to the old sheet.')
  useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
  const replacement = useOverlays().overlay.value
  await expect.poll(() => m.all('cancel-launch').length).toBe(0)
  expect(runtime.cancelLaunch).not.toHaveBeenCalled()
  answer.resolve({ refused: { reason: 'launch', said: 'The replaced launch was refused.' } })
  await expect
    .poll(
      () =>
        m
          .all('toast')
          .filter((toast) => toast.textContent?.includes('The replaced launch was refused.'))
          .length,
    )
    .toBe(1)
  expect(useOverlays().overlay.value).toBe(replacement)
  expect(m.all('start-as-agent')).toHaveLength(1)
  expect(m.all('start-as-agent-error')).toHaveLength(0)
  expect(m.all('cancel-launch')).toHaveLength(0)
  expect(runtime.cancelLaunch).not.toHaveBeenCalled()
})

it('closing a replacement does not cancel the launch owned by the replaced sheet', async () => {
  const { m, answer } = await launchFromAgentSheet('The old sheet owns this launch.')
  useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
  await expect.poll(() => m.all('cancel-launch').length).toBe(0)
  m.q('close-overlay').click()
  await expect.poll(() => m.all('overlay-host').length).toBe(0)
  expect(runtime.cancelLaunch).not.toHaveBeenCalled()
  answer.resolve({ refused: { reason: 'launch', said: 'The unowned launch was refused.' } })
  await expect
    .poll(
      () =>
        m
          .all('toast')
          .filter((toast) => toast.textContent?.includes('The unowned launch was refused.')).length,
    )
    .toBe(1)
  expect(useOverlays().overlay.value).toBeNull()
  expect(runtime.cancelLaunch).not.toHaveBeenCalled()
})

it.each(['cancel-launch', 'close-overlay'] as const)(
  'cancels the owned launch through %s without reporting a cancelled refusal',
  async (control) => {
    const { m, answer, input } = await launchFromAgentSheet('Keep these words if I cancel.')
    const key = runtime.createSession.mock.calls[0]![0].launchKey
    expect(key).toEqual(expect.any(String))
    m.q(control).click()
    await expect.poll(() => runtime.cancelLaunch.mock.calls.length).toBe(1)
    expect(runtime.cancelLaunch).toHaveBeenCalledWith({ launchKey: key })
    answer.resolve({ refused: { reason: 'cancelled', said: 'The launch was cancelled.' } })
    await expect.poll(() => sessions.isPlacing()).toBe(false)
    await nextTick()
    expect(m.all('start-as-agent-error')).toHaveLength(0)
    expect(
      m.all('toast').filter((toast) => toast.textContent?.includes('launch was cancelled')),
    ).toHaveLength(0)
    if (control === 'close-overlay') {
      expect(useOverlays().overlay.value).toBeNull()
      expect(m.all('overlay-host')).toHaveLength(0)
    } else {
      expect(m.all('start-as-agent')).toHaveLength(1)
      expect(input.value).toBe('Keep these words if I cancel.')
    }
  },
)

it.each(['Escape', 'backdrop'] as const)(
  'cancels the captured pending launch once through %s and closes without a refusal',
  async (route) => {
    const { m, answer } = await launchFromAgentSheet('Cancel this pending launch.')
    const key = runtime.createSession.mock.calls[0]![0].launchKey
    expect(key).toEqual(expect.any(String))
    if (route === 'Escape') overlayKey('Escape')
    else m.q('overlay-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await expect.poll(() => m.all('overlay-host').length).toBe(0)
    expect(useOverlays().overlay.value).toBeNull()
    expect(runtime.cancelLaunch).toHaveBeenCalledExactlyOnceWith({ launchKey: key })
    answer.resolve({ refused: { reason: 'cancelled', said: 'The launch was cancelled.' } })
    await expect.poll(() => sessions.isPlacing()).toBe(false)
    await nextTick()
    expect(runtime.cancelLaunch).toHaveBeenCalledExactlyOnceWith({ launchKey: key })
    expect(m.all('start-as-agent-error')).toHaveLength(0)
    expect(m.all('toast')).toHaveLength(0)
    expect(sessions.launchRefusal.value).toBeNull()
  },
)

it('closes the launching sheet before the parent continues into the opened conversation', async () => {
  const { m, answer } = await launchFromAgentSheet('Read this in the opened conversation.')
  const send = vi.spyOn(sessions, 'send').mockImplementation(async () => {
    expect(useOverlays().overlay.value).toBeNull()
    return true
  })
  try {
    answer.resolve({ ...META, sessionId: 'sheet-opened' })
    await expect.poll(() => send.mock.calls.length).toBe(1)
    expect(send).toHaveBeenCalledWith(
      'sheet-opened',
      'Read this in the opened conversation.',
      'now',
      [],
    )
    await expect.poll(() => m.all('conversation-pane').length).toBe(1)
    expect(m.all('overlay-host')).toHaveLength(0)
    expect(runtime.cancelLaunch).not.toHaveBeenCalled()
  } finally {
    send.mockRestore()
  }
})

async function panelScreen(withSecond = false) {
  runtime.attachOpen.mockResolvedValueOnce([
    ...(withSecond
      ? [
          {
            ...META,
            sessionId: 'fictional-target',
            handover: 'attached' as const,
            history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
          },
        ]
      : []),
    {
      ...META,
      sessionId: 'fictional-source',
      handover: 'attached',
      history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
    },
  ])
  await sessions.attachOpen()
  const screen = mount(RuntimeScreen, {})
  screen.q('new-conversation').click()
  await nextTick()
  screen.q('nav-back').click()
  return screen
}
function panelRead(count = 1) {
  const read = idlePanel(count).reading.read
  return { ...read, conversation: 'fictional-source' }
}

it.each(['activity', 'forest'] as const)(
  'shows the first relationship answer before slow %s finishes',
  async (slow) => {
    const answer = deferred<Awaited<ReturnType<RuntimeBridge['whoCalledWhom']>>>()
    const activity = deferred<Awaited<ReturnType<RuntimeBridge['whatIsBeingDone']>>>()
    const forest = deferred<Awaited<ReturnType<RuntimeBridge['theWholeForest']>>>()
    runtime.whoCalledWhom.mockReturnValueOnce(answer.promise)
    runtime.whatIsBeingDone.mockImplementationOnce(() =>
      slow === 'activity' ? activity.promise : Promise.resolve({ readAt: 2, conversations: [] }),
    )
    runtime.theWholeForest.mockImplementationOnce(() =>
      slow === 'forest'
        ? forest.promise
        : Promise.resolve({ readAt: 2, nodes: forestWalk(), conversations: 0, heldByNoAgent: 0 }),
    )
    const screen = await panelScreen()
    try {
      await expect.poll(() => screen.all('cast-loading').length).toBe(1)
      expect(screen.q('cast-loading').getAttribute('role')).toBe('status')
      expect(screen.all('cast-not-read')).toHaveLength(0)
      expect(screen.all('cast-sub-agents')).toHaveLength(0)
      answer.resolve(panelRead())
      await expect.poll(() => screen.all('cast-sub-agents').length).toBe(1)
      expect(screen.all('cast-loading')).toHaveLength(0)
      expect(screen.all('cast-not-read')).toHaveLength(0)
      expect(screen.q('cast-sub-agents').querySelector('.count')?.textContent).toBe('(1)')
      expect(useWhoCalledWhom().reading.value?.answered).toBe(true)
      expect(runtime.whoCalledWhom).toHaveBeenCalledTimes(1)
    } finally {
      activity.resolve({ readAt: 3, conversations: [] })
      forest.resolve({ readAt: 3, nodes: forestWalk(), conversations: 0, heldByNoAgent: 0 })
    }
    await expect
      .poll(() => useWhoCalledWhom().reading.value?.atWork?.readAt)
      .toBe(slow === 'activity' ? 3 : 2)
  },
)

it('ends first-read loading on a refusal and keeps the unread line distinct from a real empty answer', async () => {
  const answer = deferred<Awaited<ReturnType<RuntimeBridge['whoCalledWhom']>>>()
  runtime.whoCalledWhom.mockReturnValueOnce(answer.promise)
  const screen = await panelScreen()
  await expect.poll(() => screen.all('cast-loading').length).toBe(1)
  // The bridge rejects; the session store returns null, rather than an invented empty list.
  runtime.whoCalledWhom.mockRejectedValueOnce(new Error('fictional read refused'))
  changed({ what: 'work' })
  await expect.poll(() => screen.all('cast-not-read').length).toBe(1)
  expect(screen.all('cast-loading')).toHaveLength(0)
  expect(screen.all('cast-children-empty')).toHaveLength(0)
  answer.resolve(panelRead())
  await drawnReady()
  expect(screen.all('cast-not-read')).toHaveLength(1)
  runtime.whoCalledWhom.mockResolvedValueOnce(panelRead(0))
  changed({ what: 'work' })
  await expect.poll(() => screen.all('cast-children-empty').length).toBe(1)
  expect(screen.all('cast-loading')).toHaveLength(0)
  expect(screen.all('cast-not-read')).toHaveLength(0)
})

it('ignores old graph and activity refinements after a newer relationship reading', async () => {
  const oldActivity = deferred<Awaited<ReturnType<RuntimeBridge['whatIsBeingDone']>>>()
  const oldForest = deferred<Awaited<ReturnType<RuntimeBridge['theWholeForest']>>>()
  runtime.whoCalledWhom.mockResolvedValueOnce(panelRead())
  runtime.whatIsBeingDone.mockReturnValueOnce(oldActivity.promise)
  runtime.theWholeForest.mockReturnValueOnce(oldForest.promise)
  const screen = await panelScreen()
  try {
    await expect.poll(() => screen.all('cast-sub-agents').length).toBe(1)
    runtime.whoCalledWhom.mockResolvedValueOnce(panelRead(2))
    runtime.whatIsBeingDone.mockResolvedValueOnce({ readAt: 200, conversations: [] })
    runtime.theWholeForest.mockResolvedValueOnce({
      readAt: 200,
      nodes: forestWalk(),
      conversations: 0,
      heldByNoAgent: 0,
    })
    changed({ what: 'work' })
    await expect.poll(() => useWhoCalledWhom().reading.value?.atWork?.readAt).toBe(200)
    expect(screen.q('cast-sub-agents').querySelector('.count')?.textContent).toBe('(2)')
    oldActivity.resolve({ readAt: 100, conversations: [] })
    oldForest.resolve({ readAt: 100, nodes: forestWalk(), conversations: 0, heldByNoAgent: 0 })
    await drawnReady()
    expect(useWhoCalledWhom().forest.value?.readAt).toBe(200)
    expect(useWhoCalledWhom().reading.value?.atWork?.readAt).toBe(200)
  } finally {
    oldActivity.resolve({ readAt: 100, conversations: [] })
    oldForest.resolve({ readAt: 100, nodes: forestWalk(), conversations: 0, heldByNoAgent: 0 })
  }
})

it.each(['B', 'A'] as const)(
  'keeps A’s late answer out of a direct A→B→A switch when it arrives on %s',
  async (arrival) => {
    const firstA = deferred<Awaited<ReturnType<RuntimeBridge['whoCalledWhom']>>>()
    const secondA = deferred<Awaited<ReturnType<RuntimeBridge['whoCalledWhom']>>>()
    const answerB = deferred<Awaited<ReturnType<RuntimeBridge['whoCalledWhom']>>>()
    let readsA = 0
    runtime.whoCalledWhom.mockImplementation(({ sessionId }) => {
      if (sessionId === 'fictional-source') return ++readsA === 1 ? firstA.promise : secondA.promise
      if (sessionId === 'fictional-target') return answerB.promise
      throw new Error('Unexpected fictional conversation')
    })
    const screen = await panelScreen(true)
    const a1 = { ...panelRead(1), readAt: 100 }
    const a2 = { ...panelRead(3), readAt: 300 }
    const b = { ...panelRead(2), conversation: 'fictional-target', readAt: 200 }
    const count = () => screen.q('cast-sub-agents').querySelector('.count')?.textContent
    try {
      await expect.poll(() => readsA).toBe(1)
      expect(screen.all('cast-loading')).toHaveLength(1)
      screen.q('open-session-fictional-target').click()
      await expect.poll(() => useWhoCalledWhom().loadingFor.value).toBe('fictional-target')
      answerB.resolve(b)
      await expect
        .poll(() => useWhoCalledWhom().reading.value?.conversation)
        .toBe('fictional-target')
      expect(count()).toBe('(2)')
      if (arrival === 'B') {
        firstA.resolve(a1)
        await drawnReady()
        expect(useWhoCalledWhom().reading.value?.conversation).toBe('fictional-target')
        expect(useWhoCalledWhom().reading.value?.read.readAt).toBe(200)
        expect(count()).toBe('(2)')
      }
      screen.q('open-session-fictional-source').click()
      await expect.poll(() => readsA).toBe(2)
      expect(screen.all('cast-loading')).toHaveLength(1)
      secondA.resolve(a2)
      await expect.poll(() => useWhoCalledWhom().reading.value?.read.readAt).toBe(300)
      expect(count()).toBe('(3)')
      if (arrival === 'A') {
        firstA.resolve(a1)
        await drawnReady()
      }
      expect(useWhoCalledWhom().reading.value?.conversation).toBe('fictional-source')
      expect(useWhoCalledWhom().reading.value?.read.readAt).toBe(300)
      expect(count()).toBe('(3)')
      expect(runtime.whoCalledWhom.mock.calls.map(([input]) => input.sessionId)).toEqual([
        'fictional-source',
        'fictional-target',
        'fictional-source',
      ])
      expect(runtime.send).not.toHaveBeenCalled()
      expect(runtime.resume).not.toHaveBeenCalled()
      expect(runtime.startAndSend).not.toHaveBeenCalled()
    } finally {
      firstA.resolve(a1)
      secondA.resolve(a2)
      answerB.resolve(b)
    }
  },
)

it('keeps Graph unread until the independent forest arrives, then draws the current tree', async () => {
  screenFacts().update({ forest: null })
  const forest = deferred<Awaited<ReturnType<RuntimeBridge['theWholeForest']>>>()
  const complete = forestOf([
    conv('fictional-source', null, { identity: 'editor' }),
    conv('fictional-reader-1', 'fictional-source', { identity: 'reader-1' }),
  ])
  runtime.whoCalledWhom.mockResolvedValueOnce(panelRead())
  runtime.theWholeForest.mockReturnValueOnce(forest.promise)
  const screen = await panelScreen()
  try {
    await expect.poll(() => screen.all('cast-sub-agents').length).toBe(1)
    expect(useWhoCalledWhom().forest.value).toBeNull()
    screen.q('main-tab-graph').click()
    await forestDrawn()
    expect(screen.all('forest-not-read')).toHaveLength(1)
    expect(screen.all('forest-row-fictional-source')).toHaveLength(0)
    forest.resolve(complete)
    await expect.poll(() => screen.all('forest-row-fictional-source').length).toBe(1)
    await forestDrawn()
    expect(screen.all('forest-not-read')).toHaveLength(0)
    expect(screen.all('forest-row-fictional-reader-1')).toHaveLength(1)
    expect(screen.q('forest-row-fictional-source').dataset.current).toBe('true')
    expect(runtime.theWholeForest).toHaveBeenCalledTimes(1)
    expect(runtime.send).not.toHaveBeenCalled()
    expect(runtime.resume).not.toHaveBeenCalled()
  } finally {
    forest.resolve(complete)
  }
})

it('reads the two file lists once per conversation opening, including mount', async () => {
  runtime.resolveLink.mockResolvedValueOnce({
    state: 'available',
    kind: 'piece',
    title: 'Target',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  })
  const screen = await screenWithLink()
  await expect.poll(() => runtime.filesKept.mock.calls.length).toBe(1)
  expect(runtime.filesKept).toHaveBeenCalledWith({
    scope: 'tree',
    conversation: 'fictional-source',
    withAdded: true,
  })
  runtime.resolveLink.mockResolvedValueOnce({
    state: 'available',
    kind: 'piece',
    title: 'Target',
    status: 'Idle',
    opens: { sessionId: 'fictional-target' },
  })
  screen.q('message-link').click()
  await expect.poll(() => runtime.filesKept.mock.calls.length).toBe(2)
  expect(runtime.filesKept).toHaveBeenLastCalledWith({
    scope: 'tree',
    conversation: 'fictional-target',
    withAdded: true,
  })
  await nextTick()
  expect(runtime.filesKept.mock.calls).toHaveLength(2)
})

it('retries a failed paired file read on the next work notice', async () => {
  await screenWithLink()
  await expect.poll(() => runtime.filesKept.mock.calls.length).toBe(1)
  const previous = useWhoCalledWhom().treeFiles.value?.files
  runtime.filesKept.mockRejectedValueOnce(new Error('fictional read failure'))
  changed({ what: 'work' })
  await expect.poll(() => useWhoCalledWhom().treeFiles.value?.answered).toBe(false)
  expect(runtime.filesKept.mock.calls).toHaveLength(2)
  expect(useWhoCalledWhom().treeFiles.value?.files).toEqual(previous)
  changed({ what: 'work' })
  await expect.poll(() => runtime.filesKept.mock.calls.length).toBe(3)
  await expect.poll(() => useWhoCalledWhom().treeFiles.value?.answered).toBe(true)
})

registerRootAttentionCases(RuntimeScreen)

it('opens Settings Skills from the agent book and closes the book without changing a skill', async () => {
  const { skills, book } = agentBookAnswers()
  const previous = Object.getOwnPropertyDescriptors(runtime)
  const previousApi = window.api
  const previousAgentStore = agentStore
  Object.assign(runtime, book)
  // The DOM wire snapshots methods when window.api is assigned.
  window.api = { ...previousApi, runtime: runtime as unknown as RuntimeBridge }
  replaceFixtureAgentStore(createAgentStore(window.api.runtime))
  const screen = mount(RuntimeScreen, {})
  try {
    useOverlays().open({ kind: 'agentSections', profileSlug: 'editor' })
    await expect.poll(() => screen.all('agent-sections-sheet').length).toBe(1)
    expect(screen.host.querySelector('[data-cy="agent-book-tab-skills"]')).not.toBeNull()
    screen.q('agent-book-tab-skills').click()
    await expect.poll(() => screen.all('agent-skills-settings').length).toBe(1)
    screen.q('agent-skills-settings').click()
    await expect.poll(() => useOverlays().overlay.value).toBeNull()
    await expect
      .poll(() => screen.q('settings-tab-skills').getAttribute('aria-selected'))
      .toBe('true')
    await expect.poll(() => screen.all('skills-section').length).toBe(1)
    expect(
      skills.mock.calls.map(([request]) => (request as { operation: string }).operation),
    ).toEqual(['profile-list', 'shared-list'])
    expect(skills.mock.calls[0]?.[0]).toEqual({ operation: 'profile-list', profileId: 'editor' })
    useOverlays().open({ kind: 'agentSections', profileSlug: 'editor' })
    await expect.poll(() => screen.all('agent-sections-sheet').length).toBe(1)
    screen.q('agent-book-tab-skills').click()
    await expect.poll(() => skills.mock.calls.length).toBe(3)
    screen.q('agent-skills-settings').click()
    await expect.poll(() => useOverlays().overlay.value).toBeNull()
    expect(screen.q('settings-tab-skills').getAttribute('aria-selected')).toBe('true')
    expect(skills.mock.calls[2]?.[0]).toEqual({ operation: 'profile-list', profileId: 'editor' })
    expect(runtime.startAndSend).not.toHaveBeenCalled()
    expect(runtime.send).not.toHaveBeenCalled()
  } finally {
    screen.unmount()
    for (const key of Object.keys(book)) {
      if (previous[key]) Object.defineProperty(runtime, key, previous[key]!)
      else Reflect.deleteProperty(runtime, key)
    }
    window.api = previousApi
    replaceFixtureAgentStore(previousAgentStore)
  }
})

it('replies that land after the screen is gone write nothing the next screen would draw', async () => {
  const memory = deferred<ProcessMemory>()
  const files = deferred<Awaited<ReturnType<RuntimeBridge['filesKept']>>>()
  runtime.processMemory.mockImplementation(() => memory.promise)
  runtime.filesKept.mockImplementation(() => files.promise)
  const cast = useWhoCalledWhom()
  const safety = useSpawnSafety()
  try {
    // Opening a conversation reads its band, and the process memory with it, and its files.
    const screen = await panelScreen()
    await expect.poll(() => runtime.processMemory.mock.calls.length).toBeGreaterThan(0)
    await expect.poll(() => runtime.filesKept.mock.calls.length).toBeGreaterThan(0)
    await expect.poll(() => safety.view.value).not.toBeNull()

    screen.unmount()
    expect(safety.view.value).toBeNull()
    memory.resolve({ conversations: [{ conversation: 'fictional-source', bytes: 1024 }] })
    files.resolve({ ok: true, files: [], added: [] })
    await new Promise((done) => setTimeout(done, 0))
    await nextTick()

    expect(cast.processMemory.value.size).toBe(0)
    expect(cast.memoryUnmeasured.value).toBeNull()
    expect(cast.treeFiles.value).toBeNull()
    expect(cast.cardFiles.value).toBeNull()
  } finally {
    memory.resolve({ conversations: [] })
    files.resolve({ ok: true, files: [], added: [] })
    runtime.processMemory.mockImplementation(async () => ({ conversations: [] }))
    runtime.filesKept.mockImplementation(async () => ({ ok: true, files: [], added: [] }))
  }
})

registerRootProviderCases(RuntimeScreen)
