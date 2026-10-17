import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RESTORE_RULES } from '../../src/main/recovery/contract'
import { DATABASE_FILE, familyOf, isSafeName } from '../../src/main/recovery/layout'
import { APP_STATE_FILES, NOT_STATE } from '../../src/main/recovery/state-files'

/**
 * Every name the app joins to its data folder must be declared in `state-files.ts`, either as
 * state a checkpoint copies or as something else with a reason. A new file written there fails
 * this test until someone decides whether a restore should bring it back.
 *
 * It reads the source the way the clean-base census does (`scripts/test/clean-base-without-
 * running-it.test.mjs`): the same trees and the same `join(userData, …)` shapes, with comments
 * removed. A constant joined to the folder is read as the name it holds, and a name it cannot
 * resolve fails it.
 *
 * What it cannot see: the data folder under another name (`const root = app.getPath('userData')`
 * then `join(root, …)`), a path made with `resolve`, a template or `+`, and a path built in one
 * place and written in another. A name written that way passes unseen; the last test plants each
 * shape to show it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const REPO = join(here, '../../../..')
const ROOTS = [
  'apps/desktop/src/main',
  'apps/desktop/src/preload',
  'apps/desktop/src/shared',
  'packages/runtime/src',
  'packages/shared/src',
  'packages/orchestration/src',
]

/** The one join whose name comes from the registry itself: `stateFile` in `layout.ts`. */
const FROM_THE_REGISTRY = {
  file: 'apps/desktop/src/main/recovery/layout.ts',
  expression: 'segment(file.name)',
}

const JOINED_TO_THE_DATA_FOLDER =
  /join\(\s*(?:(?:\w+\.)?(?:userData|userDataPath)|app\.getPath\('userData'\))\s*,\s*((?:[^()]|\([^()]*\))+?)\s*\)/g

interface Site {
  readonly file: string
  readonly expression: string
}

function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    .join('\n')
}

function productionSources(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = []
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(REPO, relative), { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(next)
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        out.push({ file: next, code: codeOf(readFileSync(join(REPO, next), 'utf8')) })
      }
    }
  }
  for (const root of ROOTS) walk(root)
  return out
}

/** An argument list's first argument: up to the first comma outside brackets and quotes. */
function firstArgument(list: string): string {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < list.length; i += 1) {
    const char = list[i]
    if (quote !== null) {
      if (char === '\\') i += 1
      else if (char === quote) quote = null
    } else if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1
    else if (char === ',' && depth === 0) return list.slice(0, i).trim()
  }
  return list.trim()
}

function sitesIn(file: string, code: string): Site[] {
  return [...code.matchAll(JOINED_TO_THE_DATA_FOLDER)].map((match) => ({
    file,
    expression: firstArgument(match[1] ?? ''),
  }))
}

/** Every `const NAME = '…'` in the sources, by name; a name declared twice keeps every value. */
function constantsIn(sources: readonly { code: string }[]): Map<string, Set<string>> {
  const constants = new Map<string, Set<string>>()
  for (const { code } of sources) {
    for (const match of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2/g)) {
      const [, name = '', , value = ''] = match
      constants.set(name, (constants.get(name) ?? new Set()).add(value))
    }
  }
  return constants
}

/** The top-level name a site joins: a literal, a template with `*` for each hole, or a constant's. */
function nameAt(site: Site, constants: ReadonlyMap<string, ReadonlySet<string>>): string | null {
  const { expression } = site
  const quoted = /^(['"])([^'"]*)\1$/.exec(expression)
  if (quoted) return quoted[2] ?? null
  const template = /^`([^`]*)`$/.exec(expression)
  if (template) return (template[1] ?? '').replace(/\$\{[^}]*\}/g, '*')
  if (/^[A-Za-z_$][\w$]*$/.test(expression)) {
    const values = constants.get(expression)
    return values?.size === 1 ? ([...values][0] ?? null) : null
  }
  return null
}

const isTheRegistrysOwn = (site: Site): boolean =>
  site.file === FROM_THE_REGISTRY.file && site.expression === FROM_THE_REGISTRY.expression

function declared(name: string): boolean {
  if (APP_STATE_FILES.some((file) => file.name === name)) return true
  return NOT_STATE.some((entry) => {
    if (entry.name === name) return true
    if (!entry.name.includes('*')) return false
    const pattern = entry.name
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    return new RegExp(`^${pattern}$`).test(name)
  })
}

/** Each site the registry does not cover, said so a failure names the file and the expression. */
function undeclaredIn(sources: readonly { file: string; code: string }[]): string[] {
  const constants = constantsIn(sources)
  const problems: string[] = []
  for (const { file, code } of sources) {
    for (const site of sitesIn(file, code)) {
      if (isTheRegistrysOwn(site)) continue
      const name = nameAt(site, constants)
      if (name === null) problems.push(`${file}: cannot tell which name ${site.expression} is`)
      else if (!declared(name))
        problems.push(`${file}: ${name} is neither state nor declared not state`)
    }
  }
  return problems
}

describe('every name the app writes in its data folder is declared', () => {
  const sources = productionSources()

  it('reads the app’s sources, and finds the names it already knows there', () => {
    expect(sources.length).toBeGreaterThan(50)
    const constants = constantsIn(sources)
    const names = new Set(
      sources.flatMap(({ file, code }) =>
        sitesIn(file, code).map((site) => nameAt(site, constants)),
      ),
    )
    for (const known of [
      DATABASE_FILE,
      'drafts.json',
      'sign-in-changes.json',
      'provider-usage.json',
      'one-host.sock',
      'resources',
      'backups',
      'recovery',
      '.oh-*',
    ]) {
      expect(names, known).toContain(known)
    }
  })

  it('finds each one in the registry, as state or as not state', () => {
    expect(undeclaredIn(sources)).toEqual([])
  })

  it('still finds the one join the registry drives, so its exemption excuses nothing else', () => {
    const own = sources.flatMap(({ file, code }) => sitesIn(file, code)).filter(isTheRegistrysOwn)
    expect(own).toHaveLength(1)
  })

  it('fails on a new name, joined directly, through a constant, a field or a template', () => {
    const planted = [
      "const NEW_STATE_FILE = 'new-state.json'",
      "const a = join(userData, 'workflow-defaults.json')",
      'const b = join(where.userData, NEW_STATE_FILE, "inside")',
      "const c = join(app.getPath('userData'), `cache-${name}.bin`)",
      'const d = join(userData, somewhere())',
      "// const e = join(userData, 'only-in-a-comment.json')",
      "const f = join(userData, 'drafts.json')",
    ].join('\n')
    expect(undeclaredIn([{ file: 'planted.ts', code: codeOf(planted) }])).toEqual([
      'planted.ts: workflow-defaults.json is neither state nor declared not state',
      'planted.ts: new-state.json is neither state nor declared not state',
      'planted.ts: cache-*.bin is neither state nor declared not state',
      'planted.ts: cannot tell which name somewhere() is',
    ])
  })

  it('does not see the data folder under another name, or a path not made with join', () => {
    const planted = [
      "const root = app.getPath('userData')",
      "const a = join(root, 'aliased-state.json')",
      "const b = resolve(userData, 'resolved-state.json')",
      'const c = `${userData}/templated-state.json`',
      "const d = userData + '/added-state.json'",
    ].join('\n')
    const code = codeOf(planted)
    expect(sitesIn('planted.ts', code), 'none of these is a site it reads').toEqual([])
    expect(undeclaredIn([{ file: 'planted.ts', code }])).toEqual([])
  })
})

describe('the registry', () => {
  const every = [...APP_STATE_FILES, ...NOT_STATE]

  it('names each thing once, with a reason', () => {
    const names = every.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
    for (const entry of every) expect(entry.why.trim().length, entry.name).toBeGreaterThan(10)
  })

  it('gives each state file a restore rule and a name that is one plain file name', () => {
    for (const file of APP_STATE_FILES) {
      expect(RESTORE_RULES, file.name).toContain(file.restore)
      expect(isSafeName(file.name), file.name).toBe(true)
    }
    expect(APP_STATE_FILES.find((file) => file.name === 'drafts.json')?.restore).toBe(
      'with-the-database',
    )
  })

  it('keeps the database and its sidecars out of the state files', () => {
    for (const member of familyOf(DATABASE_FILE)) expect(declared(member), member).toBe(true)
    for (const member of familyOf(DATABASE_FILE)) {
      expect(APP_STATE_FILES.some((file) => file.name === member)).toBe(false)
    }
  })
})
