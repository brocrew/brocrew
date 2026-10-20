/**
 * ⚑ **Writes the generated part of `apps/desktop/THIRD-PARTY-NOTICES.md`**: the versions of what
 * the app bundles, and every npm package the app's archive carries, by license, with the copyright
 * lines of each package's own license file.
 *
 * ## ⚑ Which packages, and why not `pnpm licenses`
 *
 * The packaged app carries `apps/desktop`'s `dependencies` and `optionalDependencies`, theirs, and
 * so on — the workspace packages' included — and NOT their peer dependencies. `pnpm licenses list
 * --prod` follows peers too, and named twelve packages no build carries (`typescript`, `@types/*`,
 * `@anthropic-ai/sdk`, …). So this walks the dependencies itself, resolving each the way Node does
 * from the package that needs it. ⚠️ Checked against a packaged macOS build: the same 141 packages.
 *
 * Not listed here: the workspace's own packages (`@brobot2/*`, Apache-2.0 with the app), the Claude
 * Agent SDK and the Codex packages, which the hand-written sections cover, and the SDK's platform
 * packages, each a whole Claude Code binary, which `electron-builder.yml` keeps out of the app. A
 * platform package this machine did not install is not found, which is right: they are all among
 * those.
 *
 * `node scripts/third-party-notices.mjs` rewrites the generated part in place; `--check` exits 1,
 * changing nothing, when it is out of date.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NODE_VERSION } from './prepare-plugin-node.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESKTOP = join(ROOT, 'apps', 'desktop')
export const NOTICES = join(DESKTOP, 'THIRD-PARTY-NOTICES.md')
export const BEGIN = '<!-- BEGIN GENERATED: node scripts/third-party-notices.mjs -->'
export const END = '<!-- END GENERATED -->'

/** The packages the hand-written sections cover, and the SDK's platform packages the app leaves out. */
const COVERED_BY_HAND = [
  /^@brobot2\//,
  /^@anthropic-ai\/claude-agent-sdk(?:-[\w-]+)?$/,
  /^@openai\/codex(?:-[\w-]+)?$/,
]

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** Where `name` resolves from the package at `from`, Node's way: the nearest `node_modules`. */
function resolveFrom(from, name) {
  let dir = from
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    const up = dirname(dir)
    if (up === dir || dir === parse(dir).root) return null
    dir = up
  }
}

/** The license a package declares in its `package.json`. */
function declaredLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type
  if (Array.isArray(pkg.licenses)) {
    return pkg.licenses.map((one) => (typeof one === 'string' ? one : one.type)).join(' OR ')
  }
  return 'not declared'
}

/** A package's own license file, by name, or `null`. */
function licenseFileOf(dir) {
  const found = readdirSync(dir)
    .filter((name) => /^(?:licen[cs]e|copying)(?:[.-].*)?$/i.test(name))
    .sort()
  return found[0] ?? null
}

/** The copyright lines of a license file, at most three, each once. */
function copyrightLines(text) {
  const lines = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, ' ')
    if (!/^(?:copyright\b|\(c\)|©)/i.test(line)) continue
    if (/^copyright (?:notice|holders?|owner)\b/i.test(line)) continue
    if (!lines.includes(line)) lines.push(line)
    if (lines.length === 3) break
  }
  return lines
}

/** Every package the app's archive carries, keyed by `name@version`. */
export function packagesInTheApp() {
  const found = new Map()
  const seen = new Set()
  const visit = (dir) => {
    if (seen.has(dir)) return
    seen.add(dir)
    const pkg = readJson(join(dir, 'package.json'))
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) }
    for (const name of Object.keys(deps).sort()) {
      const at = resolveFrom(dir, name)
      if (at === null) continue
      if (!COVERED_BY_HAND.some((rule) => rule.test(name))) {
        const own = readJson(join(at, 'package.json'))
        const key = `${own.name}@${own.version}`
        if (!found.has(key)) {
          const file = licenseFileOf(at)
          found.set(key, {
            name: own.name,
            version: own.version,
            license: declaredLicense(own),
            file,
            copyright: file === null ? [] : copyrightLines(readFileSync(join(at, file), 'utf8')),
          })
        }
      }
      visit(at)
    }
  }
  visit(realpathSync(DESKTOP))
  return found
}

/**
 * What the app bundles, by version, from the packages that pin them. No Claude Code: the app
 * carries the Agent SDK's JavaScript only, and runs the Claude Code a person installed.
 */
function bundledVersions() {
  const desktop = readJson(join(DESKTOP, 'package.json'))
  const codexSpec = desktop.optionalDependencies?.['@openai/codex-darwin-arm64'] ?? ''
  const codex = /@openai\/codex@(\d+\.\d+\.\d+)/.exec(codexSpec)?.[1] ?? 'unknown'
  const sdkDir = resolveFrom(realpathSync(DESKTOP), '@anthropic-ai/claude-agent-sdk')
  const sdk = sdkDir === null ? null : readJson(join(sdkDir, 'package.json'))
  const electronDir = resolveFrom(realpathSync(DESKTOP), 'electron')
  const electron =
    electronDir === null ? 'unknown' : readJson(join(electronDir, 'package.json')).version
  return [
    `- Claude Agent SDK (\`@anthropic-ai/claude-agent-sdk\`) ${sdk?.version ?? 'unknown'}`,
    `- Codex CLI ${codex}`,
    `- Electron ${electron}`,
    `- Standalone Node.js ${NODE_VERSION} (Mac arm64 and Windows x64 plugin host)`,
  ]
}

/** The generated part, markers included. */
export function generated() {
  const byLicense = new Map()
  for (const one of packagesInTheApp().values()) {
    const list = byLicense.get(one.license) ?? []
    list.push(one)
    byLicense.set(one.license, list)
  }
  const out = [
    BEGIN,
    '',
    '### Bundled versions',
    '',
    ...bundledVersions(),
    '',
    '### npm packages in the app',
    '',
    'Every npm package the app’s archive (`app.asar`) carries, by the license its `package.json`',
    'declares, with the copyright lines of its own license file. Each package’s license file travels',
    'with it inside the archive; a package that ships none says so.',
  ]
  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  for (const license of [...byLicense.keys()].sort(order)) {
    const list = byLicense
      .get(license)
      .sort((a, b) => order(a.name, b.name) || order(a.version, b.version))
    out.push('', `#### ${license} (${list.length})`, '')
    for (const one of list) {
      const said =
        one.file === null
          ? 'ships no license file'
          : one.copyright.length > 0
            ? one.copyright.join(' · ')
            : `no copyright line in its \`${one.file}\``
      out.push(`- \`${one.name}\` ${one.version} — ${said}`)
    }
  }
  out.push('', END)
  return out.join('\n')
}

/** The notices file with its generated part replaced. */
export function withGenerated(text, part = generated()) {
  const from = text.indexOf(BEGIN)
  const to = text.indexOf(END)
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`${NOTICES} has no generated part between ${BEGIN} and ${END}`)
  }
  return `${text.slice(0, from)}${part}${text.slice(to + END.length)}`
}

// ⚠️ Only when this file IS the command.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // ⚠️ Read with its line endings as LF: a Windows checkout can carry CRLF, and that is not stale.
  const text = readFileSync(NOTICES, 'utf8').replace(/\r\n/g, '\n')
  const next = withGenerated(text)
  if (process.argv.includes('--check')) {
    if (next !== text) {
      process.stderr.write(
        'THIRD-PARTY-NOTICES.md is out of date: run `node scripts/third-party-notices.mjs`.\n',
      )
      process.exit(1)
    }
    process.stdout.write('THIRD-PARTY-NOTICES.md is up to date.\n')
  } else {
    writeFileSync(NOTICES, next)
    process.stdout.write(`wrote the generated part of ${NOTICES}\n`)
  }
}
