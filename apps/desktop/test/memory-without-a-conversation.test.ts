import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeAutoMemoryDir, codexAdHocNotesDir, codexMemoryDir } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAgentMemory } from '../src/main/runtime/agent-memory'
import {
  MEMORY_STORE_IS,
  MEMORY_STORE_STATE,
  type AgentMemoryStore,
} from '../src/shared/agent-memory'

/**
 * # 🔴 An agent's memory, read with NO conversation open (625, `EXT-015` §1)
 *
 * A person can find a false memory note without a conversation.
 * `SessionInstructions.agentMemory` is a launch snapshot belonging to one conversation; the
 * Team page needs its own store reading.
 *
 * ## ⚠️ What each section is a control for
 *
 * §1 is the FOUR STATES, and it is `EXT-015` §3.4's *both providers* answered as a field rather
 * than as an absence — three different facts used to produce one empty list. §2 is the containment
 * rail, with a REFUSED negative control and a positive control beside it, which is the brief's
 * criterion 5 and `a-guard-that-only-a-live-run-can-trip-is-dark-by-default`'s shape. §3 is the
 * moment.
 */

let root: string
let homesRoot: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-agent-memory-'))
  homesRoot = join(root, 'provider-homes')
  // ⛔ **A directory OUTSIDE the managed root, in the same fixture tree.** Every symlink below
  // points here. ⚠️ It stands in for `~/.claude` — which `EXT-015` §5 names and which no test in
  // this repository may go near — and the property under test is *outside the root*, which this
  // directory has exactly as much as his does.
  outside = join(root, 'not-ours')
  mkdirSync(outside, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Where a profile's home for one provider would be — `deriveProviderHome`'s layout, by hand. */
const homeOf =
  (profileId: string) =>
  (provider: Provider): string =>
    join(homesRoot, 'default', profileId, provider)

const read = (profileId: string, over: { homesRoot?: string | null } = {}) =>
  readAgentMemory({
    profileId,
    homeOf: homeOf(profileId),
    homesRoot: 'homesRoot' in over ? (over.homesRoot ?? null) : homesRoot,
  })

const storeOf = (profileId: string, provider: Provider): AgentMemoryStore => {
  const found = read(profileId).stores.find((store) => store.provider === provider)
  if (found === undefined) throw new Error(`no ${provider} store in the reading`)
  return found
}

/** Make the home exist — which is what tells `no-home` from `nothing-written`. */
const plantHome = (profileId: string, provider: Provider): string => {
  const home = homeOf(profileId)(provider)
  mkdirSync(home, { recursive: true })
  return home
}

const plantClaudeMemory = (profileId: string, files: Record<string, string>): string => {
  const dir = claudeAutoMemoryDir(plantHome(profileId, 'claude'))
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

describe('§1 · four states, and a bare empty list is none of them', () => {
  it('🔴 every member of the vocabulary has a sentence, and the reading only ever answers one of them', () => {
    // ⚑ **The vocabulary and its sentences are pinned together**, which is standing rule 8's half
    // that a test can hold: a word added without a sentence is a word a surface cannot render.
    expect(Object.keys(MEMORY_STORE_IS).sort()).toEqual([...MEMORY_STORE_STATE].sort())
    for (const state of MEMORY_STORE_STATE) {
      expect(MEMORY_STORE_IS[state].length, `${state} has no sentence`).toBeGreaterThan(10)
    }
  })

  it('⛔ an agent that has never run answers `no-home` — NOT "hasn’t written anything down yet"', () => {
    const reading = read('never-ran')
    // ⚠️ **Both providers, and neither of them is the configured one** — there is no identity row
    // in this test at all, which is the point: a store is a fact about a directory.
    expect(reading.stores.map((store) => store.provider)).toEqual(['claude', 'codex'])
    for (const store of reading.stores) {
      expect(store.state).toBe('no-home')
      expect(store.dir).toBeNull()
      expect(store.entries).toEqual([])
    }
    // 🔴 **The control that makes the word mean something.** A reading that answered
    // `nothing-written` here would be telling a person to wait for a store no conversation is
    // going to fill, and it would look IDENTICAL on the wire to the case below.
    expect(MEMORY_STORE_IS['no-home']).not.toBe(MEMORY_STORE_IS['nothing-written'])
  })

  it('⛔ …and one that has RUN and written nothing answers `nothing-written` — the same empty list, a different fact', () => {
    plantHome('ran-once', 'claude')
    expect(storeOf('ran-once', 'claude').state).toBe('nothing-written')
    // ⚑ **The paired positive**: the provider it did NOT run on still says `no-home`, so the two
    // words are being produced by the fixture rather than by one branch answering everything.
    expect(storeOf('ran-once', 'codex').state).toBe('no-home')
  })

  it('⛔ …and a store whose files are all refused answers `unreadable`, never `nothing-written`', () => {
    const dir = claudeAutoMemoryDir(plantHome('walled', 'claude'))
    mkdirSync(dir, { recursive: true })
    // ⚠️ **A memory index that is a DIRECTORY** — the guarded reader refuses it with a reason, and
    // nothing comes back. ⛔ Without this word the popup would render a wall of refusals as *this
    // agent hasn’t written anything down yet*, which is `MEMORY_STORE_IS`' own argument.
    mkdirSync(join(dir, 'MEMORY.md'), { recursive: true })
    const store = storeOf('walled', 'claude')
    expect(store.state).toBe('unreadable')
    expect(store.entries).toEqual([])
    expect(store.refused.length).toBeGreaterThan(0)
  })

  it('🔴 and a store with something in it answers `read` — on CLAUDE and on CODEX, which is §3.4', () => {
    plantClaudeMemory('remembers', {
      'MEMORY.md': '- [A parked agent](parked.md) — the note\n',
      'parked.md': 'BROBOT-625-CLAUDE a parked agent is indistinguishable from a broken one\n',
    })
    const claude = storeOf('remembers', 'claude')
    expect(claude.state).toBe('read')
    expect(claude.entries.map((entry) => entry.kind)).toEqual([
      'agent-memory',
      'agent-memory-topic',
    ])
    expect(claude.entries[1]?.text).toContain('BROBOT-625-CLAUDE')

    // 🔴 **CODEX, and this is the brief's §2 answered from the code.** The dispatch's brief quoted
    // `instructions.ts:100` — *"`agentMemory: null` for every Codex session"* — as a current fact.
    // ⛔ **That sentence is inside a docblock narrating a defect `317` FIXED**, in the past tense:
    // *"this module went on reporting `agentMemory: null`"*. ⚑ `readCodexAgentMemory` has read this
    // store since then, and this is the assertion that says so rather than the comment.
    const notes = codexAdHocNotesDir(plantHome('remembers', 'codex'))
    mkdirSync(notes, { recursive: true })
    writeFileSync(join(notes, '2026-09-21T22-00-00-parked.md'), 'BROBOT-625-CODEX\n')
    writeFileSync(
      join(codexMemoryDir(homeOf('remembers')('codex')), 'memory_summary.md'),
      'BROBOT-625-SUMMARY\n',
    )
    const codex = storeOf('remembers', 'codex')
    expect(codex.state).toBe('read')
    expect(codex.entries.map((entry) => entry.text).join('')).toContain('BROBOT-625-CODEX')
    // ⚠️ **The summary is `prompt` and the note is `on-request`** — `317`'s ruling, carried onto
    // this door by reading through the same walk rather than by a second decision here.
    expect(codex.entries.map((entry) => entry.reach).sort()).toEqual(['on-request', 'prompt'])
  })
})

describe('§2 · 🔒 the containment rail — and it REFUSES rather than merely not reaching', () => {
  it('🔴 an entry whose bytes are outside the managed root is SHOWN and is not amendable', () => {
    // ⛔ **The hazard, on the path the code walks** (`put-the-hazard-on-the-path-the-code-walks`):
    // a memory index that is a symlink OUT of the provider home. ⚠️ `readMemoryStore` follows it
    // deliberately — `170` §2, because the provider read the target before this app was asked
    // anything — so the bytes really do arrive, which is what makes the write's refusal a separate
    // decision rather than a consequence.
    const theirs = join(outside, 'CLAUDE.md')
    writeFileSync(theirs, 'BROBOT-625-NOT-OURS\n')
    const dir = claudeAutoMemoryDir(plantHome('linked', 'claude'))
    mkdirSync(dir, { recursive: true })
    symlinkSync(theirs, join(dir, 'MEMORY.md'))

    const entry = storeOf('linked', 'claude').entries[0]
    // ⚑ **Shown**, with the redirection disclosed — refusing the READ buys nothing, which is the
    // whole of `170` §2 and is untouched here.
    expect(entry?.text).toContain('BROBOT-625-NOT-OURS')
    expect(entry?.link).toBeDefined()
    // 🔴 **And not amendable.** `EXT-015` §5 is *"only ever read or write inside BroBot's own
    // folders"*, and this is the one case where following on the read and refusing on the write
    // give different answers about one file.
    expect(entry?.amendable).toBe(false)
  })

  it('⛔ …and the POSITIVE control: an ordinary entry in the same store IS amendable', () => {
    // ⚠️ **Without this the assertion above is satisfied by a guard that refuses everything**,
    // which is `a-positive-assertion-must-differ-from-the-default` at a rail.
    const dir = claudeAutoMemoryDir(plantHome('mixed', 'claude'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'MEMORY.md'), '- [ours](ours.md)\n')
    writeFileSync(join(dir, 'ours.md'), 'BROBOT-625-OURS\n')
    symlinkSync(join(outside, 'elsewhere.md'), join(dir, 'linked.md'))
    writeFileSync(join(outside, 'elsewhere.md'), 'BROBOT-625-ELSEWHERE\n')

    const amendable = Object.fromEntries(
      storeOf('mixed', 'claude').entries.map((entry) => [entry.text.trim(), entry.amendable]),
    )
    expect(amendable['BROBOT-625-OURS']).toBe(true)
    expect(amendable['BROBOT-625-ELSEWHERE']).toBe(false)
    expect(amendable['- [ours](ours.md)']).toBe(true)
  })

  it('⛔ a store reached through a symlinked MEMORY DIRECTORY is not amendable either', () => {
    // 🔴 **The leaf guard would pass this one.** `O_NOFOLLOW` guards the FILE; a symlinked
    // `memory/` redirects the whole lookup and every leaf under it looks perfectly ordinary —
    // which is `readCodexAgentMemory`'s own stated reason for refusing to ENUMERATE through a
    // link, asked here of the other provider's store.
    const elsewhere = join(outside, 'their-memory')
    mkdirSync(elsewhere, { recursive: true })
    writeFileSync(join(elsewhere, 'MEMORY.md'), 'BROBOT-625-WHOLE-STORE\n')
    const home = plantHome('redirected', 'claude')
    symlinkSync(elsewhere, claudeAutoMemoryDir(home))

    const entry = storeOf('redirected', 'claude').entries[0]
    expect(entry?.text).toContain('BROBOT-625-WHOLE-STORE')
    expect(entry?.amendable).toBe(false)
  })

  it('⚠️ a host that cannot name the managed root makes NOTHING amendable — it does not guess one', () => {
    plantClaudeMemory('rootless', { 'MEMORY.md': 'BROBOT-625-ROOTLESS\n' })
    // ⛔ **Fail closed in the refusing direction**, which is `providerHomesRoot`'s own declared
    // policy: the root is the anchor the whole check hangs off and a guessed one would make every
    // claim pass.
    const store = read('rootless', { homesRoot: null }).stores.find((s) => s.provider === 'claude')
    expect(store?.entries[0]?.text).toContain('BROBOT-625-ROOTLESS')
    expect(store?.entries[0]?.amendable).toBe(false)
    // ⚑ **The paired positive**: the same tree with the root named answers `true`, so the `false`
    // above is the missing root and not the fixture.
    expect(storeOf('rootless', 'claude').entries[0]?.amendable).toBe(true)
  })

  // Windows chmod cannot construct a POSIX permission denial.
  it.skipIf(process.platform === 'win32')(
    '🔴 a REFUSED source still carries its reason, so `unreadable` is never silent',
    () => {
      const dir = claudeAutoMemoryDir(plantHome('sealed', 'claude'))
      mkdirSync(dir, { recursive: true })
      const sealed = join(dir, 'MEMORY.md')
      writeFileSync(sealed, 'BROBOT-625-SEALED\n')
      chmodSync(sealed, 0o000)
      try {
        const store = storeOf('sealed', 'claude')
        expect(store.state).toBe('unreadable')
        expect(store.refused.map((row) => row.path)).toContain(sealed)
      } finally {
        chmodSync(sealed, 0o600)
      }
    },
  )
})

describe('§3 · ⚠️ the moment — and it is NOT the conversation’s', () => {
  it('⛔ `readAt` is stamped before the walk, so everything the reading reports is from at-or-after it', () => {
    plantClaudeMemory('stamped', { 'MEMORY.md': 'BROBOT-625-STAMP\n' })
    const before = Date.now()
    const reading = read('stamped')
    const after = Date.now()
    expect(reading.readAt).toBeGreaterThanOrEqual(before)
    expect(reading.readAt).toBeLessThanOrEqual(after)
  })

  it('🔴 a SECOND read sees what was written between the two — which is the whole of `EXT-015` §0', () => {
    // ⛔ **The defect this closes, stated as a fixture.** `SessionInstructions.agentMemory` is taken
    // at a conversation's launch, so a note the agent wrote DURING the run is invisible to the
    // popup opened in that very conversation. ⚑ This read is taken when it is asked for.
    plantClaudeMemory('tonight', { 'MEMORY.md': '- [nothing yet](nothing.md)\n' })
    expect(JSON.stringify(read('tonight').stores)).not.toContain('BROBOT-625-TONIGHT')
    writeFileSync(
      join(claudeAutoMemoryDir(homeOf('tonight')('claude')), 'parked.md'),
      'BROBOT-625-TONIGHT\n',
    )
    expect(JSON.stringify(read('tonight').stores)).toContain('BROBOT-625-TONIGHT')
  })
})
