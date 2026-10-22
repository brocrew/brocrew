import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { readTheSystemZoneNow } from '../../src/main/system-zone'

/**
 * How main ends a start that does not open its data, read from `index.ts` (which loads Electron, so
 * no test can run it): every line a watcher matches is written at once to stderr; a start closed
 * while it checks its data says so and exits 1, and nothing opens after; a verdict other than
 * `open` stops before the data; a start that fails afterwards still ends in the recovery window; a
 * failed start exits 1 by `app.exit`, never by an exit code left for a quit to honour; the ready
 * line is the open path's last word; a packaged build takes no test fault; and the recovery window
 * reads the time zone without watching it a second time.
 *
 * Each pin is asked of the code with its comments removed.
 */

const here = dirname(fileURLToPath(import.meta.url))
const INDEX = readFileSync(join(here, '../../src/main/index.ts'), 'utf8')

/** Source with its comments removed, so a sentence about a call is never taken for the call. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const CODE = codeOf(INDEX)

/** The text of the function declared by `head`, up to the next declaration at column 0. */
function functionIn(code: string, head: string): string {
  const at = code.indexOf(head)
  if (at < 0) throw new Error(`index.ts no longer declares ${head}`)
  const next = code.slice(at + head.length).search(/\n(?:async )?function |\nconst |\nlet |\nvoid /)
  return code.slice(at, next < 0 ? undefined : at + head.length + next)
}

/** Every way `name` is used in `code`, past its import. */
function usesOf(code: string, name: string): string[] {
  const body = code.slice(code.indexOf('\ntry {\n  pinTheDataFolder(app)'))
  return [...body.matchAll(new RegExp(`^.*\\b${name}\\b.*$`, 'gm'))].map((match) => match[0].trim())
}

describe('the lines a start prints are written at once, to stderr', () => {
  const said = (code: string, name: string): boolean =>
    usesOf(code, name).every((line) => line.includes(`sayAtOnce(${name})`))

  it('every one of them, and the copy’s line through the check’s own log', () => {
    for (const name of [
      'READY_LINE',
      'FAIL_LINE',
      'CLOSED_WHILE_CHECKING',
      'OPENED_NORMALLY_LINE',
      'OPENED_FOR_RECOVERY_LINE',
    ]) {
      expect(usesOf(CODE, name).length, `${name} is never said`).toBeGreaterThan(0)
      expect(said(CODE, name), `${name} is said some other way`).toBe(true)
    }
    expect(functionIn(CODE, 'function theRecoveryService(')).toContain('log: sayAtOnce,')
    expect(CODE).toContain('sayAtOnce(whyItDidNotStart(verdict))')
    // A line queued on stdout is the way the ready line could be lost.
    expect(
      said(CODE.replace('sayAtOnce(READY_LINE)', 'console.log(READY_LINE)'), 'READY_LINE'),
    ).toBe(false)
  })

  it('and the notice of a launch that stands down, which then exits 0: the app asked for runs', () => {
    const sole = CODE.slice(CODE.indexOf('\nvoid runAsSoleInstance({'))
    expect(sole).toContain('standDown: () => app.exit(0),')
    expect(sole).toMatch(/\n {2}log: sayAtOnce,\n\}\)/)
    expect(sole).not.toContain('console.info(message)')
  })
})

describe('the open path', () => {
  const opens = CODE.indexOf('.then(async () => {', CODE.indexOf('.whenReady()'))
  const then = CODE.slice(opens, CODE.indexOf('.catch((error: unknown) => {', opens))

  it('says it is ready last, after every step of the start, and only then lets old copies go', () => {
    const tail = then.trimEnd()
    expect(tail.endsWith('sayAtOnce(READY_LINE)\n      void letGoOfOldCopies()\n    })')).toBe(true)
    for (const step of [
      'createWindow()',
      'host = await createRuntimeHost(initDatabase())',
      'startRederive(host)',
      'startStallWatch(',
      'process.on(signal, () => lifetime.quitSignal(signal))',
    ]) {
      expect(then.indexOf(step), step).toBeGreaterThan(-1)
      expect(then.indexOf(step), step).toBeLessThan(then.indexOf('sayAtOnce(READY_LINE)'))
    }
    expect(then.match(/READY_LINE/g)).toHaveLength(1)
  })

  it('admits clearing after migrations and before the first host, once across startup retries', () => {
    const makeHost = functionIn(CODE, 'function createRuntimeHost(')
    const started = makeHost.indexOf('retention.start()')
    const checked = makeHost.indexOf('transcriptStartupWasInterrupted(store)')
    expect(started).toBeGreaterThan(-1)
    expect(checked).toBeGreaterThan(-1)
    expect(checked).toBeLessThan(started)
    expect(makeHost.indexOf('new RuntimeHost({')).toBeGreaterThan(started)
    expect(makeHost).toContain('transcriptRetention ??= new TranscriptRetentionHost(')
    expect(CODE).not.toMatch(/transcriptRetention\s*=(?!=)/)
    expect(functionIn(CODE, 'function stopWhatTheStartStarted(')).toContain(
      'await transcriptRetention?.stop()',
    )
  })

  it('lets old copies go only for the sole app, as the one-app check last answered', () => {
    expect(functionIn(CODE, 'async function letGoOfOldCopies(')).toContain(
      "theOneAppAnswer?.held() ?? 'unknown',",
    )
  })

  it('says, on a hidden launch, that it opened the data for work, once the open and migrations passed', () => {
    const init = functionIn(CODE, 'function initDatabase(')
    const said = init.indexOf('if (presentation.hidden) sayAtOnce(OPENED_NORMALLY_LINE)')
    for (const before of [
      'return openDatabase(dbPath, existing ? { fileMustExist: true } : undefined)',
      'openOrRefuse(',
      'applyMigrations(database, migrationsFolder)',
      'db = database',
    ]) {
      expect(init.indexOf(before), before).toBeGreaterThan(-1)
      expect(init.indexOf(before), before).toBeLessThan(said)
    }
    // Its last word: nothing that can refuse or fail comes after it.
    expect(init.slice(said).trim()).toBe(
      'if (presentation.hidden) sayAtOnce(OPENED_NORMALLY_LINE)\n  return database\n}',
    )
    expect(CODE.match(/OPENED_NORMALLY_LINE\)/g)).toHaveLength(1)
  })
})

/**
 * Whether the open path stops right after the check: a quit asked during it ends the start, and a
 * verdict other than `open` ends in the recovery window, both before anything reads the time zone,
 * the database or the host.
 */
function stopsBeforeTheData(code: string): boolean {
  const awaited = code.indexOf('const verdict = await theVerdictBeforeTheData(ownership)')
  const zone = code.indexOf('keepTheSystemZone(', awaited)
  if (awaited < 0 || zone < 0) return false
  return /^const verdict = await theVerdictBeforeTheData\(ownership\)\s+if \(closedWhileCheckingSaid\) return\s+if \(verdict\.kind !== 'open'\) \{\s+endInRecovery\(verdict\)\s+return\s+\}\s+const startBegan = performance\.now\(\)\s+const localZone = $/.test(
    code.slice(awaited, zone),
  )
}

function supervisorWaitsForTheData(code: string): boolean {
  // The controller owns list loading and supervisor attachment; its factory is inert.
  // Count across the entire entry, so a second/early admission or a direct bypass fails too.
  if (
    [...code.matchAll(/\bpluginController\s*\.\s*start\s*\(/g)].length !== 1 ||
    /\bpluginSupervisor\s*\.\s*start\s*\(/.test(code)
  )
    return false
  const start = functionIn(code, 'function start(ownership: HostGateVerdict): void {')
  const steps = [
    'const verdict = await theVerdictBeforeTheData(ownership)',
    'host = await createRuntimeHost(initDatabase())',
    'theDataOpened = true',
    'pluginSupervisorRoot({',
    'pluginController.start({',
  ].map((step) => start.indexOf(step))
  return steps.every((at, i) => at >= 0 && (i === 0 || at > steps[i - 1]!))
}

describe('the check stands between the start and its data', () => {
  it('stops right after the check, before the time zone, the database and the host', () => {
    expect(stopsBeforeTheData(CODE)).toBe(true)
    expect(CODE.indexOf('keepTheSystemZone(')).toBeLessThan(
      CODE.indexOf('host = await createRuntimeHost(initDatabase())'),
    )
  })

  it('admits the plugin supervisor only after the workspace data has opened', () => {
    expect(supervisorWaitsForTheData(CODE)).toBe(true)
    expect(CODE.match(/pluginController\.start\(/g)).toHaveLength(1)
    const block = CODE.match(
      / {6}try \{\s+const root = pluginSupervisorRoot\(\{[\s\S]*?\n {6}\} catch \{[\s\S]*?\n {6}\}/,
    )?.[0]
    expect(block).toBeDefined()
    if (!block) throw new Error('the supervisor startup block is missing')
    const early = CODE.replace(block, '').replace(
      '      host = await createRuntimeHost(initDatabase())',
      `${block}\n      host = await createRuntimeHost(initDatabase())`,
    )
    expect(early).not.toBe(CODE)
    expect(supervisorWaitsForTheData(early)).toBe(false)
  })

  it('refuses duplicate controller admission and a direct supervisor bypass', () => {
    for (const planted of [
      CODE.replace(
        'pluginController.start({',
        'pluginController.start({})\npluginController.start({',
      ),
      `${CODE}\npluginController.start({})`,
      CODE.replace('pluginController.start({', 'pluginSupervisor.start({'),
      `${CODE}\npluginSupervisor.start({})`,
    ]) {
      expect(planted).not.toBe(CODE)
      expect(supervisorWaitsForTheData(planted)).toBe(false)
    }
  })

  it('and the pin fails when the stop goes, the test flips, or a quit no longer stops it', () => {
    const stop = "if (verdict.kind !== 'open') {\n        endInRecovery(verdict)\n        return\n"
    expect(CODE).toContain(stop)
    for (const planted of [
      CODE.replace(stop, "if (verdict.kind !== 'open') {\n        endInRecovery(verdict)\n"),
      CODE.replace(stop, stop.replace('!==', '===')),
      CODE.replace('if (closedWhileCheckingSaid) return\n      if (verdict', 'if (verdict'),
    ]) {
      expect(planted).not.toBe(CODE)
      expect(stopsBeforeTheData(planted)).toBe(false)
    }
  })
})

describe('a start that never opened its data', () => {
  it('says so on a hidden launch, after the reason, and exits 1: at once when nothing opened', () => {
    const ended = functionIn(CODE, 'function endInRecovery(')
    expect(ended).toMatch(
      /if \(presentation\.hidden\) \{\s+if \(host === null && db === null && !saidOpenedForRecovery\) \{\s+saidOpenedForRecovery = true\s+sayAtOnce\(OPENED_FOR_RECOVERY_LINE\)\s+\}/,
    )
    expect(ended).toMatch(
      /if \(!keepTheRecoveryWindowHidden\) \{\s+startFailed = true\s+endTheProcess\(1\)\s+return\s+\}\s+\}\s+showRecovery\(verdict\)/,
    )
    expect(ended.indexOf('sayAtOnce(FAIL_LINE)')).toBeLessThan(
      ended.indexOf('sayAtOnce(OPENED_FOR_RECOVERY_LINE)'),
    )
  })

  it('says the fail line once, however many ways the start ends', () => {
    // A recovery window that could not open ends the start a second time, as a failure.
    expect(functionIn(CODE, 'function endInRecovery(')).toMatch(
      /if \(!saidItDidNotStart\) \{\s+saidItDidNotStart = true\s+sayAtOnce\(FAIL_LINE\)\s+sayAtOnce\(whyItDidNotStart\(verdict\)\)\s+\}/,
    )
    // The only other place is the quit during the check, which says it once and ends the start.
    expect(CODE.match(/sayAtOnce\(FAIL_LINE\)/g)).toHaveLength(2)
    expect(functionIn(CODE, 'function sayClosedWhileChecking(')).toContain('sayAtOnce(FAIL_LINE)')
  })

  it('says nothing more, and opens nothing, once a quit during the check has ended it', () => {
    // The fail line and the closed line are said once, by the quit; the data never opens after.
    expect(functionIn(CODE, 'function endInRecovery(')).toMatch(
      /^function endInRecovery\(verdict: StartupVerdict\): void \{\s+if \(closedWhileCheckingSaid\) return\n/,
    )
    expect(functionIn(CODE, 'async function endAFailedStart(')).toMatch(
      /^async function endAFailedStart\([^)]*\): Promise<void> \{\s+if \(closedWhileCheckingSaid\) return\n/,
    )
    expect(stopsBeforeTheData(CODE)).toBe(true)
  })

  it('closed while the check runs says the fail line and why, once, and exits 1', () => {
    expect(functionIn(CODE, 'function sayClosedWhileChecking(')).toMatch(
      /if \(closedWhileCheckingSaid\) return\s+closedWhileCheckingSaid = true\s+sayAtOnce\(FAIL_LINE\)\s+sayAtOnce\(CLOSED_WHILE_CHECKING\)/,
    )
    // Closing the window, or its own quit…
    const quit = functionIn(CODE, 'function quitFromRecovery(')
    expect(quit).toMatch(
      /if \(checkingTheData\) sayClosedWhileChecking\(\)[\s\S]*endTheProcess\(1\)/,
    )
    // …and a quit from the menu or the Dock, before any window shows.
    const start = functionIn(CODE, 'function start(ownership: HostGateVerdict): void {')
    const said = start.indexOf(
      "app.on('before-quit', () => {\n    if (checkingTheData) sayClosedWhileChecking()\n  })",
    )
    expect(said).toBeGreaterThan(-1)
    expect(said).toBeLessThan(
      start.indexOf("app.on('before-quit', (event) => lifetime.beforeQuit(event))"),
    )
    // The check is what that flag spans.
    expect(functionIn(CODE, 'async function theVerdictBeforeTheData(')).toMatch(
      /checkingTheData = true\s+try \{\s+const verdict = await service\.inspect\(\)[\s\S]*\} finally \{\s+checkingTheData = false/,
    )
  })

  it('ends a quit through the teardown with code 1, unless the data opened and the start held', () => {
    expect(CODE).toContain(
      'quit: () => (theDataOpened && !startFailed ? app.quit() : app.exit(1)),',
    )
  })

  it('never leaves its exit code to a quit: a failed start ends by app.exit(1)', () => {
    expect(CODE).not.toContain('process.exitCode')
    // At once when it opened nothing; else the teardown closes what it opened, and its last step
    // (above) is app.exit(1) for a start that failed.
    expect(functionIn(CODE, 'function endTheProcess(')).toMatch(
      /if \(host === null && db === null\) \{\s+app\.exit\(code\)\s+return\s+\}\s+app\.quit\(\)/,
    )
    // A relaunch from the recovery window leaves through the same door, so a host that started is
    // closed in its order before the new start.
    expect(functionIn(CODE, 'function relaunchIntoANormalStart(')).toMatch(
      /app\.relaunch\(\)\s+endTheProcess\(0\)/,
    )
    // The one exit 0 left is a launch that stands down for the app already running.
    expect(CODE.match(/app\.exit\(0\)/g)).toHaveLength(1)
    expect(CODE).toContain('standDown: () => app.exit(0),')
  })

  it('a start that failed once its check let it open the data ends in the recovery window too', () => {
    // A lost configured workspace exits; failures opening its data still use recovery.
    const failedStart = functionIn(CODE, 'async function endAFailedStart(')
    const recovery = failedStart.indexOf('theDataOpened = false')
    expect(failedStart.slice(0, recovery)).toMatch(
      /if \(error instanceof WorkspaceUnavailable\) \{[\s\S]*dialog\.showErrorBox[\s\S]*endTheProcess\(1\)/,
    )
    expect(failedStart.slice(recovery)).not.toContain('showErrorBox')
    const caught = CODE.slice(
      CODE.indexOf('.catch((error: unknown) => {', CODE.indexOf('.whenReady()')),
      CODE.indexOf('\nconst lifetime = createAppLifetime('),
    )
    expect(caught).toMatch(
      /^\.catch\(\(error: unknown\) => \{\s+void endAFailedStart\(error, ownership\)\s+\}\)\s+\}/,
    )
    expect(functionIn(CODE, 'async function endAFailedStart(')).toMatch(
      /theDataOpened = false\s+try \{\s+const endsOn = whatAFailedStartEndsOn\(error, ownership\)\s+void stopWhatTheStartStarted\(\)\s+endInRecovery\(await endsOn\)\s+\} catch \(failure\) \{[\s\S]*endTheProcess\(1\)/,
    )
    // What the start started stops once, in a quit's order, and a quit's teardown waits for that
    // stop instead of doing it again; the database is left to the teardown.
    expect(functionIn(CODE, 'function stopWhatTheStartStarted(')).toMatch(
      /stoppingTheStart \?\?= \(async \(\) => \{[\s\S]*\['stop its archive work', \(\) => started\.stopSweeping\(\)\],\s+\['close its conversations', \(\) => started\.closeAll\(\)\],\s+\['drain its archive work', \(\) => started\.drainArchiveWork\(\)\],/,
    )
    // The original failed-start promise is still awaited; plugins must quit even if it rejects.
    const closesSessions =
      /closeAllSessions: async \(\) => \{\s+try \{\s+await \(stoppingTheStart \?\? host\?\.closeAll\(\) \?\? Promise\.resolve\(\)\)\s+\} finally \{\s+await pluginController\.close\(\)\s+await pluginSupervisor\.quit\(\)\s+\}\s+\},/
    expect(CODE).toMatch(closesSessions)
    expect(
      closesSessions.test(
        CODE.replace(
          'await (stoppingTheStart ?? host?.closeAll() ?? Promise.resolve())',
          'await host?.closeAll()',
        ),
      ),
    ).toBe(false)
    expect(
      closesSessions.test(
        CODE.replace(
          '} finally {\n      await pluginController.close()\n      await pluginSupervisor.quit()',
          '} catch {\n      await pluginController.close()\n      await pluginSupervisor.quit()',
        ),
      ),
    ).toBe(false)
    expect(
      closesSessions.test(
        CODE.replace('} finally {\n      await pluginController.close()', '} finally {'),
      ),
    ).toBe(false)
    expect(CODE).toMatch(
      /drainArchiveWork: async \(\) => \{\s+await updates\?\.drain\(\)\s+await transcriptRetention\?\.stop\(\)\s+await \(stoppingTheStart \?\? host\?\.drainArchiveWork\(\) \?\? Promise\.resolve\(\)\)\s+await themes\?\.close\(\)\s+\}/,
    )
    // On what the failure means: a failed migration; a database the open refused, checked again
    // so a newer one is offered its copy; anything else with its own words, and a way to try again.
    const means = functionIn(CODE, 'async function whatAFailedStartEndsOn(')
    expect(means).toMatch(
      /if \(error instanceof MigrationFailed\) \{\s+return \{ kind: 'failed', reason: 'migration-failed', canRetry: true, detail: error\.message \}/,
    )
    expect(means).toMatch(
      /if \(error instanceof NewerDatabaseError \|\| error instanceof UnreadableDatabaseError\) \{\s+const again = await theVerdictBeforeTheData\(ownership\)\.catch\(\(\) => null\)\s+if \(again !== null && again\.kind !== 'open' && again\.kind !== 'working'\) return again\s+if \(error instanceof NewerDatabaseError\) \{[\s\S]*?kind: 'newer',[\s\S]*?offers: null,\s+\}\s+\}\s+return \{ kind: 'failed', reason: 'database-unreadable', canRetry: true, detail: error\.message \}/,
    )
    const otherwise = means.slice(means.lastIndexOf('return {'))
    expect(otherwise).toContain("reason: 'start-failed',")
    expect(otherwise).toContain('canRetry: true,')
    expect(otherwise).toContain('detail: error instanceof Error ? error.message : String(error),')
    // The recovery window alone: an app window that opened before the failure goes.
    const ended = functionIn(CODE, 'function endInRecovery(')
    expect(ended).toMatch(
      /showRecovery\(verdict\)\s+for \(const window of BrowserWindow\.getAllWindows\(\)\) \{\s+if \(window !== recoveryWindow\) window\.destroy\(\)\s+\}\s+\}/,
    )
    // …and its quit exits 1, since the app's own window is not this start's.
    expect(ended.indexOf('theDataOpened = false')).toBeLessThan(ended.indexOf('showRecovery('))
  })

  it('a recovery window handed over to the app’s own window quits nothing as it closes', () => {
    expect(functionIn(CODE, 'function openTheRecoveryWindow(')).toMatch(
      /onClosed: \(\) => \{\s+if \(recoveryWindow !== opened\) return\s+recoveryWindow = null\s+quitFromRecovery\(\)/,
    )
    expect(functionIn(CODE, 'function handOverToTheAppWindow(')).toMatch(
      /recoveryWindow = null[\s\S]*handed\.close\(\)/,
    )
  })

  it('brings no window forward once the start failed, from the Dock or a second launch', () => {
    expect(functionIn(CODE, 'function showThisStartsWindow(')).toMatch(
      /^function showThisStartsWindow\(\): void \{\s+if \(startFailed\) return\n/,
    )
  })
})

describe('a test fault', () => {
  it('is never taken by a packaged build', () => {
    const service = functionIn(CODE, 'function theRecoveryService(')
    const packaged = service.indexOf('if (app.isPackaged) {')
    expect(packaged).toBeGreaterThan(-1)
    expect(packaged).toBeLessThan(service.indexOf('faultsFromSwitch(asked)'))
    expect(packaged).toBeLessThan(service.indexOf('createRecoveryServiceForTests('))
    expect(CODE.match(/faultsFromSwitch\(/g)).toHaveLength(1)
  })
})

describe('a test keeping the recovery window on a hidden launch', () => {
  it('only decides what a refused hidden start does next, and asks the packaged check', () => {
    const ending = functionIn(CODE, 'function endInRecovery(')
    const hidden = ending.indexOf('if (presentation.hidden) {')
    const asked = ending.indexOf('keepsTheRecoveryWindow(')
    expect(hidden).toBeGreaterThan(-1)
    expect(asked).toBeGreaterThan(hidden)
    expect(ending).toContain('app.isPackaged,')
    expect(ending).toMatch(
      /if \(!keepTheRecoveryWindowHidden\) \{\s+startFailed = true\s+endTheProcess\(1\)/,
    )
    // The verdict is already decided: the switch is read nowhere else.
    expect(CODE.match(/keepsTheRecoveryWindow\(/g)).toHaveLength(1)
    expect(CODE.match(/KEEP_RECOVERY_WINDOW_SWITCH/g)).toHaveLength(2)
  })
})

describe('the one-app answer the check asks for', () => {
  it('is the launch’s own, asked again on a retry while it is unknown', () => {
    const service = functionIn(CODE, 'function theRecoveryService(')
    expect(service).toContain(
      'const asker = ownershipFrom(launchOwnership, () => claimSoleHost(userData))',
    )
    expect(service).toContain('ownership: asker.ask,')
  })
})

describe('the recovery window’s time zone', () => {
  const zone = process.env['TZ']
  afterEach(() => {
    if (zone === undefined) delete process.env['TZ']
    else process.env['TZ'] = zone
  })

  it('is read when asked, so the zone the open path watches is never watched twice', () => {
    expect(CODE.match(/keepTheSystemZone\(/g)).toHaveLength(1)
    expect(functionIn(CODE, 'function showRecovery(')).toContain(
      'zone: () => readTheSystemZoneNow(),',
    )
  })

  it('is the zone `TZ` names, or nothing when it cannot be read', () => {
    process.env['TZ'] = ':'
    expect(readTheSystemZoneNow()).toEqual({
      before: 0,
      changes: [],
      rule: { standard: 0, daylight: null },
    })
    process.env['TZ'] = '/not/a/zone/name'
    expect(readTheSystemZoneNow()).toBeNull()
  })
})
