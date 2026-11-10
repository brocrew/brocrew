import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TESTED_FILE, isNewer, whatTheRunMeans } from '../claude-code-newest.mjs'

/**
 * The daily run against the newest published Claude Code moves the newest version tested forward
 * when it passes, does nothing when the file already names it, and fails loudly when it fails.
 * ⚑ Decided by a script, so the decision is tried here in a dry run; the workflow runs it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TESTED = { oldest: '2.1.257', newest: '2.1.290' }

describe('what the daily run means', () => {
  it('a newer published version that passed raises the newest version tested to it', () => {
    expect(whatTheRunMeans(TESTED, '2.1.292', true)).toEqual({
      decision: 'raise',
      said: 'Claude Code 2.1.292 passed on every system; the newest version tested goes from 2.1.290 to 2.1.292.',
      tested: { oldest: '2.1.257', newest: '2.1.292' },
    })
  })

  it('a published version the file already names, or an older one, changes nothing', () => {
    expect(whatTheRunMeans(TESTED, '2.1.290', true).decision).toBe('nothing')
    expect(whatTheRunMeans(TESTED, '2.1.289', true).decision).toBe('nothing')
  })

  it('a run that failed says so, and raises nothing', () => {
    const meant = whatTheRunMeans(TESTED, '2.1.292', false)
    expect(meant.decision).toBe('failed')
    expect(meant.said).toContain('did not pass on Claude Code 2.1.292')
    expect(meant.tested).toBeUndefined()
  })

  it('a version it could not read is a failure, never a raise', () => {
    expect(whatTheRunMeans(TESTED, 'npm ERR!', true).decision).toBe('failed')
  })

  it('only a newer published version is run at all', () => {
    expect(isNewer(TESTED, '2.1.292')).toBe(true)
    expect(isNewer(TESTED, '2.1.290')).toBe(false)
    expect(isNewer(TESTED, 'npm ERR!')).toBe(false)
  })
})

describe('the script, in a dry run', () => {
  const run = (published, passed, env = {}) => {
    try {
      return {
        code: 0,
        out: execFileSync(
          process.execPath,
          [
            'scripts/claude-code-newest.mjs',
            'decide',
            '--published',
            published,
            '--passed',
            passed,
            '--dry-run',
          ],
          { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } },
        ),
      }
    } catch (error) {
      return { code: error.status, out: String(error.stdout) }
    }
  }

  it('says it would raise, and leaves the file as it is', () => {
    const before = readFileSync(TESTED_FILE, 'utf8')
    const { newest } = JSON.parse(before)
    const [major, minor, patch] = newest.split('.').map(Number)
    const next = `${major}.${minor}.${patch + 1}`
    const { code, out } = run(next, 'true')
    expect(code).toBe(0)
    expect(out).toContain(`the newest version tested goes from ${newest} to ${next}`)
    expect(out).toContain('Dry run')
    expect(readFileSync(TESTED_FILE, 'utf8')).toBe(before)
  })

  it('exits 1 when the run failed, so the workflow fails', () => {
    const { code, out } = run('9.9.9', 'false')
    expect(code).toBe(1)
    expect(out).toContain('did not pass')
  })

  it('puts what it decided in the run’s summary', () => {
    const folder = mkdtempSync(join(tmpdir(), 'claude-code-newest-'))
    try {
      const summary = join(folder, 'summary.md')
      run('9.9.9', 'false', { GITHUB_STEP_SUMMARY: summary })
      expect(readFileSync(summary, 'utf8')).toContain(
        "BroBot's runtime did not pass on Claude Code 9.9.9",
      )
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
