import { scriptedClaudeQuery } from './lib/scripted-claude-query'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type AgentToolset } from '@brobot2/runtime'
import { FakeRuntime } from '@brobot2/runtime/testing'
import { ClaudeRuntime, type ClaudeQuery } from '@brobot2/runtime/claude'
import { CodexRuntime } from '@brobot2/runtime/codex'
import { deferred } from '../../../packages/runtime/test/fixtures/plugin-readiness'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { neutralHostDeps, syntheticProviderHome } from './lib/host-fixture'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { ScriptedCodex, Wire } from './lib/scripted-codex-compaction'

async function until(read: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (read()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('the scripted provider did not reach the expected state')
}

async function call(tools: AgentToolset, name: string, args: Record<string, unknown>) {
  const tool = tools.tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`missing ${name}`)
  return tool.call(args)
}

describe('queued native compaction precedes the next input', () => {
  const cleanups: (() => Promise<void>)[] = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  it.each([
    { provider: 'claude' as const, fails: false },
    { provider: 'codex' as const, fails: false },
    { provider: 'claude' as const, fails: true },
    { provider: 'codex' as const, fails: true },
  ])(
    'survives restart and preserves input ordering: $provider, failure=$fails',
    async ({ provider, fails }) => {
      type Frame = ClaudeQuery extends AsyncIterable<infer Message> ? Message : never
      const folder = mkdtempSync(join(tmpdir(), 'queued-compact-'))
      const db = openDatabase(join(folder, 'app.sqlite'))
      applyMigrations(db, join(import.meta.dirname, '../src/main/db/migrations'))
      const store = createSessionStore(db)
      const confirmation = deferred<void>()
      const catalogue = deferred<void>()
      let holdCatalogue = false
      let catalogueAsked = false
      const heard: string[] = []
      let compactions = 0
      let launches = 0
      const createRuntime = (chosen: 'claude' | 'codex') => {
        if (chosen !== provider) return new FakeRuntime(chosen)
        if (chosen === 'codex') {
          return new CodexRuntime((context) => {
            launches++
            const transport = new ScriptedCodex(context.providerHome)
            transport.compactionMayFinish = confirmation.promise
            const request = transport.request.bind(transport)
            transport.request = (method, params) => {
              if (method === 'thread/compact/start') {
                compactions++
                if (fails) return Promise.reject(new Error('scripted compaction refused'))
              }
              if (method === 'turn/start') {
                const input = (params as { input?: { text?: string }[] }).input ?? []
                heard.push(input.map((one) => one.text ?? '').join(''))
              }
              return request(method, params)
            }
            return transport
          })
        }
        return new ClaudeRuntime(
          ({ prompt, options }) => {
            launches++
            const wire = new Wire<Frame>()
            wire.push({
              type: 'system',
              subtype: 'init',
              session_id: 'queued_claude',
              cwd: options.cwd,
            } as Frame)
            void (async () => {
              for await (const message of prompt) {
                const text = message.message.content
                if (typeof text !== 'string') throw new Error('expected plain input')
                if (text === '/compact Keep the measured plan') {
                  compactions++
                  await confirmation.promise
                  wire.push({
                    type: 'system',
                    subtype: 'compact_boundary',
                    compact_metadata: { trigger: 'manual', pre_tokens: 1200 },
                  } as Frame)
                } else heard.push(text)
                wire.push({
                  type: 'result',
                  subtype: 'success',
                  is_error: false,
                  user_message_uuid: message.uuid,
                } as Frame)
              }
            })()
            return scriptedClaudeQuery(wire, {
              supportedCommands: async () => {
                if (holdCatalogue) {
                  catalogueAsked = true
                  await catalogue.promise
                }
                return fails ? [] : [{ name: 'compact', description: 'Compact context' }]
              },
            })
          },
          async () => true,
          undefined,
          undefined,
          undefined,
          async () => 'fictional-key',
        )
      }
      let serial = 0
      const makeHost = () =>
        new RuntimeHost({
          store,
          ...neutralHostDeps(() => folder),
          createRuntime,
          prepareProviderHome: syntheticProviderHome(() => folder),
          providerHomePath: (chosen) => join(folder, 'homes', chosen),
          resolveCwd: (id, requested) => resolveSessionCwd(folder, id, requested),
          newSessionId: () => `queued_${++serial}`,
          readProviderConfig: (_chosen, home) => ({
            home,
            homeEnv: 'CODEX_HOME',
            model: 'm',
            authNote: null,
            files: [],
          }),
        })
      let host = makeHost()
      const window: RuntimeEventSink = {
        ownerId: sinkOwnerId({ id: 1 }),
        alive: true,
        aPersonIsBehindIt: true,
        send: () => {},
        sendLiveness: () => {},
      }
      cleanups.push(async () => {
        confirmation.resolve()
        catalogue.resolve()
        await host.closeAll()
        db.close()
        rmSync(folder, { recursive: true, force: true })
      })
      const worker = host.createAgent({ slug: 'worker', displayName: null, provider })
      const { sessionId: target } = await host.createSession(
        { provider, profileId: worker.slug, approvalMode: 'auto', cwd: folder },
        window,
      )
      await host.close(target, window)
      const before = launches
      expect(
        await host.compactConversation({
          conversation: target,
          agent: target,
          reason: 'Keep the measured plan',
        }),
      ).toMatchObject({ ok: true, queued: true })
      expect(
        await host.compactConversation({
          conversation: target,
          agent: target,
          reason: 'A later reason',
        }),
      ).toMatchObject({ ok: true, queued: true })
      expect(launches).toBe(before)
      expect(
        store.events(target).filter((one) => one.event.type === 'pending_compaction'),
      ).toHaveLength(1)
      expect(store.messagesWaitingIn(target)).toEqual([])
      await host.closeAll()
      holdCatalogue = true
      host = makeHost()
      const { sessionId: caller } = await host.createSession(
        { provider: provider === 'codex' ? 'claude' : 'codex', approvalMode: 'auto', cwd: folder },
        window,
      )
      const given = await call(agentToolsFor(host, caller), 'give_work', {
        profile: 'worker',
        to: target,
        title: 'Continue the measured plan',
        brief: 'Continue the measured plan',
        definition_of_done: 'The measured comparison is complete.',
      })
      expect(given.structured, JSON.stringify(given.structured)).toMatchObject({
        outcome: 'ok',
        agent: target,
      })
      if (provider === 'claude') {
        await until(() => catalogueAsked)
        expect(heard).toEqual([])
        catalogue.resolve()
      }
      if (!fails) {
        await until(() => compactions === 1)
        expect(heard).toEqual([])
      }
      confirmation.resolve()
      await until(() => heard.length > 0)
      expect(
        heard.filter((text) => text.includes('Done when: The measured comparison is complete.')),
      ).toHaveLength(1)
      expect(heard[0]).toContain('Continue the measured plan')
      if (fails) expect(heard[0]).not.toContain('Keep the measured plan')
      else expect(heard[0]).toContain('Keep the measured plan')
      expect(heard[0]).not.toContain('A later reason')
      const rows = store.events(target)
      const notice = rows.find(
        (one) =>
          one.event.type === 'message_queued' &&
          one.event.appNotice === 'a-conversation-was-compacted',
      )
      const input = rows.find((one) => one.event.type === 'user_turn')
      expect(input).toBeDefined()
      if (fails) expect(notice).toBeUndefined()
      else {
        expect(notice).toBeDefined()
        expect(notice!.ordinal).toBeLessThan(input!.ordinal)
      }
      expect(rows.filter((one) => one.event.type === 'pending_compaction').at(-1)?.event).toEqual({
        type: 'pending_compaction',
        request: null,
      })
      await host.closeAll()
      host = makeHost()
      await host.reopenForAPerson(target, window, null)
      expect(compactions).toBe(provider === 'claude' && fails ? 0 : 1)
    },
  )
})
