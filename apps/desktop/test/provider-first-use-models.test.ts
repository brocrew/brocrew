import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { acceptedGive, aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('a model lookup before the first use of another provider', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld({ holderReminders: 'declined' })
    world.anAgent('draft-reader', 'normal', 'claude')
  })
  afterEach(async () => world.cleanUp())

  function listedProfiles(provider?: Provider) {
    const root = join(world.folder, 'provider-homes')
    const profiles = existsSync(root) ? readdirSync(root) : []
    return [
      'brobot',
      ...profiles.filter(
        (profile) => provider === undefined || existsSync(join(root, profile, provider)),
      ),
    ]
  }
  async function setup(): Promise<{ host: RuntimeHost; giver: string; address: string }> {
    const host = world.aHost({ listProfiles: listedProfiles })
    const giver = (
      await host.createSession(
        { profileId: 'review-lead', provider: 'claude', cwd: world.folder, approvalMode: 'auto' },
        world.window,
      )
    ).sessionId
    const given = acceptedGive(await world.gives(host, giver, 'draft-reader'))
    return { host, giver, address: given.label }
  }

  it('a refused give does not prepare the target agent on another provider', async () => {
    const { host, giver, address } = await setup()
    const targetHome = join(world.folder, 'provider-homes', 'draft-reader', 'codex')
    expect(world.preparedIn).not.toContain(targetHome)
    const given = await world.gives(host, giver, 'draft-reader', {
      to: address,
      provider: 'codex',
      model: 'fake-codex-a',
    })
    expect(given).toMatchObject({ ok: false, refusal: { rail: 'its-provider-is-fixed' } })
    expect(world.preparedIn).not.toContain(targetHome)
    expect(existsSync(targetHome)).toBe(false)
  })

  it('reading both picker lists uses the stand-in for a provider this agent has not used', async () => {
    const { host } = await setup()
    const result = await host.modelList('codex', 'draft-reader')
    expect(result.models.some((model) => model.id === 'fake-codex-a')).toBe(true)
    expect(result.standIn).toBe('brobot')
    expect(world.preparedIn.filter((path) => path.endsWith('/draft-reader/codex'))).toEqual([])
    expect(existsSync(join(world.folder, 'provider-homes/draft-reader/codex'))).toBe(false)
  })

  it('an own-provider model probes no other provider', async () => {
    const { host, giver } = await setup()
    world.listedOn.length = 0
    const given = await world.gives(host, giver, 'draft-reader', { model: 'fake-claude-a' })
    expect(given).toMatchObject({ ok: true, runsOn: { provider: 'claude' } })
    expect(world.listedOn).not.toContain('codex')
  })
})
