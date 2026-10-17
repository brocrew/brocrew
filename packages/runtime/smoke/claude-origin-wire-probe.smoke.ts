import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import {
  query,
  type SDKMessage,
  type SDKMessageOrigin,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import { buildChildEnv } from '../src/internal/child-env'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **680 · what the bundled Claude CLI hands the MODEL for a turn BroBot stamps with an origin** —
 * `662` F-a, *"the `peer` stamp is inert on CLI 2.1.218 — re-check on every SDK bump"*, measured on
 * the wire.
 *
 * ## ⛔ Why only the wire can answer it
 *
 * ⚠️ **The SDK's types do not say what a peer stamp DOES**: `SDKMessageOrigin.peer` documents
 * `fromMode` as *"honored only from the injecting host on local stdin"*. So this sends the SAME
 * message three times, one fact apart, and records the model-bound bytes.
 *
 * | arm | the turn's `origin` |
 * |---|---|
 * | **none** | absent — the CONTROL: every turn BroBot does not classify |
 * | **human** | `{ kind: 'human' }` — a person's own turn in the window |
 * | **peer** | `{ kind: 'peer', from, name }` — another agent's message, as `claudeOriginOf` builds it |
 *
 * ⚑ **What it can say**: whether the bytes the model is handed differ between the arms, and how. ⛔
 * **What it cannot**: the keyword gate — 662 §4 measured that a fake
 * key does not open the account's workflows gate, so no arm here can raise it. And *"This captures
 * what the provider put in its model-bound request, not a hosted model's obedience to the text."*
 *
 * ## 🔒 It costs no tokens and reads no credential
 *
 * `675`'s recipe, as `probe:claude-tool-answer` runs it: the SDK's bundled CLI, an owned loopback
 * Messages endpoint on a `listen(0)` port, a scratch `HOME` and `CLAUDE_CONFIG_DIR` per arm (which
 * scopes the CLI's Keychain prefetch to an item that does not exist), and the literal token
 * `probe-only`, sent only to the loopback port. Nothing here touches the person's `~/.claude`, their
 * Keychain item, their userData or `:9444`. ⚑ Rule 40: the assertion is that the child was CONFIGURED
 * with the port `server.address()` returned, and that the endpoint was then asked.
 *
 * Run: `pnpm run probe:claude-origin-wire`. Not part of `pnpm run ci`.
 */

const WORDS = '680 origin probe: reply with the single word ok'

const ARMS = {
  none: undefined,
  human: { kind: 'human' },
  peer: { kind: 'peer', from: 'sess_680_peer', name: 'Probe Peer' },
} as const satisfies Record<string, SDKMessageOrigin | undefined>

type ArmName = keyof typeof ARMS

/** ⚠️ Bounded, standing rule 13 — a CLI that never finishes its turn is NOT PERFORMED. */
const TURN_DEADLINE_MS = 90_000
/** The SDK's own close: it ends the child's stdin and waits for it to go. */
const TEARDOWN_MS = 10_000
const SERIAL_WAITS_MS = [TURN_DEADLINE_MS, TEARDOWN_MS]

const deadline = probeRunDeadline(
  '680 claude origin wire probe',
  runBudgetMs(Object.keys(ARMS).flatMap(() => SERIAL_WAITS_MS)),
  TEARDOWN_MS,
)

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback port')
  return address.port
}

/** One streamed text reply, in the Messages API's shape. */
function streamText(response: ServerResponse, model: string): void {
  const usage = {
    input_tokens: 11,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_680',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage,
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ]
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  for (const event of events) {
    response.write(`event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  response.end()
}

interface Block {
  readonly type?: string
  readonly text?: string
}

/** The model-bound request that carries OUR words, and the user turn inside it that does. */
function turnCarrying(
  requests: readonly { path: string; body: unknown }[],
): { content: unknown; system: unknown } | null {
  for (const one of requests) {
    if (!one.path.startsWith('/v1/messages') || one.path.startsWith('/v1/messages/count_tokens'))
      continue
    const body = one.body as { messages?: { role?: string; content?: unknown }[]; system?: unknown }
    for (const message of body?.messages ?? []) {
      if (message.role !== 'user') continue
      if (JSON.stringify(message.content ?? '').includes(WORDS))
        return { content: message.content, system: body.system }
    }
  }
  return null
}

/** The user turn's text blocks, in order — what the model reads of it. */
function textsOf(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return (content as Block[]).filter((one) => one.type === 'text').map((one) => one.text ?? '')
}

interface Arm {
  readonly label: ArmName
  readonly requests: { path: string; body: unknown }[]
  /** ⚑ With this arm's own scratch cwd written `<cwd>`, so arms compare on everything else. */
  readonly modelSaw: string[] | null
  /**
   * ⚑ The WHOLE model-bound request, cwd written `<cwd>`, uuids `<uuid>`, and `metadata` set aside —
   * it carries a `device_id` minted per config dir, so every arm's differs by construction.
   */
  readonly wholeRequest: string | null
  readonly frames: SDKMessage[]
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  readonly failure: string | null
  readonly stderr: string
}

async function capture(label: ArmName): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const scratch = runScratch('claude-origin-wire')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const configDir = join(home, '.claude')
  const cwd = join(root, 'cwd')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const requests: { path: string; body: unknown }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: unknown
      try {
        body = raw === '' ? null : JSON.parse(raw)
      } catch {
        body = raw
      }
      const path = request.url ?? ''
      requests.push({ path, body })
      if (!path.startsWith('/v1/messages')) {
        response.statusCode = 404
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error' } }))
        return
      }
      if (path.startsWith('/v1/messages/count_tokens')) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ input_tokens: 11 }))
        return
      }
      streamText(response, String((body as { model?: string } | null)?.model ?? 'claude-probe'))
    })
  })

  let listenedOn: number | null = null
  let configuredPort: number | null = null
  let failure: string | null = null
  let stderr = ''
  const frames: SDKMessage[] = []
  const abort = new AbortController()

  const closeOwnedCapture = async (): Promise<void> => {
    abort.abort()
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  const release = deadline.own(() => closeOwnedCapture())

  try {
    listenedOn = await listen(server)
    deadline.refuse(`starting arm ${label} · the loopback port is bound`)
    const env = buildChildEnv({
      HOME: home,
      CLAUDE_CONFIG_DIR: configDir,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${listenedOn}`,
      CLAUDE_CODE_OAUTH_TOKEN: 'probe-only',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      DISABLE_AUTOUPDATER: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    })
    // Scratch scope keeps CLI Keychain prefetch away from the personal item; see the header.
    if (!(env['CLAUDE_CONFIG_DIR'] ?? '').startsWith(root)) {
      throw new Error('NOT PERFORMED — the config dir is not this arm’s own scratch')
    }
    if (env['CLAUDE_SECURESTORAGE_CONFIG_DIR'] !== undefined) {
      throw new Error(
        'NOT PERFORMED — CLAUDE_SECURESTORAGE_CONFIG_DIR would unscope the Keychain lookup',
      )
    }
    // ⚑ Rule 40: the port the child is CONFIGURED with, read back off the environment it is given.
    const configured = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(env['ANTHROPIC_BASE_URL'] ?? '')
    configuredPort = configured === null ? null : Number(configured[1])

    const origin = ARMS[label]
    // ⚑ One user message, stamped the way `claudeOriginOf` stamps a turn, and nothing else.
    const turnMessage: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: WORDS },
      parent_tool_use_id: null,
      session_id: '',
      ...(origin === undefined ? {} : { origin }),
    }
    let sent = false
    let finish: () => void = () => {}
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      if (!sent) {
        sent = true
        yield turnMessage
      }
      await finished
    }

    const turn = query({
      prompt: prompt(),
      options: {
        cwd,
        env,
        model: 'claude-haiku-4-5',
        strictMcpConfig: true,
        settingSources: [],
        maxTurns: 1,
        abortController: abort,
        stderr: (line: string) => {
          stderr += line
        },
      },
    })

    const drained = (async () => {
      for await (const message of turn as AsyncIterable<SDKMessage>) {
        frames.push(JSON.parse(JSON.stringify(message)) as SDKMessage)
        if (message.type === 'result') {
          finish()
          break
        }
      }
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        drained,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`NOT PERFORMED — the turn did not end in ${TURN_DEADLINE_MS}ms`)),
            TURN_DEADLINE_MS,
          )
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      finish()
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    await closeOwnedCapture()
    release()
  }

  const carried = turnCarrying(requests)
  const first = requests.find(
    (one) =>
      one.path.startsWith('/v1/messages') && !one.path.startsWith('/v1/messages/count_tokens'),
  )
  const wholeRequest =
    first === undefined || first.body === null || typeof first.body !== 'object'
      ? null
      : JSON.stringify({ ...(first.body as Record<string, unknown>), metadata: '<metadata>' })
          .replaceAll(cwd, '<cwd>')
          .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  const arm: Arm = {
    label,
    requests,
    modelSaw:
      carried === null
        ? null
        : textsOf(carried.content).map((text) => text.replaceAll(cwd, '<cwd>')),
    wholeRequest,
    frames,
    listenedOn,
    configuredPort,
    failure,
    stderr: stderr.slice(-4_000),
  }
  const evidence = runEvidence('claude-origin-wire')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, `${label}.json`), `${JSON.stringify(arm, null, 2)}\n`)
  if (failure === null) rmSync(root, { recursive: true, force: true })
  return arm
}

const arms: Partial<Record<ArmName, Arm>> = {}

/** The CLI version the arm's own `system/init` announced. */
function versionOf(arm: Arm): string | null {
  for (const frame of arm.frames) {
    const f = frame as { type?: string; subtype?: string; claude_code_version?: string }
    if (f.type === 'system' && f.subtype === 'init') return f.claude_code_version ?? null
  }
  return null
}

async function measure(label: ArmName): Promise<void> {
  const arm = await capture(label)
  arms[label] = arm
  console.log(
    `[680 origin ${label}]`,
    JSON.stringify(
      {
        cli: versionOf(arm),
        failure: arm.failure,
        requests: arm.requests.map((one) => one.path),
        modelSaw: arm.modelSaw,
      },
      null,
      2,
    ),
  )
  expect(arm.failure, arm.stderr).toBeNull()
  // ⚑ Rule 40 — the child was configured with the port this process listened on, and asked it.
  expect(arm.configuredPort).toBe(arm.listenedOn)
  expect(arm.modelSaw, 'no model-bound request carried the turn').not.toBeNull()
}

it(
  '680 · none: the control',
  () => deadline.within('arm none', () => measure('none')),
  deadline.testTimeoutMs,
)
it(
  '680 · human: a person’s own turn',
  () => deadline.within('arm human', () => measure('human')),
  deadline.testTimeoutMs,
)
it(
  '680 · peer: another agent’s message',
  () =>
    deadline.within('arm peer', async () => {
      await measure('peer')
      const none = arms.none?.modelSaw ?? null
      const peer = arms.peer?.modelSaw ?? null
      const human = arms.human?.modelSaw ?? null
      console.log(
        '[680 origin verdict]',
        JSON.stringify(
          {
            peerSameAsNone: JSON.stringify(peer) === JSON.stringify(none),
            humanSameAsNone: JSON.stringify(human) === JSON.stringify(none),
          },
          null,
          2,
        ),
      )
      // ⚑ **Measured 2026-09-24 on CLI 2.1.281: all three byte-identical** — eight text blocks each,
      // our words last. ⛔ So `662` F-a holds for what the model is handed: a peer stamp changes
      // nothing it reads. A bump that makes this red has given the stamp a meaning — re-read
      // `claudeOriginOf`'s table before anything else.
      expect(none).not.toBeNull()
      expect(peer, 'the peer stamp now changes what the model is handed').toEqual(none)
      // ⚠️ And a person's stamp, here, where the workflows gate cannot open (662 §4): the keyword is
      // the one thing `human` changes, and no arm here can raise it.
      expect(human, 'the human stamp now changes what the model is handed').toEqual(none)
      // ⚑ …and the whole request, not only our turn: the system prompt, the tools, every reminder.
      expect(arms.none?.wholeRequest ?? null).not.toBeNull()
      expect(arms.peer?.wholeRequest, 'the peer stamp moved the request').toBe(
        arms.none?.wholeRequest,
      )
      expect(arms.human?.wholeRequest, 'the human stamp moved the request').toBe(
        arms.none?.wholeRequest,
      )
    }),
  deadline.testTimeoutMs,
)
