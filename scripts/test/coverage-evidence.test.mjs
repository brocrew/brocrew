import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { COVERAGE_AREAS } from '../lib/coverage-floors.mjs'
import { artifactReader, COVERAGE_CODECS, loadCoverageEvidence } from '../lib/coverage-evidence.mjs'
import { runCoverageGate } from '../coverage-gate.mjs'

const require = createRequire(import.meta.url)
const native = createRequire(require.resolve('vitest/package.json'))('flatted')
const coverage = createRequire(require.resolve('@vitest/coverage-v8/package.json'))(
  'istanbul-lib-coverage',
)
const roots = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function fileCoverage(filename, first, second) {
  const point = (line) => ({ start: { line, column: 0 }, end: { line, column: 4 } })
  return {
    path: filename,
    statementMap: { 0: point(1), 1: point(2) },
    s: { 0: first, 1: second },
    fnMap: { 0: { name: 'recipe', decl: point(1), loc: point(1), line: 1 } },
    f: { 0: first },
    branchMap: { 0: { loc: point(1), type: 'if', locations: [point(1), point(2)], line: 1 } },
    b: { 0: [first, second] },
  }
}

function fixture(root = '/fictional/coverage-source', identityOverrides = {}) {
  const identity = {
    head: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    trackedStatus: '',
    indexSha256: 'c'.repeat(64),
    measurementConfigSha256: 'd'.repeat(64),
    lockSha256: 'e'.repeat(64),
    toolchainSha256: 'f'.repeat(64),
    ...identityOverrides,
  }
  const files = ['scripts/test/menu.test.mjs', 'apps/desktop/src/renderer/recipe.dom.test.ts']
  const plan = {
    targetCommit: '1'.repeat(40),
    identity,
    sourceRoot: root,
    codecs: { ...COVERAGE_CODECS },
    shards: ['node-1', 'dom-1'],
    mergeOrder: ['node-1', 'dom-1'],
    testFiles: files,
    sources: Object.fromEntries(
      COVERAGE_AREAS.slice(0, -1).map((area) => [`fiction/${area}.ts`, area]),
    ),
    allowedFailures: [],
    allowedSkips: [],
    nonExecutableAssets: [],
    commands: {
      'node-1': ['node', 'vitest', 'run', '--shard=1/2'],
      'dom-1': ['node', 'vitest', 'run', '--shard=2/2'],
      merge: ['node', 'vitest', '--merge-reports=inputs'],
    },
  }
  const storage = new Map()
  function artifact(filename, value, raw = false) {
    const data = Buffer.from(raw ? value : JSON.stringify(value))
    storage.set(filename, data)
    return { path: filename, sha256: createHash('sha256').update(data).digest('hex') }
  }
  function report(paths) {
    return {
      startTime: 100500,
      numTotalTests: paths.length,
      numPassedTests: paths.length,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      numFailedTestSuites: 0,
      success: true,
      testResults: paths.map((file) => ({
        name: `${root}/${file}`,
        status: 'passed',
        message: '',
        assertionResults: [{ fullName: 'reads recipe', status: 'passed' }],
      })),
    }
  }
  function entry(id, paths, map) {
    const log = artifact(`${id}/command.log`, 'Tests passed\n', true)
    const wrapperLog = artifact(`${id}/wrapper.log`, 'command exit 0\n', true)
    const receipt = artifact(`${id}/receipt.json`, {
      cwd: root,
      command: plan.commands[id],
      before: structuredClone(identity),
      after: structuredClone(identity),
      logSha256: log.sha256,
      wrapperLogSha256: wrapperLog.sha256,
      startedAt: 100,
      finishedAt: 101,
      timedOut: false,
      commandExit: 0,
      wrapperExit: 0,
    })
    const result = {
      id,
      log,
      wrapperLog,
      receipt,
      tests: artifact(`${id}/tests.json`, report(paths)),
    }
    if (map) {
      result.blob = artifact(
        `${id}/blob.json`,
        native.stringify([
          COVERAGE_CODECS.vitest,
          paths.map((file) => ({ filepath: `${root}/${file}` })),
          [],
          map,
          1,
          {},
        ]),
        true,
      )
      result.copy = artifact(
        `inputs/${id}.json`,
        storage.get(result.blob.path).toString('utf8'),
        true,
      )
    }
    return result
  }
  const maps = [0, 1].map((index) =>
    Object.fromEntries(
      Object.keys(plan.sources).map((file) => [
        `${root}/${file}`,
        fileCoverage(`${root}/${file}`, 1, index),
      ]),
    ),
  )
  const mergedMap = coverage.createCoverageMap({})
  for (const map of maps) mergedMap.merge(structuredClone(map))
  const bundle = {
    shards: plan.shards.map((id, index) => entry(id, [files[index]], maps[index])),
    merge: entry('merge', files),
    coverageFinal: artifact('merge/coverage-final.json', mergedMap.toJSON()),
  }
  async function read(filename) {
    const data = storage.get(filename)
    if (!data) throw new Error('Missing artifact')
    return data
  }
  function replace(reference, transform, codec = JSON) {
    const old = codec.parse(storage.get(reference.path).toString('utf8'))
    transform(old)
    const data = Buffer.from(codec.stringify(old))
    storage.set(reference.path, data)
    reference.sha256 = createHash('sha256').update(data).digest('hex')
  }
  return { plan, bundle, storage, read, replace }
}

async function cliFixture({
  initialized = false,
  candidateEdit = false,
  missingFloorFile = false,
} = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'coverage-cli-'))
  roots.push(base)
  const repo = path.join(base, 'repo')
  const artifacts = path.join(base, 'artifacts')
  await mkdir(repo)
  const emptyGitConfig = path.join(base, 'empty.gitconfig')
  await writeFile(emptyGitConfig, '')
  const execute = promisify(execFile)
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGitConfig }
  async function git(...args) {
    return (
      await execute(
        'git',
        [
          '-C',
          repo,
          '-c',
          'user.name=BroCrew',
          '-c',
          'user.email=343827643+brocrew@users.noreply.github.com',
          ...args,
        ],
        { env },
      )
    ).stdout.trim()
  }
  await git('init', '--initial-branch=landing')
  const floors = Object.fromEntries(
    COVERAGE_AREAS.map((area) => [
      area,
      Object.fromEntries(['lines', 'branches', 'functions'].map((metric) => [metric, 1000])),
    ]),
  )
  if (!missingFloorFile) {
    await writeFile(
      path.join(repo, 'coverage-floors.json'),
      JSON.stringify({ version: 1, floors: initialized ? floors : null }),
    )
    await git('add', 'coverage-floors.json')
  }
  await git('commit', '--allow-empty', '-m', 'Fictional floor baseline')
  const expectedTarget = await git('rev-parse', 'HEAD')
  await git('switch', '-c', 'candidate')
  if (candidateEdit) {
    await writeFile(path.join(repo, 'coverage-floors.json'), JSON.stringify({ version: 1, floors }))
    await git('add', 'coverage-floors.json')
    await git('commit', '-m', 'Fictional candidate floor edit')
  }
  const f = fixture(repo, {
    head: await git('rev-parse', 'HEAD'),
    tree: await git('rev-parse', 'HEAD^{tree}'),
  })
  f.plan.targetCommit = expectedTarget
  const manifest = path.join(base, 'manifest.json')
  async function save() {
    for (const [filename, data] of f.storage) {
      const target = path.join(artifacts, filename)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, data)
    }
    await writeFile(manifest, JSON.stringify({ plan: f.plan, bundle: f.bundle }))
  }
  await save()
  return {
    ...f,
    repo,
    artifacts,
    manifest,
    git,
    save,
    options: {
      repo,
      target: 'refs/heads/landing',
      expectedTarget,
      artifacts,
      manifest,
      initialize: !initialized,
    },
  }
}

describe('coverage landing CLI with fictional Git and artifacts', () => {
  it('can initialize the first target that has no floors file', async () => {
    const f = await cliFixture({ missingFloorFile: true })
    expect((await runCoverageGate(f.options)).floors.main.lines).toBe(1000)
    expect(await f.git('rev-parse', 'refs/heads/landing')).toBe(f.options.expectedTarget)
  })

  it('does not overwrite an untracked floor file during initialization', async () => {
    const f = await cliFixture({ missingFloorFile: true })
    await writeFile(path.join(f.repo, 'coverage-floors.json'), 'fictional personal file\n')
    await expect(runCoverageGate(f.options)).rejects.toThrow(
      'Untracked floor file would be overwritten',
    )
  })

  it.each([true, false])(
    'prints the command result and preserves the target (initialize=%s)',
    async (initialize) => {
      const f = await cliFixture()
      const args = [
        fileURLToPath(new URL('../coverage-gate.mjs', import.meta.url)),
        '--repo',
        f.repo,
        '--target',
        f.options.target,
        '--expected-target',
        f.options.expectedTarget,
        '--artifacts',
        f.artifacts,
        '--manifest',
        f.manifest,
      ]
      if (initialize) args.push('--initialize')
      const call = promisify(execFile)(process.execPath, args)
      if (initialize)
        expect((await call).stdout).toContain(
          'Coverage passed: 2 passed, 0 known census failures, 0 skipped.',
        )
      else
        await expect(call).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining(
            'Coverage gate failed: Floor baseline is not initialized',
          ),
        })
      expect(await f.git('rev-parse', 'refs/heads/landing')).toBe(f.options.expectedTarget)
    },
  )

  it.each([true, false, 'replaced-floor'])(
    'requires a recorded reviewed change for a decrease (review=%s)',
    async (reviewed) => {
      const f = await cliFixture({ initialized: true })
      const before = await readFile(path.join(f.repo, 'coverage-floors.json'), 'utf8')
      if (reviewed === 'replaced-floor') {
        const lowered = JSON.parse(before)
        for (const metrics of Object.values(lowered.floors))
          for (const metric of Object.keys(metrics)) metrics[metric] = 0
        const filename = path.join(path.dirname(f.manifest), 'replacement.json')
        await writeFile(filename, JSON.stringify(lowered))
        const original = await f.git('rev-parse', 'HEAD:coverage-floors.json')
        const replacement = await f.git('hash-object', '-w', filename)
        await f.git('replace', original, replacement)
        expect(JSON.parse(await f.git('show', 'HEAD:coverage-floors.json')).floors.main.lines).toBe(
          0,
        )
        expect(await f.git('status', '--porcelain', '--untracked-files=no')).toBe('')
      }
      for (const entry of f.bundle.shards) {
        f.replace(
          entry.blob,
          (r) => {
            const main = r[3][`${f.repo}/fiction/main.ts`]
            main.s[1] = 0
            main.b[0][1] = 0
          },
          native,
        )
        f.storage.set(entry.copy.path, f.storage.get(entry.blob.path))
        entry.copy.sha256 = entry.blob.sha256
      }
      f.replace(f.bundle.coverageFinal, (r) => {
        r[`${f.repo}/fiction/main.ts`].s[1] = 0
        r[`${f.repo}/fiction/main.ts`].b[0][1] = 0
      })
      await f.save()
      if (reviewed === true) {
        const page = path.join(path.dirname(f.manifest), 'review.md')
        const record = path.join(path.dirname(f.manifest), 'review.json')
        await writeFile(page, 'Fictional reviewed floor change.\n')
        await writeFile(
          record,
          JSON.stringify({
            targetCommit: f.options.expectedTarget,
            measuredCommit: f.plan.identity.head,
            reason: 'Fictional removal of covered code',
            page,
            changes: ['main', 'overall'].flatMap((area) =>
              ['lines', 'branches'].map((metric) => ({
                area,
                metric,
                from: 1000,
                to: area === 'main' ? 500 : 916,
              })),
            ),
          }),
        )
        f.options.reviewedChange = record
        const result = await runCoverageGate(f.options)
        expect(result.floors.main.lines).toBe(500)
        expect(result.floors.overall.branches).toBe(916)
        expect(result.reviewedChange.page).toBe(page)
      } else {
        await expect(runCoverageGate(f.options)).rejects.toThrow('Coverage below floor')
        expect(await f.git('status', '--porcelain', '--untracked-files=no')).toBe('')
        expect(await readFile(path.join(f.repo, 'coverage-floors.json'), 'utf8')).toBe(before)
      }
      expect(await f.git('rev-parse', 'refs/heads/landing')).toBe(f.options.expectedTarget)
    },
  )

  it('initializes explicit qualified floors without making a commit or moving the target', async () => {
    const f = await cliFixture()
    const result = await runCoverageGate(f.options)
    expect(result.floors.overall.lines).toBe(1000)
    expect(await f.git('rev-parse', 'refs/heads/landing')).toBe(f.options.expectedTarget)
    expect(await f.git('status', '--porcelain', '--untracked-files=no')).toContain(
      'coverage-floors.json',
    )
  })

  it('checks inherited floors without reinitializing them', async () => {
    const f = await cliFixture({ initialized: true })
    expect((await runCoverageGate(f.options)).floors.main.functions).toBe(1000)
  })

  it.each(['file', 'environment'])(
    'rejects legacy graft %s without writing floors',
    async (kind) => {
      const f = await cliFixture({ initialized: true })
      const before = await readFile(path.join(f.repo, 'coverage-floors.json'), 'utf8')
      const filename =
        kind === 'file'
          ? await f.git('rev-parse', '--path-format=absolute', '--git-path', 'info/grafts')
          : path.join(path.dirname(f.manifest), 'grafts')
      await writeFile(filename, f.options.expectedTarget + '\n')
      const previous = process.env.GIT_GRAFT_FILE
      try {
        if (kind === 'environment') process.env.GIT_GRAFT_FILE = filename
        await expect(runCoverageGate(f.options)).rejects.toThrow('Legacy Git graft')
        expect(await readFile(path.join(f.repo, 'coverage-floors.json'), 'utf8')).toBe(before)
        expect(await f.git('rev-parse', 'refs/heads/landing')).toBe(f.options.expectedTarget)
      } finally {
        if (previous === undefined) delete process.env.GIT_GRAFT_FILE
        else process.env.GIT_GRAFT_FILE = previous
      }
    },
  )

  it.each([
    'not initialized',
    'already initialized',
    'different target',
    'different source',
    'unknown allowed failure',
    'candidate floor edit',
    'merge timeout',
  ])('rejects %s without moving the branch', async (defect) => {
    const f = await cliFixture({
      initialized: defect === 'already initialized',
      candidateEdit: defect === 'candidate floor edit',
    })
    if (defect === 'not initialized') f.options.initialize = false
    if (defect === 'already initialized') f.options.initialize = true
    if (defect === 'different target') f.options.expectedTarget = '0'.repeat(40)
    if (defect === 'different source') f.plan.identity.head = '0'.repeat(40)
    if (defect === 'unknown allowed failure')
      f.plan.allowedFailures = [{ file: 'menu.test.mjs', name: 'an unreviewed failure' }]
    if (defect === 'merge timeout')
      f.replace(f.bundle.merge.receipt, (r) => {
        r.timedOut = true
      })
    await f.save()
    const before = await f.git('rev-parse', 'refs/heads/landing')
    await expect(runCoverageGate(f.options)).rejects.toThrow()
    expect(await f.git('rev-parse', 'refs/heads/landing')).toBe(before)
    expect(await f.git('status', '--porcelain', '--untracked-files=no')).toBe('')
  })
})

describe('raw coverage evidence from fictional artifacts', () => {
  it.each([true, undefined, null, 'false', 0])(
    'rejects hash-valid merged receipt timeout marker %s',
    async (timedOut) => {
      const f = fixture()
      f.replace(f.bundle.merge.receipt, (r) => {
        if (timedOut === undefined) delete r.timedOut
        else r.timedOut = timedOut
      })
      await expect(loadCoverageEvidence(f.plan, f.bundle, f.read)).rejects.toThrow(
        'Incomplete timed-out merge',
      )
    },
  )

  it('requires the independently recorded native merge input order', async () => {
    const f = fixture()
    f.bundle.shards.reverse()
    await expect(loadCoverageEvidence(f.plan, f.bundle, f.read)).rejects.toThrow(
      'Native merge input order differs',
    )
  })

  it('treats reordered JSON definition keys as the same counter records', async () => {
    const f = fixture()
    f.replace(f.bundle.coverageFinal, (r) => {
      const file = r[Object.keys(r)[0]]
      file.fnMap[0] = Object.fromEntries(Object.entries(file.fnMap[0]).reverse())
      file.statementMap[0].start = { column: 0, line: 1 }
    })
    expect((await loadCoverageEvidence(f.plan, f.bundle, f.read)).qualified.tests.passed).toBe(2)
  })

  it('preserves native signed branch entries and counts nonpositive values as uncovered', async () => {
    const f = fixture()
    for (const entry of f.bundle.shards) {
      f.replace(
        entry.blob,
        (r) => {
          r[3][Object.keys(r[3])[0]].b[0][0] = -1
        },
        native,
      )
      f.storage.set(entry.copy.path, f.storage.get(entry.blob.path))
      entry.copy.sha256 = entry.blob.sha256
    }
    f.replace(f.bundle.coverageFinal, (r) => {
      r[Object.keys(r)[0]].b[0][0] = -2
    })
    const result = await loadCoverageEvidence(f.plan, f.bundle, f.read)
    expect(result.qualified.counts.main.branches).toEqual({ covered: 1, total: 2 })
    expect(result.qualified.counts.overall.branches).toEqual({ covered: 11, total: 12 })
  })

  it('refuses a stale report copied from outside the recorded run interval', async () => {
    const f = fixture()
    f.replace(f.bundle.shards[0].tests, (r) => {
      r.startTime = 99000
    })
    await expect(loadCoverageEvidence(f.plan, f.bundle, f.read)).rejects.toThrow(
      'Report falls outside run interval',
    )
  })

  it('retains exactly approved failures with their real nonzero receipts', async () => {
    const f = fixture()
    f.plan.allowedFailures = [{ file: f.plan.testFiles[0], name: 'reads recipe' }]
    for (const entry of [f.bundle.shards[0], f.bundle.merge]) {
      f.replace(entry.tests, (r) => {
        r.numPassedTests--
        r.numFailedTests++
        r.numFailedTestSuites = 1
        r.success = false
        r.testResults[0].status = 'failed'
        r.testResults[0].assertionResults[0].status = 'failed'
      })
      for (const [reference, text] of [
        [entry.log, 'Tests failed: 1\n'],
        [entry.wrapperLog, 'command exit 1\n'],
      ]) {
        const data = Buffer.from(text)
        f.storage.set(reference.path, data)
        reference.sha256 = createHash('sha256').update(data).digest('hex')
      }
      f.replace(entry.receipt, (r) => {
        r.commandExit = r.wrapperExit = 1
        r.logSha256 = entry.log.sha256
        r.wrapperLogSha256 = entry.wrapperLog.sha256
      })
    }
    const result = await loadCoverageEvidence(f.plan, f.bundle, f.read)
    expect(result.qualified.tests).toEqual({ passed: 1, failed: 1, skipped: 0 })
    expect(result.qualified.qualifiedFailures).toEqual([[f.plan.testFiles[0], 'reads recipe']])
  })

  it('refuses a file-level collection error even beside an otherwise complete result', async () => {
    const f = fixture()
    f.replace(f.bundle.shards[0].tests, (r) => {
      r.testResults[0].message = 'fictional import failure'
    })
    await expect(loadCoverageEvidence(f.plan, f.bundle, f.read)).rejects.toThrow(
      'Collection or file-level error',
    )
  })

  it('verifies hashes and independently unions overlapping native counters', async () => {
    const f = fixture()
    const result = await loadCoverageEvidence(f.plan, f.bundle, f.read)
    expect(result.qualified.counts.renderer.lines).toEqual({ covered: 2, total: 2 })
    expect(result.qualified.counts.overall.lines).toEqual({ covered: 12, total: 12 })
    expect(result.qualified.tests).toEqual({ passed: 2, failed: 0, skipped: 0 })
    expect(result.artifacts.length).toBe(17)
  })

  it('refuses altered bytes even when the JSON remains valid', async () => {
    const f = fixture()
    f.storage.set(f.bundle.coverageFinal.path, Buffer.from('{}'))
    await expect(loadCoverageEvidence(f.plan, f.bundle, f.read)).rejects.toThrow(
      'Artifact hash mismatch',
    )
  })

  it.each([
    'unknown source',
    'wrong command',
    'dirty source',
    'wrong identity',
    'wrong raw totals',
    'wrong blob version',
    'blob errors',
    'unhandled merge log',
    'missing definition',
    'negative hit',
    'counter union',
    'wrong copy',
  ])('rejects %s with internally matching artifact hashes', async (defect) => {
    const f = fixture()
    if (defect === 'unknown source')
      f.replace(f.bundle.coverageFinal, (map) => {
        const filename = `${f.plan.sourceRoot}/unclassified.ts`
        map[filename] = fileCoverage(filename, 1, 1)
      })
    if (defect === 'wrong command')
      f.replace(f.bundle.shards[0].receipt, (r) => {
        r.command = ['different command']
      })
    if (defect === 'dirty source')
      f.replace(f.bundle.shards[0].receipt, (r) => {
        r.before.trackedStatus = r.after.trackedStatus = ' M source.ts'
      })
    if (defect === 'wrong identity')
      f.replace(f.bundle.shards[0].receipt, (r) => {
        r.after.lockSha256 = '0'.repeat(64)
      })
    if (defect === 'wrong raw totals')
      f.replace(f.bundle.shards[0].tests, (r) => {
        r.numPassedTests++
      })
    if (defect === 'wrong blob version')
      f.replace(
        f.bundle.shards[0].blob,
        (r) => {
          r[0] = 'other-version'
        },
        native,
      )
    if (defect === 'blob errors')
      f.replace(
        f.bundle.shards[0].blob,
        (r) => {
          r[2].push({ message: 'fictional error' })
        },
        native,
      )
    if (defect === 'unhandled merge log') {
      const data = Buffer.from('Unhandled Errors\n')
      f.storage.set(f.bundle.merge.log.path, data)
      f.bundle.merge.log.sha256 = createHash('sha256').update(data).digest('hex')
      f.replace(f.bundle.merge.receipt, (r) => {
        r.logSha256 = f.bundle.merge.log.sha256
      })
    }
    if (defect === 'missing definition')
      f.replace(f.bundle.coverageFinal, (r) => {
        delete r[Object.keys(r)[0]].statementMap[0]
      })
    if (defect === 'negative hit')
      f.replace(f.bundle.coverageFinal, (r) => {
        r[Object.keys(r)[0]].s[0] = -1
      })
    if (defect === 'counter union')
      f.replace(f.bundle.coverageFinal, (r) => {
        r[Object.keys(r)[0]].s[0]++
      })
    if (defect === 'wrong copy') f.bundle.shards[0].copy.sha256 = '0'.repeat(64)
    await expect(loadCoverageEvidence(f.plan, f.bundle, f.read)).rejects.toThrow()
  })

  it('requires the independently allowed skip identity in shard and merge JSON', async () => {
    const f = fixture()
    const skip = (r) => {
      r.numPassedTests--
      r.numPendingTests++
      r.testResults[0].assertionResults[0].status = 'pending'
    }
    f.replace(f.bundle.shards[0].tests, skip)
    f.replace(f.bundle.merge.tests, skip)
    await expect(loadCoverageEvidence(f.plan, f.bundle, f.read)).rejects.toThrow(
      'Unqualified test status or skip',
    )
    f.plan.allowedSkips = [{ file: f.plan.testFiles[0], name: 'reads recipe' }]
    const result = await loadCoverageEvidence(f.plan, f.bundle, f.read)
    expect(result.qualified.tests.skipped).toBe(1)
  })

  it('refuses changed installed codec versions', async () => {
    const f = fixture()
    f.plan.codecs.istanbul = 'other'
    await expect(loadCoverageEvidence(f.plan, f.bundle, f.read)).rejects.toThrow(
      'Coverage codec version changed',
    )
  })
})

describe('artifact reads stay inside their fictional folder', () => {
  it('reads ordinary files and rejects traversal, absolute paths and escaping symlinks', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'coverage-evidence-'))
    roots.push(temp)
    const root = path.join(temp, 'artifacts')
    await mkdir(root)
    await writeFile(path.join(root, 'receipt.json'), '{}')
    await writeFile(path.join(temp, 'outside.json'), '{}')
    await symlink(path.join(temp, 'outside.json'), path.join(root, 'escape.json'))
    const read = await artifactReader(root)
    expect((await read('receipt.json')).toString('utf8')).toBe('{}')
    await expect(read('../outside.json')).rejects.toThrow('Artifact path escapes root')
    await expect(read(path.join(root, 'receipt.json'))).rejects.toThrow(
      'Artifact reference must be relative',
    )
    await expect(read('escape.json')).rejects.toThrow('Artifact path escapes root')
  })
})
