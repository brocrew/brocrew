import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const standalone =
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === 'brocrew-plugin-chrome'
// The release workflow runs these guards under /bin/sh on Linux; Windows has no such shell.
const windows = process.platform === 'win32'
const scratch = []
let releaseRoot, exported
beforeAll(async () => {
  releaseRoot = root
  if (!standalone) {
    exported = mkdtempSync(join(tmpdir(), 'fictional-chrome-export-'))
    releaseRoot = join(exported, 'source')
    const { exportChromePlugin } = await import('../export-chrome-plugin.mjs')
    exportChromePlugin(releaseRoot)
  }
})
afterEach(() => {
  for (const folder of scratch.splice(0)) rmSync(folder, { recursive: true, force: true })
})
afterAll(() => {
  if (exported) rmSync(exported, { recursive: true, force: true })
})

function commands() {
  const workflow = readFileSync(join(releaseRoot, '.github/workflows/release.yml'), 'utf8')
  return {
    workflow,
    checks: [...workflow.matchAll(/^ {6}- run: (node scripts\/leak-check\.mjs[^\n]*)$/gm)].map(
      (match) => match[1],
    ),
  }
}
function attempt(overrides = {}, identity = 'Release Writer', message = 'Prepare a release') {
  const folder = mkdtempSync(join(tmpdir(), 'fictional-chrome-publication-'))
  scratch.push(folder)
  const home = join(folder, 'home'),
    repo = join(folder, 'repo')
  mkdirSync(home)
  mkdirSync(join(repo, 'scripts/leak-guard'), { recursive: true })
  cpSync(join(releaseRoot, 'scripts/leak-check.mjs'), join(repo, 'scripts/leak-check.mjs'))
  for (const file of ['allowed.txt', 'baseline.txt'])
    writeFileSync(join(repo, 'scripts/leak-guard', file), '')
  const env = {
    PATH: dirname(process.execPath) + delimiter + process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: identity,
    GIT_AUTHOR_EMAIL: 'release@fictional.invalid',
    GIT_COMMITTER_NAME: identity,
    GIT_COMMITTER_EMAIL: 'release@fictional.invalid',
    BROBOT_LEAK_PATTERNS: 'Fictional forbidden client',
    BROBOT_COMMIT_PATTERNS: 'Fictional private note',
    BROBOT_COMMIT_IDENTITIES: 'Release Writer <release@fictional.invalid>',
    ...overrides,
  }
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name]
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['commit', '-qm', message],
  ])
    execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' })
  const { checks } = commands()
  // Run the exact workflow guard commands with fail-fast shell semantics. A marker stands
  // in for the later publisher; these controls never invoke GitHub or use credentials.
  const result = spawnSync(
    '/bin/sh',
    ['-c', ['set -e', ...checks, 'printf ready > published'].join('\n')],
    {
      cwd: repo,
      env,
      encoding: 'utf8',
      timeout: 10000,
    },
  )
  return { status: result.status, published: existsSync(join(repo, 'published')) }
}

it('puts required tree and full-history identity guards before publication', () => {
  const { workflow, checks } = commands()
  expect(checks).toEqual([
    'node scripts/leak-check.mjs --require-patterns',
    'node scripts/leak-check.mjs --require-patterns --require-identities --commits HEAD',
  ])
  for (const command of checks)
    expect(workflow.indexOf(command)).toBeLessThan(workflow.indexOf('gh release upload'))
  expect(workflow).toContain('fetch-depth: 0')
  expect(workflow).toContain('BROBOT_COMMIT_PATTERNS: ${{ secrets.BROBOT_COMMIT_PATTERNS }}')
  expect(workflow).toContain('BROBOT_COMMIT_IDENTITIES: ${{ vars.BROBOT_COMMIT_IDENTITIES }}')
  expect(workflow).not.toMatch(/continue-on-error|if:\s*(?:\$\{\{\s*)?always\(/)
})
for (const variable of [
  'BROBOT_LEAK_PATTERNS',
  'BROBOT_COMMIT_PATTERNS',
  'BROBOT_COMMIT_IDENTITIES',
]) {
  it.skipIf(windows).each([undefined, '', ' \n '])(
    'refuses publication with unset/empty %s: ' + variable,
    (value) => {
      expect(attempt({ [variable]: value })).toEqual({ status: 1, published: false })
    },
  )
}
it.skipIf(windows)(
  'permits publication only with configured patterns and the allowed identity',
  () => {
    expect(attempt()).toEqual({ status: 0, published: true })
  },
)
it.skipIf(windows)('blocks an unapproved commit identity', () => {
  expect(attempt({}, 'Different Writer')).toEqual({ status: 1, published: false })
})
it.skipIf(windows)('blocks forbidden commit metadata', () => {
  expect(attempt({}, 'Release Writer', 'Fictional private note')).toEqual({
    status: 1,
    published: false,
  })
})
