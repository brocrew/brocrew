import { createHash } from 'node:crypto'
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
  fingerprint: string
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
  fingerprint: (inputs: AgentMemoryInputs, provider: Provider, entry: string) => string | null
  remove: (inputs: Selection, seams?: Seams) => Result
  restore: (inputs: Restoration, seams?: Seams) => Promise<Result>
  undo: (inputs: Restoration, seams?: Seams) => Result
}
const saved = 'Saved text.\r\nCafé.\n'
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
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
  const names = [
    'memoryEntryFingerprint',
    'removeMemoryEntry',
    'restoreMemoryEntry',
    'undoMemoryRestoration',
  ]
  for (const name of names) expect(Reflect.get(memory, name), name).toBeTypeOf('function')
  return {
    fingerprint: Reflect.get(memory, names[0]!) as Api['fingerprint'],
    remove: Reflect.get(memory, names[1]!) as Api['remove'],
    restore: Reflect.get(memory, names[2]!) as Api['restore'],
    undo: Reflect.get(memory, names[3]!) as Api['undo'],
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
      expect((await api().restore({ ...restoring(provider), confirmed: false })).ok).toBe(false)
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
    expect(api().fingerprint(inputs(), 'claude', path('claude'))).toBe(hash(text))
  })
  it('requires confirmation and the actual displayed raw fingerprint for Delete', () => {
    const entry = path('claude')
    writeFileSync(entry, saved)
    const selected: Selection = {
      ...inputs(),
      provider: 'claude',
      entry,
      fingerprint: hash(saved),
      confirmed: false,
      check,
    }
    expect(api().remove(selected).ok).toBe(false)
    writeFileSync(entry, 'external')
    expect(api().remove({ ...selected, confirmed: true }).ok).toBe(false)
    expect(readFileSync(entry, 'utf8')).toBe('external')
    expect(
      api().remove({ ...selected, confirmed: true, fingerprint: hash('external') }),
    ).toMatchObject({ ok: true, entry, textBefore: 'external', textAfter: null })
    expect(existsSync(entry)).toBe(false)
  })
  it('checks again after an interleaving immediately before unlink', () => {
    const entry = path('claude')
    writeFileSync(entry, saved)
    expect(
      api().remove(
        {
          ...inputs(),
          provider: 'claude',
          entry,
          fingerprint: hash(saved),
          confirmed: true,
          check,
        },
        {
          beforeMemoryUnlink: () => writeFileSync(entry, 'changed'),
        },
      ).ok,
    ).toBe(false)
    expect(readFileSync(entry, 'utf8')).toBe('changed')
  })
  it('refuses a recreated target and a source changed during stage preparation', async () => {
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
    const mutable = restoring('claude')
    expect(
      (
        await api().restore(mutable, {
          beforeStageCreate: () => {
            Reflect.set(mutable.source, 'textBefore', 'tampered')
          },
        })
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
    expect(api().fingerprint(inputs(), 'codex', pipeline)).toBeNull()
    expect(
      api().remove({
        ...inputs(),
        provider: 'codex',
        entry: pipeline,
        fingerprint: hash(saved),
        confirmed: true,
        check,
      }).ok,
    ).toBe(false)
    expect(readFileSync(pipeline, 'utf8')).toBe(saved)
    const wrongRoot = join(root, 'missing-homes')
    expect((await restore({ ...restoring('claude'), homesRoot: wrongRoot })).ok).toBe(false)
    expect(existsSync(wrongRoot)).toBe(false)
  })
  it('refuses linked files or folders without touching their targets', async () => {
    const outside = join(root, 'outside.md')
    writeFileSync(outside, 'outside')
    symlinkSync(outside, path('claude'))
    expect((await api().restore(restoring('claude'))).ok).toBe(false)
    expect(api().fingerprint(inputs(), 'claude', path('claude'))).toBeNull()
    expect(readFileSync(outside, 'utf8')).toBe('outside')
    rmSync(path('claude'))
    rmSync(folder('claude'), { recursive: true })
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, folder('claude'), process.platform === 'win32' ? 'junction' : 'dir')
    expect((await api().restore(restoring('claude'))).ok).toBe(false)
    expect(existsSync(join(elsewhere, 'note.md'))).toBe(false)
  })
  it('reverses only a restoration whose current bytes still match its saved text', async () => {
    const restored = {
      ...source('codex'),
      id: 'mem:lark:2',
      seq: 2,
      act: 'restored' as const,
      textBefore: null,
      textAfter: saved,
      sourceId: 'mem:lark:1',
    }
    expect((await api().restore(restoring('codex'))).ok).toBe(true)
    const command: Restoration = { ...inputs(), source: restored, confirmed: true, check }
    writeFileSync(path('codex'), 'external')
    expect(api().undo(command).ok).toBe(false)
    expect(readFileSync(path('codex'), 'utf8')).toBe('external')
    writeFileSync(path('codex'), saved)
    expect(api().undo(command)).toMatchObject({ ok: true, textBefore: saved, textAfter: null })
    expect(existsSync(path('codex'))).toBe(false)
  })
  it('refuses invalid UTF8 or oversized files instead of saving an incomplete before image', async () => {
    const entry = path('claude')
    writeFileSync(entry, Buffer.from([0xff]))
    expect(api().fingerprint(inputs(), 'claude', entry)).toBeNull()
    expect(
      api().remove({
        ...inputs(),
        provider: 'claude',
        entry,
        fingerprint: hash(Buffer.from([0xff])),
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
