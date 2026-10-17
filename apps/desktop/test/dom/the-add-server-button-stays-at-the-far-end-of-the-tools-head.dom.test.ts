import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ToolsRegister from '../../src/renderer/src/components/ToolsRegister.vue'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import type {
  AgentIdentities,
  ProviderCapabilityMap,
  RuntimeBridge,
} from '../../src/shared/runtime-ipc'
import { drawnReady } from './drawn'
import { mount, unmountAll } from './harness'

/**
 * ⛔ **423 M2 · the spacer in the Tools page head is what puts `Add server…` at the far end.**
 *
 * The head is copy, a `.head-spacer` with `flex: 1`, and the primary button. Nothing else in the
 * head grows, so the spacer is the only thing that takes the free space; without it the button
 * packs against the copy, a few pixels to its right, and the head reads as a sentence with a
 * button glued to it.
 *
 * ## ⚠️ Why the copy is cut to a word first
 *
 * The explanation under the title is about 130 characters at 10.5px inside a 760px head. It very
 * nearly fills the row by itself, so on the real text the button may sit at the right end whether
 * or not a spacer is there — a position assertion made on the real sentence could pass on the
 * planted defect. Cutting `tools-register-is` to a word leaves the head with a great deal of free
 * space, and then the spacer alone decides where the button lands.
 *
 * ## ⚑ Paired
 *
 * The copy is read at the LEFT end of the same head in the same mount (the page drew, and the free
 * space is real), and the button's right edge is read against the head's right edge. A button that
 * sat at the left would fail the second; a page that drew nothing would fail the first.
 */

const CAPABILITIES = {
  claude: { externalMcpServers: { state: 'available', note: 'A fixture note.' } },
  codex: { externalMcpServers: { state: 'unwired', reason: 'A fixture reason.' } },
} as unknown as ProviderCapabilityMap

const LIST: AgentIdentities = {
  identities: [],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('423 M2 · the Add server… button sits at the far end of the Tools page head', () => {
  it('🔴 with the copy cut to a word, the button ends where the head ends and the copy starts where it starts', async () => {
    const store = createAgentStore({
      agentIdentities: async () => LIST,
    } as unknown as RuntimeBridge)
    await store.load()
    const m = mount(
      ToolsRegister,
      { store, capabilities: CAPABILITIES, now: 1_700_000_000_000 },
      { width: 1100, height: 900 },
    )
    await nextTick()
    await drawnReady()

    // ⚑ The copy is static text from a constant, so cutting it in place is not fought by a render.
    const copy = m.q('tools-register-is')
    copy.textContent = 'Servers.'
    await nextTick()

    const head = m.host.querySelector<HTMLElement>('.page-head')
    expect(head, 'the page head is drawn').not.toBeNull()
    const headBox = head!.getBoundingClientRect()
    const copyBox = copy.getBoundingClientRect()
    const button = m.q('tools-add-server')
    const buttonBox = button.getBoundingClientRect()

    // ⚠️ Non-vacuous: the page drew, the button says what it says, and the head has a real width.
    expect(button.textContent?.trim()).toBe('Add server…')
    expect(headBox.width).toBeGreaterThan(400)

    // The copy is at the left end of the head, and the head has free space to spend once the copy
    // and the button are counted — a sum of widths, so it does not depend on where the button sits.
    expect(Math.abs(copyBox.left - headBox.left)).toBeLessThanOrEqual(1)
    expect(headBox.width - copyBox.width - buttonBox.width).toBeGreaterThan(200)

    // 🔴 The rule: the button's right edge IS the head's right edge.
    expect(Math.abs(buttonBox.right - headBox.right)).toBeLessThanOrEqual(1)
  })
})
