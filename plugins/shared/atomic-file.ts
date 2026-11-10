import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

const DELAYS = [50, 100, 150, 200, 250, 300, 300, 300, 350]
const HELD = new Set(['EBUSY', 'EPERM', 'EACCES'])

function retry<T>(operation: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return operation()
    } catch (error) {
      const delay = DELAYS[attempt]
      if (delay === undefined || !HELD.has((error as NodeJS.ErrnoException).code ?? '')) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)
    }
  }
}

// Plugin stores are synchronous and standalone; the app's async recovery writer cannot serve them.
export function writeAtomicallySync(file: string, data: string | Uint8Array, mode = 0o600): void {
  const temporary = join(dirname(file), `${basename(file)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx', mode, flush: true })
    retry(() => fs.renameSync(temporary, file))
  } catch (error) {
    try {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') fs.rmSync(temporary, { force: true })
    } catch {
      // Preserve the write failure if cleanup also fails.
    }
    throw error
  }
  const windows = process.platform === 'win32'
  const fd = retry(() => fs.openSync(windows ? file : dirname(file), windows ? 'r+' : 'r'))
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
