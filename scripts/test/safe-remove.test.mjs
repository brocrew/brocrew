import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  descend,
  forbiddenRoots,
  isAncestor,
  mayRemove,
  removeChecked,
  trustedAnchor,
} from '../lib/safe-remove.mjs'

/**
 * 🔴 **A test for a deleting predicate must not be able to delete the wrong thing when it fails**
 * (351 §4).
 *
 * ⚑ Every fixture is built under a directory this file created, and {@link fixture} asserts the tree
 * is where it thinks it is BEFORE anything under test runs. A test whose premise is wrong either
 * passes over nothing or removes something real, and those are one line of code apart.
 */
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A fixture root, asserted into existence before it is used. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'b351-safe-'))
  roots.push(root)
  expect(existsSync(root), `the fixture root was not created: ${root}`).toBe(true)
  expect(lstatSync(root).isDirectory()).toBe(true)
  return root
}

/**
 * ⛔ **W4.124 · never this machine's own home, nor the redirects this shell carries** — a scratch home
 * and no environment, for every call that is not about them. Left out, `trustedAnchor` resolves the
 * real `~/.claude` and `~/.codex`, and any `CLAUDE_CONFIG_DIR` or `CODEX_HOME` the run inherited.
 */
const elsewhere = (options = {}) => ({ home: fixture(), env: {}, ...options })

/**
 * The anchor, built by the PRODUCTION function rather than by a hand-rolled object.
 *
 * ⚠️ **The first draft of this helper returned `{ real: path }` from the raw fixture path and every
 * positive assertion in this file went red.** On macOS `mkdtemp` under `tmpdir()` lands in
 * `/var/folders/…`, which is a symlink to `/private/var/folders/…` — so the hand-built anchor was
 * not real, and `mayRemove`'s parent-is-really-real check refused correctly. ⚑ **Building the
 * fixture's anchor the way the script builds it is the only version that cannot drift from it.**
 */
function anchorAt(path) {
  const anchor = trustedAnchor(path, elsewhere())
  expect(anchor.kind, `the fixture anchor was refused: ${anchor.why ?? ''}`).toBe('trusted')
  return anchor
}

describe('170 §3 · a symlinked PARENT is where a lexical check walks out of the boundary', () => {
  /**
   * ⛔ **The decoy is a COMPONENT of the path, not the leaf.** `170` §3's defect was *"a symlink in a
   * parent walked straight through a lexical boundary"* — BroBot read the personal
   * `~/.claude/CLAUDE.md` believing it was somewhere else. So the hazard is planted where the walk
   * actually traverses; a decoy hanging off the side of the tree would test nothing.
   */
  function plantDecoy() {
    const root = fixture()
    const userData = join(root, 'ud')
    const personal = join(root, 'personal')
    mkdirSync(join(userData, 'provider-homes', 'proj'), { recursive: true })
    mkdirSync(join(personal, 'claude'), { recursive: true })
    writeFileSync(join(personal, 'claude', 'CLAUDE.md'), 'the users own instructions\n')
    // `<ud>/provider-homes/proj/prof` IS `<root>/personal` — every string check says the target is
    // inside the userData directory, and every one of them is wrong.
    symlinkSync(personal, join(userData, 'provider-homes', 'proj', 'prof'))

    expect(lstatSync(join(userData, 'provider-homes', 'proj', 'prof')).isSymbolicLink()).toBe(true)
    expect(
      join(userData, 'provider-homes', 'proj', 'prof', 'claude', 'CLAUDE.md').startsWith(userData),
      'the decoy must LOOK contained, or it is not the trap 170 sprang',
    ).toBe(true)
    expect(existsSync(join(personal, 'claude', 'CLAUDE.md'))).toBe(true)
    return { root, userData, personal }
  }

  it('⛔ refuses a path whose parent is a symlink, and the file behind it survives', () => {
    const { userData, personal } = plantDecoy()
    const verdict = mayRemove(anchorAt(userData), 'provider-homes/proj/prof/claude', {
      expect: 'dir',
    })

    expect(verdict.kind).toBe('refused')
    expect(verdict.why).toContain('is a symlink')
    expect(verdict.why).toContain('never follows one')
    expect(
      readFileSync(join(personal, 'claude', 'CLAUDE.md'), 'utf8'),
      'the decoy was followed and its contents were reached',
    ).toBe('the users own instructions\n')
  })

  /**
   * ⚑ **The paired positive, and without it the refusal above proves nothing.** A predicate that
   * refused everything would pass that test. This one puts the SAME relative path in the fixture as
   * a real directory and requires it to be removed — so the two differ in exactly one fact: whether
   * a component is a link.
   */
  it('⚑ …and the same relative path, built for real, is removed', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    const real = join(userData, 'provider-homes', 'proj', 'prof', 'claude')
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, 'CLAUDE.md'), 'the profiles own instructions\n')
    expect(lstatSync(join(userData, 'provider-homes', 'proj', 'prof')).isSymbolicLink()).toBe(false)

    const verdict = mayRemove(anchorAt(userData), 'provider-homes/proj/prof/claude', {
      expect: 'dir',
    })
    expect(verdict.kind).toBe('ok')
    const result = removeChecked(verdict.path, verdict.stat)
    expect(result.files).toBe(1)
    expect(result.rootRemoved).toBe(true)
    expect(existsSync(real)).toBe(false)
  })

  it('⛔ a symlink INSIDE a tree is unlinked, never descended into', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    const outside = join(root, 'outside')
    mkdirSync(join(userData, 'workspace', 'inner'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'precious.txt'), 'not ours\n')
    writeFileSync(join(userData, 'workspace', 'inner', 'ours.txt'), 'ours\n')
    symlinkSync(outside, join(userData, 'workspace', 'inner', 'escape'))
    expect(existsSync(join(userData, 'workspace', 'inner', 'escape', 'precious.txt'))).toBe(true)

    const verdict = mayRemove(anchorAt(userData), 'workspace', { expect: 'dir' })
    expect(verdict.kind).toBe('ok')
    const result = removeChecked(verdict.path, verdict.stat)

    expect(result.links, 'the link itself is removed').toBe(1)
    expect(result.files, 'and only the one real file under it').toBe(1)
    expect(existsSync(join(userData, 'workspace'))).toBe(false)
    expect(
      readFileSync(join(outside, 'precious.txt'), 'utf8'),
      'the walk descended through the link',
    ).toBe('not ours\n')
  })
})

describe('the predicate', () => {
  it('refuses a traversal segment rather than resolving it', () => {
    const root = fixture()
    mkdirSync(join(root, 'ud'), { recursive: true })
    expect(descend(join(root, 'ud'), '../escape').kind).toBe('refused')
    expect(descend(join(root, 'ud'), 'a/../../escape').why).toContain('traversal segment')
  })

  it('reports a missing target as absent — it never creates one in order to delete it', () => {
    const root = fixture()
    mkdirSync(join(root, 'ud'), { recursive: true })
    const verdict = mayRemove(anchorAt(join(root, 'ud')), 'never-existed', { expect: 'file' })
    expect(verdict.kind).toBe('absent')
    expect(existsSync(join(root, 'ud', 'never-existed'))).toBe(false)
  })

  it('⛔ refuses a path whose parent component is a FILE rather than a directory', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    mkdirSync(userData, { recursive: true })
    writeFileSync(join(userData, 'provider-homes'), 'somebody put a file here\n')
    const verdict = mayRemove(anchorAt(userData), 'provider-homes/default/default/codex', {
      expect: 'dir',
    })
    expect(verdict.kind).toBe('refused')
    expect(verdict.why).toContain('is not a directory')
    expect(existsSync(join(userData, 'provider-homes'))).toBe(true)
  })

  it('⛔ refuses when the kind is not the one the manifest expects', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    mkdirSync(join(userData, 'brobot2.sqlite'), { recursive: true })
    const verdict = mayRemove(anchorAt(userData), 'brobot2.sqlite', { expect: 'file' })
    expect(verdict.kind).toBe('refused')
    expect(verdict.why).toContain('is a dir where the manifest expects file')
  })

  it('⛔ `unlink` takes a link by NAME, and still refuses a directory', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    mkdirSync(userData, { recursive: true })
    symlinkSync(join(root, 'nowhere'), join(userData, 'SingletonLock'))
    mkdirSync(join(userData, 'Cache'), { recursive: true })

    const link = mayRemove(anchorAt(userData), 'SingletonLock', { expect: 'unlink' })
    expect(link.kind).toBe('ok')
    expect(removeChecked(link.path, link.stat).links).toBe(1)
    expect(existsSync(join(userData, 'SingletonLock'))).toBe(false)

    const directory = mayRemove(anchorAt(userData), 'Cache', { expect: 'unlink' })
    expect(directory.kind).toBe('refused')
    expect(existsSync(join(userData, 'Cache'))).toBe(true)
  })

  it('keeps exactly the named child while emptying everything else around it', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    mkdirSync(join(userData, 'codex', 'sessions', '2026'), { recursive: true })
    writeFileSync(join(userData, 'codex', 'auth.json'), '{}\n')
    chmodSync(join(userData, 'codex', 'auth.json'), 0o600)
    writeFileSync(join(userData, 'codex', '.auth.json.tmp-0123456789abcdef01234567'), 'half\n')
    writeFileSync(join(userData, 'codex', 'config.toml'), 'x\n')
    writeFileSync(join(userData, 'codex', 'sessions', '2026', 'r.jsonl'), '{}\n')

    const verdict = mayRemove(anchorAt(userData), 'codex', { expect: 'dir' })
    const result = removeChecked(verdict.path, verdict.stat, {
      removeRoot: false,
      keep: (relative) => relative === 'auth.json',
    })

    expect(result.kept).toEqual(['auth.json'])
    expect(result.rootRemoved, 'the skeleton stays so the profile name survives').toBe(false)
    expect(existsSync(join(userData, 'codex'))).toBe(true)
    expect(existsSync(join(userData, 'codex', 'auth.json'))).toBe(true)
    expect(
      existsSync(join(userData, 'codex', '.auth.json.tmp-0123456789abcdef01234567')),
      'the staging file is NOT the credential and must go',
    ).toBe(false)
    expect(existsSync(join(userData, 'codex', 'sessions'))).toBe(false)
  })

  /**
   * ⚑ **The dry run is the same walk, and this is the assertion that says so.** A preview computed a
   * different way from the removal is a preview of a different program.
   */
  it('⚑ `apply: false` counts exactly what `apply: true` then removes', () => {
    const build = () => {
      const root = fixture()
      const userData = join(root, 'ud')
      mkdirSync(join(userData, 'tree', 'a', 'b'), { recursive: true })
      writeFileSync(join(userData, 'tree', 'one.txt'), '1234\n')
      writeFileSync(join(userData, 'tree', 'a', 'two.txt'), '12\n')
      writeFileSync(join(userData, 'tree', 'a', 'b', 'three.txt'), '1\n')
      symlinkSync(join(root, 'nowhere'), join(userData, 'tree', 'a', 'link'))
      return userData
    }
    const previewed = build()
    const removed = build()

    const verdictA = mayRemove(anchorAt(previewed), 'tree', { expect: 'dir' })
    const preview = removeChecked(verdictA.path, verdictA.stat, { apply: false })
    const verdictB = mayRemove(anchorAt(removed), 'tree', { expect: 'dir' })
    const real = removeChecked(verdictB.path, verdictB.stat, { apply: true })

    expect(preview).toEqual(real)
    expect(preview.files).toBe(3)
    expect(preview.links).toBe(1)
    expect(preview.directories).toBe(3)
    expect(existsSync(join(previewed, 'tree', 'one.txt')), 'the dry run removed something').toBe(
      true,
    )
    expect(existsSync(join(removed, 'tree'))).toBe(false)
  })
})

describe('the two rules that only a seam makes testable', () => {
  /**
   * ⚑ **Ownership, driven from the other side.** `process.getuid()` is the one value in the module a
   * test cannot vary, so both entry points take it as an option — otherwise this rule would be a
   * comment that no mutation could turn red, which is the same as not having it (`351`'s reading of
   * the unkillable-line class).
   */
  it('⛔ refuses a path owned by somebody else, and accepts the same path owned by us', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    mkdirSync(join(userData, 'brobot-workspace'), { recursive: true })
    const mine = process.getuid()

    const theirs = mayRemove(anchorAt(userData), 'brobot-workspace', {
      expect: 'dir',
      uid: mine + 1,
    })
    expect(theirs.kind).toBe('refused')
    expect(theirs.why).toContain(`not by uid ${String(mine + 1)}`)

    expect(
      mayRemove(anchorAt(userData), 'brobot-workspace', { expect: 'dir', uid: mine }).kind,
    ).toBe('ok')
    expect(existsSync(join(userData, 'brobot-workspace'))).toBe(true)
  })

  it('⛔ an anchor owned by somebody else is refused before anything under it is walked', () => {
    const root = fixture()
    const anchor = trustedAnchor(root, elsewhere({ uid: process.getuid() + 1 }))
    expect(anchor.kind).toBe('refused')
    expect(anchor.why).toContain('is owned by uid')
  })

  it('⛔ a removal must NAME what it expects to find — there is no default kind', () => {
    const root = fixture()
    mkdirSync(join(root, 'ud', 'Cache'), { recursive: true })
    const verdict = mayRemove(anchorAt(join(root, 'ud')), 'Cache')
    expect(verdict.kind).toBe('refused')
    expect(verdict.why).toContain('must name what it expects to find')
    expect(existsSync(join(root, 'ud', 'Cache'))).toBe(true)
  })

  /**
   * ⚑ **The dev+ino recheck, driven by actually replacing the inode.** `verifyTrustedDir` in the
   * product does this against a concurrent writer; here the swap is deliberate, which is the only
   * way to reach the branch without a race.
   */
  it('⛔ a directory replaced between the check and the removal is left in place', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is that a folder made again gets a new inode, as APFS does; ext4 reuses it.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    const root = fixture()
    const userData = join(root, 'ud')
    mkdirSync(join(userData, 'brobot-workspace'), { recursive: true })
    const verdict = mayRemove(anchorAt(userData), 'brobot-workspace', { expect: 'dir' })
    expect(verdict.kind).toBe('ok')

    // Same name, different inode — exactly what a concurrent rename leaves behind.
    rmSync(join(userData, 'brobot-workspace'), { recursive: true })
    mkdirSync(join(userData, 'brobot-workspace'))
    writeFileSync(join(userData, 'brobot-workspace', 'somebody-elses.txt'), 'new tree\n')

    const result = removeChecked(verdict.path, verdict.stat)
    expect(result.failed).toEqual([
      { path: verdict.path, why: 'it was replaced between the check and the removal' },
    ])
    expect(result.files).toBe(0)
    expect(readFileSync(join(userData, 'brobot-workspace', 'somebody-elses.txt'), 'utf8')).toBe(
      'new tree\n',
    )
  })

  it('⚑ …and a target that vanished on its own is a silent no-op, not a failure', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    mkdirSync(join(userData, 'gone'), { recursive: true })
    const verdict = mayRemove(anchorAt(userData), 'gone', { expect: 'dir' })
    rmSync(join(userData, 'gone'), { recursive: true })

    const result = removeChecked(verdict.path, verdict.stat)
    expect(result.failed).toEqual([])
    expect(result.directories).toBe(0)
  })
})

describe('the anchor, which is the one directory everything else is proved against', () => {
  /**
   * ⚑ **Unit calls, not a CLI run, and that is deliberate.** Every case below names a directory it
   * would be a catastrophe to remove — the filesystem root, the checkout, the working directory. A
   * test that spawned the script against them to watch it refuse would delete all three the day the
   * predicate broke, which is the failure mode `351` §4 rules out: *"a test for a deleting script
   * must not be able to delete the wrong thing when it fails."*
   */
  it('refuses a relative path rather than resolving it against whatever cwd happens to be', () => {
    expect(trustedAnchor('ud').kind).toBe('refused')
    expect(trustedAnchor('ud').why).toContain('not absolute')
    expect(trustedAnchor('').why).toContain('empty')
  })

  it('⛔ refuses the filesystem root', () => {
    expect(trustedAnchor('/').why).toContain('filesystem root')
  })

  it('⛔ refuses the checkout it is running from', () => {
    const root = fixture()
    const checkout = join(root, 'brobot-2')
    mkdirSync(join(checkout, 'apps'), { recursive: true })
    expect(trustedAnchor(checkout, elsewhere({ repoRoot: checkout })).why).toContain(
      'BroBot2 checkout',
    )
    expect(trustedAnchor(root, elsewhere({ repoRoot: checkout })).why).toContain('contains')
  })

  it('⛔ refuses the directory it was run from, and any directory containing it', () => {
    const root = fixture()
    const where = join(root, 'here')
    mkdirSync(where, { recursive: true })
    expect(trustedAnchor(where, elsewhere({ cwd: where })).why).toContain(
      'the directory this was run from',
    )
    expect(trustedAnchor(root, elsewhere({ cwd: where })).why).toContain(
      'the directory this was run from',
    )
  })

  it('refuses a target that is a file, and reports a missing one as absent', () => {
    const root = fixture()
    writeFileSync(join(root, 'notadir'), 'x\n')
    expect(trustedAnchor(join(root, 'notadir'), elsewhere()).why).toContain('not a directory')
    expect(trustedAnchor(join(root, 'never'), elsewhere()).kind).toBe('absent')
  })

  it('⚑ …and an ordinary userData under $HOME is trusted, so the guards above are not blanket', () => {
    const root = fixture()
    const home = join(root, 'home')
    const userData = join(home, 'Library', 'Application Support', '@brobot2', 'desktop')
    mkdirSync(userData, { recursive: true })
    const anchor = trustedAnchor(userData, {
      home,
      env: {},
      cwd: root === home ? '/' : join(root, 'cwd'),
    })
    expect(anchor.kind, anchor.why ?? '').toBe('trusted')
    expect(anchor.real.endsWith(join('@brobot2', 'desktop'))).toBe(true)
  })
})

describe('the roots a reset must never be pointed at', () => {
  it('⚑ says for EACH root whether being INSIDE it is also forbidden', () => {
    const named = forbiddenRoots({
      home: '/home/someone',
      env: { CODEX_HOME: '/elsewhere/codex' },
      repoRoot: '/repo',
    })
    // ⛔ The home directory is the one exception, and it is load-bearing: the userData this reset
    // empties lives inside `$HOME`. A blanket rule would refuse every ordinary run.
    expect(named.find((r) => r.path === '/home/someone').inside).toBe(false)
    for (const path of [
      '/home/someone/.codex',
      '/home/someone/.claude',
      '/elsewhere/codex',
      '/repo',
    ]) {
      expect(
        named.find((r) => r.path === path).inside,
        `${path} should forbid being inside it`,
      ).toBe(true)
    }
  })

  it('names the home directory, both conventional provider homes, and any redirect', () => {
    const named = forbiddenRoots({
      home: '/home/someone',
      env: { CODEX_HOME: '/elsewhere/codex', CLAUDE_CONFIG_DIR: '/elsewhere/claude' },
      repoRoot: '/repo',
    }).map((root) => root.path)
    expect(named).toEqual([
      '/home/someone',
      '/home/someone/.codex',
      '/home/someone/.claude',
      '/elsewhere/codex',
      '/elsewhere/claude',
      '/repo',
    ])
  })

  it('⚠️ an EMPTY redirect is not a redirect — it must not add the empty string as a root', () => {
    const named = forbiddenRoots({
      home: '/home/someone',
      env: { CODEX_HOME: '', CLAUDE_CONFIG_DIR: '   ' },
    }).map((root) => root.path)
    expect(named).toEqual(['/home/someone', '/home/someone/.codex', '/home/someone/.claude'])
  })

  it('⛔ `isAncestor` appends the separator, so a sibling with a longer name is not inside', () => {
    expect(isAncestor('/a/b', '/a/b/c')).toBe(true)
    expect(isAncestor('/a/b', '/a/b-evil/c')).toBe(false)
    expect(isAncestor('/a/b', '/a/b')).toBe(false)
  })

  it('🔒 this machine really has a home directory, so the guard above is not vacuous', () => {
    expect(homedir().length).toBeGreaterThan(1)
    expect(forbiddenRoots().map((root) => root.path)).toContain(join(homedir(), '.codex'))
  })
})

describe('🔴 the two containment directions the first draft did not have', () => {
  /**
   * 🔴 **The critical one, and it was one string comparison away from emptying a home directory.**
   *
   * ⛔ JavaScript's `realpathSync` resolves symlinks and does NOT canonicalise CASE, and macOS's
   * default APFS volume is case-insensitive. So `--dir /users/alex` resolved to
   * `/users/alex`, which equals no forbidden root, is an ancestor of none and is inside none
   * — and `trustedAnchor` returned `trusted` on `$HOME`.
   *
   * ⚑ **Both branches assert something.** On a case-insensitive volume the mis-cased spelling must
   * be refused; on a case-sensitive one it is a genuinely different directory and must not be
   * refused for a reason that does not apply. A test that skipped on the second would be measuring
   * the machine rather than the code.
   */
  it('⛔ a differently-CASED spelling of a forbidden root is still that root', () => {
    const root = fixture()
    const home = join(root, 'Home')
    mkdirSync(join(home, 'Documents'), { recursive: true })
    writeFileSync(join(home, 'Documents', 'thesis.txt'), 'years of work\n')
    const miscased = join(root, 'home')

    const caseInsensitive = (() => {
      try {
        return lstatSync(miscased).ino === lstatSync(home).ino
      } catch {
        return false
      }
    })()

    const anchor = trustedAnchor(miscased, { home, env: {}, cwd: root })
    if (caseInsensitive) {
      expect(anchor.kind, 'a mis-cased $HOME was trusted').toBe('refused')
      expect(anchor.why).toContain('your home directory')
    } else {
      expect(anchor.kind, 'on a case-sensitive volume these are two directories').toBe('absent')
    }
    expect(readFileSync(join(home, 'Documents', 'thesis.txt'), 'utf8')).toBe('years of work\n')
  })

  it('⛔ a target INSIDE a never-touch root is refused', () => {
    const root = fixture()
    const home = join(root, 'home')
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
    const anchor = trustedAnchor(join(home, '.claude', 'projects'), { home, env: {}, cwd: root })
    expect(anchor.kind).toBe('refused')
    expect(anchor.why).toContain("is inside the machine's conventional Claude home")
  })

  it('⛔ …and inside the checkout, which a plain `--dir apps` would reach', () => {
    const root = fixture()
    const checkout = join(root, 'brobot-2')
    mkdirSync(join(checkout, 'apps', 'desktop'), { recursive: true })
    const anchor = trustedAnchor(
      join(checkout, 'apps'),
      elsewhere({ repoRoot: checkout, cwd: root }),
    )
    expect(anchor.why).toContain('is inside the BroBot2 checkout')
  })

  /** ⚑ Without this the rule above would be "refuse everything", which is not a rule. */
  it('⚑ …and a userData INSIDE $HOME is still trusted, which is every ordinary run', () => {
    const root = fixture()
    const home = join(root, 'home')
    const userData = join(home, 'Library', 'Application Support', '@brobot2', 'desktop')
    mkdirSync(userData, { recursive: true })
    const anchor = trustedAnchor(userData, { home, env: {}, cwd: root })
    expect(anchor.kind, anchor.why ?? '').toBe('trusted')
  })

  it('⛔ a forbidden root that could not be RESOLVED refuses the run, rather than being skipped', () => {
    const root = fixture()
    const home = join(root, 'home')
    const locked = join(home, 'locked')
    mkdirSync(join(locked, '.codex'), { recursive: true })
    const userData = join(root, 'ud')
    mkdirSync(userData, { recursive: true })
    chmodSync(locked, 0o000)
    try {
      const anchor = trustedAnchor(userData, {
        home,
        cwd: root,
        env: { CODEX_HOME: join(locked, '.codex') },
      })
      expect(anchor.kind).toBe('refused')
      expect(anchor.why).toContain('could not be resolved')
    } finally {
      chmodSync(locked, 0o700)
    }
  })
})

describe('🔴 W4.124 · a never-touch folder by its other spelling is the same folder', () => {
  /**
   * ⛔ **macOS shows every folder on its Data volume twice**: at `/`, and under the volume's own
   * mount point `/System/Volumes/Data`. `realpath(3)` hands either spelling back exactly as given,
   * and the never-touch checks were string comparisons of real paths — so the Data-volume spelling
   * of `~/.claude`, of a folder inside it, of one holding it, or a link to any of them, was TRUSTED.
   *
   * ⚑ **Every never-touch folder here is a throwaway one**: a scratch home under a fixture root, with
   * no environment, reached in its Data-volume spelling. ⚠️ darwin only: elsewhere there is no
   * second spelling to test.
   */
  const DATA_VOLUME = '/System/Volumes/Data'

  /** A scratch home holding both provider homes, the run's own folder beside it, and `other()`. */
  function aScratchHome() {
    const root = realpathSync.native(fixture())
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
    mkdirSync(join(home, '.codex'), { recursive: true })
    mkdirSync(cwd, { recursive: true })
    const other = (path) => `${DATA_VOLUME}${path}`
    // ⛔ The premise, asserted: the other spelling names this very folder. Wrong, and every
    // refusal below would be about some other folder.
    expect(statSync(other(root)).ino, `${other(root)} is not ${root}`).toBe(statSync(root).ino)
    return { root, home, cwd, other, base: { home, env: {}, cwd } }
  }

  it('⛔ the home, its Claude home and its Codex home, spelled the other way, are each refused as itself', (ctx) => {
    ctx.skip(process.platform !== 'darwin')
    const { home, other, base } = aScratchHome()
    expect(trustedAnchor(other(home), base).why).toContain('is your home directory')
    expect(trustedAnchor(other(join(home, '.claude')), base).why).toContain(
      "is the machine's conventional Claude home",
    )
    expect(trustedAnchor(other(join(home, '.codex')), base).why).toContain(
      "is the machine's conventional Codex home",
    )
  })

  it('⛔ …and a folder inside one, and one holding the home, spelled the other way', (ctx) => {
    ctx.skip(process.platform !== 'darwin')
    const { root, home, other, base } = aScratchHome()
    expect(trustedAnchor(other(join(home, '.claude', 'projects')), base).why).toContain(
      "is inside the machine's conventional Claude home",
    )
    expect(trustedAnchor(other(root), base).why).toContain('contains your home directory')
  })

  it('⛔ a link to the other spelling is the folder it leads to', (ctx) => {
    ctx.skip(process.platform !== 'darwin')
    const { root, home, other, base } = aScratchHome()
    symlinkSync(other(join(home, '.claude')), join(root, 'to-claude'))
    symlinkSync(other(home), join(root, 'to-home'))
    expect(trustedAnchor(join(root, 'to-claude'), base).why).toContain(
      "is the machine's conventional Claude home",
    )
    expect(trustedAnchor(join(root, 'to-home', '.claude', 'projects'), base).why).toContain(
      "is inside the machine's conventional Claude home",
    )
  })

  it('⛔ a redirect, the working directory and the checkout, each spelled one way and reached the other', (ctx) => {
    ctx.skip(process.platform !== 'darwin')
    const { root, cwd, other, base } = aScratchHome()
    const elsewhereClaude = join(root, 'elsewhere-claude')
    mkdirSync(elsewhereClaude, { recursive: true })
    const redirected = { ...base, env: { CLAUDE_CONFIG_DIR: other(elsewhereClaude) } }
    expect(trustedAnchor(elsewhereClaude, redirected).why).toContain(
      'is the CLAUDE_CONFIG_DIR this shell redirects to',
    )
    expect(trustedAnchor(cwd, { ...base, cwd: other(cwd) }).why).toContain(
      'the directory this was run from',
    )
    expect(trustedAnchor(other(root), { ...base, home: join(root, 'no-home') }).why).toContain(
      'the directory this was run from',
    )
    const checkout = join(root, 'brobot-2')
    mkdirSync(join(checkout, 'apps'), { recursive: true })
    expect(
      trustedAnchor(other(join(checkout, 'apps')), { ...base, repoRoot: checkout }).why,
    ).toContain('is inside the BroBot2 checkout')
  })

  /** ⚑ Without this the rules above would be "refuse the other spelling", which is not a rule. */
  it('⚑ …and an ordinary userData inside the home, or a folder beside it, is trusted in either spelling', (ctx) => {
    ctx.skip(process.platform !== 'darwin')
    const { root, home, other, base } = aScratchHome()
    const userData = join(home, 'Library', 'Application Support', '@brobot2', 'desktop')
    const beside = join(root, 'beside')
    mkdirSync(userData, { recursive: true })
    mkdirSync(beside, { recursive: true })
    for (const target of [userData, other(userData), beside, other(beside)]) {
      const anchor = trustedAnchor(target, base)
      expect(anchor.kind, `${target}: ${anchor.why ?? ''}`).toBe('trusted')
    }
  })

  /**
   * ⛔ **The volume's own mount point holds every folder on it — and only the other spelling says
   * so.** Walking up from the home's usual spelling never meets `/System/Volumes/Data`: the parent
   * of a folder at `/` is `/`, and `/` is not that folder (measured). ⚑ A CHECK only: nothing is
   * listed or removed. The ownership rule is given the mount point's own owner, so the refusal
   * asserted is the one that holds when the reset runs as that owner.
   */
  it('⛔ the Data volume and the folders above it are refused as holding the home, even for their owner', (ctx) => {
    ctx.skip(process.platform !== 'darwin')
    const { base } = aScratchHome()
    for (const target of [DATA_VOLUME, '/System/Volumes', '/System']) {
      const anchor = trustedAnchor(target, { ...base, uid: lstatSync(target).uid })
      expect(anchor.kind, target).toBe('refused')
      expect(anchor.why, target).toContain('contains your home directory')
    }
  })
})

describe('the walker reports what it could not do, and counts only what it did', () => {
  it('⛔ a target that could not be READ between the check and the removal is left in place', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    const parent = join(userData, 'outer')
    mkdirSync(join(parent, 'target'), { recursive: true })
    writeFileSync(join(parent, 'target', 'a.txt'), 'x\n')
    const verdict = mayRemove(anchorAt(userData), 'outer/target', { expect: 'dir' })
    expect(verdict.kind).toBe('ok')

    chmodSync(parent, 0o000)
    try {
      const result = removeChecked(verdict.path, verdict.stat)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].why).toContain('could not be read')
      expect(result.files, 'nothing may be counted as removed').toBe(0)
    } finally {
      chmodSync(parent, 0o700)
    }
    expect(existsSync(join(parent, 'target', 'a.txt'))).toBe(true)
  })

  it('⚑ …and the same tree, readable, is removed and counted', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    mkdirSync(join(userData, 'outer', 'target'), { recursive: true })
    writeFileSync(join(userData, 'outer', 'target', 'a.txt'), 'x\n')
    const verdict = mayRemove(anchorAt(userData), 'outer/target', { expect: 'dir' })
    const result = removeChecked(verdict.path, verdict.stat)
    expect(result.failed).toEqual([])
    expect(result.files).toBe(1)
    expect(result.bytes).toBe(2)
  })

  it('⛔ bytes are counted only for a file that actually came off', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    const tree = join(userData, 'tree')
    mkdirSync(join(tree, 'sub'), { recursive: true })
    writeFileSync(join(tree, 'gone.txt'), '12345\n')
    writeFileSync(join(tree, 'sub', 'stuck.txt'), '1234567890\n')
    const verdict = mayRemove(anchorAt(userData), 'tree', { expect: 'dir' })

    chmodSync(join(tree, 'sub'), 0o500)
    try {
      const result = removeChecked(verdict.path, verdict.stat)
      expect(result.failed.length).toBeGreaterThan(0)
      expect(result.files, 'only the one that came off').toBe(1)
      expect(result.bytes, 'the stuck file must not be inside the removed total').toBe(6)
    } finally {
      chmodSync(join(tree, 'sub'), 0o700)
    }
  })

  it('⛔ an anchor replaced under the walk refuses every removal proved against it', (ctx) => {
    // ⚠️ **darwin only** (T-001): its premise is that a folder made again gets a new inode, as APFS does; ext4 reuses it.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    const root = fixture()
    const userData = join(root, 'ud')
    mkdirSync(join(userData, 'Cache'), { recursive: true })
    const anchor = anchorAt(userData)

    rmSync(userData, { recursive: true })
    mkdirSync(join(userData, 'Cache'), { recursive: true })
    writeFileSync(join(userData, 'Cache', 'somebody-elses.txt'), 'new tree\n')

    const verdict = mayRemove(anchor, 'Cache', { expect: 'dir' })
    expect(verdict.kind).toBe('refused')
    expect(verdict.why).toContain('replaced under the walk')
    expect(existsSync(join(userData, 'Cache', 'somebody-elses.txt'))).toBe(true)
  })
})
