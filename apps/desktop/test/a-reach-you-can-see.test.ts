import { ToolWatchingRuntime } from './lib/provider-double'
import {
  neutralHostDeps,
  RecordingSink,
  syntheticProviderHome,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  CAPABILITY_FIELDS,
  ASSIGNMENT_REACH_ADMITS,
  MESSAGING_REACH,
  type MessagingReach,
  MESSAGING_REACH_ADMITS,
  capabilityField,
  type AnyCapabilityField,
} from '../src/shared/capabilities'
import { reachesWhatItDidNotStart } from '../src/main/runtime/message-rails'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { agentStateWords } from '../src/shared/agent-state'

/** Read discovery remains available when messaging is narrowed. */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** Keeps the toolsets the HOST handed out, so an agent's calls go through the real one. */
describe('433 §B · the agents a reach can see', () => {
  let userData: string
  let root: string
  let elsewhere: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-seeing-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-seeing-root-'))
    elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-seeing-elsewhere-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    // ⛔ **Past `0013`'s own wall clock** — `a-second-project-and-the-grant.test.ts` argues why.
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root, elsewhere]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⛔ Through the real boundary, so nothing here reaches a host method a window cannot. */
  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  /** `423`'s *New conversation as …* — a person opens a conversation as an identity. */
  const personOpens = async (profileId: string): Promise<string> => {
    const opened = (await ask({
      kind: 'createSession',
      provider: 'claude',
      profileId,
      approvalMode: 'ask',
      cwd: root,
    })) as { sessionId: string }
    return opened.sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  /** What an agent's own calls look like from outside the toolset — `agent:<its session>`. */
  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  const idsListedBy = async (toolset: AgentToolset): Promise<string[]> => {
    const listed = (await callOn(toolset, 'list_agents', {})) as { agents: { agent: string }[] }
    return listed.agents.map((one) => one.agent).sort()
  }

  /** Two callers differ only in their message grant. */
  const twoCallersAndOneTarget = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    explorer: string
    explorerTools: AgentToolset
    manager: string
  }> => {
    const manager = await personOpens('pm')
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = theToolsetJustHandedOut()
    const explorer = await personOpens('explorer')
    const explorerTools = theToolsetJustHandedOut()
    // 🔴 **549 · the narrow caller is one a PERSON narrowed** (HO-058 §1) — the ruled default is
    // `any`, so a caller left alone is not the narrow half of this pair. ⚑ **D-016 · narrowed to
    // `none`**, the one narrower word left now `same-project` is gone — still one column, one word
    // apart, nothing else different, which is what standing rule 3 asks of it. ⚠️ **That the DEFAULT
    // does not refuse is measured in `two-withdrawals-open-what-was-scoped.test.ts` §4.**
    expect(store.setCapabilities('explorer', { canMessage: 'none' })).toBe(true)
    // ⛔ **Two callers, one grant apart, and nothing else different about them** — standing rule 3.
    expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
    expect(store.capabilitiesOf('explorer')?.canMessage).toBe('none')
    expect(store.parentOf(manager)).toBeNull()
    return { brobot, brobotTools, explorer, explorerTools, manager }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · reading and messaging answer different questions
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the ruling, as two callers over one target', () => {
    /** Both readers answer for the same known conversation. */
    it('both callers read a foreign conversation while only one may message it', async () => {
      const { brobot, brobotTools, explorer, explorerTools, manager } =
        await twoCallersAndOneTarget()

      // ⚑ **All three, and the third one is the measurement's own control**: a global reach reaches
      // everything, so `explorer` — a conversation BroBot did not start, in BroBot's own project —
      // is named too. ⛔ A list of exactly *the caller plus the foreign one* would have been a list
      // about projects, which is not what this grant says.
      expect(await idsListedBy(brobotTools)).toEqual([brobot, explorer, manager].sort())
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { agent: manager },
      })

      expect(await idsListedBy(explorerTools)).toEqual([brobot, explorer, manager].sort())
      expect(await callOn(explorerTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { agent: manager },
      })
      expect(
        await callOn(explorerTools, 'message_agent', {
          agent: manager,
          text: 'hello',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'may-not-message' })
    })

    /** Reads report existence while messages retain their reach refusal. */
    it('a narrow caller can read a real conversation and still cannot message it', async () => {
      const { brobot, explorer, explorerTools, manager } = await twoCallersAndOneTarget()
      const aboutTheReal = await callOn(explorerTools, 'get_agent_status', { agent: manager })
      const aboutAGhost = await callOn(explorerTools, 'get_agent_status', {
        agent: 'sess_nobody_ever_opened',
      })
      expect(aboutTheReal).toMatchObject({ outcome: 'ok', agent: { agent: manager } })
      expect(aboutAGhost).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })
      expect(
        await callOn(explorerTools, 'message_agent', {
          agent: manager,
          text: 'anything at all',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'may-not-message', detail: { reach: 'none' } })
      const listed = await idsListedBy(explorerTools)
      expect(listed).toEqual([brobot, explorer, manager].sort())
      expect(listed).not.toContain('sess_nobody_ever_opened')
    })

    /** The two callers can read known cards, while message reach stays separate. */
    it('the card reader answers independently of the send door', async () => {
      const { brobot, brobotTools, explorer, explorerTools, manager } =
        await twoCallersAndOneTarget()
      // Messaging remains narrowed for explorer; the reader checks existence alone.
      expect(host.mayReachAtAll('message', speakingAs(brobot))).toBeNull()
      expect(host.mayReachAtAll('message', speakingAs(explorer))?.rail).toBe('may-not-message')
      const ghost = 'sess_nobody_ever_opened'
      const targets = [brobot, explorer, manager, ghost]
      for (const [who, tools] of [
        ['brobot', brobotTools],
        ['explorer', explorerTools],
      ] as const) {
        for (const target of targets) {
          const seen = await callOn(tools, 'get_agent_status', { agent: target })
          const pair = `${who} → ${target}: ${JSON.stringify(seen)}`
          if (target === ghost)
            expect(seen, pair).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })
          else expect(seen, pair).toMatchObject({ outcome: 'ok', agent: { agent: target } })
        }
      }
      expect(
        await callOn(explorerTools, 'message_agent', {
          agent: manager,
          text: 'hello',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'may-not-message' })
    })

    /** Reader descriptions promise discovery without promising a send. */
    it('⛔ each reader promises NAMING, and `list_agents` says that seeing is not sending', async () => {
      const { brobotTools } = await twoCallersAndOneTarget()
      const saidBy = (name: string): string => {
        const tool = brobotTools.tools.find((one) => one.name === name)
        if (tool === undefined) throw new Error(`no such tool: ${name}`)
        return tool.description
      }
      // ⛔ **The warning, by name** — without it the sentence over-promises for every caller.
      // ⚑ **D-017 · R13 — rewritten true, and the warning kept**: *listed* is not *admitted*.
      expect(saidBy('list_agents')).toContain(
        'Being listed is not a promise that every message to it is admitted — message_agent answers that separately.',
      )
      expect(saidBy('list_agents')).toContain('message_agent')
      // ⛔ …and `get_agent_status` promises the LISTING's own answer, which is the other half of
      // §B.2 and is true because it is literally the same predicate.
      expect(saidBy('get_agent_status')).toContain('list_agents')
      expect(saidBy('get_agent_status')).toContain('any conversation')
      // ⚑ **Non-vacuity**: the reader really reads a description, and a tool that promises neither
      // is what the assertions above would otherwise be satisfied by. ⚑ **D-017** — `end_agent`
      // stood here and is gone; `interrupt_agent` is the verb that took its place below a caller.
      expect(saidBy('interrupt_agent')).not.toContain('Being listed is not a promise')
    })

    /**
     * 🔴 **The counterexample that killed the first draft, kept as an assertion.**
     *
     * ⛔ **A caller can SEE a conversation it may not write to, and the commonest instance is
     * ITSELF.** ⚑ That is not a hole: `424` split `that-agent-is-you` out precisely so the refusal
     * is permanent and honest instead of a retry promise. ⚠️ **What it is, is the bound on what
     * `list_agents` may promise** — and the pair below is the two answers in one sample, so a future
     * sentence that widens the promise has a red waiting for it.
     */
    it('⛔ seeing is not sending: the caller’s own row is listed and permanently refused', async () => {
      const { brobot, brobotTools } = await twoCallersAndOneTarget()
      expect(await idsListedBy(brobotTools)).toContain(brobot)
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: brobot,
          text: 'hello me',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'that-agent-is-you', permanence: 'permanent' })
      // ⚑ **The paired positive, one target over**: the same caller writing to a conversation it may
      // write to — so the refusal above is about the TARGET being itself, not about the door.
      const { manager } = {
        manager: (await idsListedBy(brobotTools)).filter((id) => id !== brobot)[0] as string,
      }
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: manager,
          text: 'hello you',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    /** The grant help states which door the choice controls. */
    it('the grant sheet distinguishes message reach from reading', () => {
      const field = CAPABILITY_FIELDS.find((one) => one.key === 'canMessage')
      expect(field, 'the field this whole suite is about is gone').toBeDefined()
      const help = field?.help ?? ''
      expect(help).toContain('send a message to')
      expect(help).toContain('may read conversations and named work regardless of this setting')
      expect(capabilityField('canAssignWork').help).not.toContain(
        'read conversations and named work',
      )
    })

    /**
     * ⚑ **Enumerating and inspecting answer the SAME card** (§B.2's *"answer both, and say if they
     * differ"* — they do not).
     *
     * ⛔ **Byte-for-byte, in one sample**, because two readers that agreed today and were built on
     * two questions would drift the first time either moved.
     */
    it('⚑ the card `get_agent_status` answers is the card `list_agents` names', async () => {
      const { brobotTools, manager } = await twoCallersAndOneTarget()
      const listed = (await callOn(brobotTools, 'list_agents', {})) as {
        agents: { agent: string }[]
      }
      const inTheList = listed.agents.find((one) => one.agent === manager)
      const oneByOne = (await callOn(brobotTools, 'get_agent_status', { agent: manager })) as {
        agent: unknown
      }
      expect(inTheList).toBeDefined()
      expect(oneByOne.agent).toEqual(inTheList)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a card says to a caller that did not start it — 433 §B.3
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the card, whole', () => {
    /**
     * 🔴 **The judgement: nothing is redacted.**
     *
     * ⛔ **Reason 1, measured here**: the card a granted caller that did not start the conversation
     * gets is the same card the conversation's own caller gets. ⚠️ A second shape — the same row
     * with a field hollowed out — would mean two things, and the caller entitled to act on the
     * difference is the only one who could not tell them apart. ⚑ **D-016** — the card's `project`
     * field went with projects, so this no longer asserts it.
     */
    it('🔴 a card asked from across is the card its own side sees', async () => {
      const { brobotTools, manager } = await twoCallersAndOneTarget()
      const fromAcross = (await callOn(brobotTools, 'get_agent_status', { agent: manager })) as {
        agent: { whose: { profile?: string } }
      }
      expect(fromAcross.agent.whose.profile).toBe('pm')
      // ⛔ **The same card, asked by a caller nobody disputes is entitled**: the conversation
      // itself, through the `me` clause. ⚑ **D-017 · R11** — a tool's payload carries the card's one
      // state in its words (`agentStateWords`), so the host's card is compared in those words.
      const itsOwn = host.agentCard(manager, speakingAs(manager), manager)
      expect(itsOwn).not.toBeNull()
      if (itsOwn === null) throw new Error('unreachable')
      expect({ ...itsOwn, state: agentStateWords(itsOwn.state) }).toEqual(fromAcross.agent)
    })

    // ⚑ **D-016 · Reason 2 went with the field it measured** — `list_agents`' `project` filter and
    // the card's `project` are gone, so there is nothing a redaction could have emptied.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · what did NOT widen with the readers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the verbs, and the predicate they still ask', () => {
    /** Reading a conversation does not confer ownership of its work. */
    it('⛔ `withdraw_task` names a piece, and a caller that can see the conversation still cannot take its work back', async () => {
      const { brobotTools, explorerTools, manager } = await twoCallersAndOneTarget()
      // ⚠️ **The premises, asserted**: the manager owns a root nobody gave, and BroBot sees it.
      const itsRoot = store.rootOf(manager)
      expect(itsRoot, 'a conversation a person opened owns a root').not.toBeNull()
      expect(itsRoot?.givenBy).toBeNull()
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
      })
      const refused = await callOn(brobotTools, 'withdraw_task', { piece: itsRoot?.label })
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'not-a-piece-you-gave',
      })
      // ⚑ **The same call, one caller over** — the narrow identity meets the same word, because
      // the reach is not asked at this door. ⛔ **The fixture's own return, never `handed.at(-1)`**
      // — a later launch would silently point this pair at a different caller and the refusal
      // would go on passing.
      expect(await callOn(explorerTools, 'withdraw_task', { piece: itsRoot?.label })).toMatchObject(
        { outcome: 'refused', rail: 'not-a-piece-you-gave' },
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · 449 · what the surfaces SAY about the enforcement §1 measures
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /** The model-facing grant text must describe the message gate it controls. */
  describe('§4 · one word, two composites, and the three places that publish it', () => {
    /**
     * ⛔ **The MODEL's own copy of the rule, against the enforcement above** (standing rule 5).
     *
     * ⚑ **It is the same bytes the person's sheet draws**, which is the property that makes this
     * one sentence rather than three that happen to agree today — `433` F8's shape, refused.
     */
    it('⛔ each grant a model reads names what its OWN gate asks, and the sheet says it in the same bytes', () => {
      // ⚑ **D-016 · the sentence under test is `any`'s** — `same-project`'s, which this read first,
      // went with the word.
      const said = MESSAGING_REACH_ADMITS.any
      expect(said).toContain('whoever started it')
      // ⛔ **The roster is DERIVED from the descriptors, not typed here** — every field whose
      // vocabulary IS this one. ⚑ A third reach grant added tomorrow goes red until both of its
      // surfaces say what it admits, which is the whole reason `431` F8's shape keeps recurring:
      // *a help string two hundred lines from the docblock that was already corrected.*
      // ⚠️ **Widened to the union first**: `CAPABILITY_FIELDS` is a `const` tuple whose members
      // have DIFFERENT types, and only some of them declare `vocabulary` at all — reading the
      // property off the tuple does not compile, which is the tightening `374` bought deliberately.
      //
      // ⚑ **D-016 · by DECLARATION as well as spelling.** `same-project` was the word that told this
      // vocabulary from `CREATION_REACH`; with it gone both spell `none|any`, and a spelling filter
      // alone would sweep `canCreateAgents` in. ⛔ So each descriptor is read out of the source too,
      // and a field is on THIS vocabulary when its `vocabulary` is spread from `MESSAGING_REACH`.
      const capabilitiesSource = readFileSync(join(here, '../src/shared/capabilities.ts'), 'utf8')
      const declaredFrom = (key: string): string | null => {
        const at = capabilitiesSource.indexOf(`    key: '${key}',`)
        if (at < 0) return null
        const body = capabilitiesSource.slice(at, capabilitiesSource.indexOf('\n  },', at))
        return /vocabulary: \[\.\.\.(\w+)\]/.exec(body)?.[1] ?? null
      }
      // ⚠️ **The anchor, present before it is used**: the neighbour this filter must now tell apart.
      expect(declaredFrom('canCreateAgents')).toBe('CREATION_REACH')
      const everyField: readonly AnyCapabilityField[] = CAPABILITY_FIELDS
      const reachFields = everyField.filter(
        (field) =>
          field.vocabulary !== undefined &&
          [...field.vocabulary].join('|') === [...MESSAGING_REACH].join('|') &&
          declaredFrom(field.key) === 'MESSAGING_REACH',
      )
      // ⚑ **553 · a second field on this vocabulary, and a second composite with it** (HO-060 §2).
      // ⛔ The whole point of this walk is that sharing `MESSAGING_REACH` is not sharing a gate;
      // `canAssignWork` is the proof, and the loop below holds it to the same rule as
      // `canMessage` — its own `says` table, naming both facts. ⚑ **D-014 · the interrupt grant
      // left the vocabulary**: ending and interrupting are asked of the chain, not of a grant.
      expect(reachFields.map((field) => field.key)).toEqual(['canMessage', 'canAssignWork'])
      // 🔴 **553 · a TABLE, because a ternary was a comparison tested where both sides agree.**
      // ⛔ One that picked a table by key checked any other field on this vocabulary against the
      // MESSAGE table by default, so the walk would have passed over a field whose sentence nobody
      // had decided. ⚑ **A named table forces the decision**: a third reach grant goes red on the
      // equality two lines up until somebody adds a row here and says whose sentence it reads, and
      // then `admits[word]` is `undefined` until they do — which is this test's own argument
      // applied to itself.
      //
      // ⚠️ **`satisfies` and not an annotation**, because a `Record` over `CapabilityKey` would
      // demand a row for every field including the four on other vocabularies, and one over
      // `(typeof reachFields)[number]['key']` widens to the same thing — the union is computed
      // from the `const` tuple and not from the filter.
      const SAYS = {
        canMessage: MESSAGING_REACH_ADMITS,
        canAssignWork: ASSIGNMENT_REACH_ADMITS,
      } satisfies Readonly<Record<string, Readonly<Record<MessagingReach, string>>>>
      for (const field of reachFields) {
        const admits = SAYS[field.key as keyof typeof SAYS]
        for (const word of MESSAGING_REACH) {
          expect(field.help, `${field.key} does not say what ${word} reaches`).toContain(
            admits[word],
          )
        }
      }
      // 🔴 **493 · vocabulary equality is not gate equality.** Message `any` reaches a
      // conversation this identity did not start; giving work at `any` still goes only to one it
      // Work goes to a conversation the caller has with the agent, started when needed.
      expect(ASSIGNMENT_REACH_ADMITS.any).not.toBe(MESSAGING_REACH_ADMITS.any)
      expect(ASSIGNMENT_REACH_ADMITS.any).toBe(
        'any agent — the work goes to a conversation it has with that agent, started for it when needed',
      )
      // ⚠️ **Non-vacuity**: a field on the OTHER two-word vocabulary does not carry these
      // sentences, so the loop above is about this vocabulary rather than about help strings being
      // long enough to contain anything.
      expect(capabilityField('canCreateAgents').help).not.toContain(said)
      // ⛔ **`none` is NOT `any`'s claim** — the two words of the one vocabulary say two things.
      expect(MESSAGING_REACH_ADMITS.none).not.toBe(said)
      // 🔴 **D-014 · the two tables differ at `any` and nowhere else.** ⛔ `565` gave
      // `admitAssignment` a third arm — *an identity that accepts many callers accepts work from any
      // caller* — and D-014 withdrew it (a shared service takes questions and notes, not work).
      // ⚑ **What separates the two tables is `any`**, asserted above, and `none` is pinned
      // byte-identical so a rewrite of either one arrives as a decision (D-016: `same-project`, the
      // other word pinned here, is gone).
      expect(ASSIGNMENT_REACH_ADMITS.none).toBe(MESSAGING_REACH_ADMITS.none)
      // ⛔ **No word admits work by the receiver's breadth any more** — absence, on purpose.
      for (const word of MESSAGING_REACH) {
        expect(ASSIGNMENT_REACH_ADMITS[word], word).not.toContain('many callers')
      }
      expect(SAYS.canAssignWork).not.toBe(SAYS.canMessage)
      // ⚑ **D-016 · the pair is `none` against `any` now** — it compared `none` with `same-project`.
      expect(reachesWhatItDidNotStart('none')).toBe(false)
      // ⚠️ **Non-vacuity for the pair above**: the one word that DOES reach past its holder.
      expect(reachesWhatItDidNotStart('any')).toBe(true)
    })
  })
})
