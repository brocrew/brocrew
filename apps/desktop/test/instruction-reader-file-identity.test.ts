import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readInstructionFile, realPath } from '../src/main/providers/instruction-io'

const opening = vi.hoisted(() => ({
  path: '',
  change: null as (() => void) | null,
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    openSync: (
      path: import('node:fs').PathLike,
      flags: string | number,
      mode?: import('node:fs').Mode,
    ) => {
      if (path === opening.path) {
        const change = opening.change
        opening.change = null
        change?.()
      }
      return actual.openSync(path, flags, mode)
    },
  }
})

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brocrew-instruction-identity-'))
})
afterEach(() => {
  opening.path = ''
  opening.change = null
  rmSync(root, { recursive: true, force: true })
})

describe('the file an instruction reader actually opens', () => {
  it('reads an unchanged regular file and reports its filesystem identity', () => {
    const file = join(root, 'rules.md')
    writeFileSync(file, 'Fern keeps one rule.\n')
    expect(readInstructionFile(file)).toEqual({
      ok: true,
      text: 'Fern keeps one rule.\n',
      bytes: Buffer.byteLength('Fern keeps one rule.\n'),
      truncated: false,
      real: realpathSync.native(file),
    })
  })

  it.skipIf(process.platform === 'win32')(
    'names a directory substituted after the path check as non-regular',
    () => {
      const file = join(root, 'rules.md')
      writeFileSync(file, 'The earlier file.\n')
      opening.path = file
      opening.change = () => {
        renameSync(file, `${file}.earlier`)
        mkdirSync(file)
      }
      // POSIX permits opening the directory; the opened descriptor must identify what arrived.
      expect(readInstructionFile(file)).toEqual({ ok: false, reason: 'not-a-regular-file' })
      expect(opening.change).toBeNull()
    },
  )
})

describe('a path below an existing filesystem alias', () => {
  it('keeps every missing component below the resolved ancestor without creating it', () => {
    const real = join(root, 'real')
    const alias = join(root, 'alias')
    mkdirSync(real)
    symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const file = join(alias, 'not-yet', 'nested', 'rules.md')
    expect(realPath(alias)).toBe(realpathSync.native(real))
    expect(realPath(file)).toBe(join(realpathSync.native(real), 'not-yet', 'nested', 'rules.md'))
    expect(existsSync(join(real, 'not-yet'))).toBe(false)
  })
})
