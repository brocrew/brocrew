import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'
import { describe, expect, it } from 'vitest'
import type { ToolInventoryEvent } from '../../../packages/runtime/src/events'
import { runtimeEventSchema } from '../../../packages/runtime/src/events'
import { boundInventory } from '../../../packages/runtime/src/tool-inventory'
import { toolInventoryForDisplay } from '../../../packages/runtime/src/claude/inventory-display'
import { transcriptMessageForDisplay } from '../src/main/providers/error-presentation'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { carryForward, foldWindow } from '../src/renderer/src/lib/transcript-window'
import { catalogue, readInventory, statusWord } from '../src/renderer/src/lib/tool-inventory'

const inventory = (): ToolInventoryEvent => ({
  type: 'tool_inventory',
  source: 'init',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: { server: 'crew', tools: [{ name: 'read', description: 'Read', parameters: [] }] },
  published: {
    tools: ['mcp__crew__read', 'mcp__other__read'],
    servers: [
      { name: 'crew', status: 'connected' },
      { name: 'other', status: 'needs-auth' },
      { name: 'future', status: 'quantum-entangled' },
    ],
  },
})

describe('provider-owned inventory connection facts', () => {
  it('projects old Claude live/history rows without rewriting their raw records', () => {
    const raw = inventory()
    const bytes = JSON.stringify(raw)
    const message = { event: raw, at: 12 }
    const projected = transcriptMessageForDisplay(message, 'claude')
    expect(projected.event).toEqual(toolInventoryForDisplay(raw))
    expect(projected.at).toBe(12)
    expect((projected.event as ToolInventoryEvent).published?.servers).toEqual([
      { name: 'crew', status: 'connected', connectionKind: 'ready' },
      { name: 'other', status: 'needs-auth', connectionKind: 'sign-in' },
      { name: 'future', status: 'quantum-entangled' },
    ])
    expect(JSON.stringify(raw)).toBe(bytes)
    expect(transcriptMessageForDisplay(projected, 'claude')).toBe(projected)
    expect(transcriptMessageForDisplay(message, 'codex')).toBe(message)
    expect(transcriptMessageForDisplay(message)).toBe(message)
  })

  it('keeps supplied facts authoritative and absent or future words neutral', () => {
    const event = inventory()
    event.published!.servers = [
      { name: 'override', status: 'connected', connectionKind: 'disabled' },
      { name: 'future', status: 'connected', connectionKind: 'future-kind' },
      { name: 'empty', status: 'connected', connectionKind: '' },
      { name: 'opaque', status: 'constructor' },
    ]
    expect(toolInventoryForDisplay(event)).toBe(event)
    expect(statusWord('connected', 'disabled')).toEqual({
      label: 'disabled',
      tone: 'off',
      connected: false,
    })
    for (const fact of [undefined, '', 'future-kind', 'constructor'])
      expect(statusWord('connected', fact)).toEqual({
        label: 'connected',
        tone: 'unknown',
        connected: false,
      })
    const nullEvent = { ...event, published: null }
    const emptyEvent = { ...event, published: { tools: [], servers: [] } }
    expect(toolInventoryForDisplay(nullEvent)).toBe(nullEvent)
    expect(toolInventoryForDisplay(emptyEvent)).toBe(emptyEvent)
    const unrelated = { event: { type: 'status', state: 'idle' } as const, at: 1 }
    expect(transcriptMessageForDisplay(unrelated, 'claude')).toBe(unrelated)
  })

  it('carries facts through schema, bounds, fold, reclamation and all catalogue paths', () => {
    const projected = toolInventoryForDisplay(inventory())
    const bounded = boundInventory(projected)
    const event = runtimeEventSchema.parse({ ...projected, ...bounded }) as ToolInventoryEvent
    const state = createTranscript()
    applyEvent(state, event, 12)
    const rebuilt = foldWindow([], null, carryForward(state, []))
    expect(rebuilt.tools.set?.published).toEqual(projected.published)
    const reading = readInventory(rebuilt.tools)
    expect(reading.own?.connectionKind).toBe('ready')
    expect(reading.foreign.find(({ name }) => name === 'other')?.connectionKind).toBe('sign-in')
    expect(
      catalogue(reading).map(({ serverStatus, connectionKind }) =>
        statusWord(serverStatus ?? '', connectionKind),
      ),
    ).toContainEqual({ label: 'needs sign-in', tone: 'bad', connected: false })
    const unclaimed = readInventory({ ...rebuilt.tools, set: { ...event, declared: null } })
    expect(catalogue(unclaimed).some((row) => row.connectionKind === 'ready')).toBe(true)
  })
})

it.each([
  ['claude', 'connected', undefined, 'connected', 'ok', true],
  ['claude', 'needs-auth', undefined, 'needs sign-in', 'bad', false],
  ['claude', 'future-word', undefined, 'future-word', 'unknown', false],
  ['claude', 'connected', 'disabled', 'disabled', 'off', false],
  ['codex', 'connected', undefined, 'connected', 'unknown', false],
] as const)(
  'projects the real %s prior-page seed (%s/%s) before folding',
  async (provider, status, connectionKind, label, tone, connected) => {
    await withHistoryPage(
      provider,
      {
        ...inventory(),
        published: {
          tools: [],
          servers: [
            { name: 'crew', status, ...(connectionKind === undefined ? {} : { connectionKind }) },
          ],
        },
      },
      (page) => {
        expect(page.from).toBe(2)
        expect(page.entries.map((row) => row.ordinal)).toEqual([2, 3])
        expect(page.entries.every(({ event }) => event.type !== 'tool_inventory')).toBe(true)
        expect(page.toolsInForce).toMatchObject({ ordinal: 0, at: 1000 })
        const state = foldWindow(
          page.entries.map((row) => ({ ...row, sessionId: 's' })),
          null,
          null,
          page.toolsInForce,
        )
        expect(state.tools.at).toBe(1000)
        const own = readInventory(state.tools).own!
        expect(statusWord(own.status ?? '', own.connectionKind)).toEqual({ label, tone, connected })
      },
    )
  },
)

it.each([undefined, null, { tools: [], servers: [] }])(
  'preserves absent/null/empty prior-page inventories: %j',
  async (published) => {
    const event = published === undefined ? undefined : { ...inventory(), published }
    await withHistoryPage('claude', event, (page) => {
      if (event === undefined) expect(page).not.toHaveProperty('toolsInForce')
      else expect(page.toolsInForce?.event).toEqual(event)
      const state = foldWindow(
        page.entries.map((row) => ({ ...row, sessionId: 's' })),
        null,
        null,
        page.toolsInForce,
      )
      expect(state.tools.set?.published).toEqual(published)
    })
  },
)

async function withHistoryPage(
  provider: Provider,
  event: ToolInventoryEvent | undefined,
  check: (page: ReturnType<RuntimeHost['earlierHistory']>) => void,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-inventory-page-'))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  let host: RuntimeHost | undefined
  try {
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    const store = createSessionStore(db)
    store.create({
      id: 's',
      provider,
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
    if (event !== undefined) store.append('s', 0, event, 1000)
    store.append('s', 1, { type: 'user_turn', text: 'Earlier' }, 1001)
    store.append('s', 2, { type: 'user_turn', text: 'This page' }, 1002)
    store.append('s', 3, { type: 'assistant_message', text: 'Answer' }, 1003)
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => directory),
      createRuntime: () => new FakeRuntime(provider),
      resolveCwd: () => directory,
      prepareProviderHome: () => directory,
      providerHomePath: () => directory,
      newSessionId: () => 'fictional-new',
      readProviderConfig: fixtureProviderConfig,
    })
    const before = db
      .prepare('SELECT ordinal, payload FROM events WHERE session_id = ? ORDER BY ordinal')
      .all('s')
    check(host.earlierHistory('s', 4, 1))
    expect(
      db
        .prepare('SELECT ordinal, payload FROM events WHERE session_id = ? ORDER BY ordinal')
        .all('s'),
    ).toEqual(before)
  } finally {
    await host?.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
