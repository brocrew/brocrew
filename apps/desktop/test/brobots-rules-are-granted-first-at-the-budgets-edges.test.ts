import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  composeSystemHint,
  INSTRUCTION_FILE_CAP,
  INSTRUCTION_TOTAL_CAP,
  readSessionInstructions,
} from '../src/main/runtime/instructions'

/**
 * # b8414e4f · BroBot's own rules are granted first, and the budget at its edges
 *
 * ⚑ b8414e4f's own test (`what-this-agent-was-given.test.ts`, *"a repository that fills the
 * instruction budget gives way"*) kills the revert, and pins that the chain gives way nearest-last.
 * It does not reach three things, and each is pinned here on the pure reader, as
 * `instructions.test.ts` reads it:
 *
 *  - **§1 · BroBot's rules before the profile's own memory.** Both files are read under the 64 KiB
 *    file cap, so they only compete when this conversation's block leaves room for one of them —
 *    and no test reserved that much. Swapping the two grants in `allocate` survived every test.
 *  - **§2 · the exact 256 KiB edge.** No test lands a file's cost exactly on what is left of the
 *    budget: `fillToTheByte` keeps three bytes to spare by design. `cost > budget` turned
 *    `cost >= budget` survived.
 *  - **§3 · Codex is untouched.** `readSessionInstructions` returns for Codex before `allocate`, so
 *    b8414e4f could not change it — by construction, and unpinned: no test ran the saturating
 *    repository on Codex.
 *
 * ⚑ Fixture folders only, under `mkdtemp`; `home` is a folder of its own that is not an ancestor
 * of the working directory, so no real home is walked.
 */

let root: string
let home: string
let cwd: string
let providerHome: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-budget-order-'))
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
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  return path
}

const bytes = (text: string | null | undefined): number => Buffer.byteLength(text ?? '', 'utf8')

const readLaunch = (over: Partial<Parameters<typeof readSessionInstructions>[0]> = {}) =>
  readSessionInstructions({ provider: 'claude', cwd, providerHome, home, ...over })

describe('b8414e4f · the budget order at its edges', () => {
  it('🔴 §1 · BroBot’s rules are granted before the profile’s own memory: with room for one, the rules go and the memory is the row', () => {
    const bundlePath = write(join(providerHome, 'brobot-instructions.md'), 'r'.repeat(10_000))
    const memoryPath = write(join(providerHome, 'CLAUDE.md'), 'm'.repeat(20_000))
    const bundle = { ok: true as const, path: bundlePath, bytes: 10_000 }

    // ⚑ The control: with no block of this conversation's, both fit, in prompt order.
    const alone = readLaunch({ bundle })
    expect(alone.instructions.injected.map((one) => one.kind)).toEqual([
      'profile-instructions',
      'profile-memory',
    ])
    expect(alone.instructions.refused).toEqual([])

    // ⚑ A block that leaves the two files 5,000 bytes less than they cost together — so either
    // fits alone (the smaller by far), and whichever is granted first is the one that goes.
    // `full` is the preamble and both files' costs; `bare` is the block's header and separator.
    const full = bytes(alone.systemHint)
    const bare = bytes(composeSystemHint([], { text: '' }))
    const reserved = INSTRUCTION_TOTAL_CAP - full + 5_000
    const text = 'c'.repeat(reserved - bare - 2)
    const thisConversation = { text, spans: [] as [] }

    // ⚑ The premise: in that same room the memory fits on its own.
    const memoryAlone = readLaunch({ thisConversation })
    expect(memoryAlone.instructions.injected.map((one) => one.path)).toEqual([memoryPath])

    const read = readLaunch({ bundle, thisConversation })
    // 🔴 BroBot's rules went…
    expect(read.instructions.injected.map((one) => one.kind)).toEqual(['profile-instructions'])
    expect(read.instructions.injected[0]?.path).toBe(bundlePath)
    // ⛔ …and the profile's memory is what gave way, with its row.
    expect(read.instructions.refused).toEqual([{ path: memoryPath, reason: 'over-budget' }])
    // ⚑ The block is sent whole, last, and the cap holds.
    expect(read.systemHint?.endsWith(text)).toBe(true)
    expect(bytes(read.systemHint)).toBeLessThanOrEqual(INSTRUCTION_TOTAL_CAP)
  })

  describe('§2 · the exact edge', () => {
    const dirs = (): string[] => [join(root, 'work'), join(root, 'work', 'repo')]
    /** Five chain files of `size` bytes, the innermost `innermost` bytes; the innermost's path. */
    const fiveFiles = (size: number, innermost = size): string => {
      for (const dir of dirs()) {
        write(join(dir, 'CLAUDE.md'), 'z'.repeat(size))
        write(join(dir, '.claude', 'CLAUDE.md'), 'z'.repeat(size))
      }
      return write(join(cwd, 'CLAUDE.md'), 'z'.repeat(innermost))
    }
    const outermost = (): string => join(root, 'work', 'CLAUDE.md')

    it('🔴 a file whose cost is exactly what is left of the budget is sent: the hint is 256 KiB to the byte — one byte more and it is the row', () => {
      // ⚑ Measured, not assumed: five files of 52,000 bytes fit, with `room` to spare.
      fiveFiles(52_000)
      const measured = readLaunch()
      expect(measured.instructions.injected).toHaveLength(5)
      const room = INSTRUCTION_TOTAL_CAP - bytes(measured.systemHint)
      expect(room).toBeGreaterThan(0)
      // ⚑ The premise: the grown file is still under the per-file cap, so nothing is truncated and
      // the arithmetic is about the total cap alone.
      expect(52_000 + room).toBeLessThan(INSTRUCTION_FILE_CAP)

      // 🔴 Grown by exactly the room: the last file granted (the outermost) costs exactly what is
      // left, and is sent.
      fiveFiles(52_000, 52_000 + room)
      const exact = readLaunch()
      expect(exact.instructions.injected).toHaveLength(5)
      expect(exact.instructions.refused).toEqual([])
      expect(bytes(exact.systemHint)).toBe(INSTRUCTION_TOTAL_CAP)
      expect(exact.instructions.injected.map((one) => one.path)).toContain(outermost())

      // ⛔ One byte more: the outermost no longer fits, and it is the row.
      fiveFiles(52_000, 52_000 + room + 1)
      const over = readLaunch()
      expect(over.instructions.injected).toHaveLength(4)
      expect(over.instructions.refused).toEqual([{ path: outermost(), reason: 'over-budget' }])
      expect(bytes(over.systemHint)).toBeLessThanOrEqual(INSTRUCTION_TOTAL_CAP)
    })
  })

  describe('§3 · Codex is untouched', () => {
    /** b8414e4f's own repository: forty nested folders, both `CLAUDE.md` spellings in each. */
    const fortyFolders = (): string => {
      const level = `${'Repository rule. '.repeat(212)}\n`
      let deep = cwd
      for (let at = 0; at < 40; at++) {
        deep = join(deep, `d${String(at)}`)
        write(join(deep, 'CLAUDE.md'), level)
        write(join(deep, '.claude', 'CLAUDE.md'), level)
      }
      return deep
    }

    it('⛔ §3 · on Codex the repository that fills Claude’s budget sends nothing and drops nothing — on Claude the same tree does', () => {
      const deep = fortyFolders()
      const rules = `## How you work\n\n${'BroBot rule. '.repeat(200)}`
      const claudeBundle = write(join(providerHome, 'brobot-instructions.md'), rules)

      // ⚑ The control: on Claude this tree really is over the budget — BroBot's rules go first,
      // and some of the chain's files are rows.
      const claude = readLaunch({
        cwd: deep,
        bundle: { ok: true, path: claudeBundle, bytes: bytes(rules) },
      })
      expect(claude.instructions.injected[0]?.kind).toBe('profile-instructions')
      expect(
        claude.instructions.refused.filter((one) => one.reason === 'over-budget').length,
      ).toBeGreaterThan(0)

      // ⛔ On Codex: the provider reads its own files, so nothing is injected, nothing is weighed
      // against the budget, and nothing is dropped from it.
      const codexHome = join(root, 'provider-homes', 'default', 'default', 'codex')
      mkdirSync(codexHome, { recursive: true })
      const codexBundle = write(join(codexHome, 'AGENTS.override.md'), rules)
      const codex = readLaunch({
        provider: 'codex',
        cwd: deep,
        providerHome: codexHome,
        bundle: { ok: true, path: codexBundle, bytes: bytes(rules) },
      })
      expect(codex.instructions.injected).toEqual([])
      expect(codex.instructions.refused.filter((one) => one.reason === 'over-budget')).toEqual([])
      expect(codex.instructions.refused.map((one) => one.path)).not.toContain(codexBundle)
      expect(codex.systemHint).toBeNull()
      expect(codex.firstTurnLead).toBeNull()
    })
  })
})
