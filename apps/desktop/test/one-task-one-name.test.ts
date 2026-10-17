import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import { pieceCalled } from '../src/shared/piece-called'
import { stalledWorkLead } from '../src/renderer/src/lib/persons-queue'
import type { StalledWork } from '../src/shared/stalled-work'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { code, sourceFiles as rendererFiles, spellingsIn } from './lib/task-spellings'

/**
 * All rows use the piece label supplied by the store rather than composing a number or
 * project name. Keep the fold and spelling census here; the DOM test checks the visible rows.
 */

const here = dirname(fileURLToPath(import.meta.url))
const RENDERER = join(here, '..', 'src', 'renderer', 'src')
const SHARED = join(here, '..', 'src', 'shared')

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const asked = (over: Record<string, unknown>): TranscriptEvent =>
  ev({
    type: 'question_asked',
    requestId: 'req_1',
    prompt: 'Which time zones?',
    questions: [{ id: 'answer', prompt: 'Which time zones?', options: [] }],
    ...over,
  })

const notices = (events: readonly TranscriptEvent[]): string[] => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state.items
    .filter((item): item is NoticeItem => item.kind === 'notice')
    .map((item) => item.text)
}

describe('§1 · the one function', () => {
  // ⚑ **D-016** — this was two functions; the one that said the project after the number went
  // with projects, and the other is the label now: the numbers from the root down.
  it('⚑ one spelling, and no project said beside it', () => {
    expect(pieceCalled([1, 3])).toBe('W1.3')
    expect(pieceCalled([3])).toBe('W3')
  })
})

describe('§1b · the stalled row, which the review found still saying *Work #3*', () => {
  it('🔴 it names the piece the way the card does — and keeps its consequence', () => {
    const work = {
      label: 'W1.3',
      ownerName: 'Pam',
      giverName: 'Ada',
    } as unknown as StalledWork
    expect(stalledWorkLead(work)).toBe(
      'W1.3 with Pam is not being worked on, and Ada — which gave it out — has not been told.',
    )
    expect(stalledWorkLead(work)).not.toContain('Work #')
  })
})

describe('§2 · the notice a question about work leaves in the transcript', () => {
  it('🔴 a question about a piece names it the way the card does — by the label the row carries', () => {
    expect(notices([asked({ piece: 'work_1', label: 'W1.3' })])).toContain('asked about W1.3')
  })

  it('⚑ planted controls — the arms with no label to print say what is true', () => {
    // ⚠️ a piece whose row carries no label it can print: there is no name, and none is guessed
    expect(notices([asked({ piece: 'work_9' })])).toEqual(['asked about a piece of work'])
    expect(notices([asked({ piece: 'work_9', label: '#3' })])).toEqual([
      'asked about a piece of work',
    ])
    // ⚠️ a question about no piece says so (D-016: an agent may ask another about none)
    expect(notices([asked({})])).toEqual(['asked a question about no piece of work'])
    // ⚠️ a passed-up question names no piece of this conversation's (`611`)
    expect(notices([asked({ passedUpFrom: 'req_0', piece: 'work_1', label: 'W1.3' })])).toEqual([
      'passed a question up',
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the census — found by the CALL, over every renderer file
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ⚑ **705 · the reader — `SPELLINGS`, `spellingsIn`, `code` and the file walk — is in
// `lib/task-spellings.ts`**, shared with `a-task-is-task-n-where-a-person-reads-it.test.ts` §3,
// which points it at `main/`, `shared/` and the packages. One reader, so two populations compare.

/**
 * ⚑ **The shared modules the renderer imports** — derived from its own imports, not listed, because
 * a sentence the renderer DRAWS can be composed in `shared/` and called from here (`672`'s review:
 * the stalled row's *"Work #3"* was exactly that, and a census walking the renderer alone was blind
 * to it). ⛔ Standing rule 27.1: scoped by what it is about, not by where things live today.
 */
function sharedTheRendererImports(): string[] {
  const names = new Set<string>()
  for (const file of rendererFiles(RENDERER)) {
    for (const found of readFileSync(file, 'utf8').matchAll(
      /from '(?:\.\.\/)+shared\/([a-z0-9-]+)'/g,
    )) {
      names.add(found[1]!)
    }
  }
  return [...names].map((name) => join(SHARED, `${name}.ts`))
}

describe('§3 · no row writes a number of its own', () => {
  it('⚑ the reader finds every shape — the control plants ELEVEN, the seven the review found among them', () => {
    const planted = [
      'notice(state, "info", `asked about #${String(number)}`)',
      '<template v-if="x">on its task list as #{{ arrived }}</template>',
      "const said = '#' + String(work.number)",
      'return `Work ${work.number} is stalled`',
      "return 'asked about #' + String(number)",
      "return 'Task #' + String(number)",
      'const s = "on its task list as #" + n',
      'const s = `as #` + String(n)',
      '<span>Task {{ task.number }}</span>',
      '<span># {{ task.number }}</span>',
      'const s = `task # ${n}`',
    ]
    for (const shape of planted) expect(spellingsIn(shape), shape).toHaveLength(1)
    // ⚑ the old one spelling is itself a hit — which is why it WAS in the population below
    expect(spellingsIn('return `Task #${String(number)}`')).toHaveLength(1)
    // ⛔ …and the label's spelling is not: `W` and the numbers, with no `#` and no noun before them
    expect(spellingsIn("return `W${numbers.map((number) => String(number)).join('.')}`")).toEqual(
      [],
    )
    // ⛔ the control's other half: a markdown heading and a hash in a URL are not a task
    expect(spellingsIn("lines.push('# ' + title)")).toEqual([])
  })

  it('🔴 the population is exactly five prints that are not a row’s piece', () => {
    const shared = sharedTheRendererImports()
    // ⚑ non-vacuity: the derived set is real, and it holds the module the review found
    expect(shared.length).toBeGreaterThan(10)
    expect(shared).toContain(join(SHARED, 'stalled-work.ts'))
    const found: string[] = []
    for (const file of [...rendererFiles(RENDERER), ...shared]) {
      for (const line of spellingsIn(code(readFileSync(file, 'utf8')))) {
        const at = file.startsWith(RENDERER)
          ? file.slice(RENDERER.length + 1).replaceAll('\\', '/')
          : `shared/${file.slice(SHARED.length + 1).replaceAll('\\', '/')}`
        found.push(`${at} · ${line}`)
      }
    }
    expect(found.sort()).toEqual(
      [
        // ⚑ D-016 · `shared/task-called.ts`' `Task #${…}` — the ONE spelling every row asked since
        // `697` — went with tasks: a piece's label is `pieceCalled`'s, which prints no `#`
        // The fragment selects the indicator's SVG symbol; it prints no piece number.
        'lib/message-links.ts · `<svg class="icon message-link-indicator" role="img" aria-label="${agent ? \'Agent link\' : \'Conversation link\'}"><use href="#${agent ? \'i-user\' : \'i-chat\'}"></use></svg>`',
        // ⚑ an element id handed to a selector, not a task
        "components/CommandPalette.vue · panel.value?.querySelector(`#${CSS.escape(row.id)}`)?.scrollIntoView({ block: 'nearest' })",
        // ⚑ a list key a person never reads (⚑ D-016: `ProjectWorkspace.vue`'s went with the room)
        'lib/whose-groups.ts · key: `${item.path}#${String(index)}`,',
        // ⚑ two Markdown headings in the readable export — a `#` that is a heading, not a number
        'lib/readable-export.ts · `# ${title}`,',
        'lib/readable-export.ts · at === undefined ? `### ${who}` : `### ${who} · ${new Date(at).toISOString()}`',
        // ⚑ `697` · `672` H2: `shared/stalled-work.ts`' *"Work #3 with Pam…"* is gone — the next
        // test says so by the module's own exports
      ].sort(),
    )
  })

  it('⛔ …and the retired sentence is gone from `shared/` — not merely uncalled (697 · 672 H2)', async () => {
    const exported = Object.keys(await import('../src/shared/stalled-work'))
    expect(exported).not.toContain('stalledWorkSays')
    // ⚑ the control: the module is read — the observation it keeps is still exported
    expect(exported).toContain('stalledWorkSaid')
    // ⚑ the control: the renderer's own lead IS called, where the band is built
    expect(code(readFileSync(join(RENDERER, 'lib/persons-queue.ts'), 'utf8'))).toContain(
      'says: stalledWorkLead(work),',
    )
  })

  it('⚑ each row that names a piece prints its label — in the file that draws it', () => {
    const read = (path: string): string => code(readFileSync(join(RENDERER, path), 'utf8'))
    // ⚑ D-016 · each row prints the LABEL it was handed — the store spelled it with `pieceCalled`
    expect(read('lib/transcript.ts')).toContain('`asked about ${event.label}`')
    expect(read('components/QueuedMessage.vue')).toContain('on its list as {{ arrived }}')
    expect(read('components/PersonsQueue.vue')).toContain('return work.label')
    // ⚑ D-016 · `lib/project-roster.ts` went with the project room.
  })
})
