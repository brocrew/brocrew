import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import DeleteConversation from '../../src/renderer/src/components/DeleteConversation.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import { RECOVERY_COPIES_STAY } from '../../src/renderer/src/lib/archive-and-delete'
import { sizeWords } from '../../src/renderer/src/lib/files-kept'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import type {
  ArchiveOutcome,
  DeleteOutcome,
  DeleteVerdict,
} from '../../src/shared/conversation-archive'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * The confirmation before a conversation is deleted, as a person meets it: main's check is read
 * first, a refusal is shown with Archive as the way out where it names one, each part is a real
 * checkbox, only the ticked parts are sent, and what the delete did is said afterwards.
 */

const NOTE = 'note:/homes/pm/memory/its-note.md'
const RECOVERY =
  'The recovery copies in the data folder still hold its records until newer copies replace them.'
const HISTORY = 'The prompt history in an agent’s folder isn’t changed.'

const LISTED: Extract<DeleteVerdict, { ok: true }> = {
  ok: true,
  conversation: 'sess_root',
  name: 'W1 · Bakery website',
  helpers: [{ conversation: 'sess_helper', name: 'W1.1 · Photos' }],
  parts: [
    {
      id: 'records',
      kind: 'records',
      says: 'Its messages and pieces of work, with the same of the 1 helper below it: W1.1 · Photos.',
      conversation: 'sess_root',
      paths: [],
      bytes: null,
    },
    {
      id: 'files:sess_root',
      kind: 'provider-files',
      says: 'W1 · Bakery website’s transcript and what was kept for it (2 items).',
      conversation: 'sess_root',
      paths: ['/homes/pm/projects/p/root.jsonl', '/homes/pm/projects/p/root'],
      bytes: 3 * 1024 * 1024,
    },
    {
      id: NOTE,
      kind: 'memory-note',
      says: 'A memory note W1 · Bakery website wrote: “its-note” — what it learned',
      conversation: 'sess_root',
      paths: ['/homes/pm/memory/its-note.md'],
      bytes: 120,
    },
  ],
  ends: ['W1.1 · Photos is running: it is stopped first.'],
  stays: ['Copies of what it sent to other conversations stay in theirs.'],
  cannot: [HISTORY, RECOVERY],
}

type Api = {
  runtime: {
    checkDeleteConversation: (input: { sessionId: string }) => Promise<DeleteVerdict>
    deleteConversation: (input: { sessionId: string; parts: string[] }) => Promise<DeleteOutcome>
    archiveConversation: (input: { sessionId: string }) => Promise<ArchiveOutcome>
  }
}
const stubbed = (): { api?: Api } => window as unknown as { api?: Api }

let checks: { sessionId: string }[] = []
let deletes: { sessionId: string; parts: string[] }[] = []
let archives: { sessionId: string }[] = []

function stub(
  answers: {
    verdict?: DeleteVerdict
    outcome?: DeleteOutcome
    archived?: ArchiveOutcome
  } = {},
): void {
  checks = []
  deletes = []
  archives = []
  stubbed().api = {
    runtime: {
      checkDeleteConversation: (input) => {
        checks.push(input)
        return Promise.resolve(answers.verdict ?? LISTED)
      },
      deleteConversation: (input) => {
        deletes.push(input)
        return Promise.resolve(
          answers.outcome ?? { done: true, removed: input.parts, left: [], recordsKept: null },
        )
      },
      archiveConversation: (input) => {
        archives.push(input)
        return Promise.resolve(answers.archived ?? { done: true, conversations: ['sess_helper'] })
      },
    },
  }
}

interface Opened {
  m: Mounted
  closed: number[]
  archived: (readonly string[])[]
  deleted: (readonly string[])[]
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await nextTick()
}

async function open(sessionId = 'sess_root'): Promise<Opened> {
  const closed: number[] = []
  const archived: (readonly string[])[] = []
  const deleted: (readonly string[])[] = []
  const Sheet = defineComponent({
    name: 'TheDeleteSheet',
    setup: () => () =>
      h(
        OverlayHost,
        { label: 'Delete a conversation', onClose: () => closed.push(1) },
        {
          default: () =>
            h(DeleteConversation, {
              sessionId,
              onClose: () => closed.push(1),
              onArchived: (conversations: readonly string[]) => archived.push(conversations),
              onDeleted: (conversations: readonly string[]) => deleted.push(conversations),
            }),
        },
      ),
  })
  const m = mount(Sheet, {}, { width: 10, height: 10 })
  await settle()
  return { m, closed, archived, deleted }
}

const ticks = (m: Mounted): Record<string, boolean> =>
  Object.fromEntries(
    m
      .all('delete-part')
      .map((part) => [
        part.dataset.part ?? '',
        (part.querySelector('[data-cy="delete-tick"]') as HTMLInputElement).checked,
      ]),
  )

const partOf = (m: Mounted, id: string): HTMLElement =>
  m.all('delete-part').find((part) => part.dataset.part === id)!

async function tick(m: Mounted, id: string, on: boolean): Promise<void> {
  const box = partOf(m, id).querySelector('[data-cy="delete-tick"]') as HTMLInputElement
  box.checked = on
  box.dispatchEvent(new Event('change'))
  await nextTick()
}

const confirm = (m: Mounted): HTMLButtonElement => m.q('delete-confirm') as HTMLButtonElement

const safety = useSpawnSafety()

beforeEach(() => {
  // No stop lane, so the sheet's own controls are the only stops in the trap.
  safety.forget()
})

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

describe('the check is read first', () => {
  it('opening the sheet asks main what a delete of this conversation would remove', async () => {
    stub()
    const { m } = await open()
    expect(checks).toEqual([{ sessionId: 'sess_root' }])
    expect(deletes).toEqual([])
    expect(m.q('delete-title').textContent).toBe('Delete W1 · Bakery website?')
    expect(visible(m.q('delete-conversation'))).toBe(true)
  })
})

describe('a delete main refuses', () => {
  const HELPER =
    'W1.1 · Photos was started as a helper, so it is deleted only with W1 · Bakery website, the ' +
    'conversation at the top of its tree: delete W1 · Bakery website, or archive this one.'

  it('shows the refusal as main wrote it, with no ticks and no Delete', async () => {
    stub({ verdict: { ok: false, refusal: HELPER } })
    const { m } = await open('sess_helper')
    expect(m.q('delete-refusal').textContent?.trim()).toBe(HELPER)
    expect(m.q('delete-refusal').getAttribute('role')).toBe('alert')
    expect(m.all('delete-part')).toHaveLength(0)
    expect(m.all('delete-confirm')).toHaveLength(0)
  })

  it('Archive is the way out: it archives this conversation, says so upward, and closes', async () => {
    stub({ verdict: { ok: false, refusal: HELPER } })
    const { m, closed, archived, deleted } = await open('sess_helper')
    m.q('delete-archive-instead').click()
    await settle()
    expect(archives).toEqual([{ sessionId: 'sess_helper' }])
    expect(archived).toEqual([['sess_helper']])
    expect(closed).toHaveLength(1)
    expect(deleted).toEqual([])
    expect(deletes).toEqual([])
  })

  it('an archive main refuses is shown too, and the sheet stays open', async () => {
    const refusal = 'There is no conversation by that name to archive.'
    stub({ verdict: { ok: false, refusal: HELPER }, archived: { done: false, refusal } })
    const { m, closed, archived } = await open('sess_helper')
    m.q('delete-archive-instead').click()
    await settle()
    expect(m.q('delete-archive-refused').textContent?.trim()).toBe(refusal)
    expect(archived).toEqual([])
    expect(closed).toHaveLength(0)
  })

  it('a refusal that names no Archive offers none', async () => {
    stub({ verdict: { ok: false, refusal: 'There is no conversation by that name to delete.' } })
    const { m } = await open()
    expect(m.all('delete-refusal')).toHaveLength(1)
    expect(m.all('delete-archive-instead')).toHaveLength(0)
    expect(m.all('delete-close')).toHaveLength(1)
  })
})

describe('one tick per part', () => {
  it('the records and the files are ticked, and the memory note is not', async () => {
    stub()
    const { m } = await open()
    expect(ticks(m)).toEqual({ records: true, 'files:sess_root': true, [NOTE]: false })
  })

  it('each tick is a real checkbox inside its own label, which says main’s line', async () => {
    stub()
    const { m } = await open()
    for (const one of LISTED.parts) {
      const box = partOf(m, one.id).querySelector('input')!
      expect(box.type).toBe('checkbox')
      const label = box.closest('label')
      expect(label, `${one.id} has no label`).not.toBeNull()
      expect(label!.textContent).toContain(one.says)
    }
  })

  it('the files say their size in the app’s words and keep their paths in a native disclosure', async () => {
    stub()
    const { m } = await open()
    const files = partOf(m, 'files:sess_root')
    expect(files.querySelector('[data-cy="delete-size"]')!.textContent).toBe(
      sizeWords(3 * 1024 * 1024),
    )
    const paths = files.querySelector('details')!
    expect(paths.open).toBe(false)
    expect(paths.querySelector('summary')!.textContent?.trim()).toBe('2 paths')
    expect([...paths.querySelectorAll('li')].map((li) => li.textContent)).toEqual(
      LISTED.parts[1]!.paths,
    )
    // The control: the records and a note carry neither a size nor a disclosure.
    for (const id of ['records', NOTE]) {
      expect(partOf(m, id).querySelector('details')).toBeNull()
      expect(partOf(m, id).querySelector('[data-cy="delete-size"]')).toBeNull()
    }
  })
})

describe('the three lists, and the recovery copies', () => {
  it('what it ends, what stays and what it can’t remove are each listed under the ticks', async () => {
    stub()
    const { m } = await open()
    expect(m.q('delete-ends').textContent).toContain(LISTED.ends[0])
    expect(m.q('delete-stays').textContent).toContain(LISTED.stays[0])
    expect(m.q('delete-cannot').textContent).toContain(HISTORY)
    const parts = m.q('delete-parts')
    for (const cy of ['delete-ends', 'delete-stays', 'delete-cannot']) {
      expect(
        parts.compareDocumentPosition(m.q(cy)) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${cy} is not under the ticks`,
      ).toBeTruthy()
    }
  })

  it('main’s sentence about the recovery copies is a line of its own, drawn and not folded', async () => {
    stub()
    const { m } = await open()
    const line = m.q('delete-recovery-copies')
    expect(line.textContent?.trim()).toBe(RECOVERY)
    expect(visible(line)).toBe(true)
    expect(line.closest('details')).toBeNull()
    expect(line.closest('li')).toBeNull()
    expect(m.all('delete-recovery-copies')).toHaveLength(1)
  })

  it('a list that never mentions them gets the window’s own true line', async () => {
    stub({ verdict: { ...LISTED, cannot: [HISTORY] } })
    const { m } = await open()
    expect(m.q('delete-recovery-copies').textContent?.trim()).toBe(RECOVERY_COPIES_STAY)
    expect(visible(m.q('delete-recovery-copies'))).toBe(true)
  })
})

describe('the Delete button', () => {
  it('is drawn in the danger colours, and is a press with the default ticks', async () => {
    stub()
    const { m } = await open()
    expect(confirm(m).classList.contains('danger')).toBe(true)
    expect(confirm(m).disabled).toBe(false)
    expect(getComputedStyle(confirm(m)).color).not.toBe(
      getComputedStyle(m.q('delete-cancel')).color,
    )
  })

  it('is disabled with nothing ticked, and a press then sends nothing', async () => {
    stub()
    const { m } = await open()
    await tick(m, 'records', false)
    await tick(m, 'files:sess_root', false)
    expect(confirm(m).disabled).toBe(true)
    confirm(m).click()
    await settle()
    expect(deletes).toEqual([])

    // The control: one tick makes it a press again.
    await tick(m, NOTE, true)
    expect(confirm(m).disabled).toBe(false)
  })

  it('sends only the ticked parts, and never an unticked one', async () => {
    stub()
    const { m } = await open()
    await tick(m, 'files:sess_root', false)
    await tick(m, NOTE, true)
    confirm(m).click()
    await settle()
    expect(deletes).toEqual([{ sessionId: 'sess_root', parts: ['records', NOTE] }])
  })

  it('with the defaults it sends the records and the files, and not the note', async () => {
    stub()
    const { m } = await open()
    confirm(m).click()
    await settle()
    expect(deletes).toEqual([{ sessionId: 'sess_root', parts: ['records', 'files:sess_root'] }])
  })
})

describe('what the delete answered', () => {
  it('refused: nothing was removed, the refusal is shown, and "Read it again" asks the check again', async () => {
    const refusal = 'What it would remove changed while it was being stopped. Read it again.'
    stub({ outcome: { done: false, refusal } })
    const { m, deleted } = await open()
    confirm(m).click()
    await settle()

    expect(m.q('delete-not-done').textContent?.trim()).toBe(refusal)
    expect(m.q('delete-nothing-removed').textContent?.trim()).toBe('Nothing was removed.')
    expect(deleted).toEqual([])
    expect(checks).toHaveLength(1)

    m.q('delete-read-again').click()
    await settle()
    expect(checks).toEqual([{ sessionId: 'sess_root' }, { sessionId: 'sess_root' }])
    // Back on the list, with the ticks as they open.
    expect(m.all('delete-not-done')).toHaveLength(0)
    expect(ticks(m)).toEqual({ records: true, 'files:sess_root': true, [NOTE]: false })
  })

  it('done: it says what went, and tells the window which conversations are gone', async () => {
    stub()
    const { m, deleted, closed } = await open()
    confirm(m).click()
    await settle()

    const went = m.q('delete-removed').textContent ?? ''
    expect(went).toContain(LISTED.parts[0]!.says)
    expect(went).toContain(LISTED.parts[1]!.says)
    expect(went).not.toContain(LISTED.parts[2]!.says)
    expect(deleted).toEqual([['sess_root', 'sess_helper']])
    expect(m.all('delete-left')).toHaveLength(0)
    expect(m.all('delete-records-kept')).toHaveLength(0)
    // The sheet stays up so the answer can be read; Close is the way out.
    expect(closed).toHaveLength(0)
    expect(m.all('delete-confirm')).toHaveLength(0)
    m.q('delete-close').click()
    expect(closed).toHaveLength(1)
  })

  it('left: each file left is listed with its path and why, and the kept records say so', async () => {
    const kept =
      'Its records were kept, because a file could not be removed. Close what holds it, then ' +
      'delete again.'
    stub({
      outcome: {
        done: true,
        removed: [],
        left: [{ path: '/homes/pm/projects/p/root.jsonl', why: 'Another program holds it open.' }],
        recordsKept: kept,
      },
    })
    const { m, deleted } = await open()
    confirm(m).click()
    await settle()

    const left = m.q('delete-left').textContent ?? ''
    expect(left).toContain('/homes/pm/projects/p/root.jsonl')
    expect(left).toContain('Another program holds it open.')
    expect(m.q('delete-records-kept').textContent?.trim()).toBe(kept)
    expect(m.q('delete-removed').textContent).toContain('Nothing was deleted.')
    // The records stayed, so no conversation left the window.
    expect(deleted).toEqual([])
  })

  it('files alone: the conversation is still there, so the window is told of none gone', async () => {
    stub()
    const { m, deleted } = await open()
    await tick(m, 'records', false)
    confirm(m).click()
    await settle()
    expect(deletes).toEqual([{ sessionId: 'sess_root', parts: ['files:sess_root'] }])
    expect(m.q('delete-removed').textContent).toContain(LISTED.parts[1]!.says)
    expect(deleted).toEqual([])
  })
})

describe('keys and focus', () => {
  const press = (key: 'Escape' | 'Tab', shiftKey = false): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
  }

  it('the sheet opens with the focus on Close, never on Delete', async () => {
    stub()
    const { m } = await open()
    expect(document.activeElement).toBe(m.q('close-overlay'))
    expect(document.activeElement).not.toBe(confirm(m))
  })

  it('Escape asks to close, and deletes nothing', async () => {
    stub()
    const { closed } = await open()
    press('Escape')
    await nextTick()
    expect(closed).toHaveLength(1)
    expect(deletes).toEqual([])
  })

  it('Tab stays inside: Shift+Tab from Close lands on Delete, and Tab comes back', async () => {
    stub()
    const { m } = await open()
    m.q('close-overlay').focus()
    press('Tab', true)
    await nextTick()
    expect(document.activeElement).toBe(confirm(m))
    press('Tab')
    await nextTick()
    expect(document.activeElement).toBe(m.q('close-overlay'))
  })

  it('the ticks and the paths disclosure are stops a keyboard reaches', async () => {
    stub()
    const { m } = await open()
    const box = partOf(m, 'records').querySelector('input')!
    box.focus()
    expect(document.activeElement).toBe(box)
    const summary = partOf(m, 'files:sess_root').querySelector('summary')!
    summary.focus()
    expect(document.activeElement).toBe(summary)
    // Space on a focused checkbox is the browser's own toggle; a click is what it sends.
    box.click()
    await nextTick()
    expect(ticks(m).records).toBe(false)
  })
})
