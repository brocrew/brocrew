import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 The same deep import `codex-memory-store.smoke.ts` justifies: `SpawnCodexTransport` is
// deliberately not re-exported from the package index (063, from 061 finding 4) because the
// factory sanitizes the child environment, and this probe needs the loopback provider's `env_key`.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
// ⚑ BroBot's OWN normaliser, run over the captured item — so what this app would emit for a cited
// message is MEASURED here rather than read off the source and asserted in prose.
import { normalizeNotification } from '../src/codex/normalize'
import { codexMemoryIndex, codexMemorySummary, ensureCodexMemoryConfig } from '../src/index'
import { bundledCodexBinary } from './bundled-codex'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **318 · does a memory READ leave a trace on the wire?**
 *
 * 318's brief asserts as settled fact that when Codex reads memory it *"leaves a trace nowhere — no
 * event, no file, no mtime, nothing changes."* Three offline facts say otherwise at the shipped pin:
 * the vendored v2 protocol declares `agentMessage.memoryCitation: MemoryCitation | null`; the
 * 0.146.0 binary carries a system prompt telling the model to append exactly one
 * `<oai-mem-citation>` block as the VERY LAST content of the final reply; and the binary carries the
 * matching PARSER constants in rodata (`<citation_entries></citation_entries>|note=[`,
 * `<oai-mem-citation></oai-mem-citation>`).
 *
 * ⚠️ **None of that is a measurement.** A declared field can be dead, and a prompt can be shipped
 * for a code path that no longer runs. This probe is the wire test: it BECOMES the model — a
 * loopback Responses-API endpoint that streams a synthetic final reply — and then reads what the
 * real `app-server` child publishes back over JSON-RPC.
 *
 * | arm | the reply the endpoint streams | what it decides |
 * |---|---|---|
 * | **A · cited** | answer + a well-formed `<oai-mem-citation>` block | is `memoryCitation` populated, and is the block stripped from `text`? |
 * | **B · plain** | the same answer, no block | ⛔ the control |
 *
 * ⚠️ **What this does NOT measure: the live `item/agentMessage/delta` channel** — see
 * {@link chunkForDeltas} for how far the attempt got and why its silence is not evidence.
 *
 * ⛔ **Arm B is what makes arm A a measurement.** A field that is always populated, or always null,
 * measures nothing; only the DIFFERENCE between the two arms is evidence.
 *
 * ⚠️ `wire_api = "chat"` is refused at this pin (the binary: *"`wire_api = \"chat\"` is no longer
 * supported"*), so the endpoint speaks the **Responses API SSE** dialect — `response.created`,
 * `response.output_item.done`, `response.completed` — which is what `codex-api/src/sse/responses.rs`
 * deserialises.
 *
 * The loopback endpoint acts as the model, so no turn is paid for and no credential enters
 * any constructed home. Personal `provider-homes/`, `~/.codex`, and `:9444` stay untouched.
 *
 * Run: `pnpm run probe:codex-memory-citation`. Not part of `pnpm run ci`.
 */

const NOTE_MARKER = 'BROBOT_318_NOTE_MARKER'
const ANSWER = "The user's full name is Bob Alicio."
const ROLLOUT_ID = '019c6e27-e55b-73d1-87d8-4e01f1f75043'

/** Arm A's reply: the answer, then the block, appended last, in the binary's own documented shape. */
const REPLY_CITED = [
  ANSWER,
  '',
  '<oai-mem-citation>',
  '<citation_entries>',
  `MEMORY.md:1-3|note=[${NOTE_MARKER}]`,
  '</citation_entries>',
  '<rollout_ids>',
  ROLLOUT_ID,
  '</rollout_ids>',
  '</oai-mem-citation>',
].join('\n')

/** Arm B's reply: the control — the same answer and nothing else. */
const REPLY_PLAIN = ANSWER

function providerStanza(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 318 answering endpoint"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_318_CAPTURE_KEY"',
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
 * ⛔ **The live delta channel is NOT measured here, and this is the note that says so.**
 *
 * `normalize.ts` turns `item/agentMessage/delta` into `assistant_delta`, which the UI paints as it
 * lands — so *"the block is stripped from `text`"* and *"the block never streams past the user"* are
 * two claims, not one, and only the first is measured below.
 *
 * ⚠️ **This endpoint could not make the child publish a single delta.** Five candidate SSE event
 * spellings were tried against the real 0.146.0 child — `response.output_text.delta`,
 * `response.text.delta`, `response.content_part.delta`, `response.output_item.delta`,
 * `response.output_text_delta` — and every one produced **zero** `item/agentMessage/delta`
 * notifications, in the cited arm AND in the block-free control. The turn otherwise parsed and
 * completed normally, so the stream itself was accepted. Two readings survive, and this probe
 * cannot separate them: the name is still wrong, or the HTTP Responses path at this pin does not
 * stream assistant text at all (the binary's own `.delta` SSE spellings are not findable in rodata,
 * while `response.output_item.done` and `response.completed` — the two this endpoint DOES send —
 * are, and the delta-bearing `AgentMessageContentDelta` sits with the websocket transport).
 *
 * ⛔ So the deltas are RECORDED and never asserted on. A negative that is really an instrument
 * failure must be labelled as an instrument failure (074), not folded into the result.
 *
 * Three chunks, the last two splitting the citation block across a delta boundary — kept so that
 * the day the child does stream, a half-block leak has somewhere to show up.
 */
function chunkForDeltas(text: string): string[] {
  const at = text.indexOf('<oai-mem-citation>')
  if (at < 0) return [text.slice(0, 10), text.slice(10)]
  const mid = at + Math.floor((text.length - at) / 2)
  return [text.slice(0, at), text.slice(at, mid), text.slice(mid)]
}

/**
 * ⚑ **The synthetic model turn.** Only three events, and each is here because the binary names it:
 * `response.created` opens the stream, `response.output_item.done` carries the assistant message
 * (the binary logs *"failed to parse ResponseItem from output_item.done"* when this shape is wrong),
 * and `response.completed` ends it (*"stream closed before response.completed"* when it is absent).
 */
function streamReply(response: ServerResponse, text: string, index: number): void {
  const responseId = `resp_318_${index}`
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  send('response.created', { response: { id: responseId } })
  // ⚑ **Streamed, not delivered whole — because that is how a real reply arrives.** `normalize.ts`
  // turns `item/agentMessage/delta` into `assistant_delta`, which the UI paints as it lands. If the
  // block were stripped only from the FINAL item, the user would still watch raw XML scroll past.
  // The chunk boundary is deliberately INSIDE the block so a half-block leak has somewhere to show.
  for (const chunk of chunkForDeltas(text)) {
    send('response.output_text.delta', { output_index: 0, content_index: 0, delta: chunk })
  }
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_318_${index}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  })
  send('response.completed', {
    response: {
      id: responseId,
      usage: {
        input_tokens: 11,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 7,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 18,
      },
    },
  })
  response.end()
}

interface Notification {
  readonly method: string
  readonly params: unknown
}

interface Arm {
  /** Every JSON-RPC notification the app-server published, verbatim and in order. */
  readonly notifications: readonly Notification[]
  /** The outbound model requests we answered — evidence that memory was ON in this arm. */
  readonly requests: readonly string[]
  readonly failure: string | null
  readonly stopped: string
}

async function run(label: string, reply: string): Promise<Arm> {
  const scratch = runScratch('codex-memory-citation')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const requests: string[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push(
        JSON.stringify({ url: request.url, body: Buffer.concat(chunks).toString('utf8') }),
      )
      streamReply(response, reply, requests.length)
    })
  })
  const port = await listen(server)
  writeFileSync(join(home, 'config.toml'), providerStanza(port))
  // ⚑ The SHIPPED writer, for `codex-memory-store.smoke.ts`'s reason: an arm that opened the memory
  // gates by hand would prove nothing about the home a user's profile actually gets.
  const written = ensureCodexMemoryConfig(home)
  expect(written.outcome, `the shipped writer refused: ${written.why ?? ''}`).toBe('written')
  // The cited file has to EXIST, and be at least as long as the range the citation names — a parser
  // that validates the range would otherwise drop the entry and we would read that as "no support".
  seedAt(
    codexMemoryIndex(home),
    [
      '# Handbook',
      '',
      "- the user's full name is Bob Alicio",
      '- and he prefers short answers',
      '',
    ].join('\n'),
  )
  seedAt(codexMemorySummary(home), "The user's full name is Bob Alicio.\n")

  const transport = new SpawnCodexTransport(
    bundledCodexBinary(),
    ['app-server', '--strict-config'],
    {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: root,
        CODEX_HOME: home,
        CODEX_SQLITE_HOME: home,
        BROBOT_318_CAPTURE_KEY: 'probe-only',
      },
    },
  )

  const notifications: Notification[] = []
  // ⚠️ Server→client requests must be answered or the child waits on us forever.
  const pump = (async () => {
    for await (const incoming of transport.incoming()) {
      if (incoming.kind === 'request') {
        transport.respondError(
          incoming.id,
          -32601,
          `the 318 probe does not implement ${incoming.method}`,
        )
      } else {
        notifications.push({ method: incoming.method, params: incoming.params })
      }
    }
  })()

  let failure: string | null = null
  let stopped = 'timeout'
  try {
    await transport.request('initialize', {
      clientInfo: {
        name: 'brobot-318-probe',
        title: 'BroBot 318 memory citation probe',
        version: '0.0.0',
      },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })
    transport.notify('initialized', {})
    const started = (await transport.request('thread/start', {
      model: 'gpt-5.6-luna',
      modelProvider: 'capture',
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'danger-full-access',
      ephemeral: true,
    })) as { thread?: { id?: string } }
    void transport.request('turn/start', {
      threadId: started.thread?.id,
      input: [{ type: 'text', text: "318 what is the user's full name?", text_elements: [] }],
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' },
      model: 'gpt-5.6-luna',
      effort: 'low',
    })
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (notifications.some((n) => n.method === 'turn/completed')) {
        stopped = 'turn/completed'
        break
      }
      if (notifications.some((n) => n.method === 'turn/failed' || n.method === 'error')) {
        stopped = 'turn/failed'
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    // One more beat: `item/completed` and `turn/completed` are not ordered by contract.
    await new Promise((resolve) => setTimeout(resolve, 500))
  } catch (error) {
    // Kept rather than thrown, as `codex-memory-store.smoke.ts` does: a child that died carries its
    // stderr tail here, and a probe that hides why the app-server refused is the instrument going
    // quiet — an instrument failure must never be readable as a negative finding.
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    await transport.close()
    await pump
    await new Promise((resolve) => server.close(() => resolve(undefined)))
  }

  const arm: Arm = { notifications: [...notifications], requests: [...requests], failure, stopped }
  rmSync(root, { recursive: true, force: true })
  return arm
}

function seedAt(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Every `agentMessage` item this arm published, from any `item/*` notification carrying one. */
function agentMessages(arm: Arm): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  for (const notification of arm.notifications) {
    if (!notification.method.startsWith('item/')) continue
    const item = isRecord(notification.params) ? notification.params['item'] : undefined
    if (isRecord(item) && item['type'] === 'agentMessage') found.push(item)
  }
  return found
}

it('318 · a memory read is published as agentMessage.memoryCitation, or it is not', async () => {
  const cited = await run('cited', REPLY_CITED)
  const plain = await run('plain', REPLY_PLAIN)

  const describe = (arm: Arm) => {
    const items = agentMessages(arm)
    const last = items.at(-1) ?? null
    return {
      stopped: arm.stopped,
      failure: arm.failure,
      modelRequests: arm.requests.length,
      // ⚑ Was memory actually ON in this arm? The seeded summary in the outbound prompt says so.
      memoryPromptReached: arm.requests.some((body) => body.includes('oai-mem-citation')),
      // The seeded summary really was injected — 317's finding, re-observed here so that
      // "memory was on in this arm" is read off the wire rather than off the config we wrote.
      memorySummaryReached: arm.requests.some((body) => body.includes('MEMORY_SUMMARY BEGINS')),
      notificationMethods: arm.notifications.map((n) => n.method),
      // ⚠️ The LIVE channel, recorded separately from the final item: what the UI paints as it
      // lands. "Stripped from `text`" and "never streamed" are two claims, not one.
      deltas: arm.notifications
        .filter((n) => n.method === 'item/agentMessage/delta')
        .map((n) => (isRecord(n.params) ? n.params['delta'] : n.params)),
      agentMessageCount: items.length,
      agentMessageItems: items,
      text: last === null ? null : last['text'],
      // ⚠️ `null` and ABSENT are different answers and must not be collapsed: a field the server
      // omits is not a field the server decided was empty (the repository's standing note that an
      // omitted field is not a provider default).
      memoryCitationPresent: last !== null && 'memoryCitation' in last,
      memoryCitation: last === null ? null : (last['memoryCitation'] as unknown),
      textStillHasBlock:
        typeof last?.['text'] === 'string' && last['text'].includes('<oai-mem-citation>'),
      // ⛔ **What BroBot ACTUALLY emits for this item.** ⚑ **Corrected in place at 319** (`142`):
      // this said *"`normalize.ts`'s `message` arm reads `text` and nothing else, so the citation
      // dies here even though the wire carried it"* — true when written, and the finding this probe
      // was run to produce. 319 wrote the missing arm, so the same call now yields the assistant
      // message AND a `memory_recall` beside it, and the assertions at the foot hold it to that.
      brobotEmits: last === null ? null : normalizeNotification('item/completed', { item: last }),
    }
  }

  const report = { cited: describe(cited), plain: describe(plain) }
  const citedDeltaText = report.cited.deltas
    .filter((d): d is string => typeof d === 'string')
    .join('')
  const evidence = { ...report, citedDeltaText }
  writeFileSync(runEvidence('codex-memory-citation.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(
    `318 CODEX MEMORY CITATION — ${JSON.stringify({
      citedStopped: report.cited.stopped,
      citedFailure: report.cited.failure,
      citedMemoryCitation: report.cited.memoryCitation,
      citedTextHasBlock: report.cited.textStillHasBlock,
      plainCitationPresent: report.plain.memoryCitationPresent,
      plainMemoryCitation: report.plain.memoryCitation,
      brobotEmits: report.cited.brobotEmits,
      citedDeltaLeaksBlock: citedDeltaText.includes('<oai-mem-citation>'),
    })}`,
  )

  // ⚑ **The instrument speaks before it is believed.** An arm whose child never called the endpoint,
  // or never published a message, is an instrument failure and must not be read as a null finding.
  expect(cited.requests.length, 'arm A never reached the answering endpoint').toBeGreaterThan(0)
  expect(plain.requests.length, 'arm B never reached the answering endpoint').toBeGreaterThan(0)
  expect(report.cited.agentMessageCount, 'arm A published no agentMessage item').toBeGreaterThan(0)
  expect(report.plain.agentMessageCount, 'arm B published no agentMessage item').toBeGreaterThan(0)

  // A · the field is REAL: the app-server parsed the block into structured entries.
  expect(report.cited.memoryCitationPresent, 'arm A: memoryCitation was not even a field').toBe(
    true,
  )
  expect(
    report.cited.memoryCitation,
    'arm A: memoryCitation is null — the read left no trace',
  ).toEqual({
    entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: NOTE_MARKER }],
    threadIds: [ROLLOUT_ID],
  })
  // B · …and the block is taken OUT of the text, so it is a channel and not a leak into the prose.
  expect(report.cited.textStillHasBlock, 'arm A: the block was left in `text`').toBe(false)
  expect(report.cited.text, 'arm A: the answer itself did not survive').toContain(ANSWER)
  // C · the control. Without this, an always-populated field would look exactly like a finding.
  expect(report.plain.memoryCitationPresent, 'arm B: memoryCitation was absent, not null').toBe(
    true,
  )
  expect(
    report.plain.memoryCitation,
    'arm B: a reply with NO block still carried a citation',
  ).toBeNull()
  // ⛔ **No assertion on the deltas, and that is the honest shape.** See {@link chunkForDeltas}:
  // this endpoint could not get the child to publish `item/agentMessage/delta` at all, so their
  // absence here is an INSTRUMENT limit and not a finding. `citedDeltaText` is written to the
  // evidence either way, so the day a pin starts streaming them the file says so.

  // ⚑ **319 · the wire fact reaches the CONVERSATION**, asserted here rather than in a unit test.
  //
  // ⚠️ **A unit test cannot close this and it is worth saying why.** `codex-normalize.test.ts`
  // feeds `codexMemoryRecall` a hand-written `memoryCitation` — a shape read off the vendored type
  // and typed into a fixture. It proves the reader against our own idea of the payload, and it
  // would pass unchanged if the real app-server named the field something else, nested it, or
  // parsed the block into a different structure. ⛔ The oracle has to be the child's own output, and
  // it is the same `describe()` call the report above is built from, so what is asserted is what the
  // evidence file records.
  const emitted = report.cited.brobotEmits ?? []
  expect(
    emitted.map((event) => event.type),
    'the citation the child published did not become a row in the conversation',
  ).toEqual(['assistant_message', 'memory_recall'])
  const recalled = emitted.find((event) => event.type === 'memory_recall')
  expect(recalled?.type === 'memory_recall' && recalled.entries).toEqual([
    { path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: NOTE_MARKER },
  ])
  // ⛔ **The control again, one layer up.** Arm B's reply carried no block, so the app must produce
  // no row — otherwise a recall row would appear under every answer and mean nothing.
  expect(
    (report.plain.brobotEmits ?? []).map((event) => event.type),
    'an uncited answer produced a memory row',
  ).toEqual(['assistant_message'])
}, 300_000)
