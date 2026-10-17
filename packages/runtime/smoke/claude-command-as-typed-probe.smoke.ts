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
import { A_PERSONS_FRAME, theStampMovedNothing, whatTheCliDid } from './command-as-typed-evidence'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **708 · what the bundled Claude CLI DOES with a person's command, framed and bare** — `R42`.
 *
 * ## ⛔ The question
 *
 * `704` §4 measured, live, that the CLI given *"Sent by a person, typed into this app. … /compact"*
 * ran nothing and the model answered the words. `R42` rules that a person's command goes as typed,
 * and `708` §2 asks one more thing of it: ⚑ *"the `662` provenance field … is a separate channel from
 * the words: measure whether it still rides on a command without stopping it, and keep it if it
 * does."* So each command is sent three ways, one fact apart:
 *
 * | arm | the second turn | its `origin` | what it establishes |
 * |---|---|---|---|
 * | **framed** | a frame, then the command | `human` | the pre-`708` shape: the command is words |
 * | **bare** | the command, whole | `human` | `R42`'s shape, stamped as `708` sends it |
 * | **bare-unstamped** | the command, whole | none | the control for the STAMP: if `bare` and this differ, the stamp moved something |
 *
 * ⚑ Each arm is one conversation of two turns — a plain first turn, so `/compact` has something to
 * compact and `/clear` something to clear, then the command.
 *
 * ⚑ **The frame is the product's, whole** — `A_PERSONS_FRAME`, a copy this package can hold, pinned
 * to the desktop's `messageNamingItsSender` by `a-command-goes-as-typed.test.ts`. The CLI runs a
 * turn as a command only when its text starts with `/`, so any text in front would do; the
 * product's own is what is sent.
 *
 * ## 🔒 It costs no tokens and reads no credential
 *
 * `680`'s recipe, as `probe:claude-origin-wire` runs it: the SDK's bundled CLI, an owned loopback
 * Messages endpoint on a `listen(0)` port, a scratch `HOME` and `CLAUDE_CONFIG_DIR` per arm (which
 * scopes the CLI's Keychain prefetch to an item that does not exist), and the literal token
 * `probe-only`, sent only to the loopback port. Nothing here touches the person's `~/.claude`, their
 * Keychain item, their userData or `:9444`, and it launches no Electron. ⚑ Rule 40: the assertion is
 * that the child was CONFIGURED with the port `server.address()` returned, and that the endpoint
 * was then asked.
 *
 * *"This captures what the provider put in its model-bound request, not a hosted model's obedience
 * to the text."* — here the model is a script, and what is measured is what the CLI DID with the
 * turn: whether it handed the words to a model, and what it said it did.
 *
 * Run: `pnpm run probe:claude-command-as-typed`. Not part of `pnpm run ci`.
 */

const FIRST = '708 command probe: reply with the single word ok'
const HUMAN: SDKMessageOrigin = { kind: 'human' }

const COMMANDS = ['/clear', '/compact'] as const
type Command = (typeof COMMANDS)[number]
const SHAPES = {
  framed: { framed: true, origin: HUMAN },
  bare: { framed: false, origin: HUMAN },
  'bare-unstamped': { framed: false, origin: undefined },
} as const
type Shape = keyof typeof SHAPES

/**
 * ⚠️ Bounded, standing rule 13 — a CLI that never finishes a turn is NOT PERFORMED. ⚑ Derived
 * (standing rule 22): every arm's two turns ended in under a second on 708's runs — the model is a
 * script and a command runs locally — so thirty seconds is a stall, not a slow turn.
 */
const TURN_DEADLINE_MS = 30_000
/** Counted for the close — the SDK is aborted and the loopback closed; nothing here awaits the child. */
const TEARDOWN_MS = 10_000
const ARM_WAITS_MS = [TURN_DEADLINE_MS, TURN_DEADLINE_MS, TEARDOWN_MS]
const ARM_COUNT = COMMANDS.length * Object.keys(SHAPES).length

const deadline = probeRunDeadline(
  '708 claude command-as-typed probe',
  runBudgetMs(Array.from({ length: ARM_COUNT }, () => ARM_WAITS_MS).flat()),
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
function streamText(response: ServerResponse, model: string, text: string): void {
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
        id: 'msg_708',
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
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
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

interface Request {
  readonly path: string
  readonly body: unknown
}

/** The text of every USER message in a model-bound request, in order. */
function userTexts(body: unknown): string[] {
  const messages = (body as { messages?: { role?: string; content?: unknown }[] })?.messages ?? []
  return messages
    .filter((message) => message.role === 'user')
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
          ? (message.content as { type?: string; text?: string }[])
              .filter((block) => block.type === 'text')
              .map((block) => block.text ?? '')
              .join('\n')
          : '',
    )
}

const isModelCall = (one: Request): boolean =>
  one.path.startsWith('/v1/messages') && !one.path.startsWith('/v1/messages/count_tokens')

interface Arm {
  readonly command: Command
  readonly shape: Shape
  readonly sent: string
  /** Model calls the FIRST turn made — every arm's first turn is a plain message a model answers. */
  readonly firstModelCalls: number
  /** Every model-bound request after the first turn's, and the user texts in each. */
  readonly afterFirst: { readonly users: string[]; readonly system: string }[]
  /** ⚑ Did the command's words reach a model as a user message? */
  readonly wordsReachedAModel: boolean
  /** ⚑ Every frame the CLI emitted after the first turn's `result`, as `type/subtype`. */
  readonly framesAfterFirst: string[]
  /** The second turn's `result` text, when it had one — the CLI's own word for what it did. */
  readonly secondResult: string | null
  readonly secondEnded: boolean
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  readonly failure: string | null
  readonly stderr: string
  /** ⚑ This arm's scratch — deleted only once its command's verdict has passed (708's review). */
  readonly root: string
}

async function capture(command: Command, shape: Shape): Promise<Arm> {
  const label = `${command.slice(1)}-${shape}`
  deadline.refuse(`starting arm ${label}`)
  const scratch = runScratch('claude-command-as-typed')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const configDir = join(home, '.claude')
  const cwd = join(root, 'cwd')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const { framed, origin } = SHAPES[shape]
  const sent = framed ? `${A_PERSONS_FRAME}\n\n${command}` : command

  const requests: Request[] = []
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
      // ⚑ Every model-bound request — a compaction's summary request included — is answered `ok`.
      const model = String((body as { model?: string } | null)?.model ?? 'claude-probe')
      streamText(response, model, 'ok')
    })
  })

  let listenedOn: number | null = null
  let configuredPort: number | null = null
  let failure: string | null = null
  let stderr = ''
  const frames: SDKMessage[] = []
  let firstEndedAt = -1
  let firstRequests = 0
  let secondResult: string | null = null
  let secondEnded = false
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

    const message = (text: string, stamp: SDKMessageOrigin | undefined): SDKUserMessage => ({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
      ...(stamp === undefined ? {} : { origin: stamp }),
    })
    let firstDone: () => void = () => {}
    const firstEnded = new Promise<void>((resolve) => {
      firstDone = resolve
    })
    let finish: () => void = () => {}
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      yield message(FIRST, HUMAN)
      await firstEnded
      yield message(sent, origin)
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
        abortController: abort,
        stderr: (line: string) => {
          stderr += line
        },
      },
    })

    let results = 0
    const drained = (async () => {
      for await (const one of turn as AsyncIterable<SDKMessage>) {
        frames.push(JSON.parse(JSON.stringify(one)) as SDKMessage)
        if (one.type !== 'result') continue
        results += 1
        if (results === 1) {
          firstEndedAt = frames.length
          firstRequests = requests.filter(isModelCall).length
          firstDone()
        } else {
          secondEnded = true
          const said = (one as { result?: unknown }).result
          secondResult = typeof said === 'string' ? said : null
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
              reject(
                new Error(`NOT PERFORMED — the two turns did not end in ${2 * TURN_DEADLINE_MS}ms`),
              ),
            2 * TURN_DEADLINE_MS,
          )
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      firstDone()
      finish()
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    await closeOwnedCapture()
    release()
  }

  const afterFirst = requests
    .filter(isModelCall)
    .slice(firstRequests)
    .map((one) => ({
      users: userTexts(one.body).map((text) => text.replaceAll(cwd, '<cwd>')),
      system: JSON.stringify((one.body as { system?: unknown })?.system ?? '').slice(0, 400),
    }))
  const arm: Arm = {
    command,
    shape,
    sent,
    firstModelCalls: firstRequests,
    afterFirst,
    wordsReachedAModel: afterFirst.some((one) => one.users.some((text) => text.includes(sent))),
    framesAfterFirst: (firstEndedAt < 0 ? [] : frames.slice(firstEndedAt)).map((frame) => {
      const f = frame as { type?: string; subtype?: string }
      return f.subtype === undefined ? String(f.type) : `${String(f.type)}/${f.subtype}`
    }),
    secondResult,
    secondEnded,
    listenedOn,
    configuredPort,
    failure,
    stderr: stderr.slice(-4_000),
    root,
  }
  const evidence = runEvidence('claude-command-as-typed')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(
    join(evidence, `${label}.json`),
    `${JSON.stringify({ ...arm, frames: frames.slice(firstEndedAt < 0 ? 0 : firstEndedAt) }, null, 2)}\n`,
  )
  return arm
}

const arms: Partial<Record<string, Arm>> = {}

async function measure(command: Command, shape: Shape): Promise<Arm> {
  const arm = await capture(command, shape)
  arms[`${command}:${shape}`] = arm
  console.log(
    `[708 ${command} ${shape}]`,
    JSON.stringify(
      {
        failure: arm.failure,
        wordsReachedAModel: arm.wordsReachedAModel,
        modelCallsAfterFirst: arm.afterFirst.length,
        framesAfterFirst: arm.framesAfterFirst,
        secondResult: arm.secondResult,
      },
      null,
      2,
    ),
  )
  expect(arm.failure, arm.stderr).toBeNull()
  // ⚑ Rule 40 — the child was configured with the port this process listened on, and asked it.
  expect(arm.configuredPort).toBe(arm.listenedOn)
  // ⚠️ …and ASKED it: the first turn is a model call on every arm, so an arm whose first turn asked
  // this endpoint nothing was talking to something else.
  expect(arm.firstModelCalls, 'the first turn never reached the loopback').toBeGreaterThan(0)
  return arm
}

/**
 * ⚑ **Measured 2026-09-24 on CLI 2.1.281** (the SDK's bundled binary, 0.3.281):
 *
 * | | `/clear` | `/compact` |
 * |---|---|---|
 * | **framed** | a model answered the words (`ok`); no reset | a model answered the words; no boundary |
 * | **bare** | `conversation_reset`, no model call | `status` ×2 → `compact_boundary`, one summary call |
 * | **bare-unstamped** | the same frames as **bare** | the same frames as **bare** |
 *
 * ⛔ **So the frame is what stopped the command, and the stamp stops nothing** — `708` §2's question,
 * answered: stamped and unstamped run alike, so `662`'s `person` stamp does not stop a command and
 * `R42` keeps it. ⚠️ Whether the CLI KEPT the stamp on that turn is not what this reads. A bump that turns any of
 * these red has changed what the CLI does with a person's command; re-read
 * `a-command-goes-as-typed.ts` before anything else.
 */
for (const command of COMMANDS) {
  it(
    `708 · ${command}: framed is words, bare RUNS, and the stamp moves nothing`,
    () =>
      deadline.within(`arms ${command}`, async () => {
        const framed = await measure(command, 'framed')
        const bare = await measure(command, 'bare')
        const unstamped = await measure(command, 'bare-unstamped')
        expect(whatTheCliDid(framed), 'the framed command was not handed over as words').toBe(
          'words',
        )
        expect(whatTheCliDid(bare), 'the bare, stamped command did not run').toBe('ran-it')
        expect(whatTheCliDid(unstamped), 'the bare, unstamped control did not run').toBe('ran-it')
        expect(theStampMovedNothing(bare, unstamped), 'the person’s stamp changed the run').toBe(
          true,
        )
        // ⛔ **Only now is this command's scratch removed** — a red keeps each arm's CLI transcript.
        for (const arm of [framed, bare, unstamped]) {
          // ⚠️ Nothing awaits the CLI child's exit, so it may still be writing its session file:
          // retried rather than trusted to be quiet (708's second review).
          rmSync(arm.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        }
      }),
    deadline.testTimeoutMs,
  )
}
