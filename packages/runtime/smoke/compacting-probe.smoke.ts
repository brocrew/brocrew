import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'

/**
 * 097 · **Does Claude really tell us it is compacting, and does our adapter say so?**
 *
 * 087 §3 concluded that `compaction_delta` is Claude compacting *right now, streaming* — the signal
 * 081's `compacting` avatar had been waiting for since 027. 097 wired it. None of that was
 * measured.
 *
 * ⚠️ **And the app's own corpus cannot testify either way.** `raw_frame` holds 454,383 Claude
 * frames and every one of them is `claude-jsonl` — the provider's own TRANSCRIPT FILE, which
 * contains no `stream_event` frames at all (0 of 458,200). `compaction_delta` lives only inside
 * `stream_event`. So its absence there is a property of the FORMAT, not of the provider: exactly
 * the *"absence in a capture is not absence"* trap, in the direction opposite to 096's.
 *
 * What the corpus DOES prove is that Claude compactions are real and common: **210** transcript
 * `compact_boundary` records, one of them with `preTokens: 1,000,428`. Which is also why this is
 * hard to provoke — a compaction normally costs a whole context window.
 *
 * ## How this gets one cheaply
 *
 * The pinned SDK's settings carry `autoCompactWindow`, from 100,000 to 1,000,000. Written
 * into a TEMP provisioned home's `settings.json`, it pulls the auto-compact threshold down to the
 * smallest value the SDK will accept, so a few large turns cross it instead of a day's work.
 *
 * ⚠️ **100,000 tokens is the FLOOR the SDK accepts**, not a number chosen for comfort. So this
 * probe is genuinely expensive by the standards of this suite, and it is a probe rather than a
 * smoke for that reason.
 *
 * 🔒 Temp home only. Never `~/.claude`.
 *
 * Run: `pnpm run probe:compacting`. Not part of `pnpm run ci`.
 *
 * It REPORTS what arrived and asserts only what it can honestly claim. A run where Claude simply
 * did not compact is reported as such — it measures nothing, and saying so is the point.
 */

const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'
/** The SDK's own floor for `Settings.autoCompactWindow`: an integer of at least 100,000. */
const AUTO_COMPACT_WINDOW = 100_000

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

it('does Claude stream a compaction, and do we raise the phase — probe', async () => {
  const scratch = join(tmpdir(), `brobot2-compacting-probe-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-compacting-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  // The knob, in the isolated home the adapter pins `CLAUDE_CONFIG_DIR` to.
  writeFileSync(
    join(providerHome, 'settings.json'),
    JSON.stringify({ autoCompactEnabled: true, autoCompactWindow: AUTO_COMPACT_WINDOW }, null, 2),
  )

  const runtime = new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider())
  const handle = await runtime.start({ cwd: scratch, providerHome, model: CHEAP_CLAUDE })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  try {
    // Filler the model must read but need not think about. ~28k tokens a turn at ~4 chars/token,
    // so four turns comfortably crosses a 100k window. Deliberately boring: the probe is about the
    // context filling up, and an interesting prompt would spend the budget on the answer.
    const filler = (n: number): string =>
      Array.from(
        { length: 1400 },
        (_, i) =>
          `line ${n}.${i}: the quick brown fox jumps over the lazy dog, repeatedly and at length.`,
      ).join('\n')

    let compactions = 0
    for (let turn = 1; turn <= 6; turn += 1) {
      const before = events.filter((e) => e.type === 'turn').length
      await handle.send(
        `Here is block ${turn} of a long log. Reply with exactly the word OK and nothing else.\n\n${filler(turn)}`,
      )
      await waitFor(
        () => events.filter((e) => e.type === 'turn').length > before,
        600_000,
        `turn ${turn} to end`,
      )
      compactions = events.filter((e) => e.type === 'compaction').length
      const phases = events.filter((e) => e.type === 'activity' && e.phase === 'compacting').length
      const reading = events.filter(
        (e): e is Extract<RuntimeEvent, { type: 'context_reading' }> =>
          e.type === 'context_reading',
      )
      const used = reading[reading.length - 1]?.reading.used ?? 0
      console.log(
        `turn ${turn}: ~${used} tokens in context · ${compactions} boundary · ${phases} compacting phase(s)`,
      )
      if (phases > 0) break
    }

    const phases = events.filter((e) => e.type === 'activity' && e.phase === 'compacting')
    const boundaries = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'compaction' }> => e.type === 'compaction',
    )
    const deltaFrames = events.filter(
      (e) => e.type === 'unknown' && e.label === 'compaction_delta',
    ).length

    console.log('\n=== what this run measured ===')
    console.log(`autoCompactWindow asked for: ${AUTO_COMPACT_WINDOW}`)
    console.log(`activity{phase:'compacting'} events: ${phases.length}`)
    console.log(`classified compaction_delta frames: ${deltaFrames}`)
    console.log(`compaction boundaries: ${boundaries.length}`)
    for (const boundary of boundaries) {
      console.log(
        `  boundary: before=${boundary.before ?? '—'} after=${boundary.after ?? '—'} trigger=${boundary.trigger ?? '—'}`,
      )
    }
    const byType = new Map<string, number>()
    for (const event of events) byType.set(event.type, (byType.get(event.type) ?? 0) + 1)
    console.log('\n=== every event type this run produced ===')
    for (const [type, count] of [...byType].sort((a, b) => b[1] - a[1]))
      console.log(`${String(count).padStart(5)} × ${type}`)

    // ⚠️ **The half the first run of this probe was missing.** It measured "no compaction_delta"
    // and could not say what DID arrive while the provider was compacting — which is the question
    // that decides whether the phase has a signal at all.
    const byLabel = new Map<string, number>()
    for (const event of events) {
      if (event.type !== 'unknown') continue
      const label = event.label ?? '(none)'
      byLabel.set(label, (byLabel.get(label) ?? 0) + 1)
    }
    console.log('\n=== every classified frame this run produced ===')
    for (const [label, count] of [...byLabel].sort((a, b) => b[1] - a[1]))
      console.log(`${String(count).padStart(5)} × ${label}`)
    console.log('\n=== every activity phase, in order ===')
    console.log(
      events
        .filter((e) => e.type === 'activity')
        .map((e) => (e.type === 'activity' ? e.phase : ''))
        .join(' → ') || '(none)',
    )
    console.log('\n=== every frame whose payload mentions "compact" ===')
    let mentions = 0
    for (const event of events) {
      if (event.type !== 'unknown') continue
      const json = JSON.stringify(event.raw)
      if (!/compact/i.test(json)) continue
      mentions += 1
      if (mentions <= 12) console.log(`  ${event.label}: ${json.slice(0, 400)}`)
    }
    console.log(`  (${mentions} frame(s) mention compact)`)

    // ⚠️ **A run that did not compact is a FAILED probe, not a passing one** (097 review, finding
    // 11). The first version of this file printed a warning and `return`ed — which put every
    // assertion below an early exit, so a run whose filler never crossed the window executed zero
    // `expect()` calls and vitest reported it green. That is the shape of thing this project has
    // now found twenty-odd times, and writing one into a file whose whole purpose is to measure
    // honestly would be the worst place for it. A probe that measured nothing says so in red.
    expect(
      boundaries.length,
      `no compaction this run — ${events.filter((e) => e.type === 'turn').length} turn(s) did not ` +
        `fill the window, so nothing here testifies about the provider either way. Raise the filler ` +
        `or the turn count and run it again; do not read this run as evidence.`,
    ).toBeGreaterThan(0)

    console.log(
      `\n✅ A REAL COMPACTION HAPPENED: ${boundaries.length} boundary event(s), and the adapter ` +
        `raised the compacting phase ${phases.length} time(s).`,
    )
    // The measurement that corrected 087, kept as a standing check rather than a one-off note.
    if (deltaFrames === 0) {
      console.log(
        `\n📌 …and NOT ONE compaction_delta frame arrived while it did. 087 named that frame as this ` +
          `phase's signal. The real signal is the system/status pair above.`,
      )
    } else {
      console.log(
        `\n⚠️ compaction_delta DID arrive (${deltaFrames}×) — 087's reading applies after all on this ` +
          `path, and the second source in compactingActivity() is live rather than theoretical.`,
      )
    }

    // ── What the phase must be true of, on a run that really compacted ────────
    expect(
      phases.length,
      'a real compaction happened and the adapter raised no compacting phase at all — ' +
        'the signal has moved again, and 081’s avatar is unreachable',
    ).toBeGreaterThan(0)
    // Nothing invented: the phase carries no payload beyond itself.
    for (const phase of phases) expect(phase).toEqual({ type: 'activity', phase: 'compacting' })
    // The durable record still carries the numbers — the phase did not replace it (086's ruling).
    expect(boundaries.some((b) => b.before !== undefined)).toBe(true)
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 3_600_000)
