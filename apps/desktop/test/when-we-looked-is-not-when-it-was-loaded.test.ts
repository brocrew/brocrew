import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import type { MemoryLoadedEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **604 · the launch row says when THIS APP looked at the store.**
 *
 * ⛔ **`601` asked for this number and refused to guess it**, having measured that the only clock
 * the row could reach was `TranscriptItem.at` — stamped in `publishOurs` after `awaitLaunch`, a
 * provider spawn bounded by `DEFAULT_LAUNCH_TIMEOUT_MS`, and therefore up to fifteen seconds away
 * from the act it would have been labelled with. ⚑ **The ledger half of that separation is in
 * `memory-loaded-host.test.ts`**, which is where a real host and a real clock are; this file is
 * about the reader that takes the number.
 *
 * ## ⚠️ What each section is for
 *
 *  1. **It exists, and it is the ASK rather than the answer.** The discriminating test is §1.2:
 *     a store big enough that the look takes measurable time, so *"when we asked"* and *"when it
 *     answered"* are two different milliseconds and the stamp can be shown to be at one of them.
 *  2. **It is not a fact about the FILE.** An index stamped decades away in either direction does
 *     not move it — the confusion a time sitting beside a path invites.
 *  3. **The count and the clock come from ONE look** (604 §2.3). *"N sat beside it when this app
 *     looked"* is only checkable if both halves move together, which is what makes the phantom
 *     that started this chain — *"two entries"* over an empty directory — catchable at all.
 */

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Tree {
  home: string
  cwd: string
  providerHome: string
  store: string
}

/** A provider home with a Claude memory store in it, and nothing else this reader can find. */
function plant(index: string, topics: readonly string[]): Tree {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-604-'))
  roots.push(root)
  const home = join(root, 'home')
  const cwd = join(root, 'work')
  const providerHome = join(root, 'provider-home')
  const store = join(providerHome, 'memory')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  mkdirSync(store, { recursive: true })
  writeFileSync(join(store, 'MEMORY.md'), index)
  for (const name of topics) writeFileSync(join(store, name), `# ${name}\n`)
  return { home, cwd, providerHome, store }
}

/** What one launch's reader says about that store — never `null` in this file, and asserted so. */
function look(tree: Tree): MemoryLoadedEvent {
  const read = readSessionInstructions({
    provider: 'claude',
    cwd: tree.cwd,
    home: tree.home,
    providerHome: tree.providerHome,
  })
  const row = read.memoryLoaded
  expect(row, 'this fixture produced no launch row, so nothing below is being measured').not.toBe(
    null,
  )
  return row as MemoryLoadedEvent
}

/**
 * ⚠️ **Spin until `Date.now()` reports a different millisecond** (599's helper, same reason).
 * Two calls inside one tick give equal stamps and an ordering assertion over them measures nothing.
 */
function afterTheClockMoves(): void {
  const was = Date.now()
  for (let spins = 0; Date.now() === was && spins < 10_000_000; spins += 1) {
    /* spin — a timer would need a fake clock, and this file is about the real one */
  }
  expect(Date.now(), 'this machine’s clock did not move').toBeGreaterThan(was)
}

describe('604 §1 · the number is taken when this app ASKS', () => {
  it('⚑ every launch row carries one, inside the window the launch happened in', () => {
    const tree = plant('# index\n', ['a.md', 'b.md', 'c.md'])

    const before = Date.now()
    const row = look(tree)
    const after = Date.now()

    // Non-vacuity first: this really is the row with the store on it.
    expect(row.index).toBe(join(tree.store, 'MEMORY.md'))
    expect(row.beside).toBe(3)
    expect(typeof row.lookedAt).toBe('number')
    expect(row.lookedAt).toBeGreaterThanOrEqual(before)
    expect(row.lookedAt).toBeLessThanOrEqual(after)
  })

  /**
   * 🔴 **The discriminating one, and the only shape that can discriminate.**
   *
   * ⛔ **A stamp *somewhere inside the look* passes any assertion that only brackets the call.**
   * So the look is made to take real time — 21 files at the per-file cap, and a few thousand
   * directory entries to list — and the question becomes *which END of that span is it nearer*.
   *
   * ⚠️ **The span is asserted as a PREMISE, not as a bound on the code** (standing rule 22). A
   * machine fast enough to finish inside one tick fails here loudly, naming the fixture, rather
   * than passing over a comparison whose two sides had become the same number.
   */
  it('🔴 …and it is nearer the ASK than the answer, over a look that takes real time', () => {
    const CAP = 64 * 1024
    const body = 'x'.repeat(CAP)
    const heavy = Array.from({ length: 20 }, (_, i) => `t${String(i).padStart(3, '0')}.md`)
    const tree = plant(body, [])
    for (const name of heavy) writeFileSync(join(tree.store, name), body)
    for (let i = 0; i < 3_000; i += 1) {
      writeFileSync(join(tree.store, `z${String(i).padStart(5, '0')}.md`), 'x\n')
    }

    const before = Date.now()
    const row = look(tree)
    const after = Date.now()

    expect(
      after - before,
      'the look finished inside one clock tick — this fixture is too small to tell the ask from the answer',
    ).toBeGreaterThan(0)
    // ⚑ The two candidate stamps, as distances. An ask-stamp is ~0 from `before`; an answer-stamp
    // is ~0 from `after`. Naming neither constant keeps this a comparison rather than a bound.
    expect(row.lookedAt! - before).toBeLessThan(after - row.lookedAt!)
    // …and the row really did read the whole store, so the span above was the subject's work.
    expect(row.beside).toBe(3_020)
  })

  it('⛔ it is a time of OUR LOOK, and an index stamped decades away does not move it', () => {
    const ANCIENT = new Date('2001-02-03T04:05:06.000Z')
    const FUTURE = new Date('2099-12-31T23:59:58.000Z')
    const tree = plant('# index\n', ['a.md'])
    const index = join(tree.store, 'MEMORY.md')
    utimesSync(index, ANCIENT, ANCIENT)
    utimesSync(join(tree.store, 'a.md'), FUTURE, FUTURE)
    // The plant is asserted before the read: a filesystem that ignored `utimesSync` would make
    // every assertion below pass for the wrong reason.
    expect(statSync(index).mtimeMs).toBe(ANCIENT.getTime())
    expect(statSync(join(tree.store, 'a.md')).mtimeMs).toBe(FUTURE.getTime())

    const before = Date.now()
    const row = look(tree)
    const after = Date.now()

    expect(row.lookedAt).not.toBe(ANCIENT.getTime())
    expect(row.lookedAt).not.toBe(FUTURE.getTime())
    expect(row.lookedAt).toBeGreaterThanOrEqual(before)
    expect(row.lookedAt).toBeLessThanOrEqual(after)
  })
})

describe('604 §2 · the count and the clock come from one look', () => {
  it('⚑ a store that gains a memory between two launches moves BOTH, in step', () => {
    const tree = plant('# index\n', ['a.md'])

    const first = look(tree)
    afterTheClockMoves()
    writeFileSync(join(tree.store, 'b.md'), '# b\n')
    const second = look(tree)

    expect(first.beside).toBe(1)
    expect(second.beside).toBe(2)
    // ⛔ **The clock moved with it.** A number hoisted to a launch-level constant, cached across
    // reads, or copied from the first look would leave *"2 sat beside it when this app looked"*
    // dated by a look that saw one.
    expect(second.lookedAt!).toBeGreaterThan(first.lookedAt!)
  })
})
