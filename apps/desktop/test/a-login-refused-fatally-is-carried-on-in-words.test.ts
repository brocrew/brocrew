import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoginRenewalOperations } from '../src/main/providers/auth-types'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { mcpRequestWorld, type McpRequestWorld } from './helpers/mcp-server-request-world'

const ORIGINAL = 'Fictional original words.'
const CONTINUATION = 'Fictional words to carry on with.'

/**
 * The shared world's fatal-auth control, witnessed through the public host: one send is accepted
 * and refused on its login, the session ends, the refused login is renewed, and the conversation
 * reopens on the same thread and carries on in the app's own words, once.
 */
describe.each(['claude', 'codex'] as const)(
  '%s · a login refused fatally is carried on in words',
  (provider) => {
    let world: McpRequestWorld
    let host: RuntimeHost
    afterEach(async () => world.cleanup())

    it('one accepted send, one fatal refusal, a renewal, a reopen on the same thread, one continuation', async () => {
      world = mcpRequestWorld()
      let renewed = false
      const renewal: LoginRenewalOperations = {
        launchLabel: 'fictional renewal',
        renew: vi.fn(async () => 'renewed' as const),
        // The sign-in reads as moved only once the refused login has been renewed.
        renewRejected: vi.fn(async () => {
          renewed = true
          return 'renewed' as const
        }),
        rejectedTurnContinuation: CONTINUATION,
        prepare: async (prepare) => ({ home: await prepare(), loginRenewed: false }),
      }
      host = world.host({ provider, loginRenewal: () => renewal })
      const id = await world.open(host)
      const failed = world.handles.get('writer')!
      Object.defineProperty(failed, 'checkSignIn', {
        value: async () => renewed,
        configurable: true,
      })
      const thread = failed.ref.sessionId

      world.failTheNextTurnOnItsLogin = { cause: 'auth' }
      await host.send(id, ORIGINAL, world.window)
      expect(world.failTheNextTurnOnItsLogin).toBeNull()

      // The reopen's row is written only once the renewed provider handle has arrived.
      await expect
        .poll(() => world.ledger(id).find((event) => event.type === 'reopened'))
        .toMatchObject({ because: 'the-sign-in-was-renewed' })
      await expect.poll(() => world.sent.map((one) => one.text).join('\n')).toContain(CONTINUATION)

      const ledger = world.ledger(id)
      const reopenedAt = ledger.findIndex((event) => event.type === 'reopened')
      const before = ledger.slice(0, reopenedAt)
      expect(
        before.filter((event) => event.type === 'user_turn' && event.text === ORIGINAL),
      ).toHaveLength(1)
      expect(before.filter((event) => event.type === 'error')).toEqual([
        expect.objectContaining({ fatal: true, cause: 'auth' }),
      ])
      expect(before.filter((event) => event.type === 'turn')).toEqual([
        expect.objectContaining({ state: 'failed', loginRefused: true }),
      ])
      expect(failed.origins).toHaveLength(1)
      expect(renewal.renewRejected).toHaveBeenCalledTimes(1)

      const resumed = world.handles.get('writer')!
      expect(resumed).not.toBe(failed)
      expect(resumed.ref.sessionId).toBe(thread)
      expect(world.launches.at(-1)?.kind).toBe('resume')
      const texts = world.sent.map((one) => one.text)
      expect(texts.filter((one) => one.includes(ORIGINAL))).toHaveLength(1)
      expect(texts.filter((one) => one.includes(CONTINUATION))).toHaveLength(1)
    })
  },
)
