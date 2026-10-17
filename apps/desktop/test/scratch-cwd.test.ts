import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { brobotWorkspace } from '../src/main/runtime/workspace'
import { checkSessionCwd, resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

describe('resolveSessionCwd', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-cwd-'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('defaults to the DURABLE workspace, shared by every conversation (006)', () => {
    // Changed deliberately in 006: this used to be a fresh `<scratch>/<sessionId>` per session,
    // which threw the work away the moment a conversation ended. Continuity comes from
    // conversations sharing one directory.
    const cwd = resolveSessionCwd(userData, 'sess_1')

    expect(cwd).toBe(brobotWorkspace(userData))
    expect(statSync(cwd).isDirectory()).toBe(true)
    expect(statSync(cwd).mode & 0o777).toBe(0o700)
    // Same directory for the next conversation — that is the point.
    expect(resolveSessionCwd(userData, 'sess_2')).toBe(cwd)
  })

  it('treats a blank cwd as "none"', () => {
    expect(resolveSessionCwd(userData, 'sess_2', '   ')).toBe(brobotWorkspace(userData))
  })

  it('accepts an existing directory', () => {
    // OUTSIDE `userData`, because that is where a real working directory lives. ⚑ `726` · R92: a
    // folder inside `userData` is accepted too now (071's refusal is gone) — see the describe below.
    const elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-cwd-elsewhere-'))
    try {
      expect(resolveSessionCwd(userData, 'sess_3', elsewhere)).toBe(elsewhere)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('expands a home-relative path', () => {
    expect(resolveSessionCwd(userData, 'sess_4', '~')).toBe(homedir())
  })

  /**
   * ⚑ **The EXISTENCE rule and the DIRECTORY rule**, measured outside `userData`. (From `489` until
   * `726` a path inside `userData` met the app-data wall before the disk was asked; R92 removed the
   * wall, and the same two rules now answer there too — asserted below.)
   */
  it('refuses a directory that does not exist rather than creating what was mistyped', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-cwd-gone-'))
    try {
      expect(() => resolveSessionCwd(userData, 'sess_5', join(elsewhere, 'typo'))).toThrow(
        /cwd does not exist/,
      )
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('refuses a file', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-cwd-file-'))
    try {
      const file = join(elsewhere, 'a-file')
      writeFileSync(file, 'x')
      expect(() => resolveSessionCwd(userData, 'sess_6', file)).toThrow(/cwd is not a directory/)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  describe("the app's own data is a working directory like any other (`726` · R92, was 071)", () => {
    it('🔴 726 · R92 — the provider homes, and `userData` itself, are accepted as a cwd', () => {
      // A cwd inside BroBot’s data directory is admitted; there is no separate
      // credential-root scan or location guard.
      const homes = join(userData, 'provider-homes', 'default', 'default', 'codex')
      mkdirSync(homes, { recursive: true })
      expect(resolveSessionCwd(userData, 'sess_7', homes)).toBe(homes)
      expect(resolveSessionCwd(userData, 'sess_7', join(userData, 'provider-homes'))).toBe(
        join(userData, 'provider-homes'),
      )
      expect(resolveSessionCwd(userData, 'sess_7', userData)).toBe(userData)
      // ⚑ **The CONTROL: the rules that are not about WHERE still answer there.** A missing folder
      // inside `userData` is said missing, and a file is still not a directory.
      expect(() =>
        resolveSessionCwd(userData, 'sess_7', join(userData, 'provider-homes', 'nope')),
      ).toThrow(/cwd does not exist/)
      const file = join(userData, 'a-file')
      writeFileSync(file, 'x')
      expect(() => resolveSessionCwd(userData, 'sess_7', file)).toThrow(/cwd is not a directory/)
    })

    it('permits the workspace and anything under it, by name as well as by default', () => {
      const workspace = resolveSessionCwd(userData, 'sess_8')
      expect(workspace).toBe(brobotWorkspace(userData))
      // Asked for BY NAME, not just as the default: a user who types the workspace path gets the
      // same answer as one who types nothing.
      expect(resolveSessionCwd(userData, 'sess_9', workspace)).toBe(workspace)
      const nested = join(workspace, 'a-project')
      mkdirSync(nested, { recursive: true })
      expect(resolveSessionCwd(userData, 'sess_10', nested)).toBe(nested)
    })
  })
})

describe('the verdict the folder picker shows (076 §3)', () => {
  /**
   * ⚠️ **The point of these is that there is ONE rule, not two.**
   *
   * 076 §3 asks for 071's refusals to be readable at choose-time instead of arriving as a failed
   * launch minutes later. The tempting way to do that is a second check in the picker, phrased for
   * a human — and that is the shape of defect this project keeps paying for: two statements of one
   * rule, the friendlier one drifting, and the drift landing in the check the launch runs. So
   * `resolveSessionCwd` is now a thin `throw` over `checkSessionCwd`, and what is asserted here is
   * that the two cannot disagree.
   */
  // ⚑ `726` · R92 removed the app-data refusal, so the corpus lost its `provider-homes` and
  // `userData itself` cases: both are accepted now, by the picker and the launch alike.
  const cases = (root: string) => [
    { what: 'a path that does not exist', path: join(root, 'nope') },
    { what: 'a file', path: join(root, 'file.txt') },
  ]

  it('refuses exactly what the launch refuses, with exactly the same sentence', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'brobot-cwd-verdict-'))
    const root = mkdtempSync(join(tmpdir(), 'brobot-cwd-outside-'))
    writeFileSync(join(root, 'file.txt'), 'x')

    for (const { what, path } of cases(root)) {
      const verdict = checkSessionCwd(path)
      expect(verdict.ok, what).toBe(false)
      if (verdict.ok) throw new Error('unreachable')
      // The launch's message and the picker's are the SAME string, because they are the same
      // string — not because two authors agreed. This is what stops one of them going stale.
      let thrown = ''
      try {
        resolveSessionCwd(userData, 'sess_1', path)
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error)
      }
      expect(thrown, what).toBe(verdict.reason)
      // And it names the path, because a refusal a user cannot act on is only half a refusal.
      expect(verdict.reason).toContain(path)
    }
  })

  it('accepts what the launch accepts, and returns the resolved path', async () => {
    // Paired with the refusals above: a check that only ever said "no" would satisfy every
    // assertion in the previous test while being useless.
    const userData = mkdtempSync(join(tmpdir(), 'brobot-cwd-verdict-ok-'))
    const root = mkdtempSync(join(tmpdir(), 'brobot-cwd-outside-ok-'))
    const verdict = checkSessionCwd(root)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.path).toBe(resolveSessionCwd(userData, 'sess_1', root))

    // The workspace is the default folder, and the picker has to agree — refusing it there would
    // make the default folder unpickable.
    const workspace = brobotWorkspace(userData)
    mkdirSync(workspace, { recursive: true })
    expect(checkSessionCwd(workspace).ok).toBe(true)
  })

  it('treats a blank path as "choose something", not as the workspace default', async () => {
    // `resolveSessionCwd` reads blank as "use the workspace", which is right for a LAUNCH — the
    // field is optional. It is not right for a picker verdict: nothing was chosen, so there is
    // nothing to approve, and returning the workspace would tell the user they had picked it.
    const userData = mkdtempSync(join(tmpdir(), 'brobot-cwd-blank-'))
    const verdict = checkSessionCwd('   ')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.reason).toContain('choose a folder')
    // …while the launch still defaults, unchanged.
    expect(resolveSessionCwd(userData, 'sess_1', '   ')).toBe(brobotWorkspace(userData))
  })
})
