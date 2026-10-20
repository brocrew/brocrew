import { execFileSync } from 'node:child_process'
import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  localSettingsFilesOf,
  projectLocalSettingsFile,
} from '../src/claude/local-settings-location'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, statSync: vi.fn(actual.statSync) }
})

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: vi.fn(actual.homedir) }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
let scratch: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env['PATH'],
      // Git for Windows cannot open os.devNull as a config file; this absent scratch path is empty.
      GIT_CONFIG_GLOBAL: join(scratch, 'empty.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
    },
  })
}

function folder(...parts: string[]): string {
  const path = join(scratch, ...parts)
  fs.mkdirSync(path, { recursive: true })
  return path
}

function repository(): string {
  const root = folder('checkout with spaces')
  git(root, 'init', '--quiet')
  return root
}

function worktree(): { main: string; linked: string } {
  const main = repository()
  git(
    main,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    `core.hooksPath=${os.devNull}`,
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'Fixture',
  )
  const linked = join(scratch, 'linked checkout')
  git(main, 'worktree', 'add', '--quiet', '--detach', linked)
  return { main, linked }
}

function settings(root: string): string {
  return join(root, '.claude', 'settings.local.json')
}

function expectFiles(cwd: string, roots: string[]): void {
  const files = roots.map(settings)
  expect(projectLocalSettingsFile(cwd)).toBe(files[0])
  expect(localSettingsFilesOf(cwd)).toEqual({ files, folders: files.map(dirname) })
}

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'brobot-local-settings-test-')))
})

afterEach(() => {
  vi.resetAllMocks()
  fs.rmSync(scratch, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32' || process.getuid === undefined)(
  'documented terminal local-settings routing on POSIX',
  () => {
    it('keeps a plain folder local without creating settings', () => {
      const cwd = folder('plain')
      expectFiles(cwd, [cwd])
      expect(fs.existsSync(join(cwd, '.claude'))).toBe(false)
    })

    it('lists a repository root only once', () => {
      const root = repository()
      expectFiles(root, [root])
    })

    it('lists repository-root settings before existing starting-folder settings without changing either', () => {
      const root = repository()
      const cwd = folder('checkout with spaces', 'nested', 'folder')
      for (const base of [root, cwd]) {
        fs.mkdirSync(join(base, '.claude'))
        fs.writeFileSync(settings(base), '{"permissions":{"allow":["Write(fixture)"]}}\n')
      }
      const before = [root, cwd].map((base) => fs.readFileSync(settings(base), 'utf8'))
      expectFiles(cwd, [root, cwd])
      expect([root, cwd].map((base) => fs.readFileSync(settings(base), 'utf8'))).toEqual(before)
    })

    it('includes the starting-folder destination even when its settings do not yet exist', () => {
      const root = repository()
      const cwd = folder('checkout with spaces', 'nested')
      expectFiles(cwd, [root, cwd])
      expect(fs.existsSync(settings(cwd))).toBe(false)
    })

    it('routes a linked worktree to its main checkout', () => {
      const { main, linked } = worktree()
      expectFiles(linked, [main, linked])
    })

    it('routes a manually moved worktree through Git without repairing its stale entry', () => {
      const { main, linked } = worktree()
      const moved = join(scratch, 'moved linked checkout')
      fs.renameSync(linked, moved)
      expect(fs.existsSync(linked)).toBe(false)
      const before = git(moved, 'worktree', 'list', '--porcelain', '-z')
      expect(before.split('\0')).toContain(`worktree ${main}`)
      expect(before.split('\0')).toContain(`worktree ${linked}`)
      expect(before.split('\0')).not.toContain(`worktree ${moved}`)
      expectFiles(moved, [main, moved])
      const nested = join(moved, 'nested')
      fs.mkdirSync(nested)
      expectFiles(nested, [main, nested])
      expect(git(moved, 'worktree', 'list', '--porcelain', '-z')).toBe(before)
    })

    it('routes a folder inside a linked worktree to its main checkout', () => {
      const { main, linked } = worktree()
      const cwd = join(linked, 'nested')
      fs.mkdirSync(cwd)
      expectFiles(cwd, [main, cwd])
    })

    it('keeps a synthetic home-root repository beside the starting-folder settings', () => {
      const root = repository()
      const cwd = folder('checkout with spaces', 'nested')
      vi.mocked(os.homedir).mockReturnValue(root)
      expectFiles(cwd, [cwd])
      expectFiles(root, [root])
    })

    it('recognizes the home-root exception through a symlink', () => {
      const root = repository()
      const homeLink = join(scratch, 'home-link')
      fs.symlinkSync(root, homeLink, 'dir')
      const cwd = folder('checkout with spaces', 'nested')
      vi.mocked(os.homedir).mockReturnValue(homeLink)
      expectFiles(cwd, [cwd])
    })

    it.each(['root', '.git', '.claude'])(
      'falls back to cwd for foreign-owned %s metadata',
      (part) => {
        const root = repository()
        const cwd = folder('checkout with spaces', 'nested')
        fs.mkdirSync(join(root, '.claude'))
        const target = part === 'root' ? root : join(root, part)
        vi.mocked(fs.statSync).mockImplementation(((path: fs.PathLike) => {
          const stat = actualFs.statSync(path)
          if (String(path) === target) return { ...stat, uid: stat.uid + 1 }
          return stat
        }) as typeof fs.statSync)
        expectFiles(cwd, [cwd])
      },
    )

    it('falls back to cwd when ownership cannot be read', () => {
      const root = repository()
      const cwd = folder('checkout with spaces', 'nested')
      vi.mocked(fs.statSync).mockImplementation(((path: fs.PathLike) => {
        if (String(path) === join(root, '.claude')) {
          throw Object.assign(new Error('Unreadable fixture metadata'), { code: 'EACCES' })
        }
        return actualFs.statSync(path)
      }) as typeof fs.statSync)
      expectFiles(cwd, [cwd])
    })

    it('falls back to cwd when Git metadata cannot be resolved', () => {
      const cwd = folder('broken')
      fs.writeFileSync(join(cwd, '.git'), 'gitdir: missing-fixture-directory\n')
      expectFiles(cwd, [cwd])
    })

    it('keeps a bare repository local', () => {
      const cwd = folder('bare')
      git(cwd, 'init', '--bare', '--quiet')
      expectFiles(cwd, [cwd])
    })

    it('resolves relative starting folders to absolute settings paths', () => {
      const cwd = folder('relative')
      const startingFolder = relative(process.cwd(), cwd)
      expect(projectLocalSettingsFile(startingFolder)).toBe(settings(resolve(startingFolder)))
    })
  },
)

it.each(['missing Git', 'Git timeout', 'Git output exceeds the bound'])(
  'keeps settings beside cwd after %s',
  (reason) => {
    const cwd = folder('fallback')
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error(reason)
    })
    expectFiles(cwd, [cwd])
  },
)

it.runIf(process.platform === 'win32')('keeps Windows repository subfolders local', () => {
  repository()
  const cwd = folder('checkout with spaces', 'nested')
  expectFiles(cwd, [cwd])
})
