import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { bundleAWorker } from './helpers/bundle-a-worker'

it.each(['success', 'sign-in failure', 'session failure'])(
  'Quit during native iteration retains committed rows on %s',
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'fictional-quit-iterate-'))
    try {
      const child = await bundleAWorker(
        'test/fixtures/quit-active-sqlite.child.ts',
        root,
        'quit.cjs',
      )
      const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(
          process.execPath,
          [child, root, mode],
          { timeout: 90_000, killSignal: 'SIGKILL' },
          (error, stdout, stderr) => {
            if (error)
              reject(new Error(`Quit child failed: ${error.message}\n${stdout}\n${stderr}`))
            else resolve({ stdout, stderr })
          },
        )
      })
      expect(JSON.parse(result.stdout.trim())).toEqual({
        mode,
        workerExitCode: 0,
        workerErrors: [],
        shutdownErrors:
          mode === 'success' ? [] : [expect.stringContaining('Runtime shutdown did not finish')],
        order: ['active', 'unwound', 'exit', 'checkpoint', 'writer-closed'],
        committedValues: [1, 2, 3, 4],
        integrity: 'ok',
        checkpointResult: [{ busy: 0, log: 0, checkpointed: 0 }],
        walBeforeQuit: expect.any(Number),
        walAtCheckpoint: 0,
      })
      expect(JSON.parse(result.stdout.trim()).walBeforeQuit).toBeGreaterThan(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  120_000,
)
