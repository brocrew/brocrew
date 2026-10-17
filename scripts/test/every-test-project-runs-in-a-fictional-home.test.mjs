import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MADE,
  NO_TEST_HOLDS,
  TESTS_HOME,
  THE_STAND_IN_KEYCHAIN_PROGRAM,
  THE_TESTS_HOME_IS_NAMED,
  theVariablesFor,
} from '../lib/tests-run-in-a-fictional-home.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
/** A config's code, without its comments. */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * # Every test project runs in a fictional home
 *
 * A test may isolate itself with a seam, and a planted defect may remove that seam. So the
 * isolation is the process's: each project's tests run with the home, the providers' folders, the
 * XDG folders and Windows' app-data folders in a fictional folder, and a setup file refuses to run
 * a test file anywhere else. This file checks that every project that runs in Node is given both,
 * and that this very process is sealed.
 */
describe('every test project runs in a fictional home', () => {
  it('🔒 each Node project in each config is given the seal and the guard', () => {
    const inline = (path, names) => {
      const config = codeOf(read(path))
      expect(config, path).toContain(
        'const sealed = { env: theTestsEnv(), setupFiles: [THE_GUARD] }',
      )
      for (const name of names) {
        const at = config.indexOf(`name: '${name}'`)
        expect(at, `${path}: ${name}`).toBeGreaterThan(-1)
        const project = config.slice(at, config.indexOf('},', at))
        expect(project, `${path}: ${name}`).toContain('...sealed,')
      }
      // ⚑ No project is declared here that the list above does not name.
      expect([...config.matchAll(/name: '([^']+)'/g)].map((one) => one[1]).sort()).toEqual(
        [...names].sort(),
      )
    }
    inline('vitest.config.ts', ['shared', 'runtime', 'scripts'])
    inline('vitest.gate-only.config.ts', ['gate-only-desktop', 'gate-only-scripts'])

    const desktop = codeOf(read('apps/desktop/vitest.config.ts'))
    expect(desktop).toContain("name: 'desktop'")
    expect(desktop).toContain('env: theTestsEnv(),')
    expect(desktop).toContain('setupFiles: [THE_GUARD],')

    // ⚑ The root config's other projects: the desktop one above, and the one that runs in a browser,
    // which reads no file.
    const root = codeOf(read('vitest.config.ts'))
    expect([...root.matchAll(/^\s+'(\.\/[^']+)',$/gm)].map((one) => one[1])).toEqual([
      './apps/desktop',
      './apps/desktop/vitest.dom.config.ts',
    ])
  })

  it('🔒 every vitest config in the repository is sealed, or is named here with why it is not', () => {
    const folders = ['.', 'scripts']
    for (const group of ['apps', 'packages']) {
      for (const name of readdirSync(join(ROOT, group))) {
        if (statSync(join(ROOT, group, name)).isDirectory()) folders.push(`${group}/${name}`)
      }
    }
    const found = folders.flatMap((folder) =>
      readdirSync(join(ROOT, folder))
        .filter((name) => /^vitest\b.*\.config\.[cm]?[jt]s$/.test(name))
        .map((name) => (folder === '.' ? name : `${folder}/${name}`)),
    )
    // The test above reads each of these.
    const sealed = [
      'apps/desktop/vitest.config.ts',
      'vitest.config.ts',
      'vitest.gate-only.config.ts',
    ]
    // Run in a browser, which reads no file of the person's: the window's tests, the pictures a
    // designer asks for, and the measurements.
    const inABrowser = [
      'apps/desktop/vitest.dom.config.ts',
      'apps/desktop/vitest.look.config.ts',
      'apps/desktop/vitest.probe.config.ts',
    ]
    // No test run includes these: a live smoke is a check of the computer's own login, and a probe
    // makes its own sandbox.
    const live = ['vitest.smoke.config.ts']
    expect(found.sort()).toEqual([...sealed, ...inABrowser, ...live].sort())
  })

  it('🔒 the setup file spells out every folder name the seal sets, a second time', () => {
    // ⚑ Three lists, each written by hand: the seal's, the setup file's own, and this one. The
    // setup file refuses when the first two differ; this is what holds them to the names below.
    const every = [
      'APPDATA',
      'CFFIXED_USER_HOME',
      'CLAUDE_CONFIG_DIR',
      'CLAUDE_SECURESTORAGE_CONFIG_DIR',
      'CODEX_HOME',
      'CODEX_SQLITE_HOME',
      'HOME',
      'LOCALAPPDATA',
      'NVM_DIR',
      'USERPROFILE',
      'XDG_CACHE_HOME',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_STATE_HOME',
    ]
    expect(Object.keys(theVariablesFor('/a-home')).sort()).toEqual(every)
    const setup = read('scripts/lib/a-test-sees-no-real-home.setup.mjs')
    const own = /const EVERY_FOLDER = \{([\s\S]*?)\n\}/.exec(setup)?.[1] ?? ''
    expect([...own.matchAll(/^ {2}([A-Z_]+): \[/gm)].map((one) => one[1]).sort()).toEqual(every)
  })

  it('🔒 this process is sealed: its home, every folder variable, and the Keychain program', () => {
    const home = process.env[TESTS_HOME] ?? ''
    expect(home).toContain('brobot2-tests-home-')
    expect(homedir()).toBe(home)
    expect(realpathSync(home)).toBe(home)
    expect(userInfo().homedir).not.toBe(home)
    for (const [name, value] of Object.entries(theVariablesFor(home))) {
      expect(process.env[name], name).toBe(value)
    }
    expect((process.env.PATH ?? '').split(delimiter)[0]).toBe(join(home, 'bin'))
    expect(existsSync(join(home, '.codex'))).toBe(false)
    expect(existsSync(join(home, '.claude'))).toBe(false)
  })

  it('🔴 the guard refuses a process that was not given the seal, and says which part is missing', async () => {
    const guard = pathToFileURL(join(ROOT, 'scripts', 'lib', 'a-test-sees-no-real-home.setup.mjs'))
    const { spawnSync } = await import('node:child_process')
    const run = (env) =>
      spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(guard.href)})`],
        { env, encoding: 'utf8' },
      )
    const refused = (env, why) => {
      const ran = run(env)
      expect(ran.status, why).not.toBe(0)
      expect(ran.stderr, why).toContain(`This test process can see the real home (${why})`)
    }
    // ⚑ As this process is: it loads.
    expect(run(process.env).status).toBe(0)

    // ⛔ With the home put back to the one the computer records.
    const real = userInfo().homedir
    refused(
      { ...process.env, HOME: real, USERPROFILE: real },
      'the home directory is not the fictional one',
    )
    // ⛔ With one folder variable pointing elsewhere.
    refused(
      { ...process.env, CODEX_HOME: join(ROOT, 'elsewhere') },
      'CODEX_HOME is not in the fictional home',
    )
    // ⛔ With the seal's own name missing.
    const unnamed = { ...process.env }
    delete unnamed[TESTS_HOME]
    refused(unnamed, `${TESTS_HOME} is not set`)
    // ⛔ With the stand-in Keychain program no longer first on the path.
    const [, ...rest] = (process.env.PATH ?? '').split(delimiter)
    refused(
      { ...process.env, PATH: rest.join(delimiter) },
      'the fictional home’s programs are not first on the path',
    )
    // ⛔ With every variable in step, and the folder they name the person's own.
    refused(
      {
        ...process.env,
        ...theVariablesFor(real),
        [TESTS_HOME]: real,
        PATH: `${join(real, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      },
      'the fictional home is the real one',
    )
  })

  it('🔴 the guard refuses a home whose stand-in Keychain program is missing, replaced, linked or cannot run', async () => {
    const guard = pathToFileURL(join(ROOT, 'scripts', 'lib', 'a-test-sees-no-real-home.setup.mjs'))
    const { spawnSync } = await import('node:child_process')
    // ⚑ A second fictional home, made here: each control changes one thing in it. The child loads
    // the guard and nothing else, so no control runs any program called `security`.
    const fake = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-tests-home-control-')))
    const standIn = join(fake, 'bin', 'security')
    const env = {
      ...process.env,
      ...theVariablesFor(fake),
      [TESTS_HOME]: fake,
      PATH: `${join(fake, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
    }
    const run = (given, then = '') =>
      spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(guard.href)});${then}`],
        { env: given, encoding: 'utf8' },
      )
    const why = 'the fictional home’s Keychain program is missing or is not the stand-in'
    const refused = (label) => {
      const ran = run(env)
      expect(ran.status, label).not.toBe(0)
      expect(ran.stderr, label).toContain(`This test process can see the real home (${why})`)
    }
    try {
      mkdirSync(join(fake, 'bin'))
      // ⛔ No program at all: the name would reach the computer's own.
      refused('missing')
      // ⚑ The stand-in, as the seal writes it: the guard loads.
      writeFileSync(standIn, THE_STAND_IN_KEYCHAIN_PROGRAM, { mode: 0o755 })
      expect(run(env).status).toBe(0)
      // ⛔ Other bytes under the same name.
      writeFileSync(standIn, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      refused('replaced')
      if (process.platform !== 'win32') {
        // ⛔ The right bytes in a file that cannot be run: the path would be searched further.
        writeFileSync(standIn, THE_STAND_IN_KEYCHAIN_PROGRAM)
        chmodSync(standIn, 0o644)
        refused('cannot run')
        // ⛔ To be run by others and not by its owner, who is the one running the tests.
        chmodSync(standIn, 0o645)
        refused('cannot be run by its owner')
        // ⛔ A link under that name, even to a file holding the right bytes.
        rmSync(standIn)
        writeFileSync(join(fake, 'elsewhere'), THE_STAND_IN_KEYCHAIN_PROGRAM, { mode: 0o755 })
        symlinkSync(join(fake, 'elsewhere'), standIn)
        refused('linked')
        rmSync(standIn)
      }
      writeFileSync(standIn, THE_STAND_IN_KEYCHAIN_PROGRAM, { mode: 0o755 })
      chmodSync(standIn, 0o755)
      expect(run(env).status).toBe(0)

      // ⛔ A folder variable that names a place outside the home, one for each provider's second name.
      for (const name of ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CODEX_SQLITE_HOME', 'NVM_DIR']) {
        const ran = run({ ...env, [name]: join(tmpdir(), 'brobot2-a-poison-path') })
        expect(ran.status, name).not.toBe(0)
        expect(ran.stderr, name).toContain(`(${name} is not in the fictional home)`)
      }

      // ⛔ Another name for a home: a link, named as the seal names its folders, to this complete
      // fictional home, with every variable spelled through the link.
      const temp = realpathSync(tmpdir())
      const alias = join(temp, `${THE_TESTS_HOME_IS_NAMED}alias-${process.pid}`)
      symlinkSync(fake, alias)
      try {
        const ran = run({
          ...env,
          ...theVariablesFor(alias),
          [TESTS_HOME]: alias,
          PATH: `${join(alias, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
        })
        expect(ran.status).not.toBe(0)
        expect(ran.stderr).toContain('(the fictional home is not its own real path)')
      } finally {
        unlinkSync(alias)
      }
      // ⛔ A complete home that the seal did not make: its folder is named otherwise.
      const other = realpathSync(mkdtempSync(join(temp, 'brobot2-some-other-folder-')))
      try {
        mkdirSync(join(other, 'bin'))
        writeFileSync(join(other, 'bin', 'security'), THE_STAND_IN_KEYCHAIN_PROGRAM, {
          mode: 0o755,
        })
        const ran = run({
          ...env,
          ...theVariablesFor(other),
          [TESTS_HOME]: other,
          PATH: `${join(other, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
        })
        expect(ran.status).not.toBe(0)
        expect(ran.stderr).toContain('(the fictional home is not a folder the seal made)')
      } finally {
        rmSync(other, { recursive: true, force: true })
      }

      // 🔒 A variable that is a credential by itself is gone once the guard has loaded.
      for (const name of NO_TEST_HOLDS) {
        const ran = run(
          { ...env, [name]: 'a-fictional-token' },
          `process.exit(process.env[${JSON.stringify(name)}] === undefined ? 0 : 3)`,
        )
        expect(ran.status, name).toBe(0)
      }
    } finally {
      rmSync(fake, { recursive: true, force: true })
    }
  })

  it('🔒 the seal reuses only a folder its own process made: an inherited one is not believed', async () => {
    const lib = pathToFileURL(join(ROOT, 'scripts', 'lib', 'tests-run-in-a-fictional-home.mjs'))
    const { spawnSync } = await import('node:child_process')
    const madeBy = (inherited) =>
      spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const { theTestsEnv } = await import(${JSON.stringify(lib.href)});` +
            'const first = theTestsEnv().HOME; process.stdout.write(first === theTestsEnv().HOME ? first : "two")',
        ],
        { env: { ...process.env, [MADE]: inherited }, encoding: 'utf8' },
      ).stdout
    const mine = process.env[TESTS_HOME] ?? ''
    // ⛔ This run's own folder, named by another process's pid, or by none: a fresh one is made.
    // ⚑ And made once: the second call in that process answers the same folder.
    for (const inherited of [`${process.pid}:${mine}`, mine, `:${mine}`]) {
      const home = madeBy(inherited)
      expect(home, inherited).toContain(THE_TESTS_HOME_IS_NAMED)
      expect(home, inherited).not.toBe(mine)
      // Removed when that process ended.
      expect(existsSync(home), inherited).toBe(false)
    }
  })

  it('🔒 a program a test starts with an environment that names no home is given the fictional one', async () => {
    const childProcess = await import('node:child_process')
    const { promisify } = await import('node:util')
    const mine = process.env[TESTS_HOME] ?? ''
    const says = 'process.stdout.write(require("node:os").homedir())'
    const node = process.execPath
    const noHome = { env: { A_VARIABLE_OF_ITS_OWN: 'kept' }, encoding: 'utf8' }
    const ended = (child) =>
      new Promise((resolve) => {
        let out = ''
        child.stdout.on('data', (chunk) => (out += chunk))
        child.on('close', () => resolve(out))
      })

    // Each way of starting one, given an environment with no home in it.
    expect(childProcess.spawnSync(node, ['-e', says], noHome).stdout).toBe(mine)
    expect(childProcess.execFileSync(node, ['-e', says], noHome)).toBe(mine)
    expect(await ended(childProcess.spawn(node, ['-e', says], noHome))).toBe(mine)
    expect(await ended(childProcess.execFile(node, ['-e', says], noHome))).toBe(mine)
    expect((await promisify(childProcess.execFile)(node, ['-e', says], noHome)).stdout).toBe(mine)
    const forked = childProcess.fork(
      join(ROOT, 'scripts', 'test', 'fixtures', 'says-its-home.mjs'),
      [],
      { env: noHome.env, stdio: ['ignore', 'pipe', 'ignore', 'ipc'] },
    )
    expect(await ended(forked)).toBe(mine)
    if (process.platform !== 'win32') {
      const typed = `'${node}' -e '${says}'`
      expect(childProcess.execSync(typed, noHome)).toBe(mine)
      expect(await ended(childProcess.exec(typed, noHome))).toBe(mine)
      expect((await promisify(childProcess.exec)(typed, noHome)).stdout).toBe(mine)
    }

    // ⚑ Every other variable is left as the caller wrote it, and none is added.
    const seen = JSON.parse(
      childProcess.spawnSync(
        node,
        ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))'],
        noHome,
      ).stdout,
    )
    for (const name of ['A_VARIABLE_OF_ITS_OWN', 'HOME', 'USERPROFILE'])
      expect(seen).toContain(name)
    expect(seen).not.toContain('CODEX_HOME')
    expect(seen).not.toContain(TESTS_HOME)

    // ⚑ A home the caller names is the caller's: not replaced.
    const own = join(mine, 'a-home-of-its-own')
    const named = process.platform === 'win32' ? { USERPROFILE: own } : { HOME: own }
    expect(
      childProcess.spawnSync(node, ['-e', says], { env: named, encoding: 'utf8' }).stdout,
    ).toBe(own)
    // ⚑ No environment given: this process's, which is sealed.
    expect(childProcess.spawnSync(node, ['-e', says], { encoding: 'utf8' }).stdout).toBe(mine)
  })

  it('🔴 a run that must start no program refuses every way of starting one, and writes each down', async () => {
    const guard = pathToFileURL(join(ROOT, 'scripts', 'lib', 'a-test-sees-no-real-home.setup.mjs'))
    const { spawnSync } = await import('node:child_process')
    const record = join(realpathSync(tmpdir()), `brobot2-no-program-${process.pid}.txt`)
    const load = `await import(${JSON.stringify(guard.href)})`
    // A process of its own, loading the setup file as a test process does, then trying each way and
    // catching what it is answered. ⚑ Nothing it tries is started: that is what is checked.
    const tries = `
      ${load}
      const childProcess = await import('node:child_process')
      const { promisify } = await import('node:util')
      const node = process.execPath
      const refused = []
      const tried = async (how, start) => {
        try { await start() } catch (error) { if (String(error).includes('starts no program')) refused.push(how) }
      }
      await tried('spawn', () => childProcess.spawn(node, ['-e', '']))
      await tried('spawnSync', () => childProcess.spawnSync(node, ['-e', '']))
      await tried('exec', () => childProcess.exec('true'))
      await tried('execSync', () => childProcess.execSync('true'))
      await tried('execFile', () => childProcess.execFile(node, ['-e', '']))
      await tried('execFileSync', () => childProcess.execFileSync(node, ['-e', '']))
      await tried('fork', () => childProcess.fork(${JSON.stringify(join(ROOT, 'scripts', 'test', 'fixtures', 'says-its-home.mjs'))}))
      await tried('exec, promisified', () => promisify(childProcess.exec)('true'))
      await tried('execFile, promisified', () => promisify(childProcess.execFile)(node, ['-e', '']))
      await tried('a thread', async () => new (await import('node:worker_threads')).Worker('1', { eval: true }))
      await tried('a cluster', async () => (await import('node:cluster')).default.fork())
      delete process.env.BROBOT_TESTS_START_NO_PROGRAM
      await tried('with the variable taken away', () => childProcess.spawnSync(node, ['-e', '']))
      process.stdout.write(refused.join(','))
    `
    const run = (script, env = { ...process.env, BROBOT_TESTS_START_NO_PROGRAM: record }) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' })
    const written = () => readFileSync(record, 'utf8').trim().split('\n')
    try {
      // ⚑ The run makes its record before it begins, with a line of its own.
      writeFileSync(record, 'the seal’s own test\n')
      expect(run(tries).stdout).toBe(
        [
          'spawn',
          'spawnSync',
          'exec',
          'execSync',
          'execFile',
          'execFileSync',
          'fork',
          'exec, promisified',
          'execFile, promisified',
          'a thread',
          'a cluster',
          // ⛔ Turned off by the test after the setup file loaded: still refused.
          'with the variable taken away',
        ].join(','),
      )
      // The run's own line, one for the process that loaded the setup file, one for each start
      // by the way it was tried, and the compiled modules it held at its end. Nothing else.
      const all = written()
      expect(all[0]).toBe('the seal’s own test')
      expect(all[1]).toMatch(/^loaded \d+$/)
      expect(all.slice(2, -1)).toEqual([
        'start spawn',
        'start spawnSync',
        'start exec',
        'start execSync',
        'start execFile',
        'start execFileSync',
        'start fork',
        'start exec',
        'start execFile',
        'start Worker',
        'start cluster.fork',
        'start spawnSync',
      ])
      expect(all.at(-1)).toMatch(/^compiled /)

      // ⚑ A process that starts nothing loads, and its record holds no start.
      writeFileSync(record, 'a second run\n')
      expect(run(load).status).toBe(0)
      expect(written().filter((line) => line.startsWith('start '))).toEqual([])
      expect(written()[1]).toMatch(/^loaded \d+$/)

      // ⛔ No record made first, a folder under its name, or a record that cannot be written to: a
      // run that cannot be checked, so the setup file does not load.
      rmSync(record)
      for (const [how, made] of [
        ['missing', () => {}],
        ['a folder', () => mkdirSync(record)],
        ['not to be written', () => writeFileSync(record, 'a third run\n', { mode: 0o400 })],
      ]) {
        made()
        const ran = run(load)
        expect(ran.status, how).not.toBe(0)
        expect(ran.stderr, how).toContain('its record is missing or cannot be written')
        rmSync(record, { recursive: true, force: true })
      }

      // ⚑ Without the variable a start is made, and nothing is written anywhere.
      const free = run(
        `${load}
         const { spawnSync } = await import('node:child_process')
         process.stdout.write(String(spawnSync(process.execPath, ['-e', '']).status))`,
        { ...process.env },
      )
      expect(free.stdout).toBe('0')
      expect(existsSync(record)).toBe(false)
    } finally {
      rmSync(record, { recursive: true, force: true })
    }
  })
})
