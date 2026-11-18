import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('prints the failed cleanup stage for rejection and the framework timeout, not passing cleanup', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const config = fileURLToPath(new URL('./fixtures/cleanup-failure/vitest.config.ts', import.meta.url))
  const directory = mkdtempSync(join(tmpdir(), 'cleanup-report-'))
  const report = join(directory, 'result.json')
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [
          join(root, 'node_modules/vitest/vitest.mjs'),
          'run',
          '--config',
          config,
          '--reporter=verbose',
          '--reporter=json',
          '--outputFile.json=' + report,
        ],
        { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error?.code !== 1) reject(error ?? new Error('Expected the cleanup controls to fail'))
          else resolve(stripVTControlCharacters(stdout + stderr))
        },
      )
    })
    const native = JSON.parse(readFileSync(report, 'utf8')) as {
      numPassedTests: number
      numFailedTests: number
      testResults: { assertionResults: { title: string; status: string }[] }[]
    }
    expect([native.numPassedTests, native.numFailedTests]).toEqual([1, 3])
    expect(output).toContain('original cleanup rejection')
    expect(output).toContain('Hook timed out in 10000ms')
    const records = output
      .split('\n')
      .filter((line) => line.includes('CLEANUP_FAILED '))
      .map(
        (line) =>
          JSON.parse(line.split('CLEANUP_FAILED ')[1]!) as {
            test: string
            stages: { stage: string; index: number }[]
          },
      )
    expect(records.map((record) => record.test)).toEqual(['cleanup rejects', 'cleanup never returns'])
    for (const record of records)
      expect(record.stages.at(-1)).toMatchObject({ stage: 'host-close-entry', index: 1 })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)
