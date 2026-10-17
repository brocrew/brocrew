import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  describeScan,
  pathsNaming,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import {
  CodexRuntime,
  codexAuthHealth,
  createSpawnTransportFactory,
  provisionCodexAuth,
  provisionProviderHome,
  type CodexIncoming,
  type CodexTransport,
  type ReasoningEffort,
  type RuntimeEvent,
  type SessionHandle,
  type TransportFactory,
} from '../src/index'
import { bundledCodexBinary } from './bundled-codex'
import { runEvidence, runScratch } from './run-paths'

/**
 * ⛔ **What Codex actually sends when a model spawns two NAMED children** (226 §1).
 *
 * `225` — the explorer's fourth run — asked Codex, outside plan mode, for two read-only children
 * named `alpha` and `beta`. Both drew as `nested agent`, and on completion both read `ENDED` ·
 * `usage not reported` · `nested — parent not reported`. That face is `SubAgentEntry.vue`'s
 * `origin === 'observed'` branch, which exists for the GRANDCHILD (135) — an agent announced on a
 * connection this app does not hold. Two depth-1 children wearing it is either the label being
 * right about a wire we misread, or names we are throwing away.
 *
 * ⚠️ **From outside the app the two are indistinguishable**, which is why this probe exists before
 * any line of the fix. `216` is the precedent and the method: run the PINNED binary, capture the
 * real frames, and carry a positive control that visibly changes the capture — there, a localhost
 * sink; here, the transport itself, because the app-server speaks to us over stdio and the honest
 * tap is the one every frame already passes through.
 *
 * ## What it measures
 *
 *  1. **Every frame, in order**, teed to `two-children-wire.jsonl` — request, response,
 *     notification and server-initiated request alike.
 *  2. **The birth**: does a `subAgentActivity` item arrive at all, and does it carry an
 *     `agentThreadId`, an `agentPath`, a name?
 *  3. **The child's own thread**: which `thread/status/changed` ids are NOT ours, and — the
 *     hypothesis this probe can settle — whether a child's first `active` arrives BEFORE or AFTER
 *     its birth announcement. `sub-agents.ts` opens an `observed` card on an unannounced `active`,
 *     and `transcript.ts` never lowers `origin` again.
 *  4. **What ends it**: any usage, any outcome, any final answer on this connection.
 *  5. **What BroBot made of it**: the `sub_agent` events the adapter emitted, with `origin`,
 *     `idKind` and `kind` per agent.
 *
 * ## The positive control
 *
 * A first turn spawns NOTHING. Its slice of the capture must contain zero sub-agent items and zero
 * foreign threads; the second turn's must not. Without it, "no name on the wire" and "the tap is
 * blind" read the same — which is 226 §4's own trap, one layer down.
 *
 * ⚠️ **This probe asserts almost nothing about the product.** It is a measurement, and its result
 * is the report it writes. The two things it does assert are that the instrument worked at all:
 * the control turn ran, and the sub-agent turn produced children.
 */

const LOG = runEvidence('two-children-wire.log')
const FRAMES = runEvidence('two-children-wire.jsonl')

function say(line: string): void {
  console.log(line)
  appendFileSync(LOG, `${line}\n`)
}

/** One captured frame, in the order it crossed the transport. */
interface Frame {
  seq: number
  /** `out` — us to the app-server; `in` — the app-server to us. */
  dir: 'out' | 'in'
  kind: string
  method?: string
  /** Which turn's slice this frame belongs to; the control turn is `1`. */
  slice: number
  body: unknown
}

/**
 * The transport, teed. It delegates every method and changes nothing about the bytes — a tap that
 * altered the traffic would be measuring itself.
 *
 * ⚠️ **`pid` is a getter on the interface**, so it is re-read on every access rather than copied
 * once: `SpawnCodexTransport.pid` becomes `undefined` when the child dies, and a snapshot taken at
 * construction would keep naming a dead process (074's finding, one layer up).
 */
function tappingFactory(inner: TransportFactory, capture: (frame: Omit<Frame, 'seq'>) => void) {
  return ((context) => {
    const transport = inner(context)
    const tap: CodexTransport = {
      async request(method, params) {
        capture({ dir: 'out', kind: 'request', method, slice: 0, body: params })
        // ⛔ **The rejection is captured too, and this is not defensive dressing.** A request that
        // errors would otherwise leave an outbound frame in the log with no reply beside it, and
        // this probe's whole output is a reading about what Codex does and does not send. An error
        // presented as silence is `absence-in-a-capture-is-not-absence` inside the instrument built
        // to avoid it.
        try {
          const result = await transport.request(method, params)
          capture({ dir: 'in', kind: 'response', method, slice: 0, body: result })
          return result
        } catch (error) {
          capture({
            dir: 'in',
            kind: 'error',
            method,
            slice: 0,
            body: { message: error instanceof Error ? error.message : String(error) },
          })
          throw error
        }
      },
      notify(method, params) {
        capture({ dir: 'out', kind: 'notify', method, slice: 0, body: params })
        transport.notify(method, params)
      },
      respond(id, result) {
        capture({ dir: 'out', kind: 'respond', slice: 0, body: { id, result } })
        transport.respond(id, result)
      },
      respondError(id, code, message) {
        capture({ dir: 'out', kind: 'respondError', slice: 0, body: { id, code, message } })
        transport.respondError(id, code, message)
      },
      incoming() {
        return (async function* tee(): AsyncGenerator<CodexIncoming> {
          for await (const message of transport.incoming()) {
            capture({
              dir: 'in',
              kind: message.kind,
              method: message.method,
              slice: 0,
              body: message,
            })
            yield message
          }
        })()
      },
      close() {
        return transport.close()
      },
      get pid(): number | undefined {
        return transport.pid
      },
    }
    return tap
  }) satisfies TransportFactory
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function str(value: unknown, key: string): string {
  const found = field(value, key)
  return typeof found === 'string' ? found : ''
}

/** The `item` an `item/started`/`item/completed` notification carries, or `undefined`. */
function itemOf(frame: Frame): Record<string, unknown> | undefined {
  if (frame.dir !== 'in') return undefined
  if (frame.method !== 'item/started' && frame.method !== 'item/completed') return undefined
  const item = field(field(frame.body, 'params'), 'item')
  return isRecord(item) ? item : undefined
}

const consume = (handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> =>
  (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

const turns = (events: RuntimeEvent[]): number => events.filter((e) => e.type === 'turn').length

/** The explorer's own gesture (225 finding 1), reproduced word for word in intent. */
const TWO_CHILDREN =
  'Spawn two read-only sub-agents to work in parallel. Name the first `alpha` and ask it to ' +
  'report how many FILES are in the current working directory. Name the second `beta` and ask ' +
  'it to report how many DIRECTORIES are in the current working directory. Wait for both, then ' +
  'give me their two answers as two bullet points. Do not write any files.'

/** One child, told to spawn two of its own — the depth-2 case `observe` exists for (135). */
const NESTED_CHILDREN =
  'Spawn ONE read-only sub-agent named `coordinator`. Instruct `coordinator` to spawn two ' +
  'read-only sub-agents of its own, named `gamma` and `delta`: `gamma` reports the operating ' +
  'system name and `delta` reports the current user name. `coordinator` waits for both and ' +
  'reports their two answers back to you. Then give me both answers. Do not write any files.'

it('codex two-children wire — measurement', async () => {
  writeFileSync(LOG, '')
  writeFileSync(FRAMES, '')
  const scratch = runScratch('two-children-wire')
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `codex-wire-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)

  const frames: Frame[] = []
  /** Which turn we are in; every frame is stamped with it so the control has a slice of its own. */
  let slice = 0
  const capture = (frame: Omit<Frame, 'seq'>): void => {
    const stamped: Frame = { ...frame, seq: frames.length, slice }
    frames.push(stamped)
    appendFileSync(FRAMES, `${JSON.stringify(stamped)}\n`)
  }

  const runtime = new CodexRuntime(
    tappingFactory(createSpawnTransportFactory(bundledCodexBinary()), capture),
    codexAuthHealth,
  )

  // ⚠️ **The model is a PARAMETER, because the explorer's was not the default** (225 ran GPT-5.6
  // Luna at low effort; the app's default asks for neither). A capture taken on a different model
  // than the one that produced the report is a measurement of something else, and this probe's
  // whole job is to be the same gesture.
  const model = process.env['BROBOT_PROBE_MODEL']
  const effort = process.env['BROBOT_PROBE_EFFORT'] as ReasoningEffort | undefined
  say(`model requested: ${model ?? '(none — provider default)'} · effort: ${effort ?? '(none)'}`)
  const handle = await runtime.start({
    cwd: scratch,
    providerHome,
    ...(model ? { model } : {}),
    ...(effort ? { reasoningEffort: effort } : {}),
  })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  /** Answer every card the run raises, so an approval cannot be mistaken for a silent provider. */
  let answered = 0
  const answerCards = async (): Promise<void> => {
    const cards = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request',
    )
    for (; answered < cards.length; answered++) {
      const card = cards[answered]!
      const offered = card.scope.availableDecisions
      await handle.respondPermission(card.id, {
        outcome: offered.includes('allow') ? 'allow' : 'deny',
      })
    }
  }

  /** Wait out one turn, answering every card it raises so a prompt cannot look like a silence. */
  const driveTurn = async (before: number, label: string): Promise<void> => {
    const deadline = Date.now() + 600_000
    while (turns(events) === before) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
      await answerCards()
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  try {
    // ---- the positive control: a turn that spawns nothing ----
    slice = 1
    const before = turns(events)
    await handle.send('Reply with exactly the single word: SOLO. Do not run any tools.')
    await waitFor(() => turns(events) > before, 180_000, 'the control turn')

    // ---- the measurement: the explorer's gesture ----
    slice = 2
    const beforeChildren = turns(events)
    await handle.send(TWO_CHILDREN)
    await driveTurn(beforeChildren, 'the sub-agent turn')

    // ---- the second measurement: a child that spawns children of its OWN ----
    // ⛔ **This is the case `origin: 'observed'` was BUILT for** (135), and it is the only way to
    // find out whether the explorer met it. A depth-2 agent is announced to the depth-1 CHILD, on a
    // connection this app does not hold, so if 135's model is right this turn produces threads with
    // no birth, no name and no parent — the exact face `225` reported — while the turn above
    // produced named ones. Two gestures, one session, one capture: the difference between them is
    // the finding.
    slice = 3
    const beforeNested = turns(events)
    await handle.send(NESTED_CHILDREN)
    await driveTurn(beforeNested, 'the nested sub-agent turn')
  } finally {
    slice = 9
    await handle.close()
    await consumer
  }

  // 🔒 **Nothing this run made is in a personal home** (176's guard, the sibling probe's shape). A
  // run that drives three real agent turns — one of them spawning grandchildren in a live sandbox —
  // has no business asserting anything about the provider until it can say that.
  const markers: Marker[] = [
    { label: 'our home', value: `codex-wire-${process.pid}` },
    { label: 'our cwd', value: 'two-children-wire' },
  ]
  const scan = describeScan(
    pathsNaming(join(homedir(), '.claude'), markers),
    pathsNaming(join(homedir(), '.codex'), markers),
  )

  // ---------------- what the wire said ----------------

  const ownThread = frames.find((f) => f.kind === 'response' && f.method === 'thread/start')
  const ownThreadId =
    str(field(ownThread?.body, 'thread'), 'id') || str(ownThread?.body, 'threadId')

  const items = frames.flatMap((frame) => {
    const item = itemOf(frame)
    return item ? [{ frame, item }] : []
  })
  const subAgentItems = items.filter(({ item }) => str(item, 'type') === 'subAgentActivity')

  const statuses = frames.filter((f) => f.dir === 'in' && f.method === 'thread/status/changed')
  const statusRows = statuses.map((f) => ({
    seq: f.seq,
    slice: f.slice,
    threadId: str(field(f.body, 'params'), 'threadId'),
    state: str(field(field(f.body, 'params'), 'status'), 'type'),
  }))
  const foreign = statusRows.filter((r) => r.threadId !== '' && r.threadId !== ownThreadId)
  const foreignIds = [...new Set(foreign.map((r) => r.threadId))]

  say(`own thread id: ${ownThreadId || '(never seen)'}`)
  say(`frames captured: ${frames.length} · items: ${items.length}`)
  say(
    `item types seen: ${JSON.stringify(
      [...new Set(items.map(({ item }) => str(item, 'type')))].sort(),
    )}`,
  )

  // --- the positive control ---
  const controlSub = subAgentItems.filter(({ frame }) => frame.slice === 1).length
  const controlForeign = foreign.filter((r) => r.slice === 1).length
  const measuredSub = subAgentItems.filter(({ frame }) => frame.slice === 2).length
  say(
    `CONTROL (turn 1, no children asked for): ${controlSub} subAgentActivity item(s), ` +
      `${controlForeign} foreign thread status frame(s)`,
  )
  say(
    `MEASURED (turn 2, two named children): ${measuredSub} subAgentActivity item(s), ` +
      `${foreign.filter((r) => r.slice === 2).length} foreign thread status frame(s)`,
  )
  say(
    `NESTED (turn 3, a child that spawns its own): ` +
      `${subAgentItems.filter(({ frame }) => frame.slice === 3).length} subAgentActivity item(s), ` +
      `${foreign.filter((r) => r.slice === 3).length} foreign thread status frame(s)`,
  )
  say(`distinct foreign threads across the run: ${foreignIds.length}`)

  // --- the birth, whole ---
  for (const { frame, item } of subAgentItems) {
    say(`  subAgentActivity @${frame.seq} (${frame.method}) ${JSON.stringify(item)}`)
  }
  if (subAgentItems.length === 0) say('  ⛔ NO subAgentActivity item arrived on this connection.')

  // --- birth versus first active, per child thread ---
  for (const threadId of foreignIds) {
    const firstActive = statusRows.find((r) => r.threadId === threadId && r.state === 'active')
    const birth = subAgentItems.find(({ item }) => str(item, 'agentThreadId') === threadId)
    const order =
      firstActive && birth
        ? birth.frame.seq < firstActive.seq
          ? `birth @${birth.frame.seq} BEFORE first active @${firstActive.seq}`
          : `⛔ first active @${firstActive.seq} BEFORE birth @${birth.frame.seq}`
        : birth
          ? `birth @${birth.frame.seq}, never went active`
          : `⛔ never announced — first active @${firstActive?.seq ?? '(none)'}`
    const rows = statusRows.filter((r) => r.threadId === threadId).map((r) => `${r.seq}:${r.state}`)
    const born = birth ? str(birth.item, 'agentPath') || '(no agentPath)' : '(no birth)'
    const inSlice = statusRows.find((r) => r.threadId === threadId)?.slice
    say(`  thread ${threadId} [turn ${inSlice}] ${born} — ${order} · statuses [${rows.join(', ')}]`)
  }

  // --- is a NAME anywhere on the wire at all? ---
  const named = frames.filter(
    (f) => f.slice >= 2 && /\b(alpha|beta|coordinator|gamma|delta)\b/i.test(JSON.stringify(f.body)),
  )
  say(`frames whose body mentions one of the requested names: ${named.length}`)
  for (const frame of named.slice(0, 12)) {
    say(`  @${frame.seq} ${frame.dir} ${frame.kind} ${frame.method ?? ''} — ${trim(frame.body)}`)
  }

  // --- usage or an outcome for a child, anywhere ---
  const childUsage = frames.filter(
    (f) =>
      f.dir === 'in' &&
      foreignIds.some((id) => JSON.stringify(f.body).includes(id)) &&
      /usage|tokens/i.test(JSON.stringify(f.body)),
  )
  say(`frames carrying a child thread id AND a usage/token field: ${childUsage.length}`)
  for (const frame of childUsage.slice(0, 6)) say(`  @${frame.seq} ${trim(frame.body)}`)

  // ---------------- what BroBot made of it ----------------

  const cards = events.filter(
    (e): e is Extract<RuntimeEvent, { type: 'sub_agent' }> => e.type === 'sub_agent',
  )
  const byAgent = new Map<string, Extract<RuntimeEvent, { type: 'sub_agent' }>[]>()
  for (const card of cards) byAgent.set(card.agentId, [...(byAgent.get(card.agentId) ?? []), card])
  say(`sub_agent events: ${cards.length} across ${byAgent.size} agent(s)`)
  for (const [agentId, list] of byAgent) {
    const first = list[0]!
    say(
      `  ${agentId} — origin=${first.origin ?? '(none)'} idKind=${first.idKind ?? '(none)'} ` +
        `kind=${JSON.stringify(list.find((e) => e.kind)?.kind ?? null)} ` +
        `outcome=${JSON.stringify(list.find((e) => e.outcome)?.outcome ?? null)} ` +
        `usage=${JSON.stringify(list.find((e) => e.usage)?.usage ?? null)} ` +
        `phases=[${list.map((e) => e.phase).join(', ')}]`,
    )
  }

  say(`frames: ${FRAMES}`)

  // The instrument worked: the control ran, and the measured turn produced children. Everything
  // else above is a reading, and a reading that asserted its own answer would be worthless.
  expect(turns(events)).toBeGreaterThanOrEqual(2)
  expect(controlSub + controlForeign).toBe(0)
  expect(byAgent.size).toBeGreaterThan(0)
  expect(scan, 'nothing this run made is in a personal home').toBe('none')

  // 🔒 **The credential copy goes with the run.** `provisionCodexAuth` writes this machine's
  // `auth.json` into the throwaway home; leaving it behind would accumulate a live credential under
  // `tmpdir()` on every invocation. The sibling probe removes both, and so does this one.
  rmSync(providerHome, { recursive: true, force: true })
  rmSync(scratch, { recursive: true, force: true })
}, 900_000)

function trim(body: unknown): string {
  const text = JSON.stringify(body)
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}
