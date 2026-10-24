import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_NORMAL_WORKERS_PER_POOL } from '../src/main/profile-execution-file'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import {
  profileBundleSpans,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { agentCallerId, toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
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

  it('shares one identity’s standing rules with its Claude and Codex conversations', async () => {
    const rules = 'Keep fictional review findings concise.\nName the evidence for each finding.'
    const written = world.store.writeOwnInstructions(
      {
        profileSlug: 'draft-reader',
        text: rules,
        whoWroteIt: 'a-person',
        by: { who: 'a-person' },
        conversation: null,
        said: null,
        broughtBack: null,
      },
      world.clock++,
    )
    expect(written?.version).toBe(1)
    const seen: { provider: string; configured: string | null; path: string; text: string }[] = []
    const host = world.aHost({
      readInstructions: (provider, cwd, providerHome, context) => {
        const composed = profileBundleSpans(context, provider)
        const bundle = publishProfileBundle(provider, providerHome, composed.text)
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          home: join(world.folder, 'fictional-home'),
          bundle,
          bundleComposed: composed,
          thisConversation: thisConversationSpans(context),
        })
        if (context.profileSlug === 'draft-reader') {
          if (read.profileFile === null || read.profileFile.refused !== null) {
            throw new Error('the fictional profile bundle was refused')
          }
          seen.push({
            provider,
            configured: context.configured ?? null,
            path: read.profileFile.path,
            text: readFileSync(read.profileFile.path, 'utf8'),
          })
        }
        return {
          instructions: read.instructions,
          systemHint: read.systemHint ?? undefined,
          ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
          memoryLoaded: null,
        }
      },
    })
    const giver = await caller(host)
    const claude = await world.gives(host, giver, 'draft-reader', { provider: 'claude' })
    const codex = await world.gives(host, giver, 'draft-reader', { provider: 'codex' })
    expect(claude.ok && codex.ok).toBe(true)
    if (!claude.ok || !codex.ok) throw new Error('give refused')
    expect(claude.owner).not.toBe(codex.owner)
    expect(seen.map(({ provider, configured }) => ({ provider, configured }))).toEqual([
      { provider: 'claude', configured: rules },
      { provider: 'codex', configured: rules },
    ])
    for (const read of seen) {
      expect(read.path).toContain(join('provider-homes', 'draft-reader', read.provider))
      expect(read.text).toContain(rules)
    }
    expect(world.store.ownInstructionsOf('draft-reader').versions).toHaveLength(1)
    expect(world.store.providerOf('draft-reader')).toBe('claude')
  })

  it.each(['claude', 'codex', 'person'] as const)(
    'shares one notes page and sealed launch versions across providers with a %s writer',
    async (writerProvider) => {
      const textOne = 'Keep observations about the fictional catalogue in one place.'
      const textTwo = 'Name the fictional catalogue revision beside each observation.'
      const rules = 'Keep fictional review findings concise.'
      world.store.writeOwnInstructions(
        {
          profileSlug: 'draft-reader',
          text: rules,
          whoWroteIt: 'a-person',
          by: { who: 'a-person' },
          conversation: null,
          said: null,
          broughtBack: null,
        },
        world.clock++,
      )
      const captures: {
        provider: 'claude' | 'codex'
        context: InstructionContext
        bundle: ReturnType<typeof profileBundleSpans>
        lead: ReturnType<typeof thisConversationSpans>
        read: ReturnType<typeof readSessionInstructions>
        profileText: string
      }[] = []
      const starts = vi.spyOn(FakeRuntime.prototype, 'start')
      const resumes = vi.spyOn(FakeRuntime.prototype, 'resume')
      const host = world.aHost({
        readInstructions: (provider, cwd, providerHome, context) => {
          const bundle = profileBundleSpans(context, provider)
          const lead = thisConversationSpans(context, toolsToldInTextFor(provider), provider)
          const published = publishProfileBundle(provider, providerHome, bundle.text)
          const read = readSessionInstructions({
            provider,
            cwd,
            providerHome,
            home: join(world.folder, 'fictional-home'),
            bundle: published,
            bundleComposed: bundle,
            thisConversation: lead,
          })
          if (context.profileSlug === 'draft-reader') {
            if (read.profileFile === null || read.profileFile.refused !== null)
              throw new Error('the fictional profile bundle was refused')
            captures.push({
              provider,
              context,
              bundle,
              lead,
              read,
              profileText: readFileSync(read.profileFile.path, 'utf8'),
            })
          }
          return {
            instructions: read.instructions,
            systemHint: read.systemHint ?? undefined,
            ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
            memoryLoaded: read.memoryLoaded,
            profileFile: read.profileFile,
            context,
          }
        },
      })
      // This assertion gives the landed pre-notes base a behavioural RED, not a missing-call crash.
      expect(host, 'both providers need the identity-owned notes API').toHaveProperty(
        'saveOwnNotes',
      )
      const saved = host.saveOwnNotes(
        'draft-reader',
        {
          expectedVersion: 0,
          currentText: '',
          text: textOne,
          why: 'Keep the fictional catalogue revision.',
        },
        world.window,
      )
      expect(saved).not.toBeNull()
      const v1 = saved!.versions.at(-1)!.version
      const defaults = {
        provider: world.store.providerOf('draft-reader'),
        model: world.store.modelChoiceOf('draft-reader'),
      }
      const giver = await caller(host)
      const claude = await world.gives(host, giver, 'draft-reader', { provider: 'claude' })
      const codex = await world.gives(host, giver, 'draft-reader', { provider: 'codex' })
      expect(claude.ok && codex.ok).toBe(true)
      if (!claude.ok || !codex.ok) throw new Error('give refused')
      const owners = { claude: claude.owner, codex: codex.owner }
      expect(owners.claude).not.toBe(owners.codex)
      const bindings = world.db
        .prepare(
          'SELECT id, agent_identity_id AS identity FROM provider_session WHERE id IN (?, ?)',
        )
        .all(owners.claude, owners.codex) as { id: string; identity: string | null }[]
      expect(bindings).toHaveLength(2)
      expect(bindings[0]!.identity).not.toBeNull()
      expect(new Set(bindings.map(({ identity }) => identity)).size).toBe(1)
      const launches = (owner: string) =>
        world.ledger(owner).flatMap((event) => (event.type === 'launched' ? [event] : []))
      const settle = async (owner: string, through: number) => {
        const answered = new Set<string>()
        await vi.waitFor(async () => {
          const events = world.ledger(owner)
          const from = events.map((event) => event.type === 'user_turn').lastIndexOf(true)
          for (const event of events.slice(from + 1)) {
            if (event.type === 'permission_request' && !answered.has(event.id)) {
              answered.add(event.id)
              await host.respondPermission(owner, event.id, { outcome: 'allow' }, world.window)
            }
          }
          expect(world.ledger(owner).filter((event) => event.type === 'turn')).toHaveLength(through)
        })
      }
      for (const owner of Object.values(owners)) await settle(owner, 1)
      const originals = [...captures]
      expect(originals.map(({ provider }) => provider)).toEqual(['claude', 'codex'])
      const checkLaunch = async (provider: 'claude' | 'codex', version: number, text: string) => {
        const owner = owners[provider]
        const capture = captures.filter((read) => read.provider === provider).at(-1)!
        expect(capture.context.ownNotes).toEqual({ version, text })
        expect(launches(owner).at(-1)!.given).toMatchObject({ ownNotesVersion: version })
        expect(await host.whatThisAgentWasGiven(owner)).toMatchObject({ ownNotesVersion: version })
        expect(world.store.recordedOne(owner)?.provider).toBe(provider)
        const sent = provider === 'claude' ? capture.read.systemHint : capture.read.firstTurnLead
        if (text !== '') expect(sent).toContain('> ' + text)
        if (provider === 'claude') {
          expect(capture.lead.spans.some((span) => span.heading === 'Your own notes')).toBe(false)
          if (text !== '') {
            expect(sent!.indexOf(rules)).toBeLessThan(sent!.indexOf('## Your own notes'))
            expect(sent!.match(/^## Your own notes$/gm)).toHaveLength(1)
          } else expect(sent).not.toContain('## Your own notes')
        } else {
          expect(capture.lead.spans[0]?.heading).toBe('Your own notes')
          expect(capture.profileText).not.toContain('## Your own notes')
          expect(capture.profileText).not.toContain(textOne)
          expect(capture.profileText).not.toContain(textTwo)
          expect(sent!.match(/^## Your own notes$/gm)).toHaveLength(1)
          if (text === '') expect(sent).toContain('Your own notes are empty.')
        }
      }
      for (const provider of ['claude', 'codex'] as const) await checkLaunch(provider, v1, textOne)
      const claudeStart = starts.mock.calls
        .map(([options]) => options)
        .find((options) => options.providerHome.endsWith(join('draft-reader', 'claude')))
      expect(claudeStart?.systemHint).toContain('> ' + textOne)
      for (const provider of ['claude', 'codex'] as const) {
        const sent = world.ledger(owners[provider]).find((event) => event.type === 'user_turn')
        if (provider === 'codex') {
          expect(sent?.type === 'user_turn' ? sent.sent : '').toContain('> ' + textOne)
        }
      }
      const writer = owners[writerProvider === 'person' ? 'claude' : writerProvider]
      const update = {
        expectedVersion: v1,
        currentText: textOne,
        text: textTwo,
        why: 'Record the next fictional revision.',
      }
      let v2: number
      if (writerProvider === 'person') {
        const written = host.saveOwnNotes('draft-reader', update, world.window)
        expect(written).not.toBeNull()
        v2 = written!.versions[0]!.version
      } else {
        const written = host.writeOwnNotes(writer, update, { ownerId: agentCallerId(writer) })
        expect(written.ok).toBe(true)
        if (!written.ok) throw new Error('notes write refused')
        v2 = written.result.version
        expect(written.result.previousVersion).toBe(v1)
      }
      expect(v2).toBeGreaterThan(v1)
      for (const owner of Object.values(owners))
        expect(
          host.readOwnNotes(owner, undefined, { ownerId: agentCallerId(owner) }),
        ).toMatchObject({
          ok: true,
          result: { profile: 'draft-reader', version: v2, text: textTwo },
        })
      for (const capture of originals)
        expect(capture.context.ownNotes).toEqual({ version: v1, text: textOne })
      expect(claudeStart?.systemHint).toContain('> ' + textOne)
      expect(claudeStart?.systemHint).not.toContain(textTwo)
      for (const provider of ['claude', 'codex'] as const) {
        const owner = owners[provider]
        // A give starts unwatched; use the real person takeover before a window closes it.
        host.claimSession(owner, world.window)
        await host.close(owner, world.window)
        await host.resumeSession(owner, world.window)
        await checkLaunch(provider, v2, textTwo)
        const resumed = resumes.mock.calls
          .map(([, options]) => options)
          .filter((options) => options.providerHome.endsWith(join('draft-reader', provider)))
          .at(-1)
        if (provider === 'claude') expect(resumed?.systemHint).toContain('> ' + textTwo)
        else expect(resumed?.systemHint).toBeUndefined()
        await host.send(owner, 'Continue with the current catalogue revision.', world.window)
        await settle(owner, 2)
        if (provider === 'codex') {
          const sent = world
            .ledger(owner)
            .filter((event) => event.type === 'user_turn')
            .at(-1)
          expect(sent?.type === 'user_turn' ? sent.sent : '').toContain('> ' + textTwo)
        }
      }
      const clear = {
        expectedVersion: v2,
        currentText: textTwo,
        text: '',
        why: 'Clear the fictional notes.',
      }
      let v3: number
      if (writerProvider === 'person') {
        const cleared = host.saveOwnNotes('draft-reader', clear, world.window)
        expect(cleared).not.toBeNull()
        v3 = cleared!.versions[0]!.version
      } else {
        // Claiming the window does not revoke this live owner's own-notes write authority.
        const cleared = host.writeOwnNotes(writer, clear, { ownerId: agentCallerId(writer) })
        expect(cleared.ok).toBe(true)
        if (!cleared.ok) throw new Error('notes clear refused')
        v3 = cleared.result.version
      }
      expect(v3).toBeGreaterThan(v2)
      for (const provider of ['claude', 'codex'] as const) {
        await host.close(owners[provider], world.window)
        await host.resumeSession(owners[provider], world.window)
        await checkLaunch(provider, v3, '')
        await host.send(owners[provider], 'Continue with the empty notes page.', world.window)
        await settle(owners[provider], 3)
        const clearedOptions = resumes.mock.calls
          .map(([, options]) => options)
          .filter((options) => options.providerHome.endsWith(join('draft-reader', provider)))
          .at(-1)
        if (provider === 'claude')
          expect(clearedOptions?.systemHint).not.toContain('## Your own notes')
        else {
          const turn = world
            .ledger(owners[provider])
            .filter((event) => event.type === 'user_turn')
            .at(-1)
          expect(turn?.type === 'user_turn' ? turn.sent : '').toContain('Your own notes are empty.')
        }
        expect(launches(owners[provider]).map((launch) => launch.given?.ownNotesVersion)).toEqual([
          v1,
          v2,
          v3,
        ])
      }
      for (const capture of originals)
        expect(capture.context.ownNotes).toEqual({ version: v1, text: textOne })
      expect(host.agentOwnNotes('draft-reader')?.versions.map(({ version }) => version)).toEqual([
        v3,
        v2,
        v1,
      ])
      expect({
        provider: world.store.providerOf('draft-reader'),
        model: world.store.modelChoiceOf('draft-reader'),
      }).toEqual(defaults)
    },
  )

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

  it('checks a named model against an existing conversation when a legacy identity has two providers and no saved default', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    expect((await world.gives(host, giver, 'draft-reader')).ok).toBe(true)
    const codex = await world.gives(host, giver, 'draft-reader', { provider: 'codex' })
    if (!codex.ok) throw new Error('give refused')
    expect(host.setAgentProvider('draft-reader', null)).toMatchObject({ provider: null })
    await host.closeAll()
    vi.spyOn(FakeRuntime.prototype, 'listModels').mockResolvedValue([
      { id: 'shared-fictional', label: 'Shared fictional', isDefault: true },
    ])
    const next = world.aHost()
    await next.reopenForAPerson(giver, world.window, null)
    expect(
      await world.gives(next, giver, 'draft-reader', { model: 'shared-fictional' }),
    ).toMatchObject({ ok: true, owner: codex.owner, runsOn: { model: 'shared-fictional' } })
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

  it('distinguishes a full pool with no worker on the other provider from matching busy workers', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    for (let i = 0; i < MAX_NORMAL_WORKERS_PER_POOL; i += 1) {
      expect(
        (await world.gives(host, giver, 'draft-reader', { provider: 'claude', parallel: true })).ok,
      ).toBe(true)
    }
    expect(world.store.workersBorn()).toHaveLength(MAX_NORMAL_WORKERS_PER_POOL)
    expect(
      await world.gives(host, giver, 'draft-reader', { provider: 'codex', parallel: true }),
    ).toMatchObject({
      ok: false,
      refusal: { rail: 'no-room-for-provider-conversation', retryable: false },
    })
    expect(
      await world.gives(host, giver, 'draft-reader', { provider: 'claude', parallel: true }),
    ).toMatchObject({
      ok: false,
      refusal: { rail: 'no-free-worker-at-capacity', retryable: true },
    })
    expect(world.startedIn.filter((path) => path.endsWith('/draft-reader/codex'))).toEqual([])
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

  it('keeps an older provider’s ordinary conversation while another provider has an unrecorded worker birth', async () => {
    const host = world.aHost()
    const giver = await caller(host)
    const claude = await world.gives(host, giver, 'draft-reader')
    const codex = await world.gives(host, giver, 'draft-reader', { provider: 'codex' })
    expect(claude.ok && codex.ok).toBe(true)
    if (!claude.ok || !codex.ok) throw new Error('setup refused')
    let release = () => {}
    world.startsWait = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = world.gives(host, giver, 'draft-reader', { provider: 'claude', parallel: true })
    void pending.catch(() => {})
    let ordinary: PromiseSettledResult<Awaited<ReturnType<typeof world.gives>>> | undefined
    const delivery = world.gives(host, giver, 'draft-reader', { provider: 'codex' }).then(
      (value) => {
        ordinary = { status: 'fulfilled', value }
      },
      (reason) => {
        ordinary = { status: 'rejected', reason }
      },
    )
    try {
      await vi.waitFor(() => expect(ordinary).toBeDefined())
      expect(ordinary).toMatchObject({
        status: 'fulfilled',
        value: { ok: true, owner: codex.owner },
      })
      expect(world.store.recordedOne(claude.owner)?.provider).toBe('claude')
      expect(world.store.recordedOne(codex.owner)?.provider).toBe('codex')
      expect(world.store.providerOf('draft-reader')).toBe('claude')
    } finally {
      release()
      world.startsWait = null
      await Promise.allSettled([pending, delivery])
    }
    expect(await pending).toMatchObject({ ok: true })
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

  it('does not choose a service’s first provider from an explicit give when no default exists', async () => {
    world.anAgent('room-booker', 'service', 'claude')
    expect(world.store.setAgentProvider('room-booker', null)).toBe(true)
    const host = world.aHost()
    const giver = await caller(host)
    expect(await world.gives(host, giver, 'room-booker', { provider: 'codex' })).toMatchObject({
      ok: false,
      refusal: { rail: 'its-provider-is-not-chosen' },
    })
    expect(world.startedAs).toEqual(['review-lead'])
  })
})
