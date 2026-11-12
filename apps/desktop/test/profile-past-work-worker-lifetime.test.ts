import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { PastWorkSearchReader } from '../src/main/db/past-work-search-reader'
import type { PastWorkSource } from '../src/shared/past-work-search'

it('answers a worker crash with an error and restarts for the next search', async () => {
  let starts = 0
  let replacementExit: Promise<number> | undefined
  const replacementErrors: string[] = []
  const reader = new PastWorkSearchReader(() => {
    starts++
    const worker = new Worker(
      starts === 1
        ? `const { parentPort } = require('node:worker_threads');
           parentPort.on('message', () => { throw new Error('fictional search worker failure') });`
        : `const { parentPort } = require('node:worker_threads');
           parentPort.on('message', (message) => {
             if (message.type === 'close') { parentPort.close(); return; }
             parentPort.postMessage({ id: message.id, result: { ok: true, hits: [] } });
           });`,
      { eval: true },
    )
    if (starts === 2) {
      replacementExit = new Promise((resolve) => worker.once('exit', resolve))
      worker.on('error', (error) => replacementErrors.push(error.message))
    }
    return worker
  })
  const source: PastWorkSource = {
    file: 'fictional-records.db',
    profile: 'fictional-profile',
    externalVersion: 0,
    versions: [['fictional-conversation', 1]],
  }
  try {
    await expect(reader.read(source, 'fictional-conversation', 'fictional')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    })
    expect(starts).toBe(1)
    await expect(reader.read(source, 'fictional-conversation', 'fictional')).resolves.toEqual({
      ok: true,
      hits: [],
    })
    expect(starts).toBe(2)
  } finally {
    await reader.close()
  }
  expect(replacementExit).toBeDefined()
  expect(await replacementExit).toBe(0)
  expect(replacementErrors).toEqual([])
}, 30_000)
