import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  NO_PROFILE_EXECUTION,
  readProfileExecution,
  writeProfileExecution,
} from '../src/main/profile-execution-file'

const fault = vi.hoisted(() => ({ denied: '', grow: '', write: false, rename: false }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      if (args[0] === fault.denied)
        throw Object.assign(new Error(`EACCES: permission denied, open '${fault.denied}'`), {
          code: 'EACCES',
        })
      return fs.openSync(...args)
    },
    readSync: (
      fd: number,
      bytes: Buffer,
      offset: number,
      length: number,
      position: number | null,
    ) => {
      if (fault.grow) {
        fs.appendFileSync(fault.grow, ' ')
        fault.grow = ''
      }
      return fs.readSync(fd, bytes, offset, length, position)
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (fault.write && typeof args[0] === 'number')
        throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
      return fs.writeFileSync(...args)
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (fault.rename)
        throw Object.assign(new Error(`EIO: rename '${args[0]}' to '${args[1]}'`), { code: 'EIO' })
      return fs.renameSync(...args)
    },
  }
})
let root: string
let file: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fictional-profile-execution-'))
  file = join(root, 'profile-execution.json')
})
afterEach(() => {
  Object.assign(fault, { denied: '', grow: '', write: false, rename: false })
  rmSync(root, { recursive: true, force: true })
})

it('reads a complete valid record even if harmless whitespace was appended during the read', () => {
  writeProfileExecution(file, NO_PROFILE_EXECUTION)
  fault.grow = file
  expect(readProfileExecution(file)).toEqual({ readable: true, kept: NO_PROFILE_EXECUTION })
  expect(fault.grow).toBe('')
})

it('names the file and actual parser error for malformed state', () => {
  writeFileSync(file, '{')
  const result = readProfileExecution(file)
  expect(result.readable).toBe(false)
  if (result.readable) throw new Error('expected malformed state')
  expect(result.why).toContain(file)
  try {
    JSON.parse('{')
  } catch (error) {
    expect(result.why).toContain((error as Error).message)
  }
})

it('names a denied execution file rather than treating it as absent', () => {
  writeProfileExecution(file, NO_PROFILE_EXECUTION)
  fault.denied = file
  const result = readProfileExecution(file)
  expect(result).toEqual({
    readable: false,
    why: `${file}: it could not be read (EACCES: permission denied, open '${file}')`,
  })
})

it.each(['write', 'rename'] as const)(
  'keeps the prior complete record after an interrupted staged %s',
  (phase) => {
    const old = { servicesOff: true as const, profiles: {} }
    writeProfileExecution(file, old)
    fault[phase] = true
    expect(() => writeProfileExecution(file, NO_PROFILE_EXECUTION)).toThrow(
      phase === 'write' ? 'ENOSPC' : 'EIO',
    )
    fault[phase] = false
    expect(readProfileExecution(file)).toEqual({ readable: true, kept: old })
    expect(readdirSync(root)).toEqual(['profile-execution.json'])
  },
)
