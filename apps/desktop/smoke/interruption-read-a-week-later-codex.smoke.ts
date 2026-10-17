import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { loadavg } from 'node:os'
import { expect, it } from 'vitest'
import {
  CodexRuntime,
  codexAuthHealth,
  type AgentRuntime,
  type CodexIncoming,
  type CodexTransport,
  type TransportFactory,
} from '@brobot2/runtime'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import {
  deriveProviderHome,
  prepareProviderHome,
  providerHomesRoot,
} from '../src/main/runtime/provider-homes'
import { bundledCodexTransportFactory } from '../../../packages/runtime/smoke/bundled-codex'
import { runEvidence, runScratch } from '../../../packages/runtime/smoke/run-paths'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 443 relay 1: the same criterion-8 observation through the product's live Codex path.
 *
 * The app-owned copy-once credential provisioning is deliberately named: this probe calls the
 * same app-layer `prepareProviderHome` function as main and the lifecycle runner, into this
 * invocation's isolated home. That function owns the ancestry-checked copy-once
 * `provisionCodexAuth` call. The probe never reads or copies a credential itself and removes that
 * home after joining its own provider processes.
 */
const LIMIT_MS = 90_000
const TICK_SECONDS = 30
const MODEL = 'gpt-5.6-luna'

const load = (): string =>
  loadavg()
    .map((one) => one.toFixed(2))
    .join(' / ')
const say = (line: string): void => console.log(`[443 Codex live · load ${load()}] ${line}`)

async function wait(label: string, condition: () => boolean, ms = LIMIT_MS): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  say(`NOT PERFORMED: ${label} exceeded ${ms}ms`)
  return false
}

async function within<T>(label: string, promise: Promise<T>, ms = LIMIT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`NOT PERFORMED: ${label} exceeded ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

class Recorder implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(
    readonly ownerId: string,
    readonly aPersonIsBehindIt = false,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

interface RequestObservation {
  readonly at: number
  readonly method: string
  readonly params: unknown
  resultAt?: number
  result?: unknown
  error?: string
}

interface NotificationObservation {
  readonly at: number
  readonly method: string
  readonly params: unknown
}

interface CodexTap {
  readonly requests: RequestObservation[]
  readonly notifications: NotificationObservation[]
}

/** Tee the runtime's single incoming consumer and preserve the real transport's full surface. */
function observedTransport(taps: CodexTap[]): TransportFactory {
  const product = bundledCodexTransportFactory()
  return (context) => {
    const inner = product(context)
    const tap: CodexTap = { requests: [], notifications: [] }
    taps.push(tap)
    return new Proxy(inner, {
      get(target, property) {
        if (property === 'request') {
          return async (method: string, params: unknown): Promise<unknown> => {
            const row: RequestObservation = { at: Date.now(), method, params }
            tap.requests.push(row)
            try {
              const result = await target.request(method, params)
              row.resultAt = Date.now()
              row.result = result
              return result
            } catch (error) {
              row.error = error instanceof Error ? error.message : String(error)
              throw error
            }
          }
        }
        if (property === 'incoming') {
          return (): AsyncIterable<CodexIncoming> => ({
            async *[Symbol.asyncIterator](): AsyncGenerator<CodexIncoming> {
              for await (const incoming of target.incoming()) {
                if (incoming.kind === 'notification') {
                  tap.notifications.push({
                    at: Date.now(),
                    method: incoming.method,
                    params: incoming.params,
                  })
                }
                yield incoming
              }
            },
          })
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as CodexTransport
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function turnFrom(value: unknown): { id: string | null; status: string | null } {
  const turn = record(record(value)?.['turn'])
  return {
    id: typeof turn?.['id'] === 'string' ? turn['id'] : null,
    status: typeof turn?.['status'] === 'string' ? turn['status'] : null,
  }
}

function commandItemFrom(value: unknown): Record<string, unknown> | null {
  const item = record(record(value)?.['item'])
  return item?.['type'] === 'commandExecution' ? item : null
}

/** Remove only the provider-home subtree beneath this run's scratch userData. */
function removeOwnedProviderHomes(userData: string): void {
  const managedRoot = resolve(providerHomesRoot(userData))
  const ownedRoot = resolve(userData)
  if (!managedRoot.startsWith(`${ownedRoot}${sep}`)) {
    throw new Error(`refusing to remove provider homes outside this run: ${managedRoot}`)
  }
  rmSync(managedRoot, { recursive: true, force: true })
}

it(
  '443 relay 1: a live Codex worker receives the interrupt mid-turn and recalls its work',
  { timeout: 300_000 },
  async () => {
    const startedAt = Date.now()
    say('budget: 7 minutes total; every launch, provider call, and wait is at most 90 seconds')
    const scratch = runScratch('443-interruption-codex-live')
    const userData = join(scratch, 'userData')
    const work = join(scratch, 'work')
    mkdirSync(userData, { recursive: true })
    mkdirSync(work, { recursive: true })

    const db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
    const store = createSessionStore(db)
    const taps: CodexTap[] = []
    let counter = 0
    const host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (): AgentRuntime => new CodexRuntime(observedTransport(taps), codexAuthHealth),
      prepareProviderHome: (provider, profileId) =>
        prepareProviderHome(userData, { profileId, provider }),
      providerHomePath: (provider, profileId) =>
        deriveProviderHome(userData, { profileId, provider }),
      providerHomesRoot: () => providerHomesRoot(userData),
      resolveCwd: (id, requested) => resolveSessionCwd(userData, id, requested),
      newSessionId: () => `sess_443_codex_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'live',
        authNote: null,
        files: [],
      }),
    })

    let watcher: ReturnType<typeof setInterval> | undefined
    try {
      const rootSink = new Recorder('webContents:443:codex-root')
      const workerIdentity = await within(
        'worker identity launch',
        host.createSession(
          { provider: 'codex', profileId: 'worker', cwd: work, model: MODEL },
          rootSink,
        ),
      )
      await within('worker identity close', host.close(workerIdentity.sessionId, rootSink))
      const parent = await within(
        'parent launch',
        host.createSession(
          {
            provider: 'codex',
            profileId: 'pm',
            cwd: work,
            model: MODEL,
            approvalMode: 'auto',
          },
          new Recorder('webContents:443:codex-parent'),
        ),
      )
      // ⚑ **D-016 · the child's effort is a PERSON's choice for its agent, made before the give** —
      // the give starts the conversation with the brief as its first turn, so a session setting made
      // after it would reach only the second turn. ⚑ The person's own door, checked against the list
      // Codex gives (`model/list`: no thread, no turn).
      const chose = await within(
        'child low-effort choice',
        host.setAgentModelAndEffort('worker', { provider: 'codex', model: MODEL, effort: 'low' }),
      )
      expect(chose, 'a person chose the worker’s model and effort').toMatchObject({ ok: true })
      const marker = `BROBOT_443_CODEX_${randomUUID()}`
      const given = await within(
        'child launch with its work',
        host.giveWork(
          {
            profile: 'worker',
            title: '443 relay 1 live Codex interrupt probe',
            brief: `Remember this task marker: ${marker}. Your pending next action after the command is to draft a one-sentence change summary for this marker. First use your shell tool to run exactly this foreground timed command and wait: for i in $(seq 1 ${TICK_SECONDS}); do echo tick $i; sleep 1; done. This is an automated interruption timing test, so do not shorten, background, or simulate it. Whether the command completes or is interrupted, on the next message "continue" first state the exact task marker and the pending next action; do not retry the command.`,
          },
          { ownerId: `agent:${parent.sessionId}` },
        ),
      )
      expect(given.ok, JSON.stringify(given)).toBe(true)
      if (!given.ok) return

      const worker = given.owner
      const childSink = new Recorder('webContents:443:codex-worker', true)
      host.claimSession(worker, childSink)
      const childTap = taps.at(-1)
      expect(childTap, 'the live worker must have a teed app-server transport').toBeDefined()
      if (childTap === undefined) return
      const transportCount = taps.length

      const approved = new Set<string>()
      watcher = setInterval(() => {
        for (const row of store.events(worker)) {
          const event = row.event
          if (event.type !== 'permission_request' || approved.has(event.id)) continue
          approved.add(event.id)
          void host.respondPermission(worker, event.id, { outcome: 'allow' }, childSink).then(
            () => say(`permission allowed: ${event.action}`),
            (error: unknown) => say(`permission failure: ${String(error)}`),
          )
        }
      }, 200)

      const events = (): TranscriptEvent[] => store.events(worker).map((row) => row.event)
      const turns = (): Extract<TranscriptEvent, { type: 'turn' }>[] =>
        events().filter(
          (event): event is Extract<TranscriptEvent, { type: 'turn' }> => event.type === 'turn',
        )
      const timedCall = (): Extract<TranscriptEvent, { type: 'tool_call' }> | undefined =>
        events().find(
          (event): event is Extract<TranscriptEvent, { type: 'tool_call' }> =>
            event.type === 'tool_call' && event.summary.includes('seq 1 30'),
        )

      expect(
        await wait('foreground ticking-loop tool call', () => timedCall() !== undefined),
        'NOT PERFORMED: Codex never started the timed command',
      ).toBe(true)
      const rawTimedStarted = childTap.notifications.find(
        (row) =>
          row.method === 'item/started' &&
          JSON.stringify(commandItemFrom(row.params)).includes('seq 1 30'),
      )
      expect(
        rawTimedStarted,
        'the provider must report the matching commandExecution item as started',
      ).toBeDefined()
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      const turnStart = childTap.requests.find((row) => row.method === 'turn/start')
      const providerTurn = turnFrom(turnStart?.result)
      const providerSession = record(turnStart?.params)?.['threadId']
      const rawTimedItem = commandItemFrom(rawTimedStarted?.params)
      const rawTimedItemId = rawTimedItem?.['id']
      const before = {
        at: Date.now(),
        turnRows: turns().length,
        toolResults: events().filter((event) => event.type === 'tool_result').length,
        matchingItemCompletions: childTap.notifications.filter(
          (row) =>
            row.method === 'item/completed' &&
            commandItemFrom(row.params)?.['id'] === rawTimedItemId,
        ).length,
        providerTerminals: childTap.notifications.filter((row) => row.method === 'turn/completed')
          .length,
      }
      say(
        `active marker: ${JSON.stringify(before)}; tool=${timedCall()?.id}; thread=${String(providerSession)}; turn=${providerTurn.id}`,
      )
      expect(before.turnRows, 'the worker turn must still be open').toBe(0)
      expect(before.toolResults, 'the timed command must not have returned').toBe(0)
      expect(before.matchingItemCompletions, 'the raw timed command must still be open').toBe(0)
      expect(before.providerTerminals, 'the provider must not have crossed its boundary').toBe(0)
      expect(providerTurn.id, 'turn/start must bind a provider turn id').not.toBeNull()
      expect(typeof providerSession).toBe('string')

      const userTurnsBeforeControl = events().filter((event) => event.type === 'user_turn').length
      const control = await within(
        'busy mailbox control',
        host.queueMessage(
          worker,
          '443 Codex held-mailbox control; this must never become a provider turn',
          { ownerId: `agent:${parent.sessionId}` },
          [],
          'question',
          {},
          'note',
        ),
      )
      expect(control.outcome).toBe('queued')
      expect(turns()).toHaveLength(0)
      expect(events().filter((event) => event.type === 'user_turn')).toHaveLength(
        userTurnsBeforeControl,
      )
      if (control.outcome === 'queued') {
        await within(
          'cancel busy mailbox control',
          host.cancelQueuedMessage(worker, control.messageId, {
            ownerId: `agent:${parent.sessionId}`,
          }),
        )
      }
      say(`mailbox control queued with zero provider or ledger turn boundary`)

      const interrupt = agentToolsFor(host, parent.sessionId).tools.find(
        (tool) => tool.name === 'interrupt_agent',
      )
      expect(interrupt).toBeDefined()
      const askedAt = Date.now()
      const answer = await within(
        'interrupt_agent call',
        interrupt!.call({ agent: worker, reason: '443 relay 1 timed observation' }),
      )
      const interruptRequest = childTap.requests.find(
        (row) => row.method === 'turn/interrupt' && row.at >= askedAt,
      )
      expect(interruptRequest, 'the adapter must send turn/interrupt').toBeDefined()
      expect(record(interruptRequest?.params)).toMatchObject({
        threadId: providerSession,
        turnId: providerTurn.id,
      })
      expect(
        interruptRequest?.result,
        'turn/interrupt must resolve with the documented {}',
      ).toEqual({})
      expect(
        await wait('matching provider interrupted terminal', () =>
          childTap.notifications.some((row) => {
            const terminal = turnFrom(row.params)
            return (
              row.method === 'turn/completed' &&
              terminal.id === providerTurn.id &&
              terminal.status === 'interrupted' &&
              row.at >= askedAt
            )
          }),
        ),
      ).toBe(true)
      const terminal = childTap.notifications.find((row) => {
        const value = turnFrom(row.params)
        return row.method === 'turn/completed' && value.id === providerTurn.id
      })
      expect((terminal?.at ?? Infinity) - askedAt).toBeLessThan(TICK_SECONDS * 1_000)
      expect(turns().some((turn) => turn.state === 'interrupted')).toBe(true)
      say(
        `interrupt_agent=${JSON.stringify(answer)}; RPC=${interruptRequest?.at}; raw interrupted terminal=${terminal?.at}; ${terminal ? terminal.at - askedAt : 'missing'}ms after ask`,
      )

      const firstProviderSession = providerSession
      const beforeContinue = events().length
      await within(
        'neutral continuation send',
        host.send(worker, 'continue', { ownerId: childSink.ownerId }),
      )
      expect(
        await wait('neutral continuation turn', () => turns().length >= 2),
        'NOT PERFORMED: continuation turn missing',
      ).toBe(true)
      const followText = events()
        .slice(beforeContinue)
        .filter(
          (event): event is Extract<TranscriptEvent, { type: 'assistant_message' }> =>
            event.type === 'assistant_message',
        )
        .map((event) => event.text)
        .join(' ')
      const starts = childTap.requests.filter((row) => row.method === 'turn/start')
      const continuationStart = starts.at(-1)
      const nextProviderSession = record(continuationStart?.params)?.['threadId']
      expect(nextProviderSession, 'continuation must use the same provider session').toBe(
        firstProviderSession,
      )
      expect(record(continuationStart?.params)?.['input']).toEqual([
        { type: 'text', text: 'continue', text_elements: [] },
      ])
      expect(
        starts.every((row) => record(row.params)?.['threadId'] === firstProviderSession),
        'both turns must stay on the original thread',
      ).toBe(true)
      expect(childTap.requests.some((row) => row.method === 'thread/resume')).toBe(false)
      expect(taps, 'continuation must not replace the worker transport').toHaveLength(
        transportCount,
      )
      expect(turns().at(-1)?.state).toBe('completed')
      expect(followText, 'neutral continuation must recall the unique marker').toContain(marker)
      expect(followText, 'neutral continuation must identify the pending action').toMatch(
        /one-sentence change summary|one.sentence summary/i,
      )
      say(
        `neutral continuation: same thread=${String(nextProviderSession)}; marker=true; pending-action=true; elapsed=${Date.now() - startedAt}ms; reply=${JSON.stringify(followText.slice(-500))}`,
      )

      writeFileSync(
        runEvidence('443-codex-live.json'),
        JSON.stringify(
          {
            worker,
            marker,
            providerSession,
            providerTurn: providerTurn.id,
            timedToolCall: timedCall()?.id,
            rawTimedItem: rawTimedItemId,
            askedAt,
            interruptRequest,
            terminal,
            continuation: { providerSession: nextProviderSession, reply: followText },
            elapsedMs: Date.now() - startedAt,
            load: load(),
          },
          null,
          2,
        ),
      )
    } finally {
      if (watcher !== undefined) clearInterval(watcher)
      await within('owned host close', host.closeAll())
      db.close()
      removeOwnedProviderHomes(userData)
    }
  },
)
