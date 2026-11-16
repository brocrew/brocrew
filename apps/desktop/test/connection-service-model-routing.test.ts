import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelChoice } from '@brobot2/runtime'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import type { GiveOutcome, RuntimeHost } from '../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

let world: AServiceWorld
let host: RuntimeHost
afterEach(async () => {
  await world?.cleanUp()
  vi.restoreAllMocks()
})

function accepted(answer: GiveOutcome): Extract<GiveOutcome, { ok: true }> {
  if (!answer.ok) throw new Error(answer.refusal.reason)
  return answer
}

function fixture(provider: Provider, connectionId: string | null) {
  world = aServiceWorld()
  world.anAgent('fern', 'service', provider)
  world.anAgent('caller', 'nothing kept')
  world.store.setDefaultApprovalMode('auto')
  const row = (p: Provider, id: string): ProviderConnection => ({
    id,
    provider: p,
    name: id,
    authMethod: id.endsWith(':api-key') ? 'api-key' : 'sign-in',
    credentialSource: id.endsWith(':api-key') ? 'provider-api-key' : 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  })
  for (const id of ['endpoint-a', 'endpoint-b', `${provider}:sign-in`, `${provider}:api-key`]) {
    const value = row(provider, id)
    world.db
      .prepare(
        'INSERT OR IGNORE INTO provider_connection(id, provider, name, auth_method, credential_source) VALUES(?,?,?,?,?)',
      )
      .run(id, provider, value.name, value.authMethod, value.credentialSource)
  }
  const home = vi.fn((p: Provider, profile?: string, id?: string) => {
    const path = join(world.folder, 'provider-homes', id ?? 'legacy', profile ?? 'default', p)
    world.preparedIn.push(path)
    mkdirSync(path, { recursive: true })
    return path
  })
  const models = vi.fn(
    async (_p: Provider, context: { readonly providerHome: string }): Promise<ModelChoice[]> => {
      const a = context.providerHome.includes('/endpoint-a/')
      return [
        {
          id: a ? 'model-a' : 'model-legacy',
          label: 'Default',
          isDefault: true,
          efforts: [{ id: 'medium', label: 'Medium' }],
          defaultEffort: 'medium',
        },
        {
          id: 'shared-model',
          label: 'Shared',
          efforts: a
            ? [{ id: 'medium', label: 'Medium' }]
            : [
                { id: 'medium', label: 'Medium' },
                { id: 'high', label: 'High' },
              ],
          defaultEffort: 'medium',
        },
        {
          id: 'person-model',
          label: 'Personal',
          efforts: [{ id: 'medium', label: 'Medium' }],
          defaultEffort: 'medium',
        },
      ]
    },
  )
  host = world.aHost({
    listProfiles: () => ['brobot', 'fern', 'caller'],
    ...(connectionId === null
      ? {}
      : { connectionFor: (p: Provider, id?: string | null) => row(p, id ?? `${p}:sign-in`) }),
    prepareProviderHome: home,
    modelRows: models,
  })
  world.store.setModelChoice('fern', {
    provider,
    model: 'shared-model',
    effort: 'medium',
    ...(connectionId === null ? {} : { connectionId }),
  })
  return { home, models }
}

for (const provider of ['claude', 'codex'] as const) {
  for (const scenario of [
    {
      name: 'rejects an inherited model from B',
      kind: 'wrong-model',
      route: 'endpoint-a',
      expected: 'model-a',
      effort: 'medium',
    },
    {
      name: 'rejects an inherited effort from B',
      kind: 'wrong-effort',
      route: 'endpoint-a',
      expected: 'model-a',
      effort: 'medium',
    },
    {
      name: 'keeps a whole inherited pair offered by A',
      kind: 'valid',
      route: 'endpoint-a',
      expected: 'shared-model',
      effort: 'medium',
    },
    {
      name: 'keeps the next piece explicit pair',
      kind: 'asked',
      route: 'endpoint-a',
      expected: 'shared-model',
      effort: 'medium',
    },
    {
      name: 'keeps the persons conversation pair',
      kind: 'person',
      route: 'endpoint-a',
      expected: 'person-model',
      effort: 'medium',
    },
    {
      name: 'keeps the legacy NULL path without a resolver',
      kind: 'wrong-model',
      route: null,
      expected: 'model-b',
      effort: 'high',
    },
    {
      name: 'keeps the built-in sign-in family',
      kind: 'wrong-model',
      route: 'sign-in',
      expected: 'model-b',
      effort: 'high',
    },
    {
      name: 'keeps the built-in key family',
      kind: 'wrong-model',
      route: 'api-key',
      expected: 'model-b',
      effort: 'high',
    },
  ] as const) {
    it(`${provider}: the next service piece ${scenario.name}`, async () => {
      const connectionId =
        scenario.route === 'endpoint-a' || scenario.route === null
          ? scenario.route
          : `${provider}:${scenario.route}`
      fixture(provider, connectionId)
      const caller = await world.aPersonOpens(host, 'caller')
      const one = accepted(
        await world.gives(host, caller, 'fern', { title: 'First', brief: 'First fictional piece' }),
      )
      const service = one.owner
      const turns = () =>
        world.sent.filter((turn) => turn.as === 'fern' && turn.words.includes('fictional piece'))
      await vi.waitFor(() => expect(turns()).toHaveLength(1))
      expect(world.store.connectionOf(service)).toBe(connectionId)
      if (scenario.kind === 'person') {
        host.claimSession(service, world.window)
        await host.setSessionSetting(
          service,
          { kind: 'model', model: 'person-model' },
          world.window,
        )
        expect(world.store.whatItRunsOn(service)?.aPersonChoseItAt).toEqual(expect.any(Number))
      }
      world.store.setModelChoice('fern', {
        provider,
        model:
          scenario.kind === 'valid' || scenario.kind === 'wrong-effort'
            ? 'shared-model'
            : 'model-b',
        effort: scenario.kind === 'valid' ? 'medium' : 'high',
        ...(connectionId === null ? {} : { connectionId: 'endpoint-b' }),
      })
      const two = accepted(
        await world.gives(host, caller, 'fern', {
          title: 'Second',
          brief: 'Second fictional piece',
          ...(scenario.kind === 'asked' ? { model: 'shared-model', effort: 'medium' } : {}),
        }),
      )
      expect(two.owner).toBe(service)
      expect(
        world.store.piecesOwnedBy(service).find((piece) => piece.piece === two.piece)?.state,
      ).toBe('waiting')
      const reply = await host.replyToParent(
        {
          piece: one.label,
          outcome: 'done',
          summary: 'First finished.',
          resourcePaths: [],
          needsUserAction: false,
        },
        { ownerId: agentCallerId(service) },
      )
      expect(reply.ok).toBe(true)
      await vi.waitFor(() => expect(turns()).toHaveLength(2))
      expect(turns().map((turn) => ({ model: turn.model, effort: turn.effort }))).toEqual([
        { model: 'shared-model', effort: 'medium' },
        { model: scenario.expected, effort: scenario.effort },
      ])
      expect(world.store.connectionOf(service)).toBe(connectionId)
      expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(
        connectionId === null ? undefined : 'endpoint-b',
      )
      expect(
        world.store.piecesOwnedBy(service).find((piece) => piece.piece === one.piece)?.state,
      ).toBe('answered')
    })
  }
}
