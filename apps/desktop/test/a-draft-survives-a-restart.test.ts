import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'
import {
  createDraftWriter,
  keepDraftedPastes,
  readDraftsFile,
  SAVED_DRAFTS_FILE,
} from '../src/main/drafts-file'
import { restoreSavedDrafts, savedDraftsFrom } from '../src/main/saved-drafts'
import { pastedImagesRoot, sweepPastedImages } from '../src/main/runtime/pasted-image'
import {
  createDraftBook,
  draftKey,
  NEW_CONVERSATION,
  stageVerdicts,
  sweepDrafts,
  type DraftBook,
  type DraftSweep,
} from '../src/renderer/src/lib/drafts'
import {
  DRAFT_SAVE_DELAY_MS,
  draftsToSave,
  handOver,
  keepDraftsOnDisk,
  keepTheDraftBook,
  restoreDrafts,
  savedDraftsBeforeDrawing,
  SAVED_DRAFTS_WITHIN_MS,
} from '../src/renderer/src/lib/kept-drafts'
import type { HandedPath } from '../src/shared/runtime-ipc'
import {
  conversationOfSlot,
  LAST_DRAFT_SAVE_CHANNEL,
  LAUNCHER_SLOT,
  type SavedDrafts,
} from '../src/shared/saved-drafts'
import { createAppLifetime } from '../src/main/app-lifetime'

/**
 * # 🔴 744 · R100 — what a person typed and did not send survives a restart
 *
 * Save every draft slot and its attached paths in userData shortly after each change and on
 * quit. Restore them to the same slot at launch with the cursor at the end, and clear a draft
 * when sent. Saving a draft sends nothing.
 *
 * ⚠️ **What each half can prove.** This file holds the RULES — the book copied out and put back
 * (§1), the sweep that would have thrown a restored draft away (§2), the bounded read before the
 * window draws and the one handoff (§3), main's file (§4), the wiring nothing mounts (§5), a
 * missing path attached again (§6), and the quit's own step and the file's reads (§7). 🔴 **The restart itself —
 * and the KILL R100 names — is measured on the built app** by `scripts/draft-survives-a-restart-probe.mjs`:
 * on `main` every arm comes back empty; on this branch every arm comes back with the caret at the end.
 * The caret, the chip that says *missing*, and a real send clearing the slot are in
 * `test/dom/a-draft-survives-a-restart.dom.test.ts`.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const A = 'conversation-a'
const B = 'conversation-b'
const FILE = (path: string): HandedPath => ({ path, kind: 'file', outsideCwd: false })

/** A book with the launcher's words and a path, A's words, and B's path alone. */
function aFullBook(): DraftBook {
  const book = createDraftBook()
  book.write(NEW_CONVERSATION, 'the launcher’s half-written prompt')
  book.paths.write(NEW_CONVERSATION, [FILE('/work/brief.md')])
  book.write(draftKey(A), 'words for A')
  book.paths.write(draftKey(B), [
    {
      path: '/work/shot.png',
      kind: 'file',
      outsideCwd: true,
      pasted: { width: 4, height: 3, bytes: 99 },
    },
  ])
  return book
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the book, to disk and back
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the book goes to disk shortly after each change, and comes back into the same slots', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('🔴 every slot — the launcher’s, a conversation’s words, a conversation’s paths alone — comes back where it was', async () => {
    const book = aFullBook()
    const saves: SavedDrafts[] = []
    const keeper = keepDraftsOnDisk(book, (saved) => void saves.push(saved), {
      closing: () => false,
    })
    book.write(draftKey(A), 'words for A, and more')
    await nextTick()
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS)
    keeper.stop()

    expect(saves).toHaveLength(1)
    const back = createDraftBook()
    expect(restoreDrafts(back, saves[0]!).sort()).toEqual([A, B])
    expect(back.read(NEW_CONVERSATION)).toBe('the launcher’s half-written prompt')
    expect(back.paths.read(NEW_CONVERSATION)).toEqual([FILE('/work/brief.md')])
    expect(back.read(draftKey(A))).toBe('words for A, and more')
    expect(back.paths.read(draftKey(A))).toEqual([])
    // ⛔ `019`: never the wrong conversation — B's picture is B's, and B has no words of A's
    expect(back.read(draftKey(B))).toBe('')
    expect(back.paths.read(draftKey(B))).toEqual([
      {
        path: '/work/shot.png',
        kind: 'file',
        outsideCwd: true,
        pasted: { width: 4, height: 3, bytes: 99 },
      },
    ])
  })

  it('⛔ what is handed to the bridge is PLAIN data — a Vue proxy cannot cross it', () => {
    const saved = draftsToSave(aFullBook())
    // ⚑ The bridge structured-clones its argument; a reactive proxy throws `DataCloneError` there.
    expect(() => structuredClone(saved)).not.toThrow()
    expect(structuredClone(saved)).toEqual(saved)
  })

  it('🔴 the delay counts from the FIRST unsaved change — steady typing is still written within R100’s bound', async () => {
    const book = createDraftBook()
    const saves: SavedDrafts[] = []
    const keeper = keepDraftsOnDisk(book, (saved) => void saves.push(saved), {
      closing: () => false,
    })
    // ⚑ a keystroke every 50 ms, never a pause long enough for a debounce to fire
    let typed = ''
    for (let each = 0; each < 20; each += 1) {
      typed += 'x'
      book.write(NEW_CONVERSATION, typed)
      await nextTick()
      vi.advanceTimersByTime(50)
    }
    keeper.stop()
    // ⛔ R100's kill case: whatever was typed half a second before a kill is on disk
    expect(saves.length).toBeGreaterThanOrEqual(1000 / DRAFT_SAVE_DELAY_MS - 1)
    expect(DRAFT_SAVE_DELAY_MS).toBeLessThan(500)
  })

  it('🔴 written AT ONCE when the app says it is closing — inside the delay', async () => {
    const book = createDraftBook()
    const closing = ref(false)
    const saves: SavedDrafts[] = []
    const keeper = keepDraftsOnDisk(book, (saved) => void saves.push(saved), {
      closing: () => closing.value,
    })
    book.write(draftKey(A), 'typed a moment before the quit')
    await nextTick()
    closing.value = true
    await nextTick()
    // ⚑ no clock has moved
    expect(saves.map((saved) => saved.drafts)).toEqual([
      [{ slot: draftKey(A), text: 'typed a moment before the quit', attached: [] }],
    ])
    keeper.stop()
  })

  it('🔴 written AT ONCE when the page goes away — a window closed or reloaded with no quit', async () => {
    const book = createDraftBook()
    const page = new EventTarget()
    const saves: SavedDrafts[] = []
    const keeper = keepDraftsOnDisk(book, (saved) => void saves.push(saved), {
      closing: () => false,
      page,
    })
    book.write(draftKey(A), 'typed a moment before the reload')
    await nextTick()
    page.dispatchEvent(new Event('pagehide'))
    expect(saves).toHaveLength(1)
    expect(saves[0]!.drafts[0]!.text).toBe('typed a moment before the reload')
    keeper.stop()
    // ⚑ …and a stopped keeper hears nothing
    page.dispatchEvent(new Event('pagehide'))
    expect(saves).toHaveLength(1)
  })

  it('🔴 a quit’s own endings empty NOTHING — and what the quit puts back is handed over at once', async () => {
    const book = createDraftBook()
    book.write(draftKey(B), 'half a thought in B, off screen')
    const open = ref<{ sessionId: string }[]>([{ sessionId: B }])
    const closing = ref(false)
    const sweep = sweepDrafts(
      book,
      () => open.value,
      () => NEW_CONVERSATION,
      () => [],
      () => closing.value,
    )
    const saves: SavedDrafts[] = []
    const keeper = keepDraftsOnDisk(book, (saved) => void saves.push(saved), {
      closing: () => closing.value,
      page: new EventTarget(),
    })
    await nextTick()
    closing.value = true
    await nextTick()
    // ⚑ the quit ends B: it leaves `open`, and the sweep does NOT empty its slot
    open.value = []
    await nextTick()
    expect(book.read(draftKey(B))).toBe('half a thought in B, off screen')
    // ⚑ the quit refuses A's send, and A's words come back — handed over with no delay at all
    book.restore(draftKey(A), 'a send the quit refused', [])
    await nextTick()
    expect(
      saves
        .at(-1)!
        .drafts.map((draft) => draft.slot)
        .sort(),
    ).toEqual([draftKey(A), draftKey(B)])
    keeper.stop()
    sweep.stop()
  })

  it('⚑ the control — with no quit, the same ending DOES take the draft (`019`)', async () => {
    const book = createDraftBook()
    book.write(draftKey(B), 'half a thought in B, off screen')
    const open = ref<{ sessionId: string }[]>([{ sessionId: B }])
    const sweep = sweepDrafts(
      book,
      () => open.value,
      () => NEW_CONVERSATION,
      () => [],
      () => false,
    )
    await nextTick()
    open.value = []
    await nextTick()
    expect(book.read(draftKey(B))).toBe('')
    sweep.stop()
  })

  it('🔴 a slot that EMPTIES is handed over at once — a message sent, then a kill inside the delay, never comes back as a draft', async () => {
    const book = createDraftBook()
    const saves: SavedDrafts[] = []
    const keeper = keepDraftsOnDisk(book, (saved) => void saves.push(saved), {
      closing: () => false,
      page: new EventTarget(),
    })
    book.write(draftKey(A), 'deploy to staging')
    await nextTick()
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS)
    expect(saves.at(-1)!.drafts).toHaveLength(1)
    // ⚑ sent: the composer empties the slot — and no clock moves before the book is handed over
    book.write(draftKey(A), '')
    await nextTick()
    expect(saves.at(-1)!.drafts).toEqual([])
    keeper.stop()
  })

  it('🔴 the quit’s request for the LAST book is answered with the book as it is, marked `last`', async () => {
    const book = createDraftBook()
    book.write(NEW_CONVERSATION, 'the words at the very end')
    let ask: (() => void) | undefined
    const saves: SavedDrafts[] = []
    const keeper = keepDraftsOnDisk(book, (saved) => void saves.push(saved), {
      closing: () => true,
      page: new EventTarget(),
      onLastSave: (answer) => {
        ask = answer
        return () => (ask = undefined)
      },
    })
    ask?.()
    expect(saves).toEqual([
      {
        drafts: [{ slot: NEW_CONVERSATION, text: 'the words at the very end', attached: [] }],
        last: true,
      },
    ])
    keeper.stop()
    // ⚑ a stopped keeper answers nothing
    expect(ask).toBeUndefined()
  })

  it('⚑ the control — a SENT message leaves no draft behind: the composer empties the slot, and the next save has no entry for it', async () => {
    const book = aFullBook()
    const saves: SavedDrafts[] = []
    const keeper = keepDraftsOnDisk(book, (saved) => void saves.push(saved), {
      closing: () => false,
    })
    // ⚑ what `PromptComposer.send` does to the slot it sent from: the words, then the paths
    book.write(NEW_CONVERSATION, '')
    book.paths.write(NEW_CONVERSATION, [])
    await nextTick()
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS)
    keeper.stop()
    expect(
      saves
        .at(-1)!
        .drafts.map((draft) => draft.slot)
        .sort(),
    ).toEqual([draftKey(A), draftKey(B)])
  })

  it('⛔ a restore never writes over words typed since — it goes back through the book’s own `restore`', () => {
    const book = createDraftBook()
    book.write(draftKey(A), 'typed after launch')
    restoreDrafts(book, {
      drafts: [{ slot: draftKey(A), text: 'from the last run', attached: [] }],
    })
    expect(book.read(draftKey(A))).toBe('typed after launch')
  })

  it('⛔ a slot this build cannot place is dropped at restore — never guessed into another one', () => {
    const book = createDraftBook()
    expect(
      restoreDrafts(book, { drafts: [{ slot: 'thread-a', text: 'lost', attached: [] }] }),
    ).toEqual([])
    expect(book.keys()).toEqual([])
  })

  it('⚑ one key space, read by both sides — the book’s slots are the ones main reads', () => {
    expect(LAUNCHER_SLOT).toBe(NEW_CONVERSATION)
    expect(conversationOfSlot(NEW_CONVERSATION)).toBeNull()
    expect(conversationOfSlot(draftKey(A))).toBe(A)
    expect(conversationOfSlot('session:')).toBeUndefined()
    expect(conversationOfSlot('thread-a')).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the sweep holds what was restored
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · a restored draft is held until its conversation is OPEN here — then `019` decides', () => {
  async function launch(
    saved: SavedDrafts,
    hold = true,
  ): Promise<{
    book: DraftBook
    open: Ref<{ sessionId: string }[]>
    keptOpen: Ref<string[]>
    sweep: DraftSweep
  }> {
    const book = createDraftBook()
    const open = ref<{ sessionId: string }[]>([])
    const keptOpen = ref<string[]>([])
    const sweep = sweepDrafts(
      book,
      () => open.value,
      () => NEW_CONVERSATION,
      () => keptOpen.value,
    )
    const restored = restoreDrafts(book, saved)
    if (hold) sweep.holdRestored(restored)
    await nextTick()
    return { book, open, keptOpen, sweep }
  }
  const one = (id: string, text: string): SavedDrafts => ({
    drafts: [{ slot: draftKey(id), text, attached: [] }],
  })

  it('🔴 at launch nothing is open and the rail has not answered, and the restored draft SURVIVES the sweep', async () => {
    const { book, keptOpen, sweep } = await launch({
      drafts: [{ slot: draftKey(A), text: 'words for A', attached: [FILE('/work/a.md')] }],
    })
    // ⚑ the rail answers — about another conversation — and the sweep runs over A's slot
    keptOpen.value = [B]
    await nextTick()
    expect(book.read(draftKey(A))).toBe('words for A')
    expect(book.paths.read(draftKey(A))).toHaveLength(1)
    sweep.stop()
  })

  it('⚑ the control — the same launch WITHOUT the hold throws the restored draft away at that sweep', async () => {
    const { book, keptOpen, sweep } = await launch(one(A, 'words for A'), false)
    keptOpen.value = [B]
    await nextTick()
    expect(book.read(draftKey(A))).toBe('')
    sweep.stop()
  })

  it('🔴 listed as kept open and then GONE from the list without being opened here — started by its parent, or ended from its pane — the restored draft waits (R100 over `019`)', async () => {
    const { book, keptOpen, sweep } = await launch(one(A, 'words for A'))
    keptOpen.value = [A]
    await nextTick()
    // ⚑ it leaves the kept-open list, and never enters `open` here
    keptOpen.value = []
    await nextTick()
    expect(book.read(draftKey(A))).toBe('words for A')
    sweep.stop()
  })

  it('⚑ once it is OPEN here, `019` decides: closed and walked away from, the draft goes', async () => {
    const { book, open, sweep } = await launch(one(A, 'words for A'))
    open.value = [{ sessionId: A }]
    await nextTick()
    open.value = []
    await nextTick()
    expect(book.read(draftKey(A))).toBe('')
    sweep.stop()
  })

  it('⚑ a restored draft whose conversation is never seen — a closed one — WAITS for it, through every sweep', async () => {
    const { book, open, keptOpen, sweep } = await launch(one(A, 'words for a closed conversation'))
    keptOpen.value = [B]
    open.value = [{ sessionId: B }]
    await nextTick()
    open.value = []
    await nextTick()
    expect(book.read(draftKey(A))).toBe('words for a closed conversation')
    sweep.stop()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · read before the window draws, once; a later setup asks again
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the last run’s drafts are read BEFORE the window draws, bounded — and handed over ONCE', () => {
  const SAVED: SavedDrafts = { drafts: [{ slot: NEW_CONVERSATION, text: 'kept', attached: [] }] }

  it('🔴 the answer, when main gives one', async () => {
    expect(await savedDraftsBeforeDrawing(() => Promise.resolve(SAVED))).toEqual(SAVED)
  })

  it('⛔ `null` — read nothing, SAVE nothing — with no bridge, main’s own *not read*, an error, or past the bound', async () => {
    expect(await savedDraftsBeforeDrawing(undefined)).toBeNull()
    expect(await savedDraftsBeforeDrawing(() => Promise.resolve(null))).toBeNull()
    expect(await savedDraftsBeforeDrawing(() => Promise.reject(new Error('no handler')))).toBeNull()
    vi.useFakeTimers()
    try {
      // ⚠️ Read by a flag rather than awaited: an unbounded read would park the await for ever,
      // and a test red by its own timeout says nothing about why.
      let answer: SavedDrafts | null | 'still waiting' = 'still waiting'
      void savedDraftsBeforeDrawing(() => new Promise<SavedDrafts>(() => undefined)).then(
        (value) => (answer = value),
      )
      vi.advanceTimersByTime(SAVED_DRAFTS_WITHIN_MS)
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
      expect(answer).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('⛔ the handoff answers ONCE — a second setup of the page is told it was already taken', () => {
    const handoff = handOver(SAVED)
    expect(handoff.take()).toEqual(SAVED)
    expect(handoff.take()).toBeUndefined()
    expect(handOver(null).take()).toBeNull()
  })

  /** A bridge that records what it is asked and answers `answer` for the saved book. */
  function aBridge(answer: SavedDrafts): {
    bridge: {
      savedDrafts: () => Promise<SavedDrafts>
      saveDrafts: (saved: SavedDrafts) => Promise<void>
    }
    asked: number[]
    saves: SavedDrafts[]
  } {
    const asked: number[] = []
    const saves: SavedDrafts[] = []
    return {
      asked,
      saves,
      bridge: {
        savedDrafts: () => {
          asked.push(1)
          return Promise.resolve(answer)
        },
        saveDrafts: (saved) => {
          saves.push(saved)
          return Promise.resolve()
        },
      },
    }
  }
  const aSweep = (): { holdRestored: (ids: readonly string[]) => void; held: string[] } => {
    const held: string[] = []
    return { held, holdRestored: (ids) => void held.push(...ids) }
  }

  it('🔴 the FIRST setup restores what was read before drawing — synchronously — holds it, and keeps the book from then on', async () => {
    vi.useFakeTimers()
    try {
      const book = createDraftBook()
      const sweep = aSweep()
      const { bridge, asked, saves } = aBridge({ drafts: [] })
      const keeping = keepTheDraftBook({
        book,
        sweep,
        handoff: handOver({
          drafts: [{ slot: draftKey(A), text: 'from the last run', attached: [] }],
        }),
        bridge,
        closing: () => false,
        page: new EventTarget(),
      })
      // ⚑ in place before anything could draw, and main was not asked again
      expect(book.read(draftKey(A))).toBe('from the last run')
      expect(sweep.held).toEqual([A])
      expect(asked).toEqual([])
      book.write(NEW_CONVERSATION, 'typed now')
      await nextTick()
      vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS)
      expect(
        saves
          .at(-1)!
          .drafts.map((draft) => draft.slot)
          .sort(),
      ).toEqual([NEW_CONVERSATION, draftKey(A)])
      keeping.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a failed restore still keeps newly typed slots through the merging writer', async () => {
    vi.useFakeTimers()
    try {
      const book = createDraftBook()
      const { bridge, saves } = aBridge({ drafts: [] })
      const keeping = keepTheDraftBook({
        book,
        sweep: aSweep(),
        handoff: handOver(null),
        bridge,
        closing: () => false,
        page: new EventTarget(),
      })
      book.write(NEW_CONVERSATION, 'typed now')
      await nextTick()
      vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS)
      keeping.stop()
      expect(saves.at(-1)?.drafts).toEqual([
        { slot: NEW_CONVERSATION, text: 'typed now', attached: [] },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('🔴 a SECOND setup (a hot reload) asks main again — never the launch’s book — after the first handed its own over as it stopped', async () => {
    const handoff = handOver({
      drafts: [{ slot: draftKey(A), text: 'sent since launch', attached: [] }],
    })
    const first = createDraftBook()
    const one = aBridge({ drafts: [] })
    const keepingFirst = keepTheDraftBook({
      book: first,
      sweep: aSweep(),
      handoff,
      bridge: one.bridge,
      closing: () => false,
      page: new EventTarget(),
    })
    // ⚑ A's message is sent in this run, and the launcher is typed into
    first.write(draftKey(A), '')
    first.write(NEW_CONVERSATION, 'typed since launch')
    keepingFirst.stop()
    // ⚑ the first setup handed over its book as it stopped
    expect(one.saves.at(-1)).toEqual({
      drafts: [{ slot: NEW_CONVERSATION, text: 'typed since launch', attached: [] }],
      cleared: [draftKey(A)],
    })

    const second = createDraftBook()
    const sweep = aSweep()
    const two = aBridge(one.saves.at(-1)!)
    const keepingSecond = keepTheDraftBook({
      book: second,
      sweep,
      handoff,
      bridge: two.bridge,
      closing: () => false,
      page: new EventTarget(),
    })
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(two.asked).toEqual([1])
    expect(second.read(NEW_CONVERSATION)).toBe('typed since launch')
    // ⛔ never the message sent since launch
    expect(second.read(draftKey(A))).toBe('')
    keepingSecond.stop()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · main's file
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the file — in the app’s own userData, whole, and read as untrusted', () => {
  let userData: string
  beforeEach(() => {
    userData = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-744-')))
  })
  afterEach(() => {
    chmodSync(userData, 0o700)
    rmSync(userData, { recursive: true, force: true })
  })

  const everyone = { exists: (): boolean => true }
  const readBack = async (
    deps: { exists: (id: string) => boolean } = everyone,
  ): Promise<SavedDrafts> => {
    const file = await readDraftsFile(userData)
    return restoreSavedDrafts(file.kind === 'book' ? file.raw : null, deps)
  }

  it('🔴 what is written comes back, and it is ONE file in the app’s own userData, readable by this user only', async () => {
    const present = join(userData, 'present.md')
    writeFileSync(present, 'x')
    const saved: SavedDrafts = {
      drafts: [
        { slot: NEW_CONVERSATION, text: 'launcher words', attached: [FILE(present)] },
        { slot: draftKey(A), text: 'words for A', attached: [] },
      ],
    }
    await createDraftWriter(userData).write(saved)

    // ⛔ R100: kept in the app's own userData — one file, no part left behind
    expect(readdirSync(userData).sort()).toEqual([SAVED_DRAFTS_FILE, 'present.md'])
    // Windows uses access lists; chmod does not supply POSIX permission bits.
    if (process.platform !== 'win32')
      expect(statSync(join(userData, SAVED_DRAFTS_FILE)).mode & 0o777).toBe(0o600)
    expect(await readBack()).toEqual(saved)
  })

  it('⚑ the control — a conversation that no longer exists is DROPPED at restore; the rest come back', async () => {
    await createDraftWriter(userData).write({
      drafts: [
        { slot: NEW_CONVERSATION, text: 'launcher words', attached: [] },
        { slot: draftKey(A), text: 'words for A', attached: [] },
        { slot: draftKey(B), text: 'words for a conversation that is gone', attached: [] },
      ],
    })
    const back = await readBack({ exists: (id: string) => id === A })
    expect(back.drafts.map((draft) => draft.slot)).toEqual([NEW_CONVERSATION, draftKey(A)])
  })

  it('⚑ the control — a path that is gone comes back MARKED missing, never dropped; one that is there is not marked', async () => {
    const present = join(userData, 'present.md')
    writeFileSync(present, 'x')
    const gone = join(userData, 'moved-away.md')
    await createDraftWriter(userData).write({
      drafts: [{ slot: draftKey(A), text: '', attached: [FILE(present), FILE(gone)] }],
    })
    expect((await readBack()).drafts[0]!.attached).toEqual([
      FILE(present),
      { ...FILE(gone), missing: true },
    ])
  })

  it('⛔ `missing` is never read FROM the file — it is decided afresh at each launch', async () => {
    const present = join(userData, 'present.md')
    writeFileSync(present, 'x')
    writeFileSync(
      join(userData, SAVED_DRAFTS_FILE),
      JSON.stringify({
        version: 1,
        drafts: [{ slot: draftKey(A), text: '', attached: [{ ...FILE(present), missing: true }] }],
      }),
    )
    expect((await readBack()).drafts[0]!.attached).toEqual([FILE(present)])
  })

  it('⛔ after one “is it gone?” that never answers, no other is ASKED — one stuck filesystem worker at most', async () => {
    const asked: string[] = []
    const back = await restoreSavedDrafts(
      {
        drafts: [
          { slot: draftKey(A), text: '', attached: [FILE('/stalled/a.md'), FILE('/stalled/b.md')] },
        ],
      },
      {
        exists: () => true,
        isGone: (path) => {
          asked.push(path)
          return new Promise<boolean>(() => undefined)
        },
        stillThereWithinMs: 20,
      },
    )
    expect(asked).toEqual(['/stalled/a.md'])
    expect(back.drafts[0]!.attached).toEqual([FILE('/stalled/a.md'), FILE('/stalled/b.md')])
  })

  it('⛔ ALL the questions together stop at one bound — slow-but-answering paths never outlast the window’s wait', async () => {
    let clock = 0
    const asked: string[] = []
    const paths = ['/slow/a.md', '/slow/b.md', '/slow/c.md', '/slow/d.md', '/slow/e.md']
    const back = await restoreSavedDrafts(
      { drafts: [{ slot: draftKey(A), text: '', attached: paths.map(FILE) }] },
      {
        exists: () => true,
        // ⚑ each answers — "gone" — after 40 ms on the restore's own clock
        isGone: (path) => {
          asked.push(path)
          clock += 40
          return Promise.resolve(true)
        },
        now: () => clock,
        restoreWithinMs: 100,
      },
    )
    expect(asked).toEqual(['/slow/a.md', '/slow/b.md', '/slow/c.md'])
    expect(back.drafts[0]!.attached.map((each) => each.missing === true)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
  })

  it('⛔ a path whose “is it gone?” never answers is restored UNMARKED within the bound — never holding the rest back', async () => {
    // ⚠️ Raced against a marker rather than awaited: an unbounded restore would park the await for
    // ever, and a test red by its own timeout says nothing about why.
    const back = await Promise.race([
      restoreSavedDrafts(
        {
          drafts: [{ slot: draftKey(A), text: 'words', attached: [FILE('/stalled/volume/a.md')] }],
        },
        {
          exists: () => true,
          isGone: () => new Promise<boolean>(() => undefined),
          stillThereWithinMs: 20,
        },
      ),
      new Promise<'still waiting'>((resolve) => setTimeout(() => resolve('still waiting'), 1_000)),
    ])
    expect(back).not.toBe('still waiting')
    if (back === 'still waiting') return
    expect(back.drafts[0]!.attached).toEqual([FILE('/stalled/volume/a.md')])
  })

  it('⛔ what a reader cannot recognise is dropped rather than guessed at', () => {
    const shaped = savedDraftsFrom({
      drafts: [
        { slot: 'thread-a', text: 'no such slot', attached: [] },
        { slot: 'session:\nX', text: 'a control character', attached: [] },
        { slot: draftKey(A), text: 7, attached: [] },
        { slot: draftKey(B), text: '', attached: [] },
        {
          slot: NEW_CONVERSATION,
          text: 'kept',
          attached: [
            { path: 'relative.md', kind: 'file', outsideCwd: false },
            { path: '/work/a\nb.md', kind: 'file', outsideCwd: false },
            { path: '/work/pipe', kind: 'fifo', outsideCwd: false },
            { path: '/work/c.md', kind: 'file' },
            { path: '/work/ok.md', kind: 'file', outsideCwd: false, pasted: { width: -1 } },
          ],
        },
        { slot: NEW_CONVERSATION, text: 'a second launcher slot', attached: [] },
        { slot: 7, text: 'a slot that is not a string', attached: [] },
        {
          slot: draftKey(B),
          text: 'kept too',
          attached: [
            { path: 7, kind: 'file', outsideCwd: false },
            { path: '', kind: 'file', outsideCwd: false },
            { path: `/${'x'.repeat(4096)}`, kind: 'file', outsideCwd: false },
          ],
        },
      ],
    })
    expect(shaped).toEqual({
      drafts: [
        { slot: NEW_CONVERSATION, text: 'kept', attached: [FILE('/work/ok.md')] },
        { slot: draftKey(B), text: 'kept too', attached: [] },
      ],
    })
    expect(savedDraftsFrom('not a book')).toEqual({ drafts: [] })
  })

  it('⛔ at most the paths ONE message may carry come back in a slot', () => {
    const twelve = Array.from({ length: 12 }, (_, each) => FILE(`/work/${String(each)}.md`))
    const shaped = savedDraftsFrom({
      drafts: [{ slot: NEW_CONVERSATION, text: '', attached: twelve }],
    })
    expect(shaped.drafts[0]!.attached).toEqual(twelve.slice(0, 10))
  })

  it('⚑ absent is NO file; not JSON is no drafts — neither keeps the window from drawing', async () => {
    expect(await readDraftsFile(userData)).toEqual({ kind: 'none' })
    writeFileSync(join(userData, SAVED_DRAFTS_FILE), '{ half a file')
    expect(await readDraftsFile(userData)).toEqual({ kind: 'none' })
  })

  // Windows chmod cannot construct a POSIX permission denial.
  it.skipIf(process.platform === 'win32')(
    '⛔ a file that is THERE and cannot be read is UNREADABLE — answered, never thrown — and the window saves nothing over it',
    async () => {
      const file = join(userData, SAVED_DRAFTS_FILE)
      writeFileSync(file, JSON.stringify({ version: 1, drafts: [] }))
      chmodSync(file, 0o000)
      try {
        expect(await readDraftsFile(userData)).toEqual({ kind: 'unreadable', why: 'EACCES' })
      } finally {
        chmodSync(file, 0o600)
      }
    },
  )

  it('⛔ a file ANOTHER build wrote (another version) is unreadable too — left for a build that can read it', async () => {
    writeFileSync(
      join(userData, SAVED_DRAFTS_FILE),
      JSON.stringify({ version: 2, drafts: [{ slot: NEW_CONVERSATION, text: 'x', attached: [] }] }),
    )
    expect(await readDraftsFile(userData)).toEqual({
      kind: 'unreadable',
      why: 'written as version 2, not 1',
    })
  })

  it('⚑ saves that arrive while one is written are coalesced to the NEWEST — the file ends on the last book', async () => {
    const writer = createDraftWriter(userData)
    const book = (text: string): SavedDrafts => ({
      drafts: [{ slot: NEW_CONVERSATION, text, attached: [] }],
    })
    await Promise.all([
      writer.write(book('one')),
      writer.write(book('two')),
      writer.write(book('three')),
    ])
    expect((await readBack()).drafts[0]!.text).toBe('three')
    expect(readdirSync(userData)).toEqual([SAVED_DRAFTS_FILE])
  })

  it('⛔ a save that cannot be RENAMED into place leaves no part file and throws nothing at the renderer', async () => {
    // ⚑ the part is written, and the rename fails onto a directory at the file's name
    mkdirSync(join(userData, SAVED_DRAFTS_FILE))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(
        createDraftWriter(userData).write({
          drafts: [{ slot: NEW_CONVERSATION, text: 'x', attached: [] }],
        }),
      ).resolves.toBeUndefined()
    } finally {
      warn.mockRestore()
    }
    expect(readdirSync(userData)).toEqual([SAVED_DRAFTS_FILE])
  })

  it('⚑ a part file an earlier run’s kill left is removed before this run’s first save — and nothing else is', async () => {
    writeFileSync(join(userData, `${SAVED_DRAFTS_FILE}.0123456789ab.part`), 'words a kill left')
    writeFileSync(
      join(userData, `${SAVED_DRAFTS_FILE}.not-ours.part`),
      'not a name this app writes',
    )
    await createDraftWriter(userData).write({
      drafts: [{ slot: NEW_CONVERSATION, text: 'x', attached: [] }],
    })
    expect(readdirSync(userData).sort()).toEqual([
      SAVED_DRAFTS_FILE,
      `${SAVED_DRAFTS_FILE}.not-ours.part`,
    ])
  })

  it('🔴 the quit WAITS for each asked window’s LAST book to be on disk — only a book marked `last` counts — and says so when one never comes', async () => {
    const writer = createDraftWriter(userData)
    writer.expectQuitSaves(0)
    expect(await writer.quitSaves(1_000)).toBe('saved')

    writer.expectQuitSaves(1)
    const waiting = writer.quitSaves(1_000)
    let settled = false
    void waiting.then(() => (settled = true))
    // ⚑ an ordinary save does not answer the request
    await writer.write({
      drafts: [{ slot: NEW_CONVERSATION, text: 'an earlier book', attached: [] }],
    })
    expect(settled).toBe(false)
    void writer.write({
      drafts: [{ slot: NEW_CONVERSATION, text: 'typed as the app closed', attached: [] }],
      last: true,
    })
    expect(await waiting).toBe('saved')
    // ⚑ on disk by the time the quit is let go
    expect((await readBack()).drafts.map((draft) => draft.text)).toEqual([
      'typed as the app closed',
    ])

    writer.expectQuitSaves(1)
    expect(await writer.quitSaves(20)).toBe('unanswered')
  })

  it('⛔ a last book that could NOT be written is reported as failed — never as saved', async () => {
    const writer = createDraftWriter(userData)
    await writer.write({ drafts: [] })
    rmSync(join(userData, SAVED_DRAFTS_FILE))
    mkdirSync(join(userData, SAVED_DRAFTS_FILE))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      writer.expectQuitSaves(1)
      const waiting = writer.quitSaves(1_000)
      void writer.write({
        drafts: [{ slot: NEW_CONVERSATION, text: 'x', attached: [] }],
        last: true,
      })
      expect(await waiting).toBe('failed')
    } finally {
      warn.mockRestore()
    }
  })

  it('⚑ …and a book still being written holds the quit even when no window was asked', async () => {
    const writer = createDraftWriter(userData)
    void writer.write({ drafts: [{ slot: NEW_CONVERSATION, text: 'mid-write', attached: [] }] })
    writer.expectQuitSaves(0)
    expect(await writer.quitSaves(1_000)).toBe('saved')
    expect((await readBack()).drafts.map((draft) => draft.text)).toEqual(['mid-write'])
  })

  it('⚑ the read waits for the save in flight — a reloading window reads back what it just handed over', async () => {
    const writer = createDraftWriter(userData)
    void writer.write({ drafts: [{ slot: NEW_CONVERSATION, text: 'handed over', attached: [] }] })
    await writer.settled()
    expect((await readBack()).drafts.map((draft) => draft.text)).toEqual(['handed over'])
  })

  it('🔴 a picture a kept draft names is kept young before the start-up sweep — and a person’s own file is never touched', async () => {
    const root = pastedImagesRoot(userData)
    mkdirSync(root)
    const picture = join(realpathSync(root), `pasted-${'a'.repeat(32)}.png`)
    // ⚑ two files that are NOT BroBot's pictures, each failing one half of the rule: a paste's name
    // in a person's folder, and a person's name in the pictures' folder
    const namedLikeOne = join(userData, `pasted-${'b'.repeat(32)}.png`)
    const inTheFolder = join(realpathSync(root), 'their-own.png')
    const aWeekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    for (const path of [picture, namedLikeOne, inTheFolder]) {
      writeFileSync(path, 'png')
      utimesSync(path, aWeekAgo, aWeekAgo)
    }
    await createDraftWriter(userData).write({
      drafts: [
        {
          slot: draftKey(A),
          text: '',
          attached: [FILE(picture), FILE(namedLikeOne), FILE(inTheFolder)],
        },
      ],
    })
    try {
      const now = Date.now()
      expect(keepDraftedPastes(userData, now)).toBe(1)
      expect(Math.abs(statSync(picture).mtimeMs - now)).toBeLessThan(2_000)
      for (const untouched of [namedLikeOne, inTheFolder]) {
        expect(Math.abs(statSync(untouched).mtimeMs - aWeekAgo.getTime())).toBeLessThan(1)
      }
      // ⚑ never fatal — a file whose entries are not what this build writes stamps nothing
      writeFileSync(
        join(userData, SAVED_DRAFTS_FILE),
        JSON.stringify({ version: 1, drafts: [{ slot: 7, attached: [{ path: 7 }] }, null, 'x'] }),
      )
      expect(keepDraftedPastes(userData, now)).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a backslash-spelled picture in a kept draft stays young and survives the start-up sweep', async () => {
    const root = pastedImagesRoot(userData)
    mkdirSync(root)
    const name = `pasted-${'c'.repeat(32)}.png`
    const picture = join(realpathSync(root), name)
    writeFileSync(picture, 'png')
    // On POSIX a hard link gives the draft a backslash-spelled name for the same file. Windows
    // uses its native backslash path. The sweep reads the canonical name on both platforms.
    const attached = process.platform === 'win32' ? picture : join(root, `folder\\${name}`)
    if (attached !== picture) linkSync(picture, attached)
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    utimesSync(picture, old, old)
    await createDraftWriter(userData).write({
      drafts: [{ slot: draftKey(A), text: '', attached: [FILE(attached)] }],
    })

    const now = Date.now()
    expect(keepDraftedPastes(userData, now)).toBe(1)
    expect(Math.abs(statSync(picture).mtimeMs - now)).toBeLessThan(2_000)
    expect(await sweepPastedImages(root, now)).toBe(0)
    expect(statSync(picture).isFile()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the wiring nothing mounts
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · the wiring — `main.ts`, `RuntimeScreen` and main’s doors, which no test mounts', () => {
  const read = (path: string): string => readFileSync(join(HERE, path), 'utf8')

  it('🔴 the drafts are read BEFORE the app mounts, and handed to it once', () => {
    expect(read('../src/renderer/src/main.ts')).toMatch(
      /draftHandoffBeforeDrawing\(window\.api\?\.savedDrafts\)\.then\(\(handoff\) => \{\n\s+createApp\(App\)\.provide\(SAVED_DRAFTS, handoff\)\.mount\('#app'\)/,
    )
  })

  it('🔴 the screen keeps ITS book through the one entry point, and stops it BEFORE it unmounts', () => {
    const screen = read('../src/renderer/src/components/RuntimeScreen.vue')
    // ⚑ …and the sweep empties nothing while the app is closing — its fifth door
    const sweep = screen.slice(screen.indexOf('const draftSweep = sweepDrafts('))
    expect(sweep.slice(0, sweep.indexOf('\n)\n'))).toMatch(/\n\s+\(\) => appClosing\.value,$/)
    expect(screen).toMatch(
      /const draftKeeping = keepTheDraftBook\(\{\n\s+book: drafts,\n\s+sweep: draftSweep,\n\s+handoff: inject\(SAVED_DRAFTS, null\),\n\s+bridge: window\.api,\n\s+closing: \(\) => appClosing\.value,\n\}\)\nonBeforeUnmount\(draftKeeping\.stop\)\n/,
    )
  })

  it('🔴 main’s doors, the existence question, the quit’s wait and the start-up keep are wired', () => {
    const index = read('../src/main/index.ts')
    expect(index).toMatch(
      /ipcMain\.handle\('app:save-drafts', \(_event, saved: unknown\) => writer\.write\(saved\)\)/,
    )
    expect(index).toMatch(
      /const writer = createDraftWriter\(app\.getPath\('userData'\)\)\n\s+draftWriter = writer\n/,
    )
    expect(index).toMatch(
      /await writer\.settled\(\)\n\s+const file = await readDraftsFile\(app\.getPath\('userData'\)\)\n/,
    )
    // ⚑ not read: answered `null`, and the window is NOT counted among those that keep drafts
    expect(index).toMatch(
      /if \(file\.kind === 'unreadable'\) \{\n\s+draftReaders\.delete\(reader\.id\)[\s\S]*?return null\n\s+\}\n/,
    )
    expect(index).toMatch(
      /reader\.once\('render-process-gone', forget\)\n\s+reader\.once\('destroyed', forget\)/,
    )
    expect(index).toMatch(/\n\s+draftReaders\.add\(reader\.id\)\n/)
    expect(index).toMatch(/if \(outcome === 'failed'\) throw /)
    expect(index).toMatch(
      /exists: \(sessionId\) => recordedConversation\?\.\(sessionId\) \?\? true,/,
    )
    expect(index).toMatch(
      /recordedConversation = \(sessionId\) => db === null \|\| store\.recordedOne\(sessionId\) !== null\n/,
    )
    // ⚑ the quit's last-book step: its own lifetime step, asking the windows that read drafts
    expect(index).toMatch(/keepUnsentDrafts: \(\) => theLastDraftSaves\(\),/)
    expect(index).toMatch(/draftReaders\.has\(window\.webContents\.id\)/)
    expect(index).toMatch(/writer\.expectQuitSaves\(windows\.length\)/)
    expect(index).toMatch(/window\.webContents\.send\(LAST_DRAFT_SAVE_CHANNEL\)/)
    expect(index).toMatch(
      /const outcome = await writer\.quitSaves\(QUIT_SAVE_WITHIN_MS\)\n\s+if \(outcome === 'unanswered'\) \{\n\s+throw /,
    )
    expect(index).toMatch(
      /keepDraftedPastes\(userData, Date\.now\(\)\)\n\s+void sweepPastedImages\(pastedImagesRoot\(userData\), Date\.now\(\)\)/,
    )
    // ⚑ …and the preload knocks on the two doors main opened, by the same names
    const preload = read('../src/preload/index.ts')
    for (const channel of ['app:saved-drafts', 'app:save-drafts']) {
      expect(index).toContain(`ipcMain.handle('${channel}'`)
      expect(preload).toContain(`ipcRenderer.invoke('${channel}'`)
    }
    expect(preload).toMatch(/ipcRenderer\.on\(LAST_DRAFT_SAVE_CHANNEL, forward\)/)
    expect(LAST_DRAFT_SAVE_CHANNEL).toBe('app:last-draft-save')
    // ⚑ …and the screen answers it — the bridge's door handed to the keeper
    expect(read('../src/renderer/src/lib/kept-drafts.ts')).toMatch(
      /onLastSave: bridge\?\.onLastDraftSave,/,
    )
  })

  it('⛔ nothing about a draft is SENT anywhere by being saved — the two modules reach no host, command, provider or network', () => {
    /** Every module a file names — single-line imports, multi-line ones, and any other way in. */
    const reaches = (path: string): { from: string[]; other: RegExpMatchArray | null } => {
      const source = read(path)
      return {
        from: [...source.matchAll(/from\s+'([^']+)'/g)].map((each) => each[1]!).sort(),
        other: source.match(/\bimport\(|\brequire\(|\bfetch\(|\bnet\b|'electron'/),
      }
    }
    expect(reaches('../src/main/saved-drafts.ts')).toEqual({
      from: [
        '../shared/runtime-ipc',
        '../shared/saved-drafts',
        './runtime/handed-path',
        'node:path',
      ],
      other: null,
    })
    expect(reaches('../src/main/drafts-file.ts')).toEqual({
      from: [
        '../shared/runtime-ipc',
        '../shared/saved-drafts',
        './runtime/pasted-image',
        './saved-drafts',
        'node:crypto',
        'node:fs',
        'node:fs/promises',
        'node:path',
      ],
      other: null,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §7 · the quit's own step, and what the drafts file may read
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§7 · the quit keeps the unsent drafts in a step of its OWN — after the conversations, before the database', () => {
  function aLifetime(keepUnsentDrafts?: () => Promise<void>): {
    lifetime: ReturnType<typeof createAppLifetime>
    log: string[]
  } {
    const log: string[] = []
    const lifetime = createAppLifetime({
      announceClosing: () => log.push('announceClosing'),
      closeAllSessions: () => {
        log.push('closeAllSessions')
        return Promise.resolve()
      },
      ...(keepUnsentDrafts === undefined ? {} : { keepUnsentDrafts }),
      stopArchiveWork: () => log.push('stopArchiveWork'),
      drainArchiveWork: () => {
        log.push('drainArchiveWork')
        return Promise.resolve()
      },
      closeDatabase: () => log.push('closeDatabase'),
      quit: () => log.push('quit'),
      exit: (code) => log.push(`exit:${String(code)}`),
      armLastResort: () => log.push('armLastResort'),
      log: (message) => log.push(`log:${message}`),
      now: () => 0,
    })
    return { lifetime, log }
  }
  const quitting = { preventDefault: (): void => undefined } as unknown as Parameters<
    ReturnType<typeof createAppLifetime>['beforeQuit']
  >[0]

  it('🔴 AFTER the sessions are closed (their refusals put words back) and BEFORE the database — and the report names it', async () => {
    const { lifetime, log } = aLifetime(() => {
      log.push('keepUnsentDrafts')
      return Promise.resolve()
    })
    lifetime.beforeQuit(quitting)
    await lifetime.shuttingDown
    expect(log.slice(0, 6)).toEqual([
      'announceClosing',
      'stopArchiveWork',
      'closeAllSessions',
      'keepUnsentDrafts',
      'drainArchiveWork',
      'closeDatabase',
    ])
    expect(log.find((line) => line.startsWith('log:BroCrew shut down in'))).toContain(
      'close its sessions 0ms · keep its unsent drafts 0ms · drain its archive work 0ms',
    )
  })

  it('⚑ an answer that never came is LOGGED through the lifetime’s own writer — and the quit goes on', async () => {
    const { lifetime, log } = aLifetime(() => Promise.reject(new Error('a window did not answer')))
    lifetime.beforeQuit(quitting)
    await lifetime.shuttingDown
    expect(log).toContain('log:BroCrew failed to keep its unsent drafts:')
    expect(log).toContain('closeDatabase')
  })

  it('⚑ the control — a lifetime with nothing to keep has no such step, and its report names only the four', async () => {
    const { lifetime, log } = aLifetime()
    lifetime.beforeQuit(quitting)
    await lifetime.shuttingDown
    expect(log.find((line) => line.startsWith('log:BroCrew shut down in'))).not.toContain(
      'unsent drafts',
    )
  })

  it('⛔ the drafts file READS only its own file — every read call is handed the drafts file’s path', () => {
    const source = readFileSync(join(HERE, '../src/main/drafts-file.ts'), 'utf8')
    const reads = [...source.matchAll(/\breadFile(?:Sync)?\(([^,]+),/g)].map((each) =>
      each[1]!.trim(),
    )
    expect(reads).toEqual(['savedDraftsPath(userData)', 'savedDraftsPath(userData)'])
    // ⚑ and from `node:fs` only what it uses: its own file, the pictures' folder, and `lutimes`
    expect(source).toMatch(/^import \{ lutimesSync, readFileSync, realpathSync \} from 'node:fs'$/m)
    expect(source).toMatch(
      /^import \{ readdir, readFile, rename, rm, writeFile \} from 'node:fs\/promises'$/m,
    )
    expect(source).not.toMatch(/\butimesSync\b|createReadStream|\bopen(?:Sync)?\(/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §6 · a missing path, handed over again
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§6 · a path restored as missing and attached again is THERE — the fresh record replaces the mark', () => {
  it('🔴 one attachment, in the same place, no longer marked', () => {
    const others = FILE('/work/first.md')
    const { next } = stageVerdicts(
      [others, { ...FILE('/work/back.md'), missing: true }],
      [{ handed: FILE('/work/back.md') }],
    )
    expect(next).toEqual([others, FILE('/work/back.md')])
  })

  it('⛔ …and in a FULL message too — a record replacing itself is not one attachment too many', () => {
    const nine = Array.from({ length: 9 }, (_, each) => FILE(`/work/${String(each)}.md`))
    const { next, refusal } = stageVerdicts(
      [...nine, { ...FILE('/work/back.md'), missing: true }],
      [{ handed: FILE('/work/back.md') }],
    )
    expect(refusal).toBeNull()
    expect(next).toEqual([...nine, FILE('/work/back.md')])
  })

  it('⚑ the control — a path already staged and NOT missing is still one attachment, untouched', () => {
    const staged = { ...FILE('/work/back.md'), outsideCwd: true }
    expect(stageVerdicts([staged], [{ handed: FILE('/work/back.md') }]).next).toEqual([staged])
  })
})
