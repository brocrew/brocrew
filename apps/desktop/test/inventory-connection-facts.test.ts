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
  type: 'tool_inventory', source: 'init', naming: { prefix: 'mcp__', separator: '__' },
  declared: { server: 'crew', tools: [{ name: 'read', description: 'Read', parameters: [] }] },
  published: { tools: ['mcp__crew__read', 'mcp__other__read'], servers: [
    { name: 'crew', status: 'connected' },
    { name: 'other', status: 'needs-auth' },
    { name: 'future', status: 'quantum-entangled' },
  ] },
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
    expect(statusWord('connected', 'disabled')).toEqual({ label: 'disabled', tone: 'off', connected: false })
    for (const fact of [undefined, '', 'future-kind', 'constructor'])
      expect(statusWord('connected', fact)).toEqual({ label: 'connected', tone: 'unknown', connected: false })
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
    expect(reading.foreign.find(({name}) => name === 'other')?.connectionKind).toBe('sign-in')
    expect(catalogue(reading).map(({ serverStatus, connectionKind }) => statusWord(serverStatus ?? '', connectionKind)))
      .toContainEqual({ label: 'needs sign-in', tone: 'bad', connected: false })
    const unclaimed = readInventory({ ...rebuilt.tools, set: { ...event, declared: null } })
    expect(catalogue(unclaimed).some((row) => row.connectionKind === 'ready')).toBe(true)
  })
})
