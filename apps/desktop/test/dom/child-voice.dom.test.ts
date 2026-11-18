import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import AgentState from '../../src/renderer/src/components/AgentState.vue'
import { applyEvent, createTranscript } from '../lib/core-transcript'
import type { TranscriptState } from '../../src/renderer/src/lib/transcript'
import { NEEDING_TOKEN } from '../../src/renderer/src/lib/agent-state'

import { mount, parseColor, show, unmountAll } from './harness'

afterEach(unmountAll)

const DISPATCH = 'toolu_bg'

/** One paragraph of the child talking, long enough that one line cannot hold it. */
const ESSAY = [
  'Audit complete, and the shape of it matters more than the count.',
  'The workspace holds fourteen real entries; two of them are claimed by nothing in the report,',
  'and the PNG is exactly twice the SVG in both dimensions with the same mtime to the second,',
  'which is a render rather than a second drawing. My last check corrected me on the row count:',
  '`wc -l` says 110 because the file has no trailing newline, not because a row went missing.',
].join(' ')

/**
 * ⛔ **`after` exists because without it this file could not produce the order it claimed to test**
 * (131, from 130's §5). Every sentence went in before the single tool, and the expected DOM said the
 * same, while the comment beside it read *"the run, then what it said after"*. A renderer that
 * grouped every prose row ahead of every tool row left the whole file green — the screen-level half
 * of 058 was never covered, only the fold half in `transcript.test.ts`.
 */
function ledger(prose: string[], after: string[] = [], ended = false): TranscriptEvent[] {
  return [
    { type: 'user_turn', text: 'can you run a sub agent?' },
    { type: 'assistant_message', text: '[MAIN] Yes — running one now.' },
    { type: 'tool_call', id: DISPATCH, name: 'Agent', summary: 'Find files missed by scouts' },
    {
      type: 'sub_agent',
      agentId: 'a95dbf5b26468080b',
      idKind: 'task',
      phase: 'started',
      parentToolCallId: DISPATCH,
      kind: 'general-purpose',
      title: 'Find files missed by scouts',
    },
    ...prose.map((text) => ({ type: 'assistant_message', text, parentToolCallId: DISPATCH })),
    {
      type: 'tool_call',
      id: 'child_1',
      name: 'Bash',
      summary: 'ls -la',
      parentToolCallId: DISPATCH,
    },
    {
      type: 'tool_result',
      id: 'child_1',
      summary: 'total 424',
      ok: true,
      parentToolCallId: DISPATCH,
    },
    ...after.map((text) => ({ type: 'assistant_message', text, parentToolCallId: DISPATCH })),
    ...(ended
      ? [
          {
            type: 'sub_agent',
            agentId: 'a95dbf5b26468080b',
            phase: 'ended',
            outcome: 'completed',
            parentToolCallId: DISPATCH,
          },
        ]
      : []),
    // ⛔ **The parent's own next turn, and it is the thing being protected.** Every layout number
    // below is about where THIS lands.
    { type: 'assistant_message', text: '[MAIN] Both back — here is what they found.' },
  ] as unknown as TranscriptEvent[]
}

function feed(events: TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

/** The transcript, drawn in a real engine at a real width. */
function draw(prose: string[], after: string[] = [], ended = false): ReturnType<typeof mount> {
  return mount(
    TranscriptView,
    { items: feed(ledger(prose, after, ended)).items },
    { width: 900, height: 2000 },
  )
}

describe('child speech stays out of the parent conversation', () => {
  it('does not move the parent’s next turn, however much the child says', async () => {
    // 029's founding rule, applied to speech. The comparison is the same conversation with and
    // without six forwarded paragraphs: the parent's following sentence must be at the same y.
    const quiet = draw([])
    await nextTick()
    const before = quiet.host.querySelectorAll('[data-cy=assistant-message]')
    const quietY = before[before.length - 1]!.getBoundingClientRect().top
    expect(before.length, 'both of the parent’s turns are on screen').toBe(2)
    quiet.unmount()

    const loud = draw(Array.from({ length: 6 }, (_, i) => `${i + 1}. ${ESSAY}`))
    await nextTick()
    const after = loud.host.querySelectorAll('[data-cy=assistant-message]')
    // ⛔ Still TWO — six forwarded paragraphs are not six turns. This is 078's rule at the DOM.
    expect(after.length, 'a talking child became a turn in the conversation').toBe(2)
    expect(after[after.length - 1]!.getBoundingClientRect().top).toBeCloseTo(quietY, 1)
  })

  it('is never amber — and the amber it refuses is real', async () => {
    const view = draw([ESSAY])
    await nextTick()
    const plate = view.q('subagent-entry').querySelector('[data-cy=agent-state]')!
    // `subAgentFacets` returns no `needing` at all, so the attention corner is not drawn. Prose
    // never promotes (127/108): speech is not a request, and amber is the channel a request spends.
    expect(plate.getAttribute('data-needing')).toBeNull()
    expect(view.q('subagent-entry').querySelector('[data-cy=agent-needing]')).toBeNull()

    // ⛔ **The paired positive, on the same component the session plate uses.** Without it the
    // negative above passes just as happily against a badge that was deleted — and the point is
    // that the channel exists, is amber, and this card declines to spend it.
    const asking = mount(AgentState, {
      doing: 'working',
      being: 'live',
      needing: 'permission',
      size: 44,
    })
    await nextTick()
    const badge = asking.q('agent-needing')
    const painted = parseColor(getComputedStyle(badge).backgroundColor)
    // ⚠️ **Resolved BY the engine, WHERE THE BADGE SITS — and the second half is not pedantry.**
    // `--waiting` is one hex on the app's dark surface and another inside the plate, because the
    // plate is `data-on-white` (126's island). A probe on `document.body` answers `#f2b865` and the
    // badge paints `#92400e`; comparing those two would fail a correct badge. So the probe is a
    // child of the plate, which is the only place the question means anything.
    const probe = document.createElement('span')
    probe.style.color = `var(${NEEDING_TOKEN.permission})`
    badge.parentElement!.append(probe)
    const waiting = parseColor(getComputedStyle(probe).color)
    // …and the island is doing something, or the line above would be asserting against the root's
    // value by accident (126's `data-on-white`, pinned from the one surface that reads it).
    const onDark = document.createElement('span')
    onDark.style.color = `var(${NEEDING_TOKEN.permission})`
    document.body.append(onDark)
    expect(
      parseColor(getComputedStyle(onDark).color),
      'the plate is no longer an island — this test would pass against the root',
    ).not.toEqual(waiting)
    probe.remove()
    onDark.remove()
    expect(waiting, `${NEEDING_TOKEN.permission} resolves to nothing`).not.toBeNull()
    expect(painted, 'the permission badge paints no fill').not.toBeNull()
    expect(painted!.slice(0, 3), `permission is not --waiting: ${show(painted!)}`).toEqual(
      waiting!.slice(0, 3),
    )
  })
})
