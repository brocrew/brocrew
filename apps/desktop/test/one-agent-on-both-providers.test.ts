import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('one normal agent, one conversation per giver and provider', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld({ holderReminders: 'declined' })
    world.anAgent('draft-reader', 'normal', 'claude')
  })
  afterEach(async () => {
    await world.cleanUp()
    vi.restoreAllMocks()
  })

  const caller = async (host: RuntimeHost) =>
    (
      await host.createSession(
        {
          profileId: 'review-lead',
          provider: 'claude',
          cwd: world.folder,
          approvalMode: 'auto',
        },
        world.window,
      )
    ).sessionId

  it('keeps the current default and conversation when nothing chooses another provider', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    const first = await world.gives(host, giver, 'draft-reader')
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.refusal.reason)
    const again = await world.gives(host, giver, 'draft-reader')
    expect(again).toMatchObject({ ok: true, owner: first.owner })
    expect(world.store.recordedOne(first.owner)?.provider).toBe('claude')
    expect(world.store.providerOf('draft-reader')).toBe('claude')
    expect(world.startedIn.filter((path) => path.endsWith('/draft-reader/codex'))).toEqual([])
  })

  it('creates and reuses separate conversations without changing the agent default or old row', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    const claude = await world.gives(host, giver, 'draft-reader')
    const codex = await world.gives(host, giver, 'draft-reader', { provider: 'codex' })
    expect(claude.ok).toBe(true)
    expect(codex.ok).toBe(true)
    if (!claude.ok || !codex.ok) throw new Error('give refused')
    expect(codex.owner).not.toBe(claude.owner)
    expect(world.store.recordedOne(claude.owner)?.provider).toBe('claude')
    expect(world.store.recordedOne(codex.owner)?.provider).toBe('codex')
    expect(world.store.providerOf('draft-reader')).toBe('claude')
    expect(await world.gives(host, giver, 'draft-reader', { provider: 'codex' })).toMatchObject({
      ok: true,
      owner: codex.owner,
    })
    expect(await world.gives(host, giver, 'draft-reader')).toMatchObject({
      ok: true,
      owner: claude.owner,
    })
    expect(world.startedAs.filter((profile) => profile === 'draft-reader')).toHaveLength(2)
  })

  it('routes a model from the other provider even when a default-provider conversation exists', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    const first = await world.gives(host, giver, 'draft-reader')
    const named = await world.gives(host, giver, 'draft-reader', { model: 'fake-codex-a' })
    expect(named.ok).toBe(true)
    if (!first.ok || !named.ok) throw new Error('give refused')
    expect(named.owner).not.toBe(first.owner)
    expect(named.runsOn).toMatchObject({ provider: 'codex', model: 'fake-codex-a' })
    expect(world.store.recordedOne(first.owner)?.provider).toBe('claude')
    expect(world.store.providerOf('draft-reader')).toBe('claude')
    const again = await world.gives(host, giver, 'draft-reader', { model: 'fake-codex-a' })
    expect(again).toMatchObject({ ok: true, owner: named.owner })
  })

  it('uses the default when both providers list a model, and lets an explicit provider disambiguate', async () => {
    vi.spyOn(FakeRuntime.prototype, 'listModels').mockResolvedValue([
      { id: 'shared-fictional', label: 'Shared fictional', isDefault: true },
    ])
    const host = world.aHost()
    const giver = await caller(host)
    const implicit = await world.gives(host, giver, 'draft-reader', { model: 'shared-fictional' })
    const explicit = await world.gives(host, giver, 'draft-reader', {
      model: 'shared-fictional',
      provider: 'codex',
    })
    expect(implicit).toMatchObject({ ok: true, runsOn: { provider: 'claude' } })
    expect(explicit).toMatchObject({ ok: true, runsOn: { provider: 'codex' } })
  })

  it('a person can start the other provider with a model while old conversations and the identity default stay put', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    const original = await world.gives(host, giver, 'draft-reader')
    if (!original.ok) throw new Error('give refused')
    const other = await host.createSession(
      {
        provider: 'codex',
        profileId: 'draft-reader',
        model: 'fake-codex-a',
        cwd: world.folder,
        approvalMode: 'ask',
      },
      world.window,
    )
    expect(world.store.recordedOne(other.sessionId)?.provider).toBe('codex')
    expect(world.store.recordedOne(original.owner)?.provider).toBe('claude')
    expect(world.store.providerOf('draft-reader')).toBe('claude')
    expect(world.store.modelChoiceOf('draft-reader')?.provider).not.toBe('codex')
  })

  it('refuses an explicit provider/model mismatch before creating a conversation or native home', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    const before = world.conversationsRecorded()
    const given = await world.gives(host, giver, 'draft-reader', {
      provider: 'codex',
      model: 'fake-claude-a',
    })
    expect(given).toMatchObject({
      ok: false,
      refusal: { rail: 'model-not-in-the-list', detail: { provider: 'codex' } },
    })
    expect(world.conversationsRecorded()).toBe(before)
    expect(world.startedAs).toEqual(['review-lead'])
  })

  it('keeps reservations separate by provider and deduplicates a second give during a start', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    let release!: () => void
    world.startsWait = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = [
      world.gives(host, giver, 'draft-reader', { provider: 'claude' }),
      world.gives(host, giver, 'draft-reader', { provider: 'codex' }),
      world.gives(host, giver, 'draft-reader', { provider: 'codex' }),
    ]
    try {
      await vi.waitFor(() =>
        expect(world.startedAs.filter((p) => p === 'draft-reader')).toHaveLength(2),
      )
    } finally {
      release()
    }
    const [claude, codex, repeated] = await Promise.all(pending)
    expect(claude?.ok && codex?.ok && repeated?.ok).toBe(true)
    if (!claude?.ok || !codex?.ok || !repeated?.ok) throw new Error('give refused')
    expect(codex.owner).toBe(repeated.owner)
    expect(claude.owner).not.toBe(codex.owner)
  })

  it('preserves global worker numbering while ordinary work selects the first worker on its provider', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    const claude = await world.gives(host, giver, 'draft-reader', { parallel: true })
    const codex = await world.gives(host, giver, 'draft-reader', {
      provider: 'codex',
      parallel: true,
    })
    expect(claude.ok && codex.ok).toBe(true)
    if (!claude.ok || !codex.ok) throw new Error('give refused')
    expect(world.store.workersBorn().map(({ number }) => number)).toEqual([1, 2])
    expect(await world.gives(host, giver, 'draft-reader', { provider: 'codex' })).toMatchObject({
      ok: true,
      owner: codex.owner,
    })
    expect(await world.gives(host, giver, 'draft-reader')).toMatchObject({
      ok: true,
      owner: claude.owner,
    })
  })

  it('keeps a service on its single provider and permanently refuses a conflicting choice with its model list', async () => {
    world.anAgent('room-booker', 'service', 'claude')
    const host = world.aHost()
    const giver = await caller(host)
    const first = await world.gives(host, giver, 'room-booker')
    const same = await world.gives(host, giver, 'room-booker', { provider: 'claude' })
    expect(first.ok && same.ok).toBe(true)
    if (!first.ok || !same.ok) throw new Error('give refused')
    expect(same.owner).toBe(first.owner)
    const before = world.conversationsRecorded()
    const refused = await world.gives(host, giver, 'room-booker', { provider: 'codex' })
    expect(refused).toMatchObject({
      ok: false,
      refusal: {
        rail: 'service-provider-is-fixed',
        permanence: 'permanent',
        retryable: false,
        detail: { provider: 'claude', choices: ['fake-claude-a', 'fake-claude-b'] },
      },
    })
    expect(world.conversationsRecorded()).toBe(before)
  })

  it('keeps both legacy conversations when parallel workers are added later and the host restarts', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    const claude = await world.gives(host, giver, 'draft-reader')
    const codex = await world.gives(host, giver, 'draft-reader', { provider: 'codex' })
    expect(claude.ok && codex.ok).toBe(true)
    if (!claude.ok || !codex.ok) throw new Error('give refused')
    expect(
      await world.gives(host, giver, 'draft-reader', { provider: 'codex', parallel: true }),
    ).toMatchObject({ ok: true })
    expect(await world.gives(host, giver, 'draft-reader')).toMatchObject({
      ok: true,
      owner: claude.owner,
    })
    await host.closeAll()
    const next = world.aHost()
    await next.reopenForAPerson(giver, world.window, null)
    expect(await world.gives(next, giver, 'draft-reader', { provider: 'codex' })).toMatchObject({
      ok: true,
      owner: codex.owner,
    })
    expect(await world.gives(next, giver, 'draft-reader')).toMatchObject({
      ok: true,
      owner: claude.owner,
    })
  })

  it.each([{ provider: 'codex' }, { model: 'fake-codex-a' }])(
    'refuses another service provider before its first birth: %j',
    async (choice) => {
      world.anAgent('room-booker', 'service', 'claude')
      const host = world.aHost()
      const giver = await caller(host)
      const before = world.conversationsRecorded()
      const refused = await world.gives(host, giver, 'room-booker', choice)
      expect(refused).toMatchObject({
        ok: false,
        refusal: {
          rail: 'service-provider-is-fixed',
          permanence: 'permanent',
          detail: { provider: 'claude', choices: ['fake-claude-a', 'fake-claude-b'] },
        },
      })
      expect(world.conversationsRecorded()).toBe(before)
      expect(world.startedAs).toEqual(['review-lead'])
    },
  )
})
