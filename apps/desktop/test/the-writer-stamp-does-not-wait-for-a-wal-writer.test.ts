import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'

it('the real metadata stamp returns while another connection holds an uncommitted WAL write', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'brobot-fictional-wal-stamp-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  db.exec('CREATE TABLE fictional_changes (id INTEGER)')
  const require = createRequire(import.meta.url)
  const worker = new Worker(
    `
    const {parentPort, workerData} = require('node:worker_threads')
    const Database = require(workerData.module)
    const db = new Database(workerData.file)
    db.exec('BEGIN EXCLUSIVE; INSERT INTO fictional_changes VALUES (1)')
    parentPort.postMessage({is:'locked'})
    parentPort.once('message', () => {
      db.exec('COMMIT')
      db.close()
      parentPort.close()
    })
  `,
    { eval: true, workerData: { file, module: require.resolve('better-sqlite3') } },
  )
  const exited = new Promise<number>((resolve) => worker.once('exit', resolve))
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once('message', (message) => {
        if (message.is === 'locked') resolve()
        else reject(new Error('fictional WAL writer did not hold its transaction'))
      })
      worker.once('error', reject)
    })
    const sample = limitsWriterSampler(db, () => true)
    let inputHandled = false
    let last = performance.now()
    let longestGap = 0
    const heartbeat = setInterval(() => {
      const at = performance.now()
      longestGap = Math.max(longestGap, at - last)
      last = at
    }, 5)
    const input = setTimeout(() => {
      inputHandled = true
    }, 10)
    const began = performance.now()
    try {
      for (let n = 0; n < 100; n++) expect(sample()).not.toBeNull()
      longestGap = Math.max(longestGap, performance.now() - last)
      const elapsed = performance.now() - began
      expect(elapsed).toBeLessThan(250)
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      expect(inputHandled).toBe(true)
      expect(longestGap).toBeLessThan(250)
      console.log(
        JSON.stringify({ is: 'fictional-writer-stamp', samples: 100, elapsed, longestGap }),
      )
    } finally {
      clearInterval(heartbeat)
      clearTimeout(input)
    }
    worker.postMessage({ is: 'release' })
    expect(await exited).toBe(0)
  } finally {
    await worker.terminate()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 30_000)
