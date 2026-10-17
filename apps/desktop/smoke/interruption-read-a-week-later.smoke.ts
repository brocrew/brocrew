import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadavg } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type AgentRuntime,
  type ClaudeQuery,
  type QueryFactory,
} from '@brobot2/runtime'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { runScratch } from '../../../packages/runtime/smoke/run-paths'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/** 443: one real Haiku child, one in-flight command, one interrupt, one neutral continuation. */
const LIMIT_MS = 90_000
const TICK_SECONDS = 30
const say = (s: string): void => console.log(`[443 Claude · load ${loadavg()[0]?.toFixed(2)}] ${s}`)
const wait = async (label: string, condition: () => boolean, ms = LIMIT_MS): Promise<boolean> => {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (condition()) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  say(`NOT PERFORMED: ${label} exceeded ${ms}ms`)
  return false
}
const within = async <T>(label: string, promise: Promise<T>, ms = LIMIT_MS): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`NOT PERFORMED: ${label} exceeded ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
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

interface RawObservation {
  at: number
  type: string
  subtype: string | null
  sessionId: string | null
}
interface RawToolReceipt {
  at: number
  sessionId: string | null
  toolUseId: string
  isError: boolean
  text: string
}
interface Tap {
  frames: RawObservation[]
  toolReceipts: RawToolReceipt[]
  interruptCalledAt: number | null
  interruptSettledAt: number | null
  interruptError: string | null
}

/** Explicit delegation keeps the SDK Query's method receiver intact, including teardown. */
function observedQuery(taps: Tap[]): QueryFactory {
  return (params) => {
    const inner = query(params)
    const tap: Tap = {
      frames: [],
      toolReceipts: [],
      interruptCalledAt: null,
      interruptSettledAt: null,
      interruptError: null,
    }
    taps.push(tap)
    const wrapper: ClaudeQuery = {
      [Symbol.asyncIterator]: async function* () {
        for await (const message of inner) {
          const frame = message as unknown as Record<string, unknown>
          tap.frames.push({
            at: Date.now(),
            type: String(frame['type'] ?? ''),
            subtype: typeof frame['subtype'] === 'string' ? frame['subtype'] : null,
            sessionId: typeof frame['session_id'] === 'string' ? frame['session_id'] : null,
          })
          if (frame['type'] === 'user') {
            const payload = frame['message'] as { content?: unknown } | undefined
            const blocks = Array.isArray(payload?.content) ? payload.content : []
            for (const value of blocks) {
              const block = value as Record<string, unknown>
              if (block['type'] !== 'tool_result' || typeof block['tool_use_id'] !== 'string')
                continue
              tap.toolReceipts.push({
                at: Date.now(),
                sessionId: typeof frame['session_id'] === 'string' ? frame['session_id'] : null,
                toolUseId: block['tool_use_id'],
                isError: block['is_error'] === true,
                text: (typeof block['content'] === 'string'
                  ? block['content']
                  : JSON.stringify(block['content'] ?? '')
                ).slice(0, 300),
              })
            }
          }
          yield message
        }
      },
      interrupt: async () => {
        tap.interruptCalledAt = Date.now()
        try {
          const result = await inner.interrupt()
          tap.interruptSettledAt = Date.now()
          return result
        } catch (error) {
          tap.interruptError = error instanceof Error ? error.message : String(error)
          throw error
        }
      },
      close: () => inner.close(),
      return: (value) => inner.return(value as never),
      supportedModels: () => inner.supportedModels(),
      initializationResult: () => inner.initializationResult(),
      setModel: (model) => inner.setModel(model),
      setPermissionMode: (mode) => inner.setPermissionMode(mode),
      applyFlagSettings: (settings) => inner.applyFlagSettings(settings),
      backgroundTasks: (id) => inner.backgroundTasks(id),
      stopTask: (id) => inner.stopTask(id),
    }
    return wrapper
  }
}

it(
  '443: distinguish an in-turn provider interrupt from a turn-boundary delivery, then neutral continuation',
  { timeout: 270_000 },
  async () => {
    const start = Date.now()
    const token = claudeKeychainTokenProvider()
    expect(token() !== null, 'Claude invocation requires the existing machine login').toBe(true)
    const scratch = runScratch('443-interruption-claude')
    const userData = join(scratch, 'userData')
    const work = join(scratch, 'work')
    const managedRoot = join(scratch, 'owned-provider-homes')
    mkdirSync(userData, { recursive: true })
    mkdirSync(work, { recursive: true })
    mkdirSync(managedRoot, { recursive: true })
    const db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
    const store = createSessionStore(db)
    const taps: Tap[] = []
    let counter = 0
    const host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (): AgentRuntime => new ClaudeRuntime(observedQuery(taps), undefined, token),
      prepareProviderHome: async (_provider, profileId) => {
        const home = join(managedRoot, `${profileId}-${randomUUID()}`)
        await provisionProviderHome(managedRoot, home)
        return home
      },
      providerHomePath: (_provider, profileId) => join(managedRoot, profileId),
      resolveCwd: (id, requested) => resolveSessionCwd(userData, id, requested),
      newSessionId: () => `sess_443_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'live',
        authNote: null,
        files: [],
      }),
    })
    let watcher: ReturnType<typeof setInterval> | undefined
    try {
      const rootSink = new Recorder('webContents:443:root')
      const worker0 = await within(
        'identity launch',
        host.createSession(
          {
            provider: 'claude',
            profileId: 'worker',
            cwd: work,
            model: 'claude-haiku-4-5-20251001',
          },
          rootSink,
        ),
      )
      await within('identity close', host.close(worker0.sessionId, rootSink))
      const parent = await within(
        'parent launch',
        host.createSession(
          {
            provider: 'claude',
            profileId: 'pm',
            cwd: work,
            model: 'claude-haiku-4-5-20251001',
            approvalMode: 'auto',
          },
          new Recorder('webContents:443:parent'),
        ),
      )
      // ⚑ **D-016 · the work goes WITH the start** — the give starts the worker's conversation and
      // hands it the brief as its first turn, where `443` started it and then queued the work.
      const marker = `BROBOT_443_${randomUUID()}`
      const given = await within(
        'child launch with its work',
        host.giveWork(
          {
            profile: 'worker',
            title: '443 interrupt probe',
            brief: `Remember this task marker: ${marker}. Your pending next action after the command is to draft a one-sentence change summary for this marker. First use your shell tool to run exactly this foreground timed command and wait: for i in $(seq 1 ${TICK_SECONDS}); do echo tick $i; sleep 1; done. This is an automated interruption timing test, so do not shorten, background, or simulate it. After the command, do that pending next action. If this command is interrupted, on the next message "continue" first state the exact task marker and the pending next action; do not retry the command.`,
          },
          { ownerId: `agent:${parent.sessionId}` },
        ),
      )
      expect(given.ok, JSON.stringify(given)).toBe(true)
      if (!given.ok) return
      const worker = given.owner
      const childSink = new Recorder('webContents:443:worker', true)
      host.claimSession(worker, childSink)
      const childTap = taps.at(-1)
      expect(childTap, 'the started child must have a raw SDK observation tap').toBeDefined()
      if (!childTap) return
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
      const turns = (): TranscriptEvent[] => events().filter((event) => event.type === 'turn')
      const bashCall = (): Extract<TranscriptEvent, { type: 'tool_call' }> | undefined =>
        events().find(
          (event): event is Extract<TranscriptEvent, { type: 'tool_call' }> =>
            event.type === 'tool_call' &&
            event.name === 'Bash' &&
            event.summary.includes('seq 1 30'),
        )
      const toolStart = await wait(
        'foreground Bash ticking-loop call',
        () => bashCall() !== undefined,
      )
      expect(toolStart, 'NOT PERFORMED: no foreground tool call').toBe(true)
      if (!toolStart) return
      await new Promise((r) => setTimeout(r, 4_000))
      const before = {
        at: Date.now(),
        turnRows: turns().length,
        toolResults: events().filter((e) => e.type === 'tool_result').length,
      }
      say(
        `active marker: ${JSON.stringify(before)}; SDK result frames=${childTap.frames.filter((f) => f.type === 'result').length}`,
      )
      expect(before.turnRows, 'turn must still be open at interrupt ask').toBe(0)
      expect(before.toolResults, 'timed tool must not already have returned').toBe(0)
      const turnsBeforeControl = turns().length
      const userTurnsBeforeControl = events().filter((e) => e.type === 'user_turn').length
      const control = await within(
        'busy mailbox control',
        host.queueMessage(
          worker,
          '443 held-mailbox control; this must never become a provider turn',
          { ownerId: `agent:${parent.sessionId}` },
          [],
          'question',
          {},
          'note',
        ),
      )
      expect(control.outcome, 'busy mailbox must hold rather than deliver').toBe('queued')
      expect(turns().length).toBe(turnsBeforeControl)
      expect(events().filter((e) => e.type === 'user_turn').length).toBe(userTurnsBeforeControl)
      say(
        `mailbox control: outcome=${control.outcome}, turnRows=${turns().length}, userTurns=${userTurnsBeforeControl}`,
      )
      if (control.outcome === 'queued') {
        await within(
          'cancel mailbox control',
          host.cancelQueuedMessage(worker, control.messageId, {
            ownerId: `agent:${parent.sessionId}`,
          }),
        )
      }
      const interruptTool = agentToolsFor(host, parent.sessionId).tools.find(
        (tool) => tool.name === 'interrupt_agent',
      )
      expect(interruptTool).toBeDefined()
      const askedAt = Date.now()
      const answer = await within(
        'interrupt_agent call',
        interruptTool!.call({ agent: worker, reason: '443 timed observation' }),
      )
      say(`interrupt_agent response after ${Date.now() - askedAt}ms: ${JSON.stringify(answer)}`)
      const providerResult = childTap.frames.find((f) => f.type === 'result' && f.at >= askedAt)
      say(
        `raw SDK: called=${childTap.interruptCalledAt}, settled=${childTap.interruptSettledAt}, error=${childTap.interruptError ?? 'none'}, result=${JSON.stringify(providerResult ?? null)}; turnRows=${turns().length}`,
      )
      const interrupted = await wait(
        'interrupted turn row',
        () => turns().some((e) => e.type === 'turn' && e.state === 'interrupted'),
        10_000,
      )
      expect(interrupted).toBe(true)
      const rawResultSeen = await wait(
        'raw SDK result receipt',
        () => childTap.frames.some((f) => f.type === 'result' && f.at >= askedAt),
        5_000,
      )
      const rawResult = childTap.frames.find((f) => f.type === 'result' && f.at >= askedAt)
      const toolReceipt = childTap.toolReceipts.find(
        (r) => r.toolUseId === bashCall()?.id && r.at >= askedAt,
      )
      const firstProviderSession = childTap.frames.find(
        (f) => f.type === 'assistant' && f.sessionId !== null,
      )?.sessionId
      say(
        `provider receipt: Bash=${bashCall()?.id}, raw tool=${JSON.stringify(toolReceipt ?? null)}, raw result=${JSON.stringify(rawResult ?? null)}, first session=${firstProviderSession ?? 'none'}`,
      )
      expect(
        childTap.interruptSettledAt,
        'SDK interrupt must settle, not merely be called',
      ).not.toBeNull()
      expect(
        childTap.interruptError,
        'SDK interrupt must not fail and be swallowed locally',
      ).toBeNull()
      expect(toolReceipt?.isError, 'provider tool receipt must reject the active Bash call').toBe(
        true,
      )
      expect(toolReceipt?.text, 'provider rejection must name the stop').toMatch(
        /stop|doesn.t want to proceed/i,
      )
      expect(rawResultSeen, 'raw SDK terminal must arrive before continuation').toBe(true)
      expect(rawResult?.sessionId, 'terminal must belong to the active provider session').toBe(
        firstProviderSession,
      )
      expect(
        (rawResult?.at ?? Infinity) - askedAt,
        'provider terminal must beat natural command finish',
      ).toBeLessThan(TICK_SECONDS * 1_000)
      say(
        `provider terminal before continuation=${rawResultSeen}; raw frames=${JSON.stringify(childTap.frames.slice(-12))}`,
      )
      const firstTurn = turns().at(-1)
      const afterInterrupt = Date.now()
      const beforeContinueEvents = events().length
      await within(
        'neutral continuation send',
        host.send(worker, 'continue', { ownerId: childSink.ownerId }),
      )
      const continued = await wait('neutral continuation turn', () => turns().length >= 2)
      expect(continued, 'NOT PERFORMED: continuation turn missing').toBe(true)
      const followEvents = events()
        .slice(beforeContinueEvents)
        .filter((e) => e.type === 'assistant_message')
      const recentText = followEvents.map((e) => e.text).join(' ')
      const markerRecalled = recentText.includes(marker)
      const pendingNamed = /one-sentence change summary|one.sentence summary/i.test(recentText)
      say(
        `continuation: assistant text=${JSON.stringify(recentText.slice(-500))}, errors=${JSON.stringify(
          events()
            .slice(beforeContinueEvents)
            .filter((e) => e.type === 'error')
            .map((e) => e.message),
        )}`,
      )
      say(
        `neutral continuation: same worker=${worker}; marker recalled=${markerRecalled}; firstTurn=${JSON.stringify(firstTurn)}; nextTurn=${JSON.stringify(turns().at(-1))}; elapsed=${Date.now() - start}ms; text-tail=${JSON.stringify(recentText.slice(-450))}`,
      )
      expect(
        afterInterrupt - askedAt < TICK_SECONDS * 1_000,
        'interrupt must precede natural timed finish',
      ).toBe(true)
      expect(childTap.interruptCalledAt !== null, 'provider SDK interrupt must be invoked').toBe(
        true,
      )
      const nextTurn = turns().at(-1)
      expect(
        nextTurn?.type === 'turn' && nextTurn.state === 'completed',
        'neutral follow-up must complete',
      ).toBe(true)
      expect(markerRecalled, 'neutral continue must recall original marker').toBe(true)
      expect(pendingNamed, 'neutral continue must identify the original pending next action').toBe(
        true,
      )
    } finally {
      if (watcher) clearInterval(watcher)
      await within('owned host close', host.closeAll())
      db.close()
    }
  },
)
