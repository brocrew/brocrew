import type { Worker } from 'node:worker_threads'
import * as fs from 'node:fs/promises'
import { dirname } from 'node:path'
import { flushFile, retrying, syncFolder } from '@brobot2/runtime/atomic-write'
import type { CompactionFacts } from '../db/workspace-compaction'

type Request =
  | { readonly kind: 'inspect'; readonly file: string }
  | { readonly kind: 'compact'; readonly file: string; readonly output: string }

type CompactionRun = (
  file: string,
  prepare: (neededBytes: number) => Promise<void>,
  capture: () => Promise<unknown>,
  progress: (done: number, total: number) => void,
) => Promise<boolean>

/**
 * Before normal database opening; only main installs a worker's completed, closed output. A quit
 * waits for the worker to exit, never ends it: a worker ended inside a SQLite call takes the whole
 * app down.
 */
export function workspaceCompaction(start: (request: Request) => Worker): {
  run: CompactionRun
  stop(): Promise<void>
} {
  let stopped = false
  let exited: Promise<void> = Promise.resolve()
  let running: Promise<boolean> | null = null
  const request = <T>(data: Request): Promise<T> =>
    new Promise((resolve, reject) => {
      if (stopped) {
        reject(new Error('The workspace is closing.'))
        return
      }
      const current = start(data)
      let answer: { ok: boolean; value: T; error?: string } | undefined
      let problem: Error | undefined
      current.once('message', (message) => {
        answer = message
      })
      current.once('error', (error) => {
        problem = error
      })
      exited = new Promise<void>((done) => {
        current.once('exit', (code) => {
          if (stopped || code !== 0 || problem || !answer?.ok)
            reject(problem ?? new Error(answer?.error ?? 'Workspace compaction stopped.'))
          else resolve(answer.value)
          done()
        })
      })
    })
  const run: CompactionRun = async (file, prepare, capture, progress) => {
    const output = file + '.compact-events'
    for (const suffix of ['', '-wal', '-shm', '-journal'])
      await fs.rm(output + suffix, { force: true })
    const facts = await request<CompactionFacts | null>({ kind: 'inspect', file })
    if (!facts?.eligible) return false
    await prepare(facts.neededBytes)
    if (stopped) throw new Error('The workspace is closing.')
    progress(0, facts.keptBytes)
    let reporting = false
    let reportingStopped = false
    const timer = setInterval(() => {
      if (reporting) return
      reporting = true
      void fs
        .stat(output)
        .then(
          (stats) => {
            if (!stopped && !reportingStopped) progress(stats.size, facts.keptBytes)
          },
          () => undefined,
        )
        .finally(() => {
          reporting = false
        })
    }, 250)
    timer.unref()
    try {
      await request<null>({ kind: 'compact', file, output })
      reportingStopped = true
      clearInterval(timer)
      if (stopped) throw new Error('The workspace is closing.')
      for (const suffix of ['-wal', '-journal']) {
        const sidecar = await fs.stat(file + suffix).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (sidecar !== null && sidecar.size !== 0)
          throw new Error('The workspace database still has an open log.')
      }
      await flushFile(output, fs)
      if (stopped) throw new Error('The workspace is closing.')
      await retrying(() => fs.rename(output, file))
      if (process.platform === 'win32') await flushFile(file, fs)
      else await syncFolder(dirname(file), fs)
      progress((await fs.stat(file)).size, facts.keptBytes)
      if (stopped) throw new Error('The workspace is closing.')
      await capture()
      return true
    } finally {
      reportingStopped = true
      clearInterval(timer)
      await fs.rm(output, { force: true })
    }
  }
  return {
    run(...args) {
      if (running !== null)
        return Promise.reject(new Error('Workspace compaction is already running.'))
      running = run(...args).finally(() => {
        running = null
      })
      return running
    },
    async stop() {
      stopped = true
      await exited
      await running?.catch(() => undefined)
    },
  }
}
