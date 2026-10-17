import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { acceptLiveness } from '../../src/renderer/src/lib/session-record'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, record, unmountAll } from './harness'

const NOW = Date.now()
const original = {
  provider: 'claude',
  resetsAt: NOW + 3 * 60 * 60_000,
  asOf: NOW - 60_000,
} as const
afterEach(unmountAll)

describe('historical provider stops are visible as history', () => {
  it('both real surfaces retain current unavailable and explicitly remove a retired historical line', async () => {
    const one = reactive(record([]))
    one.meta = { ...META, providerBlockStatus: 'unavailable', providerBlockLastKnown: original }
    const page = mount(
      ConversationPane,
      paneProps({ record: one, cwd: META.cwd, drawerOpen: true }),
      { width: 1200, height: 1000 },
    )
    await nextTick()
    await drawnReady()
    expect(page.q('session-status').textContent).toBe('Current limit status unavailable')
    expect(page.q('session-bot-word').textContent).toBe('Current limit status unavailable')
    const histories = page.host.querySelectorAll<HTMLElement>('[data-cy="provider-limit-history"]')
    expect(histories).toHaveLength(2)
    for (const line of histories) {
      expect(line.textContent).toMatch(/Last known: stopped at Claude’s limit · as of /)
      assertDrawn(line, 'the dated previous stop', page.host)
    }
    acceptLiveness(one, {
      state: 'ended',
      since: NOW,
      providerBlockStatus: 'unavailable',
      providerBlockLastKnown: null,
    })
    await nextTick()
    expect(page.host.querySelectorAll('[data-cy="provider-limit-history"]')).toHaveLength(0)
    expect(page.q('session-status').textContent).toBe('Current limit status unavailable')
    expect(page.q('session-bot-word').textContent).toBe('Current limit status unavailable')
  })

  it('a real working state suppresses retained history without showing a stopped primary state', async () => {
    const one = reactive(record([{ type: 'status', state: 'working' }]))
    one.meta = { ...META, providerBlockStatus: 'unavailable', providerBlockLastKnown: original }
    const page = mount(
      ConversationPane,
      paneProps({ record: one, cwd: META.cwd, drawerOpen: true }),
      { width: 1200, height: 1000 },
    )
    await nextTick()
    expect(page.host.querySelectorAll('[data-cy="provider-limit-history"]')).toHaveLength(0)
    expect(page.q('session-status').textContent).not.toContain('limit')
  })
})
