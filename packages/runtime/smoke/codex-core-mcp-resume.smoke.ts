import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { CodexRuntime, codexAppServerArgs } from '../src/codex/codex-runtime'
import { SpawnCodexTransport, type CodexTransport } from '../src/codex/codex-transport'
import { withDeadline } from '../src/internal/bounded'
import type { AgentToolset } from '../src/agent-tools'
import type { SessionHandle } from '../src/runtime'
import type { RuntimeEvent } from '../src/events'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

// A scripted loopback model and fictional home only: this never contacts a provider.
const WAIT = 20_000
const deadline = probeRunDeadline(
  'native core MCP resume',
  runBudgetMs(Array(8).fill(WAIT)),
  12_000,
)
const bound = <T>(what: string, pending: Promise<T>) => withDeadline(pending, WAIT, what)

function stream(response: ServerResponse, id: string, item: Record<string, unknown>): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const emit = (type: string, value: Record<string, unknown>) =>
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  emit('response.created', { response: { id } })
  emit('response.output_item.done', { output_index: 0, item })
  emit('response.completed', { response: { id } })
  response.end()
}

it(
  'refreshes the actual runtime core server on a resumed native thread and routes a model call',
  async () => {
    await deadline.within('two native launches', async () => {
      const root = runScratch('native-core-mcp-resume')
      const home = join(root, 'home')
      const cwd = join(root, 'work')
      mkdirSync(home, { recursive: true })
      mkdirSync(cwd, { recursive: true })
      let revision = 1
      let requests = 0
      const bodies: { revision: number; body: unknown }[] = []
      const calls: { revision: number; args: Record<string, unknown> }[] = []
      const events: { revision: number; event: RuntimeEvent }[] = []
      const opening: { method: string; params: unknown }[] = []
      const children: SpawnCodexTransport[] = []
      const handles: SessionHandle[] = []
      const model = createServer((request, response) => {
        void (async () => {
          const parts: Buffer[] = []
          for await (const part of request) parts.push(Buffer.from(part))
          const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as {
            input?: { type?: string }[]
          }
          bodies.push({ revision, body })
          const ordinal = ++requests
          if (ordinal === 1) {
            stream(response, `call-${revision}`, {
              type: 'custom_tool_call',
              id: `exec-${revision}`,
              call_id: `exec-call-${revision}`,
              name: 'exec',
              status: 'completed',
              input:
                'text(ALL_TOOLS.filter(t => t.name.startsWith("mcp__brobot__")));' +
                (revision === 1
                  ? ''
                  : 'text(await tools.mcp__brobot__compact_agent({agent:"fictional-other"})); try { await tools.mcp__brobot__not_listed({}); } catch { text("not-listed-rejected"); }'),
            })
            return
          }
          const output = body.input?.filter((one) => one.type?.endsWith('_call_output')).at(-1)
          const waiting = /Script running with cell ID\s+([A-Za-z0-9_-]+)/.exec(
            JSON.stringify(output),
          )
          if (waiting !== null) {
            stream(response, `wait-${ordinal}`, {
              type: 'function_call',
              id: `wait-${ordinal}`,
              call_id: `wait-call-${ordinal}`,
              namespace: 'functions',
              name: 'wait',
              arguments: JSON.stringify({
                cell_id: waiting[1],
                yield_time_ms: 1000,
                max_tokens: 2000,
              }),
            })
            return
          }
          stream(response, `answer-${revision}`, {
            type: 'message',
            id: `answer-${revision}`,
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'done', annotations: [] }],
          })
        })().catch((error: unknown) => {
          response.writeHead(500)
          response.end(String(error))
        })
      })
      const stop = async () => {
        for (const handle of handles.splice(0)) await handle.close()
        for (const child of children.splice(0)) await child.close()
        model.closeAllConnections()
        await new Promise<void>((resolve) => model.close(() => resolve()))
      }
      const release = deadline.own(stop)
      try {
        await bound(
          'model listen',
          new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve)),
        )
        const address = model.address()
        if (address === null || typeof address === 'string') throw new Error('No local model port')
        writeFileSync(
          join(home, 'config.toml'),
          [
            'model_provider = "capture"',
            '[model_providers.capture]',
            'name = "Fictional local model"',
            `base_url = "http://127.0.0.1:${address.port}/v1"`,
            'env_key = "BROCREW_LOCAL_CAPTURE_KEY"',
            'request_max_retries = 0',
            'stream_max_retries = 0',
            '',
          ].join('\n'),
        )
        const runtime = new CodexRuntime((context): CodexTransport => {
          const child = new SpawnCodexTransport(bundledCodexBinary(), codexAppServerArgs(), {
            cwd: context.cwd,
            env: {
              PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
              HOME: root,
              CODEX_HOME: context.providerHome,
              CODEX_SQLITE_HOME: context.providerHome,
              BROCREW_LOCAL_CAPTURE_KEY: 'fictional-local-only',
            },
            exitGraceMs: 2000,
            killGraceMs: 2000,
          })
          children.push(child)
          return {
            request: (method, params) => {
              // Existing local-model probes substitute auth status, never a real credential.
              if (method === 'getAuthStatus')
                return Promise.resolve({
                  authMethod: 'apikey',
                  authToken: null,
                  requiresOpenaiAuth: false,
                })
              if (method === 'account/read')
                return Promise.resolve({ account: { type: 'apiKey' }, requiresOpenaiAuth: false })
              if (method === 'thread/start' || method === 'thread/resume')
                opening.push({ method, params })
              return child.request(method, params)
            },
            notify: (method, params) => child.notify(method, params),
            respond: (id, result) => child.respond(id, result),
            respondError: (id, code, message) => child.respondError(id, code, message),
            incoming: () => child.incoming(),
            close: () => child.close(),
            get pid() {
              return child.pid
            },
          }
        })
        const toolset = (): AgentToolset => ({
          server: 'brobot',
          instructions: 'The current local core tools.',
          tools: [
            {
              name: 'original_tool',
              description: `Original revision ${revision}.`,
              input: {},
              beyondItsRails: 'nothing-its-rails-do-not-cover',
              call: async () => ({ text: 'original' }),
            },
            ...(revision === 1
              ? []
              : [
                  {
                    name: 'compact_agent',
                    description: 'Newly added local core tool.',
                    input: { agent: z.string() },
                    beyondItsRails: 'nothing-its-rails-do-not-cover' as const,
                    call: async (args: Record<string, unknown>) => {
                      calls.push({ revision, args })
                      return { text: 'Core revision 2: compact_agent' }
                    },
                  },
                ]),
          ],
        })
        const options = () => ({
          cwd,
          providerHome: home,
          model: 'gpt-5.6-luna',
          approvalMode: 'ask' as const,
          agentTools: toolset(),
        })
        let ref: SessionHandle['ref'] = null
        for (revision = 1; revision <= 2; revision++) {
          requests = 0
          const handle: SessionHandle = await bound(
            'open native runtime',
            ref ? runtime.resume(ref, options()) : runtime.start(options()),
          )
          handles.push(handle)
          if (ref) expect(handle.ref?.sessionId).toBe(ref.sessionId)
          ref = handle.ref
          const life = revision
          let finished!: () => void
          const idle = new Promise<void>((resolve) => {
            finished = resolve
          })
          void (async () => {
            let busy = false
            for await (const event of handle.events()) {
              events.push({ revision: life, event })
              if (event.type === 'status') {
                if (event.state === 'working') busy = true
                if (busy && event.state === 'idle') finished()
              }
            }
          })()
          await bound('send local turn', handle.send('Reply with one word.'))
          await bound('local turn completion', idle)
          await bound('close native runtime', handle.close())
          handles.pop()
        }
        expect(opening.map((one) => one.method)).toEqual(['thread/start', 'thread/resume'])
        for (const one of opening) expect(one.params).not.toHaveProperty('dynamicTools')
        const before = JSON.stringify(bodies.filter((one) => one.revision === 1))
        const after = JSON.stringify(bodies.filter((one) => one.revision === 2))
        expect(before).toContain('mcp__brobot__original_tool')
        expect(before).not.toContain('Newly added local core tool.')
        expect(after).toContain('Newly added local core tool.')
        expect(after).toContain('Original revision 2.')
        expect(after).toContain('Core revision 2: compact_agent')
        expect(after).toContain('not-listed-rejected')
        expect(calls).toEqual([{ revision: 2, args: { agent: 'fictional-other' } }])
        expect(events.filter((one) => one.event.type === 'permission_request')).toEqual([])
      } finally {
        writeFileSync(
          runEvidence('codex-core-mcp-native.json'),
          JSON.stringify({ opening, bodies, calls, events }, null, 2),
        )
        await stop()
        release()
      }
    })
  },
  deadline.testTimeoutMs,
)
