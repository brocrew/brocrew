import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-dynamic-tools-probe.smoke.ts`'s reason, verbatim:
// this probe owns its spawn so it can put the loopback provider's `env_key` in the child
// environment, which `createSpawnTransportFactory` sanitizes away.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { normalizeNotification } from '../src/codex/normalize'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **457 · what does a `dynamicToolCall` ITEM look like coming back, and what does a person
 * read off it?**
 *
 * ## ⛔ The question, and why nothing in the repository could answer it
 *
 * `448` §E4 measured that `itemSummary` has no `dynamicToolCall` branch, so both rows summarise as
 * the literal word `dynamicToolCall` — `405`'s recorded pair, of which only the NAME was rescued
 * at `348`. ⚑ **Writing the branch needs one fact nobody has measured: what the app-server
 * actually PUTS on the item it publishes back.** The generated type says
 * `contentItems: Array<DynamicToolCallOutputContentItem> | null` — and *absence in a capture is
 * not absence*, so a branch built on a field that never arrives would summarise `null` for ever
 * and look correct in every unit test.
 *
 * ⛔ **`348`'s probe cannot answer it.** That one captures the model REQUEST and answers `400`, so
 * no turn ever completes and no tool is ever called. This one lets the turn run.
 *
 * ## ⚑ How a Codex model calls one of our tools — measured, not assumed
 *
 * `348-A-namespace`'s own capture says Codex declares dynamic tools **inside the code-mode `exec`
 * tool's description**, under a `## brobot` heading, as
 *
 * ```ts
 * declare const tools: { brobot__list_agents(args: { note?: string; }): Promise<unknown>; };
 * ```
 *
 * ⚠️ **So the model does not emit a `function_call` for our tool at all.** It emits a
 * `custom_tool_call` for `exec` whose input is raw JavaScript, and the isolate calls us. That is
 * what the synthetic turn below sends, and it is why this probe can exist without a model.
 *
 * ## 🔴 Two arms, because the second one is a design decision this dispatch has to make
 *
 * | arm | what `answerCodexToolCall` sends back | the question |
 * |---|---|---|
 * | **A · one item** | today's shape: `text\nJSON` in ONE `inputText` | what comes back, and what a summary could read |
 * | **B · two items** | the prose in one `inputText`, the JSON in a SECOND | does the app-server carry both, and does the MODEL get both? |
 *
 * ⛔ **B exists because of a measurement.** On Codex the structured half rides in the text (there
 * is no `structuredContent` on `DynamicToolCallOutputContentItem`), so a summary of the whole
 * content is the answer plus a JSON blob — measured at **31 characters of answer and 169 of JSON**
 * for a real `list_agents`. ⚑ If the app-server carries two items, the boundary between the half a
 * person reads and the half a model parses becomes STRUCTURAL, and the normalizer can summarise
 * the first without parsing our own words back out of a provider's transport (`405`'s rule).
 *
 * ## ⚑ It costs no tokens and needs no credential
 *
 * Use an owned loopback Responses endpoint, ephemeral port, temporary `CODEX_HOME` under
 * scratch, and `env_key: 'probe-only'`. Personal `provider-homes/`, `~/.codex`, and `:9444`
 * stay untouched.
 *
 * ## ⛔ 669 · one outer deadline, derived from the waits below
 *
 * ⚠️ **Until `669` this file had no bound but vitest's own per-test default** (`655` §4). Its waits
 * were bounded one by one — the review that wrote it found two that were not — and the run now sits
 * inside `smoke/probe-run-deadline.ts` in the template's shape: the budget is {@link ARMS}' own waits,
 * each arm refuses to start past the deadline and again once its port is bound, and owns its
 * teardown before anything exists.
 *
 * Run: `pnpm run probe:codex-tool-answer`. Not part of `pnpm run ci`.
 */

const NAMESPACE = 'brobot'
const TOOL = 'list_agents'
/** The prose half of a real answer — short on purpose: this is the case where the JSON dominates. */
const PROSE = 'sess_2 · project-manager · idle'
const PAYLOAD = { outcome: 'ok', agents: [{ agent: 'sess_2', state: 'idle' }], count: 1 }

/**
 * ⛔ **The two arms, as one table the budget is counted from** — what each answers `item/tool/call`
 * with. A is the control (one item carrying both halves); B is the shape the app ships.
 */
const ARMS = {
  'A-one-item': [{ type: 'inputText', text: `${PROSE}\n${JSON.stringify(PAYLOAD)}` }],
  'B-two-items': [
    { type: 'inputText', text: PROSE },
    { type: 'inputText', text: JSON.stringify(PAYLOAD) },
  ],
} as const satisfies Record<string, readonly unknown[]>

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const TURN_DEADLINE_MS = 60_000
/** ⚠️ The same rule for one request: `initialize` and `thread/start`. */
const RPC_DEADLINE_MS = 30_000
/** One more beat after the dynamic item completes, so the turn's closing request lands. */
const SETTLE_MS = 5_000
/**
 * The transport's own close: `close()` ends stdin, waits `EXIT_GRACE_MS`, then SIGTERM and SIGKILL
 * each wait `KILL_GRACE_MS`.
 */
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS

/** One arm's worst case: two requests, the dynamic item, the settle and the close. */
const SERIAL_WAITS_MS = [RPC_DEADLINE_MS, RPC_DEADLINE_MS, TURN_DEADLINE_MS, SETTLE_MS, TEARDOWN_MS]

const deadline = probeRunDeadline(
  '457 tool-answer probe',
  runBudgetMs(Object.keys(ARMS).flatMap(() => SERIAL_WAITS_MS)),
  TEARDOWN_MS,
)

/** ⚑ Rule 40: the port the child was CONFIGURED with, read back from the file it reads. */
function configuredPortOf(config: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
  return match === null ? null : Number(match[1])
}

/**
 * 🔴 **The script the synthetic model runs, and it is not `await tools.x()` on its own.**
 *
 * ⛔ **Measured: a bare call produces `Output:` with NOTHING after it.** The isolate evaluates the
 * expression and discards its value unless something appends it, so a probe that only called the
 * tool would have reported *"the model saw nothing"* about a tool that answered perfectly — a
 * false negative about the one hop this dispatch is trying to measure.
 *
 * ⚑ **So the script reports the RETURN VALUE's shape**, which is the whole question for arm B:
 * what does a Codex isolate hand the model when our answer arrives as two content items rather
 * than one?
 */
const RETURN_MARKER = 'BROBOT457'

const EXEC_SOURCE = [
  `const answer = await tools.${NAMESPACE}__${TOOL}({ note: "457" })`,
  `text("${RETURN_MARKER}:" + JSON.stringify(answer))`,
].join('\n')

function providerStanza(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 457 capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_457_CAPTURE_KEY"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback port')
  return address.port
}

/**
 * ⚑ **The synthetic model turn.** `codex-memory-citation.smoke.ts`'s three-event shape, with the
 * assistant message replaced by a `custom_tool_call` for `exec` — which is how a Codex model
 * reaches one of OUR tools, per `348-A-namespace`'s captured declaration.
 */
function streamToolCall(response: ServerResponse, index: number): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  send('response.created', { response: { id: `resp_457_${index}` } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'custom_tool_call',
      id: `ctc_457_${index}`,
      call_id: `call_457_${index}`,
      name: 'exec',
      input: EXEC_SOURCE,
      status: 'completed',
    },
  })
  send('response.completed', { response: { id: `resp_457_${index}`, usage: usage() } })
  response.end()
}

/** The closing turn: a plain message, so the thread finishes instead of calling the tool for ever. */
function streamGoodbye(response: ServerResponse, index: number): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  send('response.created', { response: { id: `resp_457_end_${index}` } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_457_${index}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'done', annotations: [] }],
    },
  })
  send('response.completed', { response: { id: `resp_457_end_${index}`, usage: usage() } })
  response.end()
}

function usage(): Record<string, unknown> {
  return {
    input_tokens: 11,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 7,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 18,
  }
}

interface Notification {
  readonly method: string
  readonly params: unknown
}

interface Arm {
  readonly label: string
  /** What we answered `item/tool/call` with. */
  readonly answered: unknown
  /** Every `item/tool/call` we were asked, verbatim. */
  readonly asked: unknown[]
  /** Every notification the app-server published, in order. */
  readonly notifications: readonly Notification[]
  /** The model requests we saw, so arm B can prove what reached the model. */
  readonly bodies: unknown[]
  readonly failure: string | null
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  /** ⚠️ Kept until every expectation passes — a failing run leaves its own (`649` F6). */
  readonly root: string
}

async function capture(label: keyof typeof ARMS): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const contentItems = ARMS[label]
  const scratch = runScratch('codex-tool-answer')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const bodies: unknown[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        bodies.push(JSON.parse(raw))
      } catch {
        bodies.push(raw)
      }
      // ⛔ **The FIRST request calls the tool; every later one ends the turn.** A second tool call
      // would loop for ever against an endpoint that always answers the same way.
      if (bodies.length === 1) streamToolCall(response, bodies.length)
      else streamGoodbye(response, bodies.length)
    })
  })

  const notifications: Notification[] = []
  const asked: unknown[] = []
  let failure: string | null = null
  let listenedOn: number | null = null
  let configuredPort: number | null = null
  let config = ''
  let transport: SpawnCodexTransport | null = null
  let pump: Promise<void> | null = null

  /**
   * ⛔ **Owned BEFORE anything exists, and closes whatever is open EACH time it is called** — the
   * cancel probe's reason (`649` F6): an expiry that lands while the port is binding finds nothing
   * to close, so the `finally` must be able to close what was made after it.
   */
  const closeOwnedCapture = async (): Promise<void> => {
    try {
      if (transport !== null) await transport.close()
    } finally {
      try {
        if (pump !== null) await pump
      } finally {
        server.closeAllConnections()
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  }
  const release = deadline.own(() => closeOwnedCapture())

  /**
   * ⚠️ **Standing rule 13, and the review found two of these unbounded.** A `request` that never
   * answers costs an afternoon and reports nothing; a deadline turns it into a stated
   * NOT PERFORMED.
   */
  const bounded = async <T>(what: string, work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`NOT PERFORMED — ${what} did not answer in ${RPC_DEADLINE_MS}ms`)),
            RPC_DEADLINE_MS,
          )
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  try {
    listenedOn = await listen(server)
    deadline.refuse(`starting arm ${label} · the loopback port is bound`)
    writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn))
    config = readFileSync(join(home, 'config.toml'), 'utf8')
    configuredPort = configuredPortOf(config)

    transport = new SpawnCodexTransport(bundledCodexBinary(), ['app-server'], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: root,
        CODEX_HOME: home,
        CODEX_SQLITE_HOME: home,
        BROBOT_457_CAPTURE_KEY: 'probe-only',
      },
      exitGraceMs: EXIT_GRACE_MS,
      killGraceMs: KILL_GRACE_MS,
    })

    const ownedTransport = transport
    pump = (async () => {
      for await (const incoming of ownedTransport.incoming()) {
        if (incoming.kind === 'notification') {
          notifications.push({ method: incoming.method, params: incoming.params })
          continue
        }
        if (incoming.kind !== 'request') continue
        if (incoming.method === 'item/tool/call') {
          asked.push(incoming.params)
          // 🔴 **The arm.** This is the shape `answerCodexToolCall` would send.
          ownedTransport.respond(incoming.id, { contentItems, success: true })
          continue
        }
        ownedTransport.respondError(
          incoming.id,
          -32601,
          `the 457 probe does not implement ${incoming.method}`,
        )
      }
    })()

    await bounded(
      'initialize',
      ownedTransport.request('initialize', {
        clientInfo: {
          name: 'brobot-457-probe',
          title: 'BroBot 457 tool answer probe',
          version: '0.0.0',
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }),
    )
    ownedTransport.notify('initialized', {})
    const started = (await bounded(
      'thread/start',
      ownedTransport.request('thread/start', {
        model: 'gpt-5.6-luna',
        modelProvider: 'capture',
        cwd,
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: 'danger-full-access',
        dynamicTools: [
          {
            type: 'namespace',
            name: NAMESPACE,
            description: 'Tools that reach the app this agent is running inside.',
            tools: [
              {
                type: 'function',
                name: TOOL,
                description: `457 probe · ${TOOL}`,
                inputSchema: { type: 'object', properties: { note: { type: 'string' } } },
              },
            ],
          },
        ],
      }),
    )) as { thread?: { id?: string } }
    const threadId = started.thread?.id ?? ''
    void ownedTransport.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: '457 call the tool', text_elements: [] }],
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' },
      model: 'gpt-5.6-luna',
      effort: 'low',
    })
    // ⚠️ **Bounded** (standing rule 13): wait for a COMPLETED dynamic item, or report not performed.
    const itemBy = Date.now() + TURN_DEADLINE_MS
    const done = (): boolean =>
      notifications.some(
        (one) =>
          one.method === 'item/completed' &&
          (one.params as { item?: { type?: string } } | undefined)?.item?.type ===
            'dynamicToolCall',
      )
    while (!done() && Date.now() < itemBy) await new Promise((r) => setTimeout(r, 50))
    if (!done())
      failure = `NOT PERFORMED — no completed dynamicToolCall within ${TURN_DEADLINE_MS}ms`
    // One more beat so the turn's closing request lands, which is arm B's evidence.
    const settle = Date.now() + SETTLE_MS
    while (bodies.length < 2 && Date.now() < settle) await new Promise((r) => setTimeout(r, 50))
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    try {
      await closeOwnedCapture()
    } finally {
      release()
    }
  }

  const arm: Arm = {
    label,
    answered: { contentItems, success: true },
    asked: [...asked],
    notifications: [...notifications],
    bodies: [...bodies],
    failure,
    listenedOn,
    configuredPort,
    root,
  }
  writeFileSync(runEvidence(`457-${label}.json`), JSON.stringify({ config, ...arm }, null, 1))
  return arm
}

/**
 * 🔴 **What the ISOLATE handed the model, verbatim** — the `custom_tool_call_output` Codex writes
 * back into the next request's `input`.
 *
 * ⛔ **Not a substring test over the whole body**, which a first draft of this probe used and
 * which its own review rejected: the body also carries the tool DECLARATION and the earlier turn,
 * so `body.includes('project-manager')` can be true for reasons that have nothing to do with what
 * the tool answered.
 */
const isolateSaw = (arm: Arm): string => {
  const last = arm.bodies.at(-1) as { input?: unknown[] } | undefined
  const outputs = (last?.input ?? []).filter(
    (one): one is { type: string; output: unknown } =>
      typeof one === 'object' &&
      one !== null &&
      (one as { type?: string }).type === 'custom_tool_call_output',
  )
  const texts = outputs.flatMap((one) =>
    (Array.isArray(one.output) ? one.output : []).map((block) =>
      typeof block === 'object' &&
      block !== null &&
      typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : '',
    ),
  )
  // ⛔ **Only the line the SCRIPT emitted**, which is `JSON.stringify(answer)` — the exact value
  // the isolate handed the model. ⚠️ The preamble Codex prepends carries `Wall time 0.1 seconds`
  // and differs between two runs of the same arm, so comparing the whole output would have made
  // this a flake rather than a measurement. Found by the arms disagreeing on their first run.
  return texts.find((one) => one.startsWith(`${RETURN_MARKER}:`)) ?? '(the script emitted nothing)'
}

const dynamicItems = (arm: Arm): { phase: string; item: Record<string, unknown> }[] =>
  arm.notifications
    .filter((one) => one.method === 'item/started' || one.method === 'item/completed')
    .map((one) => ({
      phase: one.method,
      item: ((one.params as { item?: Record<string, unknown> }).item ?? {}) as Record<
        string,
        unknown
      >,
    }))
    .filter((one) => one.item['type'] === 'dynamicToolCall')

async function measureBothArms(): Promise<void> {
  // ⚑ Keyed from `ARMS`, so an arm the budget does not count cannot be run.
  const oneItem = await capture('A-one-item')
  const twoItems = await capture('B-two-items')

  const report = Object.fromEntries(
    [oneItem, twoItems].map((arm) => [
      arm.label,
      {
        failure: arm.failure,
        toolCallsAsked: arm.asked.length,
        modelRequests: arm.bodies.length,
        dynamicItems: dynamicItems(arm).map((one) => ({
          phase: one.phase,
          fields: Object.keys(one.item).sort(),
          status: one.item['status'],
          success: one.item['success'],
          contentItems: one.item['contentItems'],
          durationMs: one.item['durationMs'],
        })),
        // 🔴 What the NORMALIZER makes of it today, with no branch — the defect, from the wire.
        normalized: arm.notifications
          .filter((one) => one.method === 'item/started' || one.method === 'item/completed')
          .flatMap((one) => normalizeNotification(one.method, one.params))
          .filter((event) => event.type === 'tool_call' || event.type === 'tool_result'),
        // 🔴 Arm B's evidence: what the isolate actually handed the model.
        isolateSaw: isolateSaw(arm),
      },
    ]),
  )
  writeFileSync(runEvidence('457-report.json'), JSON.stringify(report, null, 1))
  console.log(`457 tool answer · ${JSON.stringify(report, null, 1)}`)

  // ⛔ **BOTH arms, and the review is why.** A first version asserted three times on arm A — the
  // shape this dispatch REMOVED — and not once on arm B, the shape it ships. Every regression the
  // probe exists to catch lands in `failure` rather than throwing, so a silent arm is a green run.
  for (const arm of [oneItem, twoItems]) {
    expect(arm.failure, `${arm.label} · the arm`).toBeNull()
    expect(arm.asked.length, `${arm.label} · the tool was called`).toBe(1)
    expect(arm.bodies.length, `${arm.label} · the turn came back to the model`).toBeGreaterThan(1)
  }

  // 🔴 **Fact 1 and 2: `contentItems` is null while the call is in flight and populated when it
  // completes.** The whole RESULT row reads this field, so a build in which it stopped arriving
  // would make every dynamic answer read `done` — and nothing else in the repository can see it.
  for (const arm of [oneItem, twoItems]) {
    const phases = dynamicItems(arm)
    expect(
      phases.map((one) => one.phase),
      `${arm.label} · both phases`,
    ).toEqual(['item/started', 'item/completed'])
    expect(phases[0]?.item['contentItems'], `${arm.label} · null while in flight`).toBeNull()
    expect(phases[0]?.item['arguments'], `${arm.label} · arguments on the call`).toEqual({
      note: '457',
    })
    expect(phases[1]?.item['contentItems'], `${arm.label} · echoed back on completion`).toEqual(
      arm.answered && (arm.answered as { contentItems: unknown }).contentItems,
    )
  }

  // 🔴 **Fact 3, and it is the one `agent-tools.ts` cites to justify splitting the answer in two:
  // the model cannot tell.** Codex joins `inputText` items with a newline before the isolate
  // returns, so one item holding `prose\nJSON` and two items holding `prose` and `JSON` are the
  // same string at the model. ⛔ Computed here rather than read off a report by hand.
  expect(isolateSaw(twoItems), 'the isolate saw the same string in both arms').toBe(
    isolateSaw(oneItem),
  )
  expect(isolateSaw(oneItem), 'and it is not empty, so the equality means something').toContain(
    PROSE,
  )
  expect(isolateSaw(oneItem), 'and it carries the payload too').toContain('"outcome')

  // ⚑ **And what a person now reads**, from the real wire, on both shapes — the before/after this
  // dispatch reports. Arm A keeps the payload on the row; arm B, which is what the app sends, does
  // not.
  const rowOf = (arm: Arm): string => {
    const settled = arm.notifications
      .filter((one) => one.method === 'item/completed')
      .flatMap((one) => normalizeNotification(one.method, one.params))
      .find((event) => event.type === 'tool_result')
    return settled !== undefined && settled.type === 'tool_result' ? settled.summary : ''
  }
  expect(rowOf(twoItems), 'B · the row a person reads is the answer alone').toBe(PROSE)
  expect(rowOf(oneItem), 'A · the control still carries the payload').toContain('"outcome')
  // ⛔ **And neither is the word `405` recorded**, which is the whole dispatch.
  for (const arm of [oneItem, twoItems]) expect(rowOf(arm)).not.toBe('dynamicToolCall')

  // ⚑ Rule 40: each arm's child was configured with the port THIS process was given.
  for (const arm of [oneItem, twoItems]) {
    expect(arm.listenedOn, `${arm.label} · the loopback port`).not.toBeNull()
    expect(arm.configuredPort, `${arm.label} · the port in the child's config`).toBe(arm.listenedOn)
  }

  // ⚠️ Only a run that got this far deletes its roots; a failing one leaves them (`649` F6).
  for (const arm of [oneItem, twoItems]) rmSync(arm.root, { recursive: true, force: true })
}

it(
  '457 · a dynamicToolCall item comes back, and this is what is on it',
  () => deadline.within('measuring arms A and B', measureBothArms),
  deadline.testTimeoutMs,
)
