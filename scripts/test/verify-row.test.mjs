import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// These runner contracts use POSIX Bash, process signals and verify_row's signal mask.
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe

/**
 * ⚑ **674 · the single-row RED verifier, on a planted table** — a row that goes RED, one that
 * SURVIVES, one whose anchor matches twice, one whose killer is red before anything is applied, one
 * whose killer runs nothing, and one that breaks the killer's own import (NOT MEASURED, never a
 * kill); then the refusals that protect the machine — a tree a dev server watches, found by its
 * working directory or its arguments; a Node 20 shell — and a SIGTERM mid-row, which must still
 * leave the tree as it found it.
 *
 * ⚠️ The planted tree is a throwaway directory with its own vitest config, run by this repo's own
 * vitest — nothing here ever writes inside the repository.
 */

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const VERIFIER = join(repo, 'scripts/mutations/verify_row.py')
const SUBJECT =
  "export const answer = () => 42\nexport const unwatched = () => 'x'\n" +
  'export const later = () => undefined\n// dup\n// dup\n'

let root
let rescue
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'verify-row-plant-'))
  rescue = mkdtempSync(join(tmpdir(), 'verify-row-rescue-'))
  const write = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  write(
    'vitest.config.mjs',
    "export default { test: { projects: [{ test: { name: 'scripts', root: './scripts', " +
      "include: ['test/**/*.test.mjs'], globals: true } }] } }\n",
  )
  write('scripts/lib/subject.mjs', SUBJECT)
  write(
    'scripts/test/subject.test.mjs',
    "import { answer } from '../lib/subject.mjs'\nit('answers 42', () => { expect(answer()).toBe(42) })\n",
  )
  // ⚑ One passing test beside the red one, so a red baseline is refused for being RED — not for
  // running nothing.
  write(
    'scripts/test/red.test.mjs',
    "it('passes', () => { expect(1).toBe(1) })\nit('is red before any row', () => { expect(1).toBe(2) })\n",
  )
  // ⚑ Every test skipped: vitest exits 0 and runs nothing — the case only `passed === 0` catches.
  write('scripts/test/empty.test.mjs', "it.skip('never runs', () => { expect(1).toBe(2) })\n")
  write(
    'scripts/test/slow.test.mjs',
    "import { answer } from '../lib/subject.mjs'\n" +
      "it('waits, then answers 42', async () => {\n" +
      '  await new Promise((resolve) => setTimeout(resolve, 4_000))\n' +
      '  expect(answer()).toBe(42)\n})\n',
  )
  write(
    'scripts/test/later.test.mjs',
    "import { later } from '../lib/subject.mjs'\nit('calls later', () => { later(); expect(1).toBe(1) })\n",
  )
  // ⚑ Locks the subject read-only once the row is on it, so the restore itself fails.
  write(
    'scripts/test/locks.test.mjs',
    "import { chmodSync, readFileSync } from 'node:fs'\nimport { answer } from '../lib/subject.mjs'\n" +
      "it('answers 42', () => {\n  const path = new URL('../lib/subject.mjs', import.meta.url)\n" +
      "  if (readFileSync(path, 'utf8').includes('() => 46')) chmodSync(path, 0o444)\n" +
      '  expect(answer()).toBe(42)\n})\n',
  )
  // ⛔ **706 · a killer only `pnpm run ci` may run** — the home the two `clean-base` tests moved to.
  // It would pass; the point is that it is never STARTED.
  write('scripts/gate-only/spawns.test.mjs', "it('passes', () => { expect(1).toBe(1) })\n")
  write(
    'scripts/mutations/900/mutations.py',
    [
      'MUTATIONS = [',
      '    ("M1 · answers 41 · killed by `subject.test.mjs`", [("scripts/lib/subject.mjs", "() => 42", "() => 41")]),',
      '    ("M2 · a function nothing tests changes · killed by `subject.test.mjs`", [("scripts/lib/subject.mjs", "() => \'x\'", "() => \'y\'")]),',
      '    ("M3 · an anchor that matches twice · killed by `red.test.mjs`", [("scripts/lib/subject.mjs", "// dup", "// gone")]),',
      '    ("M4 · a killer already red · killed by `red.test.mjs`", [("scripts/lib/subject.mjs", "() => 42", "() => 43")]),',
      '    ("M5 · the subject stops parsing · killed by `subject.test.mjs`", [("scripts/lib/subject.mjs", "() => 42", "() => {{")]),',
      '    ("M6 · a killer that runs nothing · killed by `empty.test.mjs`", [("scripts/lib/subject.mjs", "() => 42", "() => 45")]),',
      '    ("M7 · answers 44, slowly · killed by `slow.test.mjs`", [("scripts/lib/subject.mjs", "() => 42", "() => 44")]),',
      '    ("M8 · a rejection nobody handles · killed by `later.test.mjs`", [("scripts/lib/subject.mjs", "() => undefined", "() => { Promise.reject(new Error(\'late\')) }")]),',
      '    ("M9 · answers 46, then locks the file · killed by `locks.test.mjs`", [("scripts/lib/subject.mjs", "() => 42", "() => 46")]),',
      '    ("M10 · answers 47 · killed by `spawns.test.mjs`", [("scripts/lib/subject.mjs", "() => 42", "() => 47")]),',
      ']',
      '',
    ].join('\n'),
  )
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(rescue, { recursive: true, force: true })
})

const ENV = () => ({ ...process.env, VERIFY_ROW_RESCUE_ROOT: rescue })
const verify = (args, env = {}) => {
  const out = join(root, `report-${args.join('-')}.json`)
  const result = spawnSync('python3', [VERIFIER, '900', ...args, '--root', root, '--json', out], {
    cwd: repo,
    env: { ...ENV(), ...env },
    encoding: 'utf8',
    timeout: 240_000,
  })
  return {
    status: result.status,
    stdout: result.stdout,
    report: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null,
  }
}
const subjectNow = () => readFileSync(join(root, 'scripts/lib/subject.mjs'), 'utf8')

describeOnPosix('674 · verify_row.py — one row, its own killer, restored from bytes', () => {
  it('⚑ a row the killer notices is RED, with the failing test named — and the tree is restored', () => {
    const { status, stdout, report } = verify(['M1'])
    expect(status, stdout).toBe(0)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({ row: 'M1', verdict: 'RED' })
    expect(report.rows[0].runs['scripts/test/subject.test.mjs'].failed).toEqual(['answers 42'])
    expect(report.baselines['scripts/test/subject.test.mjs'].passed).toBe(1)
    expect(subjectNow()).toBe(SUBJECT)
    // ⚑ The rescue written before the row was applied is removed once the restore is proven — and
    // so is the tree's lock.
    expect(readdirSync(rescue)).toEqual([])
  }, 240_000)

  it('🔴 a row nothing notices SURVIVES — and says so with a failing exit', () => {
    const { status, report } = verify(['M2'])
    expect(status).toBe(1)
    expect(report.rows[0]).toMatchObject({ row: 'M2', verdict: 'SURVIVED' })
    expect(report.rows[0].changed).toEqual(['scripts/lib/subject.mjs'])
    expect(subjectNow()).toBe(SUBJECT)
  }, 240_000)

  it('⛔ an anchor that matches twice is REFUSED up front — before any killer runs', () => {
    // ⚑ Its killer is red: a refusal about the ANCHOR proves no baseline ran first.
    const { status, stdout } = verify(['M3'])
    expect(status).toBe(2)
    expect(stdout).toMatch(/REFUSED · 900 M3: .*anchor found 2 times/)
    expect(subjectNow()).toBe(SUBJECT)
  }, 240_000)

  it('⛔ a killer that is red BEFORE the row is REFUSED — a red there is not a kill', () => {
    const { status, stdout } = verify(['M4'])
    expect(status).toBe(2)
    expect(stdout).toMatch(/REFUSED · the baseline of scripts\/test\/red\.test\.mjs is RED/)
    expect(subjectNow()).toBe(SUBJECT)
  }, 240_000)

  it('⛔ a killer that runs NO test is REFUSED — it measures nothing', () => {
    const { status, stdout } = verify(['M6'])
    expect(status).toBe(2)
    expect(stdout).toMatch(
      /REFUSED · the baseline of scripts\/test\/empty\.test\.mjs .*measures nothing/,
    )
    expect(subjectNow()).toBe(SUBJECT)
  }, 240_000)

  it('⛔ 706 · a killer only the GATE may run is REFUSED — by name or by path, before anything runs', () => {
    const byName = verify(['M10'])
    expect(byName.status).toBe(2)
    expect(byName.stdout).toMatch(
      /REFUSED · scripts\/gate-only\/spawns\.test\.mjs runs `clean-base`, which standing rule §6 permits only inside `pnpm run ci`/,
    )
    expect(byName.stdout).not.toMatch(/BASELINE/)
    const byPath = verify(['M1', '--killer', 'scripts/gate-only/spawns.test.mjs'])
    expect(byPath.status).toBe(2)
    expect(byPath.stdout).toMatch(
      /REFUSED · scripts\/gate-only\/spawns\.test\.mjs runs `clean-base`/,
    )
    expect(subjectNow()).toBe(SUBJECT)
  }, 240_000)

  it('🔴 a row that breaks the killer’s own import is NOT MEASURED — no assertion noticed it', () => {
    const { status, stdout, report } = verify(['M5'])
    expect(status, stdout).toBe(4)
    expect(report.rows[0]).toMatchObject({ row: 'M5', verdict: 'NOT MEASURED' })
    expect(subjectNow()).toBe(SUBJECT)
  }, 240_000)

  it('🔴 a row that makes vitest exit non-zero with every assertion passing is NOT MEASURED', () => {
    const { status, stdout, report } = verify(['M8'])
    expect(status, stdout).toBe(4)
    expect(report.rows[0]).toMatchObject({ row: 'M8', verdict: 'NOT MEASURED' })
    expect(report.rows[0].runs['scripts/test/later.test.mjs'].failed).toEqual([])
    expect(subjectNow()).toBe(SUBJECT)
  }, 240_000)

  it('⛔ a restore that fails is exit 3, and the saved bytes are KEPT and named', () => {
    const subject = join(root, 'scripts/lib/subject.mjs')
    try {
      const { status, stdout, report } = verify(['M9'])
      expect(status, stdout).toBe(3)
      expect(report.rows[0]).toMatchObject({ row: 'M9', verdict: 'NOT RESTORED' })
      const kept = report.rows[0].rescue
      expect(stdout).toContain(kept)
      expect(readFileSync(join(kept, 'scripts/lib/subject.mjs'), 'utf8')).toBe(SUBJECT)
    } finally {
      chmodSync(subject, 0o644)
      writeFileSync(subject, SUBJECT)
      for (const left of readdirSync(rescue))
        rmSync(join(rescue, left), { recursive: true, force: true })
    }
  }, 240_000)

  it('⛔ …and the NEXT run refuses the tree until that rescue is dealt with', () => {
    const left = join(rescue, 'left-by-a-killed-run')
    mkdirSync(left, { recursive: true })
    writeFileSync(join(left, 'MANIFEST.json'), JSON.stringify({ root, files: [] }))
    try {
      const { status, stdout } = verify(['M1'])
      expect(status).toBe(2)
      expect(stdout).toMatch(/an earlier run left a rescue for this tree/)
      // ⚑ The control: a rescue for ANOTHER tree stops nothing.
      writeFileSync(join(left, 'MANIFEST.json'), JSON.stringify({ root: tmpdir(), files: [] }))
      expect(verify(['M1']).status).toBe(0)
    } finally {
      rmSync(left, { recursive: true, force: true })
    }
  }, 240_000)

  it('🔴 a SIGTERM while the killer runs restores the tree before the verifier exits', async () => {
    const child = spawn('python3', [VERIFIER, '900', 'M7', '--root', root], {
      cwd: repo,
      env: ENV(),
      stdio: 'ignore',
    })
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)))
    // ⚑ Wait for the ROW to be on disk — the baseline runs first — then signal mid-killer.
    const until = Date.now() + 120_000
    while (!subjectNow().includes('() => 44') && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(subjectNow()).toContain('() => 44')
    // ⛔ And the bytes it will restore are ON DISK while the row is applied — the one copy a SIGKILL,
    // which no handler can catch, would leave behind.
    const [kept] = readdirSync(rescue).filter((name) => !name.startsWith('.lock-'))
    expect(readFileSync(join(rescue, kept, 'scripts/lib/subject.mjs'), 'utf8')).toBe(SUBJECT)
    child.kill('SIGTERM')
    expect(await exited).toBe(5)
    expect(subjectNow()).toBe(SUBJECT)
    expect(readdirSync(rescue).filter((name) => !name.startsWith('.lock-'))).toEqual([])
    // ⛔ And the killer's whole process group was stopped with it — no vitest left running.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const listed = spawnSync('ps', ['-Ao', 'command='], { encoding: 'utf8' }).stdout
    expect(listed.split('\n').filter((line) => /vitest.*slow\.test\.mjs/.test(line))).toEqual([])
  }, 240_000)
})

describeOnPosix('674 · verify_row.py — the refusals that protect the machine', () => {
  const planted = (process) => {
    const file = join(root, `processes-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(file, JSON.stringify([{ pid: 424242, ...process }]))
    return { VERIFY_ROW_EXTRA_PROCESSES: file }
  }
  const DEV = 'node /x/node_modules/electron-vite/bin/electron-vite.js dev --port 9444'

  it('🔴 a tree a live dev server watches is REFUSED — nothing is applied, and the pid is named', () => {
    const { status, stdout } = verify(
      ['M1'],
      planted({ command: DEV, cwd: join(root, 'apps/desktop') }),
    )
    expect(status).toBe(2)
    expect(stdout).toMatch(/REFUSED · a live dev server is watching this tree.*pid 424242/)
    expect(subjectNow()).toBe(SUBJECT)
  }, 240_000)

  it('🔴 …and so is one found only by an argument inside the tree, its cwd unread', () => {
    const { status, stdout } = verify(
      ['M1'],
      planted({
        command: `node ${root}/node_modules/.bin/electron-vite --remoteDebuggingPort 9444`,
        cwd: null,
      }),
    )
    expect(status).toBe(2)
    expect(stdout).toMatch(/pid 424242/)
  }, 240_000)

  it('⚑ the control: the same dev server watching ANOTHER tree does not stop this one', () => {
    const { status, report } = verify(['M1'], planted({ command: DEV, cwd: tmpdir() }))
    expect(status).toBe(0)
    expect(report.rows[0].verdict).toBe('RED')
  }, 240_000)

  it('⛔ a tree the table runner holds, or another verifier holds, is REFUSED', () => {
    const harnessLock = join(root, 'scripts/mutations/.tree-lock')
    writeFileSync(harnessLock, 'held')
    try {
      const { status, stdout } = verify(['M1'])
      expect(status).toBe(2)
      expect(stdout).toMatch(/the table runner holds this tree/)
    } finally {
      rmSync(harnessLock, { force: true })
    }
    // ⚑ A live holder of this tree's lock — this test process stands in for the other verifier.
    const key = createHash('sha256')
      .update(realpathSync(root).toLowerCase())
      .digest('hex')
      .slice(0, 16)
    const held = join(rescue, `.lock-${key}`)
    mkdirSync(held, { recursive: true })
    writeFileSync(join(held, 'pid'), String(process.pid))
    try {
      const { status, stdout } = verify(['M1'])
      expect(status).toBe(2)
      expect(stdout).toMatch(new RegExp(`another verify_row\\.py \\(pid ${process.pid}\\)`))
    } finally {
      rmSync(held, { recursive: true, force: true })
    }
  }, 240_000)

  it('⛔ a process table that does not list the verifier itself is REFUSED', () => {
    const bin = mkdtempSync(join(tmpdir(), 'verify-row-ps-'))
    writeFileSync(join(bin, 'ps'), '#!/bin/sh\necho "    1 /sbin/launchd"\n')
    chmodSync(join(bin, 'ps'), 0o755)
    try {
      const { status, stdout } = verify(['M1'], { PATH: `${bin}:${process.env.PATH}` })
      expect(status).toBe(2)
      expect(stdout).toMatch(/REFUSED · cannot read the process table/)
    } finally {
      rmSync(bin, { recursive: true, force: true })
    }
  }, 240_000)

  it('⛔ a process table it cannot read is REFUSED — an empty list is not a list with no server', () => {
    const bin = mkdtempSync(join(tmpdir(), 'verify-row-ps-'))
    writeFileSync(join(bin, 'ps'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(bin, 'ps'), 0o755)
    try {
      const { status, stdout } = verify(['M1'], { PATH: `${bin}:${process.env.PATH}` })
      expect(status).toBe(2)
      expect(stdout).toMatch(/REFUSED · cannot read the process table/)
      expect(subjectNow()).toBe(SUBJECT)
    } finally {
      rmSync(bin, { recursive: true, force: true })
    }
  }, 240_000)

  it('⛔ a Node older than the repo’s engine is REFUSED — and only the version decides it', () => {
    const bin = mkdtempSync(join(tmpdir(), 'verify-row-node-'))
    // ⚑ `node -v` says 20; everything else runs the real Node, so no other guard can fire instead.
    writeFileSync(
      join(bin, 'node'),
      `#!/bin/sh\nif [ "$1" = "-v" ]; then echo v20.19.3; else exec "${process.execPath}" "$@"; fi\n`,
    )
    chmodSync(join(bin, 'node'), 0o755)
    try {
      const { status, stdout } = verify(['M1'], { PATH: `${bin}:${process.env.PATH}` })
      expect(status).toBe(2)
      expect(stdout).toMatch(/REFUSED · node 20 is on PATH/)
    } finally {
      rmSync(bin, { recursive: true, force: true })
    }
  }, 240_000)
})
