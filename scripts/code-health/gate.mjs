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

// Git quotes paths containing special characters even with core.quotePath=false.
function gitPath(text) {
  const escapes = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }
  return text.startsWith('"')
    ? text
        .slice(1, -1)
        .replace(/\\([0-7]{3}|.)/g, (_, escaped) =>
          escaped.length === 3
            ? String.fromCharCode(parseInt(escaped, 8))
            : (escapes[escaped] ?? escaped),
        )
    : text
}

// Each changed file of the zero-context diff from base: its base and candidate paths (null when
// added or deleted) and its hunks as [oldStart, oldCount, newStart, newCount].
function gitChanges(base, cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 })
  const patch = git(
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-relative',
    '--find-renames',
    '--unified=0',
    '--inter-hunk-context=0',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    base,
    '--',
  )
  const untracked = new Set(git('ls-files', '-z', '--others', '--exclude-standard').split('\0'))
  const files = []
  let file
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { from: undefined, to: undefined, hunks: [], header: true }
      files.push(file)
      continue
    }
    if (!file) continue
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk) {
      file.header = false
      file.hunks.push([1, 2, 3, 4].map((n) => Number(hunk[n] ?? 1)))
      continue
    }
    if (!file.header) continue
    const side = (prefix) => {
      const name = gitPath(line.slice(4).replace(/\t$/, ''))
      return name.startsWith(prefix) ? name.slice(2) : null
    }
    if (line.startsWith('--- ')) file.from = side('a/')
    if (line.startsWith('+++ ')) file.to = side('b/')
    if (line.startsWith('rename from ')) file.from = gitPath(line.slice(12))
    if (line.startsWith('rename to ')) file.to = gitPath(line.slice(10))
  }
  return { files, untracked }
}

const relativeTo = (dir, file) =>
  path.relative(dir, path.resolve(dir, file)).split(path.sep).join('/')
// A half-open native span ending at column zero stops before that line.
const lastLine = (file) =>
  file.endLoc?.line === file.end && file.endLoc.column === 0 && file.end > file.start
    ? file.end - 1
    : file.end

// Candidate line ranges each file added or modified.
function changedRanges(files) {
  const ranges = new Map()
  for (const { to, hunks } of files) {
    if (!to) continue
    for (const [, , start, count] of hunks)
      if (count > 0) ranges.set(to, [...(ranges.get(to) ?? []), [start, start + count - 1]])
  }
  return ranges
}

export function changedLineOverlap(base, cwd = root) {
  const { files, untracked } = gitChanges(base, cwd)
  const ranges = changedRanges(files)
  return (file) => {
    const name = relativeTo(cwd, file.name)
    const end = lastLine(file)
    return (
      untracked.has(name) ||
      (ranges.get(name)?.some(([start, last]) => file.start <= last && end >= start) ?? false)
    )
  }
}

// Carries a base line to the candidate through the hunks. A line inside a changed hunk keeps its
// offset into the hunk, clamped to the hunk's candidate lines.
function carryLine(hunks, line, edge) {
  let shift = 0
  for (const [oldStart, oldCount, newStart, newCount] of hunks) {
    if (oldCount === 0 ? line <= oldStart : line < oldStart) break
    const first = newCount === 0 ? newStart + 1 : newStart
    const last = first + newCount - 1
    if (line < oldStart + oldCount) {
      const offset = first + line - oldStart
      return edge === 'start' ? Math.min(offset, Math.max(first, last)) : Math.min(offset, last)
    }
    shift = first + newCount - (oldCount === 0 ? oldStart + 1 : oldStart + oldCount)
  }
  return line + shift
}

/**
 * Whether a candidate clone pair already existed on the base: both endpoints lie inside the two
 * endpoints of one pair the plain base scan reported, carried to candidate lines through the diff,
 * and each endpoint keeps at least one unchanged base line. Native fingerprints change when any
 * token inside a pair changes, so an edited old pair reads as NEW natively; a grown pair extends
 * past the carried span, and a rewritten one keeps no base line, so both stay counted.
 */
export function existedOnBase(base, baseReport, baseRoot, cwd = root) {
  const { files } = gitChanges(base, cwd)
  const changed = changedRanges(files)
  const carried = new Map()
  for (const { from, to, hunks } of files) if (from) carried.set(from, { name: to, hunks })
  const spans = baseReport.duplicates.map((clone) =>
    [clone.firstFile, clone.secondFile].map((file) => {
      const name = relativeTo(baseRoot, file.name)
      const { name: to, hunks } = carried.get(name) ?? { name, hunks: [] }
      return to && [to, carryLine(hunks, file.start, 'start'), carryLine(hunks, lastLine(file))]
    }),
  )
  const inside = (file, span) => {
    if (!span) return false
    const [name, start, end] = span
    const last = lastLine(file)
    if (relativeTo(cwd, file.name) !== name || file.start < start || last > end) return false
    const ranges = changed.get(name) ?? []
    for (let line = file.start; line <= last; line++)
      if (!ranges.some(([first, final]) => first <= line && line <= final)) return true
    return false
  }
  return (clone) =>
    spans.some(
      ([a, b]) =>
        (inside(clone.firstFile, a) && inside(clone.secondFile, b)) ||
        (inside(clone.firstFile, b) && inside(clone.secondFile, a)),
    )
}

export function classifyCloneFindings(
  report,
  overlapsChangedLines,
  readSource = (file) => fs.readFileSync(file),
  existed = () => false,
) {
  const nativeFindings = cloneFindings(report)
  const sources = new Map()
  const countedFindings = []
  const untouchedRecords = []
  const existingRecords = []
  const importOnlyRecords = []
  const classifications = []
  let next = 0
  for (const clone of report.duplicates) {
    if (!clone.isNew) continue
    const finding = nativeFindings[next++]
    const files = [clone.firstFile, clone.secondFile]
    if (!files.some(overlapsChangedLines)) {
      untouchedRecords.push(finding)
      classifications.push({
        finding,
        kind: 'untouched',
        endpoints: ['unchanged lines', 'unchanged lines'],
      })
      continue
    }
    if (existed(clone)) {
      existingRecords.push(finding)
      classifications.push({
        finding,
        kind: 'existing',
        endpoints: ['inside a base pair', 'inside a base pair'],
      })
      continue
    }
    const endpoints = files.map((file) => {
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
    untouchedRecords,
    existingRecords,
    importOnlyRecords,
    classifications,
    summary: `${nativeFindings.length} native NEW; ${untouchedRecords.length} untouched; ${existingRecords.length} existing; ${importOnlyRecords.length} import-only; ${countedFindings.length} counted NEW`,
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

// A plain scan of the base tree with the same configuration, for the pairs that already existed.
// The checkout is removed afterwards; its report stays with the output.
function scanBaseClones(base, out) {
  const tree = path.join(out, 'tree')
  fs.mkdirSync(out)
  const env = { ...process.env, GIT_INDEX_FILE: path.join(out, 'index') }
  try {
    execFileSync('git', ['read-tree', base], { cwd: root, env })
    execFileSync('git', ['checkout-index', '--all', `--prefix=${tree}/`], { cwd: root, env })
    const args = [
      '--prefix',
      here,
      'run',
      '--silent',
      'scan:clones',
      '--',
      tree,
      '--absolute',
      '--config',
      path.join(here, 'jscpd.json'),
      '--output',
      out,
      '--reporters',
      'json',
      '--fail-on-empty',
    ]
    run('jscpd', args, out, (s) => s === 0, 'npm')
    const report = readJson('jscpd base', path.join(out, 'jscpd-report.json'), (r) =>
      Array.isArray(r?.duplicates),
    )
    cloneFindings(report)
    return { report, tree }
  } finally {
    fs.rmSync(tree, { recursive: true, force: true })
    fs.rmSync(path.join(out, 'index'), { force: true })
  }
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
    const base = scanBaseClones(reference.base, path.join(out, 'jscpd-base'))
    const classification = classifyCloneFindings(
      report,
      changedLineOverlap(reference.base),
      undefined,
      existedOnBase(reference.base, base.report, base.tree),
    )
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
            '## Native NEW clone classifications',
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
