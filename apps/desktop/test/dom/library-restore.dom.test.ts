import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import type {
  ImportedBundle,
  LibraryEntry,
  LibraryPage,
  LibraryQuery,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 The way back in, ON SCREEN (214 §1, from 213 finding 1)
 *
 * `213` used BroBot for an hour, exported a `.brobot-session.json`, and went looking for the way to
 * bring one back: ⛔ *"The visible Import actions only import PROVIDER-HISTORY messages. There is no
 * bundle import, no file picker, no action of any name, anywhere in the Sessions UI."* Its verdict
 * was that this — not any of the other findings — is what stops BroBot being a durable workbench.
 *
 * ⚠️ **In the `dom` project, and it has to be.** The whole finding is *"a person could not find it"*,
 * so the assertions are painted controls in a real browser and clicks that reached the bridge. The
 * standing `brobot2-ssr-tests-pass-vacuously` rule applies at full strength: every negative here is
 * paired with a positive that fails if the surface renders nothing at all.
 *
 * ⛔ **`export-session.test.ts` owns the round trip and the refusals** — the store, the reader and
 * `194` M2's Resume. This file owns only the door.
 */

const ENTRY = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'th_1',
  provider: 'claude',
  providerSessionId: 'th_1',
  recordId: 'sess_1',
  cwd: '/work/alpha',
  title: 'a conversation',
  preview: 'hello',
  createdAt: 1_000,
  updatedAt: 2_000,
  bytes: null,
  origin: 'ours',
  onDisk: false,
  readable: true,
  derived: null,
  lastEnding: 'completed',
  unresumableReason: null,
  child: null,
  ...over,
})

const PAGE = (entries: LibraryEntry[]): LibraryPage =>
  ({
    entries,
    matched: entries.length,
    counts: {
      total: entries.length,
      ours: entries.length,
      userHome: 0,
      imported: 0,
      notImported: 0,
      onlyHere: 0,
      providers: [{ provider: 'claude', total: entries.length }],
    },
    skipped: [],
    skippedTotal: 0,
  }) as unknown as LibraryPage

type LibraryApi = {
  chooseBundle: () => Promise<string | null>
  runtime: {
    listLibrary: (input: LibraryQuery) => Promise<LibraryPage>
    importBundleFile: (input: { path: string }) => Promise<ImportedBundle>
    importUserHomeSession: () => Promise<unknown>
    rebuildLedger: () => Promise<unknown>
  }
}

const stubbed = (): { api?: LibraryApi } => window as unknown as { api?: LibraryApi }

let asked: { path: string }[] = []
let pages: LibraryPage[] = []
let reads = 0

function stub(options: { answer?: ImportedBundle; picks?: string | null } = {}): void {
  asked = []
  reads = 0
  stubbed().api = {
    chooseBundle: () => Promise.resolve(options.picks ?? null),
    runtime: {
      listLibrary: () => {
        // Each read hands back the next page, so a test can prove the list was re-read AFTER a
        // restore rather than merely that a promise resolved.
        const page = pages[Math.min(reads, pages.length - 1)]!
        reads += 1
        return Promise.resolve(page)
      },
      importBundleFile: (input) => {
        asked.push(input)
        return Promise.resolve(
          options.answer ?? { ok: false, reason: 'no answer wired in this test' },
        )
      },
      importUserHomeSession: () => Promise.resolve({}),
      rebuildLedger: () => Promise.resolve({}),
    },
  }
}

async function open(options: Parameters<typeof stub>[0] = {}): Promise<Mounted> {
  stub(options)
  const m = mount(SessionLibrary, {}, { width: 1100, height: 900 })
  await nextTick()
  await nextTick()
  return m
}

/** Type a path the way a person pastes one, so `v-model` really sees it. */
async function type(m: Mounted, path: string): Promise<void> {
  const box = m.q('library-bundle-path') as HTMLInputElement
  box.value = path
  box.dispatchEvent(new Event('input'))
  await nextTick()
}

afterEach(() => {
  unmountAll()
  pages = [PAGE([ENTRY()])]
  delete stubbed().api
})

pages = [PAGE([ENTRY()])]

describe('bringing a bundle back, from the Sessions page', () => {
  it('🔴 there is an action a person can find, painted, and it names what it does', async () => {
    // ⛔ 213 looked for exactly this and it was not there. The assertion is the three controls being
    // ON SCREEN — `visible`, not merely in the DOM — under a label that says what they are for.
    const m = await open()

    const panel = m.q('library-restore')
    expect(visible(panel)).toBe(true)
    expect(panel.textContent).toContain('Restore a conversation from a bundle')
    for (const cy of ['library-bundle-choose', 'library-bundle-path', 'library-bundle-restore']) {
      expect(visible(m.q(cy)), `${cy} is not on screen`).toBe(true)
    }
  })

  it('⛔ Restore stays off until there is a path, so it is never a control that cannot act (106)', async () => {
    const m = await open()
    const button = m.q('library-bundle-restore') as HTMLButtonElement

    expect(button.disabled).toBe(true)
    // ⚑ **563 · the reading, on the SAME element as the property.** ⛔ `disabled` says a press
    // does nothing; it says nothing about a person being able to tell what the press is for, and
    // 106's rule — *never a control that cannot act* — is about a control somebody can read.
    expect(button.textContent?.trim()).toBe('Restore')
    // The paired positive: it really does come on, so "disabled" is a state and not the only state.
    await type(m, '/exports/sess_1.brobot-session.json')
    expect(button.disabled).toBe(false)
    // …and whitespace is not a path.
    await type(m, '   ')
    expect(button.disabled).toBe(true)
  })

  it('🔴 a click sends the typed path to the host, and says what came back', async () => {
    pages = [PAGE([ENTRY()]), PAGE([ENTRY(), ENTRY({ id: 'th_2', origin: 'restored' })])]
    const m = await open({
      answer: {
        ok: true,
        sessionId: 'sess_restored',
        already: false,
        provider: 'claude',
        cwd: '/work/elsewhere',
        events: 412,
      },
    })

    await type(m, '/exports/sess_1.brobot-session.json')
    ;(m.q('library-bundle-restore') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()
    await nextTick()

    // ⛔ The PATH reached the bridge — a button that read its own field and sent something else is
    // the failure a rendered-string assertion would not see.
    expect(asked).toEqual([{ path: '/exports/sess_1.brobot-session.json' }])
    const said = m.q('library-bundle-result').textContent ?? ''
    expect(said).toContain('Restored 412 entries')
    expect(said).toContain('/work/elsewhere')
    // ⛔ …and it says the conversation is here to READ, because it is (194 M2).
    expect(said).toContain('no Resume')
    // The list was re-read, so the row it lists came from the store rather than from this surface.
    expect(reads).toBeGreaterThan(1)
  })

  it('🔴 a refusal is shown, with the host’s own reason and nothing invented', async () => {
    const m = await open({ answer: { ok: false, reason: 'that is not a BroCrew session bundle' } })

    await type(m, '/downloads/notes.txt')
    ;(m.q('library-bundle-restore') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()

    const note = m.q('library-bundle-result')
    expect(visible(note)).toBe(true)
    expect(note.textContent).toContain('that is not a BroCrew session bundle')
    // ⛔ Marked as a refusal, not as a quiet aside — `role=alert`, so it is announced.
    expect(note.getAttribute('role')).toBe('alert')
    // ⚠️ And the list was NOT re-read: nothing changed, so two thousand rows are not fetched to
    // prove it. `reads` is 1 from the mount.
    expect(reads).toBe(1)
  })

  it('⚠️ “you already have this” is its own sentence, not a quieter “restored” (194 H4)', async () => {
    // `importBundle` de-duplicates on the provider's own ref, so re-importing the same file returns
    // the id you already have. The app must not claim to have restored something it did not write.
    const m = await open({
      answer: {
        ok: true,
        sessionId: 'sess_1',
        already: true,
        provider: 'claude',
        cwd: '/work/alpha',
        events: 9,
      },
    })

    await type(m, '/exports/again.brobot-session.json')
    ;(m.q('library-bundle-restore') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()

    const said = m.q('library-bundle-result').textContent ?? ''
    expect(said).toContain('already have this conversation')
    expect(said).toContain('nothing was written')
    expect(said).not.toContain('Restored 9 entries')
  })

  it('🔴 …and a file that is NEWER gets a THIRD sentence, with the numbers in it (236 §1)', async () => {
    // ⛔ **The sentence above used to be said about this case too, and it was confidently wrong**
    // (`231` #7, from `194` H4 / `214`). A person handed a bundle exported after a second life was
    // told they already had it, and its newer half was dropped without a word.
    const m = await open({
      answer: {
        ok: true,
        sessionId: 'sess_1',
        already: true,
        behind: { held: 27, inFile: 30, heldAt: 1_700_000_000_000, fileAt: 1_800_000_000_000 },
        provider: 'claude',
        cwd: '/work/alpha',
        events: 30,
      },
    })

    await type(m, '/exports/second-life.brobot-session.json')
    ;(m.q('library-bundle-restore') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()

    const said = m.q('library-bundle-result').textContent ?? ''
    // ⚠️ **The numbers, not a vague claim.** *"A newer copy exists"* is something a reader can
    // neither check nor act on; the objection to the old sentence was that it was confident and
    // wrong, and a vague true one would be the same failure with better manners.
    expect(said).toContain('NEWER')
    expect(said).toContain('30 entries to your 27')
    expect(said).toContain('3 of them')
    // ⛔ …and it does not say the thing that was wrong, nor claim a restore.
    expect(said).not.toContain('already have this conversation')
    expect(said).not.toContain('Restored 30 entries')
    // ⚑ It says what DID happen, because "nothing was written" is the outcome.
    expect(said).toContain('Nothing was written')
  })

  it('🔴 a verdict does not outlive the path it was about', async () => {
    // ⛔ Found by an adversarial review: `restored` was never cleared when the field changed, so
    // "Restored 412 entries" stayed on screen — as `role=status`, announced — underneath a
    // different path that had never been restored.
    const m = await open({
      answer: {
        ok: true,
        sessionId: 'sess_x',
        already: false,
        provider: 'claude',
        cwd: '/w',
        events: 7,
      },
    })

    await type(m, '/exports/one.brobot-session.json')
    ;(m.q('library-bundle-restore') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()
    await nextTick()
    expect(m.q('library-bundle-result').textContent).toContain('Restored 7 entries')

    await type(m, '/exports/a-different-file.brobot-session.json')
    expect(m.host.querySelector('[data-cy="library-bundle-result"]')).toBeNull()
  })

  it('the picker fills the field, and cancelling leaves what was typed alone', async () => {
    const m = await open({ picks: '/picked/sess_2.brobot-session.json' })

    ;(m.q('library-bundle-choose') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()
    expect((m.q('library-bundle-path') as HTMLInputElement).value).toBe(
      '/picked/sess_2.brobot-session.json',
    )

    // ⛔ The paired negative, and it is the one a picker gets wrong: `null` is CANCELLED, which must
    // not blank a path somebody had already pasted.
    unmountAll()
    const cancelled = await open({ picks: null })
    await type(cancelled, '/typed/by/hand.json')
    ;(cancelled.q('library-bundle-choose') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()
    expect((cancelled.q('library-bundle-path') as HTMLInputElement).value).toBe(
      '/typed/by/hand.json',
    )
  })

  it('⛔ a restored row wears its own chip — not “ours”, which this app did not run', async () => {
    pages = [PAGE([ENTRY({ id: 'th_r', origin: 'restored', recordId: 'sess_r' })])]
    const m = await open()

    const row = m.host.querySelector('[data-cy=library-rows] li.row[data-origin=restored]')
    expect(row, 'no row carries the restored origin').not.toBeNull()
    expect(visible(row!)).toBe(true)
    expect(row!.textContent).toContain('restored from a bundle')

    // The paired negative over the SAME surface: a session we ran still reads `ours`, so the chip
    // above is a discrimination rather than a label everything wears.
    unmountAll()
    pages = [PAGE([ENTRY()])]
    const ours = await open()
    const mine = ours.host.querySelector('[data-cy=library-rows] li.row[data-origin=ours]')
    expect(mine, 'no row carries the ours origin').not.toBeNull()
    expect(mine!.textContent).not.toContain('restored from a bundle')
  })
})
