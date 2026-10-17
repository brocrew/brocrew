import { RuntimeHost as GiverNoticeHost } from './giver-notice-host'
import { makeWorkerPieceFolder } from '../../src/main/worker-piece-folder'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeProviderSessions, FakeRuntime, ResumeError } from '@brobot2/runtime'
import type {
  FakeSessionHandle,
  ProviderRuntimeContext,
  SessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../../src/main/db/session-store'
import {
  profileExecutionFile,
  readProfileExecution,
  writeProfileExecution,
  type KeptProfileExecution,
  type ProfileExecution,
} from '../../src/main/profile-execution-file'
import { agentCallerId } from '../../src/main/runtime/agent-tools'
import {
  RuntimeHost,
  type GiveOutcome,
  type RuntimeEventSink,
} from '../../src/main/runtime/runtime-host'
import { resourcesRoot } from '../../src/main/resources/resources'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'

/**
 * A data folder with a database and a services list, and hosts over it, for the tests of service
 * profiles. Fictional agents only; no provider runs: every start is a fake one, and is counted.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../../src/main/db/migrations')

/** 2026-10-11 15:00 UTC. */
export const NOW = 1_791_730_800_000

export class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** Which writes of the services list fail: none, every one, or those holding this field. */
export type WritesFail = 'none' | 'all' | keyof ProfileExecution

export interface AServiceWorld {
  readonly folder: string
  readonly db: AppDatabase
  readonly store: SessionStore
  readonly window: RecordingSink
  /** Every provider start a host asked for, by the profile it ran as. */
  readonly startedAs: string[]
  /** The provider home of each start in {@link startedAs}, in the same order. */
  readonly startedIn: string[]
  /**
   * Every turn handed to a provider this world started or resumed, in order: the profile it ran as,
   * its words, and the model and effort in force for that turn.
   */
  readonly sent: {
    readonly as: string
    readonly words: string
    readonly model: string | null
    readonly effort: string | null
  }[]
  writesFail: WritesFail
  startsFail: boolean
  /** While set, every resume of a conversation of this agent fails. */
  resumesFailFor: string | null
  /** The fictional provider no longer holds conversations of this agent. */
  resumesAreGoneFor: string | null
  /** While set, every provider start waits for it before it goes on. */
  startsWait: Promise<void> | null
  /** While set, every provider resume waits for it before it goes on, and counts as asked. */
  resumesWait: Promise<void> | null
  /** How many resumes this world's providers have been asked for. */
  resumesAsked: number
  /** Every provider handle this world started or resumed, in order, by the profile it runs as. */
  readonly handles: { readonly as: string; readonly handle: FakeSessionHandle }[]
  /** While set, every turn a provider takes stays working until it is released. */
  turnsWait: Promise<void> | null
  /**
   * While set, every send a provider takes has begun its turn but does not settle until it is
   * released, so the words are still being handed over.
   */
  sendsSettle: Promise<void> | null
  /**
   * While set, every stop a provider is asked for waits for it before it is taken — and then stops
   * whatever turn is open, as Claude's stop does once its answer is late.
   */
  stopsWait: Promise<void> | null
  /**
   * Whether a stop that waited for {@link stopsWait} stops only the turn it was asked of, as Codex
   * addresses its stop, rather than whatever turn is open then, as Claude's late stop does.
   */
  stopsAddressTheirTurn: boolean
  /**
   * Whether the providers a host starts from now on check their sign-in, which the double does not:
   * each check waits for {@link signInWait}, then finds it unchanged.
   */
  signInsChecked: boolean
  /** While set, every sign-in check, the last wait before held words go, waits for it. */
  signInWait: Promise<void> | null
  /** How many sign-in checks were made, and how many of them go by {@link signInWait}. */
  signInChecks: number
  signInChecksLetThrough: number
  /**
   * While set, every sign-in check of a provider running as this agent finds it moved on, until a
   * new life of that agent starts, on the current one.
   */
  signInMovedFor: string | null
  /** Every stop a provider was asked for, by the profile it runs as. */
  readonly stopsAsked: string[]
  /**
   * Every stop a provider was asked to make explicit, ending every command the stopped turn
   * started, by the profile it runs as. The double has no such commands of its own.
   */
  readonly explicitStops: string[]
  /** Every model list a provider was asked for, by the profile whose home asked it. */
  readonly listedFor: string[]
  /** While set, every model list a provider is asked for waits for it before it is answered. */
  listsWait: Promise<void> | null
  /** Every model list a provider is asked for fails. */
  listsFail: boolean
  /** The newest provider handle this world started or resumed as `profile`, as the host holds it. */
  handleOf(profile: string): SessionHandle
  /** While set, every send a provider takes waits for it once its words are in, before it settles. */
  sendFinishesWait: Promise<void> | null
  sendReturnsError: boolean
  clock: number
  /** How far the clock moves at each reading: 0 holds it still. */
  clockStep: number
  /**
   * A host over this data folder: the only app on it, with services on, unless said otherwise. The
   * switch is set in the services list as the host starts, as a person's choice would leave it.
   */
  aHost(opts?: {
    owned?: boolean
    servicesOn?: boolean
    store?: SessionStore
    interruptWaitMs?: number
    deliveryWaitMs?: number
    endingWaitMs?: number
    windowWriterStamp?: ConstructorParameters<typeof RuntimeHost>[0]['windowWriterStamp']
    limitsWriterStamp?: ConstructorParameters<typeof RuntimeHost>[0]['limitsWriterStamp']
  }): RuntimeHost
  /** An agent made now, on Claude unless `provider` says otherwise, kept as a service unless `kind` does. */
  anAgent(
    slug: string,
    kind?: 'service' | 'normal' | 'nothing kept',
    provider?: Provider,
  ): { readonly id: string; readonly createdAt: number }
  /** What the services list keeps for an identity. */
  kept(identity: string): ProfileExecution | undefined
  conversationsRecorded(): number
  /** A conversation a person opens as `profile`, running, owning its root. */
  aPersonOpens(host: RuntimeHost, profile: string): Promise<string>
  /** `caller` gives `profile` a piece, as an agent gives one. */
  gives(
    host: RuntimeHost,
    caller: string,
    profile: string,
    more?: Record<string, unknown>,
  ): Promise<GiveOutcome>
  /** The rows of a conversation's ledger, oldest first. */
  ledger(conversation: string): TranscriptEvent[]
  cleanUp(): Promise<void>
}

export function aServiceWorld(fixture: { holderReminders?: 'declined' } = {}): AServiceWorld {
  const folder = mkdtempSync(join(tmpdir(), 'brobot2-a-service-'))
  const db = openDatabase(join(folder, 'brobot2.sqlite'))
  applyMigrations(db, migrationsDir)
  const hosts: RuntimeHost[] = []
  const issued = new FakeProviderSessions()
  const fileIn = (): string => profileExecutionFile(folder)
  const world: AServiceWorld = {
    folder,
    db,
    store: undefined as unknown as SessionStore,
    window: new RecordingSink('webContents:1'),
    startedAs: [],
    startedIn: [],
    sent: [],
    writesFail: 'none',
    startsFail: false,
    resumesFailFor: null,
    resumesAreGoneFor: null,
    startsWait: null,
    resumesWait: null,
    resumesAsked: 0,
    handles: [],
    turnsWait: null,
    sendsSettle: null,
    stopsWait: null,
    stopsAddressTheirTurn: false,
    signInsChecked: false,
    signInWait: null,
    signInChecks: 0,
    signInChecksLetThrough: 0,
    signInMovedFor: null,
    stopsAsked: [],
    explicitStops: [],
    listedFor: [],
    listsWait: null,
    listsFail: false,
    handleOf(profile) {
      const kept = world.handles.filter((each) => each.as === profile).at(-1)
      if (kept === undefined) throw new Error(`no provider was started as ${profile}`)
      return kept.handle
    },
    sendFinishesWait: null,
    sendReturnsError: false,
    clock: NOW,
    clockStep: 1,
    aHost(opts = {}) {
      const tick = (): number => {
        const read = world.clock
        world.clock += world.clockStep
        return read
      }
      const profileOf = (home: string): string => basename(dirname(home))
      const itsTurnsKept = (
        handle: Awaited<ReturnType<FakeRuntime['start']>>,
        as: string,
      ): typeof handle => {
        world.handles.push({ as, handle })
        // A new life starts on the current sign-in.
        if (world.signInMovedFor === as) world.signInMovedFor = null
        // The double's turn, held working while the world says so: its drive is the double's own.
        const internals = handle as unknown as {
          driveTurn(text: string, turnId: number): Promise<void>
        }
        const drive = internals.driveTurn.bind(handle)
        internals.driveTurn = async (text, turnId) => {
          if (world.turnsWait !== null) await world.turnsWait
          return drive(text, turnId)
        }
        const machine = (handle as unknown as { machine: { activeTurnId: number | null } }).machine
        const interrupt = handle.interrupt.bind(handle)
        handle.interrupt = async () => {
          world.stopsAsked.push(as)
          const askedOf = machine.activeTurnId
          if (world.stopsWait !== null) await world.stopsWait
          if (world.stopsAddressTheirTurn && machine.activeTurnId !== askedOf) return
          return interrupt()
        }
        ;(
          handle as unknown as { endEverythingTheTurnStarted: () => void }
        ).endEverythingTheTurnStarted = () => {
          world.explicitStops.push(as)
        }
        if (world.signInsChecked) {
          ;(handle as unknown as { checkSignIn: () => Promise<boolean> }).checkSignIn =
            async () => {
              world.signInChecks += 1
              if (world.signInWait !== null && world.signInChecks > world.signInChecksLetThrough) {
                await world.signInWait
              }
              return world.signInMovedFor === as
            }
        }
        const send = handle.send.bind(handle)
        handle.send = async (...args: Parameters<typeof send>) => {
          await send(...args)
          if (world.sendsSettle !== null) await world.sendsSettle
          // The pair a turn runs on is taken up as it begins, so it is read once the send is in.
          const { model, reasoningEffort } = handle.settings
          world.sent.push({
            as,
            words: args[0],
            model: model.effective ?? null,
            effort: reasoningEffort.effective ?? null,
          })
          if (world.sendFinishesWait !== null) await world.sendFinishesWait
          if (world.sendReturnsError) throw new Error('fictional send confirmation lost')
        }
        return handle
      }
      class ProviderOfThisWorld extends FakeRuntime {
        override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
          const as = profileOf(options.providerHome)
          world.startedAs.push(as)
          world.startedIn.push(options.providerHome)
          if (world.startsWait !== null) await world.startsWait
          if (world.startsFail) throw new Error('the provider could not start')
          return itsTurnsKept(await super.start(options), as)
        }
        override async resume(
          ref: SessionRef,
          options: ResumeOptions,
        ): ReturnType<FakeRuntime['resume']> {
          if (world.resumesAreGoneFor === profileOf(options.providerHome)) {
            throw new ResumeError(ref, 'the fictional conversation is gone', {
              noSuchSession: true,
            })
          }
          if (world.resumesFailFor === profileOf(options.providerHome)) {
            throw new Error('the provider could not start')
          }
          world.resumesAsked++
          if (world.resumesWait !== null) await world.resumesWait
          return itsTurnsKept(await super.resume(ref, options), profileOf(options.providerHome))
        }
        override async listModels(
          context: ProviderRuntimeContext,
        ): ReturnType<FakeRuntime['listModels']> {
          world.listedFor.push(profileOf(context.providerHome))
          if (world.listsWait !== null) await world.listsWait
          if (world.listsFail) throw new Error('the provider could not list its models')
          return super.listModels(context)
        }
      }
      const switched = readProfileExecution(fileIn())
      if (switched.readable) {
        const { profiles } = switched.kept
        writeProfileExecution(
          fileIn(),
          (opts.servicesOn ?? true) ? { profiles } : { servicesOff: true, profiles },
        )
      }
      const Host = fixture.holderReminders === 'declined' ? GiverNoticeHost : RuntimeHost
      const host = new Host({
        store: opts.store ?? world.store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(folder, 'exports'),
        resourcesRoot: () => resourcesRoot(folder),
        createRuntime: (provider: Provider) =>
          new ProviderOfThisWorld(provider, { sessions: issued }),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(folder, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(folder, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(folder, sessionId, requested),
        makeWorkerPieceFolder: (piece) => makeWorkerPieceFolder(folder, piece),
        newSessionId: () => `sess_${String(tick())}`,
        ...(opts.windowWriterStamp === undefined
          ? {}
          : { windowWriterStamp: opts.windowWriterStamp }),
        ...(opts.limitsWriterStamp === undefined
          ? {}
          : { limitsWriterStamp: opts.limitsWriterStamp }),
        now: tick,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
        profileExecution: {
          read: () => readProfileExecution(fileIn()),
          write: (kept: KeptProfileExecution) => {
            const field = world.writesFail
            const failing =
              field === 'all' ||
              (field !== 'none' &&
                Object.values(kept.profiles).some((entry) => entry[field] !== undefined))
            if (failing) throw new Error('the disk is full')
            writeProfileExecution(fileIn(), kept)
          },
          owned: opts.owned ?? true,
        },
        ...(opts.interruptWaitMs === undefined ? {} : { interruptWaitMs: opts.interruptWaitMs }),
        ...(opts.deliveryWaitMs === undefined ? {} : { deliveryWaitMs: opts.deliveryWaitMs }),
        ...(opts.endingWaitMs === undefined ? {} : { endingWaitMs: opts.endingWaitMs }),
      })
      hosts.push(host)
      return host
    },
    anAgent(slug, kind = 'service', provider = 'claude') {
      const made = world.store.createAgentIdentity(
        { slug, displayName: null, provider },
        { by: 'a-person' },
      )
      if (made === null) throw new Error(`${slug} already exists`)
      if (kind !== 'nothing kept') {
        const read = readProfileExecution(fileIn())
        if (!read.readable) throw new Error(read.why)
        writeProfileExecution(fileIn(), {
          ...read.kept,
          profiles: {
            ...read.kept.profiles,
            [made.id]: { kind, identityCreatedAt: made.createdAt },
          },
        })
      }
      return { id: made.id, createdAt: made.createdAt }
    },
    kept(identity) {
      const read = readProfileExecution(fileIn())
      if (!read.readable) throw new Error(read.why)
      return read.kept.profiles[identity]
    },
    conversationsRecorded() {
      return (db.prepare('SELECT COUNT(*) AS n FROM provider_session').get() as { n: number }).n
    },
    async aPersonOpens(host, profile) {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId: profile, cwd: folder, approvalMode: 'ask' },
        world.window,
      )
      return sessionId
    },
    gives(host, caller, profile, more = {}) {
      return host.giveWork(
        {
          profile,
          title: 'Book the room',
          brief: 'book the meeting room for Tuesday',
          definition_of_done: 'The room is booked and the confirmation is recorded.',
          ...more,
        },
        { ownerId: agentCallerId(caller) },
      )
    },
    ledger(conversation) {
      return world.store.events(conversation).map((row) => row.event)
    },
    async cleanUp() {
      for (const host of hosts) await host.closeAll()
      db.close()
      rmSync(folder, { recursive: true, force: true })
    },
  }
  ;(world as { store: SessionStore }).store = createSessionStore(db, () => {
    const read = world.clock
    world.clock += world.clockStep
    return read
  })
  return world
}
