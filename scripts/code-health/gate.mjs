import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  collectPluginPolicy,
  comparePluginCounts,
  policyCoverageErrors,
  targetPluginCounts,
  selectPluginComparison,
} from './plugin-policy.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
export const LINE_LIMIT = 1000
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/
const GENERATED =
  /^(packages\/runtime\/src\/codex\/protocol|apps\/desktop\/src\/main\/db\/migrations)\//
const UPDATE_HINT =
  'Fix them, or, if you moved or renamed a file that already carried listed debt, run ' +
  '`node scripts/code-health/gate.mjs --update` in the same PR so review sees the baseline diff.'
const SIZE_HINT =
  'A file over the 1000-line limit may not grow: keep the change net-zero, or move code out ' +
  'into a new or smaller file.'

class GateError extends Error {}
const rel = (file) => path.relative(root, path.resolve(root, file)).split(path.sep).join('/')
const unique = (keys) => [...new Set(keys)].sort()

export const jscpdKeys = (report) =>
  report.duplicates.map((d) => {
    const [a, b] = [rel(d.firstFile.name), rel(d.secondFile.name)].sort()
    return `${d.format}|${a}|${b}`
  })

const external = (file) => /(^|\/)node_modules\//.test(rel(file))
export const depcruiseKeys = (report) => [
  ...report.summary.violations
    .filter(
      (v) =>
        v.rule.name !== 'no-circular' &&
        !v.rule.name.startsWith('plugin-policy/') &&
        !external(v.from) &&
        !external(v.to),
    )
    .map((v) => `${v.rule.name}|${rel(v.from)}|${rel(v.to)}`),
  ...report.modules.flatMap((m) =>
    m.dependencies
      .filter((d) => d.circular && !external(m.source) && !external(d.resolved))
      .map((d) => `no-circular|${rel(m.source)}|${rel(d.resolved)}`),
  ),
]

const symbol = (item) =>
  Array.isArray(item)
    ? item.map(symbol).sort().join('+')
    : [item.namespace ?? item.parentSymbol, item.name].filter(Boolean).join('.')

export const knipKeys = (report) =>
  report.issues.flatMap((issue) =>
    Object.entries(issue).flatMap(([type, items]) => {
      if (type === 'file') return []
      if (!Array.isArray(items)) {
        if (!items || typeof items !== 'object' || !Object.values(items).every(Array.isArray))
          throw new GateError(`knip: unexpected ${type} issue shape in ${issue.file}`)
        items = Object.entries(items).flatMap(([namespace, members]) =>
          members.map((item) => ({ ...item, namespace })),
        )
      }
      return items.map((item) => `${type}|${rel(issue.file)}|${symbol(item)}`)
    }),
  )

function run(
  name,
  args,
  out,
  accepted,
  executable = path.join(here, 'node_modules', '.bin', name),
) {
  const stdout = path.join(out, `${name}.stdout`)
  const stderr = path.join(out, `${name}.stderr`)
  const [o, e] = [fs.openSync(stdout, 'w'), fs.openSync(stderr, 'w')]
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: ['ignore', o, e],
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=3072' },
  })
  fs.closeSync(o)
  fs.closeSync(e)
  if (result.error || result.signal || !accepted(result.status)) {
    const why = result.error?.message ?? result.signal ?? `exit ${result.status}`
    throw new GateError(`${name} failed (${why}):\n${fs.readFileSync(stderr, 'utf8').slice(-4000)}`)
  }
  return stdout
}

function readJson(name, file, valid) {
  let data
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new GateError(`${name}: missing or unreadable JSON ${rel(file)}: ${error.message}`)
  }
  if (!valid(data)) throw new GateError(`${name}: unexpected JSON shape in ${rel(file)}`)
  return data
}

export const A02_RELEASE_FILE = 'scripts/code-health/release-ceilings.json'
export const A02_PROFILE = {
  metric: 'AUTO-A02',
  definition: 'byte-lf-over-2000-v1',
  selector: 'selected-source-v2',
  threshold: 2000,
  modes: ['100644', '100755'],
  roots: ['apps/', 'packages/', 'plugins/'],
  sourceSuffixes: [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.mts',
    '.cts',
    '.vue',
    '.svelte',
    '.html',
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.sql',
    '.swift',
    '.m',
    '.mm',
    '.h',
    '.c',
    '.cpp',
    '.cc',
    '.go',
    '.rs',
    '.py',
    '.sh',
    '.bash',
    '.zsh',
    '.ps1',
    '.bat',
    '.cmd',
    '.cs',
    '.nsh',
  ],
  excludedSegments: [
    'test',
    'tests',
    '__tests__',
    'fixtures',
    '__fixtures__',
    'smoke',
    'look',
    'bench',
    'benchmarks',
    'vendor',
    'vendors',
    'third_party',
    'third-party',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '__snapshots__',
  ],
  excludedNames: [
    'package-lock.json',
    'pnpm-lock.yaml',
    'go.sum',
    'COPY-INVENTORY.json',
    'release-tooling-lock.json',
  ],
  excludedPaths: [
    'packages/runtime/src/codex/protocol/',
    '/db/migrations/meta/',
    '/provider-snapshots/',
  ],
  validationPattern: String.raw`(?:\.|/)(?:test|spec|stories)\.`,
  packagingRoot: 'apps/desktop/build/',
  closureRoots: ['scripts/', 'apps/desktop/build/'],
  resolutionOrder: ['', '.ts', '.js', '.mjs', '/index.ts', '/index.mjs'],
  generatedPattern: String.raw`(?:^|\n)\s*(?://|/\*|#|<!--)\s*(?:AUTO[- ]?GENERATED|AUTOGENERATED|Generated .*DO NOT EDIT|Code generated .*DO NOT EDIT)`,
  decodedView: 'UTF-8 replacement; generated header first 1500 Unicode code points',
  byteUnit: 'raw 0x0a; NUL and invalid UTF-8 included',
  lexicalPolicy:
    'relative from/import/require/new URL; strip query; first regular match; no authored extension mapping',
}
export const a02ProfileHash = () =>
  createHash('sha256').update(JSON.stringify(A02_PROFILE)).digest('hex')

const a02Git = (directory, args, encoding = 'utf8') =>
  execFileSync('git', args, {
    cwd: directory,
    encoding,
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
const a02Oid = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
const a02Hash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const a02Count = (value) => Number.isSafeInteger(value) && value >= 0

function a02Entries(directory, source) {
  const entries = new Map()
  if (source) {
    if (!a02Oid(source)) throw new GateError('A02: source must be a full commit SHA')
    for (const row of a02Git(directory, ['ls-tree', '-rz', source]).split('\0').filter(Boolean)) {
      const at = row.indexOf('\t')
      const [mode, , oid] = row.slice(0, at).split(' ')
      entries.set(row.slice(at + 1), { mode, oid, tracked: true })
    }
  } else {
    for (const row of a02Git(directory, [
      'ls-files',
      '-z',
      '--stage',
      '--cached',
      '--others',
      '--exclude-standard',
    ])
      .split('\0')
      .filter(Boolean)) {
      const match = /^(\d{6}) ([0-9a-f]{40}) \d\t/.exec(row)
      const file = match ? row.slice(match[0].length) : row
      entries.set(file, { mode: match?.[1], tracked: !!match })
    }
  }
  return entries
}

function a02PathReason(file, closure = false) {
  const packaging = file.startsWith(A02_PROFILE.packagingRoot)
  if (!(closure ? A02_PROFILE.closureRoots : A02_PROFILE.roots).some((r) => file.startsWith(r)))
    return 'outside selected product roots'
  const parts = file.split('/')
  if (
    parts.some(
      (part, i) =>
        A02_PROFILE.excludedSegments.includes(part) && !(packaging && part === 'build' && i === 2),
    )
  )
    return 'validation/vendor/build directory'
  if (new RegExp(A02_PROFILE.validationPattern).test(file)) return 'test/spec/story file'
  if (
    file.startsWith(A02_PROFILE.excludedPaths[0]) ||
    A02_PROFILE.excludedPaths.slice(1).some((p) => file.includes(p))
  )
    return 'generated path'
  const name = path.posix.basename(file)
  if (A02_PROFILE.excludedNames.includes(name)) return 'dependency/copy inventory'
  const suffix = path.posix.extname(file)
  if (A02_PROFILE.sourceSuffixes.includes(suffix)) return null
  return 'unselected suffix/name'
}

export function measureProductSize(directory = root, { source } = {}) {
  const entries = a02Entries(directory, source)
  const selected = new Map()
  const excluded = new Map()
  const edges = []
  const queue = []
  const add = (file, origin, closure = false) => {
    if (selected.has(file)) return true
    const reason = a02PathReason(file, closure)
    if (reason) {
      excluded.set(file, reason)
      return false
    }
    const entry = entries.get(file)
    if (!entry) return false
    let bytes
    if (entry.mode && !A02_PROFILE.modes.includes(entry.mode)) {
      excluded.set(file, 'nonregular Git entry')
      return false
    }
    try {
      if (source) bytes = a02Git(directory, ['cat-file', 'blob', entry.oid], null)
      else {
        if (!fs.lstatSync(path.join(directory, file)).isFile()) {
          excluded.set(file, 'nonregular working entry')
          return false
        }
        bytes = fs.readFileSync(path.join(directory, file))
      }
    } catch (error) {
      throw new GateError(`A02: selected file unreadable ${file}: ${error.message}`)
    }
    const text = bytes.toString('utf8')
    const prefix = Array.from(text).slice(0, 1500).join('')
    if (new RegExp(A02_PROFILE.generatedPattern, 'i').test(prefix)) {
      excluded.set(file, 'explicit generated header')
      return false
    }
    let lf = 0
    for (const byte of bytes) if (byte === 10) lf++
    selected.set(file, {
      path: file,
      origin,
      tracked: entry.tracked,
      mode: entry.mode ?? 'regular working file',
      lf,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      text,
    })
    excluded.delete(file)
    queue.push(file)
    return true
  }
  for (const file of [...entries.keys()].sort()) add(file, 'product-root')
  while (queue.length) {
    const parent = queue.shift()
    const text = selected.get(parent).text
    const literal =
      /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bnew\s+URL\s*\(\s*)['"]([^'"]+)['"]/g
    for (const match of text.matchAll(literal)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) continue
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(parent), specifier.split('?')[0]),
      )
      const edge = { from: parent, line: text.slice(0, match.index).split('\n').length, specifier }
      const resolved = A02_PROFILE.resolutionOrder
        .map((suffix) => target + suffix)
        .find((file) => {
          const entry = entries.get(file)
          if (!entry || (entry.mode && !A02_PROFILE.modes.includes(entry.mode))) return false
          if (source) return true
          try {
            return fs.lstatSync(path.join(directory, file)).isFile()
          } catch {
            return false
          }
        })
      if (!resolved) edges.push({ ...edge, status: 'unresolved lexical target' })
      else {
        const reason = a02PathReason(resolved, true)
        const included = !reason && add(resolved, 'product-imported-script', true)
        edges.push({
          ...edge,
          to: resolved,
          status: included ? 'included' : (reason ?? excluded.get(resolved)),
        })
      }
    }
  }
  const files = [...selected.values()]
    .map((row) => {
      const file = { ...row }
      delete file.text
      return file
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  return {
    metric: A02_PROFILE.metric,
    profile: A02_PROFILE,
    profileSha256: a02ProfileHash(),
    population: source ? 'committed' : 'working snapshot; nonignored untracked files labeled',
    source: source ?? a02Git(directory, ['rev-parse', 'HEAD']).trim(),
    tree: a02Git(directory, ['rev-parse', `${source ?? 'HEAD'}^{tree}`]).trim(),
    count: files.filter((file) => file.lf > A02_PROFILE.threshold).length,
    files,
    excluded: [...excluded]
      .map(([path, reason]) => ({ path, reason }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    edges,
    limits:
      'Selected product only; lexical relative closure into scripts/build, no authored-extension/package/computed resolution or runtime completeness.',
  }
}

export function compareProductCount(measured, ceiling) {
  if (!a02Count(measured) || !a02Count(ceiling)) throw new GateError('A02: invalid count')
  return {
    measured,
    ceiling,
    excess: Math.max(0, measured - ceiling),
    headroom: Math.max(0, ceiling - measured),
  }
}

export function readProductRelease(
  directory = root,
  encoded = process.env.BROCREW_A02_LAST_SHIPPED,
) {
  let tuple
  try {
    tuple = JSON.parse(encoded)
  } catch {
    throw new GateError('A02: missing or malformed BROCREW_A02_LAST_SHIPPED')
  }
  const fields = [
    'releaseId',
    'tag',
    'sourceSha',
    'sourceTree',
    'storageSha',
    'path',
    'blobOid',
    'recordSha256',
  ]
  if (
    !tuple ||
    Object.keys(tuple).sort().join() !== [...fields].sort().join() ||
    !Number.isSafeInteger(tuple.releaseId) ||
    tuple.releaseId <= 0 ||
    typeof tuple.tag !== 'string' ||
    !tuple.tag.trim() ||
    !['sourceSha', 'sourceTree', 'storageSha', 'blobOid'].every((k) => a02Oid(tuple[k])) ||
    !a02Hash(tuple.recordSha256) ||
    tuple.path !== A02_RELEASE_FILE
  )
    throw new GateError('A02: invalid shipment tuple')
  // The nominated immutable object is normally present in full history. Fetch it once if needed.
  try {
    a02Git(directory, ['cat-file', '-e', `${tuple.storageSha}^{commit}`])
  } catch {
    a02Git(directory, ['fetch', '--no-tags', 'origin', tuple.storageSha])
  }
  a02Git(directory, ['cat-file', '-e', `${tuple.storageSha}^{commit}`])
  const entry = a02Git(directory, ['ls-tree', tuple.storageSha, '--', tuple.path]).trim()
  if (entry !== `100644 blob ${tuple.blobOid}\t${tuple.path}`)
    throw new GateError('A02: storage record blob differs')
  const bytes = a02Git(directory, ['cat-file', 'blob', tuple.blobOid], null)
  if (createHash('sha256').update(bytes).digest('hex') !== tuple.recordSha256)
    throw new GateError('A02: storage record SHA256 differs')
  const record = JSON.parse(bytes.toString('utf8'))
  const released = a02Git(directory, [
    'rev-parse',
    '--verify',
    `${tuple.sourceSha}^{commit}`,
  ]).trim()
  const tree = a02Git(directory, ['rev-parse', `${released}^{tree}`]).trim()
  if (
    released !== tuple.sourceSha ||
    tree !== tuple.sourceTree ||
    record?.schema !== 1 ||
    record.release?.id !== tuple.releaseId ||
    record.release?.tag !== tuple.tag ||
    record.release?.source !== released ||
    record.release?.tree !== tree
  )
    throw new GateError('A02: record does not bind the nominated shipment')
  const metric = record.metrics?.['AUTO-A02']
  if (
    !record.metrics ||
    Object.keys(record.metrics).join() !== 'AUTO-A02' ||
    metric?.definition !== A02_PROFILE.definition ||
    metric?.selector !== A02_PROFILE.selector ||
    metric?.profileSha256 !== a02ProfileHash() ||
    !a02Count(metric?.count) ||
    !a02Hash(metric?.inventorySha256) ||
    !a02Hash(metric?.receiptSha256)
  )
    throw new GateError('A02: missing or incompatible release metric/evidence')
  return { tuple, record, ceiling: metric.count }
}

const lineCount = (file) => {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  return text.split('\n').length - (text.endsWith('\n') || text === '' ? 1 : 0)
}

const TOOLS = {
  jscpd(files, out) {
    run(
      'jscpd',
      [
        '--prefix',
        here,
        'run',
        '--silent',
        'scan:clones',
        '--',
        root,
        '--absolute',
        '--config',
        path.join(here, 'jscpd.json'),
        '--output',
        out,
      ],
      out,
      (s) => s === 0,
      'npm',
    )
    const r = readJson('jscpd', path.join(out, 'jscpd-report.json'), (r) =>
      Array.isArray(r?.duplicates),
    )
    const percent = r.statistics?.total?.percentage
    return {
      keys: jscpdKeys(r),
      totals: `${r.duplicates.length} clones, ${percent}% duplicated lines`,
    }
  },
  depcruise(files, out) {
    const report = path.join(out, 'depcruise.json')
    const config = path.join(here, 'depcruise.cjs')
    const args = [...files, '--config', config, '--output-type', 'json', '--output-to', report]
    run('depcruise', args, out, (s) => s !== null)
    const r = readJson('depcruise', report, (r) =>
      [r?.summary?.violations, r?.modules].every(Array.isArray),
    )
    const s = r.summary
    const totals = `${s.totalCruised} modules, ${s.totalDependenciesCruised} dependencies, ${s.violations.length} violations`
    return { keys: depcruiseKeys(r), totals, pluginPolicy: collectPluginPolicy(r, files, { root }) }
  },
  knip(files, out) {
    const args = ['--config', path.join(here, 'knip.json'), '--reporter', 'json', '--no-progress']
    const stdout = run('knip', args, out, (s) => s === 0 || s === 1)
    const keys = knipKeys(readJson('knip', stdout, (r) => Array.isArray(r?.issues)))
    return { keys, totals: `${keys.length} issues` }
  },
  size(files) {
    const sizes = files.filter((f) => !GENERATED.test(f)).map((f) => [f, lineCount(f)])
    const over = Object.fromEntries(sizes.filter(([, n]) => n > LINE_LIMIT))
    const largest = sizes.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0])
    return {
      sizes: over,
      totals: `limit ${LINE_LIMIT} lines; largest ${largest[0]} (${largest[1]})`,
    }
  },
}

export function compareSizes(baseline, sizes) {
  const added = Object.entries(sizes)
    .filter(([f, n]) => n > (baseline[f] ?? LINE_LIMIT))
    .map(([f, n]) => `max-lines|${f}|${n} lines, allowed ${baseline[f] ?? LINE_LIMIT}`)
  const resolved = Object.keys(baseline)
    .filter((f) => !(f in sizes))
    .map((f) => `max-lines|${f}`)
  return { added: added.sort(), resolved: resolved.sort() }
}

export function compareKeys(baseline, keys) {
  const now = new Set(keys)
  const before = new Set(baseline)
  return {
    added: unique(keys.filter((k) => !before.has(k))),
    resolved: baseline.filter((k) => !now.has(k)),
  }
}

function sourceFiles() {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    },
  )
  return unique(listed.split('\0').filter((f) => CODE.test(f) && fs.existsSync(path.join(root, f))))
}

function main(argv) {
  const update = argv.includes('--update')
  const out = argv.includes('--out')
    ? path.resolve(argv[argv.indexOf('--out') + 1])
    : fs.mkdtempSync(path.join(os.tmpdir(), 'code-health-'))
  fs.mkdirSync(out, { recursive: true })
  const a02Reference = readProductRelease()
  const a02 = measureProductSize()
  const a02Comparison = compareProductCount(a02.count, a02Reference.ceiling)
  fs.writeFileSync(path.join(out, 'a02-inventory.json'), JSON.stringify(a02, null, 2) + '\n')
  fs.writeFileSync(
    path.join(out, 'a02-comparison.json'),
    JSON.stringify(
      {
        reference: a02Reference,
        comparison: a02Comparison,
      },
      null,
      2,
    ) + '\n',
  )
  const files = sourceFiles()
  const rows = []
  let pluginDiff
  for (const [name, scan] of Object.entries(TOOLS)) {
    console.log(`code-health: running ${name}`)
    const result = scan(files, out)
    if (result.pluginPolicy) {
      const policy = result.pluginPolicy
      fs.writeFileSync(path.join(out, 'plugin-policy.json'), JSON.stringify(policy, null, 2) + '\n')
      const coverage = policyCoverageErrors(policy)
      if (coverage.length) throw new GateError(coverage.join('\n'))
      const candidate = readJson(
        'plugin policy ceilings',
        path.join(here, 'baseline/plugin-policy.json'),
        (b) => !!b,
      )
      const target = argv.includes('--target')
        ? argv[argv.indexOf('--target') + 1]
        : process.env.CODE_HEALTH_TARGET || undefined
      const comparison = selectPluginComparison(root, {
        target,
        bootstrap: argv.includes('--bootstrap-plugin-policy'),
        autoBootstrap: process.env.PLUGIN_AUTO_BOOTSTRAP === 'true',
        eventName: process.env.GITHUB_EVENT_NAME,
        event: process.env.GITHUB_EVENT_PATH
          ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
          : {},
      })
      const before = targetPluginCounts(root, comparison.target, comparison.bootstrap)
      fs.writeFileSync(
        path.join(out, 'plugin-comparison.json'),
        JSON.stringify(comparison, null, 2) + '\n',
      )
      pluginDiff = comparePluginCounts(policy.counts, candidate, before)
      const total = (counts) =>
        Object.values(counts).reduce((n, roles) => n + roles.host + roles.service, 0)
      rows.push({
        name: 'plugin-policy',
        before: total(before),
        now: total(policy.counts),
        ...pluginDiff,
        totals: `${policy.coverage.host} host / ${policy.coverage.service} service roots; executable policy, full graph diagnostic`,
      })
    }
    const current = name === 'size' ? result.sizes : unique(result.keys)
    const file = path.join(here, 'baseline', `${name}.json`)
    if (update) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n')
      continue
    }
    const isSize = name === 'size'
    const baseline = readJson(`${name} baseline`, file, (b) =>
      isSize ? !Array.isArray(b) : Array.isArray(b),
    )
    const diff = isSize ? compareSizes(baseline, current) : compareKeys(baseline, current)
    const count = (x) => (isSize ? Object.keys(x).length : x.length)
    rows.push({
      name,
      before: count(baseline),
      now: count(current),
      ...diff,
      totals: result.totals,
    })
  }
  if (update) {
    console.log(
      'code-health: four legacy baselines rewritten; plugin ceilings are never updated automatically',
    )
    for (const finding of pluginDiff?.added ?? []) console.error(finding)
    return pluginDiff?.added.length || a02Comparison.excess ? 1 : 0
  }
  const added = rows.reduce((n, r) => n + r.added.length, 0) + (a02Comparison.excess > 0 ? 1 : 0)
  const report = [
    `# Code health ${new Date().toISOString().slice(0, 10)}`,
    '',
    `A02 selected-product files >2000 byte LF: ${a02.count}; last shipped ${a02Reference.ceiling}; excess ${a02Comparison.excess}; headroom ${a02Comparison.headroom}.`,
    `Shipment ${a02Reference.tuple.tag} (${a02Reference.tuple.sourceSha}); record storage ${a02Reference.tuple.storageSha}.`,
    'A02 is count-only; the separate legacy identity/per-file checks below retain their own rules.',
    '',
    '| Check | Baseline | Now | New | Resolved | Tool totals |',
    '|---|---:|---:|---:|---:|---|',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.before} | ${r.now} | ${r.added.length} | ${r.resolved.length} | ${r.totals} |`,
    ),
    ...rows.flatMap((r) =>
      r.added.length ? ['', `## New ${r.name} findings`, ...r.added.map((k) => `- \`${k}\``)] : [],
    ),
    ...(rows.some((r) => r.name === 'size' && r.added.length) ? ['', SIZE_HINT] : []),
    ...rows.flatMap((r) =>
      r.resolved.length
        ? [
            '',
            `## Resolved ${r.name} findings (drop from baseline with --update)`,
            ...r.resolved.map((k) => `- \`${k}\``),
          ]
        : [],
    ),
    '',
    added ? `**${added} new finding(s).** ${UPDATE_HINT}` : 'No new findings.',
  ].join('\n')
  fs.writeFileSync(path.join(out, 'report.md'), report + '\n')
  console.log(report + `\n\nReport and native tool output: ${out}`)
  return added ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2)) ?? 0
  } catch (error) {
    console.error(`code-health: execution error, not a finding.\n${error.message}`)
    process.exitCode = 2
  }
}
