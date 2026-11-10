import {
  agentStore,
  runtime,
  agentBookAnswers,
  installRuntimeScreenFixture,
  disposeRuntimeScreenFixture,
} from '../../test/dom/runtime-screen-fixture'
import { afterEach, expect } from 'vitest'
import { useOverlays, type Overlay } from '../../src/renderer/src/lib/overlay-store'
import { LISTED } from '../../test/dom/delete-conversation-fixture'
import { scene } from '../capture'
import { wearTheme } from '../fixtures/themes'

// Register the fixture's mocks before loading the root's composable imports.
const { default: RuntimeScreen } = await import('../../src/renderer/src/components/RuntimeScreen.vue')

const sheets = {
  newAgent: { overlay: { kind: 'newAgent' }, ready: 'new-agent' },
  externalMcpServers: {
    overlay: { kind: 'externalMcpServers' },
    ready: 'external-mcp-registry',
  },
  agentSections: {
    overlay: { kind: 'agentSections', profileSlug: 'editor' },
    ready: 'agent-sections-sheet',
  },
  agentCapabilities: {
    overlay: { kind: 'agentCapabilities', profileSlug: 'editor' },
    ready: 'capabilities-sheet',
  },
  startAsAgent: {
    overlay: { kind: 'startAsAgent', profileSlug: 'editor' },
    ready: 'start-as-agent',
  },
  deleteConversation: {
    overlay: { kind: 'deleteConversation', sessionId: LISTED.conversation },
    ready: 'delete-conversation',
  },
} satisfies Record<string, { overlay: Overlay; ready: string }>

const env = import.meta.env as Record<string, string | undefined>
const sheet = env['LOOK_SHEET'] ?? 'newAgent'
const theme = env['LOOK_THEME'] ?? 'defined'
if (!Object.hasOwn(sheets, sheet)) throw new Error(`Unknown overlay sheet: ${sheet}`)
if (theme !== 'defined' && theme !== 'synthwave') throw new Error(`Unknown overlay theme: ${theme}`)
const chosen = sheets[sheet as keyof typeof sheets]

afterEach(disposeRuntimeScreenFixture)

scene('runtime-overlays', async (stage) => {
  Object.assign(runtime, agentBookAnswers().book, {
    checkDeleteConversation: async () => LISTED,
    agentModelAndEffort: async () => null,
  })
  installRuntimeScreenFixture()
  wearTheme(theme)
  const screen = stage.mount(RuntimeScreen, {})
  await expect.poll(() => agentStore.loaded.value).toBe(true)
  useOverlays().open(chosen.overlay)
  await expect.poll(() => screen.all(chosen.ready).length).toBe(1)
  if (sheet === 'agentSections' || sheet === 'agentCapabilities') {
    await expect.poll(() => screen.all('own-instructions-read-at').length).toBe(1)
    expect(screen.all('own-instructions-unreadable')).toHaveLength(0)
  }
  if (sheet === 'agentCapabilities') {
    await expect.poll(() => screen.all('agent-model-loading').length).toBe(0)
    expect(screen.all('agent-model-unreadable')).toHaveLength(0)
  }
  if (sheet === 'deleteConversation') {
    await expect.poll(() => screen.all('delete-reading').length).toBe(0)
    expect(screen.q('delete-title').textContent).toBe(`Delete ${LISTED.name}?`)
  }
})
