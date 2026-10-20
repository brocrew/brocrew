import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import PromptComposer, {
  MISSING_ON_RESTORE,
} from '../../src/renderer/src/components/PromptComposer.vue'
import { createDraftBook, draftKey, type DraftBook } from '../../src/renderer/src/lib/drafts'
import { keepDraftsOnDisk, restoreDrafts } from '../../src/renderer/src/lib/kept-drafts'
import type { HandedPath } from '../../src/shared/runtime-ipc'
import type { SavedDrafts } from '../../src/shared/saved-drafts'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 744 · R100 — a restored draft, ON SCREEN
 *
 * ⚑ **R100:** *"restored on launch into the same slot, with the cursor at the end … an attached path
 * that no longer exists is shown as missing, not silently dropped … a draft is cleared when it is
 * sent."* ⚠️ `a-draft-survives-a-restart.test.ts` holds the rules and
 * `scripts/draft-survives-a-restart-probe.mjs` the restart itself, on the built app; this file is the
 * three things only a real engine can show: the chip a person reads, where the caret sits, and the
 * real composer's Send emptying the slot the file is written from.
 *
 * ⚠️ **The caret is a PIN, not a measurement of product code.** No line of BroBot places it: the
 * box's value is set programmatically (`v-model`), which puts the selection at the end of the new
 * value by the HTML spec, and focusing does not move it. ⚑ It is pinned because R100 names it
 * (*"with the cursor at the end"*) and a later change that DID move the caret — a `setSelectionRange`
 * on mount, say — would break the promise; it could not have been RED on `main`, where no draft came
 * back at all. The probe reads the same on the built app after a real kill.
 */

const SLOT = draftKey('conversation-a')
const PRESENT: HandedPath = { path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }
const GONE: HandedPath = { path: '/work/alpha/moved-away.md', kind: 'file', outsideCwd: false }

/** The last run's draft for A, as main hands it back — one path there, one gone. */
const SAVED: SavedDrafts = {
  drafts: [
    { slot: SLOT, text: 'half a thought, kept', attached: [PRESENT, { ...GONE, missing: true }] },
  ],
}

let book: DraftBook = createDraftBook()
let sent: unknown[][] = []

/** The conversation's composer over a REAL book, bound the way `RuntimeScreen` binds it. */
function composer(): Mounted {
  sent = []
  const words = ref(book.read(SLOT))
  const Host = defineComponent({
    name: 'RestoredComposerHost',
    setup() {
      return () =>
        h(PromptComposer as Component, {
          state: 'idle',
          cwd: '/work/alpha',
          canAttach: true,
          draft: words.value,
          handing: book.paths.handing(SLOT),
          'onUpdate:draft': (text: string) => {
            book.write(SLOT, text)
            words.value = text
          },
          onSend: (...args: unknown[]) => sent.push(args),
        })
    },
  })
  return mount(Host, {}, { width: 900 })
}

afterEach(() => {
  unmountAll()
  book = createDraftBook()
})

describe('a draft restored at launch (744 · R100)', () => {
  it('🔴 a path that is gone says MISSING on its own chip — and the one still there does not', () => {
    restoreDrafts(book, SAVED)
    const view = composer()

    expect(view.all('attached-file')).toHaveLength(2)
    const missing = view.all('attached-missing')
    expect(missing).toHaveLength(1)
    expect(visible(missing[0]!)).toBe(true)
    expect(missing[0]!.textContent?.trim()).toBe('missing')
    // ⚑ …and on hover it says the WHOLE message waits on it, which is what the send does
    expect(missing[0]!.getAttribute('title')).toBe(MISSING_ON_RESTORE)
    expect(MISSING_ON_RESTORE).toContain(
      'the message will not send until it is back or you remove it',
    )
    // ⚑ on the gone path's chip, beside its name — never instead of it
    expect(missing[0]!.closest('li')?.textContent).toContain('moved-away.md')
    expect(missing[0]!.closest('li')?.querySelector('[data-cy="detach-file"]')).not.toBeNull()
    // ⚑ …and in the danger colour: the one mark on a chip that asks the person to do something
    const danger = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim()
    const probe = document.createElement('span')
    probe.style.color = danger
    document.body.append(probe)
    expect(getComputedStyle(missing[0]!).color).toBe(getComputedStyle(probe).color)
    probe.remove()
  })

  it('🔴 the words are back in the box, and focusing it puts the caret at the END of them', async () => {
    restoreDrafts(book, SAVED)
    const view = composer()
    const box = view.q('prompt-input') as HTMLTextAreaElement
    expect(box.value).toBe('half a thought, kept')
    box.focus()
    await nextTick()
    expect(document.activeElement).toBe(box)
    expect([box.selectionStart, box.selectionEnd]).toEqual([
      'half a thought, kept'.length,
      'half a thought, kept'.length,
    ])
  })

  it('⚑ the control — a real Send empties the slot, and the file is next written WITHOUT the message', async () => {
    book.write(SLOT, 'send this one')
    book.paths.write(SLOT, [PRESENT])
    const saves: SavedDrafts[] = []
    const keeper = keepDraftsOnDisk(book, (saved) => void saves.push(saved), {
      closing: () => false,
    })
    const view = composer()

    ;(view.q('send-prompt') as HTMLButtonElement).click()
    for (let tick = 0; tick < 10 && sent.length === 0; tick += 1) await nextTick()
    expect(sent).toHaveLength(1)
    keeper.flush()
    keeper.stop()

    expect(book.read(SLOT)).toBe('')
    expect(book.paths.read(SLOT)).toEqual([])
    expect(saves.at(-1)).toEqual({ drafts: [], cleared: [SLOT] })
  })
})
