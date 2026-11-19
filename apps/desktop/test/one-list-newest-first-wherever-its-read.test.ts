import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { callOn, listedAgentIds } from './helpers/call-tool'

describe('one list of running and stopped conversations', () => {
  let world: AServiceWorld
  let host: RuntimeHost

  beforeEach(() => {
    world = aServiceWorld()
    world.clock = Date.UTC(2030, 0, 1)
    host = world.aHost()
  })

  afterEach(async () => world.cleanUp())

  const personOpens = async (profileId: string): Promise<string> => {
    if (profileId !== DEFAULT_PROFILE_ID) world.anAgent(profileId, 'normal')
    const opened = (await executeRuntimeCommand(host, world.window, {
      kind: 'createSession',
      provider: 'claude',
      profileId,
      approvalMode: 'ask',
      cwd: world.folder,
    })) as { sessionId: string }
    return opened.sessionId
  }

  describe('§1 · list_agents: newest activity first, running and stopped merged', () => {
    /**
     * 🔴 **The sort itself, unsorted** — every existing test that reads `list_agents`' output
     * compares membership without order, so a reversed comparator in
     * `conversationDirectoryPage` survives the whole suite up to this file. ⚑ **The pre-close read is
     * its own positive control**: the two reads below disagree only in `worker1`'s position, so an
     * assertion the sort could satisfy by coincidence would have to coincide twice.
     */
    it("list_agents orders newest activity first, and closing an older conversation moves it back to the front of a running one's", async () => {
      // ⚑ **BroBot opens first**; the whole test is about ORDER.
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const brobotTools = agentToolsFor(host, 'unrecorded-test-caller')
      // ⛔ **Strict sequence.** Each `personOpens` call advances the shared clock (`tick`), so
      // creation order is a strictly increasing `updatedAt` — worker3 is the newest thing this app
      // has recorded the moment it opens.
      const worker1 = await personOpens('worker1')
      const worker2 = await personOpens('worker2')
      const worker3 = await personOpens('worker3')

      expect(await listedAgentIds(brobotTools)).toEqual([worker3, worker2, worker1, brobot])

      // 🔴 **worker1 stops** — the last write this store sees before the second read.
      await host.close(worker1, world.window)

      // ⛔ **worker1 jumps to the front of the others.** Stopping is activity: a stopped conversation is read off
      // the same walk as a running one (D-017 R2/R12), sorted by the same clock — not appended at
      // the end of the list, and not dropped back to its creation-order slot.
      expect(await listedAgentIds(brobotTools)).toEqual([worker1, worker3, worker2, brobot])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · a stopped conversation stays readable and listed, never folded into no-such-agent
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · stopped conversations remain readable', () => {
    it('a stopped conversation remains readable when messaging is narrowed', async () => {
      const manager = await personOpens('pm')
      const brobotTools = agentToolsFor(host, await personOpens(DEFAULT_PROFILE_ID))
      const explorerTools = agentToolsFor(host, await personOpens('explorer'))
      expect(world.store.setCapabilities('explorer', { canMessage: 'none' })).toBe(true)
      expect({
        defaultReach: world.store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage,
        explorerReach: world.store.capabilitiesOf('explorer')?.canMessage,
        managerParent: world.store.parentOf(manager),
      }).toEqual({ defaultReach: 'any', explorerReach: 'none', managerParent: null })

      // 🔴 **The target stops.**
      await host.close(manager, world.window)

      expect(await callOn(explorerTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { state: 'idle' },
      })
      const said = await callOn(explorerTools, 'message_agent', {
        agent: manager,
        text: 'anything at all',
        // ⚑ **D-016 · a note** — a follow-up names a piece the sender gave, and this caller gave none.
        kind: 'note',
      })
      expect(said).toMatchObject({ outcome: 'refused', rail: 'may-not-message' })
      expect(said['detail']).toStrictEqual({ reach: 'none' })
      expect(await listedAgentIds(explorerTools)).toContain(manager)

      // ⚑ **THE PAIRED POSITIVE — the granted caller, over the identical stopped id.**
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { state: 'idle' },
      })
      expect(await listedAgentIds(brobotTools)).toContain(manager)
    })
  })
})
