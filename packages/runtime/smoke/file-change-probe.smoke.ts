import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  CodexRuntime,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type CodexIncoming,
  type CodexTransport,
  type RuntimeEvent,
  type SessionHandle,
  type TransportFactory,
} from '../src/index'
import { bundledCodexTransportFactory } from './bundled-codex'

/**
 * 096 · **What does a provider actually send when it changes a file?**
 *
 * 092 designed the Changes pane on `item/fileChange/patchUpdated` — *"the richest source we have and
 * we drop it"* — `FileUpdateChange = { path, kind, diff }`, per-file, renames included. That claim
 * came from the generated protocol types.
 *
 * ⚠️ **The app's own database says that notification has never arrived.** Across 458,200 recorded
 * wire frames and every `unknown` event ever normalized, `item/fileChange/patchUpdated` appears
 * **zero** times; `turn/diff/updated` appears eight. But *absence in a capture is not absence* — a
 * capture that never asked Codex to edit a file cannot testify about what Codex sends when it does.
 * (The same corpus holds two `apply_patch` tool calls in total.) So this probe **asks**, on the wire,
 * against the codex the app ships.
 *
 * Run: `pnpm run probe:file-change`. Not part of `pnpm run ci` — it spawns a real provider.
 *
 * It REPORTS every notification the turn produced and asserts only the facts the extractor in
 * `codex/normalize.ts` is built on. If Codex starts sending `patchUpdated`, the report says so and
 * the per-file extractor should move onto it; the assertions below are written so that becoming true
 * is *reported*, never a failure.
 */

type Seen = { label: string; count: number; keys: string[] }

/**
 * ⛔ **184 · every incoming method counted ON THE WIRE, before anything can drop one.**
 *
 * This probe used to answer *"did `item/fileChange/patchUpdated` arrive?"* from the normalized
 * `unknown` stream. 184 put that method behind the active-thread/turn gate, and a gated frame never
 * reaches the normalizer — so an OUT-OF-TURN arrival, which is precisely what the gate exists to
 * stop, would have been invisible to the one instrument whose job is to notice it.
 *
 * ⚠️ **An argument that seals its own evidence is 168's failure exactly** (*absence in a capture is
 * not absence*): the gate was justified by "it has never arrived", and the gate would then have been
 * what kept that true. Counting at the transport is two dozen lines and it decouples the two.
 */
function teeing(inner: TransportFactory, sink: Map<string, number>): TransportFactory {
  return (context) => {
    const transport = inner(context)
    return new Proxy(transport, {
      get(target, prop) {
        if (prop === 'incoming') {
          return (): AsyncIterable<CodexIncoming> => ({
            async *[Symbol.asyncIterator](): AsyncGenerator<CodexIncoming> {
              for await (const message of target.incoming()) {
                sink.set(message.method, (sink.get(message.method) ?? 0) + 1)
                yield message
              }
            },
          })
        }
        const value = Reflect.get(target, prop, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as CodexTransport
  }
}

function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** Every `unknown` label the run produced, with the key set of each payload's params. */
function labels(events: RuntimeEvent[]): Seen[] {
  const byLabel = new Map<string, Seen>()
  for (const event of events) {
    if (event.type !== 'unknown') continue
    const label = event.label ?? '(none)'
    const raw = event.raw as { params?: unknown } | undefined
    const params = raw && typeof raw === 'object' ? raw.params : undefined
    const keys = params && typeof params === 'object' ? Object.keys(params) : []
    const entry = byLabel.get(label) ?? { label, count: 0, keys: [] }
    entry.count += 1
    for (const key of keys) if (!entry.keys.includes(key)) entry.keys.push(key)
    byLabel.set(label, entry)
  }
  return [...byLabel.values()].sort((a, b) => b.count - a.count)
}

/**
 * The parsed reports, newest last.
 *
 * ⚠️ **This reads `file_change`, not the raw payload, and that is deliberate.** Before this task
 * `turn/diff/updated` landed as `unknown{lifecycle}` and the probe could read its `diff` string
 * directly. The adapter consumes it now, so the string is no longer on any event — the probe going
 * blind to it is itself the proof the promotion landed. What it measures instead is strictly more:
 * the whole chain, from Codex's bytes to the records the pane draws.
 */
function reports(events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'file_change' }>[] {
  return events.filter(
    (e): e is Extract<RuntimeEvent, { type: 'file_change' }> => e.type === 'file_change',
  )
}

it('what codex sends when it changes files — probe', async () => {
  const scratch = join(tmpdir(), `brobot2-file-change-probe-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  // A git repo, because `turn/diff/updated` is Codex's diff of the turn against the worktree — an
  // uninitialized directory is a different measurement than the one the product runs in.
  execFileSync('git', ['init', '-q'], { cwd: scratch })
  execFileSync('git', ['config', 'user.email', 'probe@example.invalid'], { cwd: scratch })
  execFileSync('git', ['config', 'user.name', 'probe'], { cwd: scratch })
  // Two committed files, so the run can MODIFY, RENAME and DELETE — not only add. Renames are the
  // one shape 092 named specifically (`move_path`), and a probe that only adds cannot see one.
  writeFileSync(join(scratch, 'keep.txt'), 'alpha\nbeta\ngamma\n')
  writeFileSync(join(scratch, 'doomed.txt'), 'delete me\n')
  writeFileSync(join(scratch, 'movable.txt'), 'move me\n')
  execFileSync('git', ['add', '-A'], { cwd: scratch })
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: scratch })

  // 022's isolated provisioned home — never the personal ~/.codex.
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `codex-probe-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)

  const onWire = new Map<string, number>()
  const runtime = new CodexRuntime(teeing(bundledCodexTransportFactory(), onWire), codexAuthHealth)
  // `auto` is the yolo mode: approvals dropped. The probe is about what the WIRE says while files
  // change, not about the approval gate — an unanswered card would just stall it.
  const handle = await runtime.start({ cwd: scratch, providerHome, approvalMode: 'auto' })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  try {
    // ⚠️ **The rename asks for a content change too, and that is not laziness.** A first run asked for
    // a content-preserving move and the agent reported back: *"the patch mechanism rejected a
    // content-preserving rename without a text hunk and made no changes."* A probe whose instruction
    // the tool refuses measures the instruction, not the wire.
    const ask = [
      'Do all four of these edits in this directory, then stop. Do not run any other command.',
      '1. Create a new file `added.txt` containing the single line `hello`.',
      '2. Edit `keep.txt` so the line `beta` reads `BETA` instead.',
      '3. Rename `movable.txt` to `moved.txt` AND change its line `move me` to `moved`.',
      '4. Delete `doomed.txt`.',
    ].join('\n')
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const before = events.filter((e) => e.type === 'turn').length
      await handle.send(attempt === 1 ? ask : `${ask}\n\n(The previous attempt changed nothing.)`)
      await waitFor(
        () => events.filter((e) => e.type === 'turn').length > before,
        600_000,
        'the edit turn to end',
      )
      if (events.some((e) => e.type === 'tool_call' && e.name === 'apply_patch')) break
      console.log(
        `\n(attempt ${attempt} produced no apply_patch — the model, not the wire; retrying)`,
      )
    }

    const seen = labels(events)
    const parsed = reports(events)
    const patchUpdated = seen.find((s) => s.label === 'item/fileChange/patchUpdated')
    const applyPatch = events.filter(
      (e) => e.type === 'tool_call' && e.name === 'apply_patch',
    ).length

    console.log('\n=== every event type this turn produced ===')
    const byType = new Map<string, number>()
    for (const event of events) byType.set(event.type, (byType.get(event.type) ?? 0) + 1)
    for (const [type, count] of [...byType].sort((a, b) => b[1] - a[1]))
      console.log(`${String(count).padStart(4)} × ${type}`)
    console.log('\n=== every tool the turn called ===')
    for (const event of events)
      if (event.type === 'tool_call') console.log(`  ${event.name} — ${event.summary}`)
    console.log('\n=== every unknown notification this turn produced ===')
    for (const entry of seen) console.log(`${String(entry.count).padStart(4)} × ${entry.label}`)
    console.log(`\napply_patch tool calls: ${applyPatch}`)
    console.log(`file_change reports: ${parsed.length}`)
    // What the agent SAID, so a turn that did nothing explains itself instead of just measuring zero.
    const said = events
      .filter((e) => e.type === 'assistant_message')
      .map((e) => (e.type === 'assistant_message' ? e.text : ''))
      .join('\n')
    console.log(`\n=== what the agent said ===\n${said.slice(0, 1200) || '(nothing)'}`)
    const errors = events.filter((e) => e.type === 'error')
    if (errors.length)
      console.log(`\n=== errors ===\n${JSON.stringify(errors, null, 1).slice(0, 800)}`)
    const ended = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'turn' }> => e.type === 'turn',
    )
    console.log(`\nterminal turn states: ${ended.map((e) => e.state).join(', ') || '(none)'}`)
    console.log('\n=== what actually happened on disk ===')
    console.log(
      execFileSync('git', ['status', '--porcelain=v1'], { cwd: scratch, encoding: 'utf8' }),
    )
    // The measurement is only about a turn that CHANGED something; a turn that refused measures nothing.
    expect(
      applyPatch,
      'the turn actually edited files — otherwise this measures nothing',
    ).toBeGreaterThan(0)

    // ⛔ **184 · the wire count, which is now the one that answers the question.** Every incoming
    // method, before the turn gate or the normalizer can drop one.
    console.log('\n=== every method that arrived ON THE WIRE (184) ===')
    for (const [method, count] of [...onWire].sort((a, b) => b[1] - a[1]))
      console.log(`${String(count).padStart(4)} × ${method}`)
    const patchUpdatedOnWire = onWire.get('item/fileChange/patchUpdated') ?? 0

    // ── The question 092 was designed on ──────────────────────────────────────
    if (patchUpdatedOnWire > 0) {
      console.log(
        `\n⚠️ item/fileChange/patchUpdated DID arrive (${patchUpdatedOnWire}× on the wire, ` +
          `${patchUpdated?.count ?? 0}× as an event${
            patchUpdated ? `, params keys: ${patchUpdated.keys.join(', ')}` : ''
          }). It carries FileUpdateChange{path,kind,diff} directly and needs no parsing — the ` +
          `per-file extractor should move onto it.`,
      )
      // ⚠️ The gap between the two counts is the interesting number, not a discrepancy: since 184
      // the method is turn-gated, so a frame counted here and NOT there arrived out of turn — which
      // is the case the gate exists for and the one the event stream can no longer show.
      if (patchUpdatedOnWire !== (patchUpdated?.count ?? 0)) {
        console.log(
          `   ⛔ ${patchUpdatedOnWire - (patchUpdated?.count ?? 0)} of them arrived OUT OF TURN ` +
            `(counted at the transport, dropped by the gate 184 added).`,
        )
      }
    } else {
      console.log(
        '\nitem/fileChange/patchUpdated did NOT arrive — zero ON THE WIRE, so this is a fact about ' +
          'the provider and not about our own gate. This run edited four files four ways and the ' +
          'notification 092 called "the richest source we have" was not sent once. The aggregated ' +
          'turn/diff/updated string is what we actually get.',
      )
    }

    // ── What we DO get, end to end: Codex's bytes → the records the pane draws ─
    const last = parsed[parsed.length - 1]
    console.log('\n=== the last report, as the pane would receive it ===')
    console.log(
      `reports this turn: ${parsed.map((r) => r.changes.length).join(' → ')} file(s) each`,
    )
    for (const change of last?.changes ?? [])
      console.log(
        `  ${change.status.padEnd(9)} ${change.path}` +
          `${change.oldPath ? ` (from ${change.oldPath})` : ''}` +
          `${change.added !== undefined ? `  +${change.added} −${change.removed}` : '  (no counts)'}` +
          `${change.diff !== undefined ? `  [${change.diff.length}B diff]` : '  [no body]'}`,
      )

    expect(
      parsed.length,
      'codex reported file changes for a turn that edited files',
    ).toBeGreaterThan(0)
    const changes = last!.changes
    expect(last!.source, 'and it came from the signal that actually arrives').toBe(
      'turn/diff/updated',
    )
    expect(
      changes.length,
      'the aggregate is split per file — 092 read it as one blob',
    ).toBeGreaterThanOrEqual(3)
    const statuses = new Set(changes.map((c) => c.status))
    console.log(`\nstatuses in the last report: ${[...statuses].join(', ')}`)
    expect(statuses.has('added'), "a new file is read as `added`, from git's own marker").toBe(true)
    expect(statuses.has('deleted'), 'a removed file is read as `deleted`').toBe(true)
    expect(
      changes.every((c) => c.diff === undefined || c.diff.includes('@@')),
      'every carried body is a real hunk, not a header fragment',
    ).toBe(true)

    // ⚠️ **The one shape a types-only reading gets wrong.** 092 and 096 both describe renames as
    // arriving *"via `move_path`"* — a field on `PatchChangeKind`, which belongs to the notification
    // that never comes. In the aggregate a rename is a `diff --git a/OLD b/NEW` header with two
    // different paths and no `rename from` line at all, which is what {@link parseUnifiedDiff} reads.
    const renamed = changes.filter((c) => c.status === 'renamed')
    if (renamed.length) {
      console.log(`renames: ${renamed.map((c) => `${c.oldPath} → ${c.path}`).join(', ')}`)
      expect(
        renamed.every((c) => c.oldPath && c.oldPath !== c.path),
        'a rename knows where it came from',
      ).toBe(true)
    } else {
      // ⚠️ **The else branch ASSERTS too, and review is why** (083's failure mode, one field over):
      // it used to only log, so a run where the model rewrote instead of moving executed zero
      // rename-related expects and still reported PASS. The model's choice is not the protocol's, so
      // the rename FORM cannot be asserted here — but the consequence can. A rewrite is a delete and
      // an add, which is also exactly what a parser that had STOPPED detecting renames would produce
      // for a move; asserting both halves means the move is accounted for either way.
      console.log(
        "the model rewrote rather than moved this run (delete + add) — the model's choice, not the " +
          "protocol's. `file-change.test.ts` covers the rename header itself, in both forms.",
      )
      expect(
        changes.some((c) => c.path === 'moved.txt'),
        'however the move was done, the new file is reported',
      ).toBe(true)
      expect(
        changes.some((c) => c.path === 'movable.txt' && c.status === 'deleted'),
        'and so is the disappearance of the old one',
      ).toBe(true)
    }
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
  }
}, 900_000)
