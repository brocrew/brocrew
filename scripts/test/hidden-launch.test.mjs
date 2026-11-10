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

function codeLines(text) {
  return text.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
}

const IN_ARGV = /(^|[[,(])\s*HIDDEN_LAUNCH_ARG\s*[,\]]/m

const IMPORT = /import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/g

export function verdictOf(text) {
  const code = codeLines(text).join('\n')
  const imported = [...code.matchAll(IMPORT)].some((one) => /\bHIDDEN_LAUNCH_ARG\b/.test(one[0]))
  const body = code.replace(IMPORT, '')
  if (imported && IN_ARGV.test(body)) return 'hidden'
  if (/695-visible: \S/.test(text)) return 'visible'
  if (/695-own-main: \S/.test(text)) return 'own-main'
  return null
}

export function showsAWindow(text) {
  const code = codeLines(text).join('\n')
  if (/\bshow\s*:\s*true\b/.test(code)) return true
  if (/\.(?:show|showInactive|maximize|focus|moveTop)\s*\(\s*\)/.test(code)) return true
  if (/\.setFullScreen\s*\(\s*true\b/.test(code)) return true
  if (/\bopenDevTools\s*\(/.test(code)) return true
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

describe('every Electron launcher under scripts/', () => {
  it('the walk finds them — the gates, the three live smokes and the probes', () => {
    const names = LAUNCHERS.map((one) => one.name)
    for (const known of [
      'window-opens-check.mjs',
      'app-closes-check.mjs',
      'ui-live-smoke.mjs',
      'resume-live-smoke.mjs',
      'packaged-smoke.mjs',
      'windows-packaged-check.mjs',
      'macos-packaged-check.mjs',
      'window-controls-probe.mjs',
      'one-app-probe.mjs',
    ]) {
      expect(names, `${known} was not found — the search shape is broken`).toContain(known)
    }
    expect(LAUNCHERS.length).toBeGreaterThanOrEqual(12)
  })

  it('every one passes the switch or says why it does not', () => {
    const silent = LAUNCHERS.filter((one) => one.verdict === null).map((one) => one.name)
    expect(silent, 'a launcher puts a window on a person’s screen and says nothing').toEqual([])
  })

  it('the gates and the live smokes are hidden — the launches that run most', () => {
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

  it('the exemptions, by name — a new one is a decision, not a marker', () => {
    const by = (verdict) =>
      LAUNCHERS.filter((one) => one.verdict === verdict)
        .map((one) => one.name)
        .sort()
    expect(by('visible')).toEqual([
      'lane-geometry-probe.mjs',
      'lib/mac-update-test.mjs',
      'mac-signed-upgrade-contract.mjs',
      'upgrade-path.mjs',
      'window-controls-probe.mjs',
    ])
    expect(by('own-main')).toEqual([
      'drop-hazard-probe.mjs',
      'nav-order-probe.mjs',
      'one-app-probe.mjs',
    ])
  })

  it('a launcher on a main of its own shows no window either', () => {
    const ownMain = LAUNCHERS.filter((one) => one.verdict === 'own-main')
    expect(ownMain.length).toBeGreaterThanOrEqual(3)
    const shown = ownMain
      .filter((one) => showsAWindow(readFileSync(join(SCRIPTS, one.name), 'utf8')))
      .map((one) => one.name)
    expect(shown, 'an own-main probe puts a window on a person’s screen').toEqual([])
  })

  it('…and that clause can fail (rule 12): each way to show a window, and the ways not to', () => {
    const made = 'const win = new BrowserWindow({ width: 800, show: false })'
    expect(showsAWindow(made)).toBe(false)
    expect(showsAWindow(made.replace('show: false', 'show: true'))).toBe(true)
    expect(showsAWindow(made.replace(', show: false', ''))).toBe(true)
    expect(showsAWindow(`${made}\nwin.show()`)).toBe(true)
    expect(showsAWindow(`${made}\nwin.showInactive()`)).toBe(true)
    expect(showsAWindow(`${made}\nconst two = new BrowserWindow({ width: 1 })`)).toBe(true)
    expect(showsAWindow(`${made}\n// it used to be show: true`)).toBe(false)
    expect(showsAWindow('const MAIN = `\n  new BrowserWindow({\n    show: true,\n  })\n`')).toBe(
      true,
    )
    for (const shows of [
      'win.maximize()',
      'win.focus()',
      'win.moveTop()',
      'win.setFullScreen(true)',
      "win.webContents.openDevTools({ mode: 'detach' })",
    ]) {
      expect(showsAWindow(`${made}\n${shows}`), shows).toBe(true)
    }
    expect(showsAWindow('const w = new electron.BrowserWindow({ width: 1 })')).toBe(true)
    expect(showsAWindow('const w = new BrowserWindow(options)')).toBe(true)
    expect(
      showsAWindow('new BrowserWindow({ webPreferences: { sandbox: true }, show: false })'),
    ).toBe(false)
    expect(showsAWindow('new BrowserWindow({ webPreferences: { sandbox: true }, width: 1 })')).toBe(
      true,
    )
  })

  it('the census can fail — two planted launchers, one silent and one marked (rule 12)', () => {
    const silent = "spawn(ELECTRON, [`--user-data-dir=${dir}`, '.']) // node_modules/.bin/electron"
    const marked = `${silent}\n// 695-visible: it measures the frame`
    const passing = [
      "import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'",
      "spawn(ELECTRON, [HIDDEN_LAUNCH_ARG, '.']) // node_modules/.bin/electron",
    ].join('\n')
    const importedOnly = "import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'\n" + silent
    const mentionedOnly = `${importedOnly}\nthrow new Error(\`pass \${HIDDEN_LAUNCH_ARG}, or it shows\`)`
    expect(verdictOf(silent)).toBeNull()
    expect(verdictOf(mentionedOnly)).toBeNull()
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
    expect(verdictOf(importedOnly)).toBeNull()
    expect(verdictOf(`${silent}\n// 695-visible:`)).toBeNull()
  })
})

describe('the Electron binary on install', () => {
  const desktop = JSON.parse(readFileSync(join(ROOT, 'apps', 'desktop', 'package.json'), 'utf8'))
  const require = createRequire(join(ROOT, 'apps', 'desktop', 'package.json'))
  const electron = JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8'))

  it('premise: the pinned Electron has no install script, and ships the bin that installs it', () => {
    expect(electron.scripts?.postinstall).toBeUndefined()
    expect(electron.scripts?.install).toBeUndefined()
    expect(electron.bin?.['install-electron']).toBe('install.js')
  })

  it('the desktop package runs it on every install — and honours Electron’s own skip', () => {
    expect(desktop.scripts?.postinstall).toBe('node ../../scripts/install-electron.mjs')
    const script = readFileSync(join(ROOT, 'scripts', 'install-electron.mjs'), 'utf8')
    expect(script).toContain('if (!process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {')
    expect(script).toContain("require.resolve('electron/install.js')")
    const skipped = spawnSync(process.execPath, [join(ROOT, 'scripts', 'install-electron.mjs')], {
      cwd: tmpdir(),
      env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
      encoding: 'utf8',
    })
    expect(skipped.status).toBe(0)
  })
})

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

describe('the README launches an app hidden', () => {
  const readme = readFileSync(join(ROOT, 'docs', 'development.md'), 'utf8')

  it('it has a launch recipe to read — deleting the recipe is not a pass', () => {
    expect(readmeLaunches(readme).length).toBeGreaterThanOrEqual(1)
  })

  it('no launch line names :9222 or :9444, and each is hidden on its own user data', () => {
    expect(readmeLaunchFaults(readme)).toEqual([])
  })

  it('the clause can fail (rule 12): the old recipe, and a hidden one on the person’s port', () => {
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
    expect(readmeLaunches(onProtectedPort)).toHaveLength(1)
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
    expect(readmeLaunches('```\npnpm run ci\npnpm install\n```\n')).toEqual([])
  })
})
