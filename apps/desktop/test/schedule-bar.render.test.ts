import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { decode, shown } from './helpers/rendered-markup'
import ScheduleBar from '../src/renderer/src/components/ScheduleBar.vue'
import { SCHEDULED } from '../src/shared/agent-state'
import { droppedScheduleNote } from '../src/renderer/src/lib/scheduled-work'
import type { ScheduleRegistry } from '../src/renderer/src/lib/transcript'

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
  return shown(await raw(reg))
}

function cell(html: string, cy: string): string {
  const found = new RegExp(`data-cy="${cy}"[^>]*>([\\s\\S]*?)</`).exec(html)?.[1] ?? ''
  expect(found, `nothing rendered for data-cy="${cy}"`).not.toBe('')
  return decode(found.replace(/<[^>]+>/g, '')).trim()
}

describe('the bar above the composer', () => {
  it('says WHEN, whether it repeats, and WHAT it will ask', async () => {
    const html = await bar(registry())
    expect(html).toContain('data-cy="schedule-bar"')
    expect(cell(html, 'schedule-head')).toBe('1 job is scheduled')
    expect(cell(html, `schedule-when-${JOB.id}`)).toBe(JOB.schedule)
    expect(cell(html, `schedule-repeat-${JOB.id}`)).toBe('repeats')
    expect(cell(html, `schedule-asks-${JOB.id}`)).toBe(JOB.prompt)
    expect(html).not.toContain('next run')
    expect(html).not.toContain('every 2 minutes')
  })

  it('nothing scheduled, nothing on screen — and the bar really can render', async () => {
    const empty = await bar(registry({ jobs: [] }))
    expect(empty).not.toContain('data-cy="schedule-bar"')
    expect(empty).not.toContain(SCHEDULED)
    expect(empty.trim()).toBe('')
    expect((await raw(registry({ jobs: [] }))).trim()).toBe('<!---->')
    expect(cell(await bar(registry()), 'schedule-head')).toBe('1 job is scheduled')
  })

  it('a level this app cannot list still DRAWS, with a true heading', async () => {
    const short = await bar(registry({ jobs: [], dropped: 2 }))
    expect(short).toContain('data-cy="schedule-bar"')
    expect(cell(short, 'schedule-head')).toBe('2 jobs are scheduled')
    expect(cell(short, 'schedule-dropped')).toBe(droppedScheduleNote(2))
    expect(short).not.toContain('data-cy="schedule-row-')
    expect(await bar(registry())).toContain(`data-cy="schedule-row-${JOB.id}"`)
  })

  it('a job with neither a schedule nor a prompt is named by its id, never blank', async () => {
    const html = await bar(registry({ jobs: [{ id: 'e3826cc5' }] }))
    expect(html).toContain('data-bare="true"')
    expect(cell(html, 'schedule-id-e3826cc5')).toBe('e3826cc5')
    const full = await bar(registry())
    expect(full).toContain('data-bare="false"')
    expect(full).not.toContain('data-cy="schedule-id-')
  })

  it('…and that id is QUOTED, because on a bare row it is the whole line', async () => {
    const hostile = await bar(registry({ jobs: [{ id: 'rm \u202E x' }] }))
    const drawn = cell(hostile, 'schedule-id-rm \u202E x')
    expect(drawn).toBe('"rm \\u202e x"')
    expect(drawn).not.toContain('\u202E')
    expect(cell(await bar(registry({ jobs: [{ id: 'e3826cc5' }] })), 'schedule-id-e3826cc5')).toBe(
      'e3826cc5',
    )
  })

  it('a compact preview keeps the available copy on its title without an obsolete excerpt count', async () => {
    const long = 'x'.repeat(1_200)
    const html = await bar(registry({ jobs: [{ ...JOB, prompt: long }] }))
    expect(cell(html, `schedule-asks-${JOB.id}`)).toBe(`${'x'.repeat(100)}…`)
    expect(html).not.toContain(`data-cy="schedule-asks-cut-${JOB.id}"`)
    const title = /data-cy="schedule-asks-[^"]*"[^>]*title="([^"]*)"/.exec(html)?.[1] ?? ''
    expect(title, 'the cut cell has no title at all').not.toBe('')
    expect(title).toContain(long)
    const short = await bar(registry())
    const plain = /data-cy="schedule-asks-[^"]*"[^>]*title="([^"]*)"/.exec(short)?.[1] ?? ''
    expect(plain).toContain('may have shortened')
    expect(plain).toContain(JOB.prompt)
  })

  it('a multiline prompt has a single-line preview; the popup retains its line breaks', async () => {
    const html = await bar(registry({ jobs: [{ ...JOB, prompt: 'one\ntwo' }] }))
    const asks = cell(html, `schedule-asks-${JOB.id}`)
    expect(asks).toBe('one two')
    expect(cell(await bar(registry()), `schedule-asks-${JOB.id}`)).toBe(JOB.prompt)
  })
})
