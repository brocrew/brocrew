import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log/node'
import { vi } from 'vitest'
import { openLog } from '../../src/main/logging/log'

/** Point the process log at a temporary file (Debug mode on); read it back with `lines()`. */
export async function captureLog() {
  const folder = await mkdtemp(join(tmpdir(), 'brocrew-captured-log-'))
  const file = join(folder, 'brocrew.log')
  openLog(file, { debug: true, console: false })
  const text = () => readFile(file, 'utf8').catch(() => '')
  return {
    file,
    text,
    /** The lines written so far, once at least `count` of them are there. */
    async lines(count = 1): Promise<string[]> {
      let seen: string[] = []
      await vi.waitFor(async () => {
        seen = (await text()).split('\n').filter(Boolean)
        if (seen.length < count) throw new Error(`only ${seen.length} of ${count} lines written`)
      })
      return seen
    },
    async close() {
      log.transports.file.level = false
      await rm(folder, { recursive: true, force: true })
    },
  }
}
