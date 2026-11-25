import { LimitsReadEngine } from '../../src/main/db/limits-read-engine'
import { WindowReadEngine } from '../../src/main/db/window-read-engine'
import { workerData, type MessagePort } from 'node:worker_threads'
import { slowWindowQueries } from './slow-window-queries'

const options = workerData as { file: string; probe?: MessagePort; reader?: string }
const probe = options.probe
const reader = options.reader
delete options.probe
delete options.reader
probe?.unref()
slowWindowQueries(
  () => {},
  undefined,
  (interval) => probe?.postMessage({ type: 'native-statement', interval }),
)

function measureRead<Engine, Args extends unknown[], Result>(
  read: (this: Engine, ...args: Args) => Result,
) {
  return function (this: Engine, ...args: Args) {
    try {
      return read.apply(this, args)
    } finally {
      probe?.postMessage({ type: 'native-read-finished' })
    }
  }
}

WindowReadEngine.prototype.read = measureRead(WindowReadEngine.prototype.read)
LimitsReadEngine.prototype.read = measureRead(LimitsReadEngine.prototype.read)

if (reader === 'limits') void import('../../src/main/limits-reader.worker')
else void import('../../src/main/window-reader.worker')
