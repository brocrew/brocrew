import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createDraftWriter, readDraftsFile } from '../src/main/drafts-file'
import { restoreSavedDrafts } from '../src/main/saved-drafts'
import { createDraftBook, draftKey } from '../src/renderer/src/lib/drafts'
import {
  handOver,
  savedDraftsBeforeDrawing,
  keepTheDraftBook,
  draftsToSave,
  keepDraftsOnDisk,
  restoreDrafts,
} from '../src/renderer/src/lib/kept-drafts'
import type { SavedDrafts } from '../src/shared/saved-drafts'

const disk = vi.hoisted(() => ({ hold: null as null | (() => Promise<void>) }))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      await actual.writeFile(...args)
      await disk.hold?.()
    },
  }
})
const folders: string[] = []
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'kept-draft-'))
  folders.push(path)
  return path
}
const fern = draftKey('fern')
const brook = draftKey('brook')
const packet = (slot: string, text: string): SavedDrafts => ({
  drafts: [{ slot, text, attached: [] }],
})
const read = (path: string): SavedDrafts =>
  JSON.parse(readFileSync(join(path, 'drafts.json'), 'utf8'))
afterEach(() => {
  disk.hold = null
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true })
})

it('an incomplete last book preserves the other saved slots through a fresh writer and restore', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  await writer.write(packet(fern, 'f'.repeat(8000)))
  await writer.write(packet(brook, 'b'.repeat(66)))
  writer.expectQuitSaves(1)
  const waiting = writer.quitSaves(1000)
  await writer.write({ ...packet(brook, 'b'.repeat(67)), last: true })
  expect(await waiting).toBe('saved')
  // A new process reads the file, without any of the old writer's memory.
  const file = await readDraftsFile(path)
  expect(file.kind).toBe('book')
  const saved = await restoreSavedDrafts(file.kind === 'book' ? file.raw : null, {
    exists: () => true,
  })
  const book = createDraftBook()
  restoreDrafts(book, saved)
  expect(book.read(fern).length).toBe(8000)
  expect(book.read(brook).length).toBe(67)
  await createDraftWriter(path).write(packet(brook, 'b'.repeat(68)))
  expect(read(path).drafts.find((draft) => draft.slot === fern)?.text.length).toBe(8000)
})

it('a last handover arriving after its deadline cannot replace a saved draft', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  await writer.write(packet(fern, 'f'.repeat(8000)))
  writer.expectQuitSaves(1)
  expect(await writer.quitSaves(1)).toBe('unanswered')
  await writer.write({ ...packet(fern, 'stale'), last: true, cleared: [fern] })
  expect(read(path).drafts[0]?.text.length).toBe(8000)
})

it('a last handover stalled while writing cannot rename over the saved book after the deadline', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  await writer.write(packet(fern, 'f'.repeat(8000)))
  let release!: () => void
  let started!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const began = new Promise<void>((resolve) => {
    started = resolve
  })
  disk.hold = () => {
    started()
    return held
  }
  writer.expectQuitSaves(1)
  const waiting = writer.quitSaves(30)
  const saving = writer.write({ ...packet(fern, 'stale'), last: true })
  await began
  expect(await waiting).toBe('unanswered')
  release()
  await saving
  expect(read(path).drafts[0]?.text.length).toBe(8000)
  expect(readdirSync(path)).toEqual(['drafts.json'])
})

it('an explicit normal clear removes only that slot, so a sent draft stays cleared on restart', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  await writer.write({
    drafts: [...packet(fern, 'fern words').drafts, ...packet(brook, 'brook words').drafts],
  })
  await writer.write({ drafts: [], cleared: [fern] })
  expect(read(path).drafts.map((draft) => draft.slot)).toEqual([brook])
  await createDraftWriter(path).write({ drafts: [] })
  expect(read(path).drafts.map((draft) => draft.slot)).toEqual([brook])
})

it('an empty quit snapshot cannot clear a saved slot even if it contains a removal', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  await writer.write(packet(fern, 'fern words'))
  writer.expectQuitSaves(1)
  const waiting = writer.quitSaves(1000)
  await writer.write({ drafts: [], cleared: [fern], last: true })
  expect(await waiting).toBe('saved')
  expect(read(path).drafts.map((draft) => draft.slot)).toEqual([fern])
})

it('a malformed handover cannot erase the saved book', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  await writer.write(packet(fern, 'fern words'))
  await writer.write(null)
  expect(read(path).drafts.map((draft) => draft.slot)).toEqual([fern])
})

it('the renderer names a real removal explicitly and long typing reaches the file before a failed quit', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  const book = createDraftBook()
  const saves: Promise<void>[] = []
  const keeper = keepDraftsOnDisk(
    book,
    (saved) => {
      const save = writer.write(saved)
      saves.push(save)
      return save
    },
    { closing: () => false, delayMs: 0 },
  )
  book.write(fern, 'f'.repeat(8000))
  await nextTick()
  keeper.flush()
  await Promise.all(saves)
  expect(read(path).drafts[0]?.text.length).toBe(8000)
  book.write(fern, '')
  await nextTick()
  await Promise.all(saves)
  expect(read(path).drafts).toEqual([])
  book.write(fern, 'g'.repeat(9000))
  await nextTick()
  keeper.flush()
  await Promise.all(saves)
  keeper.stop()
  await writer.settled()
  writer.expectQuitSaves(1)
  expect(await writer.quitSaves(1)).toBe('unanswered')
  const back = createDraftBook()
  restoreDrafts(back, read(path))
  expect(draftsToSave(back).drafts[0]?.text.length).toBe(9000)
})

it('a slow launch read starts saving after its late answer without overwriting typing', async () => {
  let answer!: (saved: SavedDrafts) => void
  const pending = new Promise<SavedDrafts>((resolve) => {
    answer = resolve
  })
  const handoff = handOver(await savedDraftsBeforeDrawing(() => pending, 1), pending)
  const path = folder()
  const writer = createDraftWriter(path)
  const book = createDraftBook()
  const saves: Promise<void>[] = []
  const keeper = keepTheDraftBook({
    book,
    sweep: { holdRestored: () => undefined },
    handoff,
    bridge: {
      saveDrafts: (saved) => {
        const run = writer.write(saved)
        saves.push(run)
        return run
      },
    },
    closing: () => false,
  })
  book.write(fern, 'f'.repeat(9000))
  await nextTick()
  answer({ drafts: [...packet(fern, 'old').drafts, ...packet(brook, 'brook saved').drafts] })
  await pending
  await Promise.resolve()
  await nextTick()
  await Promise.all(saves)
  expect(book.read(fern).length).toBe(9000)
  expect(book.read(brook)).toBe('brook saved')
  expect(read(path).drafts.find((draft) => draft.slot === fern)?.text.length).toBe(9000)
  keeper.stop()
  await writer.settled()
})

it('a failed final disk write leaves the previous saved draft available to a new process', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  await writer.write(packet(fern, 'f'.repeat(8000)))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  disk.hold = async () => {
    throw new Error('fictional disk failure')
  }
  try {
    writer.expectQuitSaves(1)
    const waiting = writer.quitSaves(1000)
    await writer.write({ ...packet(fern, 'stale'), last: true })
    expect(await waiting).toBe('failed')
    expect(read(path).drafts[0]?.text.length).toBe(8000)
  } finally {
    warn.mockRestore()
  }
})

it('sending a locally typed draft before the initial read answers does not resurrect it', async () => {
  let answer!: (saved: SavedDrafts) => void
  const pending = new Promise<SavedDrafts>((resolve) => {
    answer = resolve
  })
  const path = folder()
  const writer = createDraftWriter(path)
  const old = packet(fern, 'older draft')
  await writer.write(old)
  const handoff = handOver(await savedDraftsBeforeDrawing(() => pending, 1), pending)
  const book = createDraftBook()
  const saves: Promise<void>[] = []
  const keeper = keepTheDraftBook({
    book,
    sweep: { holdRestored: () => undefined },
    handoff,
    bridge: {
      saveDrafts: (saved) => {
        const run = writer.write(saved)
        saves.push(run)
        return run
      },
    },
    closing: () => false,
  })
  book.write(fern, 'a new local message')
  book.write(fern, '')
  answer(old)
  await pending
  await Promise.resolve()
  await nextTick()
  await Promise.all(saves)
  expect(book.read(fern)).toBe('')
  expect(read(path).drafts).toEqual([])
  keeper.stop()
  await writer.settled()
})

it('the quit receipt contains save counts, time and per-slot sizes without any draft text', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  const text = 'a fictional unsent message that must not appear in a log'
  await writer.write(packet(fern, text))
  await writer.write(packet(brook, 'brook words'))
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  try {
    writer.expectQuitSaves(1)
    expect(info).toHaveBeenCalledTimes(1)
    const [label, encoded] = info.mock.calls[0]!
    expect(label).toBe('BroCrew draft save status:')
    const receipt = JSON.parse(encoded as string)
    expect(receipt.accepted).toBe(2)
    expect(receipt.saved).toBe(2)
    expect(receipt.lastSavedAt).toEqual(expect.any(Number))
    expect(receipt.loaded).toBe(true)
    expect(receipt.slots).toEqual([
      { slot: fern, characters: text.length, attachments: 0 },
      { slot: brook, characters: 11, attachments: 0 },
    ])
    expect(encoded).not.toContain(text)
    expect(encoded).not.toContain('brook words')
    expect(receipt.slots.every((slot: object) => !('text' in slot))).toBe(true)
  } finally {
    info.mockRestore()
  }
})

it.each(['rejected', 'held'])(
  'a %s initial renderer read still saves new typing and answers the final handover',
  async (kind) => {
    const path = folder()
    const seeded = createDraftWriter(path)
    await seeded.write({
      drafts: [...packet(fern, 'old fern').drafts, ...packet(brook, 'old brook').drafts],
    })
    const writer = createDraftWriter(path)
    const ready: Promise<SavedDrafts | null> =
      kind === 'held'
        ? new Promise(() => undefined)
        : Promise.reject(new Error('fictional IPC failure')).catch(() => null)
    const handoff = handOver(await savedDraftsBeforeDrawing(() => ready, 1), ready)
    const book = createDraftBook()
    let last: (() => void) | undefined
    const keeper = keepTheDraftBook({
      book,
      sweep: { holdRestored: () => undefined },
      handoff,
      bridge: {
        saveDrafts: (saved) => writer.write(saved),
        onLastDraftSave: (listener) => {
          last = listener
          return () => {
            last = undefined
          }
        },
      },
      closing: () => false,
    })
    try {
      book.write(fern, 'f'.repeat(9000))
      await nextTick()
      expect(last).toEqual(expect.any(Function))
      writer.expectQuitSaves(1)
      const waiting = writer.quitSaves(1000)
      last!()
      expect(await waiting).toBe('saved')
      expect(read(path).drafts.find((draft) => draft.slot === fern)?.text.length).toBe(9000)
      expect(read(path).drafts.find((draft) => draft.slot === brook)?.text).toBe('old brook')
    } finally {
      keeper.stop()
      await writer.settled()
      await writer.settled()
    }
  },
)

it('a failed explicit removal is retained when a later successful save changes another slot', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  await writer.write(packet(fern, 'sent words'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  disk.hold = async () => {
    throw new Error('fictional disk failure')
  }
  try {
    await writer.write({ drafts: [], cleared: [fern] })
    expect(read(path).drafts.map((draft) => draft.slot)).toEqual([fern])
    disk.hold = null
    await writer.write(packet(brook, 'new brook words'))
    const restarted = createDraftBook()
    restoreDrafts(restarted, read(path))
    expect(restarted.read(fern)).toBe('')
    expect(restarted.read(brook)).toBe('new brook words')
  } finally {
    warn.mockRestore()
  }
})

it('a newer edit queued during a failed removal wins when the next save retries both', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  await writer.write(packet(fern, 'sent words'))
  let release!: () => void
  let started!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const began = new Promise<void>((resolve) => {
    started = resolve
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  disk.hold = async () => {
    started()
    await held
    throw new Error('fictional disk failure')
  }
  try {
    const removal = writer.write({ drafts: [], cleared: [fern] })
    await began
    const newer = writer.write(packet(fern, 'a new message'))
    release()
    await Promise.all([removal, newer])
    disk.hold = null
    await writer.write(packet(brook, 'brook words'))
    expect(read(path).drafts.find((draft) => draft.slot === fern)?.text).toBe('a new message')
  } finally {
    release()
    warn.mockRestore()
  }
})

it('main protects a file it cannot read even while the renderer independently hands over new slots', async () => {
  const path = folder()
  const raw = JSON.stringify({ version: 2, ...packet(brook, 'kept for another build') })
  writeFileSync(join(path, 'drafts.json'), raw)
  const writer = createDraftWriter(path)
  await writer.write(packet(fern, 'new local words'))
  expect(readFileSync(join(path, 'drafts.json'), 'utf8')).toBe(raw)
})

it('a slot sent and a keeper stopped in the same tick still persists its explicit removal', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  const book = createDraftBook()
  book.write(fern, 'sent words')
  await writer.write(draftsToSave(book))
  const saves: Promise<void>[] = []
  const keeper = keepTheDraftBook({
    book,
    sweep: { holdRestored: () => undefined },
    handoff: handOver({ drafts: [] }),
    bridge: {
      saveDrafts: (saved) => {
        const run = writer.write(saved)
        saves.push(run)
        return run
      },
    },
    closing: () => false,
  })
  book.write(fern, '')
  keeper.stop()
  await writer.settled()
  await Promise.all(saves)
  expect(read(path).drafts).toEqual([])
})

it('a late-restored draft sent before the debounce is absent after restart', async () => {
  const path = folder()
  const writer = createDraftWriter(path)
  const saved = packet(brook, 'a fictional restored message')
  await writer.write(saved)
  let answer!: (saved: SavedDrafts) => void
  const ready = new Promise<SavedDrafts>((resolve) => {
    answer = resolve
  })
  const handoff = handOver(await savedDraftsBeforeDrawing(() => ready, 1), ready)
  const book = createDraftBook()
  const saves: Promise<void>[] = []
  // Keep the debounce from running while real file writes finish, even on a busy machine.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const keeping = keepTheDraftBook({
    book,
    sweep: { holdRestored: () => undefined },
    handoff,
    bridge: {
      saveDrafts: (packet) => {
        const save = writer.write(packet)
        saves.push(save)
        return save
      },
    },
    closing: () => false,
  })
  try {
    answer(saved)
    await ready
    await Promise.resolve()
    await nextTick()
    await Promise.all(saves)
    expect(saves).toHaveLength(1)
    expect(book.read(brook)).toBe('a fictional restored message')
    expect(read(path).drafts.map((draft) => draft.slot)).toEqual([brook])
    // No timer is advanced: send happens before the keeper's 200 ms debounce.
    book.write(brook, '')
    await nextTick()
    await Promise.all(saves)
    const file = await readDraftsFile(path)
    const restarted = createDraftBook()
    const restored = await restoreSavedDrafts(file.kind === 'book' ? file.raw : null, {
      exists: () => true,
    })
    restoreDrafts(restarted, restored)
    expect(restarted.read(brook)).toBe('')
    expect(restored.drafts).toEqual([])
  } finally {
    keeping.stop()
    await writer.settled()
    vi.useRealTimers()
  }
})

it.each([false, true])(
  'a local send before the first read answers stays cleared through quit (same tick: %s)',
  async (sameTick) => {
    const path = folder()
    const writer = createDraftWriter(path)
    await writer.write(packet(fern, 'an older fictional draft'))
    const ready = new Promise<SavedDrafts>(() => undefined)
    const handoff = handOver(await savedDraftsBeforeDrawing(() => ready, 1), ready)
    const book = createDraftBook()
    const saves: Promise<void>[] = []
    let last: (() => void) | undefined
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const keeping = keepTheDraftBook({
      book,
      sweep: { holdRestored: () => undefined },
      handoff,
      bridge: {
        saveDrafts: (packet) => {
          const save = writer.write(packet)
          saves.push(save)
          return save
        },
        onLastDraftSave: (listener) => {
          last = listener
          return () => {
            last = undefined
          }
        },
      },
      closing: () => false,
    })
    try {
      book.write(fern, 'a new fictional message')
      if (!sameTick) await nextTick()
      book.write(fern, '')
      await nextTick()
      await Promise.all(saves)
      // No debounce timer has fired, and the initial read stays held through the final save.
      expect(last).toEqual(expect.any(Function))
      writer.expectQuitSaves(1)
      const quitting = writer.quitSaves(1000)
      last!()
      expect(await quitting).toBe('saved')
      const file = await readDraftsFile(path)
      const saved = await restoreSavedDrafts(file.kind === 'book' ? file.raw : null, {
        exists: () => true,
      })
      const restarted = createDraftBook()
      restoreDrafts(restarted, saved)
      expect(restarted.read(fern)).toBe('')
      expect(saved.drafts).toEqual([])
    } finally {
      keeping.stop()
      await writer.settled()
      vi.useRealTimers()
    }
  },
)
