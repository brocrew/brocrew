import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findClaudeProgram,
  updateCommandFor,
  type ClaudeProgramContext,
} from '../src/main/runtime/claude-program'
import { claudeAnswer, providerVersionsReader } from '../src/main/runtime/provider-versions'
import { A_STANDING_WARNS } from '../src/shared/runtime-ipc'

/**
 * The Claude Code a launch runs, and the other copies installed beside it: the first one found runs,
 * each file is one copy whatever links lead to it, and the Providers page names them all — so a
 * person can see why updating one of them changed nothing. A version newer than the ones tested
 * says nothing is wrong; an older one is a warning. And an answer is kept only while the same file
 * answers, so an update, in place or by a moved link, is read again.
 */

const TESTED = { oldest: '2.1.257', newest: '2.1.290' }

describe('which copy runs', () => {
  /** A Mac where these paths run, and the links among them lead where `real` says. */
  const aMac = (
    runs: readonly string[],
    real: Readonly<Record<string, string>> = {},
  ): ClaudeProgramContext => ({
    isPackaged: true,
    given: undefined,
    platform: 'darwin',
    homedir: '/Users/someone',
    env: { PATH: '/usr/bin:/bin' },
    runs: (path) => runs.includes(path),
    realpath: (path) => real[path] ?? path,
    readText: () => null,
    list: () => [],
    everyCopy: true,
  })

  const NATIVE = '/Users/someone/.local/bin/claude'
  const HOMEBREW = '/opt/homebrew/bin/claude'

  it('Anthropic’s installer’s copy runs first, and Homebrew’s is another copy', () => {
    const program = findClaudeProgram(
      aMac([NATIVE, HOMEBREW], {
        [NATIVE]: '/Users/someone/.local/share/claude/versions/2.1.292',
        [HOMEBREW]: '/opt/homebrew/Caskroom/claude-code/2.1.245/claude',
      }),
    )
    expect(program).toEqual({
      path: NATIVE,
      from: 'native-installer',
      update: { command: `${NATIVE} update` },
      others: [
        { path: HOMEBREW, from: 'homebrew', update: { command: 'brew upgrade claude-code' } },
      ],
    })
  })

  it('a launch stops at the first copy: it looks for no other', () => {
    const asked: string[] = []
    const program = findClaudeProgram({
      ...aMac([NATIVE, HOMEBREW]),
      everyCopy: false,
      runs: (path) => {
        asked.push(path)
        return path === NATIVE || path === HOMEBREW
      },
    })
    expect(program).toEqual({
      path: NATIVE,
      from: 'native-installer',
      update: { command: `${NATIVE} update` },
      others: [],
    })
    expect(asked).toEqual([NATIVE])
  })

  it('two spellings of one path that differ only in case are one copy', () => {
    const program = findClaudeProgram(
      aMac([NATIVE, HOMEBREW], {
        [NATIVE]: '/Users/Someone/.local/share/claude/versions/2.1.292',
        [HOMEBREW]: '/users/someone/.local/share/claude/versions/2.1.292',
      }),
    )
    expect(program.others).toEqual([])
  })

  it('with only Homebrew’s, that one runs and nothing else is listed', () => {
    expect(findClaudeProgram(aMac([HOMEBREW]))).toEqual({
      path: HOMEBREW,
      from: 'homebrew',
      update: { command: 'brew upgrade claude-code' },
      others: [],
    })
  })

  it('two paths leading to one file are one copy', () => {
    const real = '/opt/homebrew/Caskroom/claude-code/2.1.245/claude'
    const program = findClaudeProgram(
      aMac([HOMEBREW, '/usr/local/bin/claude'], {
        [HOMEBREW]: real,
        '/usr/local/bin/claude': real,
      }),
    )
    expect(program.others).toEqual([])
  })

  it('a program given to the launch is the one that runs, and nothing else is looked for', () => {
    const program = findClaudeProgram({
      ...aMac([NATIVE, HOMEBREW]),
      given: '/somewhere/claude',
      runs: () => true,
    })
    expect(program).toEqual({ path: '/somewhere/claude', from: 'given', update: null, others: [] })
  })
})

describe('the command that updates each copy, as Anthropic’s setup page gives it', () => {
  // https://code.claude.com/docs/en/setup — "Update manually", the Homebrew and WinGet tabs, and
  // "Install with npm".
  it('one command for each way it was installed, and none where BroBot cannot say how', () => {
    const run = '/a/copy/of/claude'
    expect(
      updateCommandFor(
        'native-installer',
        '/users/someone/.local/share/claude/versions/2.1.292',
        run,
      ),
    ).toEqual({ command: '/a/copy/of/claude update' })
    expect(
      updateCommandFor('homebrew', '/opt/homebrew/caskroom/claude-code/2.1.245/claude', run),
    ).toEqual({ command: 'brew upgrade claude-code' })
    expect(
      updateCommandFor('homebrew', '/opt/homebrew/caskroom/claude-code@latest/2.1.292/claude', run),
    ).toEqual({ command: 'brew upgrade claude-code@latest' })
    expect(
      updateCommandFor(
        'winget',
        'c:\\users\\someone\\appdata\\local\\microsoft\\winget\\links\\claude.exe',
        run,
      ),
    ).toEqual({ command: 'winget upgrade Anthropic.ClaudeCode' })
    expect(
      updateCommandFor(
        'npm',
        '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude',
        run,
      ),
    ).toEqual({ command: 'npm install -g @anthropic-ai/claude-code@latest' })
    for (const from of ['given', 'development-checkout', 'path', 'carried'] as const) {
      expect(updateCommandFor(from, '/somewhere/claude', run), from).toBeNull()
    }
  })

  it('🔴 the installer’s own copy on Windows updates by its full path, as PowerShell runs it', () => {
    // A new PowerShell may not search the installer's folder, so `claude update` is not found.
    const NATIVE = 'C:\\Users\\Jo Example\\.local\\bin\\claude.exe'
    const program = findClaudeProgram({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\Jo Example', PATH: 'C:\\Windows\\System32' },
      homedir: 'C:\\Users\\Jo Example',
      isPackaged: true,
      given: undefined,
      runs: (path) => path === NATIVE,
      realpath: (path) => path,
      readText: () => null,
      list: () => [],
    })
    expect(program).toEqual({
      path: NATIVE,
      from: 'native-installer',
      update: { command: `& '${NATIVE}' update` },
      others: [],
    })
  })

  it('a copy from Homebrew’s latest cask is told that cask’s own upgrade', () => {
    const HOMEBREW = '/opt/homebrew/bin/claude'
    const program = findClaudeProgram({
      platform: 'darwin',
      env: { PATH: '/usr/bin:/bin' },
      homedir: '/Users/someone',
      isPackaged: true,
      given: undefined,
      runs: (path) => path === HOMEBREW,
      realpath: (path) =>
        path === HOMEBREW ? '/opt/homebrew/Caskroom/claude-code@latest/2.1.292/claude' : path,
      readText: () => null,
      list: () => [],
      everyCopy: true,
    })
    expect(program.update).toEqual({ command: 'brew upgrade claude-code@latest' })
  })
})

describe('what the Providers page says about it', () => {
  const one = {
    path: '/Users/someone/.local/bin/claude',
    from: 'native-installer' as const,
    update: { command: 'claude update' },
  }

  it('a version newer than tested is said quietly, and is no warning', () => {
    const { program } = claudeAnswer(one, '2.1.292', [], TESTED)
    expect(program?.standing).toBe('newer-than-tested')
    expect(program && A_STANDING_WARNS[program.standing]).toBe(false)
    expect(program?.said).toBe(
      'Claude Code 2.1.292, installed with Anthropic’s installer, at /Users/someone/.local/bin/claude. It is newer than the versions BroCrew was tested with, up to 2.1.290.',
    )
  })

  it('a version older than tested is a warning, and says updating is the fix', () => {
    const { program } = claudeAnswer(one, '2.1.200', [], TESTED)
    expect(program?.standing).toBe('older-than-tested')
    expect(program && A_STANDING_WARNS[program.standing]).toBe(true)
    expect(program?.said).toContain('updating it is the fix')
  })

  it('a tested version says only which copy runs', () => {
    const { program } = claudeAnswer(one, '2.1.287', [], TESTED)
    expect(program?.standing).toBe('tested')
    expect(program?.said).toBe(
      'Claude Code 2.1.287, installed with Anthropic’s installer, at /Users/someone/.local/bin/claude.',
    )
  })

  it('beside other copies, it says this is the first BroBot finds, and lists the others with their versions', () => {
    const { program } = claudeAnswer(
      one,
      '2.1.292',
      [
        {
          path: '/opt/homebrew/bin/claude',
          from: 'homebrew',
          update: { command: 'brew upgrade claude-code' },
          version: '2.1.245',
        },
      ],
      TESTED,
    )
    expect(program?.said).toContain(
      'at /Users/someone/.local/bin/claude, the first of 2 copies BroCrew finds, and the one it runs.',
    )
    expect(program?.others).toEqual([
      {
        path: '/opt/homebrew/bin/claude',
        from: 'homebrew',
        version: '2.1.245',
        said: '2.1.245, installed with Homebrew, at /opt/homebrew/bin/claude',
      },
    ])
  })
})

describe('an answer is kept only while the same file answers', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-claude-copies-'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  /** A Claude Code that prints this version and counts how often it was asked. */
  const aClaude = (path: string, version: string): string => {
    writeFileSync(path, `#!/bin/sh\necho x >> "${path}.asked"\necho "${version} (Claude Code)"\n`)
    chmodSync(path, 0o755)
    return path
  }
  const noCodex = (): never => {
    throw new Error('no Codex here')
  }
  /** How often a program made by {@link aClaude} was asked its version. */
  const timesAsked = (path: string): number => {
    try {
      return readFileSync(`${path}.asked`, 'utf8').trim().split('\n').length
    } catch {
      return 0
    }
  }

  it('the same file is asked once; replaced in place, it is asked again', async () => {
    const claude = aClaude(join(dir, 'claude'), '2.1.290')
    const read = providerVersionsReader(noCodex, () => ({
      path: claude,
      from: 'npm',
      update: { command: 'npm install -g @anthropic-ai/claude-code@latest' },
      others: [],
    }))
    expect((await read()).claude.version).toBe('2.1.290')
    expect((await read()).claude.version).toBe('2.1.290')
    expect(timesAsked(claude)).toBe(1)
    // ⚑ An update in place: a new file of another size.
    aClaude(claude, '2.1.292-with-a-longer-line')
    expect((await read()).claude.version).toBe('2.1.292')
    expect(timesAsked(claude)).toBe(2)
  })

  it('a link moved to a new version, as Anthropic’s installer updates, is asked again', async () => {
    const versions = join(dir, 'versions')
    mkdirSync(versions)
    const before = aClaude(join(versions, '2.1.290'), '2.1.290')
    const after = aClaude(join(versions, '2.1.292'), '2.1.292')
    const link = join(dir, 'claude')
    symlinkSync(before, link)
    const read = providerVersionsReader(noCodex, () => ({
      path: link,
      from: 'native-installer',
      update: { command: 'claude update' },
      others: [],
    }))
    expect((await read()).claude.version).toBe('2.1.290')
    unlinkSync(link)
    symlinkSync(after, link)
    const { claude } = await read()
    expect(claude.version).toBe('2.1.292')
    expect(claude.program?.standing).toBe('newer-than-tested')
    // ⚑ The update that landed is said, until the next one.
    expect(claude.program?.updatedFrom).toBe('2.1.290')
    expect((await read()).claude.program?.updatedFrom).toBe('2.1.290')
  })

  it('nothing is said to have been updated on a first read, or while the version stays', async () => {
    const claude = aClaude(join(dir, 'claude'), '2.1.290')
    const read = providerVersionsReader(noCodex, () => ({
      path: claude,
      from: 'npm',
      update: { command: 'npm install -g @anthropic-ai/claude-code@latest' },
      others: [],
    }))
    expect((await read()).claude.program?.updatedFrom).toBeNull()
    expect((await read()).claude.program?.updatedFrom).toBeNull()
  })

  it('another copy that says no version is asked once, not at every read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = aClaude(join(dir, 'first'), '2.1.292')
    const silent = join(dir, 'silent')
    writeFileSync(silent, `#!/bin/sh\necho x >> "${silent}.asked"\necho "hello"\n`)
    chmodSync(silent, 0o755)
    const read = providerVersionsReader(noCodex, () => ({
      path: first,
      from: 'native-installer',
      update: { command: 'claude update' },
      others: [{ path: silent, from: 'path', update: null }],
    }))
    await read()
    await read()
    expect(timesAsked(silent)).toBe(1)
    expect((await read()).claude.program?.others[0]?.said).toBe(
      `Did not say its version, found on this computer, at ${silent}`,
    )
  })

  it('each other copy is asked its version too', async () => {
    const first = aClaude(join(dir, 'first'), '2.1.292')
    const second = aClaude(join(dir, 'second'), '2.1.245')
    const read = providerVersionsReader(noCodex, () => ({
      path: first,
      from: 'native-installer',
      update: { command: 'claude update' },
      others: [{ path: second, from: 'homebrew', update: { command: 'brew upgrade claude-code' } }],
    }))
    const { claude } = await read()
    expect(claude.version).toBe('2.1.292')
    expect(claude.program?.others.map((copy) => copy.version)).toEqual(['2.1.245'])
  })
})
