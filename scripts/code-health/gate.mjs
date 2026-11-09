import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
    return { keys: depcruiseKeys(r), totals }
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
  const files = sourceFiles()
  const rows = []
  for (const [name, scan] of Object.entries(TOOLS)) {
    console.log(`code-health: running ${name}`)
    const result = scan(files, out)
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
    console.log('code-health: baselines rewritten')
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
