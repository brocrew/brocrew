import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUILT_FILES,
  FIXTURE_NOW,
  GAPS,
  KEEP_RECOVERY_WINDOW_ARG,
  KEEP_WINDOW_LINE,
  MADE_ONLY_BY_AN_OPEN_START,
  ONE_NEWER,
  ROWS_WITH_CONTROLS,
  SCENARIOS,
  START_LINES,
  THIS_BUILD,
  bridgeProblems,
  contractBridge,
  danglingIcons,
  evidenceFolder,
  expectedHistory,
  historyProblems,
  notElectronsOwn,
  readStartLines,
  refusedDataFolder,
  refusedPort,
  staleBuild,
} from '../recovery-real-entry-check.mjs'

/** The pure parts of the recovery real-entry check; the launch itself is the script's own run. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DESKTOP = join(ROOT, 'apps', 'desktop')
const read = (path) => readFileSync(join(DESKTOP, path), 'utf8')

describe('the bridge the contract declares', () => {
  const contract = contractBridge(read('src/shared/recovery.ts'))

  it('is read from the shared contract, onVerdict and zone included', () => {
    expect(contract).toEqual({
      methods: [
        'onProgress',
        'onVerdict',
        'quit',
        'resolveMessagePaths',
        'restore',
        'retry',
        'returnToNewer',
        'revealMessagePath',
        'verdict',
        'zone',
      ],
      nested: { history: ['conversations', 'transcript'] },
    })
  })

  it('matches what the recovery preload exposes, key for key', () => {
    const preload = read('src/preload/recovery.ts')
    for (const method of contract.methods) expect(preload).toMatch(new RegExp(`\\n  ${method}: `))
    expect(preload).toMatch(
      /history: Object\.freeze\(\{\n {4}conversations: [^\n]+\n {4}transcript: /,
    )
  })

  const exact = {
    ...Object.fromEntries(contract.methods.map((name) => [name, 'function'])),
    history: { conversations: 'function', transcript: 'function' },
  }

  it('passes the exact shape', () => {
    expect(bridgeProblems(exact, contract)).toEqual([])
  })

  it('names a missing, an extra, a mistyped and an absent bridge', () => {
    const { zone, ...withoutZone } = exact
    expect(zone).toBe('function')
    expect(bridgeProblems(withoutZone, contract)).toEqual(['window.recovery.zone is missing'])
    expect(bridgeProblems({ ...exact, send: 'function' }, contract)).toEqual([
      'window.recovery.send is not in the contract',
    ])
    expect(bridgeProblems({ ...exact, onVerdict: 'undefined' }, contract)).toEqual([
      'window.recovery.onVerdict is "undefined", not a function',
    ])
    expect(
      bridgeProblems(
        { ...exact, history: { conversations: 'function', file: 'function' } },
        contract,
      ),
    ).toEqual([
      'window.recovery.history.file is not in the contract',
      'window.recovery.history.transcript is undefined',
    ])
    expect(bridgeProblems(null, contract)).toEqual(['window.recovery is not on the page'])
  })

  it('follows the contract when it gains a method', () => {
    const grown = read('src/shared/recovery.ts').replace(
      '  quit(): Promise<void>\n',
      '  quit(): Promise<void>\n  /** Planted. */\n  forget(): void\n',
    )
    expect(contractBridge(grown).methods).toContain('forget')
    expect(bridgeProblems(exact, contractBridge(grown))).toEqual([
      'window.recovery.forget is missing',
    ])
  })
})

describe('icons', () => {
  it('finds a reference with no symbol, and an external one', () => {
    expect(danglingIcons(['#i-a', '#i-b', '#i-a'], ['i-a', 'i-b'])).toEqual([])
    expect(danglingIcons(['#i-a', '#i-c'], ['i-a'])).toEqual(['#i-c'])
    expect(danglingIcons(['sprite.svg#i-a'], ['i-a'])).toEqual(['sprite.svg#i-a'])
  })
})

describe('the history the copy holds', () => {
  const expected = expectedHistory({ now: FIXTURE_NOW, checkpoints: 2, copy: 1 })

  it('is the fixture’s two conversations, newest activity first, at their recorded times', () => {
    const asked2 = FIXTURE_NOW - 86_400_000 - 3_600_000
    const asked1 = asked2 - 86_400_000
    expect(expected).toEqual([
      {
        id: 'conversation-2',
        events: [
          { type: 'user_turn', text: 'Asked before copy 2.', at: asked2 },
          { type: 'assistant_message', text: 'Answered before copy 2.', at: asked2 + 1_000 },
        ],
      },
      {
        id: 'conversation-1',
        events: [
          { type: 'user_turn', text: 'Asked before copy 1.', at: asked1 },
          { type: 'assistant_message', text: 'Answered before copy 1.', at: asked1 + 1_000 },
        ],
      },
    ])
  })

  it('with every row kind, holds after each answer the rows whose controls the window must not draw', () => {
    const asked2 = FIXTURE_NOW - 86_400_000 - 3_600_000
    const [newest] = expectedHistory({
      now: FIXTURE_NOW,
      checkpoints: 2,
      copy: 1,
      everyRowKind: true,
    })
    expect(newest.events.slice(2)).toEqual([
      { type: 'image', text: null, at: asked2 + 2_000 },
      { type: 'sub_agent', text: null, at: asked2 + 2_001 },
      { type: 'sub_agent', text: null, at: asked2 + 2_002 },
      { type: 'tool_call', text: null, at: asked2 + 2_003 },
      { type: 'workflow_run', text: null, at: asked2 + 2_004 },
      { type: 'message_queued', text: 'one more thing', at: asked2 + 2_005 },
    ])
    // The Workflow call is there only so its run has a row to be drawn on.
    expect(
      new Set(
        newest.events
          .slice(2)
          .map((event) => event.type)
          .filter((type) => type !== 'tool_call'),
      ),
    ).toEqual(new Set(ROWS_WITH_CONTROLS))
  })

  it('is what the shared fixture writes, kind for kind', () => {
    const fixture = read('test/recovery/fixtures.test.ts')
    const [newest] = expectedHistory({
      now: FIXTURE_NOW,
      checkpoints: 2,
      copy: 1,
      everyRowKind: true,
    })
    const kinds = newest.events.map((event) => `'${event.type}'`).join(',\n          ')
    expect(fixture).toContain(`expect(kinds).toEqual([\n          ${kinds},\n        ])`)
  })

  it('names a wrong order, a moved time, a changed word and a missing conversation', () => {
    expect(historyProblems(expected, expected)).toEqual([])
    expect(historyProblems([...expected].reverse(), expected)[0]).toMatch(/^conversations /)
    const moved = structuredClone(expected)
    moved[0].events[1].at += 1
    expect(historyProblems(moved, expected)).toHaveLength(1)
    const reworded = structuredClone(expected)
    reworded[1].events[0].text = 'Asked later.'
    expect(historyProblems(reworded, expected)[0]).toMatch(/^conversation-1 reads /)
    expect(historyProblems(expected.slice(0, 1), expected)).toHaveLength(1)
    expect(historyProblems(undefined, expected)).toEqual(['the history read is undefined'])
  })
})

describe('the start lines', () => {
  it('are the ones main prints', () => {
    const lines = read('src/main/recovery/log-lines.ts')
    for (const line of Object.values(START_LINES)) {
      expect(lines.replace(/\s*\n\s*/g, ' ')).toContain(`'${line}'`)
    }
  })

  it('include the line main says when it keeps the recovery window, with the switch it heard', () => {
    const coordinator = read('src/main/recovery/coordinator.ts')
    expect(coordinator).toContain(
      `KEEP_RECOVERY_WINDOW_SWITCH = '${KEEP_RECOVERY_WINDOW_ARG.slice(2)}'`,
    )
    expect(coordinator).toContain(
      '`BroCrew keeps its recovery window on a hidden launch: --${KEEP_RECOVERY_WINDOW_SWITCH}`',
    )
    expect(KEEP_WINDOW_LINE).toBe(
      `BroCrew keeps its recovery window on a hidden launch: ${KEEP_RECOVERY_WINDOW_ARG}`,
    )
  })

  it('read a hidden refusal: the fail line, its reason, and recovery only', () => {
    const output = [
      'DevTools listening on ws://127.0.0.1:1/x',
      START_LINES.fail,
      "This workspace's data is a recovery copy from 2026-09-30T12:00:00.000Z, restored to be read; the newer data it set aside can be put back.",
      START_LINES.openedForRecovery,
      KEEP_WINDOW_LINE,
    ].join('\n')
    const said = readStartLines(output)
    expect(said).toMatchObject({
      failed: true,
      openedForRecovery: true,
      openedNormally: false,
      keepsTheWindow: true,
    })
    expect(readStartLines(START_LINES.fail).keepsTheWindow).toBe(false)
    expect(SCENARIOS.find((one) => one.name === 'history-only').reasonLine.test(said.reason)).toBe(
      true,
    )
    expect(readStartLines(START_LINES.ready)).toMatchObject({
      failed: false,
      reason: null,
      ready: true,
    })
  })

  it('each scenario’s reason pattern matches what main says for that verdict', () => {
    const newerAt = (inTheDatabase, inTheBuild) =>
      `A newer version of BroCrew has updated this workspace's data (/tmp/x/d) to database version ${String(inTheDatabase)}, and this version of BroCrew reads up to version ${String(inTheBuild)}. A recovery copy from 2026-09-30T12:00:00.000Z can be restored.`
    const replaced =
      "This workspace's data was changed outside BroCrew after a restore began. brobot2.sqlite no longer matches."
    const by = Object.fromEntries(SCENARIOS.map((one) => [one.name, one.reasonLine]))
    expect(by['newer-with-a-checked-copy'].test(newerAt(ONE_NEWER, THIS_BUILD))).toBe(true)
    expect(by['newer-with-a-checked-copy'].test(newerAt(ONE_NEWER + 1, THIS_BUILD + 1))).toBe(false)
    expect(by['replaced-outside'].test(replaced)).toBe(true)
    expect(by['newer-with-a-checked-copy'].test(replaced)).toBe(false)
  })
})

describe('the scenarios', () => {
  it('cover the three data folders and never skip a step', () => {
    expect(SCENARIOS.map((one) => one.name)).toEqual([
      'newer-with-a-checked-copy',
      'history-only',
      'replaced-outside',
    ])
    for (const one of SCENARIOS) {
      expect(one.steps[0]).toBe('entry')
      expect(one.steps.at(-2)).toBe('nothing-started')
      expect(one.steps.at(-1)).toBe('close')
      expect(one.fixture.everyRowKind).toBe(true)
    }
    expect(SCENARIOS[0].steps).toEqual([
      'entry',
      'restore',
      'history',
      'return',
      'nothing-started',
      'close',
    ])
  })

  it('lay down this build’s schema and one newer, counted from its migration journal', () => {
    const journal = JSON.parse(read('src/main/db/migrations/meta/_journal.json'))
    expect(THIS_BUILD).toBe(journal.entries.length)
    expect(ONE_NEWER).toBe(THIS_BUILD + 1)
    for (const one of SCENARIOS) {
      expect(one.fixture).toMatchObject({
        migrations: ONE_NEWER,
        checkpoints: [THIS_BUILD, THIS_BUILD],
      })
    }
  })

  it('look for the folders main makes only once it opened its data, by their names in main', () => {
    expect(read('src/main/runtime/workspace.ts')).toContain(
      `WORKSPACE_DIRNAME = '${MADE_ONLY_BY_AN_OPEN_START[0]}'`,
    )
    expect(read('src/main/runtime/provider-homes.ts')).toContain(
      `PROVIDER_HOMES_DIRNAME = '${MADE_ONLY_BY_AN_OPEN_START[1]}'`,
    )
    // The workspace is the first thing main makes when it creates its runtime host.
    const index = read('src/main/index.ts')
    const host = index.slice(index.indexOf('function createRuntimeHost('))
    expect(host.indexOf('ensureWorkspace(userData)')).toBeGreaterThan(0)
    expect(host.indexOf('ensureWorkspace(userData)')).toBeLessThan(host.indexOf('\n}\n'))
  })

  it("tell Electron's own processes from any other the launch runs", () => {
    const dist = '/r/node_modules/.pnpm/electron@38/node_modules/electron/dist'
    const ours = [
      `${dist}/Electron.app/Contents/MacOS/Electron --remote-debugging-port=1 .`,
      `${dist}/Electron.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer) --type=renderer`,
    ]
    expect(notElectronsOwn(ours)).toEqual([])
    const claude = '/Users/someone/.local/bin/claude --print'
    expect(notElectronsOwn([...ours, claude])).toEqual([claude])
  })

  it('name each gap with an owner', () => {
    for (const gap of Object.values(GAPS)) {
      expect(gap.owner).not.toBe('')
      expect(gap.what.length).toBeGreaterThan(40)
    }
  })
})

describe('what the check refuses', () => {
  it('BroBot’s own data folder, a folder outside the temp directory, and a too-long one', () => {
    const on = { home: '/Users/someone', temp: '/tmp/t', platform: 'darwin' }
    expect(
      refusedDataFolder('/Users/someone/Library/Application Support/@brobot2/desktop', on),
    ).toMatch(/BroBot's own data folder/)
    expect(refusedDataFolder('/Users/someone/elsewhere', on)).toMatch(/not under/)
    expect(refusedDataFolder('/tmp/t', on)).toMatch(/not under/)
    expect(refusedDataFolder('/tmp/tt/bbrec-1/d', on)).toMatch(/not under/)
    expect(refusedDataFolder(`/tmp/t/${'x'.repeat(100)}`, on)).toMatch(/too long/)
    expect(refusedDataFolder('/tmp/t/bbrec-1/d', on)).toBeNull()
  })

  it('on Windows: the app’s own folder under %APPDATA%, in any case, and no socket to fit', () => {
    const on = {
      home: 'C:\\Users\\runneradmin',
      temp: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp',
      platform: 'win32',
      appData: 'C:\\Users\\runneradmin\\AppData\\Roaming',
    }
    expect(
      refusedDataFolder('c:\\users\\runneradmin\\appdata\\roaming\\@BroBot2\\desktop', on),
    ).toMatch(/BroBot's own data folder/)
    expect(refusedDataFolder('D:\\a\\_temp\\bbrec-1\\d', on)).toMatch(/not under/)
    expect(refusedDataFolder('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp', on)).toMatch(/not under/)
    expect(
      refusedDataFolder(`c:\\users\\runner~1\\appdata\\local\\temp\\bbrec-1\\d`, on),
    ).toBeNull()
    expect(
      refusedDataFolder(
        `C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\bbrec-1\\${'x'.repeat(100)}`,
        on,
      ),
    ).toBeNull()
    // ⚑ A Windows that names no %APPDATA%: said as null, so this process's own variable is not read.
    expect(
      refusedDataFolder('C:\\Users\\runneradmin\\AppData\\Roaming\\@brobot2', {
        ...on,
        appData: null,
      }),
    ).toMatch(/BroBot's own data folder/)
  })

  it('a person’s debugging port', () => {
    expect(refusedPort(9444)).not.toBeNull()
    expect(refusedPort(9222)).not.toBeNull()
    expect(refusedPort(0)).not.toBeNull()
    expect(refusedPort(53_211)).toBeNull()
  })

  it('a build with a file missing or older than the sources', () => {
    const at = Object.fromEntries(BUILT_FILES.map((path) => [path, 200]))
    expect(staleBuild(at, 100)).toEqual([])
    expect(staleBuild({ ...at, 'out/preload/recovery.js': null }, 100)).toEqual([
      'out/preload/recovery.js',
    ])
    expect(staleBuild(at, 300)).toEqual(BUILT_FILES)
  })
})

describe('the launch', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'recovery-real-entry-check.mjs'), 'utf8')

  it('is hidden, on its own folder and a kernel-assigned port, and reaped by what it owns', () => {
    expect(script).toMatch(/\n {6}HIDDEN_LAUNCH_ARG,\n {6}KEEP_RECOVERY_WINDOW_ARG,\n/)
    expect(script).toContain('`--user-data-dir=${userDataDir}`')
    expect(script).toContain("server.listen(0, '127.0.0.1'")
    expect(script).toContain(
      'tearDownAndRemove({ lifecycle: app.lifecycle, directory: root, remove })',
    )
    expect(script).not.toMatch(/pkill|killall|taskkill \/IM|\/IM /)
  })

  it('runs the program the electron module names, never a shell shim', () => {
    // Spelled `require('electron')` so the hidden-launch census still finds this launcher.
    expect(script).toContain("const require = createRequire(join(DESKTOP, 'package.json'))")
    expect(script).toContain("require('electron')")
    expect(script).not.toContain('node_modules/.bin/electron')
  })

  it('fails a scenario whose launch was not reaped or whose folder stayed', () => {
    expect(script).toContain("'the launch was reaped and its folder removed'")
  })
})

describe('the evidence folder', () => {
  it('comes from --evidence, else from BROBOT_RECOVERY_EVIDENCE, else is not kept', () => {
    expect(evidenceFolder(['--evidence', '/tmp/e'], {})).toBe(resolve('/tmp/e'))
    expect(evidenceFolder(['--no-build'], { BROBOT_RECOVERY_EVIDENCE: '/tmp/f' })).toBe(
      resolve('/tmp/f'),
    )
    expect(evidenceFolder(['--evidence', '/tmp/e'], { BROBOT_RECOVERY_EVIDENCE: '/tmp/f' })).toBe(
      resolve('/tmp/e'),
    )
    expect(evidenceFolder([], {})).toBeNull()
    expect(evidenceFolder([], { BROBOT_RECOVERY_EVIDENCE: '' })).toBeNull()
  })

  it('refuses --evidence with no folder after it', () => {
    expect(() => evidenceFolder(['--evidence'], {})).toThrow(/needs a folder/)
    expect(() => evidenceFolder(['--evidence', '--no-build'], {})).toThrow(/needs a folder/)
  })
})

describe('the beta builds run the check in a job of its own', () => {
  const workflow = (name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8')

  it.each([
    ['windows.yml', 'windows-2022', 'recovery-evidence-windows'],
    ['macos.yml', 'macos-15', 'recovery-evidence-macos'],
  ])(
    '%s: waits only for the question whether to build, and the build job no longer runs it',
    (name, runner, evidence) => {
      const text = workflow(name)
      const job = text.slice(text.indexOf('\n  recovery-real-entry:\n'))
      expect(job).toContain('\n    needs: flags\n')
      expect(job).toContain('\n    uses: ./.github/workflows/recovery-real-entry.yml\n')
      expect(job).toContain(`\n      runner: ${runner}\n`)
      expect(job).toContain(`\n      evidence: ${evidence}\n`)
      expect(text.match(/recovery-real-entry-check\.mjs/g)).toBeNull()
    },
  )

  it('the called check keeps its evidence whether it passed or not', () => {
    const text = workflow('recovery-real-entry.yml')
    expect(text).toContain('BROBOT_RECOVERY_EVIDENCE: ${{ runner.temp }}/recovery-evidence')
    expect(text).toMatch(/- name: Keep what the check saw\n {8}if: always\(\)\n/)
    expect(text).toContain('name: ${{ inputs.evidence }}')
  })
})
