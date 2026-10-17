import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import { bundleAWorker } from './helpers/bundle-a-worker'

it('the production worker returns activity through its validated message protocol', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-activity-worker-'))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  const root = dirname(fileURLToPath(import.meta.url))
  let reader: WindowWorkerReader | undefined
  try {
    applyMigrations(db, join(root, '../src/main/db/migrations'))
    const store = createSessionStore(db)
    store.create({
      id: 'owner',
      provider: 'claude',
      profileId: 'fictional',
      cwd: directory,
      approvalMode: 'ask',
    })
    const parent = store.rootOf('owner')
    if (parent === null) throw new Error('fictional root missing')
    store.recordGive(
      {
        piece: 'work-fictional',
        parent: parent.piece,
        number: 1,
        owner: 'owner',
        givenBy: 'owner',
        title: 'Fictional work',
        brief: 'Private',
        folder: null,
        inputs: [],
      },
      0,
      {
        type: 'work_given',
        piece: 'work-fictional',
        parent: parent.piece,
        label: `${parent.label}.1`,
        givenBy: 'owner',
        title: 'Fictional work',
        brief: 'Private',
      },
      100,
    )
    await bundleAWorker('src/main/window-reader.worker.ts', directory, 'files-worker.cjs')
    reader = new WindowWorkerReader(
      new Worker(join(directory, 'files-worker.cjs'), {
        workerData: { file: join(directory, 'fictional.sqlite') },
      }),
    )
    const answer = await reader.read({ kind: 'activity', from: 100, to: 200 })
    expect(answer).toMatchObject({
      kind: 'activity',
      window: { from: 100, to: 200 },
      capped: false,
      read: { walk: 'one-window-over-every-agents-conversation', ledgers: 1, rowsUnread: 0 },
      lines: [
        {
          what: 'started',
          register: 'observed',
          at: 100,
          piece: { id: 'work-fictional', label: `${parent.label}.1`, title: 'Fictional work' },
        },
      ],
    })
    expect(JSON.stringify(answer)).not.toContain('Private')
  } finally {
    await reader?.close()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 60000)
