import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationRow from '../../src/renderer/src/components/ConversationRow.vue'
import type { ConversationRowView } from '../../src/renderer/src/lib/conversation-row'
import { mount, unmountAll } from './harness'

/**
 * The one conversation row: what each form draws, in what order, and where the provider's name
 * comes from. Every list that shows a conversation mounts this, so these hold for all of them.
 */
const SUPPLIED = PROVIDER_DESCRIPTORS.map((one) => ({ ...one, displayName: `Supplied ${one.id}` }))

const VIEW: ConversationRowView = {
  id: 'sess_sample',
  facets: { doing: 'working' },
  plateLabel: 'Ada',
  head: 'plain',
  canonical: true,
  title: 'W1.2 · Landing page header',
  marks: [{ key: 'archived', text: 'Archived', tone: 'archived', cy: 'sample-mark' }],
  status: {
    profile: 'Ada',
    provider: PROVIDER_DESCRIPTORS[0]!.id,
    word: 'working',
    place: 'sample-site',
    tail: [{ text: 'Status: open', cy: 'sample-tail' }],
  },
  address: 'W1.2',
  addressProvider: PROVIDER_DESCRIPTORS[0]!.id,
  namedByYou: true,
  pieces: [{ key: 'one', text: 'Header copy', cy: 'sample-piece' }],
}

const words = (element: Element | null): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim()

async function settle(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}

beforeEach(() => {
  window.api = { runtime: { providerCatalogue: async () => SUPPLIED } } as never
})
afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
})

describe('ConversationRow', () => {
  // First in the file: the catalogue is read once per window, and here it has not answered.
  it('says no provider word, and no separator for one, while the catalogue has no answer', async () => {
    window.api = { runtime: {} } as never
    const m = mount(ConversationRow, { row: VIEW }, { width: 480 })
    await settle()
    expect(m.host.querySelectorAll('.provider-label')).toHaveLength(0)
    expect(words(m.host.querySelector('#row-state-sess_sample'))).toBe(
      'Ada · working · sample-site · Status: open',
    )
    expect(m.host.textContent).toContain('Conversation W1.2 · Named by you')
    expect(m.host.textContent).not.toContain(PROVIDER_DESCRIPTORS[0]!.id)
  })

  it('full: plate, title with its marks, then the status, the address and the pieces', async () => {
    const m = mount(
      ConversationRow,
      { row: VIEW, cy: { title: 'sample-title', word: 'sample-word' } },
      { width: 480 },
    )
    await settle()
    const supplied = SUPPLIED[0]!.displayName
    expect(m.host.querySelector('[data-size]'), 'the plate').not.toBeNull()
    expect(words(m.q('sample-title'))).toBe('W1.2 · Landing page header')
    expect(m.q('sample-mark').closest('strong'), 'a mark sits beside the title').toBeNull()
    expect(m.q('sample-mark').classList.contains('archived')).toBe(true)
    expect(words(m.host.querySelector('#row-state-sess_sample'))).toBe(
      `Ada · ${supplied} · working · sample-site · Status: open`,
    )
    expect(words(m.q('sample-word'))).toBe('working')
    expect(words(m.q('sample-tail'))).toBe('Status: open')
    expect(m.host.textContent).toContain(`Conversation W1.2 · ${supplied} · Named by you`)
    expect(words(m.q('sample-piece'))).toBe('Header copy')
  })

  it('names the provider only as the catalogue supplies it, never by its id', async () => {
    const m = mount(ConversationRow, { row: VIEW }, { width: 480 })
    await settle()
    const labels = [...m.host.querySelectorAll('.provider-label')].map(words)
    expect(labels).toEqual([SUPPLIED[0]!.displayName, SUPPLIED[0]!.displayName])
  })

  it('compact: the title and the status on one line, with no address or pieces', async () => {
    const m = mount(
      ConversationRow,
      { row: VIEW, form: 'compact', cy: { title: 'sample-title' } },
      { width: 900 },
    )
    await settle()
    const title = m.q('sample-title').getBoundingClientRect()
    const status = m.host.querySelector('#row-state-sess_sample')!.getBoundingClientRect()
    expect(Math.abs(title.top + title.height / 2 - (status.top + status.height / 2))).toBeLessThan(
      4,
    )
    expect(m.host.textContent).not.toContain('Conversation W1.2')
    expect(m.host.querySelector('[data-cy="sample-piece"]')).toBeNull()
  })

  it('draws no plate for a row with no live state', async () => {
    const m = mount(ConversationRow, { row: { ...VIEW, facets: null } }, { width: 480 })
    await settle()
    expect(m.host.querySelector('[data-size]')).toBeNull()
  })

  it('a list keeps its own ids, so two lists can show the same conversation at once', async () => {
    const m = mount(ConversationRow, { row: VIEW, idPrefix: 'rail' }, { width: 480 })
    await settle()
    expect(m.host.querySelector('#rail-state-sess_sample')).not.toBeNull()
    expect(m.host.querySelector('#row-state-sess_sample')).toBeNull()
  })
})
