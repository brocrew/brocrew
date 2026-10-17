import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claudeAuthHealthAsync,
  claudeCommandIn,
  claudeLoginNotRenewed,
  claudeLoginState,
  claudeSetup,
  whyNoClaudeLogin,
} from '../src/internal/auth'

/**
 * # The sign-in command runs the Claude Code BroBot found
 *
 * Anthropic's installer puts Claude Code in `~/.local/bin`, and a new PowerShell may not search that
 * folder: `claude` is "not recognized" though BroBot found the program by name and runs it. So the
 * command a person is told to run carries the program's full path, written for their shell, and
 * `claude` only when BroBot found none.
 *
 * ⚑ Made-up programs and paths only; no login is read.
 */

const FOUND_ON_WINDOWS = 'C:\\Users\\Jo Example\\.local\\bin\\claude.exe'

describe('Claude Code as a person runs it in PowerShell', () => {
  it('🔴 the full path, called with `&` inside single quotes', () => {
    expect(claudeCommandIn(FOUND_ON_WINDOWS, 'win32')).toBe(
      "& 'C:\\Users\\Jo Example\\.local\\bin\\claude.exe'",
    )
  })

  it('⛔ a `$` or a backtick in a folder name stays as written: single quotes expand nothing', () => {
    const path = 'C:\\Users\\$dev`ops\\.local\\bin\\claude.exe'
    expect(claudeCommandIn(path, 'win32')).toBe(`& '${path}'`)
  })

  it('⛔ an apostrophe, straight or curly, is doubled, as PowerShell reads one inside quotes', () => {
    expect(claudeCommandIn("C:\\Users\\O'Brien\\claude.exe", 'win32')).toBe(
      "& 'C:\\Users\\O''Brien\\claude.exe'",
    )
    for (const quote of ['\u2018', '\u2019', '\u201a', '\u201b']) {
      expect(claudeCommandIn(`C:\\Users\\O${quote}Brien\\claude.exe`, 'win32')).toBe(
        `& 'C:\\Users\\O${quote}${quote}Brien\\claude.exe'`,
      )
    }
  })
})

describe('Claude Code as a person runs it in Terminal', () => {
  const made: string[] = []
  afterEach(() => {
    for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  it('⚑ a path of plain characters as it is', () => {
    expect(claudeCommandIn('/Users/someone/.local/bin/claude', 'darwin')).toBe(
      '/Users/someone/.local/bin/claude',
    )
  })

  it.each([
    ['a space', '/Users/some one/claude'],
    ['a bracket and a star', '/Users/a[1]*/claude'],
    ['a tilde', '/Users/~a/claude'],
    ['an exclamation mark', '/Users/a!b/claude'],
    ['a hash', '/Users/a#b/claude'],
    ['a backtick', '/Users/a`b/claude'],
    ['a letter beyond ASCII', '/Users/zoë/claude'],
    ['no root', 'Users/a/claude'],
  ])('⛔ a path with %s is quoted, never left for the shell to read', (_, path) => {
    expect(claudeCommandIn(path, 'darwin')).toBe(`'${path}'`)
  })

  it('🔴 any other path in single quotes, an apostrophe closed, escaped and reopened', () => {
    expect(claudeCommandIn('/Users/some one/.local/bin/claude', 'darwin')).toBe(
      "'/Users/some one/.local/bin/claude'",
    )
    expect(claudeCommandIn("/Users/o'brien/claude", 'darwin')).toBe("'/Users/o'\\''brien/claude'")
  })

  /** The shells a Mac's Terminal may run, as found here. */
  const asked: Array<[name: string, shell: string, flags: string]> = [
    ['sh', '/bin/sh', '-c'],
    ['zsh', '/bin/zsh', '-fc'],
  ]
  const shells = asked.filter(([, shell]) => process.platform !== 'win32' && existsSync(shell))

  it.each(shells)(
    '🔴 in %s, the command as shown runs the program: a space, an apostrophe, `$`, `!` and `~` included',
    (_, shell, flags) => {
      const root = mkdtempSync(join(tmpdir(), 'brobot-sign-in-command-'))
      made.push(root)
      const folder = join(root, "it's a $HOME ~!folder")
      mkdirSync(folder)
      const program = join(folder, 'claude')
      writeFileSync(program, '#!/bin/sh\necho "ran $1"\n')
      chmodSync(program, 0o755)
      const command = claudeCommandIn(program, process.platform)
      expect(execFileSync(shell, [flags, `${command} once`], { env: {} }).toString()).toBe(
        'ran once\n',
      )
    },
  )
})

describe('when BroBot found no program it can name on one line', () => {
  it.each([
    ['none was found', null],
    ['an empty path', ''],
    ['a path with a line break', '/Users/a\nb/claude'],
    ['a path with a control character', 'C:\\Users\\a\u0007b\\claude.exe'],
    ['a path with a delete character', '/Users/a\u007fb/claude'],
    ['a path with a line separator', '/Users/a\u2028b/claude'],
  ] as const)('⚑ %s: `claude`, as the installer’s own steps say', (_, program) => {
    expect(claudeCommandIn(program, 'win32')).toBe('claude')
    expect(claudeCommandIn(program, 'darwin')).toBe('claude')
  })
})

describe('everything that tells a person to run Claude Code names the same command', () => {
  const command = claudeCommandIn(FOUND_ON_WINDOWS, 'win32')

  it('🔴 the setup steps: the command, and the shell it is written for', () => {
    expect(claudeSetup('win32', FOUND_ON_WINDOWS)).toMatchObject({
      signInCommand: command,
      shell: 'PowerShell',
    })
    expect(claudeSetup('darwin', '/Users/someone/.local/bin/claude')).toMatchObject({
      signInCommand: '/Users/someone/.local/bin/claude',
      shell: 'Terminal',
    })
  })

  it('🔴 the sentence on the Providers card, and the one a refused start says', () => {
    const state = claudeLoginState(
      () => null,
      undefined,
      () => 1,
      'win32',
      {},
      '/nowhere',
      () => command,
    )
    expect(state.state === 'absent' && state.reason).toContain(`run \`${command}\` and log in`)
    expect(
      whyNoClaudeLogin({
        platform: 'win32',
        env: {},
        home: '/nowhere',
        now: 1,
        command: () => command,
      }),
    ).toContain(`run \`${command}\` and log in`)
    expect(
      whyNoClaudeLogin({
        platform: 'darwin',
        env: {},
        home: '/nowhere',
        command: () => '/x/claude',
      }),
    ).toContain('run `/x/claude` in a terminal')
  })

  it('🔴 the check before a start, when there is no login at all', async () => {
    const health = await claudeAuthHealthAsync(
      async () => null,
      undefined,
      () => '/x/claude',
    )
    expect(health.ok).toBe(false)
    expect(health.reason).toContain('`/x/claude`')
  })

  it('⚑ the program is looked for only when a sentence says it', async () => {
    let asked = 0
    const command = (): string => {
      asked += 1
      return '/x/claude'
    }
    await claudeAuthHealthAsync(async () => 'a-login', undefined, command)
    claudeLoginState(
      () => null,
      () => null,
      () => 1,
      'darwin',
      {},
      '/nowhere',
      command,
    )
    expect(asked).toBe(1)
  })

  it('🔴 the sentence when BroBot could not renew an expired login', () => {
    expect(claudeLoginNotRenewed('not-renewed', 'win32', command)).toContain(
      `open PowerShell and run \`${command}\`, log in again`,
    )
  })
})
