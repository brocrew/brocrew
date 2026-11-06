import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { it } from 'vitest'
import { openDatabase } from '../apps/desktop/src/main/db/connection'
import { createSessionStore } from '../apps/desktop/src/main/db/session-store'
import { aServiceWorld } from '../apps/desktop/test/helpers/a-service-world'
import { coldMainFile } from './storage-qualification-cold.mjs'

const root = process.env.STORAGE_QUALIFICATION_ROOT
const stage = process.env.STORAGE_QUALIFICATION_STAGE
assert.equal(process.platform, 'linux')
assert(root && stage && ['control', 'timing', 'unwrapped'].includes(stage))
const folder: string = root
const heartbeatPath = process.env.STORAGE_QUALIFICATION_HEARTBEAT ?? join(folder, 'heartbeat.json')
const mode: string = stage
const stamp = () => process.hrtime.bigint()
const ms = (ns: bigint) => Number(ns) / 1e6
const receipt = (name: string, value: unknown) =>
  writeFileSync(join(folder, `${mode}-${name}`), JSON.stringify(value, null, 2) + '\n')
function distribution(values: number[]) {
  assert(values.length)
  const ordered = [...values].sort((a, b) => a - b)
  const at = (p: number) =>
    ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * p) - 1)]!
  return { count: ordered.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: ordered.at(-1)! }
}
async function bounded<T>(promise: Promise<T>, within: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, fail) => {
      timer = setTimeout(() => fail(new Error(`${label} timed out`)), within)
    }),
  ]).finally(() => clearTimeout(timer))
}

it('measures controlled worker arrivals on the actual host, separately from bounds observation', async () => {
  const before = JSON.parse(readFileSync(join(folder, 'fixture.json'), 'utf8'))
  const policy = {
    approval: process.env.STORAGE_QUALIFICATION_BUDGET_APPROVAL,
    writerDeltaP99Ms: Number(process.env.STORAGE_QUALIFICATION_WRITER_P99_MS),
    sliceP99Ms: Number(process.env.STORAGE_QUALIFICATION_SLICE_P99_MS),
    oversizeObservational: true,
    arrivalPeriodMs: 5,
    controlRequests: 500,
  }
  assert.equal(policy.approval, 'req_2d0ef365-001f-4ecc-a2f6-86d792066c57')
  assert(Number.isFinite(policy.writerDeltaP99Ms) && policy.writerDeltaP99Ms > 0)
  assert(Number.isFinite(policy.sliceP99Ms) && policy.sliceP99Ms > 0)
  assert.equal(policy.writerDeltaP99Ms, 10, 'approval fixes the relative writer budget')
  assert.equal(policy.sliceP99Ms, 10, 'approval fixes the slice budget')
  receipt('policy.json', policy)
  let db: ReturnType<typeof openDatabase> | undefined
  let world: ReturnType<typeof aServiceWorld> | undefined
  let host: ReturnType<ReturnType<typeof aServiceWorld>['aHost']> | undefined
  let worker: Worker | undefined
  let terminating = false,
    ready = false,
    stopped = false
  let fatal: unknown,
    failure: string | null = null,
    outcome = 'incomplete'
  const cleanupErrors: string[] = []
  const requests: {
    id: number
    enqueuedNs: string
    startNs: string
    endNs: string
    enqueueMs: number
    storeAppendMs: number
  }[] = []
  const slices: {
    rows: number
    startNs: string
    endNs: string
    storeMs: number
    visibleMs: number
  }[] = []
  const length = 100000
  const begins = new BigInt64Array(length),
    ends = new BigInt64Array(length),
    visible = new BigInt64Array(length)
  const rowCounts = new Int32Array(length)
  let count = 0
  const materializeTraces = () => {
    for (let n = slices.length; n < Math.min(count, length); n++)
      slices.push({
        rows: rowCounts[n]!,
        startNs: begins[n]!.toString(),
        endNs: ends[n]!.toString(),
        storeMs: ms(ends[n]! - begins[n]!),
        visibleMs: ms(visible[n]! - begins[n]!),
      })
  }
  const beat = () =>
    writeFileSync(
      heartbeatPath,
      JSON.stringify({ stage: mode, at: Date.now(), requests: requests.length }),
    )
  const heartbeat = setInterval(beat, 1000)
  const waitFor = async (test: () => boolean, label: string, within = 10000) => {
    const until = Date.now() + within
    while (!test()) {
      if (fatal) throw fatal
      assert(Date.now() < until, `${label} timed out`)
      await new Promise((done) => setTimeout(done, 5))
    }
    if (fatal) throw fatal
  }
  try {
    beat()
    // Acquire unrelated test-world resources before evicting this run's measured clone.
    world = aServiceWorld()
    worker = new Worker(
      `const {parentPort}=require('node:worker_threads');let timer,n=0;parentPort.on('message',kind=>{if(kind==='start'){timer=setInterval(()=>parentPort.postMessage({kind:'request',id:n++,at:process.hrtime.bigint().toString()}),5)}else if(kind==='stop'){clearInterval(timer);parentPort.postMessage({kind:'stopped'})}});parentPort.postMessage({kind:'ready'})`,
      { eval: true },
    )
    worker.on('error', (error) => {
      fatal = error
    })
    worker.on('exit', (code) => {
      if (!terminating) fatal = new Error(`writer exited before cleanup (${code})`)
    })
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('writer ready timed out')), 10000)
      worker!.once('message', (message) => {
        clearTimeout(timer)
        try {
          assert.equal(message.kind, 'ready')
          ready = true
          done()
        } catch (error) {
          fail(error)
        }
      })
      worker!.once('error', (error) => {
        clearTimeout(timer)
        fail(error)
      })
      worker!.once('exit', () => {
        if (!ready) {
          clearTimeout(timer)
          fail(new Error('writer exited before ready'))
        }
      })
    })
    const cold = coldMainFile(join(folder, `${mode}.sqlite`))
    receipt('cold.json', cold)
    db = openDatabase(join(folder, `${mode}.sqlite`))
    const store = createSessionStore(db)
    let ordinal = 0
    worker.on('message', (message: { kind: string; id: number; at: string }) => {
      try {
        if (message.kind === 'stopped') {
          stopped = true
          return
        }
        assert.equal(message.kind, 'request')
        const start = stamp()
        store.append(
          'writer',
          ordinal++,
          { type: 'assistant_message', text: 'fictional controlled arrival' },
          ordinal,
        )
        const end = stamp()
        requests.push({
          id: message.id,
          enqueuedNs: message.at,
          startNs: start.toString(),
          endNs: end.toString(),
          enqueueMs: ms(end - BigInt(message.at)),
          storeAppendMs: ms(end - start),
        })
      } catch (error) {
        fatal = error
      }
    })
    const measured =
      mode === 'timing'
        ? new Proxy(store, {
            get(target, property) {
              if (property === 'fillQuestionCopies')
                return (rows: number, bytes: number) => {
                  const begin = stamp()
                  let result: ReturnType<typeof target.fillQuestionCopies>
                  try {
                    result = target.fillQuestionCopies(rows, bytes)
                  } catch (error) {
                    fatal = error
                    throw error
                  }
                  const end = stamp()
                  begins[count] = begin
                  ends[count] = end
                  rowCounts[count] = rows
                  visible[count++] = stamp()
                  return result
                }
              const member = Reflect.get(target, property, target)
              return typeof member === 'function' ? member.bind(target) : member
            },
          })
        : store
    host = world.aHost({ servicesOn: false, store: measured })
    const began = stamp()
    worker.postMessage('start')
    if (mode === 'control')
      await waitFor(() => requests.length >= policy.controlRequests, 'paired no-fill arrivals')
    else {
      host.fillQuestionCopies()
      await waitFor(
        () =>
          (
            db!.prepare('SELECT done FROM question_copy_progress WHERE id=1').get() as {
              done: number
            }
          ).done === 1,
        'actual host fill',
        420000,
      )
      host.stopSweeping()
      await bounded(host.drainArchiveWork(), 10000, 'timing archive drain')
    }
    const finished = stamp()
    worker.postMessage('stop')
    await waitFor(() => stopped, 'writer stop acknowledgement')
    assert(count < length, 'slice trace buffer must not overflow')
    materializeTraces()
    const during = requests.filter(
      (row) => BigInt(row.enqueuedNs) >= began && BigInt(row.enqueuedNs) <= finished,
    )
    assert(during.length > 0)
    const writer = distribution(during.map((row) => row.enqueueMs))
    const summary = {
      stage: mode,
      fixture: before.name,
      policy,
      writer,
      storeAppend: distribution(during.map((row) => row.storeAppendMs)),
      slice: slices.length ? distribution(slices.map((row) => row.visibleMs)) : null,
      traceOverhead: slices.length
        ? distribution(slices.map((row) => row.visibleMs - row.storeMs))
        : null,
      durationMs: ms(finished - began),
      minimallyObserved: mode === 'timing',
      sliceTracingAbsent: mode !== 'timing',
      scope:
        'controlled 5ms Worker emission -> actual store append completion, not renderer IPC; unwrapped run has no store/row wrapper',
      seedPid: before.seedPid,
      pid: process.pid,
    }
    receipt('summary.json', summary)
    if (mode !== 'control' && before.name !== 'oversize') {
      const control = JSON.parse(readFileSync(join(folder, 'control-summary.json'), 'utf8'))
      assert.deepEqual(control.policy, policy)
      assert(
        writer.p99 <= control.writer.p99 + policy.writerDeltaP99Ms,
        'fixed paired-control writer p99 delta',
      )
      if (mode === 'timing')
        assert(summary.slice!.p99 < policy.sliceP99Ms, 'fixed minimally observed slice p99')
    }
    outcome = 'assertions-completed'
  } catch (error) {
    failure = String(error)
    throw error
  } finally {
    terminating = true
    for (const [label, release] of [
      [
        'host',
        async () => {
          host?.stopSweeping()
          await host?.drainArchiveWork()
        },
      ],
      [
        'worker',
        async () => {
          await worker?.terminate()
        },
      ],
      [
        'world',
        async () => {
          await world?.cleanUp()
        },
      ],
      ['database', () => db?.close()],
    ] as const) {
      try {
        await bounded(Promise.resolve().then(release), 10000, `cleanup ${label}`)
      } catch (error) {
        cleanupErrors.push(`${label}: ${String(error)}`)
      }
    }
    clearInterval(heartbeat)
    try {
      beat()
    } catch (error) {
      cleanupErrors.push(`final heartbeat: ${String(error)}`)
    }
    materializeTraces()
    writeFileSync(
      join(folder, `${mode}-appends.ndjson`),
      requests.map((row) => JSON.stringify(row)).join('\n') + '\n',
    )
    writeFileSync(
      join(folder, `${mode}-slices.ndjson`),
      slices.map((row) => JSON.stringify(row)).join('\n') + '\n',
    )
    receipt('terminal.json', {
      stage: mode,
      outcome: outcome === 'assertions-completed' && cleanupErrors.length === 0 ? 'pass' : 'fail',
      error: failure,
      cleanupErrors,
      policy,
      traceBufferOverflow: count >= length,
    })
  }
  if (cleanupErrors.length) throw new Error(cleanupErrors.join('; '))
})
