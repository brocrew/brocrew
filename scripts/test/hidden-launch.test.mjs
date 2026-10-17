import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HIDDEN_LAUNCH_ARG } from '../lib/hidden-launch.mjs'
import { FORBIDDEN_DEFAULT_PORT, FORBIDDEN_PERSON_PORT } from '../lib/smoke-target.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const SCRIPTS = join(ROOT, 'scripts')

/**
 * Check the five launch shapes the census recognizes: electron-vite argv, the Electron binary, a
 * packaged Mac binary, BroBot.exe and an own-main Electron process. Each must carry the
 * hidden-launch flag or an explicit scanner exemption. An own-main exemption also requires a window
 * created with show:false and no code that shows it, including embedded template bodies. The census
 * cannot recognize every constructed path or launcher, so positive controls pin its known shapes.
 */

// A packaged app's program is named by its literal path, or, where a launcher reads the app's name
// from the build, by the parts of a bundle's path.
const LAUNCH =
  /node_modules\/\.bin\/electron|'electron-vite',|MacOS\/BroCrew\b|'BroCrew\.exe'|'Contents',\s*'MacOS'|require\('electron'\)/

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === 'test' || name === 'mutations' || name === 'node_modules' ? [] : walk(path)
    }
    return /\.(mjs|js|cjs)$/.test(name) ? [path] : []
  })
}

/** Lines that are code — a marker is prose and is read separately; a use must be code. */
function codeLines(text) {
  return text.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
}

/**
 * ⚑ **The switch as an ARGV ELEMENT** — at the start of a line or after `[`, `,` or `(`, and followed
 * by `,` or `]`. ⛔ Not merely named: `ui-live-smoke.mjs` also quotes it in a failure message
 * (`` `pass ${HIDDEN_LAUNCH_ARG}` ``), and a census that counted mentions would call that launcher
 * hidden with the argument gone from its argv — found by this dispatch's own mutation rows.
 */
const IN_ARGV = /(^|[[,(])\s*HIDDEN_LAUNCH_ARG\s*[,\]]/m

/** An `import { … } from '…'` statement, one line or many. */
const IMPORT = /import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/g

/** ⚑ What this launcher does about the switch — or `null`, which is the failure. */
export function verdictOf(text) {
  const code = codeLines(text).join('\n')
  const imported = [...code.matchAll(IMPORT)].some((one) => /\bHIDDEN_LAUNCH_ARG\b/.test(one[0]))
  // ⛔ **The imports are REMOVED before the argv is looked for.** A multi-line import puts
  // `  HIDDEN_LAUNCH_ARG,` on a line of its own — exactly an argv element's shape — so the first
  // version of this census called `ui-live-smoke.mjs` hidden with the switch gone from its argv.
  // Found by this dispatch's adversarial review and confirmed by its row M37 SURVIVING.
  const body = code.replace(IMPORT, '')
  // ⚑ Imported AND passed: an import alone, or a mention in a message, would pass while every argv
  // went without it.
  if (imported && IN_ARGV.test(body)) return 'hidden'
  if (/695-visible: \S/.test(text)) return 'visible'
  if (/695-own-main: \S/.test(text)) return 'own-main'
  return null
}

/**
 * An own-main exemption is valid only when the test creates its window with show:false and never
 * shows it. Inspect embedded main-script templates too; an isolated data folder alone does not make
 * a visible test page safe.
 */
export function showsAWindow(text) {
  const code = codeLines(text).join('\n')
  if (/\bshow\s*:\s*true\b/.test(code)) return true
  // ⚑ Every call that puts a window on screen, not only `show()` — Electron also shows one on
  // `maximize`, `focus`, `moveTop` and `setFullScreen(true)`, and a DevTools window is a window too.
  if (/\.(?:show|showInactive|maximize|focus|moveTop)\s*\(\s*\)/.test(code)) return true
  if (/\.setFullScreen\s*\(\s*true\b/.test(code)) return true
  if (/\bopenDevTools\s*\(/.test(code)) return true
  // ⚑ A window whose options never say `show: false` is shown by Electron's own default — read to
  // the literal's own closing brace, and ⛔ options that are not a literal HERE cannot be read, so
  // they count as shown.
  return [...code.matchAll(/new\s+(?:[\w$]+\.)?BrowserWindow\s*\(/g)].some((one) => {
    const rest = code.slice(one.index + one[0].length)
    if (!/^\s*\{/.test(rest)) return true
    let depth = 0
    for (let at = rest.indexOf('{'); at < rest.length; at += 1) {
      if (rest[at] === '{') depth += 1
      if (rest[at] === '}') depth -= 1
      if (depth === 0) return !/\bshow\s*:\s*false\b/.test(rest.slice(0, at + 1))
    }
    return true
  })
}

const LAUNCHERS = walk(SCRIPTS)
  .filter((path) => LAUNCH.test(readFileSync(path, 'utf8')))
  .map((path) => ({
    name: relative(SCRIPTS, path).replaceAll('\\', '/'),
    verdict: verdictOf(readFileSync(path, 'utf8')),
  }))

describe('695 §1 · every Electron launcher under scripts/', () => {
  it('⚑ the walk finds them — the gates, the three live smokes and the probes', () => {
    const names = LAUNCHERS.map((one) => one.name)
    for (const known of [
      'window-opens-check.mjs',
      'app-closes-check.mjs',
      'ui-live-smoke.mjs',
      'resume-live-smoke.mjs',
      'packaged-smoke.mjs',
      // ⚑ W4.90 — the Windows build's check launches the packaged app to find its data folder.
      'windows-packaged-check.mjs',
      // ⚑ W4.96 — and the Mac build's check launches it to see it start.
      'macos-packaged-check.mjs',
      'window-controls-probe.mjs',
      'one-app-probe.mjs',
    ]) {
      expect(names, `${known} was not found — the search shape is broken`).toContain(known)
    }
    // ⚑ D-016 deleted four: the fixture check and the three project probes.
    expect(LAUNCHERS.length).toBeGreaterThanOrEqual(12)
  })

  it('⛔ every one passes the switch or says why it does not', () => {
    const silent = LAUNCHERS.filter((one) => one.verdict === null).map((one) => one.name)
    expect(silent, 'a launcher puts a window on a person’s screen and says nothing').toEqual([])
  })

  it('🔴 the gates and the live smokes are hidden — the launches that run most', () => {
    const hidden = new Set(
      LAUNCHERS.filter((one) => one.verdict === 'hidden').map((one) => one.name),
    )
    for (const name of [
      'window-opens-check.mjs',
      'app-closes-check.mjs',
      'ui-live-smoke.mjs',
      'resume-live-smoke.mjs',
      'packaged-smoke.mjs',
    ]) {
      expect(hidden.has(name), `${name} does not pass ${HIDDEN_LAUNCH_ARG}`).toBe(true)
    }
  })

  it('⚠️ the exemptions, by name — a new one is a decision, not a marker', () => {
    const by = (verdict) =>
      LAUNCHERS.filter((one) => one.verdict === verdict)
        .map((one) => one.name)
        .sort()
    expect(by('visible')).toEqual([
      'lane-geometry-probe.mjs',
      'lib/mac-update-test.mjs',
      'upgrade-path.mjs',
      'window-controls-probe.mjs',
    ])
    expect(by('own-main')).toEqual([
      'drop-hazard-probe.mjs',
      'nav-order-probe.mjs',
      'one-app-probe.mjs',
    ])
  })

  it('🔴 697 · F-a: a launcher on a main of its own shows no window either', () => {
    const ownMain = LAUNCHERS.filter((one) => one.verdict === 'own-main')
    expect(ownMain.length).toBeGreaterThanOrEqual(3)
    const shown = ownMain
      .filter((one) => showsAWindow(readFileSync(join(SCRIPTS, one.name), 'utf8')))
      .map((one) => one.name)
    expect(shown, 'an own-main probe puts a window on a person’s screen').toEqual([])
  })

  it('⚑ …and that clause can fail (rule 12): each way to show a window, and the ways not to', () => {
    const made = 'const win = new BrowserWindow({ width: 800, show: false })'
    expect(showsAWindow(made)).toBe(false)
    expect(showsAWindow(made.replace('show: false', 'show: true'))).toBe(true)
    // ⛔ Silence is Electron's default, and its default is to show.
    expect(showsAWindow(made.replace(', show: false', ''))).toBe(true)
    expect(showsAWindow(`${made}\nwin.show()`)).toBe(true)
    expect(showsAWindow(`${made}\nwin.showInactive()`)).toBe(true)
    // ⚑ Two windows, the SECOND one shown by default — the first's `show: false` does not cover it.
    expect(showsAWindow(`${made}\nconst two = new BrowserWindow({ width: 1 })`)).toBe(true)
    // ⚑ Prose is not code: a comment that says `show: true` shows nothing.
    expect(showsAWindow(`${made}\n// it used to be show: true`)).toBe(false)
    // ⚑ A main written as a template literal is code — the shape both probes use.
    expect(showsAWindow('const MAIN = `\n  new BrowserWindow({\n    show: true,\n  })\n`')).toBe(
      true,
    )
    // ⚑ 697's review: the other ways onto a screen, each alone beside a hidden window.
    for (const shows of [
      'win.maximize()',
      'win.focus()',
      'win.moveTop()',
      'win.setFullScreen(true)',
      "win.webContents.openDevTools({ mode: 'detach' })",
    ]) {
      expect(showsAWindow(`${made}\n${shows}`), shows).toBe(true)
    }
    // ⚑ …a constructor spelled through its module, and options this census cannot read.
    expect(showsAWindow('const w = new electron.BrowserWindow({ width: 1 })')).toBe(true)
    expect(showsAWindow('const w = new BrowserWindow(options)')).toBe(true)
    // ⚑ …and a nested object inside the options: its `})` is not the literal's end.
    expect(
      showsAWindow('new BrowserWindow({ webPreferences: { sandbox: true }, show: false })'),
    ).toBe(false)
    expect(showsAWindow('new BrowserWindow({ webPreferences: { sandbox: true }, width: 1 })')).toBe(
      true,
    )
  })

  it('⚑ the census can fail — two planted launchers, one silent and one marked (rule 12)', () => {
    const silent = "spawn(ELECTRON, [`--user-data-dir=${dir}`, '.']) // node_modules/.bin/electron"
    const marked = `${silent}\n// 695-visible: it measures the frame`
    const passing = [
      "import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'",
      "spawn(ELECTRON, [HIDDEN_LAUNCH_ARG, '.']) // node_modules/.bin/electron",
    ].join('\n')
    const importedOnly = "import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'\n" + silent
    const mentionedOnly = `${importedOnly}\nthrow new Error(\`pass \${HIDDEN_LAUNCH_ARG}, or it shows\`)`
    expect(verdictOf(silent)).toBeNull()
    // ⛔ Named in a message and never passed is not hidden either.
    expect(verdictOf(mentionedOnly)).toBeNull()
    // ⛔ …and a MULTI-LINE import is not an argv: its own line reads `  HIDDEN_LAUNCH_ARG,`.
    const multiLineImport = [
      'import {',
      '  HIDDEN_LAUNCH_ARG,',
      '  HIDDEN_TITLE,',
      "} from './lib/hidden-launch.mjs'",
      silent,
    ].join('\n')
    expect(verdictOf(multiLineImport)).toBeNull()
    expect(verdictOf(`${multiLineImport}\nspawn(ELECTRON, [\n  HIDDEN_LAUNCH_ARG,\n])`)).toBe(
      'hidden',
    )
    expect(verdictOf(marked)).toBe('visible')
    expect(verdictOf(passing)).toBe('hidden')
    // ⛔ Imported and never passed is not hidden.
    expect(verdictOf(importedOnly)).toBeNull()
    // ⛔ A marker with no reason is not a marker.
    expect(verdictOf(`${silent}\n// 695-visible:`)).toBeNull()
  })
})

/**
 * 🔴 **695 §3.2 · F15 — a fresh worktree gets its Electron binary on `pnpm install`.**
 *
 * ⛔ **680's diagnosis was wrong, and this is the corrected one**: `pnpm` skips nothing. Electron
 * 43 has NO install script — it downloads lazily, on the first `require('electron')` — and
 * `electron-vite` reads `path.txt` itself and throws `Electron uninstall` instead of triggering that.
 * So `onlyBuiltDependencies: [electron]` allows a script that does not exist. ⚑ The repair is the
 * desktop package's own `postinstall`, running Electron's `install.js` through its `install-electron`
 * bin — measured on 695: a fresh worktree went from no `path.txt` to `Electron.app/…` on one
 * `pnpm install --frozen-lockfile`, and a second install was a no-op. No lockfile line moved.
 */
describe('695 §3.2 · F15 — the Electron binary on install', () => {
  const desktop = JSON.parse(readFileSync(join(ROOT, 'apps', 'desktop', 'package.json'), 'utf8'))
  const require = createRequire(join(ROOT, 'apps', 'desktop', 'package.json'))
  const electron = JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8'))

  it('premise: the pinned Electron has no install script, and ships the bin that installs it', () => {
    // ⚑ If a later Electron regains its postinstall, this goes red and the line below is redundant.
    expect(electron.scripts?.postinstall).toBeUndefined()
    expect(electron.scripts?.install).toBeUndefined()
    expect(electron.bin?.['install-electron']).toBe('install.js')
  })

  it('the desktop package runs it on every install — and honours Electron’s own skip', () => {
    // ⚑ `ELECTRON_SKIP_BINARY_DOWNLOAD` is Electron's convention for an install that must not
    // download (offline, a cold cache, a CI step that brings its own binary). ⚑ F072 — a Node
    // script, so the install also runs under Windows' cmd.
    expect(desktop.scripts?.postinstall).toBe('node ../../scripts/install-electron.mjs')
    const script = readFileSync(join(ROOT, 'scripts', 'install-electron.mjs'), 'utf8')
    expect(script).toContain('if (!process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {')
    expect(script).toContain("require.resolve('electron/install.js')")
    // ⚑ …and with the skip set it runs nothing, measured: no install.js to resolve from here.
    const skipped = spawnSync(process.execPath, [join(ROOT, 'scripts', 'install-electron.mjs')], {
      cwd: tmpdir(),
      env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
      encoding: 'utf8',
    })
    expect(skipped.status).toBe(0)
  })
})

/**
 * 🔴 **697 · 695 F-h — the README's recipe is the hidden launch, and names no forbidden port.**
 *
 * ⛔ It told a reader to run `pnpm dev --remoteDebuggingPort 9222` in one terminal and `smoke:ui` in
 * another — stale three ways: `:9222` is refused (`lib/smoke-target.mjs`), `smoke:ui` launches its
 * own app, and that recipe put a visible window up. ⚑ Every fenced launch line — a continuation
 * joined to its line, and a launch recognised by what it runs — names neither forbidden port, and
 * gives the app its own `--user-data-dir` and {@link HIDDEN_LAUNCH_ARG} after the `--`. ⚠️ A launch
 * written outside a fence (the scripts table's `pnpm dev`, a person's launch) is not read.
 */
/**
 * ⚑ **A launch is recognised by what it RUNS** (697's review) — `electron-vite` in any mode, an
 * `electron <dir>`, a package manager running `dev`/`preview`/`start` for the root or the desktop
 * package, or a line naming a debugging port.
 */
const README_LAUNCH =
  /\belectron-vite\b|\belectron\s+\S|\b(?:pnpm|npm|yarn)\b[^\n]*\b(?:dev|preview|start)\b|remoteDebuggingPort|remote-debugging-port/

export function readmeLaunches(markdown) {
  const fenced = [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((one) => one[1])
  return fenced
    .flatMap((block) => block.replace(/\s*\\\n\s*/g, ' ').split('\n'))
    .filter((line) => README_LAUNCH.test(line))
}

export function readmeLaunchFaults(markdown) {
  return readmeLaunches(markdown).flatMap((line) => {
    const faults = []
    for (const port of [FORBIDDEN_DEFAULT_PORT, FORBIDDEN_PERSON_PORT]) {
      if (new RegExp(`\\b${port}\\b`).test(line)) faults.push(`names :${port} — ${line.trim()}`)
    }
    const after = line.split(' -- ')[1] ?? ''
    if (!/--user-data-dir=/.test(after))
      faults.push(`no --user-data-dir of its own — ${line.trim()}`)
    if (!after.split(/\s+/).includes(HIDDEN_LAUNCH_ARG)) faults.push(`not hidden — ${line.trim()}`)
    return faults
  })
}

describe('697 · 695 F-h — the README launches a seat’s app hidden', () => {
  // ⚑ The developer guide, which the README was until the public README took its place.
  const readme = readFileSync(join(ROOT, 'docs', 'development.md'), 'utf8')

  it('⚑ it has a launch recipe to read — deleting the recipe is not a pass', () => {
    expect(readmeLaunches(readme).length).toBeGreaterThanOrEqual(1)
  })

  it('⛔ no launch line names :9222 or :9444, and each is hidden on its own user data', () => {
    expect(readmeLaunchFaults(readme)).toEqual([])
  })

  it('⚑ the clause can fail (rule 12): the old recipe, and a hidden one on the person’s port', () => {
    const old = '```\n# terminal A\npnpm dev --remoteDebuggingPort 9222\n```\n'
    expect(readmeLaunchFaults(old)).toEqual([
      'names :9222 — pnpm dev --remoteDebuggingPort 9222',
      'no --user-data-dir of its own — pnpm dev --remoteDebuggingPort 9222',
      'not hidden — pnpm dev --remoteDebuggingPort 9222',
    ])
    const onProtectedPort =
      '```\nelectron-vite dev --remoteDebuggingPort 9444 \\\n  -- --user-data-dir=/tmp/x --brobot-hidden\n```\n'
    expect(readmeLaunchFaults(onProtectedPort)).toEqual([
      'names :9444 — electron-vite dev --remoteDebuggingPort 9444 -- --user-data-dir=/tmp/x --brobot-hidden',
    ])
    // ⚑ A continuation is joined before it is read: the switch on the next line still counts.
    expect(readmeLaunches(onProtectedPort)).toHaveLength(1)
    // ⚑ 697's review: every shape that starts the app is a launch, and each is held to the rule.
    for (const visible of [
      'pnpm --filter @brobot2/desktop dev',
      'pnpm --filter @brobot2/desktop exec electron-vite preview',
      'npx electron .',
      'npm run dev',
    ]) {
      expect(readmeLaunchFaults(`\`\`\`\n${visible}\n\`\`\`\n`), visible).toContain(
        `not hidden — ${visible}`,
      )
    }
    // ⚑ …and a fence that launches nothing is not read as one.
    expect(readmeLaunches('```\npnpm run ci\npnpm install\n```\n')).toEqual([])
  })
})
