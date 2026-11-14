import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

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

export function cloneBaseArgument(argv) {
  const positions = argv.flatMap((arg, index) => (arg === '--clone-base' ? [index] : []))
  const value = argv[positions[0] + 1]
  if (positions.length !== 1 || !/^[a-f0-9]{40}$/.test(value ?? ''))
    throw new GateError('jscpd: --clone-base requires one explicit full commit SHA')
  return value
}

export function cloneFindings(report) {
  const total = report?.statistics?.total
  if (
    !Array.isArray(report?.duplicates) ||
    !Number.isSafeInteger(total?.clones) ||
    total.clones !== report.duplicates.length ||
    !Number.isSafeInteger(total?.newClones) ||
    total.newClones < 0 ||
    !Number.isSafeInteger(total?.sources) ||
    total.sources <= 0
  )
    throw new GateError('jscpd: missing or inconsistent native baseline counts')
  const findings = []
  for (const [index, clone] of report.duplicates.entries()) {
    if (typeof clone.isNew !== 'boolean')
      throw new GateError(`jscpd: missing boolean isNew on record ${index}`)
    if (typeof clone.format !== 'string' || !clone.format)
      throw new GateError(`jscpd: missing format on record ${index}`)
    const endpoints = [clone.firstFile, clone.secondFile].map((file) => {
      if (
        typeof file?.name !== 'string' ||
        !file.name ||
        !Number.isSafeInteger(file.start) ||
        file.start < 1 ||
        !Number.isSafeInteger(file.end) ||
        file.end < file.start
      )
        throw new GateError(`jscpd: malformed endpoint on record ${index}`)
      return `${rel(file.name)}:${file.start}-${file.end}`
    })
    if (clone.isNew) findings.push(`record ${index}: ${clone.format}|${endpoints.join('|')}`)
  }
  if (findings.length !== total.newClones)
    throw new GateError('jscpd: newClones disagrees with boolean markers')
  return findings
}

function importSource(file, readSource) {
  const kinds = {
    '.ts': ts.ScriptKind.TS,
    '.tsx': ts.ScriptKind.TSX,
    '.mts': ts.ScriptKind.TS,
    '.cts': ts.ScriptKind.TS,
    '.js': ts.ScriptKind.JS,
    '.jsx': ts.ScriptKind.JSX,
    '.mjs': ts.ScriptKind.JS,
    '.cjs': ts.ScriptKind.JS,
  }
  const kind = kinds[path.extname(file).toLowerCase()]
  if (kind === undefined) return { reason: 'unsupported format' }
  const bytes = Buffer.from(readSource(file))
  const text = bytes.toString('utf8')
  if (!Buffer.from(text).equals(bytes)) return { reason: 'uncertain source encoding' }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  if (source.parseDiagnostics.length) return { reason: 'source parse errors' }
  const runs = []
  const statements = source.statements
  for (let i = 0; i < statements.length; i++) {
    if (!ts.isImportDeclaration(statements[i])) continue
    const start = statements[i].getStart(source)
    const tokens = []
    const visit = (node) => {
      if (
        node.kind === ts.SyntaxKind.JSDocComment ||
        node.kind === ts.SyntaxKind.SingleLineCommentTrivia ||
        node.kind === ts.SyntaxKind.MultiLineCommentTrivia
      )
        return
      if (node.kind <= ts.SyntaxKind.LastToken) {
        tokens.push([node.getStart(source), node.end])
        return
      }
      node.getChildren(source).forEach(visit)
    }
    do {
      visit(statements[i])
      i++
    } while (i < statements.length && ts.isImportDeclaration(statements[i]))
    runs.push({ start, end: statements[i]?.getStart(source) ?? text.length, tokens })
    i--
  }
  return { bytes, runs }
}

function importEndpoint(file, source) {
  if (source.reason) return source.reason
  const offset = (location, line) => {
    if (
      !Number.isSafeInteger(location?.position) ||
      location.position < 0 ||
      location.position > source.bytes.length ||
      !Number.isSafeInteger(location.column) ||
      location.column < 0 ||
      location.line !== line
    )
      return null
    const prefix = source.bytes.subarray(0, location.position)
    const text = prefix.toString('utf8')
    if (
      !Buffer.from(text).equals(prefix) ||
      text.split('\n').length !== line ||
      location.column !== prefix.length - prefix.lastIndexOf(10) - 1
    )
      return null
    return text.length
  }
  const start = offset(file.startLoc, file.start)
  const end = offset(file.endLoc, file.end)
  if (start === null || end === null || start >= end) return 'uncertain source coordinates'
  return source.runs.some(
    (run) =>
      start >= run.start && end <= run.end && run.tokens.some(([a, b]) => start < b && end > a),
  )
    ? 'static import syntax'
    : 'non-import syntax or trivia only'
}

export function classifyCloneFindings(report, readSource = (file) => fs.readFileSync(file)) {
  const nativeFindings = cloneFindings(report)
  const sources = new Map()
  const countedFindings = []
  const importOnlyRecords = []
  const classifications = []
  let next = 0
  for (const clone of report.duplicates) {
    if (!clone.isNew) continue
    const finding = nativeFindings[next++]
    const endpoints = [clone.firstFile, clone.secondFile].map((file) => {
      if (!sources.has(file.name)) sources.set(file.name, importSource(file.name, readSource))
      return importEndpoint(file, sources.get(file.name))
    })
    const importOnly = endpoints.every((reason) => reason === 'static import syntax')
    if (importOnly) importOnlyRecords.push(finding)
    else countedFindings.push(finding)
    classifications.push({ finding, kind: importOnly ? 'import-only' : 'counted', endpoints })
  }
  return {
    nativeFindings,
    countedFindings,
    importOnlyRecords,
    classifications,
    summary: `${nativeFindings.length} native NEW; ${importOnlyRecords.length} import-only; ${countedFindings.length} counted NEW`,
  }
}

function cloneReference(argv) {
  const sha = cloneBaseArgument(argv)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  if (git('cat-file', '-t', sha) !== 'commit')
    throw new GateError('jscpd: clone reference is not a commit object')
  return {
    base: sha,
    baseTree: git('rev-parse', `${sha}^{tree}`),
    head: git('rev-parse', 'HEAD'),
    headTree: git('rev-parse', 'HEAD^{tree}'),
    configBlob: git('hash-object', path.join(here, 'jscpd.json')),
    toolLockBlob: git('hash-object', path.join(here, 'package-lock.json')),
  }
}

const external = (file) => /(^|\/)node_modules\//.test(rel(file))
export const depcruiseKeys = (report) => [
  ...report.summary.violations
    .filter(
      (v) =>
        v.rule.name !== 'no-circular' &&
        !external(v.from) &&
        (v.rule.name === 'plugin-code-not-to-provider-sdks' || !external(v.to)),
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

const lineCount = (file) => {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  return text.split('\n').length - (text.endsWith('\n') || text === '' ? 1 : 0)
}

const TOOLS = {
  jscpd(files, out, reference) {
    const nativeOut = path.join(out, 'jscpd')
    fs.mkdirSync(nativeOut)
    const executable = path.join(here, 'node_modules', '.bin', 'jscpd')
    const version = execFileSync(executable, ['--version'], { cwd: root, encoding: 'utf8' }).trim()
    if (version !== 'jscpd 5.4.2') throw new GateError(`jscpd: unexpected version ${version}`)
    const args = [
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
      nativeOut,
      '--reporters',
      'json,sarif',
      '--baseline-from-ref',
      reference.base,
      '--fail-on-empty',
    ]
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    fs.writeFileSync(
      path.join(nativeOut, 'binding.json'),
      JSON.stringify(
        {
          ...reference,
          version,
          executable: 'npm',
          args,
          before,
        },
        null,
        2,
      ) + '\n',
    )
    try {
      run('jscpd', args, nativeOut, (s) => s === 0, 'npm')
    } finally {
      fs.writeFileSync(
        path.join(nativeOut, 'status-after.txt'),
        execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }),
      )
    }
    const report = readJson('jscpd', path.join(nativeOut, 'jscpd-report.json'), (r) =>
      Array.isArray(r?.duplicates),
    )
    readJson(
      'jscpd SARIF',
      path.join(nativeOut, 'jscpd-report.sarif'),
      (r) =>
        Array.isArray(r?.runs) &&
        r.runs.length === 1 &&
        Array.isArray(r.runs[0].results) &&
        r.runs[0].results.length === report.duplicates.length,
    )
    const classification = classifyCloneFindings(report)
    return {
      native: true,
      now: report.duplicates.length,
      added: classification.countedFindings,
      ...classification,
      resolved: [],
      totals: `${report.duplicates.length} native records; ${classification.summary}; base ${reference.base}`,
    }
  },
  depcruise(files, out) {
    const scan = (name, config = `${name}.cjs`) => {
      const report = path.join(out, `${name}.json`)
      const args = [
        ...files,
        '--config',
        path.join(here, config),
        '--output-type',
        'json',
        '--output-to',
        report,
      ]
      // npm scripts join all source paths into one shell argument, exceeding Linux's size limit.
      run(name, args, out, (s) => s !== null, path.join(here, 'node_modules', '.bin', 'depcruise'))
      return readJson(name, report, (r) =>
        [r?.summary?.violations, r?.modules].every(Array.isArray),
      )
    }
    const r = scan('depcruise')
    const plugin = scan('depcruise-plugin', 'depcruise-plugin.mjs')
    const s = r.summary
    const totals = `${s.totalCruised} modules, ${s.totalDependenciesCruised} dependencies, ${s.violations.length} violations; ${plugin.summary.violations.length} executable plugin violations`
    const combined = {
      ...r,
      summary: { ...s, violations: [...s.violations, ...plugin.summary.violations] },
    }
    return { keys: depcruiseKeys(combined), totals }
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
  const reference = update ? null : cloneReference(argv)
  const files = sourceFiles()
  const rows = []
  for (const [name, scan] of Object.entries(TOOLS)) {
    console.log(`code-health: running ${name}`)
    if (update && name === 'jscpd') continue
    const result = scan(files, out, reference)
    if (result.native) {
      rows.push({ name, before: 'n/a', now: result.now, ...result, totals: result.totals })
      continue
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
    console.log('code-health: depcruise, knip and size baselines rewritten; clone debt unchanged')
    return 0
  }
  const added = rows.reduce((n, r) => n + r.added.length, 0)
  const report = [
    `# Code health ${new Date().toISOString().slice(0, 10)}`,
    '',
    '| Check | Baseline | Now | New | Resolved | Tool totals |',
    '|---|---:|---:|---:|---:|---|',
    ...rows.map(
      (r) =>
        `| ${r.native ? 'jscpd counted NEW records' : r.name} | ${r.before} | ${r.now} | ${r.added.length} | ${r.native ? 'n/a' : r.resolved.length} | ${r.totals} |`,
    ),
    ...rows.flatMap((r) =>
      r.classifications?.length
        ? [
            '',
            '## Native NEW clone statement classifications',
            ...r.classifications.map(
              (c) => `- ${c.kind}: \`${c.finding}\` (${c.endpoints.join('; ')})`,
            ),
          ]
        : [],
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
    ...(rows.some((r) => r.native && r.added.length)
      ? ['', 'Deduplicate the native clone findings; --update cannot admit clone findings.']
      : []),
    added ? `**${added} new finding(s).**` : 'No new findings.',
    ...(rows.some((r) => !r.native && r.added.length) ? ['', UPDATE_HINT] : []),
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
