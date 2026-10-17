import { describe, expect, it } from 'vitest'
import {
  attachmentsNotRestored,
  createDraftBook,
  draftKey,
  draftSlot,
  NEW_CONVERSATION,
  liveDraftSlots,
} from '../src/renderer/src/lib/drafts'
import { MAX_HANDED_PATHS, type HandedPath } from '../src/shared/runtime-ipc'

/**
 * Per-conversation drafts (Slice 2 · 019) — the fix for cross-thread draft bleed.
 *
 * THE BUG: the composer owned its own text, and the composer is one component handed a different
 * conversation rather than rebuilt for each. So a draft typed in thread A was still in the box
 * after switching to thread B, and sending in B delivered A's words to B's agent. Every test here
 * names that failure, because a green suite that does not is how it came back.
 */

describe('a draft belongs to ONE conversation', () => {
  it('THE BUG: text typed in A is not in B, and B sends its own words', () => {
    const drafts = createDraftBook()
    const a = draftKey('sess_A')
    const b = draftKey('sess_B')

    drafts.write(a, 'the message meant for A')
    expect(drafts.read(b), 'thread B is showing thread A’s draft — this is the 019 bug').toBe('')

    drafts.write(b, 'the message meant for B')
    expect(drafts.read(b)).toBe('the message meant for B')
    expect(drafts.read(a), 'typing in B overwrote A’s draft').toBe('the message meant for A')
  })

  it('switching back and forth, in any order, never mixes them', () => {
    const drafts = createDraftBook()
    const keys = ['sess_A', 'sess_B', 'sess_C'].map(draftKey)
    keys.forEach((key, index) => drafts.write(key, `draft ${index}`))
    // Read them back in a different order than they were written.
    for (const index of [2, 0, 1, 2, 1, 0]) {
      expect(drafts.read(keys[index]!)).toBe(`draft ${index}`)
    }
  })

  it('multi-line drafts survive intact — 015 made this cost paragraphs, not a line', () => {
    const drafts = createDraftBook()
    const paragraphs = 'first line\n\n    indented second\nthird'
    drafts.write(draftKey('sess_A'), paragraphs)
    drafts.write(draftKey('sess_B'), 'something else entirely')
    expect(drafts.read(draftKey('sess_A'))).toBe(paragraphs)
  })

  it('sending clears only the conversation that sent', () => {
    const drafts = createDraftBook()
    drafts.write(draftKey('sess_A'), 'A')
    drafts.write(draftKey('sess_B'), 'B')
    drafts.write(draftKey('sess_A'), '') // A sent
    expect(drafts.read(draftKey('sess_A'))).toBe('')
    expect(drafts.read(draftKey('sess_B'))).toBe('B')
  })
})

describe('the thread that has not started yet has its own slot', () => {
  it('its key cannot collide with any conversation’s', () => {
    // A session id is namespaced on the way in, so no id — however it is generated — can ever
    // address the launcher's slot, in either direction.
    expect(draftKey(NEW_CONVERSATION)).not.toBe(NEW_CONVERSATION)
    expect(draftKey('new')).not.toBe(NEW_CONVERSATION)
  })

  it('what is typed there does not appear in a conversation, or the other way round', () => {
    const drafts = createDraftBook()
    drafts.write(NEW_CONVERSATION, 'about to start something')
    expect(drafts.read(draftKey('sess_A'))).toBe('')
    drafts.write(draftKey('sess_A'), 'said inside A')
    expect(drafts.read(NEW_CONVERSATION)).toBe('about to start something')
  })
})

describe('which slot the composer on screen writes to', () => {
  // The keying itself — the decision that, wired backwards, sends A's words to B. Both call sites
  // go through this one function, so it is the thing worth pinning rather than each binding.
  it('a conversation on screen edits its OWN slot; no conversation means the launcher’s', () => {
    expect(draftSlot('sess_A')).toBe(draftKey('sess_A'))
    expect(draftSlot('sess_B')).toBe(draftKey('sess_B'))
    expect(draftSlot(null)).toBe(NEW_CONVERSATION)
  })

  it('switching the conversation on screen switches the slot — that IS the fix', () => {
    const drafts = createDraftBook()
    drafts.write(draftSlot('sess_A'), 'A’s words')
    // The screen now shows B. The composer reads through the same function with a new argument.
    expect(drafts.read(draftSlot('sess_B'))).toBe('')
    drafts.write(draftSlot('sess_B'), 'B’s words')
    expect(drafts.read(draftSlot('sess_A'))).toBe('A’s words')
  })
})

describe('the launcher hands its draft over when the conversation starts', () => {
  it('the text becomes the first message: the launcher is empty and the new thread is too', () => {
    const drafts = createDraftBook()
    drafts.write(draftSlot(null), 'what this conversation is about')
    // Sending from the launcher clears its slot (the composer does this), then a session appears.
    drafts.write(draftSlot(null), '')
    const started = 'sess_new'
    expect(drafts.read(draftSlot(null))).toBe('')
    expect(drafts.read(draftSlot(started)), 'the opening line came back as a draft').toBe('')
  })

  it('a first message that fails to send comes back in ITS conversation, not the launcher', () => {
    // What RuntimeScreen.start() does when the session opened but the send did not get out.
    const drafts = createDraftBook()
    const started = 'sess_new'
    drafts.write(draftSlot(started), 'the message that never left')
    expect(drafts.read(draftSlot(started))).toBe('the message that never left')
    expect(drafts.read(draftSlot(null))).toBe('')
  })
})

describe('drafts do not outlive their conversations', () => {
  it('a conversation that ends takes its draft with it, and a reopened one starts empty', () => {
    const drafts = createDraftBook()
    drafts.write(draftKey('sess_A'), 'half a thought')
    drafts.write(draftKey('sess_B'), 'another')
    drafts.write(NEW_CONVERSATION, 'and one here')

    // Only B is still open, and nothing ended is on screen.
    drafts.keepOnly([NEW_CONVERSATION, draftKey('sess_B')])

    expect(drafts.read(draftKey('sess_A'))).toBe('')
    expect(drafts.read(draftKey('sess_B'))).toBe('another')
    expect(drafts.read(NEW_CONVERSATION)).toBe('and one here')
  })

  it('but NOT while you are still reading it — closing a chat must not wipe it mid-sentence', () => {
    // Closing the conversation you are reading deliberately leaves it on screen, so the cleanup
    // keeps whatever slot the composer is bound to as well as the open ones.
    const drafts = createDraftBook()
    const ended = draftKey('sess_ended')
    drafts.write(ended, 'words I typed before it closed')

    drafts.keepOnly([NEW_CONVERSATION, ended /* still on screen */])
    expect(drafts.read(ended)).toBe('words I typed before it closed')

    // Navigating away is what lets it go.
    drafts.keepOnly([NEW_CONVERSATION])
    expect(drafts.read(ended)).toBe('')
  })

  it('nothing accumulates: an emptied draft leaves no slot behind', () => {
    const drafts = createDraftBook()
    drafts.write(draftKey('sess_A'), 'typed')
    expect(drafts.keys()).toHaveLength(1)
    drafts.write(draftKey('sess_A'), '')
    expect(drafts.keys()).toHaveLength(0)
  })
})

describe('putting a refused message back (216)', () => {
  const FILE: HandedPath = { path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }
  const OTHER: HandedPath = { path: '/work/alpha/other.md', kind: 'file', outsideCwd: false }

  it('🔴 the words and the paths come back TOGETHER', () => {
    // A send that failed must not cost somebody their message — and half a message is the shape
    // `211` §1 spent a dispatch on for the launch draft.
    const book = createDraftBook()
    book.restore('s:1', 'have a look at this', [FILE])

    expect(book.read('s:1')).toBe('have a look at this')
    expect(book.paths.read('s:1')).toEqual([FILE])
  })

  it('⛔ …and the WORDS never clobber what the person typed while the send was in flight', () => {
    // ⚠️ **The defect this method exists to make unrepresentable** (216, review): the text was
    // guarded and the paths were not, so attaching something during the round trip had it silently
    // replaced by the list that had just failed. A mutation on the unguarded version survived
    // `216`'s table, because the only caller was `RuntimeScreen` and nothing mounts it.
    const book = createDraftBook()
    book.write('s:1', 'a different thought')
    book.paths.write('s:1', [OTHER])

    expect(book.restore('s:1', 'have a look at this', [FILE])).toBe(0)

    expect(book.read('s:1')).toBe('a different thought')
    // ⛔ **…and the PATHS are merged rather than chosen between** (236 §5, from `227` LOW 3). This
    // used to answer `[OTHER]` — the newer edit kept, correctly, and the refused message's own
    // attachment dropped in silence. One box can hold one message; a list can hold both.
    expect(book.paths.read('s:1')).toEqual([OTHER, FILE])
  })

  it('⚑ …and the two are guarded SEPARATELY, which is the case a single guard gets wrong', () => {
    // Typed something but attached nothing: the words are kept and the paths still come back.
    const book = createDraftBook()
    book.write('s:1', 'a different thought')

    book.restore('s:1', 'have a look at this', [FILE])

    expect(book.read('s:1')).toBe('a different thought')
    expect(book.paths.read('s:1')).toEqual([FILE])

    // …and the mirror: attached something but typed nothing.
    const other = createDraftBook()
    other.paths.write('s:2', [OTHER])

    other.restore('s:2', 'have a look at this', [FILE])

    expect(other.read('s:2')).toBe('have a look at this')
    expect(other.paths.read('s:2')).toEqual([OTHER, FILE])
  })

  it('⛔ the same message handed back over itself does not double its own attachments', () => {
    // The ordinary case: nothing was staged during the round trip, so the merge has nothing to
    // merge and the list is what it was. A restore that appended blindly would grow the message
    // every time a send failed twice.
    const book = createDraftBook()
    book.paths.write('s:1', [FILE])

    expect(book.restore('s:1', 'have a look at this', [FILE])).toBe(0)

    expect(book.paths.read('s:1')).toEqual([FILE])
  })

  it('🔴 …and what does not fit under the ceiling is COUNTED, never dropped quietly', () => {
    // ⛔ A restore that pushed the list past the ceiling would leave Send lit over a message the
    // wire refuses — 223's shape — so the ceiling binds here too. What it keeps out is returned,
    // because a person whose refused message came back short has to be told which promise broke.
    const full = Array.from({ length: MAX_HANDED_PATHS }, (_, at) => ({
      path: `/work/alpha/staged-${at}.md`,
      kind: 'file' as const,
      outsideCwd: false,
    }))
    const book = createDraftBook()
    book.paths.write('s:1', full)

    expect(book.restore('s:1', 'have a look at this', [FILE, OTHER])).toBe(2)

    // ⚑ The newer edit is whole — it is what is on screen — and the list did not grow past the
    // ceiling behind the person's back.
    expect(book.paths.read('s:1')).toEqual(full)
  })

  it('⛔ …and the sentence names the number, in both grammatical numbers', () => {
    expect(attachmentsNotRestored(1)).toContain('One attachment')
    expect(attachmentsNotRestored(3)).toContain('3 attachments')
    for (const count of [1, 3]) {
      expect(attachmentsNotRestored(count)).toContain(String(MAX_HANDED_PATHS))
    }
  })
})

describe('what a sweep keeps (217 §2)', () => {
  it('🔴 the LAUNCHER\u2019s slot is always kept — its words and paths outlive leaving the page', () => {
    // ⛔ The launcher is unmounted for as long as any conversation is on screen. A sweep that
    // forgot its slot would take away a half-composed first message — and, since 217, the files
    // staged for it — while somebody was reading something else. §2 asks that they survive leaving
    // and returning; this is the line that decides it.
    expect(liveDraftSlots([], draftKey('sess_1'))).toContain(NEW_CONVERSATION)
    expect(liveDraftSlots([{ sessionId: 'sess_1' }], draftKey('sess_1'))).toContain(
      NEW_CONVERSATION,
    )
  })

  it('⛔ …and it keeps what is on screen and every open conversation, and nothing else', () => {
    // The paired positive: a keep-list that returned everything would satisfy the rule above while
    // pruning nothing at all, which is the unbounded growth `019` exists to prevent.
    const kept = liveDraftSlots([{ sessionId: 'a' }, { sessionId: 'b' }], draftKey('a'))

    expect(new Set(kept)).toEqual(new Set([NEW_CONVERSATION, draftKey('a'), draftKey('b')]))
    expect(kept).not.toContain(draftKey('gone'))
  })

  it('⚑ and a real sweep leaves the launcher\u2019s staged paths where they were', () => {
    // End to end over the book itself, which is what the screen actually calls.
    const book = createDraftBook()
    book.write(NEW_CONVERSATION, 'a first message, half written')
    book.paths.write(NEW_CONVERSATION, [
      { path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false },
    ])
    book.write(draftKey('gone'), 'a conversation that has since closed')

    book.keepOnly(liveDraftSlots([], draftKey('a')))

    expect(book.read(NEW_CONVERSATION)).toBe('a first message, half written')
    expect(book.paths.read(NEW_CONVERSATION)).toHaveLength(1)
    expect(book.read(draftKey('gone'))).toBe('')
  })
})
