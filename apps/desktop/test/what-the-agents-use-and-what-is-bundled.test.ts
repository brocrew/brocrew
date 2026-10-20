import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listProcesses,
  resourcesFromTheListing,
  type ListedProcess,
} from '../src/main/runtime/process-listing'
import { providerVersionsReader } from '../src/main/runtime/provider-versions'
import type { CodexProgram } from '../src/main/runtime/codex-binary'

type VersionFixture = {
  output: string
  homeTo?: string
  codexHomeTo?: string
  claudeEnvironmentTo?: string
  countTo?: string
  requiresFile?: string
}

const versionPrograms = vi.hoisted(() => ({
  run: null as
    | null
    | ((
        file: string,
        options: { env?: Record<string, string> },
        callback: (error: Error | null, output: string) => void,
      ) => boolean),
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFile: ((...args: unknown[]) => {
      const [file, , options, callback] = args as [
        string,
        string[],
        { env?: Record<string, string> },
        (error: Error | null, output: string) => void,
      ]
      if (versionPrograms.run?.(file, options, callback))
        return {} as ReturnType<typeof actual.execFile>
      return Reflect.apply(actual.execFile, actual, args) as ReturnType<typeof actual.execFile>
    }) as typeof actual.execFile,
  }
})

/**
 * # ⚑ What the agents use, and which programs this install bundles
 *
 * Landing coverage for the Providers screen's two measured facts. **Resources**: one process listing,
 * summed by the pids this app's adapters hold — never by name — each process counted once, a root that
 * has left the listing not counted. **Versions**: read from what is bundled, once per run; only an ask
 * that failed for a passing reason is asked again; and Codex is run with a home of its own that is
 * removed after, never the person's `~/.codex`.
 */

const row = (pid: number, ppid: number, rssKb: number, cpu: number): ListedProcess => ({
  pid,
  ppid,
  rssKb,
  cpu,
})

describe('resourcesFromTheListing', () => {
  const AT = 1234

  it('🔴 sums each provider’s roots and everything under them, children included, by KiB → bytes', () => {
    const rows = [
      row(1, 0, 100, 1),
      row(10, 1, 1_000, 5), // a claude root
      row(11, 10, 200, 2.25), // its tool command
      row(12, 11, 50, 0.5), // …and that command's child
      row(20, 1, 3_000, 10), // a codex root
      row(30, 1, 9_999, 99), // an unrelated process: never counted
    ]
    const out = resourcesFromTheListing(rows, { claude: [10], codex: [20] }, AT)
    expect(out.claude).toEqual({ running: 1, rssBytes: 1_250 * 1024, cpuPercent: 7.8, at: AT })
    expect(out.codex).toEqual({ running: 1, rssBytes: 3_000 * 1024, cpuPercent: 10, at: AT })
  })

  it('⛔ a root that is no longer in the listing is not running and counts nothing', () => {
    const out = resourcesFromTheListing([row(10, 1, 500, 1)], { claude: [10, 999], codex: [] }, AT)
    expect(out.claude).toMatchObject({ running: 1, rssBytes: 500 * 1024 })
    expect(out.codex).toEqual({ running: 0, rssBytes: 0, cpuPercent: 0, at: AT })
  })

  it('⛔ a process under two roots is counted once, and a root under another root is not counted twice', () => {
    const rows = [row(10, 1, 100, 1), row(11, 10, 100, 1), row(12, 11, 100, 1)]
    // 11 is a root of its own AND under 10: the whole tree is 300, never 500.
    const out = resourcesFromTheListing(rows, { claude: [10, 11], codex: [] }, AT)
    expect(out.claude).toMatchObject({ running: 2, rssBytes: 300 * 1024, cpuPercent: 3 })
    // …and the same child is not counted again for the other provider.
    const shared = resourcesFromTheListing(rows, { claude: [10], codex: [11] }, AT)
    expect(shared.claude.rssBytes).toBe(300 * 1024)
    expect(shared.codex).toMatchObject({ running: 1, rssBytes: 0 })
  })

  it('⚑ a process that is its own parent does not loop, and a cycle is walked once', () => {
    const rows = [row(10, 10, 100, 1), row(11, 12, 100, 1), row(12, 11, 100, 1)]
    const out = resourcesFromTheListing(rows, { claude: [10, 11], codex: [] }, AT)
    expect(out.claude).toMatchObject({ running: 2, rssBytes: 300 * 1024 })
  })

  it('⚑ CPU is summed to a tenth', () => {
    const rows = [row(10, 1, 1, 0.1), row(11, 10, 1, 0.2), row(12, 10, 1, 0.3)]
    expect(resourcesFromTheListing(rows, { claude: [10], codex: [] }, AT).claude.cpuPercent).toBe(
      0.6,
    )
  })
})

describe('listProcesses', () => {
  it('🔴 reads one listing of the machine, and this very process is in it, with a size and a pid parent', async () => {
    const rows = await listProcesses()
    const mine = rows.find((one) => one.pid === process.pid)
    expect(mine, 'the test process is not in the listing').toBeDefined()
    expect(mine!.ppid).toBe(process.ppid)
    expect(mine!.rssKb).toBeGreaterThan(0)
    expect(Number.isFinite(mine!.cpu)).toBe(true)
    // Every row is four finite numbers: nothing else (a command, an argument) was read.
    for (const one of rows) {
      expect(Object.keys(one).sort()).toEqual(['cpu', 'pid', 'ppid', 'rssKb'])
    }
  })
})

describe('providerVersionsReader', () => {
  let dir: string
  const fixtures = new Map<string, VersionFixture>()
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-versions-'))
    if (process.platform === 'win32') {
      versionPrograms.run = (file, options, callback) => {
        const fixture = fixtures.get(file)
        if (fixture === undefined) return false
        const env = options.env ?? {}
        if (fixture.homeTo) writeFileSync(fixture.homeTo, env.HOME ?? '')
        if (fixture.codexHomeTo) writeFileSync(fixture.codexHomeTo, env.CODEX_HOME ?? '')
        if (fixture.claudeEnvironmentTo) {
          writeFileSync(
            fixture.claudeEnvironmentTo,
            `${env.HOME ?? ''} ${env.CLAUDE_CONFIG_DIR ?? ''} ${env.DISABLE_AUTOUPDATER ?? ''}`,
          )
        }
        if (fixture.countTo) appendFileSync(fixture.countTo, 'x\n')
        if (fixture.requiresFile && !existsSync(fixture.requiresFile)) {
          callback(new Error('fixture program exited with code 3'), '')
        } else callback(null, fixture.output)
        return true
      }
    }
  })
  afterEach(() => {
    versionPrograms.run = null
    fixtures.clear()
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  /** A program that prints what a codex binary prints for `--version`, and says what home it ran in. */
  function aProgram(body: string, fixture: VersionFixture): string {
    const path = join(dir, 'codex')
    if (process.platform === 'win32') {
      writeFileSync(path, 'fixture program')
      fixtures.set(path, fixture)
    } else {
      writeFileSync(path, `#!/bin/sh\n${body}\n`)
      chmodSync(path, 0o755)
    }
    return path
  }

  /** That program, as the copy BroCrew carries — what a launch runs. */
  const carried = (path: string): CodexProgram => ({ path, from: 'carried' })

  it('🔴 Codex’s version is what the bundled binary prints, read in a home of its own that is removed after', async () => {
    const binary = aProgram(
      `echo "codex-cli 0.160.0"\necho "$HOME" > "${join(dir, 'home')}"\necho "$CODEX_HOME" > "${join(dir, 'codexhome')}"`,
      {
        output: 'codex-cli 0.160.0',
        homeTo: join(dir, 'home'),
        codexHomeTo: join(dir, 'codexhome'),
      },
    )
    const read = providerVersionsReader(() => carried(binary), NO_CLAUDE)
    const versions = await read()
    // ⚑ Which program runs, from where, and what it said — the copy BroCrew carries, with no tested
    // range and nothing to install.
    expect(versions.codex).toEqual({
      version: '0.160.0',
      program: {
        standing: 'tested',
        from: 'carried',
        path: binary,
        version: '0.160.0',
        tested: null,
        said: `Codex 0.160.0, the copy BroCrew carries, at ${binary}.`,
        help: null,
        others: [],
        update: null,
        updatedFrom: null,
      },
    })
    // Its home was a fresh folder of this app's own, never the person's, and it is gone.
    const home = readFileSyncTrim(join(dir, 'home'))
    expect(home).toContain('brobot-codex-version-')
    expect(readFileSyncTrim(join(dir, 'codexhome'))).toBe(home)
    expect(existsSync(home)).toBe(false)
  })

  it('⚑ a pre-release part, or a build part, is read with the version', async () => {
    const pre = providerVersionsReader(
      () =>
        carried(
          aProgram('echo "codex-cli 0.161.0-alpha.3"', { output: 'codex-cli 0.161.0-alpha.3' }),
        ),
      NO_CLAUDE,
    )
    expect((await pre()).codex.version).toBe('0.161.0-alpha.3')
    const build = providerVersionsReader(
      () => carried(aProgram('echo "codex-cli 0.161.0+b5"', { output: 'codex-cli 0.161.0+b5' })),
      NO_CLAUDE,
    )
    expect((await build()).codex.version).toBe('0.161.0+b5')
  })

  it('⛔ an answer that holds for the run is asked once: a second read does not run the binary again', async () => {
    const counter = join(dir, 'runs')
    const binary = aProgram(`echo x >> "${counter}"\necho "codex-cli 0.160.0"`, {
      output: 'codex-cli 0.160.0',
      countTo: counter,
    })
    const read = providerVersionsReader(() => carried(binary), NO_CLAUDE)
    await read()
    await read()
    await read()
    expect(readFileSyncTrim(counter).split('\n')).toHaveLength(1)
  })

  it('⚑ a binary that prints no version says so, once and for the run', async () => {
    const counter = join(dir, 'runs')
    const binary = aProgram(`echo x >> "${counter}"\necho "hello"`, {
      output: 'hello',
      countTo: counter,
    })
    const read = providerVersionsReader(() => carried(binary), NO_CLAUDE)
    const said = `Codex, the copy BroCrew carries, at ${binary}, did not say which version it is, so it may not run.`
    expect((await read()).codex).toEqual({
      version: null,
      reason: said,
      program: {
        standing: 'unreadable',
        from: 'carried',
        path: binary,
        version: null,
        tested: null,
        said,
        help: null,
        others: [],
        update: null,
        updatedFrom: null,
      },
    })
    await read()
    expect(readFileSyncTrim(counter).split('\n')).toHaveLength(1)
  })

  it('⛔ a binary that cannot be found is the program’s own sentence, and holds for the run', async () => {
    const asked = vi.fn(() => {
      throw new Error('Codex is not installed where this app expects it.')
    })
    const read = providerVersionsReader(asked, NO_CLAUDE)
    expect((await read()).codex).toEqual({
      version: null,
      reason: 'Codex is not installed where this app expects it.',
      program: {
        standing: 'missing',
        from: null,
        path: null,
        version: null,
        tested: null,
        said: 'Codex is not installed where this app expects it.',
        help: null,
        others: [],
        update: null,
        updatedFrom: null,
      },
    })
    await read()
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it('🔴 a binary that fails for a passing reason is asked again next time, and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const flag = join(dir, 'ok')
    const binary = aProgram(
      `echo "$HOME" > "${join(dir, 'home')}"\nif [ -e "${flag}" ]; then echo "codex-cli 0.160.0"; else exit 3; fi`,
      { output: 'codex-cli 0.160.0', homeTo: join(dir, 'home'), requiresFile: flag },
    )
    const read = providerVersionsReader(() => carried(binary), NO_CLAUDE)
    const said = `Codex, the copy BroCrew carries, at ${binary}, could not be asked its version just now; it is asked again next time.`
    expect((await read()).codex).toMatchObject({
      version: null,
      reason: said,
      program: { standing: 'unreadable', from: 'carried', path: binary, said },
    })
    // The home it made is gone even though the ask failed.
    const home = readFileSyncTrim(join(dir, 'home'))
    expect(home).toContain('brobot-codex-version-')
    expect(existsSync(home)).toBe(false)
    writeFileSync(flag, '')
    expect((await read()).codex).toMatchObject({
      version: '0.160.0',
      program: { standing: 'tested' },
    })
  })

  it('⚑ Claude’s version is what the person’s own Claude Code prints, read in a home of its own and told not to update', async () => {
    const path = join(dir, 'claude')
    if (process.platform === 'win32') {
      writeFileSync(path, 'fixture program')
      fixtures.set(path, { output: '2.1.287 (Claude Code)', claudeEnvironmentTo: join(dir, 'ran') })
    } else {
      writeFileSync(
        path,
        `#!/bin/sh\necho "$HOME $CLAUDE_CONFIG_DIR $DISABLE_AUTOUPDATER" > "${join(dir, 'ran')}"\necho "2.1.287 (Claude Code)"\n`,
      )
      chmodSync(path, 0o755)
    }
    const read = providerVersionsReader(
      () => carried(aProgram('echo "codex-cli 0.160.0"', { output: 'codex-cli 0.160.0' })),
      () => ({ path, from: 'native-installer', update: { command: 'claude update' }, others: [] }),
    )
    const { claude } = await read()
    expect(claude.version).toBe('2.1.287')
    expect(claude.program).toMatchObject({ from: 'native-installer', path, version: '2.1.287' })
    const [home, config, noUpdates] = readFileSyncTrim(join(dir, 'ran')).split(' ')
    expect(home).toContain('brobot-claude-version-')
    expect(config).toBe(home)
    expect(noUpdates).toBe('1')
  })

  it('⚑ no Claude Code on this computer is the lookup’s own sentence, and is asked again next time', async () => {
    const asked = vi.fn(NO_CLAUDE)
    const read = providerVersionsReader(() => {
      throw new Error('no Codex here')
    }, asked)
    const { claude } = await read()
    expect(claude).toMatchObject({ version: null, reason: 'no Claude Code here' })
    expect(claude.program?.standing).toBe('missing')
    await read()
    expect(asked).toHaveBeenCalledTimes(2)
  })
})

/** A computer with no Claude Code: the lookup throws the sentence a person reads. */
function NO_CLAUDE(): never {
  throw new Error('no Claude Code here')
}

function readFileSyncTrim(path: string): string {
  return readFileSync(path, 'utf8').trim()
}
