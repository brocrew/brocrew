import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { bundleAWorker } from './helpers/bundle-a-worker'

it('Quit unwinds an active native iterator, awaits exit, checkpoints and retains committed rows', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fictional-quit-iterate-'))
  try {
    const child = await bundleAWorker('test/fixtures/quit-active-sqlite.child.ts', root, 'quit.cjs')
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(process.execPath, [child, root], { timeout: 90_000, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
        if (error) reject(new Error(`Quit child failed: ${error.message}\n${stdout}\n${stderr}`))
        else resolve({ stdout, stderr })
      })
    })
    expect(JSON.parse(result.stdout.trim())).toEqual({
      order: ['active', 'unwound', 'exit', 'checkpoint', 'writer-closed'],
      committedValues: [1, 2, 3],
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
}, 120_000)
