import { describe, expect, it } from 'vitest'
import { publishedServerForDisplay } from '../src/claude/inventory-display'
import { boundInventory, MAX_STATUS_WORD } from '../src/tool-inventory'
import { runtimeEventSchema } from '../src/events'

describe('Claude inventory connection interpretation', () => {
  it.each([
    ['connected', 'ready'],
    ['failed', 'failed'],
    ['needs-auth', 'sign-in'],
    ['pending', 'connecting'],
    ['disabled', 'disabled'],
  ])('supplies %s as %s while retaining the native word', (status, connectionKind) => {
    const server = { name: 'crew', status }
    expect(publishedServerForDisplay(server)).toEqual({ ...server, connectionKind })
    expect(server).toEqual({ name: 'crew', status })
  })

  it('leaves unknown native words and supplied facts untouched', () => {
    for (const server of [
      { name: 'future', status: 'quantum-entangled' },
      { name: 'future', status: 'constructor' },
      { name: 'supplied', status: 'connected', connectionKind: '' },
      { name: 'supplied', status: 'connected', connectionKind: 'future-kind' },
    ])
      expect(publishedServerForDisplay(server)).toBe(server)
  })

  it('bounds and validates portable facts without manufacturing absent facts', () => {
    const bounded = boundInventory({
      naming: { prefix: '', separator: '__' },
      declared: null,
      published: {
        tools: [],
        servers: [
          { name: 'absent', status: 'connected' },
          { name: 'future', status: 'new', connectionKind: 'x'.repeat(MAX_STATUS_WORD + 1) },
        ],
      },
    })
    const event = runtimeEventSchema.parse({ type: 'tool_inventory', source: 'init', ...bounded })
    expect(event).toMatchObject({
      published: {
        servers: [
          { name: 'absent', status: 'connected' },
          { name: 'future', status: 'new', connectionKind: 'x'.repeat(MAX_STATUS_WORD - 1) + '…' },
        ],
      },
    })
    expect(bounded.published?.servers[0]).not.toHaveProperty('connectionKind')
  })
})
