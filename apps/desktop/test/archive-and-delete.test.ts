import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { DeletePart, DeleteVerdict } from '../src/shared/conversation-archive'
import type { HandedPath, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  RECOVERY_COPIES_STAY,
  archiveConversation,
  checkDelete,
  deleteTicked,
  dropTheirDrafts,
  lookingAfterTheyLeft,
  partsSaid,
  partsToSend,
  pointsToArchive,
  recordsWent,
  restoreConversation,
  theTreeOf,
  tickedAtFirst,
  whatItCannotRemove,
  type ArchiveBridge,
  leftTheListsFromElsewhere,
} from '../src/renderer/src/lib/archive-and-delete'
import {
  createDraftBook,
  draftKey,
  NEW_CONVERSATION,
  sweepDrafts,
} from '../src/renderer/src/lib/drafts'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'

/**
 * The window's rules for archiving and deleting a conversation: what is asked of main, which parts
 * are ticked and sent, where the window looks afterwards, and that a conversation brought back
 * from the archive says so in the reading view.
 */

const part = (over: Partial<DeletePart> & Pick<DeletePart, 'id' | 'kind'>): DeletePart => ({
  says: `the part ${over.id}`,
  conversation: 'sess_root',
  paths: [],
  bytes: null,
  ...over,
})

const PARTS: readonly DeletePart[] = [
  part({ id: 'records', kind: 'records' }),
  part({ id: 'files:sess_root', kind: 'provider-files', paths: ['/h/a.jsonl'], bytes: 2048 }),
  part({ id: 'files:sess_helper', kind: 'provider-files', conversation: 'sess_helper' }),
  part({ id: 'note:/h/memory/its-note.md', kind: 'memory-note', paths: ['/h/memory/its-note.md'] }),
]

/** A bridge that records what it was asked, and answers what the test hands it. */
function bridge(answers: Partial<ArchiveBridge> = {}): { asked: unknown[]; bridge: ArchiveBridge } {
  const asked: unknown[] = []
  const said = (verb: string, input: unknown): void => void asked.push({ verb, input })
  return {
    asked,
    bridge: {
      archiveConversation: async (input) => {
        said('archiveConversation', input)
        return { done: true, conversations: [input.sessionId] }
      },
      restoreConversation: async (input) => {
        said('restoreConversation', input)
        return { done: true, conversations: [input.sessionId] }
      },
      checkDeleteConversation: async (input) => {
        said('checkDeleteConversation', input)
        return { ok: false, refusal: 'no' }
      },
      deleteConversation: async (input) => {
        said('deleteConversation', input)
        return { done: true, removed: input.parts, left: [], recordsKept: null }
      },
      ...answers,
    },
  }
}

describe('what the window asks of main', () => {
  it('archive, restore and the check each name the one conversation', async () => {
    const b = bridge()
    await archiveConversation(b.bridge, 'sess_a')
    await restoreConversation(b.bridge, 'sess_b')
    await checkDelete(b.bridge, 'sess_c')
    expect(b.asked).toEqual([
      { verb: 'archiveConversation', input: { sessionId: 'sess_a' } },
      { verb: 'restoreConversation', input: { sessionId: 'sess_b' } },
      { verb: 'checkDeleteConversation', input: { sessionId: 'sess_c' } },
    ])
  })

  it('a refusal is handed back as main wrote it', async () => {
    const refusal = 'This conversation is being archived, so it was not started.'
    const b = bridge({ archiveConversation: async () => ({ done: false, refusal }) })
    expect(await archiveConversation(b.bridge, 'sess_a')).toEqual({ done: false, refusal })
  })

  it('a call that threw reads as a refusal, in its own words', async () => {
    const thrown = async (): Promise<never> => {
      throw new Error("Error invoking remote method 'runtime:command': Error: BroBot is quitting.")
    }
    const b = bridge({
      archiveConversation: thrown,
      restoreConversation: thrown,
      checkDeleteConversation: thrown,
      deleteConversation: thrown,
    })
    expect(await archiveConversation(b.bridge, 's')).toEqual({
      done: false,
      refusal: 'BroBot is quitting.',
    })
    expect(await restoreConversation(b.bridge, 's')).toMatchObject({ done: false })
    expect(await checkDelete(b.bridge, 's')).toEqual({ ok: false, refusal: 'BroBot is quitting.' })
    expect(await deleteTicked(b.bridge, 's', PARTS, new Set(['records']))).toMatchObject({
      done: false,
    })
  })
})

describe('the ticks', () => {
  it('the records and each conversation’s files are ticked at first, and a memory note is not', () => {
    expect(tickedAtFirst(PARTS)).toEqual(['records', 'files:sess_root', 'files:sess_helper'])
    // The control: the note is in the list it was left out of.
    expect(PARTS.map((one) => one.id)).toContain('note:/h/memory/its-note.md')
  })

  it('only a ticked part main listed is sent, in main’s order', async () => {
    const ticked = new Set(['note:/h/memory/its-note.md', 'records', 'something main never listed'])
    expect(partsToSend(PARTS, ticked)).toEqual(['records', 'note:/h/memory/its-note.md'])

    const b = bridge()
    await deleteTicked(b.bridge, 'sess_root', PARTS, ticked)
    expect(b.asked).toEqual([
      {
        verb: 'deleteConversation',
        input: { sessionId: 'sess_root', parts: ['records', 'note:/h/memory/its-note.md'] },
      },
    ])
    // The control: with everything ticked, everything listed goes.
    expect(partsToSend(PARTS, new Set(PARTS.map((one) => one.id)))).toHaveLength(PARTS.length)
  })

  it('what went is said in each part’s own line', () => {
    expect(partsSaid(PARTS, ['records', 'files:sess_root'])).toEqual([
      'the part records',
      'the part files:sess_root',
    ])
  })

  it('the conversations are gone from the window only when the records went', () => {
    expect(recordsWent({ done: true, removed: ['records'], left: [], recordsKept: null })).toBe(
      true,
    )
    expect(
      recordsWent({ done: true, removed: ['files:sess_root'], left: [], recordsKept: null }),
    ).toBe(false)
    expect(recordsWent({ done: false, refusal: 'no' })).toBe(false)
  })

  it('the tree is the conversation asked about, then its helpers', () => {
    const verdict: Extract<DeleteVerdict, { ok: true }> = {
      ok: true,
      conversation: 'sess_root',
      name: 'W1',
      helpers: [
        { conversation: 'sess_helper', name: 'W1.1' },
        { conversation: 'sess_other', name: 'W1.2' },
      ],
      parts: PARTS,
      ends: [],
      stays: [],
      cannot: [],
    }
    expect(theTreeOf(verdict)).toEqual(['sess_root', 'sess_helper', 'sess_other'])
  })
})

describe('a refusal that points to Archive', () => {
  it('main’s two delete refusals that name Archive offer it', () => {
    expect(
      pointsToArchive(
        'W1.1 was started as a helper, so it is deleted only with W1, the conversation at the ' +
          'top of its tree: delete W1, or archive this one.',
      ),
    ).toBe(true)
    expect(pointsToArchive('W1 can’t be deleted. Archive W1 instead; that keeps everything.')).toBe(
      true,
    )
  })

  it('a refusal that names no way out by Archive offers none', () => {
    expect(pointsToArchive('There is no conversation by that name to delete.')).toBe(false)
    // "archived" is a state, not the action.
    expect(pointsToArchive('This conversation is being archived, so it was not started.')).toBe(
      false,
    )
  })
})

describe('what a delete cannot remove', () => {
  const RECOVERY =
    'The recovery copies in the data folder still hold its records until newer copies replace them.'
  const HISTORY = 'The prompt history in an agent’s folder isn’t changed.'

  it('main’s sentence about the recovery copies stands on its own, before the rest', () => {
    expect(whatItCannotRemove([HISTORY, RECOVERY])).toEqual({
      recoveryCopies: [RECOVERY],
      rest: [HISTORY],
    })
  })

  it('a list that never mentions them gets one true line of the window’s own', () => {
    expect(whatItCannotRemove([HISTORY])).toEqual({
      recoveryCopies: [RECOVERY_COPIES_STAY],
      rest: [HISTORY],
    })
    expect(whatItCannotRemove([]).recoveryCopies).toEqual([RECOVERY_COPIES_STAY])
    expect(RECOVERY_COPIES_STAY).toBe(
      'Recovery copies of this workspace keep it until they are replaced.',
    )
  })
})

describe('where the window looks once conversations left it', () => {
  const LAUNCHER = 'new'

  it('a view of one of them closes onto the newest conversation still held', () => {
    expect(
      lookingAfterTheyLeft(
        { place: null, activeId: 'sess_helper' },
        ['sess_root', 'sess_helper'],
        ['sess_older', 'sess_root', 'sess_newer', 'sess_helper'],
        LAUNCHER,
      ),
    ).toEqual({ place: null, activeId: 'sess_newer' })
  })

  it('…or onto the launcher when nothing else is held', () => {
    expect(
      lookingAfterTheyLeft({ place: null, activeId: 'sess_root' }, ['sess_root'], [], LAUNCHER),
    ).toEqual({ place: LAUNCHER, activeId: null })
  })

  it('a page stays the page, and only the conversation behind it is let go', () => {
    expect(
      lookingAfterTheyLeft(
        { place: 'sessions', activeId: 'sess_root' },
        ['sess_root'],
        [],
        LAUNCHER,
      ),
    ).toEqual({ place: 'sessions', activeId: null })
  })

  it('a view of any other conversation is left exactly as it is', () => {
    const looking = { place: null, activeId: 'sess_other' }
    expect(lookingAfterTheyLeft(looking, ['sess_root'], ['sess_other'], LAUNCHER)).toBe(looking)
    const nowhere = { place: LAUNCHER, activeId: null }
    expect(lookingAfterTheyLeft(nowhere, ['sess_root'], [], LAUNCHER)).toBe(nowhere)
  })
})

describe('the drafts of conversations that no longer exist', () => {
  it('their words and attached paths are dropped, and nobody else’s', () => {
    const drafts = createDraftBook()
    const handed = { path: '/work/notes.md', kind: 'file' } as never
    for (const sessionId of ['sess_root', 'sess_helper', 'sess_other']) {
      drafts.write(draftKey(sessionId), `unsent in ${sessionId}`)
      drafts.paths.write(draftKey(sessionId), [handed])
    }

    dropTheirDrafts(drafts, ['sess_root', 'sess_helper'])

    expect(drafts.read(draftKey('sess_root'))).toBe('')
    expect(drafts.read(draftKey('sess_helper'))).toBe('')
    expect(drafts.paths.read(draftKey('sess_root'))).toEqual([])
    expect(drafts.paths.read(draftKey('sess_helper'))).toEqual([])
    // The control: a conversation that was not deleted keeps both.
    expect(drafts.read(draftKey('sess_other'))).toBe('unsent in sess_other')
    expect(drafts.paths.read(draftKey('sess_other'))).toHaveLength(1)
    expect(drafts.keys()).toEqual([draftKey('sess_other')])
  })
})

describe('a conversation brought back from the archive says so', () => {
  const SENTENCE = 'Brought back from the archive: you wrote to it.'

  it('main’s sentence is a line the normal reading view keeps', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'reopened', broughtBack: SENTENCE } as TranscriptEvent)
    const said = state.items.filter(
      (item): item is NoticeItem => item.kind === 'notice' && item.text === SENTENCE,
    )
    expect(said).toHaveLength(1)
    expect(isVisibleIn('normal', said[0]!)).toBe(true)

    // The control: a lifecycle notice at `info` is what the normal view drops.
    expect(isVisibleIn('normal', { ...said[0]!, level: 'info' })).toBe(false)
  })

  it('a reopen that brought nothing back draws no such line', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'reopened' } as TranscriptEvent)
    expect(state.items.filter((item) => item.kind === 'notice')).toEqual([])
  })
})

describe('an archive keeps the words a person had typed', () => {
  const A = 'sess_archived'
  const attached: HandedPath = { path: '/Users/someone/notes.md', kind: 'file', outsideCwd: false }

  /** A book with A's draft and an attached path, swept as the screen sweeps it. */
  async function swept() {
    const book = createDraftBook()
    book.write(draftKey(A), 'half a thought')
    book.paths.write(draftKey(A), [attached])
    const open = ref<{ sessionId: string }[]>([])
    const listed = ref<string[]>([A])
    const sweep = sweepDrafts(
      book,
      () => open.value,
      () => NEW_CONVERSATION,
      () => listed.value,
    )
    await nextTick()
    return { book, open, listed, sweep }
  }

  it('🔴 an archived conversation leaves the lists and keeps its draft and paths; a restore brings them back', async () => {
    const { book, open, listed, sweep } = await swept()
    sweep.holdArchived([A])
    listed.value = []
    await nextTick()
    expect(book.read(draftKey(A))).toBe('half a thought')
    expect(book.paths.read(draftKey(A))).toEqual([attached])
    // Restored and opened here: the words are where they were, and the usual rules hold again.
    listed.value = [A]
    open.value = [{ sessionId: A }]
    await nextTick()
    expect(book.read(draftKey(A))).toBe('half a thought')
    sweep.stop()
  })

  it('⛔ the control: a conversation that leaves the lists with no hold takes its draft with it', async () => {
    const { book, listed, sweep } = await swept()
    listed.value = []
    await nextTick()
    expect(book.read(draftKey(A))).toBe('')
    expect(book.paths.read(draftKey(A))).toEqual([])
    sweep.stop()
  })

  it('🔴 a delete still drops them, held or not', async () => {
    const { book, listed, sweep } = await swept()
    sweep.holdArchived([A])
    listed.value = []
    await nextTick()
    dropTheirDrafts(book, [A])
    expect(book.read(draftKey(A))).toBe('')
    expect(book.paths.read(draftKey(A))).toEqual([])
    sweep.stop()
  })
})

describe('a view reacts when its conversation leaves the lists from elsewhere', () => {
  const ON = 'sess_on_screen'
  const was = new Set([ON, 'sess_other'])

  it('🔴 listed at the last answer, gone at this one, and not run here: it left', () => {
    expect(leftTheListsFromElsewhere(ON, was, ['sess_other'], [])).toBe(ON)
  })

  it('⛔ still listed, never listed, run here, or a list not answered yet: it did not', () => {
    expect(leftTheListsFromElsewhere(ON, was, [ON, 'sess_other'], [])).toBeNull()
    expect(leftTheListsFromElsewhere(ON, new Set(['sess_other']), ['sess_other'], [])).toBeNull()
    expect(leftTheListsFromElsewhere(ON, was, ['sess_other'], [ON])).toBeNull()
    expect(leftTheListsFromElsewhere(ON, null, ['sess_other'], [])).toBeNull()
    expect(leftTheListsFromElsewhere(ON, was, null, [])).toBeNull()
    expect(leftTheListsFromElsewhere(null, was, ['sess_other'], [])).toBeNull()
  })
})
