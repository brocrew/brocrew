import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import PermissionCard from '../../src/renderer/src/components/PermissionCard.vue'
import type { PermissionItem, PermissionOutcome } from '../../src/renderer/src/lib/transcript'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # W4.42 · an MCP server's link card has a Copy link button (`cd842ee3`)
 *
 * ⚑ Gabi: *"a copy button or link control for the server's link"*. One press copies the address the
 * server asked the person to open; the card then says *"Copied. Open it in your browser, then answer
 * here."*, or, when the system refuses, *"Couldn’t copy it. Select the link in the text below
 * instead."*
 *
 * ⛔ **Shown only for a plain `http(s)` address of at most 4,096 characters, with no control, format
 * or line-separator characters** — at least as strict as the runtime's rule for showing the link on
 * the card, so it never copies a link the card withheld. ⛔ Not shown once the card is answered.
 *
 * ⚠️ **The clipboard is stood in for**: a headless runner's `navigator.clipboard` asks for a
 * permission no test can grant, and the assertion is what the card hands it and what it says after.
 * The stand-in is an own property on `navigator`, removed after each test.
 */

afterEach(unmountAll)

const NOW = 1_700_000_000_000

const SCOPE = {
  cwd: '/work',
  paths: [],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow', 'deny', 'cancel'] as PermissionOutcome[],
  underDisclosed: true,
}

const LINK = 'https://kibana.example.test/oauth/authorize?client_id=brobot&state=abc123'

/** A server's url card — the request a granted MCP server raises to have a page opened. */
const linkCard = (
  url: string | undefined,
  over: Partial<PermissionItem> = {},
): PermissionItem & { at: number } => ({
  kind: 'permission',
  id: 'item_link',
  request: {
    type: 'permission_request',
    id: 'req_link',
    kind: 'command',
    action: 'kibana',
    detail: `kibana asks you to open a page: ${url ?? ''}`,
    mcpServerAsks: url === undefined ? { server: 'kibana' } : { server: 'kibana', url },
    cancelStopsNothing: true,
    scope: SCOPE,
  } as PermissionItem['request'],
  outcome: null,
  note: null,
  refused: null,
  at: NOW,
  ...over,
})

let copied: string[] = []
let refuse = false

beforeEach(() => {
  copied = []
  refuse = false
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string): Promise<void> => {
        if (refuse) throw new DOMException('Write permission denied.', 'NotAllowedError')
        copied.push(text)
      },
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

const settled = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
const said = (m: Mounted): string =>
  text(
    m.q('permission-server-link').querySelector('[role="status"]') ?? document.createElement('i'),
  )

describe('cd842ee3 · Copy link — one press copies the server’s address', () => {
  it('🔴 a press copies the address exactly, and the card says what to do next', async () => {
    const m = mount(PermissionCard, { item: linkCard(LINK) })
    expect(text(m.q('permission-copy-link'))).toBe('Copy link')
    // ⚑ Nothing is said before the press.
    expect(said(m)).toBe('')
    m.q('permission-copy-link').click()
    await settled()
    expect(copied).toEqual([LINK])
    expect(said(m)).toBe('Copied. Open it in your browser, then answer here.')
  })

  it('⛔ a clipboard that refuses: the card says so and points at the text, and claims no copy', async () => {
    refuse = true
    const m = mount(PermissionCard, { item: linkCard(LINK) })
    m.q('permission-copy-link').click()
    await settled()
    expect(copied).toEqual([])
    expect(said(m)).toBe('Couldn’t copy it. Select the link in the text below instead.')
    expect(said(m)).not.toContain('Copied')
  })

  it('⚑ a plain http address on this machine is a link too', async () => {
    const local = 'http://127.0.0.1:8765/callback?code=xyz'
    const m = mount(PermissionCard, { item: linkCard(local) })
    m.q('permission-copy-link').click()
    await settled()
    expect(copied).toEqual([local])
  })
})

describe('cd842ee3 · Copy link is offered only for a link the card would show', () => {
  const offered = (url: string | undefined): boolean => {
    const m = mount(PermissionCard, { item: linkCard(url) })
    const shown = m.all('permission-copy-link').length === 1
    m.unmount()
    return shown
  }

  it('⚑ the control: a plain https address is offered', () => {
    expect(offered(LINK)).toBe(true)
  })

  it('⛔ a server card with no address offers nothing to copy', () => {
    expect(offered(undefined)).toBe(false)
  })

  it('⛔ any scheme but http(s) is not offered', () => {
    expect(offered('javascript:alert(1)')).toBe(false)
    expect(offered('ftp://kibana.example.test/file')).toBe(false)
    expect(offered('file:///etc/passwd')).toBe(false)
    expect(offered('kibana.example.test/oauth')).toBe(false)
  })

  it('🔴 an address with a space, a control, a format or a line-separator character is not offered', () => {
    expect(offered('https://kibana.example.test/a b')).toBe(false)
    expect(offered('https://kibana.example.test/\u0007')).toBe(false)
    // ⚠️ A right-to-left override would show one address and copy another.
    expect(offered('https://kibana.example.test/‮gnp.exe')).toBe(false)
    expect(offered('https://kibana.example.test/​hidden')).toBe(false)
    expect(offered('https://kibana.example.test/ next')).toBe(false)
    expect(offered('https://kibana.example.test/ next')).toBe(false)
    expect(offered('https://kibana.example.test/\nnext')).toBe(false)
  })

  it('🔴 at most 4,096 characters: exactly that many is offered, one more is not', () => {
    const base = 'https://kibana.example.test/'
    const exactly = base + 'a'.repeat(4096 - base.length)
    expect(exactly).toHaveLength(4096)
    expect(offered(exactly)).toBe(true)
    expect(offered(`${exactly}a`)).toBe(false)
  })

  it('🔴 an answered card no longer offers it — the unanswered one does', () => {
    expect(offered(LINK)).toBe(true)
    const answered = mount(PermissionCard, {
      item: linkCard(LINK, { outcome: 'allow' as PermissionOutcome }),
    })
    expect(answered.all('permission-copy-link')).toHaveLength(0)
    expect(answered.all('permission-server-link')).toHaveLength(0)
  })

  it('⛔ an answered card opened again shows what was asked, and still no link to copy (3018 M4)', async () => {
    const answered = mount(PermissionCard, {
      item: linkCard(LINK, { outcome: 'allow' as PermissionOutcome }),
    })
    answered.q('permission-answered').click()
    await nextTick()
    // ⚑ The premise: opened, its body is drawn again — the request a person answered.
    expect(answered.q('permission-card').getAttribute('data-open')).toBe('true')
    expect(answered.q('permission-action').textContent?.trim()).not.toBe('')
    // ⛔ …and the server's link is not offered on a card that was already answered.
    expect(answered.all('permission-copy-link')).toHaveLength(0)
    expect(answered.all('permission-server-link')).toHaveLength(0)
  })
})
