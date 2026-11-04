import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Model an append-only Windows descriptor: append is permitted, truncation is not.
// All other file operations, privacy checks and descriptor identity checks remain real.
const boundary = vi.hoisted(() => ({ append: new Set<number>(), refused: 0 }))
vi.mock('@brobot2/runtime/provider-home', async (original) => {
  const actual = await original<typeof import('@brobot2/runtime/provider-home')>()
  const fs = await import('node:fs')
  return {
    ...actual,
    openNotThroughALink(path: string, flags: number) {
      const fd = actual.openNotThroughALink(path, flags)
      if (flags & fs.constants.O_APPEND) boundary.append.add(fd)
      return fd
    },
  }
})
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  return {
    ...actual,
    ftruncateSync(fd: number, length: number) {
      if (boundary.append.has(fd)) {
        boundary.refused++
        throw Object.assign(new Error('fictional append-only descriptor'), { code: 'EPERM' })
      }
      return actual.ftruncateSync(fd, length)
    },
    closeSync(fd: number) {
      boundary.append.delete(fd)
      return actual.closeSync(fd)
    },
  }
})
import { recordPluginToolFailure } from '../src/main/plugins/tool-diagnostics'

let root = ''
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  boundary.append.clear()
})
it('retains the newest diagnostic when append-only descriptors cannot be truncated', () => {
  root = mkdtempSync(join(tmpdir(), 'fictional-diagnostic-append-'))
  const file = join(root, 'plugin-tool-failures.log')
  writeFileSync(file, 'x'.repeat(1024 * 1024), { mode: 0o600 })
  recordPluginToolFailure(root, 'chrome', 'proof-timeout')
  expect(readFileSync(file, 'utf8').includes('reason=proof-timeout')).toBe(true)
  expect(lstatSync(file).size).toBeLessThanOrEqual(1024 * 1024)
  recordPluginToolFailure(root, 'chrome', 'cancelled')
  const text = readFileSync(file, 'utf8')
  expect(text.trim().split('\n')).toHaveLength(2)
  expect(text).toContain('reason=proof-timeout')
  expect(text).toContain('reason=cancelled')
  expect(boundary.refused).toBe(0)
})
