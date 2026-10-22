import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as memory from '../src/main/runtime/agent-memory'
import type { MemoryWriteSeams } from '../src/main/runtime/agent-memory'
import type { AccessLists } from '../src/main/recovery/windows-privacy'

interface Prepared {
  install(replace: boolean, check: () => void): void
  discard(): void
}
type Prepare = (
  path: string,
  bytes: Buffer,
  mode: number,
  homesRoot: string,
  check: () => void,
  seams?: MemoryWriteSeams,
) => Promise<Prepared>
let root: string
let homes: string
let folder: string
let target: string
const payload = Buffer.from([0xff, 0x00, 0x0d, 0x0a, 0x80])
const nothing = () => undefined
function prepare(
  path = target,
  seams: MemoryWriteSeams = {},
  check: () => void = nothing,
  mode = 0o640,
) {
  const create = Reflect.get(memory, 'stageKnowledgeFile') as Prepare
  expect(create, 'exact byte staging for knowledge changes').toBeTypeOf('function')
  return create(path, payload, mode, homes, check, seams)
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'knowledge-stage-'))
  homes = join(root, 'homes')
  folder = join(homes, 'lark', 'runbooks')
  mkdirSync(folder, { recursive: true })
  target = join(folder, 'review.md')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('knowledge changes prepare exact private bytes before publishing them', () => {
  it('prepares without changing the destination and replaces only its directory entry', async () => {
    writeFileSync(target, 'original')
    const other = join(folder, 'other.md')
    linkSync(target, other)
    const stage = await prepare()
    expect(readFileSync(target, 'utf8')).toBe('original')
    stage.install(true, nothing)
    expect(readFileSync(target)).toEqual(payload)
    expect(readFileSync(other, 'utf8')).toBe('original')
    if (process.platform !== 'win32') expect(lstatSync(target).mode & 0o777).toBe(0o640)
    expect(() => stage.install(true, nothing)).toThrow()
    stage.discard()
    expect(readdirSync(folder).sort()).toEqual(['other.md', 'review.md'])
  })

  it('restores an absent file without replacing a newly created file', async () => {
    const stage = await prepare()
    writeFileSync(target, 'created elsewhere')
    expect(() => stage.install(false, nothing)).toThrow()
    stage.discard()
    expect(readFileSync(target, 'utf8')).toBe('created elsewhere')
    expect(readdirSync(folder)).toEqual(['review.md'])
  })

  it('rejects an in-place stage edit between its named check and publish-time open', async () => {
    writeFileSync(target, 'original')
    const stage = await prepare(target, {
      platform: process.platform,
      beforeStagePublishOpen: (path: string) => writeFileSync(path, 'edited elsewhere'),
    } as MemoryWriteSeams)
    expect(() => stage.install(true, nothing)).toThrow()
    stage.discard()
    expect(readFileSync(target, 'utf8')).toBe('original')
  })

  it('publishes an absent file exclusively and discards an unused preparation', async () => {
    const first = await prepare()
    first.install(false, nothing)
    expect(readFileSync(target)).toEqual(payload)
    const unused = await prepare(join(folder, 'unused.md'))
    unused.discard()
    unused.discard()
    expect(readdirSync(folder)).toEqual(['review.md'])
  })

  it('checks the caller baseline after preparation and immediately before publication', async () => {
    writeFileSync(target, 'original')
    let calls = 0
    const stage = await prepare(target, {}, () => calls++)
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(() =>
      stage.install(true, () => {
        throw new Error('stale baseline')
      }),
    ).toThrow('stale baseline')
    stage.discard()
    expect(readFileSync(target, 'utf8')).toBe('original')
    expect(readdirSync(folder)).toEqual(['review.md'])
  })

  it('refuses linked or replaced destination folders', async () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const held = `${folder}.held`
    const stage = await prepare()
    renameSync(folder, held)
    symlinkSync(outside, folder, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => stage.install(false, nothing)).toThrow()
    stage.discard()
    expect(readdirSync(outside)).toEqual([])
    expect(existsSync(join(held, 'review.md'))).toBe(false)
  })

  it('refuses paths outside the managed root before creating files', async () => {
    await expect(prepare(join(root, 'outside.md'))).rejects.toThrow()
    expect(readdirSync(root)).toEqual(['homes'])
  })

  it('refuses an invalid mode before creating files', async () => {
    await expect(prepare(target, {}, nothing, 0o4640)).rejects.toThrow()
    expect(readdirSync(folder)).toEqual([])
  })

  const me = 'S-1-5-21-111-222-333-1001'
  function lists(read?: AccessLists['read']): AccessLists {
    return {
      userSid: async () => me,
      machineSid: async () => null,
      read: read ?? (async () => `D:PAI(A;OICI;FA;;;${me})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`),
      restrict: async () => {
        throw new Error('existing parents must already be private')
      },
    }
  }

  it('checks Windows inherited privacy while the staged file is still empty', async () => {
    const seen: string[] = []
    const stage = await prepare(target, {
      platform: 'win32',
      lists: lists(async (path) => {
        if (path.includes('.review.md.brobot-')) {
          expect(readFileSync(path)).toEqual(Buffer.alloc(0))
          seen.push(path)
        }
        return `D:PAI(A;OICI;FA;;;${me})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`
      }),
    })
    expect(seen).toHaveLength(1)
    expect(existsSync(target)).toBe(false)
    stage.install(false, nothing)
    expect(readFileSync(target)).toEqual(payload)
    expect(readdirSync(join(homes, '.brobot-stage'))).toEqual([])
  })

  it('refuses Windows privacy failure before writing any private bytes', async () => {
    await expect(
      prepare(target, {
        platform: 'win32',
        lists: lists(async (path) => {
          if (path.includes('.review.md.brobot-')) return `D:AI(A;;FR;;;WD)`
          return `D:PAI(A;OICI;FA;;;${me})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`
        }),
      }),
    ).rejects.toThrow()
    expect(existsSync(target)).toBe(false)
    const stage = join(homes, '.brobot-stage')
    for (const name of readdirSync(stage))
      expect(readFileSync(join(stage, name))).toEqual(Buffer.alloc(0))
  })

  it('does not write through a stage swapped during its Windows privacy check', async () => {
    const sentinel = join(root, 'sentinel')
    writeFileSync(sentinel, 'outside')
    await expect(
      prepare(target, {
        platform: 'win32',
        lists: lists(async (path) => {
          if (path.includes('.review.md.brobot-')) {
            renameSync(path, `${path}.held`)
            symlinkSync(sentinel, path)
          }
          return `D:PAI(A;OICI;FA;;;${me})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`
        }),
      }),
    ).rejects.toThrow()
    expect(readFileSync(sentinel, 'utf8')).toBe('outside')
    expect(existsSync(target)).toBe(false)
  })
})
