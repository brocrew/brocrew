import type { RecordingSink } from './lib/host-fixture'
import { openPolicySessionFixture, policySessionOpener } from './helpers/policy-session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolset, StartOptions, ResumeOptions } from '@brobot2/runtime'
import type { AppDatabase } from '../src/main/db/connection'
import { createAppLifetime } from '../src/main/app-lifetime'
import { closeDatabase } from '../src/main/db/close-database'
import { deferred } from './helpers/quit-open-list-cases'
import { stopFailedStart } from './helpers/stop-failed-start'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentCallerId, TOOL_NAMES } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost, Caller, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import type { AgentInstructionsReading } from '../src/shared/own-instructions'

// A local expected contract lets this fixture compile before the host methods are added.
type Baseline = { readonly expectedVersion: number }
type PolicyHost = {
  proposeAgentRules(
    me: string,
    said: {
      about: string
      text: string
      why: string
      relaying: boolean
      expectedVersion: number
    },
    by: Caller,
  ): { ok: true; askId: string } | { ok: false }
  readAgentRules(me: string, profile: string, by: Caller): Promise<{ ok: boolean }>
  writeAgentRules(
    me: string,
    said: Baseline & {
      about: string
      text: string
      why: string
    },
    by: Caller,
  ): Promise<{ ok: boolean }>
  undoAgentRules(
    profile: string,
    expectedVersion: number,
    by: Caller,
  ): AgentInstructionsReading | null
  markAgentRulesSeen(profile: string, throughVersion: number, by: Caller): boolean
  instructAgent(
    profile: string,
    text: string,
    broughtBack: number | undefined,
    by: Caller,
    baseline?: Baseline,
  ): AgentInstructionsReading | null
}
type PolicyCommand =
  | { kind: 'agentRulesUnread'; profileId: string }
  | { kind: 'undoAgentRules'; profileId: string; expectedVersion: number }
  | { kind: 'markAgentRulesSeen'; profileId: string; throughVersion: number }

describe('standing-rule authority belongs to the host and changes remain attributable', () => {
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: RecordingSink
  let handed: AgentToolset[]
  let launches: (StartOptions | ResumeOptions)[]
  let tools: Map<string, AgentToolset>
  let clock: number
  const tick = (): number => clock++
  const caller = (id: string) => ({ ownerId: agentCallerId(id) })
  const policy = (): PolicyHost => host as unknown as PolicyHost
  const command = (sink: RuntimeEventSink, said: PolicyCommand) =>
    executeRuntimeCommand(
      host,
      sink,
      said as unknown as Parameters<typeof executeRuntimeCommand>[2],
    )

  let fixture: ReturnType<typeof openPolicySessionFixture>
  beforeEach(() => {
    clock = 1000
    fixture = openPolicySessionFixture('rules-policy', tick)
    ;({ host, window, work, db, store, handed, launches, tools } = fixture)
  })

  afterEach(() => fixture.close())

  const start = policySessionOpener(() => ({ host, window, work, handed, tools }))
  const propose = (me: string, text = 'Proposed rules', expectedVersion = 0) =>
    policy().proposeAgentRules(
      me,
      { about: 'lark', text, why: 'Keep changes reviewable', relaying: false, expectedVersion },
      caller(me),
    )
  const replace = (me: string, extra = {}) =>
    policy().writeAgentRules(
      me,
      {
        about: 'lark',
        text: 'New rules',
        why: 'Clarify the work',
        expectedVersion: 0,
        ...extra,
      },
      caller(me),
    )
  const toolReply = (me: string, name: string, args: Record<string, unknown>) => {
    const tool = tools.get(me)?.tools.find((one) => one.name === name)
    expect(tool, `registered tool ${name}`).toBeDefined()
    if (tool === undefined) throw new Error('unreachable missing tool')
    return tool.call(args)
  }
  const call = async (me: string, name: string, args: Record<string, unknown>) =>
    (await toolReply(me, name, args)).structured as Record<string, unknown>

  const recruit = (by: Caller, slug = 'lark') =>
    host.createAgent({ slug, displayName: null, provider: null }, by)
  const reason = (out: Record<string, unknown>): unknown => out['reason']

  it.each(['claude', 'codex'] as const)(
    'offers the direct rules tool to every conversation on %s',
    async (provider) => {
      const primary = await start(DEFAULT_PROFILE_ID, provider)
      const primaryNames = tools.get(primary)!.tools.map((one) => one.name)
      expect(primaryNames).toContain('write_agent_rules')
      expect(primaryNames).toContain('read_agent_rules')
      expect(primaryNames).toContain('propose_agent_rules')
      const ordinary = await start('wren', provider)
      expect(tools.get(ordinary)!.tools.map((one) => one.name)).toEqual(primaryNames)
    },
  )

  it.each(['claude', 'codex'] as const)(
    'keeps the same tool list when a person reopens a conversation on %s',
    async (provider) => {
      for (const profile of [DEFAULT_PROFILE_ID, 'wren']) {
        const me = await start(profile, provider)
        const before = tools.get(me)!.tools.map((one) => one.name)
        expect(before).toContain('write_agent_rules')
        await host.close(me, window)
        const count = handed.length
        await host.resumeSession(me, window)
        expect(handed).toHaveLength(count + 1)
        const after = handed.at(-1)!.tools.map((one) => one.name)
        expect(after).toEqual(before)
      }
    },
  )

  it('does not trust a supplied session or a matching display name as authority', async () => {
    const creator = await start('wren')
    recruit(caller(creator))
    const other = await start('finch')
    store.setAgentDisplayName('wren', 'Wren')
    store.setAgentDisplayName('finch', 'Wren')
    expect(await replace(other)).toMatchObject({ ok: false, rail: 'may-not-write-rules' })
    expect(
      await policy().writeAgentRules(
        creator,
        {
          about: 'lark',
          text: 'Forged caller',
          why: 'Pretend',
          expectedVersion: 0,
        },
        caller(other),
      ),
    ).toMatchObject({ ok: false, rail: 'may-not-write-rules' })
    expect((await policy().readAgentRules(creator, 'lark', window)).ok).toBe(false)
    expect((await policy().readAgentRules('absent', 'lark', caller('absent'))).ok).toBe(false)
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
  })

  it('writes for the creating profile and records the author, and the person can undo it', async () => {
    const creator = await start('wren')
    expect(recruit(caller(creator)).createdBy).toEqual({ by: 'an-agent', agent: 'wren' })
    const written = await call(creator, 'write_agent_rules', {
      agent: 'lark',
      current_version: 0,
      rules: 'Read the checklist first.',
      why: 'Keep the work reviewable.',
    })
    expect(written).toMatchObject({
      outcome: 'ok',
      profile: 'lark',
      conversation: creator,
      version: 1,
      author: { profile: 'wren' },
    })
    expect(store.ownInstructionsOf('lark').versions[0]).toMatchObject({
      text: 'Read the checklist first.',
      author: { profile: 'wren' },
      whoWroteIt: 'an-agent-direct',
    })
    expect(policy().undoAgentRules('lark', 1, window)?.own.versions[0]?.text).toBe('')
  })

  it('lets every conversation of the creating profile write, not only the one that created', async () => {
    const creator = await start('wren')
    recruit(caller(creator))
    const sibling = await start('wren')
    expect(sibling).not.toBe(creator)
    expect(await replace(sibling)).toMatchObject({ ok: true, result: { conversation: sibling } })
  })

  it('refuses a profile that did not create the agent, naming its creator', async () => {
    const creator = await start('wren')
    recruit(caller(creator))
    const other = await start('finch')
    const refused = await call(other, 'write_agent_rules', {
      agent: 'lark',
      current_version: 0,
      rules: 'Replacement',
      why: 'Explain this change',
    })
    expect(refused).toMatchObject({
      outcome: 'refused',
      rail: 'may-not-write-rules',
      detail: { you: 'finch', agent: 'lark', createdBy: 'wren' },
    })
    expect(reason(refused)).toBe(
      'Propose the change with propose_agent_rules; the person decides, or wren can make it. Only the person and wren, which created lark, can change its standing rules. Nothing was written.',
    )
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
  })

  it('refuses an agent writing its own standing rules', async () => {
    const me = await start('wren')
    const refused = await call(me, 'write_agent_rules', {
      agent: 'wren',
      current_version: 0,
      rules: 'Replacement',
      why: 'Explain this change',
    })
    expect(refused).toMatchObject({
      outcome: 'refused',
      rail: 'may-not-write-rules',
      detail: { you: 'wren', agent: 'wren', self: true },
    })
    expect(reason(refused)).toBe(
      'An agent never writes its own standing rules. Propose the change with propose_agent_rules, or keep it in your own notes. Nothing was written.',
    )
    expect(store.ownInstructionsOf('wren').versions).toEqual([])
  })

  it('leaves an agent a person created to the person alone', async () => {
    expect(recruit(window).createdBy).toEqual({ by: 'a-person' })
    const me = await start('wren')
    const refused = await call(me, 'write_agent_rules', {
      agent: 'lark',
      current_version: 0,
      rules: 'Replacement',
      why: 'Explain this change',
    })
    expect(refused).toMatchObject({
      outcome: 'refused',
      rail: 'may-not-write-rules',
      detail: { you: 'wren', agent: 'lark', createdBy: null },
    })
    expect(reason(refused)).toBe(
      "Propose the change with propose_agent_rules; the person decides. Only the person can change lark's standing rules. Nothing was written.",
    )
    expect(propose(me).ok).toBe(true)
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
  })

  it.each(['claude', 'codex'] as const)(
    'gives a helper the same tools and lets it write for the profile it runs as on %s',
    async (provider) => {
      store.registerExternalMcpServer({
        name: 'notes',
        url: 'http://127.0.0.1:8765/mcp',
        reach: 'everyone',
      })
      const giver = await start('wren', provider)
      expect(launches.at(-1)?.externalMcp?.reservedToolNames).toEqual(TOOL_NAMES)
      expect(TOOL_NAMES).toHaveLength(33)
      expect(TOOL_NAMES).toContain('write_agent_rules')
      const primary = await start(DEFAULT_PROFILE_ID, provider)
      recruit(caller(primary))
      expect(store.setAgentProvider(DEFAULT_PROFILE_ID, provider)).toBe(true)
      const given = await host.giveWork(
        {
          to: 'new',
          conversation_title: 'Review a change',
          profile: DEFAULT_PROFILE_ID,
          title: 'Review a change',
          brief: 'Propose a standing-rule change.',
          definition_of_done: 'A proposed change is recorded.',
          folder: work,
        },
        caller(giver),
      )
      if (!given.ok) throw new Error(`give refused: ${given.refusal.rail}`)
      const helper = given.owner
      expect(helper).not.toBe(primary)
      await vi.waitFor(async () =>
        expect((await policy().readAgentRules(helper, 'lark', caller(helper))).ok).toBe(true),
      )
      // A new conversation of the default profile stands at the top level; its task names the giver.
      expect(store.parentOf(helper)).toBeNull()
      expect(store.rootOf(helper)).not.toBeNull()
      expect(store.workById(given.piece)?.givenBy).toBe(giver)
      expect(store.recordedOne(helper)?.provider).toBe(provider)
      const helperNames = handed.at(-1)!.tools.map((one) => one.name)
      expect(launches.at(-1)?.externalMcp?.reservedToolNames).toEqual(TOOL_NAMES)
      expect(helperNames).toHaveLength(33)
      expect(helperNames).toContain('write_agent_rules')
      await host.close(helper, window)
      const stopped = await host.whatThisAgentWasGiven(helper)
      expect(stopped.tools.list.map((one) => one.name)).toEqual(helperNames)
      expect(stopped.launch).toMatchObject({ running: false })
      const count = handed.length
      await host.resumeSession(helper, window)
      expect(handed).toHaveLength(count + 1)
      expect(handed.at(-1)!.tools.map((one) => one.name)).toEqual(helperNames)
      expect(launches.at(-1)?.externalMcp?.reservedToolNames).toEqual(TOOL_NAMES)
      expect((await replace(giver)).ok).toBe(false)
      expect(await replace(helper)).toMatchObject({ ok: true, result: { conversation: helper } })
    },
  )

  it('refuses the old shortcut and exposes the bound direct-write door with the book', async () => {
    await start('lark')
    const me = await start(DEFAULT_PROFILE_ID)
    const current = await call(me, 'read_agent_rules', { agent: 'lark' })
    expect(current).toMatchObject({ outcome: 'ok', profile: 'lark', version: 0, text: '' })
    expect(
      await call(me, 'propose_agent_rules', {
        agent: 'lark',
        rules: 'Proposal',
        why: 'Explain',
        current_version: 0,
        already_agreed: true,
      }),
    ).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
    expect(
      await call(me, 'propose_agent_rules', {
        agent: 'lark',
        rules: 'Proposal',
        why: 'Explain',
        current_version: 0,
      }),
    ).toMatchObject({ outcome: 'ok', wrote: 'a-request' })
    expect(tools.get(me)?.tools.some((one) => one.name === 'write_agent_rules')).toBe(true)
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
  })

  it('keeps the original proposer name separately from the approver after rename and restart', async () => {
    await start('lark')
    const me = await start('wren')
    store.setAgentDisplayName('wren', 'Wren')
    const asked = propose(me)
    if (!asked.ok) throw new Error('proposal refused')
    store.setAgentDisplayName('wren', 'Finch')
    await host.closeAll()
    const outcome = host.decideInstruction(asked.askId, true, window)
    expect(outcome).toEqual({ outcome: 'taken' })
    store = createSessionStore(db, tick)
    expect(store.ownInstructionsOf('lark').versions[0]).toMatchObject({
      author: { profile: 'wren', name: 'Wren' },
      by: { who: 'a-person' },
      whoWroteIt: 'an-agents-proposal',
    })
  })

  it('refuses a stale proposal and does not approve one over a later person edit', async () => {
    await start('lark')
    const me = await start('wren')
    const asked = propose(me)
    if (!asked.ok) throw new Error('proposal refused')
    policy().instructAgent('lark', 'The person saved this', undefined, window)
    expect(propose(me, 'Stale', 0).ok).toBe(false)
    // 352 · the person's edit already ended it, so a window still showing it is told it is gone.
    expect(host.decideInstruction(asked.askId, true, window)).toEqual({
      outcome: 'refused',
      reason: 'there is no request waiting by that name, so nothing was written',
      stillOpen: false,
    })
    expect(store.ownInstructionsOf('lark').versions[0]?.text).toBe('The person saved this')
  })

  it('validates the exact person baseline and records replacement, unread state and a compact receipt', async () => {
    const me = await start(DEFAULT_PROFILE_ID)
    recruit(caller(me))
    policy().instructAgent('lark', 'Person rules', undefined, window)
    expect((await replace(me)).ok).toBe(false)
    const written = await replace(me, { expectedVersion: 1 })
    expect(written).toMatchObject({
      ok: true,
      result: { version: 2, previousVersion: 1, replacedPersonVersion: 1 },
    })
    const latest = store.ownInstructionsOf('lark').versions[0]
    expect(latest).toMatchObject({
      whoWroteIt: 'an-agent-direct',
      author: { profile: DEFAULT_PROFILE_ID },
      said: 'Clarify the work',
    })
    expect(store.instructionUnread('lark').unread).toBe(true)
    const receipt = window.messages
      .map((one) => one.event)
      .find((one) => (one as { type: string }).type === 'instruction_changed')
    expect(receipt).toMatchObject({ type: 'instruction_changed', profile: 'lark', version: 2 })
    expect(receipt).not.toHaveProperty('text')
    const reader = await start('wren')
    expect(await policy().readAgentRules(reader, 'lark', caller(reader))).toMatchObject({
      ok: true,
      result: {
        version: 2,
        text: 'New rules',
        reason: 'Clarify the work',
        author: { profile: DEFAULT_PROFILE_ID },
      },
    })
  })

  it('identifies a person-approved proposal when the direct tool replaces it', async () => {
    const me = await start(DEFAULT_PROFILE_ID)
    recruit(caller(me))
    const proposer = await start('wren')
    const asked = propose(proposer, 'Approved proposal')
    if (!asked.ok) throw new Error('proposal refused')
    expect(host.decideInstruction(asked.askId, true, window)).toEqual({ outcome: 'taken' })
    const written = await call(me, 'write_agent_rules', {
      agent: 'lark',
      current_version: 1,
      rules: 'Revised checklist',
      why: 'Clarify the sequence',
    })
    expect(written).toMatchObject({
      outcome: 'ok',
      previousVersion: 1,
      version: 2,
      replacedPersonVersion: 1,
    })
    expect(store.ownInstructionsOf('lark').versions[1]).toMatchObject({
      whoWroteIt: 'an-agents-proposal',
      by: { who: 'a-person' },
      text: 'Approved proposal',
    })
  })

  it('binds a real direct tool write to the running author and returns metadata only', async () => {
    const me = await start(DEFAULT_PROFILE_ID)
    recruit(caller(me))
    store.setAgentDisplayName(DEFAULT_PROFILE_ID, 'Coordinator')
    const written = await call(me, 'write_agent_rules', {
      agent: 'lark',
      current_version: 0,
      rules: 'Read the checklist first.',
      why: 'Keep the work reviewable.',
    })
    expect(written).toMatchObject({
      outcome: 'ok',
      profile: 'lark',
      conversation: me,
      previousVersion: 0,
      version: 1,
      author: { profile: DEFAULT_PROFILE_ID, name: 'Coordinator' },
    })
    expect(written).not.toHaveProperty('rules')
    expect(written).not.toHaveProperty('text')
    expect(written).not.toHaveProperty('reason')
    expect(store.ownInstructionsOf('lark').versions[0]).toMatchObject({
      text: 'Read the checklist first.',
      author: { profile: DEFAULT_PROFILE_ID, name: 'Coordinator' },
      said: 'Keep the work reviewable.',
      whoWroteIt: 'an-agent-direct',
      conversation: me,
    })
    expect(store.instructionUnread('lark').unread).toBe(true)
  })

  it('refuses a claimed author field on the direct tool', async () => {
    const me = await start(DEFAULT_PROFILE_ID)
    recruit(caller(me))
    expect(
      await call(me, 'write_agent_rules', {
        agent: 'lark',
        current_version: 0,
        rules: 'Replacement',
        why: 'Explain this change',
        author: { profile: 'wren', name: 'Forged' },
      }),
    ).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
  })

  it('reads the newest saved rules with both answer encodings and distinguishes no identity from version zero', async () => {
    const me = await start(DEFAULT_PROFILE_ID)
    recruit(caller(me))
    store.setAgentDisplayName(DEFAULT_PROFILE_ID, 'Coordinator')
    const current = vi.spyOn(store, 'readCurrentAgentRules')
    const history = vi.spyOn(store, 'ownInstructionsOf')
    expect(await host.readAgentRules(me, 'lark', window)).toMatchObject({
      ok: false,
      rail: 'may-not-write-rules',
    })
    expect(current).not.toHaveBeenCalled()
    expect(await call(me, 'read_agent_rules', { agent: 'Absent' })).toMatchObject({
      outcome: 'refused',
      rail: 'no-such-agent',
      detail: { agent: 'absent' },
    })
    const empty = await toolReply(me, 'read_agent_rules', { agent: 'Lark' })
    const zero = { profile: 'lark', version: 0, text: '', whoWroteIt: null, reason: null }
    expect(empty.structured).toEqual({ outcome: 'ok', ...zero })
    expect(JSON.parse(empty.text)).toEqual(zero)
    expect(history).not.toHaveBeenCalled()

    expect(await replace(me)).toMatchObject({ ok: true })
    expect(await replace(me, { text: 'Newest rules', expectedVersion: 1 })).toMatchObject({
      ok: true,
    })
    history.mockClear()
    const reply = await toolReply(me, 'read_agent_rules', { agent: 'Lark' })
    const newest = {
      profile: 'lark',
      version: 2,
      text: 'Newest rules',
      whoWroteIt: 'an-agent-direct',
      author: { profile: DEFAULT_PROFILE_ID, name: 'Coordinator' },
      reason: 'Clarify the work',
    }
    expect(reply.structured).toEqual({ outcome: 'ok', ...newest })
    expect(JSON.parse(reply.text)).toEqual(newest)
    expect(current.mock.calls).toEqual([['absent'], ['lark'], ['lark']])
    expect(history).not.toHaveBeenCalled()
  })

  it.each([
    ['normal quit', 'read_agent_rules'],
    ['failed startup', 'read_agent_rules'],
    ['normal quit', 'write_agent_rules'],
    ['failed startup', 'write_agent_rules'],
  ] as const)(
    'joins the accepted Rules tool answer before closing its original writer on %s (%s)',
    async (route, name) => {
      const me = await start(DEFAULT_PROFILE_ID)
      recruit(caller(me))
      expect(await replace(me)).toMatchObject({ ok: true })
      const pending = name === 'write_agent_rules' ? propose(me, 'Pending proposal', 1) : undefined
      if (pending !== undefined) expect(pending.ok).toBe(true)
      const held = deferred()
      const release = deferred()
      const sessionClosed = deferred()
      const order: string[] = []
      async function holdAnswer<T>(result: Promise<T>): Promise<T> {
        const outcome = await result
        held.resolve()
        await release.promise
        return outcome
      }
      const args =
        name === 'read_agent_rules'
          ? { agent: 'lark' }
          : { agent: 'lark', current_version: 1, rules: 'Committed rules', why: 'Write evidence' }
      if (name === 'read_agent_rules') {
        const read = host.readAgentRules.bind(host)
        vi.spyOn(host, 'readAgentRules').mockImplementationOnce((...args) =>
          holdAnswer(read(...args)),
        )
      } else {
        const write = host.writeAgentRules.bind(host)
        vi.spyOn(host, 'writeAgentRules').mockImplementationOnce((...args) =>
          holdAnswer(write(...args)),
        )
      }
      const closeSession = host.close.bind(host)
      vi.spyOn(host, 'close').mockImplementation(async (...args) => {
        const stopped = await closeSession(...args)
        sessionClosed.resolve()
        return stopped
      })
      const closeWriter = db.close.bind(db)
      const close = vi.spyOn(db, 'close').mockImplementation(() => {
        order.push('close')
        return closeWriter()
      })

      const reading = toolReply(me, name, args).then((reply) => {
        order.push('answer')
        return reply
      })
      await Promise.race([held.promise, reading])
      const stopping =
        route === 'failed startup'
          ? stopFailedStart(host, new Error('fictional earlier stop failed'))
          : undefined
      const lifetime = createAppLifetime({
        announceClosing: () => {},
        recordOpenSessions: () => host.recordOpenForQuit(),
        stopArchiveWork: () => host.stopSweeping(),
        closeAllSessions: () => stopping ?? host.closeAll(),
        drainArchiveWork: () => host.drainArchiveWork(),
        closeDatabase: () => closeDatabase(db),
        quit: () => {},
        exit: () => {},
        log: () => {},
        armLastResort: () => {},
        now: tick,
      })
      lifetime.beforeQuit({ preventDefault() {} })
      try {
        await Promise.race([sessionClosed.promise, stopping ?? lifetime.shuttingDown])
        await new Promise<void>((done) => setImmediate(done))
        expect(db.open).toBe(true)
        expect(close).not.toHaveBeenCalled()
        if (pending?.ok) {
          const events = window.messages
            .map((message) => message.event)
            .filter(
              (event) =>
                event.type === 'instruction_settled' || event.type === 'instruction_changed',
            )
          expect(events.slice(-2)).toEqual([
            expect.objectContaining({
              type: 'instruction_settled',
              askId: pending.askId,
              ending: 'superseded',
            }),
            expect.objectContaining({ type: 'instruction_changed', profile: 'lark', version: 2 }),
          ])
        }
        if (name === 'write_agent_rules') {
          expect(store.ownInstructionsOf('lark').versions[0]?.text).toBe('Committed rules')
        }
        expect(await call(me, name, args)).toMatchObject({
          outcome: 'refused',
          rail: 'may-not-write-rules',
        })
      } finally {
        release.resolve()
        await lifetime.shuttingDown
        await stopping
      }
      const reply = await reading
      if (name === 'read_agent_rules') {
        expect(reply.structured).toMatchObject({ outcome: 'ok', version: 1, text: 'New rules' })
        expect(JSON.parse(reply.text)).toMatchObject({ version: 1, text: 'New rules' })
      } else {
        expect(reply.structured).toMatchObject({ outcome: 'ok', version: 2, previousVersion: 1 })
        expect(reply.text).toContain('Saved rules for lark as version 2.')
        expect(reply.text).toContain('replacing version 1.')
      }
      expect(order).toEqual(['answer', 'close'])
      expect(close).toHaveBeenCalledOnce()
      expect(db.open).toBe(false)
    },
  )

  it('refuses a competing baseline at the native write without a full history read or publication', async () => {
    const me = await start(DEFAULT_PROFILE_ID)
    recruit(caller(me))
    const nativeWrite = store.writeDirectAgentRules.bind(store)
    vi.spyOn(store, 'writeDirectAgentRules').mockImplementationOnce((...args) => {
      expect(
        store.writeOwnInstructions(
          {
            profileSlug: 'lark',
            text: 'Competing edit',
            whoWroteIt: 'a-person',
            by: { who: 'a-person' },
            conversation: null,
            said: null,
            broughtBack: null,
            expectedVersion: 0,
          },
          tick(),
        )?.version,
      ).toBe(1)
      return nativeWrite(...args)
    })
    const history = vi.spyOn(store, 'ownInstructionsOf')
    const outcome = await call(me, 'write_agent_rules', {
      agent: 'lark',
      current_version: 0,
      rules: 'Losing edit',
      why: 'Test the final baseline',
    })
    expect(outcome).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
    expect(history).not.toHaveBeenCalled()
    expect(store.ownInstructionsOf('lark').versions.map((row) => row.text)).toEqual([
      'Competing edit',
    ])
    expect(window.messages.map((entry) => entry.event)).not.toContainEqual(
      expect.objectContaining({ type: 'instruction_changed' }),
    )
  })

  it('does not let a stale tool read replace a newer person save', async () => {
    const me = await start(DEFAULT_PROFILE_ID)
    recruit(caller(me))
    const seen = await call(me, 'read_agent_rules', { agent: 'lark' })
    policy().instructAgent('lark', 'The person saved this later', undefined, window, {
      expectedVersion: 0,
    })
    expect(
      await call(me, 'write_agent_rules', {
        agent: 'lark',
        current_version: seen['version'],
        rules: 'Stale replacement',
        why: 'Based on an old read',
      }),
    ).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
    expect(store.ownInstructionsOf('lark').versions).toHaveLength(1)
    expect(store.ownInstructionsOf('lark').versions[0]?.text).toBe('The person saved this later')
  })

  it('requires the version, bounded replacement and reason on the direct tool', async () => {
    const me = await start(DEFAULT_PROFILE_ID)
    recruit(caller(me))
    const input = {
      agent: 'lark',
      current_version: 0,
      rules: 'Replacement',
      why: 'Explain the replacement',
    }
    for (const changed of [
      { current_version: -1 },
      { current_version: Number.MAX_SAFE_INTEGER + 1 },
      { why: '   ' },
      { rules: 'x'.repeat(16001) },
    ]) {
      expect(await call(me, 'write_agent_rules', { ...input, ...changed })).toMatchObject({
        outcome: 'refused',
        rail: 'malformed-request',
      })
      expect(store.ownInstructionsOf('lark').versions).toEqual([])
    }
    expect(await call(me, 'write_agent_rules', input)).toMatchObject({ outcome: 'ok', version: 1 })
  })

  it('keeps rule Undo person-only while colleagues acknowledge, and Undo supersedes proposals', async () => {
    const me = await start(DEFAULT_PROFILE_ID)
    recruit(caller(me))
    expect((await replace(me)).ok).toBe(true)
    expect(propose(me, 'Waiting replacement', 1).ok).toBe(true)
    expect(policy().undoAgentRules('lark', 1, caller(me))).toBeNull()
    expect(policy().markAgentRulesSeen('lark', 1, caller(me))).toBe(true)
    expect(
      policy().instructAgent('lark', 'Stale person save', undefined, window, {
        expectedVersion: 0,
      }),
    ).toBeNull()
    const agentSink: RuntimeEventSink = {
      ...window,
      ownerId: agentCallerId(me),
      aPersonIsBehindIt: false,
      send() {},
      sendLiveness() {},
    }
    await expect(
      command(agentSink, { kind: 'agentRulesUnread', profileId: 'lark' }),
    ).rejects.toThrow()
    await expect(
      command(window, { kind: 'agentRulesUnread', profileId: 'lark' }),
    ).resolves.toMatchObject({ seenThrough: 1 })
    await expect(
      command(agentSink, { kind: 'undoAgentRules', profileId: 'lark', expectedVersion: 1 }),
    ).rejects.toThrow()
    await expect(
      command(agentSink, { kind: 'markAgentRulesSeen', profileId: 'lark', throughVersion: 1 }),
    ).resolves.toBe(true)
    expect(policy().undoAgentRules('lark', 1, window)?.own.versions[0]?.text).toBe('')
    expect(store.instructionAsksWaiting()).toEqual([])
    expect(policy().undoAgentRules('lark', 1, window)).toBeNull()
    expect(policy().markAgentRulesSeen('lark', 1, window)).toBe(true)
  })
})
