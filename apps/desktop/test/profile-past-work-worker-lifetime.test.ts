import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { PastWorkSearchReader } from '../src/main/db/past-work-search-reader'
import type { PastWorkSource } from '../src/shared/past-work-search'

it('answers a worker crash with an error and restarts for the next search', async () => {
  let starts = 0
  const reader = new PastWorkSearchReader(() => {
    starts++
    return new Worker(
      starts === 1
        ? `const { parentPort } = require('node:worker_threads');
           parentPort.on('message', () => { throw new Error('fictional search worker failure') });`
        : `const { parentPort } = require('node:worker_threads');
           parentPort.on('message', ({ id }) => {
             parentPort.postMessage({ id, result: { ok: true, hits: [] } });
           });`,
      { eval: true },
    )
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
}, 30_000)
