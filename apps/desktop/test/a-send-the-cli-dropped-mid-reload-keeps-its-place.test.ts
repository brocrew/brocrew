import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeRuntime } from '@brobot2/runtime/claude'
import { FakeQuery } from '../../../packages/runtime/test/fake-claude-query'
import {
  RecordingSink,
  closeHostFixture,
  fixtureDatabase,
  fixtureFolder,
  fixtureHostPaths,
  fixtureProviderConfig,
  waitFor,
} from './lib/host-fixture'
import type { AppDatabase } from '../src/main/db/connection'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

/**
 * Card 613: messages reach the provider in the order the person sent them.
 *
 * Since card 197 a plugin reload has no clock, so it can hang while the person keeps writing. The
 * person sends "fern"; its reload hangs. They send "birch" and "cedar", which are held. The CLI
 * exits: as the SDK does, the stream ends with the exit error and the pending reload is rejected.
 * Fern never reached the provider, so on the fresh start it goes ahead of the two held after it.
 *
 * Real host, real ledger, real Claude adapter; only the SDK query and the CLI child are doubled.
 */

const EXIT = 'Claude Code process exited with code 1'

describe('a send the CLI dropped mid-reload keeps its place', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  const queries: FakeQuery[] = []
  const children: EventEmitter[] = []
  let failReload!: (error: Error) => void
  let reloadsAsked = 0

  const runtime = (): ClaudeRuntime =>
    new ClaudeRuntime(
      (params) => {
        const query = new FakeQuery()
        const first = queries.length === 0
        queries.push(query)
        params.options.spawnClaudeCodeProcess?.({
          command: 'claude',
          args: [],
          env: {},
          signal: new AbortController().signal,
        })
        query.cli.listen(
          (async function* () {
            for await (const message of params.prompt) {
              // A live CLI answers each message it reads; the dropped one never reads any.
              if (!first) setTimeout(() => query.emit({ type: 'result', subtype: 'success' }), 0)
              yield message
            }
          })(),
        )
        const reload = first
          ? new Promise<void>((_, reject) => {
              failReload = reject
            })
          : Promise.resolve()
        reload.catch(() => {})
        Object.assign(query, {
          reloadPlugins: () => {
            if (first) reloadsAsked += 1
            return reload
          },
        })
        // The CLI exits once its query is put away; the dropped one has already exited.
        const child = children[children.length - 1]!
        const putAway = query.return.bind(query)
        Object.assign(query, {
          return: async () => {
            const answer = await putAway()
            if (child.listenerCount('exit') > 0 && !first) child.emit('exit', 0, null)
            return answer
          },
        })
        const launchId = params.options.resume ?? params.options.sessionId
        query.emit({
          type: 'system',
          subtype: 'init',
          session_id: launchId,
          cwd: params.options.cwd,
          plugins: [{ name: 'brobot', path: join(work, 'built-in-skills') }],
          skills: [],
        })
        return query
      },
      async () => true,
      undefined,
      undefined,
      () => {
        const stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} })
        const child = Object.assign(new EventEmitter(), { pid: 4242 + children.length, stderr })
        children.push(child)
        return child as never
      },
      undefined,
      process.platform,
      undefined,
      '/fictional/claude',
    )

  beforeEach(() => {
    userData = fixtureFolder('brobot2-reload-order-')
    work = fixtureFolder('brobot2-reload-order-work-')
    mkdirSync(join(work, 'built-in-skills'))
    mkdirSync(join(work, 'skills'))
    db = fixtureDatabase(userData)
    store = createSessionStore(db)
    queries.length = 0
    children.length = 0
    reloadsAsked = 0
    host = new RuntimeHost({
      store,
      ...fixtureHostPaths(() => userData),
      createRuntime: () => runtime(),
      newSessionId: () => 'sess_reload_order',
      readProviderConfig: fixtureProviderConfig,
      closeDrainTimeoutMs: 2000,
      sharedSkillsRoot: async () => join(work, 'skills'),
      prepareBuiltInSkills: async ({ isCurrent }) => ({
        context: { root: join(work, 'built-in-skills'), skills: [] },
        reminder: '',
        version: 'reload-order-v1',
        isCurrent,
      }),
    })
  })

  afterEach(() => closeHostFixture(host, db, userData, work))

  const ledger = (sessionId: string) =>
    store.events(sessionId).map((row) => row.event as { type: string; text?: string })

  it('delivers fern, then birch and cedar, each once, after a CLI exit mid-reload', async () => {
    const window = new RecordingSink('webContents:1')
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: work },
      window,
    )
    await waitFor(() => queries.length === 1, 'the first launch')
    const sends = [host.send(sessionId, 'fern', window)]
    await waitFor(() => reloadsAsked === 1, 'the held reload')
    sends.push(host.send(sessionId, 'birch', window), host.send(sessionId, 'cedar', window))
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'message_queued').length === 2,
      'birch and cedar held',
    )

    children[0]!.emit('exit', 1, null)
    queries[0]!.fail(new Error(EXIT))
    failReload(new Error(EXIT))

    const settled = await Promise.allSettled(sends)
    expect(settled.map((one) => one.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
    const delivered = (): string[] =>
      ledger(sessionId)
        .filter((event) => event.type === 'user_turn')
        .flatMap((event) => String(event.text).split('\n\n'))
    await waitFor(() => delivered().length === 3, 'all three delivered')
    expect(delivered()).toEqual(['fern', 'birch', 'cedar'])
    expect(queries).toHaveLength(2)
  })
})
