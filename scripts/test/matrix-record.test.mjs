import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MATRIX_NOT_MEASURED_EXIT,
  MATRIX_RECORD_INCLUDE,
  MATRIX_RECORD_ROOT,
  keepMatrixRecord,
  matrixRunExitCode,
  productFailuresRecordedIn,
  recordFilesIn,
} from '../lib/matrix-record.mjs'

/**
 * ⚠️ **Every path a credential or the ledger lives at in a run's evidence root** — measured on the
 * surviving `660` evidence tree (`user-data/provider-homes/<project>/<profile>/codex/auth.json`) and
 * the Claude home's own names. ⛔ The census asks the include-list about every one of them.
 */
const NEVER = [
  'auth.json',
  '.credentials.json',
  'credentials.json',
  'user-data',
  'user-data-sole-instance',
  'provider-homes',
  'brobot2.sqlite',
  'brobot2.sqlite-wal',
  'one-host.sock',
  'config.toml',
  '.claude.json',
  'token',
  'keychain',
]

describe('665 · F8 — the matrix record is kept outside /tmp by an include-list', () => {
  it('🔒 the include-list is anchored, flat, and can name no credential or ledger path', () => {
    expect(MATRIX_RECORD_INCLUDE.length).toBeGreaterThan(0)
    for (const pattern of MATRIX_RECORD_INCLUDE) {
      // Anchored at both ends, so no pattern matches a longer name that merely contains it.
      expect(pattern.source.startsWith('^'), String(pattern)).toBe(true)
      expect(pattern.source.endsWith('$'), String(pattern)).toBe(true)
      // No separator, so no pattern can reach below the evidence root.
      expect(pattern.source.includes('/'), String(pattern)).toBe(false)
      for (const name of NEVER) expect(pattern.test(name), `${pattern} vs ${name}`).toBe(false)
    }
    // ⚑ Under the home, and nowhere named for itself: a test's own home is a fictional one in a
    // temp folder, so where the home is says nothing of this.
    expect(MATRIX_RECORD_ROOT).toBe(join(homedir(), 'brobot2-scratch', 'permission-matrix-records'))
    expect(MATRIX_RECORD_ROOT).not.toBe(
      join('/tmp', 'brobot2-scratch', 'permission-matrix-records'),
    )
  })

  describe('a planted evidence root', () => {
    let root
    let evidence
    let kept
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'brobot2-665-record-'))
      evidence = join(root, 'evidence')
      kept = join(root, 'kept')
      mkdirSync(evidence)
      // ⚑ What the record is FOR.
      for (const name of [
        'permission-matrix.json',
        'criterion-17-undisplayable.json',
        'criterion-20-three-surfaces.json',
        'smoke.log',
        'app-1-user-data.log',
        '480-permission-matrix-complete.png',
        'stall-browser-1.txt',
      ]) {
        writeFileSync(join(evidence, name), `planted ${name}\n`)
      }
      // ⛔ What it must never take — planted fakes, none of them a credential.
      const home = join(evidence, 'user-data', 'provider-homes', 'default', 'default', 'codex')
      mkdirSync(home, { recursive: true })
      writeFileSync(join(home, 'auth.json'), 'planted — not a credential\n')
      writeFileSync(join(evidence, 'user-data', 'brobot2.sqlite'), 'planted ledger\n')
      writeFileSync(join(evidence, 'auth.json'), 'planted at the top level too\n')
      writeFileSync(join(evidence, 'notes.md'), 'a name no pattern names\n')
      // A directory whose NAME matches a pattern, and a symlink that does.
      mkdirSync(join(evidence, 'evil.png'))
      writeFileSync(join(evidence, 'evil.png', 'auth.json'), 'planted inside a directory\n')
      symlinkSync(join(home, 'auth.json'), join(evidence, 'linked.png'))
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    it('⚑ takes exactly the record files, and never a directory, a symlink or a credential', () => {
      expect(recordFilesIn(evidence)).toEqual([
        '480-permission-matrix-complete.png',
        'app-1-user-data.log',
        'criterion-17-undisplayable.json',
        'criterion-20-three-surfaces.json',
        'permission-matrix.json',
        'smoke.log',
        'stall-browser-1.txt',
      ])
      const answer = keepMatrixRecord({
        evidence,
        runId: 'run-1',
        root: kept,
        manifest: { exit: 3 },
      })
      const destination = join(kept, 'run-1')
      expect(answer.destination).toBe(destination)
      // One level, files only: the copy has no directory at all, so nothing below can have come.
      const copied = readdirSync(destination, { withFileTypes: true })
      expect(copied.every((entry) => entry.isFile())).toBe(true)
      expect(copied.map((entry) => entry.name).sort()).toEqual(
        [...recordFilesIn(evidence), 'kept.json'].sort(),
      )
      expect(existsSync(join(destination, 'auth.json'))).toBe(false)
      const manifest = JSON.parse(readFileSync(join(destination, 'kept.json'), 'utf8'))
      expect(manifest).toMatchObject({ runId: 'run-1', from: evidence, exit: 3 })
      expect(manifest.files.map((file) => file.name)).toEqual(recordFilesIn(evidence))
      expect(manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true)
    })

    it('⛔ refuses to overwrite a record already kept', () => {
      keepMatrixRecord({ evidence, runId: 'run-1', root: kept })
      expect(() => keepMatrixRecord({ evidence, runId: 'run-1', root: kept })).toThrow(/EEXIST/)
    })
  })
})

describe('665 · F7 — a selected step-82 run exits 0 only when step 82 PASSED', () => {
  it('⚑ the status table, every verdict the smoke can record', () => {
    expect(MATRIX_NOT_MEASURED_EXIT).not.toBe(0)
    expect(MATRIX_NOT_MEASURED_EXIT).not.toBe(1)
    expect(matrixRunExitCode({ failed: 0, verdict: 'PASS' })).toBe(0)
    // ⛔ The case `660` could not tell apart from a pass: a deadline, recorded NOT PERFORMED.
    expect(matrixRunExitCode({ failed: 0, verdict: 'NOT PERFORMED' })).toBe(
      MATRIX_NOT_MEASURED_EXIT,
    )
    expect(matrixRunExitCode({ failed: 0, verdict: 'NOT ASSERTED' })).toBe(MATRIX_NOT_MEASURED_EXIT)
    // A deadline that fired before step 82 began records no verdict for it at all.
    expect(matrixRunExitCode({ failed: 0, verdict: null })).toBe(MATRIX_NOT_MEASURED_EXIT)
    // ⚑ A FAIL anywhere stays 1, whatever step 82 said.
    expect(matrixRunExitCode({ failed: 1, verdict: 'PASS' })).toBe(1)
    expect(matrixRunExitCode({ failed: 2, verdict: 'NOT PERFORMED' })).toBe(1)
  })

  it('⛔ a product failure the matrix MEASURED outranks a deadline or a stop that ended it', () => {
    expect(matrixRunExitCode({ failed: 0, verdict: 'NOT PERFORMED', measuredFailures: 1 })).toBe(1)
    expect(matrixRunExitCode({ failed: 0, verdict: null, measuredFailures: 2 })).toBe(1)
    expect(matrixRunExitCode({ failed: 0, verdict: 'PASS', measuredFailures: 0 })).toBe(0)
  })

  it('⚑ counts product failures in rows AND retakes, and none for a record never written', () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-665-count-'))
    try {
      const path = join(root, 'permission-matrix.json')
      expect(productFailuresRecordedIn(path)).toBe(0)
      writeFileSync(
        path,
        JSON.stringify({
          results: [
            { provider: 'claude', outcome: 'allow', classification: 'product-failure' },
            { provider: 'claude', outcome: 'deny', classification: 'not-performed' },
            { provider: 'codex', outcome: 'allow', performed: true },
          ],
          retakes: [{ kind: 'criterion-17-failed', classification: 'product-failure' }],
        }),
      )
      expect(productFailuresRecordedIn(path)).toBe(2)
      writeFileSync(path, '{ half a record')
      expect(() => productFailuresRecordedIn(path)).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
