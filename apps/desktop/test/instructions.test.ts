import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'
import {
  claudeAutoMemoryIndex,
  codexAdHocNotesDir,
  codexMemoryDir,
  codexMemoryIndex,
  codexMemorySummary,
  SUPPORTED_PROVIDERS,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AGENT_MEMORY_NOTES_SHOWN,
  AGENT_MEMORY_TOTAL_CAP,
  composeSystemHint,
  INSTRUCTION_FILE_CAP,
  INSTRUCTION_TOTAL_CAP,
  projectInstructionChain,
  readInstructionFile,
  readSessionInstructions,
} from '../src/main/runtime/instructions'

/**
 * **The memory files a session is launched with** (158).
 *
 * Two subjects, and they are different in kind. The first is a product gap: the CLI loads a repo's
 * `CLAUDE.md` and the user's own memory, and BroBot loaded neither for any repo, ever (156 §4). The
 * second is a security boundary, because closing the first one means this app now opens files
 * chosen by a directory the agent itself can write.
 *
 * ⛔ **The attack these tests were about until `733`.** A session may write its own cwd, so it could
 * plant `CLAUDE.md` as a symlink to `~/.ssh/id_rsa`, or to the user's personal Claude memory, and
 * the next launch would read that file into the prompt. 🔴 **R93 removed the first half** (*"remove
 * old guards"*; `731` F-3: *"Follow links as the CLIs do"*): a link is followed now. ⚑ **Since
 * `736` (733 F-1) the second half went too**: a link that lands in `~/CLAUDE.md` or
 * `~/.claude/CLAUDE.md` is SENT once, labelled as the project's file, as the CLI sends it (`733`
 * refused it as `personal-home`). What stays is the reader's rules that were never about a
 * credential: a loop, a missing target, a FIFO, a swap, the cap, the bytes.
 */

let root: string
let home: string
let cwd: string
let providerHome: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-instructions-'))
  // A home that is NOT an ancestor of the cwd, so the walk's boundary is exercised deliberately
  // rather than by whatever the machine's real layout happens to be.
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

/**
 * ⚠️ **The panel's half of one read** (332). `readSessionInstructions` returns the launch fact
 * beside it now; every assertion below this line predates that and is about the list, so the helper
 * unwraps and {@link readLaunch} is the one that looks at the other half.
 */
const read = (over: Partial<Parameters<typeof readSessionInstructions>[0]> = {}) =>
  readSessionInstructions({ provider: 'claude', cwd, providerHome, home, ...over }).instructions

/** The whole read — the list AND the launch fact (332). */
const readLaunch = (over: Partial<Parameters<typeof readSessionInstructions>[0]> = {}) =>
  readSessionInstructions({ provider: 'claude', cwd, providerHome, home, ...over })

const write = (path: string, text: string): string => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  return path
}

/** Change the leaf's spelling while preserving every ancestor and child segment. */
const alternateCaseLeaf = (path: string): string =>
  join(
    dirname(path),
    basename(path).replace(/[A-Za-z]/, (letter) =>
      letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase(),
    ),
  )

/* ------------------------------------------------------------------ what loads */

describe('the profile’s own memory', () => {
  it('⛔ reaches the model — the file 156 measured, at the path it measured', () => {
    // `<providerHome>/CLAUDE.md`, and NOT `<providerHome>/.claude/CLAUDE.md`: the pinned CLI
    // resolves User memory through `CLAUDE_CONFIG_DIR`, which this app pins to the provider home.
    write(join(providerHome, 'CLAUDE.md'), 'I am the developer profile. Prefer minimal diffs.')

    const result = read()

    expect(result.injected.map((i) => i.kind)).toContain('profile-memory')
    expect(composeSystemHint(result.injected)).toContain('Prefer minimal diffs')
  })

  it('⚠️ …and a profile with no file appends NOTHING — the paired negative', () => {
    // The half that makes the assertion above mean something: this must not fall back to a
    // template, a default persona, or the user's personal home.
    const result = read()

    expect(result.injected).toEqual([])
    expect(composeSystemHint(result.injected)).toBeUndefined()
  })

  it('the OTHER spelling is not the file — `.claude/CLAUDE.md` in the home is not read', () => {
    write(join(providerHome, '.claude', 'CLAUDE.md'), 'wrong place')

    expect(read().injected).toEqual([])
  })
})

describe('the project chain', () => {
  it('⛔ reads the cwd AND its ancestors, both spellings, outermost first', () => {
    // 156's zero-turn control reported exactly this shape from the pinned CLI.
    write(join(root, 'work', 'CLAUDE.md'), 'work rules')
    write(join(root, 'work', 'repo', 'CLAUDE.md'), 'repo rules')
    write(join(root, 'work', 'repo', '.claude', 'CLAUDE.md'), 'repo dotdir rules')
    write(join(cwd, 'CLAUDE.md'), 'child rules')
    write(join(cwd, '.claude', 'CLAUDE.md'), 'child dotdir rules')

    const result = read()

    expect(result.injected.map((i) => i.text)).toEqual([
      'work rules',
      'repo rules',
      'repo dotdir rules',
      'child rules',
      'child dotdir rules',
    ])
    // Position is meaning: the deepest file lands last, which is where the CLI puts it.
    const hint = composeSystemHint(result.injected) ?? ''
    expect(hint.indexOf('work rules')).toBeLessThan(hint.indexOf('child rules'))
  })

  it('⛔ stops at the OS home directory and never reads the personal files above it', () => {
    // The one place this deliberately differs from the CLI, and 158 asks that it be said out loud:
    // the CLI walks to the filesystem root, but in the CLI `~/.claude/CLAUDE.md` is the USER scope
    // it loads anyway. Here the user scope is the per-profile provider home (156 §1) — so pulling
    // the personal files in through the project door would re-import exactly what the profile home
    // exists to keep separate.
    const inside = join(home, 'projects', 'thing')
    mkdirSync(inside, { recursive: true })
    write(join(home, 'CLAUDE.md'), 'PERSONAL-MEMORY')
    write(join(home, '.claude', 'CLAUDE.md'), 'PERSONAL-MEMORY-DOTDIR')
    write(join(inside, 'CLAUDE.md'), 'project rules')

    const result = read({ cwd: inside })

    expect(result.injected.map((i) => i.text)).toEqual(['project rules'])
    expect(composeSystemHint(result.injected)).not.toContain('PERSONAL-MEMORY')
    expect(projectInstructionChain(inside, home)).toEqual([join(home, 'projects'), inside])
  })

  it('🔴 372 · a filesystem alias of OS home is still OS home, while an outside alias still works', () => {
    // The same canonical identity has two spellings on the APFS volume that exposed 371. The
    // boundary must exclude personal files through BOTH; an unrelated alias must still load its
    // repository file, proving the rule is about the home root and not the letters in a path.
    const spellings = [
      { kind: 'case', homeLeaf: 'CaseHome', aliasLeaf: 'caseHome' },
      { kind: 'Unicode', homeLeaf: 'Caf\u00e9Home', aliasLeaf: 'Cafe\u0301Home' },
    ]

    for (const [index, spelling] of spellings.entries()) {
      const actualHome = join(root, `372-${index}`, spelling.homeLeaf)
      const aliasHome = join(root, `372-${index}`, spelling.aliasLeaf)
      const repo = join(actualHome, 'projects', 'repo')
      mkdirSync(repo, { recursive: true })
      write(join(actualHome, 'CLAUDE.md'), `${spelling.kind} PERSONAL-MEMORY`)
      write(join(actualHome, '.claude', 'CLAUDE.md'), `${spelling.kind} PERSONAL-MEMORY-DOTDIR`)
      write(join(repo, 'CLAUDE.md'), `${spelling.kind} project rules`)

      // A case-sensitive/non-normalizing volume has no same-file alias to exercise. Ordinary-home
      // and parent-symlink controls above are still meaningful there.
      if (!existsSync(aliasHome)) continue

      const inside = read({ cwd: join(aliasHome, 'projects', 'repo'), home: actualHome })
      const insideText = inside.injected.map((item) => item.text)
      if (insideText.some((text) => text.includes('PERSONAL-MEMORY'))) {
        throw new Error(
          `${spelling.kind} alias of OS home loaded personal instructions: ${insideText.join(' | ')}`,
        )
      }
      expect(insideText).toEqual([`${spelling.kind} project rules`])

      const outsideHome = join(root, `372-${index}`, `${spelling.homeLeaf}-neighbour`)
      const outsideAlias =
        spelling.kind === 'case'
          ? alternateCaseLeaf(outsideHome)
          : join(root, `372-${index}`, `${spelling.aliasLeaf}-neighbour`)
      const outsideRepo = join(outsideHome, 'repo')
      mkdirSync(outsideRepo, { recursive: true })
      write(join(outsideRepo, 'CLAUDE.md'), `${spelling.kind} outside project rules`)
      if (existsSync(outsideAlias)) {
        expect(
          read({ cwd: join(outsideAlias, 'repo'), home: actualHome }).injected.map(
            (item) => item.text,
          ),
        ).toEqual([`${spelling.kind} outside project rules`])
      }
    }
  })

  it('🔴 …and a symlink in a PARENT of the cwd does not walk around that boundary (170 §3)', () => {
    // ⛔ **168 H4.** `/tmp/home-alias -> $HOME` with a cwd of `/tmp/home-alias/projects/repo`: no
    // directory on the walk is LEXICALLY at or below the home, so the exclusion never fired. The
    // chain reached the alias itself, its `.claude` was a real directory seen through the alias
    // rather than a symlink, the leaf `lstat` and `O_NOFOLLOW` saw a perfectly ordinary file — and
    // the personal memory went into the prompt under a path that named nothing personal.
    //
    // ⚠️ The decoy is a fixture, not the real `~/.claude/CLAUDE.md`. 168 proved this without
    // reading the user's own file and so does this.
    const repo = join(home, 'projects', 'repo')
    mkdirSync(repo, { recursive: true })
    write(join(home, '.claude', 'CLAUDE.md'), 'PERSONAL-MEMORY-BEHIND-THE-ALIAS')
    write(join(home, 'CLAUDE.md'), 'PERSONAL-MEMORY')
    write(join(repo, 'CLAUDE.md'), 'repo rules')
    const alias = join(root, 'home-alias')
    symlinkSync(home, alias)

    const result = read({ cwd: join(alias, 'projects', 'repo') })

    // ⚑ The paired positive: the ordinary repo file at the far end of the alias still loads, so
    // this is a boundary that moved and not a walk that stopped working.
    expect(result.injected.map((i) => i.text)).toEqual(['repo rules'])
    expect(JSON.stringify(result)).not.toContain('PERSONAL-MEMORY')
    expect(composeSystemHint(result.injected) ?? '').not.toContain('PERSONAL-MEMORY')
  })

  it('⚑ …and the alias buys no extra level — its chain is the real path’s chain', () => {
    // The sharper statement of the same rule: an aliased cwd and the directory it really is must
    // produce the same walk. A length comparison alone would pass if both were empty, so the
    // contents are compared after mapping the alias away.
    const alias = join(root, 'home-alias')
    symlinkSync(home, alias)
    const real = join(home, 'projects', 'repo')
    mkdirSync(real, { recursive: true })

    const throughAlias = projectInstructionChain(join(alias, 'projects', 'repo'), home)
    const direct = projectInstructionChain(real, home)

    expect(throughAlias.map((d) => d.replace(alias, home))).toEqual(direct)
    expect(direct.length, 'and neither is empty, or this compares nothing').toBeGreaterThan(0)
  })

  it('…and a session whose cwd IS the home directory reads no project memory at all', () => {
    write(join(home, 'CLAUDE.md'), 'PERSONAL-MEMORY')

    const result = read({ cwd: home })

    expect(result.injected).toEqual([])
    expect(result.note).toContain('personal home')
  })

  it('never climbs past the filesystem root for a cwd outside the home', () => {
    const chain = projectInstructionChain('/a/b', '/somewhere/else')
    expect(chain[0]).toBe(resolve('/a'))
    expect(chain).not.toContain(parse(resolve('/a/b')).root)
  })

  it('an EMPTY file is not an item — nothing to show and nothing to append', () => {
    write(join(cwd, 'CLAUDE.md'), '   \n\n')

    expect(read().injected).toEqual([])
  })
})

describe('Codex', () => {
  it('is not injected for — it reads its own instruction files (156 §3)', () => {
    write(join(providerHome, 'CLAUDE.md'), 'profile')
    write(join(cwd, 'CLAUDE.md'), 'project')

    const result = read({ provider: 'codex' })

    expect(result.injected).toEqual([])
    // …and it says why, rather than looking like a read that found nothing.
    expect(result.note).toContain('reads its own instruction files')
  })
})

/* ------------------------------------------- the reader's rules, and the links it follows */

describe('🔒 the reader refuses what it must', () => {
  /**
   * 🔴 **733 · a LINK is followed, as the CLI follows it** (`731` F-3, R93).
   *
   * Follow a symlinked file and a symlinked `.claude` directory as the CLIs do. Both can
   * redirect an ordinary memory leaf; their target text must be read rather than refused
   * solely for being linked.
   */
  it('🔴 733 · a `CLAUDE.md` that is a LINK is followed — its target is what is appended', () => {
    const target = write(join(root, 'elsewhere.md'), 'FOLLOWED-INTO-THE-PROMPT')
    symlinkSync(target, join(cwd, 'CLAUDE.md'))

    const result = read()

    // ⛔ On `main`: `[{ path: <cwd>/CLAUDE.md, reason: 'symlink' }]`, and nothing appended.
    expect(result.refused).toEqual([])
    expect(result.injected.map((item) => item.path)).toEqual([join(cwd, 'CLAUDE.md')])
    expect(composeSystemHint(result.injected)).toContain('FOLLOWED-INTO-THE-PROMPT')
  })

  it('🔴 733 · …and a `.claude` DIRECTORY that is a link is walked into, as the CLI walks it', () => {
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(elsewhere, { recursive: true })
    write(join(elsewhere, 'CLAUDE.md'), 'FOUND-THROUGH-A-LINKED-DOT-DIRECTORY')
    symlinkSync(elsewhere, join(cwd, '.claude'))

    const result = read()

    expect(result.refused).toEqual([])
    expect(result.injected.map((item) => item.path)).toEqual([join(cwd, '.claude', 'CLAUDE.md')])
    expect(composeSystemHint(result.injected)).toContain('FOUND-THROUGH-A-LINKED-DOT-DIRECTORY')
  })

  it('⚑ THE CONTROL, kept · a LOOP of links is refused — there is no file at the end of it', () => {
    // ⚑ The PM: *"Keep any link rule whose reason is NOT a credential (a loop, a missing target)"*.
    symlinkSync(join(cwd, 'CLAUDE.md'), join(cwd, 'CLAUDE.md'))

    const result = read()

    expect(result.injected).toEqual([])
    expect(result.refused).toEqual([{ path: join(cwd, 'CLAUDE.md'), reason: 'symlink' }])
  })

  it('🔴 733 · a link to NOTHING is still told, now in the words that are true of it (314 §3)', () => {
    // ⚑ The other kept rule: a missing target. ⛔ On `main` both rows said `symlink` — the walk
    // refused every link, and that refusal was also how a person learnt of a broken one. Following
    // must not make it silent, and `brokenMemoryLink` already says it with the target in hand.
    const gone = join(root, 'never-existed.md')
    symlinkSync(gone, join(cwd, 'CLAUDE.md'))
    const nowhere = join(root, 'no-such-directory')
    symlinkSync(nowhere, join(cwd, '.claude'))

    const result = read()

    expect(result.injected).toEqual([])
    expect(result.refused).toEqual([
      { path: join(cwd, 'CLAUDE.md'), reason: 'dangling-link', link: gone },
      { path: join(cwd, '.claude'), reason: 'dangling-link', link: nowhere },
    ])
  })

  it('🔴 733 · a followed link SAYS where it led, on the item itself (170 §2, on the walk)', () => {
    // ⛔ On `main` the link was refused, so there was nothing to disclose; following it silently
    // would put another file's text under this path with nothing on the row to say so.
    const target = write(join(root, 'kept-elsewhere.md'), 'FOLLOWED-AND-SAID')
    symlinkSync(target, join(cwd, 'CLAUDE.md'))

    const [item] = read().injected
    expect(item?.path).toBe(join(cwd, 'CLAUDE.md'))
    expect(item?.link).toBe(realpathSync(target))
  })

  it('⚑ THE CONTROL — a plain file carries no link, though the tmp directory above it is an alias', () => {
    // `tmpdir()` is `/var/folders/…` on macOS and really `/private/var/…`: an aliased PARENT is not
    // a link, which is why the comparison is made through the real directory.
    write(join(cwd, 'CLAUDE.md'), 'A PLAIN FILE')
    const [item] = read().injected
    expect(item?.path).toBe(join(cwd, 'CLAUDE.md'))
    expect(item?.link).toBeUndefined()
  })

  it('🔴 733 · one file reached by TWO names is sent once — `CLAUDE.md -> AGENTS.md` (HO-075 §1)', () => {
    // ⛔ Following links, a repository whose `CLAUDE.md` is a link to its `AGENTS.md` — a common
    // convention — would have the same conventions appended twice. On `main` the link was refused.
    const agents = write(join(cwd, 'AGENTS.md'), 'THE CONVENTIONS, ONCE')
    symlinkSync('AGENTS.md', join(cwd, 'CLAUDE.md'))

    const result = read()
    expect(result.injected.map((item) => item.path)).toEqual([agents])
    expect(result.composed?.split('THE CONVENTIONS, ONCE').length).toBe(2)
    expect(result.refused).toEqual([
      { path: join(cwd, 'CLAUDE.md'), reason: 'same-file', link: realpathSync(agents) },
    ])
  })

  it('⚑ THE CONTROL — two REAL files that say the same thing are both sent (576: no content dedupe)', () => {
    write(join(cwd, 'AGENTS.md'), 'SAID TWICE, ON PURPOSE')
    write(join(cwd, 'CLAUDE.md'), 'SAID TWICE, ON PURPOSE')

    const result = read()
    expect(result.injected.map((item) => item.path)).toEqual([
      join(cwd, 'AGENTS.md'),
      join(cwd, 'CLAUDE.md'),
    ])
    expect(result.refused).toEqual([])
  })

  it('🔴 736 · `733` F-1 — a link that lands in the person’s OWN instructions is FOLLOWED and sent once, as the CLI sends it', () => {
    // ⛔ On `main` (`733`): refused as `personal-home` — a rule of this app's own, at the leaf.
    // ⚑ Measured (`736`'s scratch of the bundled CLI 2.1.281, print mode): a project `CLAUDE.md`
    // that is a link to `~/.claude/CLAUDE.md` or to `~/CLAUDE.md` is SENT, once, as *"Contents of
    // <the project's CLAUDE.md> (project instructions, checked into the codebase)"*. R92: this app
    // follows what the CLI follows.
    const personal = write(join(home, 'CLAUDE.md'), 'PERSONAL-HOME-MEMORY')
    write(join(home, '.claude', 'CLAUDE.md'), 'PERSONAL-DOT-MEMORY')
    symlinkSync(personal, join(cwd, 'CLAUDE.md'))
    symlinkSync(join(home, '.claude'), join(cwd, '.claude'))
    const notes = write(join(home, 'notes', 'project.md'), 'AN ORDINARY FILE UNDER HOME')
    symlinkSync(notes, join(cwd, '..', 'CLAUDE.md'))

    const result = read()
    expect(result.refused).toEqual([])
    expect(result.composed ?? '').toMatch(/PERSONAL-HOME-MEMORY/)
    expect(result.composed ?? '').toMatch(/PERSONAL-DOT-MEMORY/)
    // ⚑ …under the PROJECT's name, as the CLI labels it, and saying where the link led.
    const byPath = new Map(result.injected.map((item) => [item.path, item]))
    expect(byPath.get(join(cwd, 'CLAUDE.md'))?.link).toBe(realpathSync(personal))
    expect(byPath.get(join(cwd, '.claude', 'CLAUDE.md'))?.link).toBe(
      realpathSync(join(home, '.claude', 'CLAUDE.md')),
    )
    // ⚑ THE CONTROL — the walk itself still stops below home (156 §1): home's own `CLAUDE.md`, not
    // reached by a link, is not on it, so it is sent once — through the link — and never twice.
    expect(
      result.injected.filter((item) => item.text.includes('PERSONAL-HOME-MEMORY')),
    ).toHaveLength(1)
  })

  it('⛔ a NON-REGULAR file — a directory where a file should be', () => {
    mkdirSync(join(cwd, 'CLAUDE.md'), { recursive: true })

    const result = read()

    expect(result.injected).toEqual([])
    expect(result.refused).toEqual([{ path: join(cwd, 'CLAUDE.md'), reason: 'not-a-regular-file' }])
  })

  it('⛔ …and a FIFO, which would otherwise block the launch forever', () => {
    // The case that is worse than wrong: a named pipe with no writer blocks on `read`
    // indefinitely, so the session never starts and nothing says why — from a file the agent can
    // create in its own cwd. The refusal comes from the `stat` before anything is opened (and the
    // open is `O_NONBLOCK` besides, since `733`), which is why this test can run at all.
    execFileSync('mkfifo', [join(cwd, 'CLAUDE.md')])

    const result = read()

    expect(result.injected).toEqual([])
    expect(result.refused).toEqual([{ path: join(cwd, 'CLAUDE.md'), reason: 'not-a-regular-file' }])
  })

  it('⛔ an OVERSIZED file is cut at the cap, and the cap is enforced DURING the read', () => {
    // ⚠️ The distinction 158 §1 insists on: a reader that trusted `stat.size` to size a buffer
    // would allocate whatever the file claimed. This one reads in fixed chunks and stops.
    const big = 'x'.repeat(INSTRUCTION_FILE_CAP * 3)
    write(join(cwd, 'CLAUDE.md'), big)

    const result = read()

    const item = result.injected[0]
    expect(item?.truncated).toBe(true)
    expect(item?.bytes).toBe(INSTRUCTION_FILE_CAP)
    expect(item?.text.length).toBe(INSTRUCTION_FILE_CAP)
    // …and what actually went to the model is the cut text, not the file.
    expect(composeSystemHint(result.injected)?.length).toBeLessThan(big.length)
  })

  it('a file that ends exactly ON the cap is NOT reported as truncated', () => {
    // "Cut short" is a warning, and a warning about nothing trains people to ignore it.
    write(join(cwd, 'CLAUDE.md'), 'y'.repeat(INSTRUCTION_FILE_CAP))

    expect(read().injected[0]?.truncated).toBe(false)
  })

  it('⛔ INVALID UTF-8 is refused, not replaced with question marks', () => {
    writeFileSync(join(cwd, 'CLAUDE.md'), Buffer.from([0x68, 0x69, 0xff, 0xfe, 0x0a]))

    const result = read()

    expect(result.injected).toEqual([])
    expect(result.refused).toEqual([{ path: join(cwd, 'CLAUDE.md'), reason: 'not-utf8' }])
  })

  it('a BOM is consumed and never reaches the model', () => {
    writeFileSync(
      join(cwd, 'CLAUDE.md'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('be terse')]),
    )

    const text = read().injected[0]?.text

    expect(text).toBe('be terse')
    expect(text?.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('a multi-byte character split by the cap does not fail the whole file', () => {
    // The cap lands mid-sequence on purpose. Refusing here would reject a valid file for the
    // truncation's own sake — the trailing partial sequence is dropped instead.
    const path = join(cwd, 'CLAUDE.md')
    writeFileSync(path, '€'.repeat(100))

    const result = readInstructionFile(path, 10) // 10 bytes = three 3-byte € plus one stray byte

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toBe('€€€')
      expect(result.truncated).toBe(true)
    }
  })

  it('an absent file is ABSENT, and an unreadable one is refused — never the same answer', () => {
    expect(readInstructionFile(join(cwd, 'nope.md'))).toEqual({ ok: false, reason: 'absent' })

    const walled = join(root, 'walled')
    mkdirSync(walled, { recursive: true })
    const path = write(join(walled, 'CLAUDE.md'), 'secret')
    chmodSync(path, 0o000)
    try {
      // Root can read anything, so this assertion is only meaningful unprivileged; either way the
      // answer must not be `absent`, which is the distinction under test.
      const result = readInstructionFile(path)
      expect(result.ok ? 'read-it' : result.reason).not.toBe('absent')
    } finally {
      chmodSync(path, 0o600)
    }
  })
})

/* ------------------------------------------------------------- the composed text */

describe('what actually goes to the model', () => {
  it('names every file it appends, so a rule is attributable to its source', () => {
    write(join(providerHome, 'CLAUDE.md'), 'profile rule')
    write(join(cwd, 'CLAUDE.md'), 'project rule')

    const hint = composeSystemHint(read().injected) ?? ''

    expect(hint).toContain(`Contents of ${join(providerHome, 'CLAUDE.md')}`)
    expect(hint).toContain(`Contents of ${join(cwd, 'CLAUDE.md')}`)
    expect(hint).toContain('profile rule')
    expect(hint).toContain('project rule')
  })

  it('the app’s OWN workspace file is labelled as the app’s, not as the user’s', () => {
    const workspaceFile = write(join(cwd, 'CLAUDE.md'), 'generated by the app')

    const result = read({ workspaceFile })

    expect(result.injected[0]?.kind).toBe('workspace-instructions')
  })

  it('⚠️ …and it is still the app’s through an ALIASED cwd (170 §4)', () => {
    // The third lexical comparison the class audit found. `resolve(path) === resolve(workspaceFile)`
    // answered "no" for a cwd that reaches the workspace through a link, and the direction of that
    // mistake is the wrong one: BroBot's own generated file would have been labelled as project
    // memory the user wrote, which is the exact provenance claim this label exists to make.
    const workspaceDir = join(root, 'brobot-workspace')
    mkdirSync(workspaceDir, { recursive: true })
    const workspaceFile = write(join(workspaceDir, 'CLAUDE.md'), 'generated by the app')
    const alias = join(root, 'workspace-alias')
    symlinkSync(workspaceDir, alias)

    const result = read({ cwd: alias, workspaceFile })

    expect(result.injected.map((i) => i.kind)).toEqual(['workspace-instructions'])
    // …and the paired negative: an ordinary file beside it is still the user's.
    const other = join(root, 'other')
    mkdirSync(other, { recursive: true })
    write(join(other, 'CLAUDE.md'), 'a real project file')
    expect(read({ cwd: other, workspaceFile }).injected.map((i) => i.kind)).toEqual([
      'project-memory',
    ])
  })

  it('the total budget bounds the whole append, not just each file', () => {
    // Four files at the per-file cap would be 256 KB on every request of the conversation.
    for (const dir of [join(root, 'work'), join(root, 'work', 'repo'), cwd]) {
      write(join(dir, 'CLAUDE.md'), 'z'.repeat(INSTRUCTION_FILE_CAP))
      write(join(dir, '.claude', 'CLAUDE.md'), 'z'.repeat(INSTRUCTION_FILE_CAP))
    }

    const bytes = read().injected.reduce((sum, item) => sum + item.bytes, 0)

    expect(bytes).toBeLessThanOrEqual(256 * 1024)
  })
})

/* ------------------------------------------- the cap, and what it drops (187 §2) */

/**
 * ⛔ **168 M2, both halves** — re-verified live at `a333ba3` by 182 §5 and fixed here.
 *
 *  1. **`take` returned silently once the budget was exhausted**, and it spent that budget in
 *     PROMPT order — profile memory, then the chain outermost → innermost. So the files NEAREST the
 *     agent were the first to vanish and **neither the prompt nor the drawer got a row**.
 *  2. **The budget counted FILE BYTES ONLY.** `composeSystemHint` then added a preamble and one
 *     `Contents of <path> (<scope>):` header per file, so what was actually emitted could exceed the
 *     advertised 256 KiB cap — by more, the more files there were.
 *
 * Show every injected prompt or system hint. A source dropped for budget needs a visible row
 * just as a source declined by the reader does; silence cannot explain why it was omitted.
 */
describe('⛔ the instruction budget (187 §2, from 168 M2)', () => {
  /** Enough real files, big enough, that the 256 KiB cap is genuinely reached. */
  const fillTheChain = (): void => {
    write(join(providerHome, 'CLAUDE.md'), `profile ${'p'.repeat(INSTRUCTION_FILE_CAP - 8)}`)
    for (const dir of [join(root, 'work'), join(root, 'work', 'repo'), cwd]) {
      write(join(dir, 'CLAUDE.md'), `plain ${'z'.repeat(INSTRUCTION_FILE_CAP - 6)}`)
      write(join(dir, '.claude', 'CLAUDE.md'), `dot ${'z'.repeat(INSTRUCTION_FILE_CAP - 4)}`)
    }
  }

  /**
   * ⛔ **The fixture that DISCRIMINATES, and the mutation table is why it exists.**
   *
   * `fillTheChain`'s six 64 KiB files do not tell the two accountings apart: 261,951 bytes of budget
   * divided by 65,536 admits three files whether or not the headers are charged, so the emitted text
   * fits the cap either way and `M6` came back GREEN on the first run of the table.
   *
   * ⚠️ **65,487 bytes is chosen, not round.** It is `floor((256 KiB − preamble) / 4)`, so under the
   * OLD accounting — file bytes only — exactly four files fit, with three bytes of budget to spare
   * and four headers still to emit. The emitted string is then over the cap by every header, which
   * is 168 M2's second half exactly. Under the accounting this dispatch shipped, the same four
   * cost their headers too, the fourth does not fit, and three go out.
   *
   * ⚑ It is also just under {@link INSTRUCTION_FILE_CAP} (65,536), so nothing here is truncated and
   * the arithmetic is about the TOTAL cap alone.
   */
  const fillToTheByte = (): void => {
    // No profile memory: it is granted ahead of the chain, and leaving it out keeps this test about
    // one quantity.
    for (const dir of [join(root, 'work'), join(root, 'work', 'repo'), cwd]) {
      write(join(dir, 'CLAUDE.md'), 'z'.repeat(65_487))
      write(join(dir, '.claude', 'CLAUDE.md'), 'z'.repeat(65_487))
    }
  }

  it('⛔ what is EMITTED fits the cap when the headers are what tips it over', () => {
    fillToTheByte()

    const result = read()
    const hint = composeSystemHint(result.injected) ?? ''

    expect(Buffer.byteLength(hint, 'utf8')).toBeLessThanOrEqual(INSTRUCTION_TOTAL_CAP)
    // ⚠️ Three, not four. The fourth file's own bytes fit; its header does not — and a run that
    // emitted four would be over the cap by exactly the headers 168 M2 found uncounted.
    expect(result.injected).toHaveLength(3)
    // …and the paired positive: the budget really is nearly spent, so this is not passing by
    // emitting almost nothing.
    expect(Buffer.byteLength(hint, 'utf8')).toBeGreaterThan(INSTRUCTION_TOTAL_CAP * 0.7)
  })

  it('⛔ what is EMITTED fits the cap — headers counted, not just the file bytes', () => {
    fillTheChain()

    const hint = composeSystemHint(read().injected) ?? ''

    // ⚠️ The composed string, weighed in UTF-8 bytes. This is the number that goes on the wire, and
    // it is the number the cap advertises; before 187 they were different figures. The sum of
    // `item.bytes` is NOT this — that was the old assertion, and it passed while the emitted text
    // was over by every header.
    expect(Buffer.byteLength(hint, 'utf8')).toBeLessThanOrEqual(INSTRUCTION_TOTAL_CAP)
    // …and the paired positive: it is not passing by emitting almost nothing. Well over half the
    // budget is real instruction text.
    expect(Buffer.byteLength(hint, 'utf8')).toBeGreaterThan(INSTRUCTION_TOTAL_CAP / 2)
  })

  it('⛔ a file dropped for budget is a ROW, with its reason — silence was the defect', () => {
    fillTheChain()

    const result = read()

    const dropped = result.refused.filter((item) => item.reason === 'over-budget')
    expect(dropped.length).toBeGreaterThan(0)
    // Every dropped path is a real file that was read and understood — not a refusal of the
    // reader's, which is a different sentence for a different fix.
    for (const item of dropped) expect(existsSync(item.path)).toBe(true)
    // ⚑ The paired positive: an under-budget file is still loaded and still labelled. A reader that
    // dropped everything would satisfy the assertion above on its own.
    expect(result.injected.length).toBeGreaterThan(0)
    for (const item of result.injected) {
      expect(item.text.length).toBeGreaterThan(0)
      expect(['profile-memory', 'project-memory']).toContain(item.kind)
    }
    // Nothing is in both lists — a file is sent or it is reported, never counted twice.
    const sent = new Set(result.injected.map((item) => item.path))
    for (const item of dropped) expect(sent.has(item.path)).toBe(false)
  })

  it('⚑ an ordinary chain drops NOTHING — the negative that makes the row mean something', () => {
    // Without this, a reader that reported every file as over-budget would pass the test above.
    write(join(providerHome, 'CLAUDE.md'), 'I am the developer profile.')
    write(join(root, 'work', 'repo', 'CLAUDE.md'), 'outer')
    write(join(cwd, 'CLAUDE.md'), 'be terse in this repo')

    const result = read()

    expect(result.refused).toEqual([])
    expect(result.injected.map((item) => item.text)).toEqual([
      'I am the developer profile.',
      'outer',
      'be terse in this repo',
    ])
  })

  it('⛔ the budget is spent NEAREST-FIRST — the ruling, asserted', () => {
    // ⚠️ **The policy 187 §2 was asked to rule on.** First-come-first-served in prompt order drops
    // the file in the agent's own working directory and keeps one three levels up — the reverse of
    // what a reader expects, and backwards on the prompt's own terms: these blocks are appended in
    // order and later text wins, so the entries being dropped were the ones that would have decided
    // a disagreement. The budget is granted in REVERSE prompt order now.
    fillTheChain()

    const result = read()
    const sent = result.injected.map((item) => item.path)

    // The two files IN the working directory survive…
    expect(sent).toContain(join(cwd, '.claude', 'CLAUDE.md'))
    expect(sent).toContain(join(cwd, 'CLAUDE.md'))
    // …and the OUTERMOST thing on the chain is what gives way.
    expect(sent).not.toContain(join(root, 'work', 'CLAUDE.md'))
    expect(sent).not.toContain(join(root, 'work', '.claude', 'CLAUDE.md'))
  })

  it('⚠️ …except the profile’s own memory, which is identity rather than chain', () => {
    // The one deliberate exception to "keep what would have won". It is not on the project chain —
    // it is who the agent IS, for every project — and dropping that to keep a rule from three
    // directories above the repo is the wrong trade. Here it is 64 KiB and still survives six
    // 64 KiB project files.
    fillTheChain()

    const result = read()

    expect(result.injected.map((item) => item.path)).toContain(join(providerHome, 'CLAUDE.md'))
    expect(result.injected[0]?.kind).toBe('profile-memory')
  })

  it('⚠️ …and the SURVIVORS are still emitted in prompt order — 158’s ordering is untouched', () => {
    // The reverse walk decides what survives and says nothing about presentation. A drawer or a
    // prompt that came out innermost-first would be a second, silent change riding along with this
    // one.
    fillTheChain()

    const result = read()
    const hint = composeSystemHint(result.injected) ?? ''
    const positions = result.injected.map((item) => hint.indexOf(item.path))

    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    // ⚠️ Paired with a positive, or a run that emitted ONE file would satisfy the sort above.
    expect(positions.length).toBeGreaterThan(1)
    expect(positions.every((at) => at >= 0)).toBe(true)
    // Concretely: the profile's memory still leads, then the working directory's own two, in the
    // order 158 chose — although the budget granted them in the opposite order.
    expect(result.injected.map((item) => item.path)).toEqual([
      join(providerHome, 'CLAUDE.md'),
      join(cwd, 'CLAUDE.md'),
      join(cwd, '.claude', 'CLAUDE.md'),
    ])
  })

  it('⚠️ one oversized file does not evict the small ones behind it', () => {
    // `continue`, not `break`. Stopping at the first thing that will not fit would drop strictly
    // more than this does, for no reason a user could see.
    write(join(providerHome, 'CLAUDE.md'), 'profile memory, tiny')
    write(join(root, 'work', 'CLAUDE.md'), 'outermost, tiny')
    // Two 64 KiB files in the working directory and 190 KiB of budget between them: the third
    // 64 KiB file cannot fit, but the two tiny ones can.
    for (const dir of [join(root, 'work', 'repo'), cwd]) {
      write(join(dir, 'CLAUDE.md'), 'z'.repeat(INSTRUCTION_FILE_CAP))
      write(join(dir, '.claude', 'CLAUDE.md'), 'z'.repeat(INSTRUCTION_FILE_CAP))
    }

    const sent = read().injected.map((item) => item.path)

    expect(sent).toContain(join(providerHome, 'CLAUDE.md'))
    expect(sent).toContain(join(root, 'work', 'CLAUDE.md'))
  })

  it('⛔ a dropped file is dropped WHOLE — never a rule cut off mid-sentence', () => {
    fillTheChain()

    const result = read()

    // Every item that was sent is either the entire file or the per-file cap — the only truncation
    // in this app is the one disclosed on the item itself.
    for (const item of result.injected) {
      expect(item.bytes === INSTRUCTION_FILE_CAP || item.truncated === false).toBe(true)
    }
  })

  it('⚠️ the budget survives a chain of MULTI-BYTE files — bytes, not string length', () => {
    // `'…'` is three UTF-8 bytes per character. A length-based budget would under-charge this chain
    // by a factor of three and emit ~700 KiB under a 256 KiB cap.
    const wide = '…'.repeat(Math.floor(INSTRUCTION_FILE_CAP / 3))
    write(join(providerHome, 'CLAUDE.md'), wide)
    for (const dir of [join(root, 'work'), join(root, 'work', 'repo'), cwd]) {
      write(join(dir, 'CLAUDE.md'), wide)
      write(join(dir, '.claude', 'CLAUDE.md'), wide)
    }

    const hint = composeSystemHint(read().injected) ?? ''

    expect(Buffer.byteLength(hint, 'utf8')).toBeLessThanOrEqual(INSTRUCTION_TOTAL_CAP)
  })
})

/* ------------------------------- the memory the AGENT writes (165, moved by 166) */

describe('the agent’s own memory', () => {
  /** The runtime's derivation, used so the test cannot pass by agreeing with a copy of itself. */
  const memoryIndex = (): string => claudeAutoMemoryIndex(providerHome)

  it('🔴 the drawer still finds it after 166 moved it — and finds it from ANY working directory', () => {
    // ⛔ §3: moving the directory must not break the surface 165 built. The reader takes no cwd at
    // all now, so this asserts the consequence rather than the signature: one memory, read from two
    // different projects under the same profile, which is the ticket's middle row seen from the UI.
    write(memoryIndex(), '- [Codename](codename.md) — BROBOT-CANARY')

    const otherProject = join(root, 'other-project')
    mkdirSync(otherProject, { recursive: true })
    const here = read()
    const elsewhere = read({ cwd: otherProject })

    expect(here.agentMemory[0]?.path).toBe(join(providerHome, 'memory', 'MEMORY.md'))
    expect(here.agentMemory[0]?.text).toContain('BROBOT-CANARY')
    // ⚑ The same file, the same text, from a second project. Before 166 this was `null`.
    expect(elsewhere.agentMemory[0]?.path).toBe(here.agentMemory[0]?.path)
    expect(elsewhere.agentMemory[0]?.text).toContain('BROBOT-CANARY')
    // …and nothing about the session leaked into the path it reports.
    expect(here.agentMemory[0]?.path).not.toContain('projects')
  })

  it('shows the instruction file that was read', () => {
    // Display this provider-injected hint in the conversation even though the person did not
    // choose it. Provider ownership does not make the appended text less important to
    // disclose.
    write(memoryIndex(), '- [Project codename](codename.md) — the internal name is BROBOT-CANARY')

    const result = read()

    expect(result.agentMemory[0]?.kind).toBe('agent-memory')
    expect(result.agentMemory[0]?.path).toBe(memoryIndex())
    expect(result.agentMemory[0]?.text).toContain('BROBOT-CANARY')
    expect(result.agentMemory[0]?.bytes).toBeGreaterThan(0)
    // ⚑ 317 §2.2 · and it says the model was GIVEN this, which for Claude's index it was: 312
    // watched a real child answer from it with no tool call.
    expect(result.agentMemory[0]?.reach).toBe('prompt')
  })

  it('🔴 …and is NOT appended — the provider already sent it, and twice is a lie about the prompt', () => {
    // ⛔ The assertion this whole design turns on. Putting the memory in `injected` would double it
    // in the prompt AND claim BroBot chose to send it. It is read for display only.
    write(memoryIndex(), 'remembered: BROBOT-CANARY')
    write(join(providerHome, 'CLAUDE.md'), 'I am the developer profile.')

    const result = read()

    expect(result.injected.map((i) => i.kind)).not.toContain('agent-memory')
    expect(composeSystemHint(result.injected) ?? '').not.toContain('BROBOT-CANARY')
    // …while the thing we DO append is still appended, so this is a distinction and not a deletion.
    expect(composeSystemHint(result.injected)).toContain('I am the developer profile.')
  })

  it('⚠️ renders nothing before the agent has written anything — 158’s rule, unchanged', () => {
    // What a user sees the first time: no memory row at all, because there is no directory yet.
    // An empty section would be 086 in the other direction — a feature announced by its absence.
    expect(read().agentMemory).toEqual([])
  })

  it('⚠️ …and an empty index is the same as none — a heading over no text is not a disclosure', () => {
    write(memoryIndex(), '   \n\n')
    expect(read().agentMemory).toEqual([])
  })

  it('🔴 a SYMLINKED index is FOLLOWED and SHOWN — and since `733` a project file is too (170 §2)', () => {
    // ⛔ **168 H3, and the contrast is the whole finding.** The pinned CLI loads this file with
    // `stat`, not `lstat`, so the target's text is in the model's system prompt before any BroBot
    // code runs. Refusing it here removed the row from the drawer and removed NOTHING from the
    // prompt — no visibility and no protection, which is worse than either.
    //
    // 🔴 **733 · the other half of this test was the contrast, and the contrast is gone.** The file
    // BroBot APPENDS was refused here — the refusal was what stopped this app putting the target in
    // the prompt, for the credential it might be. R93 removed that reason; the CLI follows both.
    const elsewhere = write(join(root, 'elsewhere.md'), 'REMEMBERED-FROM-SOMEWHERE-ELSE')
    mkdirSync(join(memoryIndex(), '..'), { recursive: true })
    symlinkSync(elsewhere, memoryIndex())
    const linked = write(join(root, 'linked.md'), 'FOLLOWED-INTO-THE-PROMPT')
    symlinkSync(linked, join(cwd, 'CLAUDE.md'))

    const result = read()

    // Followed, shown, and the redirection stated — the user can see where the text really is.
    expect(result.agentMemory[0]?.text).toContain('REMEMBERED-FROM-SOMEWHERE-ELSE')
    expect(result.agentMemory[0]?.path).toBe(memoryIndex())
    expect(result.agentMemory[0]?.link).toBe(realpathSync(elsewhere))
    // …and NOT as a refusal: a source that reached the model is not an absence.
    expect(result.refused.map((r) => r.path)).not.toContain(memoryIndex())

    // ⛔ On `main` the appended file was refused, named, and its text reached nothing.
    expect(result.refused).toEqual([])
    expect(result.injected.map((item) => item.path)).toEqual([join(cwd, 'CLAUDE.md')])
    expect(composeSystemHint(result.injected) ?? '').toContain('FOLLOWED-INTO-THE-PROMPT')
  })

  it('⛔ a source it DECLINES is a row with a reason — silence was the defect (170 §2)', () => {
    // `readAgentMemory` collapsed every read failure to `null`, so a `MEMORY.md` the provider had
    // loaded and BroBot could not read showed as a session with no memory at all. Every non-absent
    // failure is now a refused row, exactly like every file on the project chain.
    writeFileSync(write(memoryIndex(), ''), Buffer.from([0x68, 0x69, 0xff, 0xfe, 0x0a]))

    const result = read()

    expect(result.agentMemory).toEqual([])
    expect(result.refused).toContainEqual({ path: memoryIndex(), reason: 'not-utf8' })
  })

  it('⛔ …and a DIRECTORY where the index should be says so too', () => {
    mkdirSync(memoryIndex(), { recursive: true })

    expect(read().refused).toContainEqual({
      path: memoryIndex(),
      reason: 'not-a-regular-file',
    })
  })

  it('🔒 a link to a FIFO is still refused — following relaxed one question, not the reader', () => {
    // ⚠️ The guard that matters most on this path: a named pipe with no writer blocks on `read`
    // forever, so the session never starts and nothing says why. `stat` follows the link and the
    // regular-file test still runs BEFORE anything is opened, which is why this test terminates.
    const fifo = join(root, 'pipe')
    execFileSync('mkfifo', [fifo])
    mkdirSync(join(memoryIndex(), '..'), { recursive: true })
    symlinkSync(fifo, memoryIndex())

    const result = read()

    expect(result.agentMemory).toEqual([])
    expect(result.refused).toContainEqual({ path: memoryIndex(), reason: 'not-a-regular-file' })
  })

  /**
   * 🔴 **This test used to assert the opposite, and 314 §3 is the reversal.**
   *
   * ⛔ **What stood here:** *"a DANGLING link is ABSENT, not refused — nothing reached the model
   * either … the provider's own `stat` fails the same way, so there is no source to report."* Every
   * clause of that is true about the PROMPT and none of it is true about the PANEL.
   *
   * A Claude child can follow `memory/MEMORY.md` outside its provider home and answer from
   * the target. If the target is in `/private/tmp`, reboot can remove it and leave a dangling
   * link. `link` discloses a readable target; the ENOENT case must also explain the loss
   * instead of becoming a silent `absent` row.
   *
   * ⚠️ **"Nothing reached the model" is exactly when a user needs telling.** The old row's reasoning
   * would be right for a path that was never there; it is wrong for a link, because a link is
   * somebody's statement that something IS there.
   */
  it('🔴 a DANGLING link is DISCLOSED — absent is silent, a broken link is not (314 §3)', () => {
    mkdirSync(join(memoryIndex(), '..'), { recursive: true })
    symlinkSync(join(root, 'never-existed.md'), memoryIndex())

    const result = read()

    expect(result.agentMemory).toEqual([])
    expect(result.refused).toEqual([
      { path: memoryIndex(), reason: 'dangling-link', link: join(root, 'never-existed.md') },
    ])
  })

  it('⛔ …and the `memory/` DIRECTORY being the broken link is disclosed too', () => {
    // ⚠️ **The leaf cannot be `lstat`ed at all in this shape** — there is no path to it — so a check
    // that only looked at the index would be silent about the wider of the two failures. 170's
    // `link` field already covered both; this covers both.
    symlinkSync(join(root, 'no-such-dir'), join(memoryIndex(), '..'))

    const result = read()

    expect(result.agentMemory).toEqual([])
    expect(result.refused).toEqual([
      {
        path: join(memoryIndex(), '..'),
        reason: 'dangling-link',
        link: join(root, 'no-such-dir'),
      },
    ])
  })

  it('⚑ …and a home with no memory at all is still SILENT — absent is not a refusal', () => {
    // 🔒 **The control, and the half that keeps 158's rule.** Before the agent has written anything
    // there is no `memory/` directory, which is the ordinary first state of every profile. A row
    // there would be 086 in the other direction — a warning about a file nobody created.
    expect(read().refused).toEqual([])
    expect(read().agentMemory).toEqual([])
  })

  it('⚑ …and a memory DIRECTORY with no index yet is silent too — it is not a link', () => {
    // ⛔ **The state right after the agent's first write creates the directory and before it writes
    // the index**, and the control that keeps the check narrow: the row is about a LINK, not about
    // anything missing under `memory/`. A check that fired on an ordinary directory would put a
    // warning on every profile that has started remembering.
    mkdirSync(join(memoryIndex(), '..'), { recursive: true })

    expect(read().refused).toEqual([])
    expect(read().agentMemory).toEqual([])
  })

  it('🔴 …and a WORKING `memory/` link with no index yet is silent — a redirect is not a loss', () => {
    // ⛔ **Found reviewing 314's own diff, not by a report.** Somebody may point `memory/` at a real
    // directory on another disk on purpose; before the agent writes its first index there is no
    // `MEMORY.md` at the far end, and the leaf cannot be `lstat`ed. A check that asked only *is this
    // a symlink* answered yes and told them their memory was gone. The question is whether the link
    // leads ANYWHERE.
    const elsewhere = join(root, 'memory-on-another-disk')
    mkdirSync(elsewhere, { recursive: true })
    mkdirSync(join(memoryIndex(), '..', '..'), { recursive: true })
    symlinkSync(elsewhere, join(memoryIndex(), '..'))

    expect(read().refused).toEqual([])
    expect(read().agentMemory).toEqual([])
    // …and the paired positive: the SAME link, once its target is gone, is disclosed (193).
    rmSync(elsewhere, { recursive: true, force: true })
    expect(read().refused).toEqual([
      { path: join(memoryIndex(), '..'), reason: 'dangling-link', link: elsewhere },
    ])
  })

  it('⚑ …and a link that WORKS is still followed and still disclosed on `link`, not refused', () => {
    // 🔒 **170 §2 is not reopened by 314.** Refusing here protects nothing: the provider followed
    // this link before BroBot was asked anything. The two rulings are one rule — say what happened.
    const target = join(root, 'external-memory.md')
    write(target, 'remembered: BROBOT-ELSEWHERE')
    mkdirSync(join(memoryIndex(), '..'), { recursive: true })
    symlinkSync(target, memoryIndex())

    const result = read()

    expect(result.agentMemory[0]?.text).toContain('BROBOT-ELSEWHERE')
    expect(result.agentMemory[0]?.link).toBe(realpathSync(target))
    expect(result.refused).toEqual([])
  })

  it('⚑ an ORDINARY index reports no link — the disclosure is not decoration', () => {
    // ⚠️ The trap this pins: on macOS the provider home really lives under `/private/var/folders/…`
    // while every path here is spelled `/var/folders/…`. Comparing the file's real path against
    // anything but the SAME derivation would mark every ordinary session as redirected.
    write(memoryIndex(), 'remembered: BROBOT-CANARY')

    const result = read()

    expect(result.agentMemory[0]?.text).toContain('BROBOT-CANARY')
    expect(result.agentMemory[0]?.link).toBeUndefined()
    expect(result.refused).toEqual([])
  })

  it('⛔ does not spend the APPEND budget — this text is not appended', () => {
    // The total cap bounds what goes into the prompt from us. Charging it for a file the provider
    // sends would silently shrink the profile and project memory that we do append.
    write(memoryIndex(), 'x'.repeat(200 * 1024))
    write(join(providerHome, 'CLAUDE.md'), 'I am the developer profile.')
    write(join(cwd, 'CLAUDE.md'), 'be terse in this repo')

    const result = read()

    expect(result.injected.map((i) => i.kind)).toEqual(['profile-memory', 'project-memory'])
    expect(composeSystemHint(result.injected)).toContain('be terse in this repo')
  })

  /**
   * 🔴 **This test used to assert that Codex has no memory, and 317 is the reversal.**
   *
   * ⛔ **What stood here:** *"is not read for Codex, which has no agent-written memory at this pin
   * (165 §4)"*, asserting `agentMemory` was `null` for a Codex session. It was measured, it was
   * true, and **314 made it false** by switching `[features] memories` and `[memories]
   * dedicated_tools` on for every Codex profile.
   *
   * ⚠️ **The half that survives is the one this keeps**: a Codex session must not be handed
   * CLAUDE's memory index. `claudeAutoMemoryIndex` is a fact about a different provider's directory
   * scheme, and reading it for Codex would put another agent's memory on this panel.
   */
  it('🔴 does not read CLAUDE’s index for a Codex session — a different provider, a different store', () => {
    write(memoryIndex(), 'remembered: BROBOT-CANARY')

    const result = read({ provider: 'codex' })

    expect(JSON.stringify(result)).not.toContain('BROBOT-CANARY')
    expect(result.agentMemory).toEqual([])
  })

  it('⚑ the ORDER the model receives them in, and the drawer matches it (165 §3)', () => {
    // Auto-memory rides INSIDE the provider's preset system prompt; everything BroBot reads is
    // `append`ed AFTER that preset. So the agent's memory reaches the model first, then the
    // profile's own `CLAUDE.md`, then the project chain outermost → innermost. The panel renders
    // the memory row above `injected` for exactly this reason.
    write(memoryIndex(), 'remembered: BROBOT-CANARY')
    write(join(providerHome, 'CLAUDE.md'), 'profile text')
    write(join(root, 'work', 'repo', 'CLAUDE.md'), 'outer text')
    write(join(cwd, 'CLAUDE.md'), 'inner text')

    const result = read()

    expect(result.agentMemory).toHaveLength(1)
    expect(result.injected.map((i) => i.kind)).toEqual([
      'profile-memory',
      'project-memory',
      'project-memory',
    ])
    const hint = composeSystemHint(result.injected) ?? ''
    expect(hint.indexOf('profile text')).toBeLessThan(hint.indexOf('outer text'))
    expect(hint.indexOf('outer text')).toBeLessThan(hint.indexOf('inner text'))
  })
})

/* --------------------------- what a CODEX profile remembers (317, from 314's gates) */

/**
 * The row must correct the memory explanation that became false.
 *
 * ⛔ **`instructions.ts` said Codex *"has no agent-written memory of its own"*, citing 165 §4.** It
 * was measured and it was true — until `314` switched `[features] memories` and `[memories]
 * dedicated_tools` on for every Codex profile in this app. From that commit the app was writing the
 * gate that creates the memory and, three functions away, telling the panel there was none.
 *
 * ⚑ **Friction log F4 is that gap, from the user's side**: *"codex claimed calling
 * `memories__add_ad_hoc_note` but I didn't see any of that in the conversation UI."* `316` then
 * measured that the CALL cannot be rendered — the 0.146.0 app-server publishes no `item/*` for it —
 * so what is asserted below is the remedy that remains: read what the agent wrote, and show it.
 *
 * ⚠️ **The tree is 312's**, measured on a real child rather than taken from a README.
 */
describe('a Codex profile’s memory (317)', () => {
  let codexHome: string

  beforeEach(() => {
    codexHome = join(root, 'provider-homes', 'default', 'default', 'codex')
    mkdirSync(codexHome, { recursive: true })
  })

  const codex = () => read({ provider: 'codex', providerHome: codexHome })
  const note = (name: string, text: string): string =>
    write(join(codexAdHocNotesDir(codexHome), name), text)
  const paths = (result: ReturnType<typeof codex>): string[] =>
    result.agentMemory.map((item) => item.path)

  it('🔴 the ad-hoc note a person ASKED for is on the panel — friction log F4, exactly', () => {
    // Use the measured filename convention and content shape for this case.
    note('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")

    const result = codex()
    const shown = result.agentMemory.find((item) => item.kind === 'agent-memory-note')

    expect(shown?.path).toBe(
      join(codexAdHocNotesDir(codexHome), '2026-09-04T00-00-00-user-name.md'),
    )
    expect(shown?.text).toContain("The user's name is Bob.")
    // ⚠️ …and it does NOT claim the model has read it. 009's rule: the note is in the store and
    // `memories__search` can reach it; that is availability, not comprehension.
    expect(shown?.reach).toBe('on-request')
  })

  it('⛔ …and the summary the provider INJECTS is separated from what merely exists (§2.2)', () => {
    // 312's eight-arm wire matrix captured `memory_summary.md` inside the model request and nothing
    // else from this tree. Flattening the two into one word is the claim 305 was written about.
    write(codexMemorySummary(codexHome), 'The user prefers terse answers.')
    write(codexMemoryIndex(codexHome), '# Handbook\n\n- prefers terse answers')
    note('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")

    const result = codex()
    const reach = Object.fromEntries(result.agentMemory.map((item) => [item.path, item.reach]))

    expect(reach[codexMemorySummary(codexHome)]).toBe('prompt')
    expect(reach[codexMemoryIndex(codexHome)]).toBe('on-request')
    expect(reach[join(codexAdHocNotesDir(codexHome), '2026-09-04T00-00-00-user-name.md')]).toBe(
      'on-request',
    )
    // ⚑ …and the injected one comes FIRST, because that is the order the model meets them in.
    expect(paths(result)[0]).toBe(codexMemorySummary(codexHome))
  })

  it('⛔ the pipeline’s own material is NOT a memory row — and is named rather than hidden', () => {
    // 🔴 **317 §2.1's ruling.** `raw_memories.md` is stage 1's dump and `rollout_summaries/` is one
    // machine-written précis per conversation the extractor ate; phase 2 rewrites both. Rendering
    // them as *"what the agent remembers"* invents a standing they do not have, and a person who
    // edited one would be editing an input.
    //
    // ⚠️ **The reason is NOT that the model cannot see them** — `memories__search` reaches the whole
    // directory. So they are excluded from the list and named in the note, which is the field whose
    // documented job is to say what the list does not include.
    write(join(codexMemoryDir(codexHome), 'raw_memories.md'), 'RAW-PIPELINE-DUMP')
    write(
      join(codexMemoryDir(codexHome), 'rollout_summaries', '2026-09-04T00-10-53-bWt1-thing.md'),
      'ROLLOUT-SUMMARY-TEXT',
    )
    write(codexMemorySummary(codexHome), 'The user prefers terse answers.')

    const result = codex()

    expect(paths(result)).toEqual([codexMemorySummary(codexHome)])
    // ⛔ Not merely absent from the list — absent from the payload, so no renderer can show it.
    expect(JSON.stringify(result.agentMemory)).not.toContain('RAW-PIPELINE-DUMP')
    expect(JSON.stringify(result.agentMemory)).not.toContain('ROLLOUT-SUMMARY-TEXT')
    // ⚑ …and the sentence says so, by name, so the list above reads as complete rather than as all
    // there is.
    expect(result.note).toContain('raw_memories.md')
    expect(result.note).toContain('rollout_summaries/')
    expect(result.note).toContain('not listed')
  })

  it('⚑ …and a store WITHOUT them says nothing about them — the sentence is a measurement', () => {
    // 193's rule. A note that always listed the pipeline files would be telling a fresh profile
    // about files it does not have, and would pass the assertions above with nothing behind them.
    write(codexMemorySummary(codexHome), 'The user prefers terse answers.')

    const result = codex()

    expect(result.note).not.toContain('raw_memories.md')
    expect(result.note).not.toContain('rollout_summaries')
    // …while the half that IS true of this profile is still said.
    expect(result.note).toContain('memory_summary.md')
  })

  it('⚠️ notes are listed NEWEST first and BOUNDED, and what is left out is counted (§3)', () => {
    // ⛔ **The cost of this addition, asserted rather than described.** 312's convention puts a
    // fixed-width timestamp at the front of every note name, so byte order is chronological order.
    // A store of a thousand one-line notes must not put a thousand rows on a drawer whose design is
    // "the paths are the disclosure" — and what is dropped must still be said.
    const total = AGENT_MEMORY_NOTES_SHOWN + 5
    for (let index = 0; index < total; index += 1) {
      note(`2026-09-${String(index + 1).padStart(2, '0')}T00-00-00-note.md`, `NOTE-${index}`)
    }

    const result = codex()
    const listed = result.agentMemory.filter((item) => item.kind === 'agent-memory-note')

    expect(listed).toHaveLength(AGENT_MEMORY_NOTES_SHOWN)
    // Newest first: the LAST note written is the first row, and the oldest is not there at all.
    expect(listed[0]?.text).toBe(`NOTE-${total - 1}`)
    expect(listed.map((item) => item.text)).not.toContain('NOTE-0')
    expect(result.note).toContain(`${AGENT_MEMORY_NOTES_SHOWN} of ${total} notes are listed`)
  })

  it('⚑ …and a store inside the bound says nothing about a count — the paired negative', () => {
    note('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")

    expect(codex().note).not.toContain('notes are listed')
  })

  it('⛔ does not spend the APPEND budget, and cannot be spent BY it (§3)', () => {
    // ⚠️ **Both directions, because each alone is satisfiable by the wrong code.** 165's ruling is
    // that memory does not draw on `INSTRUCTION_TOTAL_CAP`; 317's addition is that it has a budget
    // of its own, so a large store cannot be unbounded either.
    write(codexMemorySummary(codexHome), 'y'.repeat(INSTRUCTION_FILE_CAP * 2))
    for (let index = 0; index < AGENT_MEMORY_NOTES_SHOWN; index += 1) {
      note(`2026-09-${String(index + 1).padStart(2, '0')}T00-00-00-note.md`, 'z'.repeat(64 * 1024))
    }

    const result = codex()
    const held = result.agentMemory.reduce((sum, item) => sum + item.bytes, 0)

    expect(held).toBeLessThanOrEqual(AGENT_MEMORY_TOTAL_CAP)
    // ⚑ …and the two fixed files can never crowd out every note, which is the relationship the
    // constant's own note claims: four times the per-file cap leaves room after both of them.
    expect(AGENT_MEMORY_TOTAL_CAP).toBeGreaterThan(2 * INSTRUCTION_FILE_CAP)
    expect(result.agentMemory.some((item) => item.kind === 'agent-memory-note')).toBe(true)
  })

  it('🔒 a symlinked NOTES DIRECTORY is refused, not followed — enumeration is not a leaf read', () => {
    // ⛔ **The one place this reader declines a link, and the asymmetry is the ruling.** The two
    // fixed files are followed under 170 §2, because the provider derives and reads those paths
    // itself. Enumeration is not that: `notes -> ~/Documents` would have this app listing and
    // reading a directory no provider ever looked at, and the store's whole shape would come from
    // the link. ⚑ It cited the rule on a symlinked `.claude` directory; `733` follows that one (its
    // reason was a credential) and kept this one, whose reason is the store's shape.
    const elsewhere = join(root, 'somebody-elses-documents')
    write(join(elsewhere, '2026-09-04T00-00-00-secret.md'), 'NOT-A-MEMORY-OF-THIS-PROFILE')
    mkdirSync(join(codexAdHocNotesDir(codexHome), '..'), { recursive: true })
    symlinkSync(elsewhere, codexAdHocNotesDir(codexHome))

    const result = codex()

    expect(result.refused).toContainEqual({
      path: codexAdHocNotesDir(codexHome),
      reason: 'symlink',
    })
    expect(JSON.stringify(result.agentMemory)).not.toContain('NOT-A-MEMORY-OF-THIS-PROFILE')
  })

  it('🔴 …and a DANGLING notes directory says the link is BROKEN, not that it was refused', () => {
    // ⛔ **Found reviewing this diff, not by a report.** The check above asked only *is this a
    // symlink* and answered `symlink` either way — so a link whose far end had gone reported *"not
    // read: symlink"*, sending somebody to look for a decision the app never made. 314 §3's whole
    // point is that nothing declined anything when a target disappears.
    mkdirSync(join(codexAdHocNotesDir(codexHome), '..'), { recursive: true })
    symlinkSync(join(root, 'no-such-notes'), codexAdHocNotesDir(codexHome))

    expect(codex().refused).toEqual([
      {
        path: codexAdHocNotesDir(codexHome),
        reason: 'dangling-link',
        link: join(root, 'no-such-notes'),
      },
    ])
  })

  it('🔴 …and a store with NO summary says nothing is in the prompt yet — the sentence measures', () => {
    // ⛔ **Also found reviewing this diff**, and it is 317's own defect class inside 317's own
    // addition: a profile whose agent has only ever written ad-hoc notes has no `memory_summary.md`,
    // and a sentence saying *"only memory_summary.md is put in front of the model"* sent the reader
    // looking for a file that is not there.
    note('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")

    const without = codex()
    expect(without.note).toContain('nothing here is in front of the model yet')
    // ⚑ …and the paired positive: the same store WITH a summary says the opposite (193).
    write(codexMemorySummary(codexHome), 'The user prefers terse answers.')
    const with_ = codex()
    expect(with_.note).toContain('is put in front of the model')
    expect(with_.note).not.toContain('nothing here is in front of the model yet')
  })

  it('⚑ …and an ORDINARY notes directory is not refused — the paired positive', () => {
    // 193 again: a reader that refused every notes directory would pass the assertion above.
    note('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")

    const result = codex()

    expect(result.refused).toEqual([])
    expect(result.agentMemory).toHaveLength(1)
  })

  it('🔴 a DANGLING `memories/` link is disclosed, once — not once per file we looked for (314 §3)', () => {
    // ⛔ **314's rule, kept through the shape change**, and the deduplication is the new half: a
    // broken directory link makes every leaf under it absent, so the same one-line finding would
    // otherwise be reported for the summary and for the index.
    symlinkSync(join(root, 'no-such-dir'), codexMemoryDir(codexHome))

    const result = codex()

    expect(result.agentMemory).toEqual([])
    expect(result.refused).toEqual([
      { path: codexMemoryDir(codexHome), reason: 'dangling-link', link: join(root, 'no-such-dir') },
    ])
  })

  it('⚑ a Codex profile that has not remembered anything is SILENT — 158’s rule, unchanged', () => {
    // The ordinary first state of every profile, and the control that keeps the addition from
    // announcing itself on a session that has no memory at all.
    const result = codex()

    expect(result.agentMemory).toEqual([])
    expect(result.refused).toEqual([])
    expect(result.note).toBe(
      'BroCrew appends nothing for this provider — it reads its own instruction files, and the ' +
        'list below is the one it reported.',
    )
  })

  it('⛔ …and none of it is APPENDED — Codex reads its own files (156 §3), unchanged', () => {
    // 🔴 The half of the old branch that was right and stays right. Reading Codex's memory for
    // display must not turn into injecting it: the provider already loaded it, and a second copy
    // from us would double it in the prompt AND claim we chose to send it.
    write(codexMemorySummary(codexHome), 'CODEX-REMEMBERED')
    write(join(codexHome, 'CLAUDE.md'), 'not for this provider')
    write(join(cwd, 'CLAUDE.md'), 'not for this provider either')

    const result = codex()

    expect(result.injected).toEqual([])
    expect(composeSystemHint(result.injected)).toBeUndefined()
    expect(result.agentMemory[0]?.text).toContain('CODEX-REMEMBERED')
  })
})

/**
 * 🔴 **The roster check — so the next provider to grow a memory cannot go unnoticed** (317, 308's
 * remedy in the reader instead of the prose).
 *
 * ⛔ **314 and 317 are the same failure twice.** A provider gained agent-written memory, this module
 * kept answering `null` for it, and nothing went red — because there was nothing that had to be
 * true for every provider, only a branch that happened to be right for one. `308`'s answer is to
 * state the rule once and derive it, and the rule here is: **every provider this app supports has a
 * decision recorded about where its agent memory lives, and that decision is exercised.**
 *
 * ⚠️ **The `Record<Provider, …>` is what makes it a gate.** A third provider added to
 * `providerSchema` stops the build here until somebody writes down what its memory is — including
 * writing down that it has none, which is a decision rather than an omission.
 */
describe('every provider’s memory is decided, not defaulted (317)', () => {
  /** Where each provider's agent memory lives, and one file of it to plant. */
  const MEMORY: Record<Provider, ((home: string) => string) | null> = {
    claude: claudeAutoMemoryIndex,
    // 314 opened the gates; 312 measured that this is the file the provider injects.
    codex: codexMemorySummary,
  }

  it('⛔ every supported provider is on the roster — a new one stops here first', () => {
    // ⚑ `SUPPORTED_PROVIDERS` is `providerSchema.options`, so this is the schema itself asking.
    expect(Object.keys(MEMORY).sort()).toEqual([...SUPPORTED_PROVIDERS].sort())
  })

  for (const provider of SUPPORTED_PROVIDERS) {
    it(`🔴 …and ${provider}'s memory reaches the panel — the assertion 314 would have failed`, () => {
      const where = MEMORY[provider]
      // A provider recorded as having no agent memory asserts that, rather than being skipped.
      if (where === null) {
        expect(read({ provider, providerHome: providerHome }).agentMemory).toEqual([])
        return
      }
      const home = join(root, 'provider-homes', 'default', 'default', provider)
      mkdirSync(home, { recursive: true })
      write(where(home), `remembered by ${provider}: BROBOT-ROSTER`)

      const result = read({ provider, providerHome: home })

      expect(result.agentMemory.map((item) => item.path)).toContain(where(home))
      expect(result.agentMemory[0]?.text).toContain('BROBOT-ROSTER')
      // ⚑ …and the file the PROVIDER injects is the one marked as being in the prompt.
      expect(result.agentMemory[0]?.reach).toBe('prompt')
    })
  }
})

/**
 * 🔴 **319 §2.1 · whether the panel may point at a recall is decided per provider, and MEASURED.**
 *
 * ⛔ **A flag rather than a provider check on the panel**, which is `308`'s remedy: 318 shipped a
 * line under the memory rows saying *"Nothing here says which of these the agent has actually
 * looked up"*, and 319 made that a half-truth by putting the recall in the conversation — for the
 * one provider that publishes a citation. A panel that pointed unconditionally would promise the
 * OTHER provider's user a row that will never appear, which is `308`'s defect on `308`'s surface.
 *
 * ⚠️ **`false` is not "we do not know".** 318 measured both sides on a real child: the app-server
 * parses the model's own citation block into `agentMessage.memoryCitation` for one provider, and the
 * other preloads its memory index into its own system prompt with no tool and no citation at all.
 */
describe('who may be told a recall will show up (319)', () => {
  const RECALLS_REPORTED: Record<Provider, boolean> = { claude: false, codex: true }

  it('⛔ every supported provider has an answer — a new one stops here first', () => {
    expect(Object.keys(RECALLS_REPORTED).sort()).toEqual([...SUPPORTED_PROVIDERS].sort())
  })

  for (const provider of SUPPORTED_PROVIDERS) {
    it(`${provider}: recallsReported is ${RECALLS_REPORTED[provider]}`, () => {
      const home = join(root, 'provider-homes', 'default', 'default', provider)
      mkdirSync(home, { recursive: true })
      expect(read({ provider, providerHome: home }).recallsReported).toBe(
        RECALLS_REPORTED[provider],
      )
    })
  }

  it('⚑ the two providers do NOT agree — or this roster would be measuring nothing', () => {
    // 193's rule as a shape check: a roster whose every value matched would pass over the branch it
    // exists to pin, and would keep passing if the flag became a constant.
    expect(new Set(Object.values(RECALLS_REPORTED)).size).toBe(2)
  })
})

/**
 * 🔴 **…and who may be told the WRITE will show up** (330 §4) — the same question, the other half of
 * the store, and the answers come out the other way round.
 *
 * The providers expose different evidence: one publishes a citation without a write item,
 * while the other publishes an ordinary write tool call without a citation. One flag cannot
 * represent both; memory actions need a second roster rather than a widened citation roster.
 */
describe('who may be told a memory write will show up (330)', () => {
  const WRITES_REPORTED: Record<Provider, boolean> = { claude: true, codex: false }

  it('⛔ every supported provider has an answer — a new one stops here first', () => {
    expect(Object.keys(WRITES_REPORTED).sort()).toEqual([...SUPPORTED_PROVIDERS].sort())
  })

  for (const provider of SUPPORTED_PROVIDERS) {
    it(`${provider}: writesReported is ${WRITES_REPORTED[provider]}`, () => {
      const home = join(root, 'provider-homes', 'default', 'default', provider)
      mkdirSync(home, { recursive: true })
      expect(read({ provider, providerHome: home }).writesReported).toBe(WRITES_REPORTED[provider])
    })
  }

  it('⚑ the two providers do NOT agree, and they disagree the OTHER way from the recall', () => {
    // ⛔ The shape check its neighbour makes, plus the one that matters here: if this roster were
    // ever a copy of `RECALLS_REPORTED`, the panel would have one fact wearing two names and 310
    // would be back. Asserting the values are opposite is what pins that.
    expect(new Set(Object.values(WRITES_REPORTED)).size).toBe(2)
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(WRITES_REPORTED[provider]).not.toBe(RECALLS_REPORTED_FOR_CONTRAST[provider])
    }
  })
})

/** The recall roster, named once more so the contrast above is a comparison and not a restatement. */
const RECALLS_REPORTED_FOR_CONTRAST: Record<Provider, boolean> = { claude: false, codex: true }

/* ------------- the half of Claude's memory nobody listed (322, friction log F8) */

/**
 * 🔴 **The panel named `MEMORY.md` and nothing else, and a real profile held three files** (322).
 *
 * ```text
 * 205 B    MEMORY.md                        ← the only one the panel listed
 * 1691 B   brobot-home-is-provider-home.md  ⛔ invisible
 * 263 B    user_reviewer_handle.md          ⛔ invisible
 * ```
 *
 * ⛔ **Two of three files and 1,954 of 2,159 bytes were in the store and off the screen.** 317 built
 * the panel and ruled which Codex files belong on it; the same ruling had never been applied to the
 * other provider, whose store is the same shape — an index the provider injects, and the memories it
 * points at, which the agent opens only if it chooses to.
 *
 * ⚑ **The boundary is measured, not assumed** (§3.1, and `probe:claude-memory-topics` is the
 * measurement). Three arms against a real 2.1.218 child in one session:
 *
 * ```text
 * CONTROL     a token that exists only in MEMORY.md         → answered, no tool at all
 * UNASKED     a token that exists only in a topic file      → "the actual codename value isn't
 *                                                              shown in the memory index provided
 *                                                              to me"   ⛔ not in the prompt
 * ON REQUEST  the same token, told it may look              → Read(<…>/release_codename.md), then
 *                                                              answered   ⚑ an ordinary file tool
 * ```
 */
describe('a Claude profile’s topic files (322)', () => {
  const memoryDir = (): string => join(claudeAutoMemoryIndex(providerHome), '..')
  const topic = (name: string): string => join(memoryDir(), name)
  const index = (): string => claudeAutoMemoryIndex(providerHome)
  const memory = () => read().agentMemory

  it('🔴 lists the index AND every memory beside it — the whole store, not one file', () => {
    write(index(), '- [Reviewer handle](user_reviewer_handle.md) — BROBOT-INDEX')
    write(topic('brobot-home-is-provider-home.md'), 'BROBOT-TOPIC-A')
    write(topic('user_reviewer_handle.md'), 'BROBOT-TOPIC-B')

    const rows = memory()

    expect(rows.map((r) => r.path)).toEqual([
      index(),
      topic('brobot-home-is-provider-home.md'),
      topic('user_reviewer_handle.md'),
    ])
    // …and the positive that stops this passing over an empty list (193): the bytes are really here.
    expect(rows.map((r) => r.text)).toEqual([
      '- [Reviewer handle](user_reviewer_handle.md) — BROBOT-INDEX',
      'BROBOT-TOPIC-A',
      'BROBOT-TOPIC-B',
    ])
  })

  it('⛔ the index is in the PROMPT and a topic file is not — the probe’s own finding', () => {
    write(index(), 'the index')
    write(topic('user_role.md'), 'a memory')

    expect(memory().map((r) => r.reach)).toEqual(['prompt', 'on-request'])
  })

  it('⚑ …and they are different KINDS, because they came through different doors', () => {
    write(index(), 'the index')
    write(topic('user_role.md'), 'a memory')

    // ⛔ Never `agent-memory-note`: that label says *"a note the agent was asked to write"*, which
    // is Codex's `memories__add_ad_hoc_note` and is false of a file the provider tells the model to
    // write unprompted.
    expect(memory().map((r) => r.kind)).toEqual(['agent-memory', 'agent-memory-topic'])
  })

  it('⚠️ by NAME, ascending — the only order these files have', () => {
    write(index(), 'the index')
    for (const name of ['zulu.md', 'alpha.md', 'mike.md']) write(topic(name), name)

    expect(
      memory()
        .slice(1)
        .map((r) => r.path),
    ).toEqual([topic('alpha.md'), topic('mike.md'), topic('zulu.md')])
  })

  it('⛔ the index is not one of its own entries — a store of one memory is not two', () => {
    write(index(), 'the index')

    expect(memory().map((r) => r.kind)).toEqual(['agent-memory'])
  })

  it('⚠️ only `.md`, and never a subdirectory — the provider dictates the format', () => {
    write(index(), 'the index')
    write(topic('notes.txt'), 'not a memory')
    write(topic('user_role.md'), 'a memory')
    mkdirSync(topic('skills.md'), { recursive: true })

    expect(memory().map((r) => r.path)).toEqual([index(), topic('user_role.md')])
  })

  it('🔴 a profile with NO topic files renders exactly as it did before — §4’s rule', () => {
    write(index(), 'remembered: BROBOT-CANARY')

    const result = read()

    expect(result.agentMemory).toHaveLength(1)
    expect(result.agentMemory[0]?.kind).toBe('agent-memory')
    // ⛔ …and the note says nothing about a store this profile has not built. A sentence about an
    // index that points at nothing is 086 in the other direction — 317 M25's own defect class.
    expect(result.note).not.toContain('index')
    expect(result.refused).toEqual([])
  })

  it('⚑ a profile with topic files and NO index says so rather than naming a file it lacks', () => {
    write(topic('user_role.md'), 'a memory written before any index')

    const result = read()

    expect(result.agentMemory.map((r) => r.kind)).toEqual(['agent-memory-topic'])
    expect(result.note).toContain('is the only file the provider puts in front of it')
    expect(result.note).not.toContain('is an index the provider puts in front of the model')
  })

  it('⛔ …and a BLANK index is not "this profile has none" — it is standing on the file', () => {
    // ⚠️ **Found reviewing this diff.** `readMemoryStore` skips an empty file, so `injects` is
    // false for a `MEMORY.md` that exists and says nothing — and the first wording of this sentence
    // told the reader the file was not there. The provider's own prompt in that state is *"Your
    // MEMORY.md is currently empty"*, so the true statement is about its CONTENT.
    write(index(), '   \n\n')
    write(topic('user_role.md'), 'a memory')

    const result = read()

    expect(result.note).toContain('there is nothing in this profile’s')
    expect(result.note).not.toContain('has none')
    // …and the paired positive: the topic file really is listed under that sentence.
    expect(result.agentMemory.map((r) => r.kind)).toEqual(['agent-memory-topic'])
  })

  it('⚠️ …and the sentence names the index’s JOB when there is one', () => {
    write(index(), 'the index')
    write(topic('user_role.md'), 'a memory')

    // ⛔ §3.2: what the index IS, never what it points at. The pairing is prose the model wrote and
    // nothing here parses it.
    expect(read().note).toContain('MEMORY.md in')
    expect(read().note).toContain('is an index the provider puts in front of the model')
    expect(read().note).not.toContain('user_role.md')
  })

  it('⛔ the cap bites at 20 and the count is SAID, never dropped in silence', () => {
    write(index(), 'the index')
    for (let n = 0; n < AGENT_MEMORY_NOTES_SHOWN + 6; n++) {
      write(topic(`memory-${String(n).padStart(3, '0')}.md`), `memory ${n}`)
    }

    const result = read()

    expect(result.agentMemory.filter((r) => r.kind === 'agent-memory-topic')).toHaveLength(
      AGENT_MEMORY_NOTES_SHOWN,
    )
    expect(result.note).toContain(`${AGENT_MEMORY_NOTES_SHOWN} of ${AGENT_MEMORY_NOTES_SHOWN + 6}`)
  })

  it('🔴 a store of large memories can never evict the file the model was actually given', () => {
    // ⛔ **The budget ruling, asserted rather than described** (§3.3): `readMemoryStore` spends
    // `AGENT_MEMORY_TOTAL_CAP` in candidate order and the index is first, so twenty topic files at
    // the per-file cap cannot push the one file that is in the prompt off the panel.
    write(index(), 'INDEX-SURVIVES')
    for (let n = 0; n < AGENT_MEMORY_NOTES_SHOWN; n++) {
      write(topic(`big-${String(n).padStart(2, '0')}.md`), 'x'.repeat(INSTRUCTION_FILE_CAP))
    }

    const result = read()

    expect(result.agentMemory[0]?.text).toBe('INDEX-SURVIVES')
    expect(result.agentMemory[0]?.reach).toBe('prompt')
    // …and the paired positive: the budget really did bite, so this is not a test about a store
    // that happened to fit. 20 × 64 KiB is over the 256 KiB store cap.
    expect(AGENT_MEMORY_NOTES_SHOWN * INSTRUCTION_FILE_CAP).toBeGreaterThan(AGENT_MEMORY_TOTAL_CAP)
    expect(result.agentMemory.length).toBeLessThan(AGENT_MEMORY_NOTES_SHOWN + 1)
  })

  it('⛔ this store never spends the APPEND budget — none of it is appended', () => {
    write(index(), 'the index')
    write(topic('user_role.md'), 'x'.repeat(60 * 1024))
    write(join(cwd, 'CLAUDE.md'), 'be terse in this repo')

    const result = read()

    expect(composeSystemHint(result.injected)).toContain('be terse in this repo')
    expect(composeSystemHint(result.injected) ?? '').not.toContain('user_role.md')
  })

  it('⚑ a topic file that is a LINK is followed and disclosed, exactly like the index (170 §2)', () => {
    const target = join(root, 'memory-elsewhere.md')
    write(target, 'BROBOT-ELSEWHERE')
    write(index(), 'the index')
    symlinkSync(target, topic('user_role.md'))

    const rows = memory()

    expect(rows[1]?.text).toBe('BROBOT-ELSEWHERE')
    expect(rows[1]?.link).toBe(realpathSync(target))
    expect(read().refused).toEqual([])
  })

  it('🔴 a WORKING `memory/` link is still enumerated — 314 §3 is not regressed', () => {
    // ⛔ **§3.4.** Somebody may point the whole store at another disk on purpose. 314 removed the
    // row that told them their memory was gone; refusing to LIST here would put it back, on a
    // directory this app itself named to the provider as the memory store.
    const elsewhere = join(root, 'memory-on-another-disk')
    mkdirSync(elsewhere, { recursive: true })
    writeFileSync(join(elsewhere, 'MEMORY.md'), 'the index')
    writeFileSync(join(elsewhere, 'user_role.md'), 'BROBOT-BEHIND-THE-LINK')
    mkdirSync(join(memoryDir(), '..'), { recursive: true })
    symlinkSync(elsewhere, memoryDir())

    const result = read()

    expect(result.agentMemory.map((r) => r.kind)).toEqual(['agent-memory', 'agent-memory-topic'])
    expect(result.agentMemory[1]?.text).toBe('BROBOT-BEHIND-THE-LINK')
    // …and every row says where it really came from, which is what makes following it honest.
    expect(result.agentMemory[1]?.link).toBe(join(realpathSync(elsewhere), 'user_role.md'))
    expect(result.refused).toEqual([])
  })

  it('⛔ a DANGLING `memory/` link is ONE row, not two — the listing must not repeat the leaf', () => {
    // ⚠️ **Found writing this.** `readMemoryStore` already walks up to the directory when the index
    // read comes back `absent`; the listing sees the same broken directory. Without the de-dupe the
    // one panel whose job is to be readable carries the same fact twice.
    const gone = join(root, 'no-such-dir')
    mkdirSync(join(memoryDir(), '..'), { recursive: true })
    symlinkSync(gone, memoryDir())

    expect(read().refused).toEqual([{ path: memoryDir(), reason: 'dangling-link', link: gone }])
  })

  it('⚠️ a `memory` that is a regular FILE is refused, and named as the directory', () => {
    write(memoryDir(), 'not a directory')

    // ⚑ **Two rows, and they say different things.** The first is the leaf read this reader has
    // always done — `ENOTDIR` on the way to the index — and on its own it names a file that does
    // not exist and cannot. The second is the listing's, and it is the one that says WHAT was
    // wrong. Pinned as an exact list so a future change cannot quietly add a third.
    expect(read().refused).toEqual([
      { path: claudeAutoMemoryIndex(providerHome), reason: 'unreadable' },
      { path: memoryDir(), reason: 'not-a-regular-file' },
    ])
  })

  it('⚑ nothing at all where nothing was written — no rows, no refusals, no sentence', () => {
    const result = read()

    expect(result.agentMemory).toEqual([])
    expect(result.refused).toEqual([])
    expect(result.note).not.toContain('memory')
  })

  it('🔴 a CODEX profile is untouched by all of this — its order is still newest first', () => {
    // ⛔ §4's first trap, as a control: 317 ruled Codex's half and 322 must not have re-decided it.
    const codexHome = join(root, 'provider-homes', 'default', 'default', 'codex')
    const notes = codexAdHocNotesDir(codexHome)
    writeFileSync(write(codexMemorySummary(codexHome), ''), 'the summary')
    for (const name of ['2026-01-01T00-00-00-a.md', '2026-03-03T00-00-00-c.md']) {
      write(join(notes, name), name)
    }

    const rows = read({ provider: 'codex', providerHome: codexHome }).agentMemory

    expect(rows.map((r) => r.kind)).toEqual([
      'agent-memory',
      'agent-memory-note',
      'agent-memory-note',
    ])
    expect(rows.slice(1).map((r) => r.path)).toEqual([
      join(notes, '2026-03-03T00-00-00-c.md'),
      join(notes, '2026-01-01T00-00-00-a.md'),
    ])
  })
})

/**
 * 🔴 **The launch fact — what a conversation may say about how it opened** (332 §1, §2).
 *
 * A name already in the memory index can answer “what is my name?” directly from the system
 * prompt, before any file read. Show memory’s presence at launch rather than imply it was
 * unused because no recall tool call occurred.
 *
 * ⚠️ **These assertions are about the READER's answer, not the row.** The row is
 * `the-memory-that-is-in-the-prompt.dom.test.ts`; the wiring is `memory-loaded-host.test.ts`.
 */
describe('the memory that is in the prompt, and the row it earns (332)', () => {
  const memoryDir = (): string => join(claudeAutoMemoryIndex(providerHome), '..')
  const topic = (name: string): string => join(memoryDir(), name)
  const index = (): string => claudeAutoMemoryIndex(providerHome)

  it('🔴 names the index that is in the prompt, and counts the memories beside it', () => {
    write(index(), '- [Reviewer handle](user_reviewer_handle.md) — who reviews this work')
    write(topic('user_reviewer_handle.md'), 'The reviewer goes by alex-acme.')
    write(topic('brobot-home-is-provider-home.md'), "BroBot's home is the provider home.")

    const before = Date.now()
    const row = readLaunch().memoryLoaded
    const after = Date.now()

    // ⚑ **604 · the row gained a third field and the equality still holds all three.** The look
    // time is bracketed rather than named, because it is a real clock — and it is asserted HERE
    // rather than relaxed into `toMatchObject`, which would stop this test noticing a fourth field
    // arriving unannounced. See `when-we-looked-is-not-when-it-was-loaded.test.ts` for which END of
    // the look it is taken at.
    expect(row).toEqual({
      type: 'memory_loaded',
      index: index(),
      beside: 2,
      lookedAt: expect.any(Number),
    })
    expect(row?.lookedAt).toBeGreaterThanOrEqual(before)
    expect(row?.lookedAt).toBeLessThanOrEqual(after)
  })

  it('⛔ …and the file it names is the one the PANEL says is in front of the model', () => {
    // ⚑ One derivation, asserted rather than claimed: `claudeMemoryLoaded` finds the item whose
    // `reach` is `prompt`, which is the same item the drawer draws that word on. If the two ever
    // came apart, a person could read one sentence in the conversation and a different one in the
    // panel about the same file.
    write(index(), 'BROBOT-INDEX')
    write(topic('user_role.md'), 'BROBOT-TOPIC')

    const launch = readLaunch()
    const inPrompt = launch.instructions.agentMemory.filter((item) => item.reach === 'prompt')

    expect(inPrompt.map((item) => item.path)).toEqual([launch.memoryLoaded?.index])
    expect(inPrompt).toHaveLength(1)
  })

  it('⛔ counts what is ON DISK, not what the panel listed — a cap here would go silent (092 §4)', () => {
    // ⚠️ **The literal, not `AGENT_MEMORY_NOTES_SHOWN + 5`.** A bound written as the constant moves
    // with the constant and pins nothing (330's own M18 was defeated exactly that way), so the count
    // is spelled out and the relationship is asserted beside it.
    expect(AGENT_MEMORY_NOTES_SHOWN).toBe(20)
    write(index(), 'BROBOT-INDEX')
    for (let n = 0; n < 25; n++) write(topic(`topic_${String(n).padStart(2, '0')}.md`), `t${n}`)

    const launch = readLaunch()
    const listed = launch.instructions.agentMemory.filter(
      (item) => item.kind === 'agent-memory-topic',
    )

    // The panel's list is capped…
    expect(listed).toHaveLength(20)
    // …and the row's number is the store's.
    expect(launch.memoryLoaded?.beside).toBe(25)
  })

  it('⛔ a profile with no index draws NO row, even with memories sitting beside it', () => {
    // 322 §4's rule, and 317 M25's lesson: nothing of this store reaches the model on its own, so
    // there is no launch fact to state. ⚑ The paired positive is one line down — the same store with
    // an index does produce one, so this null is a decision rather than a reader that found nothing.
    write(topic('user_role.md'), 'BROBOT-TOPIC')

    expect(readLaunch().memoryLoaded).toBeNull()
    expect(readLaunch().instructions.agentMemory).not.toHaveLength(0)

    write(index(), 'BROBOT-INDEX')
    expect(readLaunch().memoryLoaded?.index).toBe(index())
  })

  it('⚠️ an index that exists and is EMPTY draws no row either — the provider is given nothing', () => {
    // ⛔ The reader drops an empty file ("it exists, it says nothing"), so `reach: 'prompt'` is
    // absent and so is the row. ⚑ The panel already has a sentence for this exact profile — *"there
    // is nothing in this profile's"* — and a conversation claiming an index in the prompt while the
    // provider's own prompt says `Your MEMORY.md is currently empty` would contradict it.
    write(index(), '   \n\n')
    write(topic('user_role.md'), 'BROBOT-TOPIC')

    expect(readLaunch().memoryLoaded).toBeNull()

    // The control, in the same store, one write later.
    write(index(), 'BROBOT-INDEX')
    expect(readLaunch().memoryLoaded).not.toBeNull()
  })

  it('⛔ a fresh profile — no store at all — draws no row', () => {
    expect(readLaunch().memoryLoaded).toBeNull()
  })

  it('⛔ Codex draws no row, and it is a SCOPE ruling rather than a store with nothing in it', () => {
    // 332 §2.5. ⚠️ **The positive is what makes this an assertion**: Codex's own store DOES put a
    // file in front of the model — `reach: 'prompt'` on the summary — so `null` here is this app
    // declining to state a fact it can see, for the reason `310` gives, and not a reader coming
    // back empty. ⚑ If someone ever flips it on, this test goes red rather than silently agreeing.
    const codexHome = join(root, 'provider-homes', 'default', 'default', 'codex')
    write(codexMemorySummary(codexHome), 'The user prefers terse answers.')

    const launch = readSessionInstructions({
      provider: 'codex',
      cwd,
      providerHome: codexHome,
      home,
    })

    expect(launch.instructions.agentMemory.some((item) => item.reach === 'prompt')).toBe(true)
    expect(launch.memoryLoaded).toBeNull()
  })
})
