import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { claudeAutoMemoryIndex } from '@brobot2/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InjectedInstruction, SessionInstructions } from '../src/shared/runtime-ipc'
import { readSessionInstructions } from '../src/main/runtime/instructions'

/**
 * 🔴 **What we append says WHEN it was read** (599 · `HO-084` §3, narrowed by `HO-087` §1).
 *
 * > ⚑ **The ruling:** *"Whatever BroBot itself appends says WHEN it was read, and is RE-READ on
 * > resume rather than replayed."*
 *
 * ## ⛔ The second half was already true, and this file does not re-prove it
 *
 * ⚑ **`readSessionInstructions` runs on every start AND every resume** — `158` §2's live-profile
 * semantic, stated in its own docblock, wired at `RuntimeHost.resumeSession` (*"Re-READ here, not
 * replayed from the row"*), and **measured** by `session-profile.test.ts` — *"picks up an edit made
 * between the two launches — a profile is edited, not snapshotted"*, which writes a file between
 * two launches and reads the new bytes back off the second. ⛔ Nothing here changes that path.
 *
 * ## ⚠️ What was missing is the NUMBER, and what it is a number OF
 *
 * ⛔ **The re-read has a documented cost:** *"a file changed mid-conversation does not take effect
 * until the next launch."* 🔴 **It was invisible.** A person who edits an instruction file while a
 * conversation runs has no way to see that the conversation is still on the older text, and
 * `TOLD_IS_THE_LAST_LAUNCH` — *"from the files as they were then"* — could not say when *then* was.
 *
 * ## 🔴 Three claims, and each section is one of them
 *
 * | § | the claim | what a wrong stamp does to it |
 * |---|---|---|
 * | **1** | ⚑ **every row this app APPENDED carries the moment, and no row the PROVIDER loaded does** | a field that goes quietly absent, or one that dates our display read as the provider's |
 * | **2** | ⛔ **the number is a time of OUR READ, never of the FILE, and it is taken at the ASK** | `mtime` / `atime` — the file's own clocks — or a stamp that slid below the call it is about |
 * | **3** | 🔴 **it is on the RECORD, not in the PROMPT** | provenance bytes charged to `INSTRUCTION_TOTAL_CAP`, and an appended text that differs on every launch of an unchanged tree |
 *
 * ⚠️ **Every section carries its own control**, because the reader would answer most of these the
 * same way whether or not it had been changed at all.
 */

let root: string
let home: string
let cwd: string
let providerHome: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-599-'))
  // ⚑ A home that is NOT an ancestor of the cwd, so the walk's boundary is exercised deliberately
  // rather than by whatever this machine's real layout happens to be — `instructions.test.ts`'s
  // own fixture, for its own reason.
  home = join(root, 'home')
  cwd = join(root, 'work', 'repo', 'child')
  providerHome = join(root, 'provider-homes', 'default', 'default', 'claude')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  mkdirSync(providerHome, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const write = (path: string, text: string): string => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return path
}

/** One Claude launch against the tree on disk — the panel's half of the read. */
const launch = (
  over: Partial<Parameters<typeof readSessionInstructions>[0]> = {},
): SessionInstructions =>
  readSessionInstructions({ provider: 'claude', cwd, providerHome, home, ...over }).instructions

const rowAt = (read: SessionInstructions, path: string): InjectedInstruction => {
  const found = read.injected.find((item) => item.path === path)
  // ⛔ A missing row would make every assertion about it vacuous, so it is a failure here rather
  // than an `undefined` flowing into a `?.` downstream.
  expect(found, `nothing was appended from ${path}`).toBeDefined()
  return found as InjectedInstruction
}

/**
 * ⚠️ **Spin until this machine's clock MOVES** — not a sleep, and not a duration.
 *
 * ⛔ **Rule 22's shape avoided on purpose:** a bound in milliseconds would be a claim about the
 * machine. The only fact §3 needs is that `Date.now()` returns something larger than it did, which
 * is a property of the clock and of nothing else. ⚑ Bounded by ITERATIONS so a frozen clock is a
 * red rather than a hang, and the assertion after the loop is what makes it one.
 */
const afterTheClockMoves = (): void => {
  const was = Date.now()
  for (let spins = 0; Date.now() === was && spins < 10_000_000; spins += 1) {
    /* spin */
  }
  expect(Date.now(), 'this machine’s clock did not move').toBeGreaterThan(was)
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 · The rows this app appended carry it. The rows the provider loaded do not.
// ─────────────────────────────────────────────────────────────────────────────

describe('599 §1 · a read time on what BroBot appended, and on nothing else', () => {
  it('🔴 every appended row on a four-kind chain says when — and the memory store says nothing', () => {
    // ⛔ **Four kinds, not one**, because `readAt` is attached in ONE place and a single-row
    // fixture could not tell *"the reader stamps"* from *"the reader stamps this kind"*.
    const bundlePath = write(join(providerHome, 'brobot-instructions.md'), '# Compiled\n\nrules\n')
    write(join(providerHome, 'CLAUDE.md'), '# Profile\n\nwho this agent is\n')
    // ⚠️ **In the cwd itself, because a scratch tree has no `.git`** — `codexConventionChain` walks
    // up to the nearest repository root and, finding none, is the cwd alone.
    write(join(cwd, 'AGENTS.md'), '# Conventions\n\nshared with both engines\n')
    write(join(cwd, 'CLAUDE.md'), '# Project\n\nwhat applies in this worktree\n')
    // ⚑ The agent's own store, which the PROVIDER loads and this app only displays.
    write(claudeAutoMemoryIndex(providerHome), '# Memory Index\n\n- BROBOT-599-STORE\n')

    const read = launch({ bundle: { ok: true, path: bundlePath, bytes: 20 } })

    // ⚠️ **Non-vacuity first.** `every` over an empty list is `true`, so the filter below would be
    // green against a reader that appended nothing at all.
    expect(read.injected.map((item) => item.kind)).toEqual([
      'profile-instructions',
      'profile-memory',
      'repository-conventions',
      'project-memory',
    ])
    const unstamped = read.injected.filter((item) => typeof item.readAt !== 'number')
    expect(
      unstamped.map((item) => item.path),
      'an appended row with no read time',
    ).toEqual([])

    // 🔴 **The other half, and it is the asymmetry rather than an oversight.** These files the
    // provider read, at a moment of its own choosing, before any BroBot code ran — see
    // `InjectedInstruction.readAt`. ⛔ A stamp here would date OUR display read and be read as
    // theirs, which is `086`'s provenance rule broken by a number.
    expect(read.agentMemory.length, 'the store fixture did not reach the panel').toBeGreaterThan(0)
    const stamped = read.agentMemory.filter((item) => item.readAt !== undefined)
    expect(
      stamped.map((item) => item.path),
      'a provider-loaded row carries our read time',
    ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2 · The number is a time of OUR READ. It is never a time of the FILE.
// ─────────────────────────────────────────────────────────────────────────────

/** ⚑ Long before any run of this suite. */
const ANCIENT = new Date('2001-02-03T04:05:06.000Z')
/** ⚑ Long after one — the control pointing the OTHER way, which a file clock cannot survive. */
const FUTURE = new Date('2099-12-31T23:59:58.000Z')

describe('599 §2 · when we read it, not when it changed', () => {
  it('⛔ a file stamped in 2001 and one stamped in 2099 are both read NOW', () => {
    const ancient = write(join(providerHome, 'CLAUDE.md'), '# Profile\n\nuntouched since 2001\n')
    const future = write(join(cwd, 'CLAUDE.md'), '# Project\n\nstamped in 2099\n')
    // ⛔ **Both file clocks moved, not only `mtime`.** `atime` is the other one that literally
    // means *"when this file was read"*, so it is the other thing a future hand could reach for.
    utimesSync(ancient, ANCIENT, ANCIENT)
    utimesSync(future, FUTURE, FUTURE)

    // ⚑ **The fixture proves its own premise.** A plant that did not land would make everything
    // below true of a reader doing exactly the wrong thing.
    expect(statSync(ancient).mtimeMs).toBe(ANCIENT.getTime())
    expect(statSync(ancient).atimeMs).toBe(ANCIENT.getTime())
    expect(statSync(future).mtimeMs).toBe(FUTURE.getTime())
    expect(FUTURE.getTime() - ANCIENT.getTime()).toBeGreaterThan(90 * 365 * 24 * 3600 * 1000)

    const before = Date.now()
    const read = launch()
    const after = Date.now()

    // ⚠️ **The window is what the two planted clocks sit outside of, in opposite directions** — so
    // a reader answering a file clock fails on the 2001 file in one direction and on the 2099 file
    // in the other. That is why both are planted rather than one.
    expect(ANCIENT.getTime()).toBeLessThan(before)
    expect(FUTURE.getTime()).toBeGreaterThan(after)

    for (const item of read.injected) {
      expect(item.readAt, `${item.path} was not stamped`).toBeDefined()
      expect(item.readAt as number).toBeGreaterThanOrEqual(before)
      expect(item.readAt as number).toBeLessThanOrEqual(after)
    }

    expect(rowAt(read, ancient).readAt).not.toBe(ANCIENT.getTime())
    expect(rowAt(read, future).readAt).not.toBe(FUTURE.getTime())
    // ⚑ **And the two rows agree with EACH OTHER** — one launch, one window — while the files they
    // came from disagree by ninety-eight years. That is *when we read it* against *when it
    // changed*, in one read.
    const apart = Math.abs(
      (rowAt(read, future).readAt as number) - (rowAt(read, ancient).readAt as number),
    )
    expect(apart).toBeLessThanOrEqual(after - before)
  })

  it('🔴 the clock is read ABOVE the call it is about, and a stamp below it is caught', () => {
    // ⛔ **The half a fixture cannot reach.** `mtime` above is *the wrong clock*; this is *the
    // wrong instant*, and the two ends of one read are indistinguishable from outside unless the
    // test owns a wall-clock bound — which would be a claim about the machine (rule 22).
    //
    // ⚑ **What it is worth:** the true read happens somewhere in `[ask, answer]`. Stamping at the
    // ask can only make an edge edit look LATER than the read — *your change is not in this
    // conversation* — while stamping at the answer would make an edit that landed mid-read look
    // EARLIER than it, about text the model never got. The early stamp errs toward relaunching.
    const stampedAbove = (source: string): boolean => {
      // ⛔ **Prose is stripped before anything is asserted.** The comment this very line sits under
      // names both symbols, and a raw-file compare would read a docblock as code
      // (`a-source-census-must-strip-prose-before-it-asserts`).
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      const opens = code.indexOf('const take')
      const reads = code.indexOf('readInstructionFile(', opens)
      expect(opens, 'the reader no longer has a `take`').toBeGreaterThanOrEqual(0)
      expect(reads, '`take` no longer calls the guarded reader').toBeGreaterThan(opens)
      return code.slice(opens, reads).includes('Date.now()')
    }

    const here = dirname(fileURLToPath(import.meta.url))
    const reader = readFileSync(join(here, '../src/main/providers/claude/instructions.ts'), 'utf8')
    expect(stampedAbove(reader), 'the stamp is not taken above the read').toBe(true)

    // ⚠️ **The control, through the SAME derivation** — a planted `take` whose clock sits below the
    // call must come back false, or the predicate above proves nothing about where the stamp is.
    const below = [
      'const take = (path: string): void => {',
      '  const read = readInstructionFile(path, CAP)',
      '  const readAt = Date.now()',
      '  push({ path, readAt })',
      '}',
    ].join('\n')
    expect(stampedAbove(below), 'the control passed, so the predicate measures nothing').toBe(false)
    // ⚑ …and the SAME planted source with only the two lines swapped comes back true, so the
    // `false` above is about the ORDERING and not about planted source being unreadable.
    const above = [
      'const take = (path: string): void => {',
      '  const readAt = Date.now()',
      '  const read = readInstructionFile(path, CAP)',
      '  push({ path, readAt })',
      '}',
    ].join('\n')
    expect(stampedAbove(above)).toBe(true)
    // ⛔ **And a stamp that is only PROSE does not count**, which is what the strip is for — a
    // raw-file compare would read this planted comment as the clock being taken above the call.
    expect(
      stampedAbove(above.replace('  const readAt = Date.now()', '  // Date.now() used to be here')),
    ).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 · On the record, not in the prompt — the audience decision, as a rail
// ─────────────────────────────────────────────────────────────────────────────

describe('599 §3 · the stamp moves between two reads and the appended text does not', () => {
  it('🔴 two reads of one unchanged tree: the same composed bytes, a later readAt', () => {
    write(join(providerHome, 'CLAUDE.md'), '# Profile\n\nwho this agent is\n')
    write(join(cwd, 'CLAUDE.md'), '# Project\n\nwhat applies here\n')

    const first = launch()
    afterTheClockMoves()
    const second = launch()

    // ⚑ **The control: there IS a prompt to compare.** Two `null`s are equal and would prove
    // nothing at all about where the stamp went.
    expect(first.composed).toContain('Contents of ')
    expect(first.injected.length).toBeGreaterThan(1)

    // 🔴 **The rejected audience, as an assertion.** `composed` is a function of the files' paths,
    // kinds and bytes and of NO CLOCK, and must stay one: a stamp in `blockHeader` would spend
    // per-file bytes out of `INSTRUCTION_TOTAL_CAP` on provenance no rail reads — 27 B each,
    // measured — and would make the text this app appends differ on every launch of a tree nobody
    // touched.
    expect(second.composed).toBe(first.composed)

    // ⚑ …and the record DID move, which is the half `composed` must not carry.
    expect(second.injected).toHaveLength(first.injected.length)
    for (const [index, item] of second.injected.entries()) {
      const was = first.injected[index] as InjectedInstruction
      expect(item.path).toBe(was.path)
      expect(item.readAt as number).toBeGreaterThan(was.readAt as number)
    }
  })

  it('⛔ no appended byte spells the moment, in any of the shapes it could be spelled in', () => {
    write(join(providerHome, 'CLAUDE.md'), '# Profile\n\nwho this agent is\n')
    const read = launch()
    const at = rowAt(read, join(providerHome, 'CLAUDE.md')).readAt as number
    const spellings = [String(at), new Date(at).toISOString(), String(Math.floor(at / 1000))]

    // ⚠️ **The sweep is made to find one first** (rule 34.2): a `not.toContain` over a corpus where
    // no hit could ever be found is a broken search wearing a passing test's clothes.
    for (const spelling of spellings) {
      expect(`${read.composed}\n(read ${spelling})`).toContain(spelling)
      expect(read.composed ?? '').not.toContain(spelling)
    }
  })
})
