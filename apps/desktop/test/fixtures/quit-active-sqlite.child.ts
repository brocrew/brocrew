import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { Worker, MessageChannel } from 'node:worker_threads'
import { ReaderWorkerLifetime } from '../../src/main/db/reader-worker-lifetime'
import { closeDatabase } from '../../src/main/db/close-database'
import { createAppLifetime } from '../../src/main/app-lifetime'

async function main() {
  const root = process.argv[2]!
  const file = join(root, 'quit.sqlite')
  const writer = new Database(file)
  writer.pragma('journal_mode=WAL')
  writer.pragma('wal_autocheckpoint=0')
  writer.exec('CREATE TABLE kept(n INTEGER); INSERT INTO kept VALUES(1),(2),(3)')
  const sqliteModule = createRequire(__filename).resolve('better-sqlite3')
  const order: string[] = []
  const { port1, port2 } = new MessageChannel()
  const gate = new Int32Array(new SharedArrayBuffer(8))
  let active!: () => void
  const iterating = new Promise<void>((resolve) => { active = resolve })
  let unwound = false
  let exited = false
  let closeStarted!: () => void
  const closingStarted = new Promise<void>((resolve) => { closeStarted = resolve })
  let closeSettled = false
  let cancellation: Int32Array | undefined
  let checkpointResult: unknown
  const wal = `${file}-wal`
  const walBeforeQuit = statSync(wal).size
  assert.ok(walBeforeQuit > 0, 'fixture must have committed WAL before Quit')
  const reader = new ReaderWorkerLifetime<Record<string, never>, Record<string, never>, { ok: boolean }>(() => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const Database = require(workerData.sqliteModule);
      const db = new Database(workerData.file, { readonly: true });
      const gate = new Int32Array(workerData.gate);
      parentPort.on('message', (message) => {
        if (message.type === 'close') { db.close(); workerData.phase.close(); parentPort.close(); return; }
        const cancelled = new Int32Array(message.cancellation);
        try {
          for (const row of db.prepare('SELECT n FROM kept').iterate()) {
            workerData.phase.postMessage({ active: row.n });
            Atomics.wait(gate, 0, 0);
            if (Atomics.load(cancelled, 0)) break;
          }
        } finally { Atomics.store(gate, 1, 1); }
        parentPort.postMessage({ type: 'read', id: message.id, result: { ok: true } });
      });
      parentPort.postMessage({ type: 'ready' });
    `, { eval: true, workerData: { sqliteModule, file, gate: gate.buffer, phase: port2 }, transferList: [port2] })
    const post = worker.postMessage.bind(worker)
    worker.postMessage = (message, transfer) => {
      if (message.type === 'read') cancellation = new Int32Array(message.cancellation)
      return post(message, transfer)
    }
    const terminate = worker.terminate.bind(worker)
    worker.terminate = () => { order.push('forced-termination'); return terminate() }
    port1.on('message', (message) => {
      if (message.active) { order.push('active'); active() }
    })
    worker.once('exit', () => {
      unwound = Atomics.load(gate, 1) === 1
      if (unwound) order.push('unwound')
      exited = true
      order.push('exit')
    })
    return worker
  }, Date.now, 30_000, {
    bounds: { restarts: 0, restartWindowMs: 1_000, replyBytes: 1024 },
    unavailable: () => ({ ok: false }),
    accept: (result) => result && typeof result === 'object' && 'ok' in result
      ? result as { ok: boolean } : undefined,
  })
  const outstanding = reader.read({}, {})
  await iterating
  const lifetime = createAppLifetime({
    announceClosing: () => {}, recordOpenSessions: () => {},
    stopArchiveWork: () => {}, drainArchiveWork: async () => {},
    closeAllSessions: () => {
      const closing = reader.close()
      void closing.then(() => { closeSettled = true }, () => { closeSettled = true })
      closeStarted()
      return closing
    },
    closeDatabase: () => {
      assert.equal(exited, true, 'writer reached checkpoint before reader exit')
      assert.equal(unwound, true, 'native iterator was terminated instead of unwound')
      const observedWriter = new Proxy(writer, {
        get(target, key) {
          if (key === 'pragma') return (sql: string) => {
            const result = target.pragma(sql)
            checkpointResult = result
            assert.deepEqual(result, [{ busy: 0, log: 0, checkpointed: 0 }])
            assert.equal(statSync(wal).size, 0, 'shutdown checkpoint must drain WAL before close')
            order.push('checkpoint')
            return result
          }
          if (key === 'close') return () => {
            assert.notEqual(checkpointResult, undefined)
            target.close()
            order.push('writer-closed')
          }
          return Reflect.get(target, key, target)
        },
      })
      closeDatabase(observedWriter)
    },
    quit: () => {}, exit: (code) => { throw new Error(`unexpected exit ${code}`) },
    armLastResort: () => {}, log: (message, error) => {
      if (error) throw error
    }, now: Date.now,
  })
  lifetime.beforeQuit({ preventDefault() {} })
  const shutdown = lifetime.shuttingDown!
  void shutdown.catch(() => {})
  lifetime.beforeQuit({ preventDefault() {} })
  try {
    await closingStarted
    assert.equal(Atomics.load(cancellation!, 0), 1, 'Quit must cancel the actual posted read')
    assert.equal(closeSettled, false, 'join must remain pending while iterator is held')
    assert.equal(exited, false)
    assert.equal(checkpointResult, undefined)
    assert.equal(writer.open, true)
    Atomics.store(gate, 0, 1)
    Atomics.notify(gate, 0)
    await shutdown
  } finally {
    Atomics.store(gate, 0, 1)
    Atomics.notify(gate, 0)
    port1.close()
    await reader.close()
    if (writer.open) writer.close()
  }
  assert.equal((await outstanding).ok, false)
  assert.equal(writer.open, false)
  const reopened = new Database(file)
  assert.deepEqual(reopened.prepare('SELECT n FROM kept ORDER BY n').all(), [{ n: 1 }, { n: 2 }, { n: 3 }])
  assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok')
  reopened.close()
  assert.equal(existsSync(wal) ? statSync(wal).size : 0, 0)
  assert.deepEqual(order, ['active', 'unwound', 'exit', 'checkpoint', 'writer-closed'])
  console.log(JSON.stringify({ order, committedValues: [1, 2, 3], integrity: 'ok', checkpointResult, walBeforeQuit, walAtCheckpoint: 0 }))

}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
