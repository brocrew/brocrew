import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeMemoryStore } from '../src/claude/memory-store'
import { namesATarget } from '../src/internal/confinement'

/**
 * 330 · 🔴 **A memory write that the transcript rendered as an ordinary file.**
 *
 * ⛔ **Where the store's location comes from is the whole of this file's subject.** 330 §2 enumerated
 * every key path at every depth of a real `2.1.218` session — 133 of them across 77 frames — and
 * found `system/init.memory_paths.auto`: the provider's own answer to *"where does this profile's
 * memory live"*, on every `init` frame, once per turn. Everything below is what may and may not be
 * concluded from it.
 *
 * ⚠️ **Every negative here is paired with a positive about the SAME store**, because a predicate that
 * has quietly stopped labelling anything answers `null` to all of them and passes.
 */

let root = ''
let home = ''
let store = ''

/** A `system/init` frame carrying whatever this test wants it to carry. */
function init(memoryPaths: unknown): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: 's',
    ...(memoryPaths === undefined ? {} : { memory_paths: memoryPaths }),
  } as unknown as SDKMessage
}

/** A store that really exists, opened the way the provider opens it — with a trailing separator. */
function opened(): ClaudeMemoryStore {
  const memory = new ClaudeMemoryStore()
  memory.noteInit(init({ auto: `${store}/` }))
  return memory
}

beforeEach(() => {
  // ⛔ **REAL-pathed, and it is what makes the negatives below killable rather than lucky.** On macOS
  // `tmpdir()` is `/var/folders/…`, a symlink to `/private/var/folders/…` — so a store built there
  // has a lexical spelling that is outside its own real root, and EVERY path fails the real
  // comparison for a reason that has nothing to do with what a test is asserting. A predicate that
  // had stopped resolving anything would still answer `null` to all of them and pass. The one test
  // that is ABOUT two spellings builds its own symlink, explicitly.
  root = join(
    realpathSync(tmpdir()),
    `brobot2-330-store-${process.pid}-${Math.random().toString(36).slice(2)}`,
  )
  home = join(root, 'home')
  store = join(home, 'memory')
  mkdirSync(store, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('330 · the store the provider names', () => {
  it('🔴 labels a memory write with the file, relative to the store', () => {
    // Write the memory, then its index. Both measured rows were unlabeled `Write` calls to
    // 90-character paths whose final segment is truncated.
    const memory = opened()
    expect(memory.target({ file_path: join(store, 'release_notes_tag.md') })).toBe(
      'release_notes_tag.md',
    )
    expect(memory.target({ file_path: join(store, 'MEMORY.md') })).toBe('MEMORY.md')
  })

  it('⚠️ …and the provider’s trailing separator is not part of the answer', () => {
    // Measured: `memory_paths.auto` really does end in `/`. A naive `relative` against that string
    // still works, but a naive `slice(root.length)` would leave the answer starting with a
    // separator — so the shape of the answer is asserted rather than only its presence.
    expect(opened().target({ file_path: join(store, 'a', 'b.md') })).toBe(join('a', 'b.md'))
  })

  it('⛔ a write OUTSIDE the store is not labelled — and the same store still labels one inside', () => {
    const memory = opened()
    // The control 330 §2 ran live, restated as a unit: same session, same tool, one difference.
    expect(memory.target({ file_path: join(root, 'work', 'ordinary.md') })).toBeNull()
    expect(memory.target({ file_path: join(store, 'ordinary.md') })).toBe('ordinary.md')
  })

  it('⛔ a sibling of the store is not inside it, however the string reads', () => {
    // `/a/b-evil` has `/a/b` as a string prefix. `isWithin` uses `relative`, not `startsWith`.
    const memory = opened()
    expect(memory.target({ file_path: `${store}-evil/x.md` })).toBeNull()
    expect(memory.target({ file_path: join(store, 'x.md') })).toBe('x.md')
  })

  it('⛔ a Bash command naming the store is NOT a memory row — the Write beside it is', () => {
    // 330 §3.3: *"Grepping a shell command string for the store path is how a label becomes a lie."*
    // ⚑ The hazard is ON the path the code walks — the same store, the same directory, in the same
    // assertion — so a predicate that had started reading command strings would go red here.
    const memory = opened()
    expect(memory.target({ command: `ls "${store}/" 2>/dev/null` })).toBeNull()
    expect(memory.target({ command: `cat ${join(store, 'MEMORY.md')}` })).toBeNull()
    expect(memory.target({ file_path: join(store, 'MEMORY.md') })).toBe('MEMORY.md')
  })

  it('⛔ an absolute path in CONTENT does not label the row — the file_path beside it does', () => {
    // `namesATarget`: absolute, nameable, AND under a declared path key. 190 H1 is what happens when
    // two classifiers answer differently about one string.
    const memory = opened()
    expect(memory.target({ content: join(store, 'not_the_target.md') })).toBeNull()
    expect(
      memory.target({ file_path: join(store, 'real.md'), content: join(store, 'decoy.md') }),
    ).toBe('real.md')
  })

  it('⛔ what a TARGET is: `namesATarget`’s corpus, the one classifier the label and the card share', () => {
    // ⚑ Moved here by `728`, from `memory-bound.test.ts`: R93 removed the memory bound that was its
    // other caller, and this label is what still calls it (`memory-store.ts`) — so the answer itself
    // is pinned beside it, rather than lost with the file.
    const corpus = [
      // absolute, short, under a declared target key — the only shape that is a target
      { key: 'file_path', value: join(store, 'ordinary.md'), target: true },
      { key: 'notebook_path', value: join(store, 'n.ipynb'), target: true },
      // 190 H1's payload: absolute, and too long for any kernel to name a file with
      { key: 'file_path', value: `/${'x'.repeat(5_000)}`, target: false },
      // ⛔ a field name may narrow what labels and may NEVER widen it
      { key: 'content', value: join(store, 'ordinary.md'), target: false },
      { key: 'old_string', value: join(store, 'ordinary.md'), target: false },
      { key: 'content', value: '/etc/hosts', target: false },
      // relative: the pinned SDK requires an absolute path, so this is never the file written
      { key: 'file_path', value: 'notes.md', target: false },
      // legal on macOS since 153 — a newline is not what disqualifies a name
      { key: 'file_path', value: join(store, 'with\na newline.md'), target: true },
      { key: 'file_path', value: `${join(store, 'nul')}\0.md`, target: false },
    ]
    for (const { key, value, target } of corpus) {
      expect([key, namesATarget(value, key)]).toEqual([key, target])
    }
    // …and the top-level input arrives under no key of its own, so a bare string names nothing.
    expect(namesATarget(join(store, 'ordinary.md'), null)).toBe(false)
  })

  it('⚠️ a notebook in the store is labelled too — the declared field, not the tool name', () => {
    expect(opened().target({ notebook_path: join(store, 'notes.ipynb') })).toBe('notes.ipynb')
  })

  it('⛔ the store DIRECTORY itself is not a file in it', () => {
    const memory = opened()
    expect(memory.target({ file_path: store })).toBeNull()
    expect(memory.target({ file_path: `${store}/` })).toBeNull()
    expect(memory.target({ file_path: join(store, 'x.md') })).toBe('x.md')
  })

  it('🔴 a store root that is a SYMLINK is not attested — 170’s finding, as a label', () => {
    // ⛔ `<home>/memory -> <home>` makes `<home>/memory/CLAUDE.md` — the profile's own instruction
    // file, which is not a memory — pass every containment test by construction. `attestedRoot`
    // refuses a root whose own last component redirects, and this is that, on a real filesystem.
    rmSync(store, { recursive: true, force: true })
    symlinkSync(home, store)
    writeFileSync(join(home, 'CLAUDE.md'), '# not a memory\n')
    const linked = opened()
    expect(linked.target({ file_path: join(store, 'CLAUDE.md') })).toBeNull()
    // ⚑ The positive that proves the refusal is about the LINK and not about this whole test: an
    // ordinary store, same fixture, same call shape, is labelled.
    const real = join(root, 'real-home', 'memory')
    mkdirSync(real, { recursive: true })
    const plain = new ClaudeMemoryStore()
    plain.noteInit(init({ auto: real }))
    expect(plain.target({ file_path: join(real, 'CLAUDE.md') })).toBe('CLAUDE.md')
  })

  it('⛔ a symlink INSIDE the store that leads out of it is not labelled', () => {
    // The other half of 183/170: the root is honest, the entry is not.
    const outside = join(root, 'elsewhere')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'secret.md'), 'x')
    symlinkSync(join(outside, 'secret.md'), join(store, 'escape.md'))
    const memory = opened()
    expect(memory.target({ file_path: join(store, 'escape.md') })).toBeNull()
    expect(memory.target({ file_path: join(store, 'stays.md') })).toBe('stays.md')
  })

  it('⛔ a build that sends no memory_paths labels NOTHING — and one that does labels this', () => {
    // ⚠️ `memory_paths` is not in the pinned SDK's types; it is read off the frame. A build that
    // stops sending it must leave every row unlabelled rather than fall back to a guess.
    const silent = new ClaudeMemoryStore()
    silent.noteInit(init(undefined))
    expect(silent.target({ file_path: join(store, 'x.md') })).toBeNull()
    expect(opened().target({ file_path: join(store, 'x.md') })).toBe('x.md')
  })

  it('⛔ a session that has seen no init at all labels nothing', () => {
    expect(new ClaudeMemoryStore().target({ file_path: join(store, 'x.md') })).toBeNull()
  })

  it('⚠️ a LATER init withdrawing the field withdraws the labelling', () => {
    // The registry re-reads rather than latching: a store that stops being attested stops labelling
    // at the next turn rather than at no point at all.
    const memory = opened()
    expect(memory.target({ file_path: join(store, 'x.md') })).toBe('x.md')
    memory.noteInit(init({}))
    expect(memory.target({ file_path: join(store, 'x.md') })).toBeNull()
  })

  it('⚠️ a NON-init frame leaves the store where it was', () => {
    const memory = opened()
    memory.noteInit({ type: 'system', subtype: 'compact_boundary' } as unknown as SDKMessage)
    memory.noteInit({ type: 'result', subtype: 'success' } as unknown as SDKMessage)
    expect(memory.target({ file_path: join(store, 'x.md') })).toBe('x.md')
  })

  it('⛔ a non-object input names nothing', () => {
    const memory = opened()
    expect(memory.target('a string')).toBeNull()
    expect(memory.target(null)).toBeNull()
    expect(memory.target([join(store, 'x.md')])).toBeNull()
    expect(memory.target({ file_path: join(store, 'x.md') })).toBe('x.md')
  })

  it('🔴 the label reaches exactly as far as the PERMISSION does, and no further', () => {
    // ⛔ **Both spellings, and this is what the second comparison buys.** The provider names the
    // store lexically — measured: `memory_paths.auto` is `/var/folders/…` in the same `init` frame
    // whose `cwd` is `/private/var/folders/…`, so the CLI real-paths one and not the other.
    // ⚑ Until `728`, `writesOnlyWithin` compared `isWithin(lexicalRoot, lexical) && isWithin(realRoot,
    // real)` too, so the row and the cardless memory exemption agreed about the same file; R93 removed
    // the exemption, and this label keeps the comparison. A path spelled the OTHER way round is not
    // labelled.
    const real = join(root, 'real')
    const link = join(root, 'link')
    mkdirSync(join(real, 'memory'), { recursive: true })
    symlinkSync(real, link)
    const memory = new ClaudeMemoryStore()
    memory.noteInit(init({ auto: join(link, 'memory') }))
    // The spelling the provider gave: labelled.
    expect(memory.target({ file_path: join(link, 'memory', 'x.md') })).toBe('x.md')
    // The spelling behind the link: NOT labelled, and deliberately.
    expect(memory.target({ file_path: join(real, 'memory', 'x.md') })).toBeNull()
  })

  it('⛔ a path whose destination cannot be established is not labelled', () => {
    // 183: a dangling link is not an absence. *"We could not tell"* and *"it is a memory"* are
    // different answers, and only one of them may go on a row (074).
    symlinkSync(join(root, 'nowhere', 'target.md'), join(store, 'dangling.md'))
    const memory = opened()
    expect(memory.target({ file_path: join(store, 'dangling.md') })).toBeNull()
    expect(memory.target({ file_path: join(store, 'ordinary.md') })).toBe('ordinary.md')
  })

  it('⛔ an EMPTY memory_paths.auto labels nothing — it does not resolve to the cwd', () => {
    // `resolve('')` is the process cwd. A store root that fell back to it would label every write
    // the agent makes anywhere under it.
    const empty = new ClaudeMemoryStore()
    empty.noteInit(init({ auto: '' }))
    expect(empty.target({ file_path: join(process.cwd(), 'x.md') })).toBeNull()
    expect(empty.target({ file_path: join(store, 'x.md') })).toBeNull()
    expect(opened().target({ file_path: join(store, 'x.md') })).toBe('x.md')
  })

  it('⛔ a relative path under a declared field is not a target', () => {
    // The SDK's own tool schema says `file_path` *"must be absolute, not relative"*, so a relative
    // string in one of these is never the file that gets written.
    const memory = opened()
    expect(memory.target({ file_path: 'MEMORY.md' })).toBeNull()
    expect(memory.target({ file_path: join(store, 'MEMORY.md') })).toBe('MEMORY.md')
  })
})
