import {
  installRuntimeScreenFixture,
  disposeRuntimeScreenFixture,
  runtime,
  sessions,
  agentBookAnswers,
} from './runtime-screen-fixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { SavedDrafts } from '../../src/shared/saved-drafts'
import { newAgentDraftSlot } from '../../src/shared/saved-drafts'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { mount, META } from './harness'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import ConversationRow from '../../src/renderer/src/components/ConversationRow.vue'
import SignInPanel from '../../src/renderer/src/components/SignInPanel.vue'
import {
  DEFAULT_PROFILE_ID,
  type ResumableSessionInfo,
  type RuntimeBridge,
} from '../../src/shared/runtime-ipc'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')
beforeEach(installRuntimeScreenFixture)
afterEach(disposeRuntimeScreenFixture)

async function open() {
  const saves: SavedDrafts[] = []
  let lastSave: (() => void) | undefined
  window.api = {
    ...window.api,
    saveDrafts: async (saved: SavedDrafts) => {
      saves.push(saved)
    },
    onLastDraftSave: (listener: () => void) => {
      lastSave = listener
      return () => {
        lastSave = undefined
      }
    },
  }
  const view = mount(RuntimeScreen, {}, { width: 1200, height: 800 })
  useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
  await expect.poll(() => view.all('start-as-agent').length).toBe(1)
  const sheet = view.q('start-as-agent')
  await expect.poll(() => sheet.querySelector('[data-cy="prompt-input"]')).not.toBeNull()
  const box = sheet.querySelector<HTMLTextAreaElement>('[data-cy="prompt-input"]')!
  box.value = 'A sheet draft before creation'
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  return { view, sheet, box, saves, lastSave: () => lastSave?.() }
}

it('last-save and unmount keep a submitted sheet draft while create is still pending', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  runtime.createSession.mockImplementationOnce(async () => {
    await pending
    throw new Error('Fictional launch refused')
  })
  const { view, sheet, box, saves, lastSave } = await open()
  ;(sheet.querySelector('[data-cy="send-prompt"]') as HTMLButtonElement).click()
  await expect.poll(() => runtime.createSession.mock.calls.length).toBe(1)
  expect(box.value).toBe('A sheet draft before creation')
  lastSave()
  await nextTick()
  expect(saves.at(-1)).toMatchObject({
    last: true,
    drafts: [
      { slot: newAgentDraftSlot('editor'), text: 'A sheet draft before creation', attached: [] },
    ],
  })
  view.unmount()
  expect(saves.at(-1)?.drafts).toContainEqual({
    slot: newAgentDraftSlot('editor'),
    text: 'A sheet draft before creation',
    attached: [],
  })
  release()
  await expect.poll(() => sessions.isPlacing()).toBe(false)
  expect(runtime.send).not.toHaveBeenCalled()
})

it('closing and reopening the Team launcher keeps the draft from a pending start', async () => {
  let finish!: () => void
  runtime.createSession.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return { refused: { reason: 'cancelled', said: 'The launch was cancelled.' } }
  })
  const { view, sheet, saves, lastSave } = await open()
  ;(sheet.querySelector('[data-cy="send-prompt"]') as HTMLButtonElement).click()
  await expect.poll(() => view.all('cancel-launch').length).toBe(1)
  ;(sheet.querySelector('[data-cy="close-overlay"]') as HTMLButtonElement).click()
  await expect.poll(() => runtime.cancelLaunch).toHaveBeenCalledTimes(1)
  finish()
  await expect.poll(() => sessions.isPlacing()).toBe(false)
  lastSave()
  expect(saves.at(-1)?.drafts).toContainEqual({
    slot: newAgentDraftSlot('editor'),
    text: 'A sheet draft before creation',
    attached: [],
  })
  useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
  await expect
    .poll(
      () =>
        view.host.querySelector<HTMLTextAreaElement>('[data-cy="start-as-agent"] textarea')?.value,
    )
    .toBe('A sheet draft before creation')
})

const scopeOf = (component: unknown): string => (component as { __scopeId: string }).__scopeId

function recent(profileId: string): ResumableSessionInfo {
  return {
    sessionId: `recent-${profileId}`,
    provider: 'claude',
    cwd: '/fictional/work',
    status: 'idle',
    state: { is: 'idle' },
    named: { label: 'W9', title: 'Recent work' },
    approvalMode: 'ask',
    profileId,
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: null,
    hasTranscript: true,
    child: null,
    lastEnding: 'completed',
    updatedAt: 1_700_000_000_000,
    running: 'not-running',
    ref: {
      provider: 'claude',
      sessionId: `thread-${profileId}`,
      cwd: '/fictional/work',
      rotation: 0,
    },
    resumeRefusal: null,
  }
}

async function launcherFrom(entry: 'front' | 'team', folder?: string) {
  window.api = {
    ...window.api,
    chooseCwd: async () => (folder === undefined ? null : { path: folder }),
    runtime: {
      ...window.api.runtime,
      ...agentBookAnswers().book,
      listConversations: async () => ({
        resumable: [recent(DEFAULT_PROFILE_ID), recent('editor')],
        unresumable: [],
        published: {
          epoch: { run: 'launcher-fixture', n: 0 },
          seq: 1,
          covers: { population: 'listing', complete: true },
        },
      }),
    },
  }
  const view = mount(RuntimeScreen, {}, { width: 1200, height: 900 })
  if (entry === 'team') {
    view.q('rail-team').click()
    await expect.poll(() => view.all('team-tab-roster').length).toBe(1)
    view.q('team-tab-roster').click()
    await expect.poll(() => view.all('team-open-editor').length).toBe(1)
    view.q('team-open-editor').click()
    await expect.poll(() => view.all('capabilities-start-conversation').length).toBe(1)
    view.q('capabilities-start-conversation').click()
  } else {
    view.q('new-conversation').click()
  }
  await expect.poll(() => view.all('new-conversation-surface').length).toBe(1)
  return view
}

it.each([
  { entry: 'front', profileId: DEFAULT_PROFILE_ID, folder: undefined },
  { entry: 'team', profileId: 'editor', folder: undefined },
  { entry: 'team', profileId: 'editor', folder: '/fictional/repository' },
] as const)(
  'mounts the shared launcher and rows and sends from $entry with folder $folder',
  async ({ entry, profileId, folder }) => {
    const view = await launcherFrom(entry, folder)
    const form = view.q('new-conversation-surface')
    expect(form.hasAttribute(scopeOf(NewConversation))).toBe(true)
    await expect
      .poll(() =>
        form.querySelector(`[data-cy="recent-conversation-recent-${profileId}"] .conversation-row`),
      )
      .not.toBeNull()
    const row = form.querySelector('.recent-grid .conversation-row')!
    expect(row.hasAttribute(scopeOf(ConversationRow))).toBe(true)
    expect(row.textContent).toContain('W9 · Recent work')
    expect(row.closest('button')?.getAttribute('aria-label')).toContain('W9 · Recent work')
    const otherProfile = entry === 'front' ? 'editor' : DEFAULT_PROFILE_ID
    expect(form.querySelector(`[data-cy="recent-conversation-recent-${otherProfile}"]`)).toBeNull()
    if (folder !== undefined) {
      view.q('start-as-agent-choose-folder').click()
      await expect.poll(() => view.q('start-as-agent-folder').textContent).toBe(folder)
    }
    await expect.poll(() => view.all('prompt-input').length).toBe(1)
    const words = 'Send these words from the shared launcher.'
    const box = view.q('prompt-input') as HTMLTextAreaElement
    box.value = words
    box.dispatchEvent(new Event('input', { bubbles: true }))
    const send = vi.spyOn(sessions, 'send').mockResolvedValue(true)
    try {
      const sessionId = 'fresh-launcher-conversation'
      runtime.createSession.mockResolvedValueOnce({ ...META, sessionId, profileId })
      const button = view.q('send-prompt') as HTMLButtonElement
      await expect.poll(() => button.disabled).toBe(false)
      button.click()
      await expect.poll(() => send.mock.calls.length).toBe(1)
      const input = runtime.createSession.mock.calls[0]![0]
      expect(input.profileId).toBe(profileId)
      if (folder === undefined) expect(input).not.toHaveProperty('cwd')
      else expect(input.cwd).toBe(folder)
      expect(send).toHaveBeenCalledWith(sessionId, words, 'now', [])
    } finally {
      send.mockRestore()
    }
  },
)

it.each(['front', 'team'] as const)(
  'shows the shared sign-in panel for %s after a signed-out launch',
  async (entry) => {
    const view = await launcherFrom(entry)
    await expect.poll(() => view.all('prompt-input').length).toBe(1)
    const check = vi.fn<RuntimeBridge['checkProviderAuth']>().mockResolvedValue({
      state: 'absent',
      why: 'no-login',
      reason: 'The fictional account is signed out.',
    })
    window.api = {
      ...window.api,
      runtime: { ...window.api.runtime, checkProviderAuth: check },
    }
    let finish!: () => void
    runtime.createSession.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { refused: { reason: 'sign-in', said: 'Sign in to start this conversation.' } }
    })
    const input = view.q('prompt-input') as HTMLTextAreaElement
    input.value = 'Keep this draft while signing in.'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    view.q('send-prompt').click()
    await expect.poll(() => view.all('cancel-launch').length).toBe(1)
    finish()
    await expect.poll(() => view.all('sign-in-panel').length).toBe(1)
    expect(view.q('sign-in-panel').hasAttribute(scopeOf(SignInPanel))).toBe(true)
    expect(view.q('sign-in-panel').textContent).toContain('The fictional account is signed out.')
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: entry === 'front' ? DEFAULT_PROFILE_ID : 'editor',
      }),
    )
    expect(input.value).toBe('Keep this draft while signing in.')
    expect(runtime.send).not.toHaveBeenCalled()
  },
)
