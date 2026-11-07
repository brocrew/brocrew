import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'
import type { ToolRefusedEvent, TranscriptEvent } from '../src/shared/conversation-events'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  SPAWN_RAILS,
  permanenceOf,
  refuse,
  remedyOf,
  type SpawnRail,
} from '../src/main/runtime/spawn-rails'
import {
  MESSAGE_RAILS,
  messagePermanenceOf,
  messageRemedyOf,
  refuseMessage,
  type MessageRail,
} from '../src/main/runtime/message-rails'
import {
  REPLY_RAILS,
  REPLY_SUMMARY_LIMIT,
  replyPermanenceOf,
  replyRemedyOf,
  refuseReply,
  type ReplyRail,
} from '../src/main/runtime/reply-rails'
import {
  QUESTION_RAILS,
  questionPermanenceOf,
  questionRemedyOf,
  refuseQuestion,
  type QuestionRail,
} from '../src/main/runtime/question-rails'
import {
  INTERRUPT_RAILS,
  interruptPermanenceOf,
  interruptRemedyOf,
  refuseInterrupt,
  type InterruptRail,
} from '../src/main/runtime/interrupt-rails'
import {
  TOOL_REFUSALS,
  agentToolsFor,
  refusalIn,
  refuseTool,
  toolRemedyOf,
  agentCallerId,
  type AgentToolHost,
  type ToolName,
  type ToolRefusal,
} from '../src/main/runtime/agent-tools'
import {
  RESOURCE_RAILS,
  readOfferedResource,
  resourceRemedyOf,
  resourcesRoot,
  refuseResource,
  type ResourceRail,
} from '../src/main/resources/resources'
import {
  PERMANENCE_SAID,
  RAIL_PERMANENCES,
  REFUSAL_REMEDIES,
  isRefusalRemedy,
  type RailPermanence,
  type RefusalRemedy,
} from '../src/shared/refusals'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

interface Vocabulary {
  readonly name: string
  readonly rails: readonly string[]
  readonly permanenceOf: (rail: string) => RailPermanence
  readonly remedyOf: (rail: string) => RefusalRemedy | null
  readonly built: (rail: string) => { permanence: string; remedy: RefusalRemedy | null }
}

const VOCABULARIES: readonly Vocabulary[] = [
  {
    name: 'SPAWN_RAILS',
    rails: SPAWN_RAILS,
    permanenceOf: (rail) => permanenceOf(rail as SpawnRail),
    remedyOf: (rail) => remedyOf(rail as SpawnRail),
    built: (rail) => refuse(rail as SpawnRail),
  },
  {
    name: 'MESSAGE_RAILS',
    rails: MESSAGE_RAILS,
    permanenceOf: (rail) => messagePermanenceOf(rail as MessageRail),
    remedyOf: (rail) => messageRemedyOf(rail as MessageRail),
    built: (rail) => refuseMessage(rail as MessageRail),
  },
  {
    name: 'TOOL_REFUSALS',
    rails: TOOL_REFUSALS,
    permanenceOf: (rail) => refuseTool(rail as ToolRefusal).permanence,
    remedyOf: (rail) => toolRemedyOf(rail as ToolRefusal),
    built: (rail) => refuseTool(rail as ToolRefusal),
  },
  {
    name: 'REPLY_RAILS',
    rails: REPLY_RAILS,
    permanenceOf: (rail) => replyPermanenceOf(rail as ReplyRail),
    remedyOf: (rail) => replyRemedyOf(rail as ReplyRail),
    built: (rail) => refuseReply(rail as ReplyRail),
  },
  {
    name: 'QUESTION_RAILS',
    rails: QUESTION_RAILS,
    permanenceOf: (rail) => questionPermanenceOf(rail as QuestionRail),
    remedyOf: (rail) => questionRemedyOf(rail as QuestionRail),
    built: (rail) => refuseQuestion(rail as QuestionRail),
  },
  {
    name: 'INTERRUPT_RAILS',
    rails: INTERRUPT_RAILS,
    permanenceOf: (rail) => interruptPermanenceOf(rail as InterruptRail),
    remedyOf: (rail) => interruptRemedyOf(rail as InterruptRail),
    built: (rail) => refuseInterrupt(rail as InterruptRail),
  },
  {
    name: 'RESOURCE_RAILS',
    rails: RESOURCE_RAILS,
    permanenceOf: (rail) => refuseResource(rail as ResourceRail).permanence,
    remedyOf: (rail) => resourceRemedyOf(rail as ResourceRail),
    built: (rail) => refuseResource(rail as ResourceRail),
  },
]

interface RailPolicy {
  readonly vocabulary: string
  readonly rail: string
  readonly permanence: RailPermanence
  readonly remedy: RefusalRemedy | null
}

const everyRail = (vocabularies: readonly Vocabulary[] = VOCABULARIES): RailPolicy[] =>
  vocabularies.flatMap((vocabulary) =>
    vocabulary.rails.map((rail) => ({
      vocabulary: vocabulary.name,
      rail,
      permanence: vocabulary.permanenceOf(rail),
      remedy: vocabulary.remedyOf(rail),
    })),
  )

describe('425 · a refusal carries its remedy', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let window: RecordingSink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-remedy-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-remedy-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, work]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId = 'pm',
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode },
      window,
    )
    return sessionId
  }

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const grant = (profileId: string, edit: Parameters<SessionStore['setCapabilities']>[1]): void => {
    expect(store.setCapabilities(profileId, edit)).toBe(true)
  }

  const callerOf = (of: AgentToolHost, sessionId: string) => {
    const set = agentToolsFor(of, sessionId)
    return async (name: ToolName, args: Record<string, unknown> = {}) => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return (await tool.call(args)).structured as Record<string, unknown>
    }
  }

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((one) => one.event)

  const refusalsIn = (sessionId: string): ToolRefusedEvent[] =>
    events(sessionId).filter((one): one is ToolRefusedEvent => one.type === 'tool_refused')

  const theRefusalIn = (sessionId: string): ToolRefusedEvent => {
    const rows = refusalsIn(sessionId)
    expect(rows).toHaveLength(1)
    const [row] = rows
    if (row === undefined) throw new Error(`${sessionId} recorded no refusal`)
    return row
  }

  const theNoticeFor = (event: TranscriptEvent): NoticeItem => {
    const state = createTranscript()
    applyEvent(state, event)
    expect(state.items).toHaveLength(1)
    const [item] = state.items
    if (item === undefined || item.kind !== 'notice') {
      throw new Error(`${event.type} drew ${item === undefined ? 'nothing' : item.kind}`)
    }
    return item
  }

  const rowSaying = (remedy: unknown): ToolRefusedEvent =>
    ({
      type: 'tool_refused',
      tool: 'message_agent',
      rail: 'a-rail',
      permanence: 'while-this-holds',
      retryable: true,
      remedy,
    }) as ToolRefusedEvent

  const wrote = (name: string, text: string | Buffer): string => {
    const path = join(work, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    return path
  }

  const aPieceToReplyTo = async (): Promise<{ owner: string; label: string }> => {
    await bringIdentityIntoBeing('worker')
    const giver = await personOpens()
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'write the long form',
        brief: 'write the long form',
      },
      { ownerId: agentCallerId(giver) },
    )
    if (!given.ok) throw new Error(`expected a give, got ${given.refusal.rail}`)
    return { owner: given.owner, label: given.label }
  }

  const offer = (piece: { owner: string; label: string }, resourcePath: string) =>
    host.replyToParent(
      {
        piece: piece.label,
        outcome: 'done',
        summary: 'done it',
        resourcePaths: [resourcePath],
        needsUserAction: false,
      },
      { ownerId: agentCallerId(piece.owner) },
    )

  describe('§1 · the partition, walked from the vocabularies', () => {
    it('🔴 the rails that carry a remedy are exactly these memberships', () => {
      const carrying = everyRail()
        .filter((one) => one.remedy !== null)
        .map((one) => `${one.vocabulary} · ${one.rail}`)
        .sort()
      expect(carrying).toEqual(
        [
          'INTERRUPT_RAILS · that-conversation-has-not-started',
          'QUESTION_RAILS · answer-too-long',
          'QUESTION_RAILS · move-offer-is-held',
          'QUESTION_RAILS · that-answer-cannot-be-sent',
          'REPLY_RAILS · summary-too-long',
          'RESOURCE_RAILS · resource-empty',
          'RESOURCE_RAILS · resource-not-text',
          'RESOURCE_RAILS · resource-too-large',
          'RESOURCE_RAILS · resource-unreadable',
          'TOOL_REFUSALS · agent-could-not-start-just-now',
          'TOOL_REFUSALS · that-conversation-could-not-be-woken-just-now',
          'TOOL_REFUSALS · that-conversation-has-not-started',
          'TOOL_REFUSALS · that-conversation-is-still-stopping',
          'TOOL_REFUSALS · that-work-is-being-sent',
          'TOOL_REFUSALS · work-record-unavailable',
          'TOOL_REFUSALS · the-start-it-waited-on-did-not-happen',
          'TOOL_REFUSALS · it-is-being-archived-or-deleted',
          'TOOL_REFUSALS · theme-invalid',
          'TOOL_REFUSALS · theme-exists',
          'TOOL_REFUSALS · theme-unknown',
          'TOOL_REFUSALS · theme-too-large',
          'SPAWN_RAILS · it-would-wait-on-itself',
          'SPAWN_RAILS · its-waits-cannot-all-be-checked',
          'SPAWN_RAILS · no-free-worker-at-capacity',
          'INTERRUPT_RAILS · that-service-is-on-another-callers-piece',
          'TOOL_REFUSALS · that-piece-is-still-queued',
          'REPLY_RAILS · a-conversation-with-its-questions-is-starting',
          'REPLY_RAILS · its-questions-could-not-all-be-read',
          'TOOL_REFUSALS · a-conversation-with-its-questions-is-starting',
          'TOOL_REFUSALS · its-questions-could-not-all-be-read',
        ].sort(),
      )
      expect(carrying).toHaveLength(30)
    })

    it('🔴 the named rails with no remedy are independently not retryable', () => {
      const NAMED_WITHOUT_REMEDIES: readonly (readonly [string, string])[] = [
        ['SPAWN_RAILS', 'worker-binding-is-unknown'],
        ['SPAWN_RAILS', 'parallel-not-for-a-service'],
        ['INTERRUPT_RAILS', 'a-person-is-being-asked'],
        ['INTERRUPT_RAILS', 'not-below-you'],
        ['INTERRUPT_RAILS', 'it-is-waiting-on-an-answer'],
        ['TOOL_REFUSALS', 'that-conversation-takes-no-messages'],
        ['TOOL_REFUSALS', 'agent-cannot-take-a-message'],
        ['RESOURCE_RAILS', 'resource-store-unavailable'],
        ['RESOURCE_RAILS', 'resource-bytes-unreadable'],
        ['QUESTION_RAILS', 'no-question-by-that-name'],
        ['TOOL_REFUSALS', 'no-such-agent'],
        ['RESOURCE_RAILS', 'no-such-resource'],
        ['REPLY_RAILS', 'no-piece-by-that-name'],
      ]
      const policies = everyRail()
      for (const [vocabulary, rail] of NAMED_WITHOUT_REMEDIES) {
        const label = `${vocabulary} · ${rail}`
        const matches = policies.filter((one) => one.vocabulary === vocabulary && one.rail === rail)
        expect(matches, `${label} is not exactly one vocabulary membership`).toHaveLength(1)
        const [policy] = matches
        if (policy === undefined) throw new Error(`${label} has no policy`)
        expect(policy.remedy, label).toBeNull()
        expect(policy.permanence, label).not.toBe('while-this-holds')
      }

      for (const one of everyRail()) {
        expect(one.remedy !== null, `${one.vocabulary} · ${one.rail}`).toBe(
          one.permanence === 'while-this-holds',
        )
      }
      const retryable = everyRail().filter((one) => one.permanence === 'while-this-holds')
      expect(retryable).toHaveLength(30)
      expect(retryable.filter((one) => one.remedy === null)).toEqual([])
    })

    it('⛔ the pair walk sees both planted divergences behind shared rail spellings', () => {
      const planted = VOCABULARIES.map((vocabulary): Vocabulary =>
        vocabulary.name !== 'TOOL_REFUSALS'
          ? vocabulary
          : {
              ...vocabulary,
              remedyOf: (rail) =>
                rail === 'malformed-request'
                  ? 'make-the-same-call-when-this-settles'
                  : vocabulary.remedyOf(rail),
              permanenceOf: (rail) =>
                rail === 'spawning-disabled' ? 'while-this-holds' : vocabulary.permanenceOf(rail),
            },
      )
      const wrong = everyRail(planted).filter(
        (one) => (one.remedy !== null) !== (one.permanence === 'while-this-holds'),
      )
      expect(wrong.map((one) => `${one.vocabulary} · ${one.rail}`)).toEqual([
        'TOOL_REFUSALS · malformed-request',
        'TOOL_REFUSALS · spawning-disabled',
      ])
    })

    it('⛔ not one rail this app cannot retry carries a remedy', () => {
      const quiet = everyRail().filter((one) => one.permanence !== 'while-this-holds')
      const wrong = quiet.filter((one) => one.remedy !== null)
      expect(wrong).toEqual([])
      expect(quiet).toHaveLength(87)
      for (const [rail, permanence] of [
        ['service-provider-is-fixed', 'permanent'],
        ['no-room-for-provider-conversation', 'until-a-person-changes-it'],
      ]) {
        expect(quiet).toContainEqual(
          expect.objectContaining({ vocabulary: 'SPAWN_RAILS', rail, permanence, remedy: null }),
        )
      }
      for (const rail of ['move-offer-not-available', 'move-offer-needs-a-person']) {
        expect(quiet).toContainEqual(
          expect.objectContaining({ vocabulary: 'QUESTION_RAILS', rail, remedy: null }),
        )
      }
      expect(quiet.filter((one) => one.rail === 'result-document-not-returned')).toMatchObject([
        { rail: 'result-document-not-returned', permanence: 'permanent', remedy: null },
      ])
      expect(quiet).toContainEqual(
        expect.objectContaining({
          vocabulary: 'TOOL_REFUSALS',
          rail: 'theme-is-built-in',
          remedy: null,
        }),
      )
      expect(refuse('wider-than-its-parent').reason).toContain(
        'Do this work here, or ask a person whether to change your approval mode',
      )
      expect(refuseTool('agent-name-taken').reason).toContain('Choose a different name')
    })

    it('⚑ the closed remedy words fold memberships instead of respelling their rails', () => {
      expect(REFUSAL_REMEDIES).toHaveLength(6)
      const by = new Map<RefusalRemedy, string[]>()
      for (const one of everyRail()) {
        const said = one.remedy
        if (said === null) continue
        by.set(said, [...(by.get(said) ?? []), `${one.vocabulary} · ${one.rail}`].sort())
      }
      expect([...by.keys()].sort()).toEqual([...REFUSAL_REMEDIES].sort())
      expect(by.get('change-what-you-sent-and-call-again')).toEqual([
        'TOOL_REFUSALS · theme-exists',
        'TOOL_REFUSALS · theme-invalid',
        'TOOL_REFUSALS · theme-too-large',
        'TOOL_REFUSALS · theme-unknown',
      ])
      expect(by.get('make-the-same-call-when-this-settles')).toEqual(
        [
          'INTERRUPT_RAILS · that-conversation-has-not-started',
          'QUESTION_RAILS · move-offer-is-held',
          'TOOL_REFUSALS · agent-could-not-start-just-now',
          'TOOL_REFUSALS · that-conversation-could-not-be-woken-just-now',
          'TOOL_REFUSALS · that-conversation-has-not-started',
          'TOOL_REFUSALS · that-conversation-is-still-stopping',
          'TOOL_REFUSALS · that-work-is-being-sent',
          'TOOL_REFUSALS · work-record-unavailable',
          'TOOL_REFUSALS · the-start-it-waited-on-did-not-happen',
          'TOOL_REFUSALS · it-is-being-archived-or-deleted',
          'SPAWN_RAILS · it-would-wait-on-itself',
          'SPAWN_RAILS · its-waits-cannot-all-be-checked',
          'SPAWN_RAILS · no-free-worker-at-capacity',
          'INTERRUPT_RAILS · that-service-is-on-another-callers-piece',
          'TOOL_REFUSALS · that-piece-is-still-queued',
          'REPLY_RAILS · a-conversation-with-its-questions-is-starting',
          'REPLY_RAILS · its-questions-could-not-all-be-read',
          'TOOL_REFUSALS · a-conversation-with-its-questions-is-starting',
          'TOOL_REFUSALS · its-questions-could-not-all-be-read',
        ].sort(),
      )
      expect(REFUSAL_REMEDIES as readonly string[]).not.toContain(
        'withdraw-the-work-or-ask-about-it',
      )
      expect(by.get('shorten-the-answer-or-put-the-long-form-in-a-file')).toEqual([
        'QUESTION_RAILS · answer-too-long',
      ])
      expect(by.get('offer-a-workspace-markdown-file-that-reads')).toEqual([
        'RESOURCE_RAILS · resource-empty',
        'RESOURCE_RAILS · resource-not-text',
        'RESOURCE_RAILS · resource-too-large',
        'RESOURCE_RAILS · resource-unreadable',
      ])
      const rails = new Set(everyRail().map((one) => one.rail))
      for (const said of REFUSAL_REMEDIES) expect(rails.has(said)).toBe(false)
    })

    it('⛔ every door BUILDS the word its table says, walked over every rail there is', () => {
      const walked: string[] = []
      for (const vocabulary of VOCABULARIES) {
        for (const rail of vocabulary.rails) {
          const built = vocabulary.built(rail)
          const label = `${vocabulary.name} · ${rail}`
          expect(built.remedy, label).toBe(vocabulary.remedyOf(rail))
          expect(Object.keys(built), label).toContain('remedy')
          walked.push(label)
        }
      }
      expect(walked).toHaveLength(117)
      expect(walked).toEqual(everyRail().map((one) => `${one.vocabulary} · ${one.rail}`))
    })
  })

  describe('§2 · a remedy is what you may do, never what you asked for', () => {
    it('🔴 a remedy carries no data at all, so it cannot be a lie about entitlement', () => {
      for (const said of REFUSAL_REMEDIES) {
        expect(typeof said).toBe('string')
        expect(said).toMatch(/^[a-z]+(-[a-z]+)+$/)
      }
    })

    it('⛔ the same rail refused with different detail says the same word, byte for byte', () => {
      const first = refuseResource('resource-too-large', {
        bytes: 9_000_000,
        limit: 1_048_576,
        path: '/Users/somebody/northwind-acquisition/secret.md',
      })
      const second = refuseResource('resource-too-large', {})
      expect(first.remedy).toBe(second.remedy)
      expect(first.remedy).toBe('offer-a-workspace-markdown-file-that-reads')
    })

    it('🔴 nothing a caller wrote reaches the row, and the remedy did not re-open that door', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      grant('pm', { maxDepth: 0 })
      const call = callerOf(host, pm)
      const secret = 'Northwind: do not write this into a ledger'
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: secret,
        brief: secret,
      })

      const row = theRefusalIn(pm)
      const written = JSON.stringify(row)
      expect(written).not.toContain('Northwind')
      expect(written).toContain('too-deep')
      expect(row.remedy === null || isRefusalRemedy(row.remedy)).toBe(true)
    })
  })

  describe('§3 · the resource shapes, refused and then satisfied', () => {
    it('🔴 each malformed resource shape is refused with the same act, and the act works', async () => {
      const piece = await aPieceToReplyTo()
      const shapes: { rail: ResourceRail; path: string }[] = [
        { rail: 'resource-unreadable', path: join(work, 'nothing-here.md') },
        { rail: 'resource-too-large', path: wrote('big.md', `${'a'.repeat(1_048_576)}\n`) },
        { rail: 'resource-empty', path: wrote('empty.md', '') },
        { rail: 'resource-not-text', path: wrote('bytes.md', Buffer.from([0xff, 0xfe, 0x00])) },
      ]
      for (const shape of shapes) {
        const refused = await offer(piece, shape.path)
        expect(refused.ok, shape.rail).toBe(false)
        if (refused.ok) continue
        expect(refused.refusal.rail).toBe(shape.rail)
        expect(refused.refusal.remedy, shape.rail).toBe(
          'offer-a-workspace-markdown-file-that-reads',
        )
        expect(refused.refusal.reason, shape.rail).toContain('offer that path instead')
        for (const verb of ['Write tool', 'apply_patch', 'shell', 'grant']) {
          expect(refused.refusal.reason, `${shape.rail} names ${verb}`).not.toContain(verb)
        }
      }

      const followed = await offer(piece, wrote('the-long-form.md', '# It fits\n\nAll of it.\n'))
      expect(followed.ok, JSON.stringify(followed)).toBe(true)
      expect(readOfferedResource(join(work, 'empty.md')).ok).toBe(false)
    })

    it('⛔ permanent resource-shape rails carry nothing, beside a present remedy', async () => {
      const piece = await aPieceToReplyTo()
      const notMarkdown = await offer(piece, wrote('notes.txt', 'plain\n'))
      expect(notMarkdown.ok).toBe(false)
      if (!notMarkdown.ok) {
        expect(notMarkdown.refusal.rail).toBe('resource-not-a-form-this-app-keeps')
        expect(notMarkdown.refusal.remedy).toBeNull()
      }
      const refused = await offer(piece, wrote('nothing.md', ''))
      expect(refused.ok).toBe(false)
      if (!refused.ok) {
        expect(refused.refusal.remedy).toBe('offer-a-workspace-markdown-file-that-reads')
      }
    })
  })

  describe('§4 · the whole way from the rail to the person', () => {
    it('🔴 a refusal with an act reaches the ledger and the transcript says what the act is', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm', 'auto')
      const first = await callerOf(host, pm)('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'work',
        brief: 'work',
      })
      expect(first.outcome, JSON.stringify(first)).toBe('ok')
      const child = first.agent as string
      await waitFor(
        () => events(child).some((one) => one.type === 'turn'),
        'the brief’s turn to end',
      )

      const refused = await callerOf(host, child)('reply_to_parent', {
        piece: first.label,
        outcome: 'done',
        summary: 'x'.repeat(REPLY_SUMMARY_LIMIT + 1),
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('summary-too-long')
      expect(refused.remedy).toBe('shorten-the-summary-and-attach-the-long-form')

      const row = theRefusalIn(child)
      expect(row.remedy).toBe('shorten-the-summary-and-attach-the-long-form')

      const said = theNoticeFor(row).text
      expect(said).toContain('it can shorten the summary and put the long form in a file it names')
      expect(said).not.toContain('shorten-the-summary-and-attach-the-long-form')
      expect(said).toContain('reply_to_parent')
      expect(said).toContain('summary-too-long')
      expect(said).toContain(PERMANENCE_SAID['while-this-holds'])
      expect(said).toContain('retrying may work')

      const line = describeEvent(row)
      expect(line).toContain('shorten-the-summary-and-attach-the-long-form')
      expect(line).not.toContain('it can shorten the summary')
    })

    it('⚑ the same call with nothing held is admitted, writes no row, and carries no remedy', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm', 'auto')
      const call = callerOf(host, pm)
      const sent = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'work',
        brief: 'work',
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      expect(sent).not.toHaveProperty('remedy')
      expect(refusalsIn(pm)).toEqual([])
    })

    it('⛔ `refusalIn` carries the word out of an untyped payload, walked over a vocabulary', () => {
      for (const rail of TOOL_REFUSALS) {
        const payload = refuseTool(rail, { agent: 'sess_1' })
        const read = refusalIn('a_tool', { ...payload })
        expect(read?.remedy, rail).toBe(payload.remedy)
      }
      const later = refusalIn('a_tool', {
        outcome: 'refused',
        rail: 'a-rail',
        permanence: 'while-this-holds',
        retryable: true,
        remedy: 'a-word-from-a-later-build',
      })
      expect(later).not.toBeNull()
      expect(later?.rail).toBe('a-rail')
      expect(later?.remedy).toBeNull()
      expect(
        refusalIn('a_tool', {
          outcome: 'refused',
          rail: 'a-rail',
          permanence: 'permanent',
          retryable: false,
        })?.remedy,
      ).toBeNull()
    })
  })

  describe('§5 · where the app does not know, neither reader is told anything', () => {
    it('🔴 absent, null and a word from a later build all draw NOTHING — with a present one beside', () => {
      const bare: ToolRefusedEvent = {
        type: 'tool_refused',
        tool: 'message_agent',
        rail: 'a-rail',
        permanence: 'while-this-holds',
        retryable: true,
      }
      const drawn = [
        theNoticeFor(bare).text,
        theNoticeFor(rowSaying(null)).text,
        theNoticeFor(rowSaying('a-word-from-a-later-build')).text,
      ]
      const before = `refused: message_agent · a-rail · ${PERMANENCE_SAID['while-this-holds']} · retrying may work`
      expect(drawn).toEqual([before, before, before])
      for (const line of drawn) expect(line).not.toContain('undefined')
      expect(drawn[2]).not.toContain('a-word-from-a-later-build')
      const present = theNoticeFor(rowSaying('make-the-same-call-when-this-settles')).text
      expect(present.startsWith(before)).toBe(true)
      expect(present.length).toBeGreaterThan(before.length)

      expect(describeEvent(bare)).toBe(describeEvent(rowSaying(null)))
      expect(describeEvent(rowSaying('a-word-from-a-later-build'))).toBe(describeEvent(bare))
      expect(describeEvent(rowSaying('make-the-same-call-when-this-settles'))).toContain(
        'make-the-same-call-when-this-settles',
      )
      expect(isRefusalRemedy('a-word-from-a-later-build')).toBe(false)
    })

    it('⚑ every word renders as a clause of its own, walked from the vocabulary', () => {
      const said = REFUSAL_REMEDIES.map((remedy) => theNoticeFor(rowSaying(remedy)).text)
      expect(new Set(said).size).toBe(REFUSAL_REMEDIES.length)
      for (const [at, remedy] of REFUSAL_REMEDIES.entries()) {
        expect(said[at], remedy).not.toContain(remedy)
        expect(said[at], remedy).not.toContain('you ')
      }
    })

    it('⛔ the permanence is still printed when this build does not know it, and the remedy is not', () => {
      const strange = theNoticeFor({
        type: 'tool_refused',
        tool: 'message_agent',
        rail: 'a-rail',
        permanence: 'a-word-from-a-later-build' as never,
        retryable: true,
        remedy: 'another-word-from-a-later-build' as never,
      }).text
      expect(strange).toContain('a-word-from-a-later-build')
      expect(strange).not.toContain('another-word-from-a-later-build')
      for (const permanence of RAIL_PERMANENCES) {
        expect(
          theNoticeFor({
            type: 'tool_refused',
            tool: 'message_agent',
            rail: 'a-rail',
            permanence,
            retryable: false,
          }).text,
        ).not.toContain(permanence)
      }
    })
  })
})
