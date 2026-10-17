import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { RuntimeEvent } from '@brobot2/runtime'
import ScheduleBar from '../src/renderer/src/components/ScheduleBar.vue'
import { SCHEDULED } from '../src/shared/agent-state'
import { droppedScheduleNote } from '../src/renderer/src/lib/scheduled-work'
import {
  applyEvent,
  createTranscript,
  type ScheduleRegistry,
} from '../src/renderer/src/lib/transcript'

/**
 * # 258 · **The schedule, server-rendered**
 *
 * ⚠️ **SSR renders the first frame and nothing else** (086) — there is no DOM, no styles and no
 * clicks. Its assertions cover the compact first frame; real DOM controls cover opening and
 * closing the prompt popup, its keyboard behavior and its full text.
 *
 * ⛔ **Every negative below is paired with a positive from the same fixture**, and it has to be:
 * `not.toContain('scheduled')` also passes against a component that rendered nothing, which is
 * `193`'s vacuity and this repo's most-repeated finding.
 *
 * 🔴 **And every assertion runs against the markup with COMMENTS STRIPPED.** SSR emits template
 * comments verbatim, and this component's own prose quotes *"scheduled"*, *"above the composer"* and
 * the whole `253` argument by name — so a `toContain` on the raw HTML would hold whatever the rows
 * rendered. Three assertions in `background-bar.render.test.ts` were passing over exactly that,
 * found by the adversarial pass over `251`'s diff.
 */

/** A measured scheduled job; the expression is data rather than prose — see `scheduled-work.ts`. */
const JOB = {
  id: 'e3826cc5',
  schedule: '*/2 * * * *',
  recurring: true,
  prompt: 'check whether person.txt has appeared on the Desktop',
}

const registry = (over: Partial<ScheduleRegistry> = {}): ScheduleRegistry => ({
  jobs: [JOB],
  dropped: 0,
  left: [],
  ...over,
})

async function raw(reg: ScheduleRegistry): Promise<string> {
  return renderToString(createSSRApp(ScheduleBar, { registry: reg }))
}

async function bar(reg: ScheduleRegistry): Promise<string> {
  return (await raw(reg)).replace(/<!--[\s\S]*?-->/g, '')
}

/** What one cell renders, entities decoded — the point of this helper is what a PERSON reads. */
function cell(html: string, cy: string): string {
  const found = new RegExp(`data-cy="${cy}"[^>]*>([\\s\\S]*?)</`).exec(html)?.[1] ?? ''
  expect(found, `nothing rendered for data-cy="${cy}"`).not.toBe('')
  return found
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

describe('258 §3 · the bar above the composer', () => {
  it('⛔ says WHEN, whether it repeats, and WHAT it will ask', async () => {
    // §3's requirement, in one render: *"A job shows its schedule, whether it recurs, and its
    // prompt."*
    const html = await bar(registry())
    expect(html).toContain('data-cy="schedule-bar"')
    expect(cell(html, 'schedule-head')).toBe('1 job is scheduled')
    expect(cell(html, `schedule-when-${JOB.id}`)).toBe(JOB.schedule)
    expect(cell(html, `schedule-repeat-${JOB.id}`)).toBe('repeats')
    expect(cell(html, `schedule-asks-${JOB.id}`)).toBe(JOB.prompt)
    // ⛔ No parser and no clock claim: the expression is the provider's, unchanged, and nothing
    // beside it re-words it. The paired positive is the equality above.
    expect(html).not.toContain('next run')
    expect(html).not.toContain('every 2 minutes')
  })

  it('⛔ nothing scheduled, nothing on screen — and the bar really can render', async () => {
    // ⚠️ **This is the CODEX rule** (§1): a provider that has never been asked must not read as
    // *"nothing is scheduled"*. The way it is kept is that nothing draws a negative at all — an
    // absent bar is not a claim, which is `248`'s own line — and the same emptiness covers a Claude
    // conversation that has simply not ended a turn yet.
    const empty = await bar(registry({ jobs: [] }))
    expect(empty).not.toContain('data-cy="schedule-bar"')
    expect(empty).not.toContain(SCHEDULED)
    // ⛔ **Nothing but the `v-if` placeholder** — said as an equality rather than as three absences,
    // because "does not contain X" is satisfied by a component that also drew something ELSE wrong.
    expect(empty.trim()).toBe('')
    expect((await raw(registry({ jobs: [] }))).trim()).toBe('<!---->')
    // …the paired positive, so the three lines above are facts about the registry rather than about
    // a component that cannot render.
    // ⚑ **563 · and it is READ rather than found.** ⛔ `toContain('data-cy="schedule-bar"')` is
    // `not.toBeNull()` spelled for a string: a bar that drew its container and no words keeps it,
    // and then every absence above would be paired with an empty strip. 🔴 `cell` is this file's
    // own helper and its docblock says why — *"the point of this helper is what a PERSON reads."*
    expect(cell(await bar(registry()), 'schedule-head')).toBe('1 job is scheduled')
  })

  it('🔴 §2 · a CLOSED conversation keeps the rows — the same bar, with no asleep line', async () => {
    // ⚑ **D-029 moved this fact.** 258 §2 drew a closed conversation's rows muted, under *"Nothing
    // here fires until this conversation takes its next message"* — true then, false now: this app
    // starts a stopped conversation in time for the jobs its provider will bring back, so the
    // sentence, its `schedule-asleep` cell and the `data-sleeping` mute went, and the bar has ONE
    // state. ⚠️ Driven through the FOLD rather than a hand-built registry, because a registry no
    // longer carries a field that says *closed* — the close is real only on a transcript that
    // folded it, so that is the only place this case can still be asked.
    const state = createTranscript()
    applyEvent(state, { type: 'scheduled_work', jobs: [JOB], source: 'hook/Stop' } as RuntimeEvent)
    const open = await bar(state.schedule)
    applyEvent(state, { type: 'session', state: 'ended' } as RuntimeEvent)
    // …the premise, read off the fold rather than assumed: the close really happened.
    expect(state.ended).toBe(true)
    const closed = await bar(state.schedule)
    // The job is still listed — `253` measured that a resumed session gets the same one back, so a
    // bar that dropped it would be deleting something that still exists.
    expect(cell(closed, `schedule-when-${JOB.id}`)).toBe(JOB.schedule)
    // ⛔ **The heading is the one it always was, and present tense is the fix rather than an
    // oversight.** The first draft changed its verb — *"will wake this conversation"* → *"is still
    // scheduled"* — and the adversarial pass over this diff refuted the future tense outright: the
    // level is restated only at turn end, so a job deleted mid-turn would go on being promised.
    expect(cell(closed, 'schedule-head')).toBe('1 job is scheduled')
    // ⛔ **The word `${SCHEDULED}` is the vocabulary's, not a literal written twice** — the
    // heading above is pinned to the exact sentence a person reads AND to the shared word.
    expect(cell(closed, 'schedule-head')).toContain(SCHEDULED)
    // ⛔ **One state, said as an equality**: the close changes nothing a person sees. ⚠️ The three
    // absences after it are not redundant with it — an asleep line drawn in BOTH states would keep
    // the equality — and each is paired with the rows and heading read off this same markup above.
    expect(closed).toBe(open)
    expect(closed).not.toContain('data-cy="schedule-asleep"')
    expect(closed).not.toContain('data-sleeping')
    expect(closed).not.toContain('next message')
  })

  it('⛔ a level this app cannot list still DRAWS, with a true heading (092/247 §3)', async () => {
    // `248`'s bar renders nothing at all in this state, because its `v-if` and its heading both
    // count `running.length` — the defect `250` had to route around in `PANEL_EMPTY_WORDS.unnamed`.
    const short = await bar(registry({ jobs: [], dropped: 2 }))
    expect(short).toContain('data-cy="schedule-bar"')
    expect(cell(short, 'schedule-head')).toBe('2 jobs are scheduled')
    expect(cell(short, 'schedule-dropped')).toBe(droppedScheduleNote(2))
    // …and no row was invented to fill the gap.
    expect(short).not.toContain('data-cy="schedule-row-')
    // The paired positive: a listed job DOES produce a row, from the same component.
    expect(await bar(registry())).toContain(`data-cy="schedule-row-${JOB.id}"`)
  })

  it('⛔ a job with neither a schedule nor a prompt is named by its id, never blank (106)', async () => {
    const html = await bar(registry({ jobs: [{ id: 'e3826cc5' }] }))
    expect(html).toContain('data-bare="true"')
    expect(cell(html, 'schedule-id-e3826cc5')).toBe('e3826cc5')
    // …and the paired positive: a job that HAS a schedule is not bare and shows no id cell.
    const full = await bar(registry())
    expect(full).toContain('data-bare="false"')
    expect(full).not.toContain('data-cy="schedule-id-')
  })

  it('🔴 …and that id is QUOTED, because on a bare row it is the whole line', async () => {
    // ⛔ **The first draft drew `line.id` raw** (found by the adversarial pass over this diff, by two
    // angles). `readJob` accepts any non-empty string and only length-clips it, so a job whose id
    // carried U+202E would reorder everything drawn after it — on the one surface whose stated job is
    // saying what this machine has promised to do while nobody is watching. It is the ONE cell that
    // can be the entire row, and it was the one cell `breaksTheRow` was not applied to.
    const hostile = await bar(registry({ jobs: [{ id: 'rm \u202E x' }] }))
    const drawn = cell(hostile, 'schedule-id-rm \u202E x')
    expect(drawn).toBe('"rm \\u202e x"')
    expect(drawn).not.toContain('\u202E')
    // …and the paired positive: an ordinary id is not quoted, from the same component.
    expect(cell(await bar(registry({ jobs: [{ id: 'e3826cc5' }] })), 'schedule-id-e3826cc5')).toBe(
      'e3826cc5',
    )
  })

  it('a compact preview keeps the available copy on its title without an obsolete excerpt count', async () => {
    // The compact preview is shorter than the old excerpt. Its tooltip keeps the available copy;
    // the popup's real DOM control checks that the copy can be opened and read.
    const long = 'x'.repeat(1_200)
    const html = await bar(registry({ jobs: [{ ...JOB, prompt: long }] }))
    expect(cell(html, `schedule-asks-${JOB.id}`)).toBe(`${'x'.repeat(100)}…`)
    expect(html).not.toContain(`data-cy="schedule-asks-cut-${JOB.id}"`)
    const title = /data-cy="schedule-asks-[^"]*"[^>]*title="([^"]*)"/.exec(html)?.[1] ?? ''
    expect(title, 'the cut cell has no title at all').not.toBe('')
    expect(title).toContain(long)
    // …and the paired positive on an UNCUT cell: the title still carries the caveat, so this is one
    // rule rather than a special case that only fires when something is missing.
    const short = await bar(registry())
    const plain = /data-cy="schedule-asks-[^"]*"[^>]*title="([^"]*)"/.exec(short)?.[1] ?? ''
    expect(plain).toContain('may have shortened')
    expect(plain).toContain(JOB.prompt)
  })

  it('a multiline prompt has a single-line preview; the popup retains its line breaks', async () => {
    // A preview stays on one line; the decoded prompt is read in the popup instead.
    const html = await bar(registry({ jobs: [{ ...JOB, prompt: 'one\ntwo' }] }))
    const asks = cell(html, `schedule-asks-${JOB.id}`)
    expect(asks).toBe('one two')
    // …and the paired positive: an ordinary prompt comes through exactly as the model wrote it.
    expect(cell(await bar(registry()), `schedule-asks-${JOB.id}`)).toBe(JOB.prompt)
  })
})
