import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime } from '@brobot2/runtime/claude'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import * as persistedRules from '../../../packages/runtime/src/claude/persisted-rules'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { StartAttemptLine } from '../src/main/start-attempt-line'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { closeHostFixture, numberedFixtureHostPaths, RecordingSink } from './lib/host-fixture'

const idleMs = 15_000
const firstPhaseMs = 10_000
const migrations = fileURLToPath(new URL('../src/main/db/migrations', import.meta.url))

function after<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

it.each([
  ['fresh', 'progressing', 10_000],
  ['fresh', 'stalled', 20_000],
  ['resume', 'progressing', 10_000],
  ['resume', 'stalled', 20_000],
] as const)(
  'a %s Claude launch that is %s uses its idle clock',
  async (opening, state, secondPhaseMs) => {
    const folder = mkdtempSync(join(tmpdir(), 'brocrew-claude-launch-'))
    const db = openDatabase(join(folder, 'fixture.sqlite'))
    applyMigrations(db, migrations)
    const store = createSessionStore(db)
    const fresh = opening === 'fresh'
    const sessionId = fresh ? 'sess_1' : 'sess_recorded'
    if (!fresh) {
      store.create({
        id: sessionId,
        provider: 'claude',
        cwd: folder,
        approvalMode: 'ask',
        profileId: DEFAULT_PROFILE_ID,
      })
      store.append(
        sessionId,
        0,
        {
          type: 'session',
          state: 'started',
          ref: { provider: 'claude', sessionId: 'recorded-transcript', cwd: folder, rotation: 0 },
        },
        Date.now(),
      )
    }

    let reportFirstPhase!: () => void
    const firstPhaseStarted = new Promise<void>((resolve) => {
      reportFirstPhase = resolve
    })
    const rulesRead = fresh
      ? vi
          .spyOn(persistedRules, 'keptRulesForALaunch')
          .mockImplementation(() => after(secondPhaseMs, {}))
      : null
    const query = vi.fn(() => {
      const messages = new AsyncQueue<SDKMessage>()
      return {
        close: () => messages.close(),
        interrupt: async () => {},
        [Symbol.asyncIterator]: () => messages[Symbol.asyncIterator](),
      }
    })
    const runtime = new ClaudeRuntime(
      query,
      () => {
        reportFirstPhase()
        return after(firstPhaseMs, true)
      },
      undefined,
      undefined,
      undefined,
      () => {
        if (fresh) reportFirstPhase()
        return after(fresh ? firstPhaseMs : secondPhaseMs, 'fictional-key')
      },
    )
    const attempts: StartAttemptLine[] = []
    const host = new RuntimeHost({
      store,
      ...numberedFixtureHostPaths(() => folder, Date.now),
      createRuntime: () => runtime,
      recordStartAttempt: (line) => attempts.push(line),
    })
    const sink = new RecordingSink('owner:launch')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const launching = fresh
      ? host.createSession({ provider: 'claude', cwd: folder }, sink)
      : host.resumeSession(sessionId, sink)
    const settled = launching.then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    )
    try {
      await Promise.race([firstPhaseStarted, launching])
      await vi.advanceTimersByTimeAsync(idleMs + 1)
      expect(attempts.map((attempt) => attempt.stage)).toEqual(['began'])

      if (state === 'progressing') {
        await vi.advanceTimersByTimeAsync(firstPhaseMs + secondPhaseMs - idleMs - 1)
        expect(await settled).toMatchObject({ result: { sessionId } })
        expect(query).toHaveBeenCalledOnce()
        expect(attempts.at(-1)).toMatchObject({
          stage: 'ended',
          opening,
          outcome: 'ready',
          lastPhase: 'rules-read',
        })
      } else {
        await vi.advanceTimersByTimeAsync(firstPhaseMs - 2)
        expect(attempts.map((attempt) => attempt.stage)).toEqual(['began'])
        await vi.advanceTimersByTimeAsync(1)
        expect(await settled).toMatchObject({ error: { cause: { unavailable: 'took-too-long' } } })
        expect(attempts.at(-1)).toMatchObject({
          stage: 'ended',
          opening,
          outcome: 'timed-out',
          lastPhase: fresh ? 'credentials-read' : 'transcript-found',
        })
        await vi.advanceTimersByTimeAsync(secondPhaseMs - idleMs)
        expect(query).not.toHaveBeenCalled()
      }
    } finally {
      await vi.advanceTimersByTimeAsync(30_000)
      vi.useRealTimers()
      rulesRead?.mockRestore()
      await closeHostFixture(host, db, folder)
    }
  },
)
