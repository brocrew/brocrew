import { vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createLifecycleAgentBridge } from '../../src/main/plugins/lifecycle/agent-bridge'
import { sharedLifecycleWorkspaces } from '../../src/main/plugins/lifecycle/workspaces'
import { fixture } from '../plugin-lifecycle-fixtures'
import type { WorkspaceLease } from '../../src/main/plugins/supervisor/owner'
import type { Command } from '../../src/main/plugins/supervisor/protocol'
import type { BrokerInput } from '../../src/main/plugins/tool-broker'

export const closes: (() => Promise<unknown>)[] = []
export const request = (
  workspaceId: string,
  incarnation = randomUUID(),
): Extract<Command, { kind: 'agent-routes' }> => ({
  kind: 'agent-routes',
  workspaceId,
  incarnation,
  workspace: 'a'.repeat(64),
  generation: randomUUID(),
  lease: 'b'.repeat(64),
  occupied: ['brobot'],
  release: false,
})
export const lease = (): WorkspaceLease => ({
  id: randomUUID(),
  workspace: 'a'.repeat(64),
  generation: randomUUID(),
  epoch: randomUUID(),
  counter: 0,
  renewedAt: 0,
  minor: 0,
  features: [],
})
export async function live(
  change: {
    routeTrace?: (event: unknown) => void
    firstExit?: Promise<void>
    firstStop?: () => Promise<void>
    now?: () => number
    recoverChromeHost?: (
      view: ReturnType<ReturnType<typeof sharedLifecycleWorkspaces>['agentAttachments']>[number],
      stopped: () => void,
    ) => Promise<void>
  } = {},
) {
  const { firstExit, firstStop, ...bridgeChange } = change
  const consumer: { bridge?: ReturnType<typeof createLifecycleAgentBridge> } = {}
  const f = await fixture({
    deny: (id) => consumer.bridge?.deny(id),
    toolsUnavailable: (id) => consumer.bridge?.toolsUnavailable?.(id) ?? false,
    toolsCause: (id) => consumer.bridge?.toolsCause?.(id),
    onChromeHostExit: (runId) => consumer.bridge?.hostExited?.(runId),
  })
  if (firstExit || firstStop) {
    const start = f.opts.runtime.start.bind(f.opts.runtime)
    let first = true
    f.opts.runtime.start = async (spec) => {
      const run = await start(spec)
      if (!first) return run
      first = false
      return { ...run, exited: firstExit ?? run.exited, stop: firstStop ?? run.stop }
    }
  }
  await f.controller.detach(f.handle)
  const controller = sharedLifecycleWorkspaces(f.controller)
  const person = await controller.attach(f.local.sink)
  await controller.install(person, 'chrome')
  let allowed = true
  const revoked = new Set<string>()
  const call = vi.fn()
  const binding = vi.fn(async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Fictional echo',
        inputSchema: { type: 'object' },
        prepare: (input: BrokerInput) => ({
          input,
          resources: [{ resource: 'profiles', key: 'fern', mode: 'read' as const }],
        }),
      },
    ],
    resources: [{ id: 'profiles', read: true, write: false }],
    adminOperations: [],
    isAllowed: () => allowed,
    server: {
      tool() {
        call()
        return {
          result: Promise.resolve({
            ok: true as const,
            value: { content: [{ type: 'text', text: 'fictional fern' }] },
          }),
          quiescent: Promise.resolve(),
          cancel() {},
        }
      },
      admin() {
        throw new Error('person surface must stay private')
      },
    },
  }))
  const diagnostic = vi.fn()
  const bridge = createLifecycleAgentBridge({
    controller,
    owner: { valid: (id) => !revoked.has(id) },
    binding,
    diagnostic,
    ...bridgeChange,
  })
  consumer.bridge = bridge
  closes.push(() => bridge.close())
  return {
    ...f,
    controller,
    person,
    bridge,
    binding,
    call,
    diagnostic,
    revokeLease: (one: WorkspaceLease) => {
      revoked.add(one.id)
      bridge.revoke(one)
    },
    allow: (v: boolean) => {
      allowed = v
    },
  }
}
