import { workerData } from 'node:worker_threads'
import { z } from 'zod'
import { WindowReadEngine } from '../../src/main/db/window-read-engine'
import { slowWindowQueries } from './slow-window-queries'

const options = z
  .object({
    file: z.string(),
    pages: z.instanceof(SharedArrayBuffer),
    routesReads: z.instanceof(SharedArrayBuffer),
  })
  .parse(workerData)
const pages = new Int32Array(options.pages)
const routesReads = new Int32Array(options.routesReads)
Reflect.deleteProperty(workerData, 'pages')
Reflect.deleteProperty(workerData, 'routesReads')
slowWindowQueries((sql) => {
  if (sql.includes('AS handed')) Atomics.add(pages, 0, 1)
}, 1_000_000)

const read = WindowReadEngine.prototype.read
WindowReadEngine.prototype.read = function (...args) {
  if (args[0].kind === 'routes') Atomics.add(routesReads, 0, 1)
  return read.apply(this, args)
}

void import('../../src/main/window-reader.worker')
