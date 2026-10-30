import { createHash } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withProviderHomeLock } from '../src/internal/provider-home'
import {
  AuthUnavailableError,
  NoCodexSignInOnThisComputerError,
  assertCodexSqliteHomeContained,
  fallbackSignIn,
  claudeAuthHealth,
  claudeKeychainTokenProvider,
  codexAuthHealth,
  parseClaudeOAuthToken,
  provisionCodexAuth,
  codexCopyIdentityIn,
  type CodexCopyIdentity,
  replaceARefusedCodexCopy,
  reprovisionCodexAuth,
} from '../src/internal/auth'
import { whoElseCanOpen } from '../../../scripts/lib/readable-only-by-this-user.mjs'

/**
 * A sign-in file is compared by a digest of its bytes, so a failure prints two digests and never
 * what a file holds.
 */
const digestOf = (bytes: string | Buffer): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16)
const signInAt = (path: string): string => digestOf(readFileSync(path))

/**
 * Auth-inheritance unit tests (022). No live secret: the Keychain is a mocked
 * reader seam and Codex auth is copied within throwaway temp dirs — `pnpm run ci`
 * never touches the real Keychain or `~/.codex`.
 */

const NOW = 1_700_000_000_000
const blob = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-oat01-ACCESS',
      refreshToken: 'sk-ant-ort01-REFRESH-MUST-NOT-SURFACE',
      expiresAt: NOW + 60_000,
      scopes: ['user:inference'],
      ...over,
    },
  })

describe('parseClaudeOAuthToken (022)', () => {
  it('extracts only the current access token (never the refresh token)', () => {
    const parsed = parseClaudeOAuthToken(blob(), NOW)
    expect(parsed?.accessToken).toBe('sk-ant-oat01-ACCESS')
    // The parsed shape has no refresh field at all — it cannot leak.
    expect(JSON.stringify(parsed)).not.toContain('REFRESH')
  })

  it('returns the token when there is no expiry', () => {
    expect(parseClaudeOAuthToken(blob({ expiresAt: undefined }), NOW)?.accessToken).toBe(
      'sk-ant-oat01-ACCESS',
    )
  })

  it('returns null for an expired token', () => {
    expect(parseClaudeOAuthToken(blob({ expiresAt: NOW - 1 }), NOW)).toBeNull()
  })

  it('returns null for absent / malformed / shape-mismatched blobs', () => {
    expect(parseClaudeOAuthToken(null, NOW)).toBeNull()
    expect(parseClaudeOAuthToken('not json', NOW)).toBeNull()
    expect(parseClaudeOAuthToken('{}', NOW)).toBeNull()
    expect(parseClaudeOAuthToken(JSON.stringify({ claudeAiOauth: {} }), NOW)).toBeNull()
  })
})

describe('claudeKeychainTokenProvider (022)', () => {
  it('yields the access token from the (mocked) Keychain and re-reads on every call', () => {
    let reads = 0
    const provider = claudeKeychainTokenProvider(
      () => {
        reads++
        return blob()
      },
      () => NOW,
    )
    expect(provider()).toBe('sk-ant-oat01-ACCESS')
    expect(provider()).toBe('sk-ant-oat01-ACCESS')
    expect(reads).toBe(2) // re-read each dispatch so an expired token is never reused
  })

  it('yields null when the login is absent or expired', () => {
    expect(
      claudeKeychainTokenProvider(
        () => null,
        () => NOW,
      )(),
    ).toBeNull()
    expect(
      claudeKeychainTokenProvider(
        () => blob({ expiresAt: NOW - 1 }),
        () => NOW,
      )(),
    ).toBeNull()
  })

  it('claudeAuthHealth reflects token availability', () => {
    expect(claudeAuthHealth(() => 'tok')).toEqual({ ok: true })
    const bad = claudeAuthHealth(() => null)
    expect(bad.ok).toBe(false)
    // 098: the reason has to be ACTIONABLE, not just present. The old one — "personal Claude login
    // unavailable or expired" — is what the app said while the machine login was healthy and one
    // refresh away, which is the common case: the Keychain access token measured 29 minutes of life
    // with a four-week refresh token beside it. So the assertion is on the instruction, because
    // that is the part a user needs and the part a reword could quietly drop.
    expect(bad.reason).toMatch(/run `claude`/i)
    // Windows can have no file login yet, rather than an expired Mac keychain login.
    expect(bad.reason).toMatch(process.platform === 'win32' ? /not signed in/ : /expired/)
    // ⚠️ And it must NOT tell them to sign in again — there is nothing here to sign into, and
    // sending someone to a login flow to fix an expired cache is how you lose an account.
    expect(bad.reason).not.toMatch(/sign in again/i)
  })
})

describe('provisionCodexAuth (022)', () => {
  let home: string
  let sourceDir: string
  let source: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot-codex-home-'))
    sourceDir = mkdtempSync(join(tmpdir(), 'brobot-codex-src-'))
    source = join(sourceDir, 'auth.json')
    writeFileSync(source, '{"tokens":{"access_token":"CODEX-ACCESS"}}')
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(sourceDir, { recursive: true, force: true })
  })

  it('copies auth.json content into the home at 0600, atomically, leaving no temp file', async () => {
    await provisionCodexAuth(home, { sourceAuthPath: source })
    const dest = join(home, 'auth.json')
    expect(signInAt(dest)).toBe(digestOf('{"tokens":{"access_token":"CODEX-ACCESS"}}'))
    expect(whoElseCanOpen(dest, 0o600)).toEqual([])
    expect(lstatSync(dest).isSymbolicLink()).toBe(false)
    expect(readdirSync(home)).toEqual(['auth.json']) // no leftover .tmp
  })

  it('throws AuthUnavailableError when the personal auth.json is absent (no global fallback)', async () => {
    await expect(
      provisionCodexAuth(home, { sourceAuthPath: join(sourceDir, 'missing.json') }),
    ).rejects.toThrow(AuthUnavailableError)
  })

  it('🔴 a computer with no Codex sign-in is its own failure, apart from one that could not be read', async () => {
    // No file: there is no sign-in to renew, so the refusal that follows must not say "sign in again".
    await expect(
      provisionCodexAuth(home, { sourceAuthPath: join(sourceDir, 'missing.json') }),
    ).rejects.toThrow(NoCodexSignInOnThisComputerError)
    // A folder where the file should be: something is there and could not be read.
    const unreadable = join(sourceDir, 'a-folder.json')
    mkdirSync(unreadable)
    const failure = await provisionCodexAuth(home, { sourceAuthPath: unreadable }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(AuthUnavailableError)
    expect(failure).not.toBeInstanceOf(NoCodexSignInOnThisComputerError)
  })

  describe('BroBot’s own sign-in, where the computer has none', () => {
    const OWN = '{"tokens":{"access_token":"BROBOT-OWN"}}'
    /** A managed root holding BroBot's own home and a helper's, as the app lays them down. */
    let root: string
    let helper: string
    let ownHome: string
    let own: string
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'brobot-codex-root-'))
      helper = join(root, 'homes', 'farah', 'codex')
      ownHome = join(root, 'homes', 'brobot', 'codex')
      mkdirSync(helper, { recursive: true, mode: 0o700 })
      mkdirSync(ownHome, { recursive: true, mode: 0o700 })
      own = join(ownHome, 'auth.json')
      writeFileSync(own, OWN, { mode: 0o600 })
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))
    const missing = (): string => join(sourceDir, 'missing.json')
    const copy = (fallbackAuthPath: string, sourceAuthPath = missing()) =>
      provisionCodexAuth(helper, { sourceAuthPath, managedRoot: root, fallbackAuthPath })
    const failureOf = (work: Promise<void>) =>
      work.then(
        () => null,
        (error: unknown) => error,
      )

    it('🔴 is copied when this computer has no Codex sign-in, as the computer’s would be', async () => {
      await copy(own)
      const dest = join(helper, 'auth.json')
      expect(signInAt(dest)).toBe(digestOf(OWN))
      if (process.platform !== 'win32') expect(lstatSync(dest).mode & 0o777).toBe(0o600)
      expect(lstatSync(dest).isSymbolicLink()).toBe(false)
      expect(readdirSync(helper)).toEqual(['auth.json'])
    })

    it('⚑ the computer’s own comes first whenever it has one', async () => {
      await copy(own, source)
      expect(signInAt(join(helper, 'auth.json'))).toBe(
        digestOf('{"tokens":{"access_token":"CODEX-ACCESS"}}'),
      )
    })

    it('⚑ with neither, there is no Codex sign-in to start on: a missing file, or a missing folder above it', async () => {
      rmSync(own)
      await expect(copy(own)).rejects.toThrow(NoCodexSignInOnThisComputerError)
      rmSync(join(root, 'homes', 'brobot'), { recursive: true, force: true })
      await expect(copy(own)).rejects.toThrow(NoCodexSignInOnThisComputerError)
      expect(readdirSync(helper)).toEqual([])
    })

    it('⛔ a folder, or a file that is not a whole sign-in object, is refused as unusable, and nothing is installed', async () => {
      const folder = join(ownHome, 'a-folder')
      mkdirSync(folder)
      const torn = join(ownHome, 'torn.json')
      writeFileSync(torn, '{"tokens":{"access_to')
      const notAnObject = join(ownHome, 'not-an-object.json')
      writeFileSync(notAnObject, '"just a string"')
      const anArray = join(ownHome, 'an-array.json')
      writeFileSync(anArray, '[{"tokens":{}}]')
      for (const fallback of [folder, torn, notAnObject, anArray]) {
        const failure = await failureOf(copy(fallback))
        expect(failure, fallback).toBeInstanceOf(AuthUnavailableError)
        expect(failure, fallback).not.toBeInstanceOf(NoCodexSignInOnThisComputerError)
        // ⚑ Refused as BroBot's own, never as the computer's missing one.
        expect((failure as Error).message, fallback).toMatch(/^BroBot's own Codex sign-in /)
        expect(readdirSync(helper), fallback).toEqual([])
      }
    })

    it('🔴 one that is there and cannot be read is a sign-in that could not be used, never none', async () => {
      if (process.platform === 'win32' || process.getuid?.() === 0) return
      chmodSync(ownHome, 0o000)
      try {
        const failure = await failureOf(copy(own))
        expect(failure).toBeInstanceOf(AuthUnavailableError)
        expect(failure).not.toBeInstanceOf(NoCodexSignInOnThisComputerError)
        expect((failure as Error).message).toMatch(/^BroBot's own Codex sign-in could not be read/)
      } finally {
        chmodSync(ownHome, 0o700)
      }
      expect(readdirSync(helper)).toEqual([])
    })

    it('🔴 a sign-in file that is a link could not be used, and none is copied', async () => {
      const linked = join(ownHome, 'linked.json')
      symlinkSync(own, linked)
      const failure = await failureOf(copy(linked))
      expect(failure).toBeInstanceOf(AuthUnavailableError)
      expect(failure).not.toBeInstanceOf(NoCodexSignInOnThisComputerError)
      expect((failure as Error).message).toMatch(/^BroBot's own Codex sign-in /)
      expect(readdirSync(helper)).toEqual([])
    })

    it('🔴 a file swapped after it was looked at could not be used, and is not read', () => {
      // A new file at the same path: another inode than the one looked at. ⚑ The one looked at
      // is moved aside and kept, because a file system may give a removed file's number to the
      // next file made.
      const newFile = () => {
        renameSync(own, `${own}.looked-at`)
        writeFileSync(own, '{"tokens":{"access_token":"SWAPPED"}}', { mode: 0o600 })
      }
      expect(() => fallbackSignIn({ path: own, managedRoot: root }, newFile)).toThrow(
        /^BroBot's own Codex sign-in moved while it was read/,
      )
      // Its folder replaced by a link to a tree outside the managed root.
      const outside = mkdtempSync(join(tmpdir(), 'brobot-codex-outside-'))
      try {
        writeFileSync(join(outside, 'auth.json'), '{"tokens":{"access_token":"OUTSIDE"}}')
        const linkTheFolder = () => {
          renameSync(ownHome, `${ownHome}-moved`)
          symlinkSync(outside, ownHome)
        }
        let failure: unknown = null
        try {
          fallbackSignIn({ path: own, managedRoot: root }, linkTheFolder)
        } catch (error) {
          failure = error
        }
        expect(failure).toBeInstanceOf(AuthUnavailableError)
        expect(failure).not.toBeInstanceOf(NoCodexSignInOnThisComputerError)
        expect((failure as Error).message).toMatch(
          /^BroBot's own Codex sign-in moved while it was read/,
        )
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
      // Its folder replaced by a link to the very same folder: the same file is opened, and the
      // chain re-proved after the read finds the link.
      unlinkSync(ownHome)
      renameSync(`${ownHome}-moved`, ownHome)
      const throughALink = () => {
        renameSync(ownHome, `${ownHome}-moved`)
        symlinkSync(`${ownHome}-moved`, ownHome)
      }
      expect(() => fallbackSignIn({ path: own, managedRoot: root }, throughALink)).toThrow(
        /^BroBot's own Codex sign-in moved while it was read/,
      )
      // The file itself replaced by a link to itself: never followed.
      unlinkSync(ownHome)
      renameSync(`${ownHome}-moved`, ownHome)
      const fileAsALink = () => {
        renameSync(own, `${own}-moved`)
        symlinkSync(`${own}-moved`, own)
      }
      expect(() => fallbackSignIn({ path: own, managedRoot: root }, fileAsALink)).toThrow(
        /^BroBot's own Codex sign-in could not be read/,
      )
      unlinkSync(own)
      renameSync(`${own}-moved`, own)
      // ⚑ The pairing: left alone, the same read hands the sign-in back.
      const read = fallbackSignIn({ path: own, managedRoot: root })
      expect(read === null ? null : digestOf(read)).toBe(
        digestOf('{"tokens":{"access_token":"SWAPPED"}}'),
      )
    })

    it('🔴 a link anywhere in BroBot’s own folder chain cannot send the read outside the managed root', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'brobot-codex-outside-'))
      try {
        mkdirSync(join(outside, 'codex'), { mode: 0o700 })
        writeFileSync(join(outside, 'codex', 'auth.json'), '{"tokens":{"access_token":"OUTSIDE"}}')
        // BroBot's own home, then its profile folder, each replaced by a link to the outside tree.
        for (const [linkAt, target] of [
          [ownHome, join(outside, 'codex')],
          [join(root, 'homes', 'brobot'), outside],
        ] as const) {
          rmSync(join(root, 'homes', 'brobot'), { recursive: true, force: true })
          mkdirSync(join(root, 'homes', 'brobot'), { mode: 0o700 })
          rmSync(linkAt, { recursive: true, force: true })
          symlinkSync(target, linkAt)
          const failure = await failureOf(copy(own))
          // ⚑ There, and not BroBot's: a sign-in that could not be used, never none.
          expect(failure, linkAt).toBeInstanceOf(AuthUnavailableError)
          expect(failure, linkAt).not.toBeInstanceOf(NoCodexSignInOnThisComputerError)
          expect((failure as Error).message, linkAt).toMatch(
            /^BroBot's own Codex sign-in is not where BroCrew keeps it/,
          )
          expect(readdirSync(helper), linkAt).toEqual([])
        }
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    })

    it('⚑ the computer’s own, and a sign-in the helper already holds, never depend on BroBot’s own being safe', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'brobot-codex-outside-'))
      try {
        writeFileSync(join(outside, 'auth.json'), '{"tokens":{"access_token":"OUTSIDE"}}')
        rmSync(ownHome, { recursive: true, force: true })
        symlinkSync(outside, ownHome)
        // This computer's own is copied, and BroBot's unsafe folder is never consulted.
        await copy(own, source)
        expect(signInAt(join(helper, 'auth.json'))).toBe(
          digestOf('{"tokens":{"access_token":"CODEX-ACCESS"}}'),
        )
        // A helper that already holds a sign-in keeps it, with neither source consulted.
        writeFileSync(join(helper, 'auth.json'), '{"tokens":{"access_token":"ITS-OWN"}}', {
          mode: 0o600,
        })
        await copy(own)
        expect(signInAt(join(helper, 'auth.json'))).toBe(
          digestOf('{"tokens":{"access_token":"ITS-OWN"}}'),
        )
        // And with BroBot's own folder gone altogether, the computer's own still comes through.
        rmSync(join(helper, 'auth.json'))
        unlinkSync(ownHome)
        await copy(own, source)
        expect(signInAt(join(helper, 'auth.json'))).toBe(
          digestOf('{"tokens":{"access_token":"CODEX-ACCESS"}}'),
        )
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    })

    it('⛔ a fallback is never read without a managed root to keep it under', async () => {
      await expect(
        provisionCodexAuth(helper, { sourceAuthPath: missing(), fallbackAuthPath: own }),
      ).rejects.toThrow(/managed root/)
      expect(readdirSync(helper)).toEqual([])
    })

    it('⚑ a home that already holds a sign-in keeps it: the copy is made once', async () => {
      writeFileSync(join(helper, 'auth.json'), '{"tokens":{"access_token":"ITS-OWN"}}', {
        mode: 0o600,
      })
      await copy(own)
      expect(signInAt(join(helper, 'auth.json'))).toBe(
        digestOf('{"tokens":{"access_token":"ITS-OWN"}}'),
      )
    })
  })

  it('never overwrites an existing (possibly-refreshed) profile credential', async () => {
    await provisionCodexAuth(home, { sourceAuthPath: source })
    writeFileSync(join(home, 'auth.json'), '{"tokens":{"access_token":"REFRESHED-IN-PROFILE"}}') // profile refreshed
    writeFileSync(source, '{"tokens":{"access_token":"STALE-PERSONAL"}}') // personal changed
    await provisionCodexAuth(home, { sourceAuthPath: source }) // must NOT clobber the profile copy
    expect(signInAt(join(home, 'auth.json'))).toBe(
      digestOf('{"tokens":{"access_token":"REFRESHED-IN-PROFILE"}}'),
    )
  })

  it('keeps a profile auth.json the person linked to a sign-in, and replaces a link to nothing', async () => {
    symlinkSync(source, join(home, 'auth.json'))
    await provisionCodexAuth(home, { sourceAuthPath: source })
    expect(lstatSync(join(home, 'auth.json')).isSymbolicLink()).toBe(true)
    rmSync(join(home, 'auth.json'))
    symlinkSync(join(sourceDir, 'gone.json'), join(home, 'auth.json'))
    await provisionCodexAuth(home, { sourceAuthPath: source })
    expect(lstatSync(join(home, 'auth.json')).isFile()).toBe(true)
    expect(signInAt(join(home, 'auth.json'))).toBe(
      digestOf('{"tokens":{"access_token":"CODEX-ACCESS"}}'),
    )
  })

  it('does not write the credential through a pre-created predictable temp symlink (027 P1-H)', async () => {
    const victim = join(sourceDir, 'victim.txt')
    writeFileSync(victim, 'ORIGINAL')
    // Pre-fix used a PREDICTABLE `.auth.json.tmp-${pid}` with a symlink-following write.
    // Plant that symlink → the victim; post-fix uses a RANDOM O_EXCL|O_NOFOLLOW temp, so
    // the plant is ignored and the credential is never redirected through it.
    symlinkSync(victim, join(home, `.auth.json.tmp-${process.pid}`))
    await provisionCodexAuth(home, { sourceAuthPath: source })
    expect(signInAt(victim)).toBe(digestOf('ORIGINAL')) // credential bytes never redirected
    expect(signInAt(join(home, 'auth.json'))).toBe(
      digestOf('{"tokens":{"access_token":"CODEX-ACCESS"}}'),
    )
  })
})

describe('reprovisionCodexAuth (098) — the ONE writer allowed to replace a profile credential', () => {
  let home: string
  let sourceDir: string
  let source: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot-codex-home-'))
    sourceDir = mkdtempSync(join(tmpdir(), 'brobot-codex-src-'))
    source = join(sourceDir, 'auth.json')
    writeFileSync(source, '{"tokens":{"access_token":"FRESH-PERSONAL"}}')
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(sourceDir, { recursive: true, force: true })
  })

  it('replaces a stale profile credential — and copy-once still refuses to, on the same file', async () => {
    await provisionCodexAuth(home, { sourceAuthPath: source })
    writeFileSync(join(home, 'auth.json'), '{"tokens":{"access_token":"STALE-IN-PROFILE"}}')

    // ⚠️ The pairing that carries the whole design. The two functions are given the identical
    // situation and MUST disagree: the automatic one leaves the profile alone (a refreshed
    // credential would otherwise be clobbered on every launch), the explicit one replaces it.
    await provisionCodexAuth(home, { sourceAuthPath: source })
    expect(signInAt(join(home, 'auth.json'))).toBe(
      digestOf('{"tokens":{"access_token":"STALE-IN-PROFILE"}}'),
    )

    expect(await reprovisionCodexAuth(home, { sourceAuthPath: source })).toBe('replaced')
    expect(signInAt(join(home, 'auth.json'))).toBe(
      digestOf('{"tokens":{"access_token":"FRESH-PERSONAL"}}'),
    )
  })

  it('reports `unchanged` rather than claiming a fix when the machine copy is the same bytes', async () => {
    await provisionCodexAuth(home, { sourceAuthPath: source })
    // If the machine credential is not renewed, pressing the copy button again changes
    // nothing. The UI must say so instead of reporting success and returning the person to a
    // session that still fails.
    expect(await reprovisionCodexAuth(home, { sourceAuthPath: source })).toBe('unchanged')

    // Paired, so `unchanged` is not simply what this function always says.
    writeFileSync(source, '{"tokens":{"access_token":"RENEWED"}}')
    expect(await reprovisionCodexAuth(home, { sourceAuthPath: source })).toBe('replaced')
  })

  it('writes into an empty home too — the `absent` case, not only the stale one', async () => {
    expect(await reprovisionCodexAuth(home, { sourceAuthPath: source })).toBe('replaced')
    expect(signInAt(join(home, 'auth.json'))).toBe(
      digestOf('{"tokens":{"access_token":"FRESH-PERSONAL"}}'),
    )
  })

  it('keeps 0600 and leaves no temp behind, exactly as the copy-once path does', async () => {
    await reprovisionCodexAuth(home, { sourceAuthPath: source })
    const dest = join(home, 'auth.json')
    expect(whoElseCanOpen(dest, 0o600)).toEqual([])
    expect(lstatSync(dest).isSymbolicLink()).toBe(false)
    expect(readdirSync(home)).toEqual(['auth.json'])
  })

  it('replaces a linked destination with a copy, never writing through the link', async () => {
    const before = readFileSync(source)
    symlinkSync(source, join(home, 'auth.json'))
    expect(await reprovisionCodexAuth(home, { sourceAuthPath: source })).toBe('replaced')
    expect(lstatSync(join(home, 'auth.json')).isFile()).toBe(true)
    expect(readFileSync(source)).toEqual(before)
  })

  it('refuses when there is no machine credential to copy, and says what to do', async () => {
    await expect(
      reprovisionCodexAuth(home, { sourceAuthPath: join(sourceDir, 'missing.json') }),
    ).rejects.toThrow(AuthUnavailableError)
    await expect(
      reprovisionCodexAuth(home, { sourceAuthPath: join(sourceDir, 'missing.json') }),
    ).rejects.toThrow(/codex CLI/)
    // ⚠️ And it left nothing behind — a failed re-copy must not leave a half-written credential.
    expect(readdirSync(home)).toEqual([])
  })
})

describe('codexAuthHealth (022)', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot-codex-health-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('ok when a 0600 regular auth.json is present', () => {
    writeFileSync(join(home, 'auth.json'), 'x', { mode: 0o600 })
    expect(codexAuthHealth(home)).toEqual({ ok: true })
  })

  it('not ok when auth.json is absent', () => {
    const health = codexAuthHealth(home)
    expect(health.ok).toBe(false)
    expect(health.reason).toMatch(/no managed Codex auth\.json/)
  })

  it.skipIf(process.platform === 'win32')(
    'makes a file others may read 0600 again, and goes on',
    () => {
      writeFileSync(join(home, 'auth.json'), 'x', { mode: 0o644 })
      expect(codexAuthHealth(home, 'linux')).toEqual({ ok: true })
      expect(lstatSync(join(home, 'auth.json')).mode & 0o777).toBe(0o600)
    },
  )

  it('ok when auth.json is a link the person made to a sign-in file', () => {
    const target = join(home, 'real')
    writeFileSync(target, 'x', { mode: 0o600 })
    symlinkSync(target, join(home, 'auth.json'))
    expect(codexAuthHealth(home)).toEqual({ ok: true })
  })

  it('reports a 0600 DIRECTORY as unhealthy — auth.json must be a regular file (027 P1-H)', () => {
    const dir = join(home, 'auth.json')
    mkdirSync(dir)
    chmodSync(dir, 0o600)
    const health = codexAuthHealth(home)
    expect(health.ok).toBe(false)
    expect(health.reason).toMatch(/regular file/)
  })
})

describe('assertCodexSqliteHomeContained (027 §6)', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot-codex-sqlite-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('passes when there is no config.toml', () => {
    expect(() => assertCodexSqliteHomeContained(home)).not.toThrow()
  })

  it('passes when config sqlite_home stays inside the home (relative)', () => {
    writeFileSync(join(home, 'config.toml'), 'sqlite_home = "sub/state"\n')
    expect(() => assertCodexSqliteHomeContained(home)).not.toThrow()
  })

  it('rejects a config sqlite_home that redirects state out of the home', () => {
    writeFileSync(join(home, 'config.toml'), 'sqlite_home = "/tmp/elsewhere"\n')
    expect(() => assertCodexSqliteHomeContained(home)).toThrow(/redirects/)
  })

  // --- 041, fixing 036 P1-H: TOML key forms + realpath containment + fail-closed ---

  it('rejects a QUOTED-key sqlite_home that escapes (TOML allows quoted keys) (036 P1-H)', () => {
    // Pre-fix the ad-hoc regex only matched a BARE key, so this slipped past attestation entirely.
    writeFileSync(join(home, 'config.toml'), '"sqlite_home" = "/tmp/brobot-escape"\n')
    expect(() => assertCodexSqliteHomeContained(home)).toThrow(/redirects/)
  })

  it('rejects a LITERAL-quoted-key sqlite_home that escapes', () => {
    writeFileSync(join(home, 'config.toml'), "  'sqlite_home'  =  '/tmp/brobot-escape'\n")
    expect(() => assertCodexSqliteHomeContained(home)).toThrow(/redirects/)
  })

  it('rejects an in-home path that SYMLINKS outside the home (realpath containment) (036 P1-H)', () => {
    // Lexically `inside-link` is inside the home; its real path is not. Pre-fix the lexical
    // check accepted it, so Codex state would land outside the managed profile home.
    const outside = mkdtempSync(join(tmpdir(), 'brobot-codex-outside-'))
    try {
      symlinkSync(outside, join(home, 'inside-link'))
      writeFileSync(join(home, 'config.toml'), 'sqlite_home = "inside-link"\n')
      expect(() => assertCodexSqliteHomeContained(home)).toThrow(/redirects/)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects a not-yet-existing path UNDER a symlink that escapes (canonicalizes missing paths)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'brobot-codex-outside-'))
    try {
      symlinkSync(outside, join(home, 'inside-link'))
      writeFileSync(join(home, 'config.toml'), 'sqlite_home = "inside-link/not/created/yet"\n')
      expect(() => assertCodexSqliteHomeContained(home)).toThrow(/redirects/)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('⛔ rejects a DANGLING in-home symlink — the second copy of 182 H1’s climb (183)', () => {
    // ⛔ **This function held its own copy of the climb 182 H1 was written about**, and the same
    // hole with it: `<home>/bait -> <home>/not-created-yet` throws from `realpathSync` exactly like
    // a directory nobody has made, so it canonicalized back to `<realHome>/bait`, passed
    // containment, and the real Codex CLI would then follow the link and write its SQLite state
    // wherever it leads. The finding named `confinement.ts`; §2's caller audit is what found this.
    //
    // ⚠️ The target here is OUTSIDE the home, which is what makes it an escape — but the refusal
    // does not depend on that, and must not: the point is that nobody can say where it goes.
    const outside = join(tmpdir(), `brobot-codex-183-${process.pid}`)
    symlinkSync(outside, join(home, 'bait'))
    writeFileSync(join(home, 'config.toml'), 'sqlite_home = "bait"\n')
    expect(() => assertCodexSqliteHomeContained(home)).toThrow(/cannot be canonicalized/)
    // …and one level in, which is where `O_NOFOLLOW` stops looking (170).
    writeFileSync(join(home, 'config.toml'), 'sqlite_home = "bait/state"\n')
    expect(() => assertCodexSqliteHomeContained(home)).toThrow(/cannot be canonicalized/)
  })

  it('⚑ …while a not-yet-created directory INSIDE the home is still accepted (183)', () => {
    // ⛔ **The paired positive.** Canonicalizing a missing path is the whole reason this helper is
    // not a plain `realpathSync`: Codex's SQLite home is created on first use, so a fix that
    // refused every path that is not already there would refuse the ordinary first launch. The
    // existing relative case above covers one spelling; this pins the absolute one and the deep
    // one, in the same test that owns the negative.
    writeFileSync(join(home, 'config.toml'), 'sqlite_home = "not/created/yet"\n')
    expect(() => assertCodexSqliteHomeContained(home)).not.toThrow()
    writeFileSync(join(home, 'config.toml'), `sqlite_home = ${JSON.stringify(join(home, 'x'))}\n`)
    expect(() => assertCodexSqliteHomeContained(home)).not.toThrow()
  })

  it('accepts a real in-home symlink target (containment is about the REAL path, not the spelling)', () => {
    const inner = join(home, 'real-state')
    mkdirSync(inner)
    symlinkSync(inner, join(home, 'state-link'))
    writeFileSync(join(home, 'config.toml'), 'sqlite_home = "state-link"\n')
    expect(() => assertCodexSqliteHomeContained(home)).not.toThrow()
  })

  it('rejects an ESCAPED quoted key — "sqlite\\u005fhome" decodes to sqlite_home (044 P1-H repro)', () => {
    // The reviewer's real-CLI repro: the pre-048 line scanner stripped the quotes but never
    // DECODED the basic-string escape, so this slipped past attestation entirely — and the real
    // Codex 0.145.0 then created state/logs/memories SQLite files outside the managed home.
    writeFileSync(join(home, 'config.toml'), '"sqlite\\u005fhome" = "/tmp/brobot-escape"\n')
    expect(() => assertCodexSqliteHomeContained(home)).toThrow(/redirects Codex state/)
  })

  it('resolves every TOML key spelling of sqlite_home (bare/quoted/literal/escaped/dotted/table)', () => {
    // A parser gives us the SAME key resolution the provider performs, so no spelling is a bypass.
    for (const raw of [
      'sqlite_home = "/tmp/brobot-escape"', // bare
      '"sqlite_home" = "/tmp/brobot-escape"', // quoted basic
      "'sqlite_home' = '/tmp/brobot-escape'", // literal
      '"sqlite\\u005fhome" = "/tmp/brobot-escape"', // escaped
      '"sqlite\\x5fhome" = "/tmp/brobot-escape"', // hex escape
      '[tbl]\nsqlite_home = "/tmp/brobot-escape"', // table-scoped
      'tbl.sqlite_home = "/tmp/brobot-escape"', // dotted
    ]) {
      writeFileSync(join(home, 'config.toml'), `${raw}\n`)
      expect(() => assertCodexSqliteHomeContained(home)).toThrow(/redirects Codex state/)
    }
  })

  it('UNDERSTANDS the string forms a real parser accepts, and rejects them when they escape (048)', () => {
    // Pre-048 these were lumped together as "unparseable"; a real TOML parser DECODES them, so
    // they are now resolved to their true path and rejected for the right reason — escaping.
    for (const raw of [
      'sqlite_home = """/tmp/brobot-escape"""', // multi-line basic string
      'sqlite_home = "/tmp/brobot-esc\\u0061pe"', // a = 'a'
      "sqlite_home = '/tmp/brobot-escape'", // literal string
    ]) {
      writeFileSync(join(home, 'config.toml'), `${raw}\n`)
      expect(() => assertCodexSqliteHomeContained(home)).toThrow(/redirects Codex state/)
    }
  })

  it('fails closed on a non-string / empty sqlite_home value', () => {
    for (const raw of ['sqlite_home = 42', 'sqlite_home = true', 'sqlite_home = ""']) {
      writeFileSync(join(home, 'config.toml'), `${raw}\n`)
      expect(() => assertCodexSqliteHomeContained(home)).toThrow(/not a usable path/)
    }
  })

  it('fails closed on a MALFORMED config (a config we cannot parse is a config we cannot attest)', () => {
    for (const raw of ['sqlite_home = ', 'this is not toml at all', '[unclosed']) {
      writeFileSync(join(home, 'config.toml'), `${raw}\n`)
      expect(() => assertCodexSqliteHomeContained(home)).toThrow(/could not be parsed/)
    }
  })

  it('fails closed on DUPLICATE sqlite_home declarations (never first-wins)', () => {
    // A safe first declaration must not let a later escaping one through. TOML forbids redefining
    // a key, so the parser itself rejects this — we fail closed on the parse error.
    writeFileSync(
      join(home, 'config.toml'),
      'sqlite_home = "sub/state"\nsqlite_home = "/tmp/brobot-escape"\n',
    )
    expect(() => assertCodexSqliteHomeContained(home)).toThrow(/could not be parsed/)

    // Two declarations in DIFFERENT tables are valid TOML but still ambiguous for us → fail closed.
    writeFileSync(
      join(home, 'config.toml'),
      'sqlite_home = "sub/state"\n[tbl]\nsqlite_home = "/tmp/brobot-escape"\n',
    )
    expect(() => assertCodexSqliteHomeContained(home)).toThrow(/ambiguous/)
  })

  it('ignores a COMMENTED-OUT declaration, and does not treat a # inside a quoted path as a comment', () => {
    writeFileSync(join(home, 'config.toml'), '# sqlite_home = "/tmp/elsewhere"\nmodel = "x"\n')
    expect(() => assertCodexSqliteHomeContained(home)).not.toThrow()
    // A literal `#` in an in-home path must not truncate the value into an unparseable form.
    writeFileSync(join(home, 'config.toml'), 'sqlite_home = "sub#hash"\n')
    expect(() => assertCodexSqliteHomeContained(home)).not.toThrow()
  })
})

describe('a copy Codex refused, replaced once by the one refreshed last', () => {
  const signIn = (account: string, token: string, refreshed: string | null): string =>
    JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { account_id: account, access_token: token, refresh_token: `refresh-${token}` },
      ...(refreshed === null ? {} : { last_refresh: refreshed }),
    })
  const EARLIER = '2026-10-08T22:00:00Z'
  const LATER = '2026-10-09T02:35:11Z'
  const LATEST = '2026-10-09T02:54:01Z'
  const DEAD = signIn('acct-fictional-a', 'DEAD', EARLIER)
  const FRESH = signIn('acct-fictional-a', 'FRESH', LATER)
  const FRESHER = signIn('acct-fictional-a', 'FRESHER', LATEST)
  let root: string
  let helper: string
  let ownHome: string
  let computers: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot-codex-refused-'))
    helper = join(root, 'homes', 'farah', 'codex')
    ownHome = join(root, 'homes', 'brobot', 'codex')
    mkdirSync(helper, { recursive: true, mode: 0o700 })
    mkdirSync(ownHome, { recursive: true, mode: 0o700 })
    writeFileSync(join(helper, 'auth.json'), DEAD, { mode: 0o600 })
    computers = join(root, 'the-computers.json')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  /** As the refusal arrives: the copy in the home is the one refused, unless a test says which was. */
  const replace = (
    refused: CodexCopyIdentity | null = codexCopyIdentityIn(helper),
    stillWanted: () => boolean = () => true,
  ) =>
    replaceARefusedCodexCopy(helper, {
      managedRoot: root,
      // A home that holds no copy has none to name; the writer finds none either.
      refused: refused ?? { dev: 0n, ino: 0n, size: 0n, mtimeNs: 0n },
      stillWanted,
      candidates: [
        { from: 'the-computers', sourceAuthPath: computers },
        { from: 'brobots-own', fallback: { path: join(ownHome, 'auth.json'), managedRoot: root } },
      ],
    })
  const holds = (text: string) => writeFileSync(join(helper, 'auth.json'), text, { mode: 0o600 })
  const own = (text: string) => writeFileSync(join(ownHome, 'auth.json'), text, { mode: 0o600 })
  const held = () => signInAt(join(helper, 'auth.json'))

  it('🔴 replaces it with this computer’s, refreshed later, of the same account, atomically and private', async () => {
    writeFileSync(computers, FRESH)
    expect(await replace()).toBe('the-computers')
    expect(held()).toBe(digestOf(FRESH))
    expect(whoElseCanOpen(join(helper, 'auth.json'), 0o600)).toEqual([])
    expect(readdirSync(helper)).toEqual(['auth.json'])
  })

  it('🔴 takes whichever was refreshed last, and BroBot’s own only from inside the managed root', async () => {
    writeFileSync(computers, FRESH)
    own(FRESHER)
    expect(await replace()).toBe('brobots-own')
    expect(held()).toBe(digestOf(FRESHER))
    // ⚑ The other way round: this computer's is the later one.
    holds(DEAD)
    writeFileSync(computers, FRESHER)
    own(FRESH)
    expect(await replace()).toBe('the-computers')
    expect(held()).toBe(digestOf(FRESHER))
    // ⛔ …and BroBot's own never through a link out of the managed root.
    holds(DEAD)
    rmSync(computers)
    const outside = mkdtempSync(join(tmpdir(), 'brobot-codex-outside-'))
    try {
      writeFileSync(join(outside, 'auth.json'), FRESHER)
      rmSync(ownHome, { recursive: true, force: true })
      symlinkSync(outside, ownHome)
      expect(await replace()).toBe('not-tried')
      expect(held()).toBe(digestOf(DEAD))
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('⛔ only the copy that was refused: one that differs by its size, its time or the file itself is left alone', async () => {
    writeFileSync(computers, FRESHER)
    const copy = join(helper, 'auth.json')
    // A whole moment, so a later file can be given exactly the same one.
    const then = new Date(1_700_000_000_000)
    const refusedNow = (): CodexCopyIdentity => {
      holds(DEAD)
      utimesSync(copy, then, then)
      return codexCopyIdentityIn(helper)!
    }

    // Renewed in place since, as Codex does it: the same file and, here, the same time; another size.
    let refused = refusedNow()
    const renewed = signIn('acct-fictional-a', 'RENEWED-BY-CODEX-ITSELF', LATER)
    holds(renewed)
    utimesSync(copy, then, then)
    expect(await replace(refused)).toBe('not-tried')
    expect(held()).toBe(digestOf(renewed))

    // The same file and the same size, written at another time.
    refused = refusedNow()
    utimesSync(copy, new Date(1_700_000_001_000), new Date(1_700_000_001_000))
    expect(await replace(refused)).toBe('not-tried')
    expect(held()).toBe(digestOf(DEAD))

    // Another file under the same name, of the same size and time.
    refused = refusedNow()
    renameSync(copy, `${copy}.refused`)
    writeFileSync(copy, DEAD, { mode: 0o600 })
    utimesSync(copy, then, then)
    expect(await replace(refused)).toBe('not-tried')
    expect(held()).toBe(digestOf(DEAD))
    rmSync(`${copy}.refused`)

    // ⚑ The copy as it stands, named as the one refused: replaced.
    expect(await replace()).toBe('the-computers')
    expect(held()).toBe(digestOf(FRESHER))
  })

  it('⛔ asked again once the lock is held: a wait for the lock that outlasted its asker replaces nothing', async () => {
    writeFileSync(computers, FRESH)
    let wanted = true
    let letGo: () => void = () => {}
    // Something else holds this home's lock, as a sign-in or another start does.
    const holding = withProviderHomeLock(
      helper,
      () => new Promise<void>((resolve) => (letGo = resolve)),
    )
    const waiting = replace(codexCopyIdentityIn(helper), () => wanted)
    await new Promise((resolve) => setTimeout(resolve, 50))
    // The conversation that asked is stopped while the writer waits.
    wanted = false
    letGo()
    await holding
    expect(await waiting).toBe('not-tried')
    expect(held()).toBe(digestOf(DEAD))
    // ⛔ Not wanted from the start either.
    expect(await replace(codexCopyIdentityIn(helper), () => false)).toBe('not-tried')
    // ⚑ Wanted when the lock is had: replaced.
    expect(await replace()).toBe('the-computers')
    expect(held()).toBe(digestOf(FRESH))
  })

  it('⛔ once: after a replacement nothing later is left, so a second refusal replaces nothing', async () => {
    writeFileSync(computers, FRESH)
    own(DEAD)
    expect(await replace()).toBe('the-computers')
    expect(await replace()).toBe('not-tried')
    expect(held()).toBe(digestOf(FRESH))
  })

  it('⛔ never a copy as new as its source, or newer: a candidate refreshed earlier or at the same moment is not used', async () => {
    const mine = signIn('acct-fictional-a', 'MINE', LATER)
    holds(mine)
    writeFileSync(computers, signIn('acct-fictional-a', 'OLDER', EARLIER))
    own(signIn('acct-fictional-a', 'AT-THE-SAME-MOMENT', LATER))
    expect(await replace()).toBe('not-tried')
    expect(held()).toBe(digestOf(mine))
  })

  it('⛔ a file that names no date it can read is not used, as a candidate or as the copy', async () => {
    for (const undated of [null, 'not a date', '']) {
      writeFileSync(computers, signIn('acct-fictional-a', 'UNDATED', undated))
      expect(await replace(), String(undated)).toBe('not-tried')
      expect(held()).toBe(digestOf(DEAD))
    }
    const mine = signIn('acct-fictional-a', 'MINE', null)
    holds(mine)
    writeFileSync(computers, FRESH)
    expect(await replace()).toBe('not-tried')
    expect(held()).toBe(digestOf(mine))
  })

  it('⛔ never moves a profile to another account, nor one on a key or of no readable account', async () => {
    writeFileSync(computers, signIn('acct-fictional-b', 'OTHER', LATEST))
    expect(await replace()).toBe('not-tried')
    expect(held()).toBe(digestOf(DEAD))
    writeFileSync(computers, FRESH)
    for (const helperHeld of [
      JSON.stringify({
        auth_mode: 'apikey',
        OPENAI_API_KEY: 'sk-fictional',
        last_refresh: EARLIER,
      }),
      JSON.stringify({ auth_mode: 'chatgpt', tokens: {}, last_refresh: EARLIER }),
      '{"torn',
    ]) {
      holds(helperHeld)
      expect(await replace(), `${helperHeld.length} characters held`).toBe('not-tried')
      expect(held()).toBe(digestOf(helperHeld))
    }
  })

  it('⛔ a profile on an API key is left alone even when a candidate holds a key and a later date', async () => {
    const onAKey = JSON.stringify({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-fictional-a',
      last_refresh: EARLIER,
    })
    holds(onAKey)
    writeFileSync(
      computers,
      JSON.stringify({
        auth_mode: 'apikey',
        OPENAI_API_KEY: 'sk-fictional-b',
        last_refresh: LATEST,
      }),
    )
    expect(await replace()).toBe('not-tried')
    expect(held()).toBe(digestOf(onAKey))
  })

  it('⛔ never copies the same bytes again, nor from candidates that are not there', async () => {
    expect(await replace()).toBe('not-tried')
    writeFileSync(computers, DEAD)
    own(DEAD)
    expect(await replace()).toBe('not-tried')
    expect(held()).toBe(digestOf(DEAD))
  })

  it('⛔ a profile with no sign-in of its own is not given one here', async () => {
    rmSync(join(helper, 'auth.json'))
    writeFileSync(computers, FRESH)
    expect(await replace()).toBe('not-tried')
    expect(readdirSync(helper)).toEqual([])
  })
})
