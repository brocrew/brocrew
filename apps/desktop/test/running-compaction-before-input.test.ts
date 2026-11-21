import { scriptedClaudeQuery } from './lib/scripted-claude-query'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ClaudeRuntime, type ClaudeQuery } from '@brobot2/runtime/claude'
import { CodexRuntime } from '@brobot2/runtime/codex'
import { deferred } from '../../../packages/runtime/test/fixtures/plugin-readiness'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { neutralHostDeps, RecordingSink, syntheticProviderHome } from './lib/host-fixture'
import { ScriptedCodex, Wire } from './lib/scripted-codex-compaction'

async function until(read: () => boolean) {
  for (let n = 0; n < 400; n++) {
    if (read()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('the scripted turn did not reach its expected boundary')
}

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

it.each([
  { provider: 'claude' as const, held: false, interrupt: false },
  { provider: 'codex' as const, held: false, interrupt: false },
  { provider: 'claude' as const, held: true, interrupt: false },
  { provider: 'codex' as const, held: true, interrupt: false },
  { provider: 'claude' as const, held: false, interrupt: true },
  { provider: 'codex' as const, held: false, interrupt: true },
])(
  'compacts after a running $provider turn, before its next input, held=$held, interrupt=$interrupt',
  async ({ provider, held, interrupt }) => {
    type Frame = ClaudeQuery extends AsyncIterable<infer Message> ? Message : never
    const folder = mkdtempSync(join(tmpdir(), 'running-compact-'))
    const db = openDatabase(join(folder, 'app.sqlite'))
    applyMigrations(db, join(import.meta.dirname, '../src/main/db/migrations'))
    const store = createSessionStore(db)
    const firstMayEnd = deferred<void>()
    const compactMayEnd = deferred<void>()
    const replacementMayEnd = deferred<void>()
    let interrupts = 0
    let providerStarted = false
    const heard: string[] = []
    let compactions = 0
    let launches = 0
    const host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => folder),
      createRuntime: () =>
        provider === 'codex'
          ? new CodexRuntime((context) => {
              launches++
              const scripted = new ScriptedCodex(context.providerHome)
              scripted.compactionMayFinish = compactMayEnd.promise
              const request = scripted.request.bind(scripted)
              scripted.request = (method, params) => {
                if (method === 'turn/interrupt') {
                  interrupts++
                  firstMayEnd.resolve()
                }
                if (method === 'thread/compact/start') compactions++
                if (method === 'turn/start') {
                  const input = (params as { input?: { text?: string }[] }).input ?? []
                  heard.push(input.map((one) => one.text ?? '').join(''))
                }
                return request(method, params)
              }
              const incoming = scripted.incoming.bind(scripted)
              scripted.incoming = async function* () {
                let ordinary = 0
                for await (const event of incoming()) {
                  if (event.kind === 'notification' && event.method === 'turn/started')
                    providerStarted = true
                  if (
                    event.kind === 'notification' &&
                    event.method === 'turn/completed' &&
                    String((event.params as { turn?: { id?: string } }).turn?.id).startsWith('tn_')
                  ) {
                    ordinary++
                    if (ordinary === 1) await firstMayEnd.promise
                    if (ordinary === 2 && interrupt) await replacementMayEnd.promise
                  }
                  yield event
                }
              }
              return scripted
            })
          : new ClaudeRuntime(
              ({ prompt, options }) => {
                launches++
                const wire = new Wire<Frame>()
                wire.push({
                  type: 'system',
                  subtype: 'init',
                  session_id: 'running_claude',
                  cwd: options.cwd,
                } as Frame)
                void (async () => {
                  for await (const message of prompt) {
                    const text = message.message.content
                    if (typeof text !== 'string') throw new Error('expected plain input')
                    if (text === '/compact Keep this plan') {
                      compactions++
                      await compactMayEnd.promise
                      wire.push({
                        type: 'system',
                        subtype: 'compact_boundary',
                        compact_metadata: { trigger: 'manual', pre_tokens: 1200 },
                      } as Frame)
                    } else {
                      heard.push(text)
                      providerStarted = true
                      if (heard.length === 1) await firstMayEnd.promise
                      if (heard.length === 2 && interrupt) await replacementMayEnd.promise
                    }
                    wire.push({
                      type: 'result',
                      subtype: 'success',
                      is_error: false,
                      user_message_uuid: message.uuid,
                    } as Frame)
                  }
                })()
                return scriptedClaudeQuery(wire, {
                  supportedCommands: async () => [
                    { name: 'compact', description: 'Compact context' },
                  ],
                  interrupt: async () => {
                    interrupts++
                    firstMayEnd.resolve()
                  },
                })
              },
              async () => true,
              undefined,
              undefined,
              undefined,
              async () => 'fictional-key',
            ),
      prepareProviderHome: syntheticProviderHome(() => folder),
      providerHomePath: (chosen) => join(folder, 'homes', chosen),
      resolveCwd: () => folder,
      readProviderConfig: (_chosen, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
      newSessionId: () => 'running_1',
    })
    cleanup.push(async () => {
      firstMayEnd.resolve()
      compactMayEnd.resolve()
      replacementMayEnd.resolve()
      await host.closeAll()
      db.close()
      rmSync(folder, { recursive: true, force: true })
    })
    const sink = new RecordingSink('webContents:1')
    const { sessionId } = await host.createSession(
      { provider, approvalMode: 'auto', cwd: folder },
      sink,
    )
    await host.send(sessionId, 'Finish the current work', sink)
    await until(() => heard.length === 1 && providerStarted)
    const before = launches
    expect(
      await host.compactConversation({
        conversation: sessionId,
        agent: sessionId,
        reason: 'Keep this plan',
      }),
    ).toMatchObject({ ok: true, queued: true, afterTurn: true })
    expect(
      await host.compactConversation({
        conversation: sessionId,
        agent: sessionId,
        reason: 'A later reason',
      }),
    ).toMatchObject({ ok: true, queued: true, afterTurn: true })
    expect(compactions).toBe(0)
    expect(launches).toBe(before)
    expect(
      store.events(sessionId).filter((row) => row.event.type === 'pending_compaction'),
    ).toHaveLength(1)
    let accepted = false
    const sendNext = () =>
      host.send(sessionId, 'Continue after compaction', sink).then(() => {
        accepted = true
      })
    let next = held ? sendNext() : undefined
    if (held) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(accepted).toBe(true)
      expect(compactions).toBe(0)
    }
    if (interrupt) {
      await host.sendInterrupting(sessionId, 'Do this instead', sink)
      await until(() => heard.length === 2)
      expect(interrupts).toBe(1)
      expect(heard[1]).toContain('Do this instead')
      expect(compactions).toBe(0)
      replacementMayEnd.resolve()
    } else firstMayEnd.resolve()
    const beforeNext = interrupt ? 2 : 1
    // No new input is needed to make the queued request run.
    await until(() => compactions === 1)
    expect(heard).toHaveLength(beforeNext)
    next ??= sendNext()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(accepted).toBe(true)
    expect(heard).toHaveLength(beforeNext)
    compactMayEnd.resolve()
    await next
    await until(() => heard.length > beforeNext)
    expect(heard[beforeNext]).toContain('Continue after compaction')
    expect(heard[beforeNext]).toContain('Keep this plan')
    expect(heard[beforeNext]).not.toContain('A later reason')
    expect(compactions).toBe(1)
    const rows = store.events(sessionId)
    expect(rows.filter((row) => row.event.type === 'pending_compaction').at(-1)?.event).toEqual({
      type: 'pending_compaction',
      request: null,
    })
    expect(
      rows.filter(
        (row) =>
          row.event.type === 'message_queued' &&
          row.event.appNotice === 'a-conversation-was-compacted',
      ),
    ).toHaveLength(1)
  },
)
