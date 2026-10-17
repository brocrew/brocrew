import { workerData } from 'node:worker_threads'
import { z } from 'zod'
import { slowWindowQueries } from './slow-window-queries'

const options = z
  .object({ file: z.string(), pages: z.instanceof(SharedArrayBuffer) })
  .parse(workerData)
const pages = new Int32Array(options.pages)
Reflect.deleteProperty(workerData, 'pages')
slowWindowQueries((sql) => {
  if (sql.includes('AS handed')) Atomics.add(pages, 0, 1)
}, 1_000_000)
void import('../../src/main/window-reader.worker')
