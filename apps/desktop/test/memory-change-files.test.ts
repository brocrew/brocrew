import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeAutoMemoryDir, codexAdHocNotesDir, codexMemoryDir } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import * as memory from '../src/main/runtime/agent-memory'
import type { AgentMemoryInputs, MemoryWriteSeams } from '../src/main/runtime/agent-memory'
import type { MemoryAmendment } from '../src/shared/agent-memory'

interface Result {
  ok: boolean
  reason?: string
  entry?: string
  textBefore?: string | null
  textAfter?: string | null
}
interface Selection extends AgentMemoryInputs {
  provider: Provider
  entry: string
  confirmed: boolean
  check: () => void
}
interface Restoration extends AgentMemoryInputs {
  source: MemoryAmendment
  check: () => void
  confirmed: boolean
}
interface Seams extends MemoryWriteSeams {
  beforeMemoryUnlink?: () => void
}
interface Api {
  remove: (inputs: Selection, seams?: Seams) => Result
  restore: (inputs: Restoration, seams?: Seams) => Promise<Result>
  undo: (inputs: Restoration, seams?: Seams) => Result
}
const saved = 'Saved text.\r\nCafé.\n'
let root: string
let homesRoot: string
const homeOf = (provider: Provider, slug = 'lark') => join(homesRoot, 'default', slug, provider)
const inputs = (): AgentMemoryInputs => ({ profileId: 'lark', homesRoot, homeOf })
const folder = (provider: Provider, slug = 'lark') =>
  provider === 'claude'
    ? claudeAutoMemoryDir(homeOf(provider, slug))
    : codexAdHocNotesDir(homeOf(provider, slug))
const path = (provider: Provider, slug = 'lark') => join(folder(provider, slug), 'note.md')
const source = (provider: Provider, text = saved): MemoryAmendment => ({
  id: 'mem:lark:1',
  seq: 1,
  provider,
  entry: path(provider),
  act: 'removed',
  by: { who: 'a-person' },
  textBefore: text,
  textAfter: null,
  at: 1000,
})
const check = () => {}
const restoring = (provider: Provider, text = saved): Restoration => ({
  ...inputs(),
  source: source(provider, text),
  check,
  confirmed: true,
})
function api(): Api {
  const names = ['removeMemoryEntry', 'restoreMemoryEntry', 'undoMemoryRestoration']
  for (const name of names) expect(Reflect.get(memory, name), name).toBeTypeOf('function')
  return {
    remove: Reflect.get(memory, names[0]!) as Api['remove'],
    restore: Reflect.get(memory, names[1]!) as Api['restore'],
    undo: Reflect.get(memory, names[2]!) as Api['undo'],
  }
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'memory-files-'))
  homesRoot = join(root, 'homes')
  for (const slug of ['lark', 'wren'])
    for (const provider of ['claude', 'codex'] as const)
      mkdirSync(folder(provider, slug), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('memory changes preserve the selected text without overwriting recreated entries', () => {
  it.each(['claude', 'codex'] as const)(
    'restores saved Unicode and CRLF text in %s and refuses a second creation',
    async (provider) => {
      expect(
        (
          await api().restore({
            ...restoring(provider),
            source: { ...source(provider), act: 'corrected', textAfter: 'edited' },
          })
        ).ok,
      ).toBe(false)
      expect(existsSync(path(provider))).toBe(false)
      expect((await api().restore(restoring(provider))).ok).toBe(true)
      expect(readFileSync(path(provider))).toEqual(Buffer.from(saved))
      if (process.platform !== 'win32') expect(statSync(path(provider)).mode & 0o777).toBe(0o600)
      expect((await api().restore(restoring(provider))).ok).toBe(false)
      expect(readFileSync(path(provider))).toEqual(Buffer.from(saved))
    },
  )
  it('supports whole memory files past the smaller saved-method body limit', async () => {
    const text = 'A long saved note.\n'.repeat(2000)
    expect(Buffer.byteLength(text)).toBeGreaterThan(16 * 1024)
    expect((await api().restore(restoring('claude', text))).ok).toBe(true)
  })
  it('refuses a recreated target and actual cancellation during stage preparation', async () => {
    const entry = path('claude')
    expect(
      (
        await api().restore(restoring('claude'), {
          beforeStageCreate: () => writeFileSync(entry, 'recreated'),
        })
      ).ok,
    ).toBe(false)
    expect(readFileSync(entry, 'utf8')).toBe('recreated')
    rmSync(entry)
    let current = true
    expect(
      (
        await api().restore(
          {
            ...restoring('claude'),
            check: () => {
              if (!current) throw new Error('new source')
            },
          },
          {
            beforeStageCreate: () => {
              current = false
            },
          },
        )
      ).ok,
    ).toBe(false)
    expect(existsSync(entry)).toBe(false)
  })
  it('never creates into another profile, a moved root or a pipeline directory', async () => {
    const restore = api().restore
    const pipeline = join(codexMemoryDir(homeOf('codex')), 'raw_memories.md')
    for (const [provider, entry] of [
      ['claude', path('claude', 'wren')],
      ['codex', pipeline],
      ['claude', join(root, 'moved', 'note.md')],
    ] as const) {
      expect(
        (await restore({ ...restoring(provider), source: { ...source(provider), entry } })).ok,
      ).toBe(false)
      expect(existsSync(entry)).toBe(false)
    }
    writeFileSync(pipeline, saved)
    expect(
      api().remove({
        ...inputs(),
        provider: 'codex',
        entry: pipeline,
        confirmed: true,
        check,
      }).ok,
    ).toBe(false)
    expect(readFileSync(pipeline, 'utf8')).toBe(saved)
    const wrongRoot = join(root, 'missing-homes')
    expect((await restore({ ...restoring('claude'), homesRoot: wrongRoot })).ok).toBe(false)
    expect(existsSync(wrongRoot)).toBe(false)
  })
  it('never writes through a linked memory file into the file it leads to', async () => {
    const outside = join(root, 'outside.md')
    writeFileSync(outside, 'outside')
    symlinkSync(outside, path('claude'))
    expect((await api().restore(restoring('claude'))).ok).toBe(false)
    expect(readFileSync(outside, 'utf8')).toBe('outside')
    rmSync(path('claude'))
    rmSync(folder('claude'), { recursive: true })
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, folder('claude'), process.platform === 'win32' ? 'junction' : 'dir')
    // A memory folder the person linked elsewhere is used where it leads.
    expect((await api().restore(restoring('claude'))).ok).toBe(true)
    expect(readFileSync(outside, 'utf8')).toBe('outside')
  })
  it('refuses invalid UTF8 or oversized files instead of saving an incomplete before image', async () => {
    const entry = path('claude')
    writeFileSync(entry, Buffer.from([0xff]))
    expect(
      api().remove({
        ...inputs(),
        provider: 'claude',
        entry,
        confirmed: true,
        check,
      }).ok,
    ).toBe(false)
    expect(readFileSync(entry)).toEqual(Buffer.from([0xff]))
    rmSync(entry)
    expect((await api().restore(restoring('claude', 'x'.repeat(65537)))).ok).toBe(false)
    expect(existsSync(entry)).toBe(false)
  })
})
