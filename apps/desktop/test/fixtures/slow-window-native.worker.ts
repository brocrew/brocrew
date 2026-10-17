import { workerData, type MessagePort } from 'node:worker_threads'
import { slowWindowQueries } from './slow-window-queries'

const options = workerData as { file: string; probe?: MessagePort; reader?: string }
const probe = options.probe
const reader = options.reader
delete options.probe
delete options.reader
probe?.unref()
slowWindowQueries(() => probe?.postMessage({ type: 'native-start', at: Date.now() }))

if (reader === 'limits') void import('../../src/main/limits-reader.worker')
else void import('../../src/main/window-reader.worker')
