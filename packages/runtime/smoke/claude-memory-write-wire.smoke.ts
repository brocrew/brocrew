import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  buildChildEnv,
  claudeAutoMemoryDir,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type RuntimeEvent,
} from '../src/index'
import { normalizeMessage } from '../src/claude/normalize'

/**
 * 330 §2 · 🔴 **What this CLI sends back about the memory directory we tell it to use.**
 *
 * ⛔ **Nobody had ever asked.** `claude-runtime.ts` sends the child
 * `{ autoMemoryDirectory: claudeAutoMemoryDir(providerHome) }` and has since 166. `318` measured the
 * RECALL path across a real child and found no memory tool and no citation; `319` ruled on that and
 * closed it. ⚠️ **Neither of them measured the WRITE path**, and treating the recall negative as one
 * is `absence-in-a-capture-is-not-absence` — the mistake this project has already paid for twice.
 *
 * ## ⚑ The search shape, stated before the answer (`316`'s defect, named so it cannot repeat)
 *
 * `316` enumerated item **TYPES**, found no memory tool, and reported the act invisible. The answer
 * was a **FIELD** on an item type it had already fetched. So this probe does not enumerate types.
 * {@link fieldInventory} walks **every key path at every depth of every raw frame**, array indices
 * collapsed, and records the path, how often it appeared, its JS types and a sample value. ⛔ **A
 * new field on a known message is therefore inside the search shape**, and so is a new message
 * `type`, a new `system` subtype, a new tool in `init.tools`, and — by {@link valueHits} — any
 * VALUE anywhere that quotes the memory directory or the remembered token.
 *
 * 🔴 **So the shapes of answer this probe could have found are:**
 *
 *  1. a message `type` this app does not handle → `types` in the report
 *  2. a `system` subtype it does not handle → `subtypes`
 *  3. **a field, at any depth, on any frame** → the inventory, which is the whole of it
 *  4. a tool named for memory → `init.tools`, printed whole
 *  5. the directory we SENT, echoed back on any field → {@link valueHits}
 *  6. the remembered token quoted on any field other than the model's own prose → {@link valueHits}
 *
 * ⚠️ **And the negative is anchored to a write that really happened.** A turn in which the model
 * wrote nothing would produce a clean, worthless negative — so the store is listed before and after
 * and the probe FAILS if nothing appeared. `put-the-hazard-on-the-path-the-code-walks`, in probe form.
 *
 * ## 🔒 Isolation
 *
 * Use a temporary home under the managed smoke root and a temporary cwd, then remove both.
 * Never use `~/.claude` or personal `provider-homes/`. Run `haiku` for two turns in one
 * session so recall uses the context that performed the write.
 */

const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'

/** A whole run's budget. Two haiku turns; a hung one must not eat the file timeout in silence. */
const TURN_BUDGET_MS = 180_000

interface Frame {
  readonly atMs: number
  readonly turn: number
  readonly type: string
  readonly subtype?: string
  readonly raw: SDKMessage
}

interface FieldFact {
  count: number
  readonly types: Set<string>
  sample: string
}

/**
 * ⛔ **Every key path at every depth, which is the shape `316` did not have.**
 *
 * Array indices collapse to `[]` so `message.content[0].type` and `message.content[7].type` are one
 * path rather than two — otherwise a long conversation buries the inventory in ordinals and a reader
 * cannot see what the FIELDS are. ⚠️ A leaf records its type and a clipped sample: a field present
 * and `null` is a different answer from a field absent (318's control arm proved that distinction is
 * real on this wire), so `null` is a recorded type and never a skip.
 */
function fieldInventory(value: unknown, path: string, out: Map<string, FieldFact>): void {
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const fact = out.get(path) ?? { count: 0, types: new Set<string>(), sample: '' }
  fact.count += 1
  fact.types.add(kind)
  if (!fact.sample && kind !== 'object' && kind !== 'array') {
    fact.sample = JSON.stringify(value)?.slice(0, 120) ?? ''
  }
  out.set(path, fact)
  if (Array.isArray(value)) {
    for (const entry of value) fieldInventory(entry, `${path}[]`, out)
    return
  }
  if (kind === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      fieldInventory(entry, path ? `${path}.${key}` : key, out)
    }
  }
}

/**
 * ⛔ **Where a NEEDLE appears as a value, path by path** — the half of the search a key-name sweep
 * cannot do.
 *
 * ⚠️ **Case-insensitive on purpose** (`case-sensitive-grep-became-a-false-capability-claim`): a
 * literal `mcp`-style sweep has already turned a true statement into a false capability claim in
 * this project, and `Memory`/`memoryDir`/`MEMORY.md` are three spellings of the thing being looked
 * for.
 */
function valueHits(value: unknown, path: string, needle: string, out: string[]): void {
  if (typeof value === 'string') {
    if (value.toLowerCase().includes(needle.toLowerCase())) {
      out.push(`${path} = ${JSON.stringify(value.slice(0, 160))}`)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) valueHits(entry, `${path}[]`, needle, out)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      valueHits(entry, path ? `${path}.${key}` : key, needle, out)
    }
  }
}

/** What the store holds right now: name → bytes. `null` when it cannot be listed at all. */
function storeNow(dir: string): Record<string, number> | null {
  try {
    const out: Record<string, number> = {}
    for (const name of readdirSync(dir)) {
      try {
        out[name] = statSync(join(dir, name)).size
      } catch {
        out[name] = -1
      }
    }
    return out
  } catch {
    return null
  }
}

it('330 · what the Claude wire says about a memory WRITE, field by field', async () => {
  const token = claudeKeychainTokenProvider()()
  expect(token, 'no personal Claude login on this machine').toBeTruthy()

  const root = join(tmpdir(), `brobot2-330-memwrite-${process.pid}`)
  const cwd = join(root, 'work')
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const home = join(managedRoot, `claude-330-${process.pid}-${Date.now()}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  await provisionProviderHome(managedRoot, home)
  const memoryDir = claudeAutoMemoryDir(home)

  // ⚠️ **A mundane working convention, not anything credential-shaped** (165's lesson: haiku refuses
  // to "remember" a secret, which is the model being right and the probe being wrong).
  const stamp = `${process.pid.toString(36)}${Date.now().toString(36)}`.toUpperCase()
  const token330 = `BROBOT-330-${stamp}`
  const WRITE_TURN = `remember: our release notes always carry the tag ${token330}`
  /**
   * ⛔ **The CONTROL, and it is what makes `memdirStamped` a finding rather than a coincidence**
   * (`measure-the-incumbent-at-the-same-moment`). An ordinary `Write` in the same session, the same
   * turn shape, the same tool — differing in ONE thing, where it lands. A flag that appears on both
   * says nothing about memory; a flag that appears on neither means the first arm was luck.
   */
  const CONTROL_TURN = `create a file at ${join(cwd, 'ordinary.md')} whose only line is "not a memory"`
  const RECALL_TURN = 'what tag do our release notes always carry?'
  const TURNS = [WRITE_TURN, CONTROL_TURN, RECALL_TURN]

  const frames: Frame[] = []
  let turn = 0
  // ⛔ Typed through a holder rather than a bare `let`: TS narrows the assignment inside the
  // generator to `never` at the call site below, and a non-null assertion there would be hiding a
  // real ordering question (the resolver does not exist until the generator has been pulled once).
  const gate: { open: (() => void) | null } = { open: null }
  const started = Date.now()

  const prompts = (async function* (): AsyncGenerator<SDKUserMessage> {
    for (const [index, content] of TURNS.entries()) {
      if (index > 0) {
        await new Promise<void>((resolve) => {
          gate.open = resolve
        })
      }
      yield {
        type: 'user',
        session_id: '',
        parent_tool_use_id: null,
        message: { role: 'user', content },
      } as unknown as SDKUserMessage
    }
    await new Promise<void>(() => {})
  })()

  /**
   * ⛔ **The same answer the app's PreToolUse hook gives, restated because that hook is private.**
   *
   * `claude-runtime.ts` allows a file tool whose every absolute path is inside the memory directory
   * and cards everything else. A card is a person clicking allow, which a probe cannot do — so the
   * `ls` this CLI opens with is allowed by the same containment test rather than by name, and
   * anything reaching outside is refused. ⚠️ The point is to let the WRITE happen so the wire has
   * something to carry; it is not to model the hook's fail-closed edges, which `153` already tests.
   */
  const canUseTool: Options['canUseTool'] = (name, input) => {
    const text = JSON.stringify(input ?? {})
    const paths = (text.match(/"\/(?!$)[^"]*"/g) ?? []).map((p) => p.slice(1, -1))
    // ⚠️ **The control's own directory is allowed too, and that is the point of the control**: the
    // arms have to differ in WHERE the write lands and in nothing else, so the gate cannot be the
    // thing that distinguishes them.
    const strays = paths.filter((p) => !p.startsWith(memoryDir) && !p.startsWith(cwd))
    if (paths.length > 0 && strays.length === 0) {
      return Promise.resolve({ behavior: 'allow' as const, updatedInput: input })
    }
    return Promise.resolve({
      behavior: 'deny' as const,
      message: `330 probe: only this session's memory directory and cwd may be touched (${name})`,
    })
  }

  const options: Options = {
    cwd,
    model: CHEAP_CLAUDE,
    // ⛔ **Both halves, because 165 measured that either alone gives NO memory at all.**
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settings: { autoMemoryDirectory: memoryDir },
    settingSources: [],
    strictMcpConfig: true,
    canUseTool,
    env: buildChildEnv({
      CLAUDE_CONFIG_DIR: home,
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_OAUTH_TOKEN: token as string,
    }),
  }

  const before = storeNow(memoryDir)
  let afterWrite: Record<string, number> | null = null
  let tools: readonly string[] = []
  const q = query({ prompt: prompts, options })
  const stream = (q as AsyncIterable<SDKMessage>)[Symbol.asyncIterator]()
  const deadline = (ms: number): Promise<'quiet'> =>
    new Promise((resolve) => setTimeout(() => resolve('quiet'), ms).unref())
  try {
    for (;;) {
      const next = await Promise.race([stream.next(), deadline(TURN_BUDGET_MS)])
      if (next === 'quiet' || next.done) break
      const message = next.value
      const subtype = (message as { subtype?: unknown }).subtype
      frames.push({
        atMs: Date.now() - started,
        turn,
        type: message.type,
        ...(typeof subtype === 'string' ? { subtype } : {}),
        raw: message,
      })
      if (message.type === 'system' && message.subtype === 'init') tools = [...message.tools]
      if (message.type === 'result') {
        // ⚠️ **Listed HERE, between the turns**, so the store's growth is attributed to the turn
        // that caused it rather than to the session.
        if (turn === 0) afterWrite = storeNow(memoryDir)
        if (turn >= TURNS.length - 1) break
        turn += 1
        gate.open?.()
      }
    }
  } finally {
    try {
      q.close()
    } catch {
      /* a probe that cannot close cleanly is still a probe */
    }
  }

  const after = storeNow(memoryDir)

  // ── the inventory ────────────────────────────────────────────────────────────────────────────
  const inventory = new Map<string, FieldFact>()
  for (const frame of frames) fieldInventory(frame.raw, '', inventory)
  const paths = [...inventory.keys()].sort()
  const memoryish = paths.filter((p) => /mem/i.test(p.split('.').slice(-1)[0] ?? ''))
  const dirHits: string[] = []
  const tokenHits: string[] = []
  for (const frame of frames) {
    valueHits(
      frame.raw,
      `${frame.type}${frame.subtype ? `/${frame.subtype}` : ''}`,
      memoryDir,
      dirHits,
    )
    valueHits(
      frame.raw,
      `${frame.type}${frame.subtype ? `/${frame.subtype}` : ''}`,
      token330,
      tokenHits,
    )
  }

  // ── what BroBot makes of it, through the COMMITTED normalizer ─────────────────────────────────
  const rows: { turn: number; event: RuntimeEvent }[] = []
  for (const frame of frames) {
    for (const event of normalizeMessage(frame.raw)) rows.push({ turn: frame.turn, event })
  }

  // ── ⛔ the two signals §2 went looking for, per CALL, with the control beside them ────────────
  const stamped: string[] = []
  for (const frame of frames) {
    const raw = frame.raw as unknown as Record<string, unknown>
    if (frame.type === 'system' && frame.subtype === 'init') {
      const paths = raw['memory_paths']
      stamped.push(`  t${frame.turn} system/init.memory_paths = ${JSON.stringify(paths)}`)
      stamped.push(`     …realpath-equal to what we sent? ${String(paths)}`)
    }
    if (frame.type !== 'user') continue
    const result = raw['tool_use_result']
    if (result === null || typeof result !== 'object') continue
    const row = result as Record<string, unknown>
    stamped.push(
      `  t${frame.turn} tool_use_result · filePath=${JSON.stringify(row['filePath'])}` +
        ` · memdirStamped=${JSON.stringify(row['memdirStamped'])}` +
        ` · type=${JSON.stringify(row['type'])}`,
    )
  }

  // ⛔ **Kept, so every claim in the response doc can be re-checked without a second live run.**
  const archive = process.env['BROBOT_330_ARCHIVE']
  if (archive) {
    writeFileSync(archive, frames.map((f) => JSON.stringify(f)).join('\n') + '\n')
  }

  const report: string[] = [
    '',
    '══ 330 §2 · the Claude memory WRITE, on the wire ══',
    `memory directory sent : ${memoryDir}`,
    `store before          : ${JSON.stringify(before)}`,
    `store after the write : ${JSON.stringify(afterWrite)}`,
    `store at the end      : ${JSON.stringify(after)}`,
    `frames                : ${frames.length}`,
    `message types         : ${[...new Set(frames.map((f) => f.type))].sort().join(', ')}`,
    `system subtypes       : ${[...new Set(frames.filter((f) => f.type === 'system').map((f) => f.subtype ?? '?'))].sort().join(', ')}`,
    `tools at init         : ${tools.join(', ')}`,
    '',
    `── field inventory: ${paths.length} distinct key paths ──`,
    ...paths.map((p) => {
      const fact = inventory.get(p)
      return `  ${p}  ×${fact?.count}  [${[...(fact?.types ?? [])].join('|')}]${fact?.sample ? `  e.g. ${fact.sample}` : ''}`
    }),
    '',
    `── key paths whose LEAF NAME matches /mem/i: ${memoryish.length} ──`,
    ...(memoryish.length ? memoryish.map((p) => `  ${p}`) : ['  (none)']),
    '',
    `── the directory we SENT, echoed back as a value: ${dirHits.length} ──`,
    ...(dirHits.length ? dirHits.map((h) => `  ${h}`) : ['  (none)']),
    '',
    `── the remembered token quoted as a value: ${tokenHits.length} ──`,
    ...(tokenHits.length ? tokenHits.map((h) => `  ${h}`) : ['  (none)']),
    '',
    `── 🔴 the two memory signals, per call (turn 1 is the CONTROL: a write OUTSIDE the store) ──`,
    ...stamped,
    '',
    '── what BroBot renders, through the committed normalizer ──',
    ...rows.map(
      ({ turn: t, event }) =>
        `  t${t} ${event.type}${
          event.type === 'tool_call' ? ` · ${event.name} · ${event.summary}` : ''
        }${event.type === 'assistant_message' ? ` · ${event.text.slice(0, 90)}` : ''}${
          event.type === 'file_change' ? ` · ${JSON.stringify(event).slice(0, 160)}` : ''
        }`,
    ),
    '',
  ]
  console.log(report.join('\n'))

  // ⛔ **The write must really have happened**, or the negative above is about nothing.
  const appeared = Object.keys(afterWrite ?? {}).filter((n) => !(n in (before ?? {})))
  expect(
    appeared.length,
    'the remember turn wrote nothing — this measures nothing',
  ).toBeGreaterThan(0)
  // ⚠️ **And the search must really have been wide.** A broken walker returns few paths and a
  // vacuous negative; this is the floor that makes the enumeration checkable.
  expect(paths.length, 'the field walk found almost nothing — suspect the walker').toBeGreaterThan(
    50,
  )

  // ⚠️ **The child outlives `q.close()` by a beat and can re-create `<home>/projects/`** — measured
  // on both runs of this probe: the home comes back holding a session-transcript directory and
  // nothing else (no `memory/`, no settings, no credential). ⛔ Not retried in a loop, because a
  // race this removal can still lose is worse than a documented residue in a temp directory the OS
  // reaps: what matters is that the STORE is gone, and it is.
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}, 600_000)
