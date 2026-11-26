import { expect, it } from 'vitest'
import {
  applyEvent,
  createTranscript,
  markReadOnly,
  markReopened,
} from '../src/renderer/src/lib/transcript'
import { panelRuns } from '../src/renderer/src/lib/panel-runs'
import { carryForward, foldWindow } from '../src/renderer/src/lib/transcript-window'

it.each(['command', 'agent', 'workflow', 'monitor'] as const)(
  'retains supplied %s input and sparse ending facts without inventing a call',
  (kind) => {
    const state = createTranscript()
    applyEvent(state, {
      type: 'background_work',
      source: 'fixture',
      running: [
        {
          id: 'native-task',
          description: 'Read the route',
          run: { kind, input: 'Read all route notes' },
        },
      ],
    })
    applyEvent(state, {
      type: 'background_work',
      source: 'fixture',
      progress: {
        id: 'native-task',
        run: { progress: 'Reading the footpath notes' },
      },
    })
    applyEvent(state, {
      type: 'background_work',
      source: 'fixture',
      running: [],
      ended: {
        id: 'native-task',
        outcome: 'completed',
      },
    })
    applyEvent(state, {
      type: 'background_work',
      source: 'fixture',
      ended: {
        id: 'native-task',
        outcome: 'completed',
        run: { result: 'Footpath checked' },
      },
    })
    const result = panelRuns(state)
    expect(result.active).toEqual([])
    expect(result.past).toHaveLength(1)
    expect(result.past[0]).toMatchObject({
      label: 'Read all route notes',
      detail: 'Footpath checked',
      status: 'Done',
      target: { kind: 'background', id: 'native-task' },
      run: {
        kind,
        input: 'Read all route notes',
        progress: 'Reading the footpath notes',
        result: 'Footpath checked',
      },
    })
    expect(state.items.some((item) => item.kind === 'tool')).toBe(false)
    const carry = carryForward(state, [])
    expect(panelRuns(foldWindow([], null, carry)).past).toEqual(result.past)
    carry.background.history!.pop()
    expect(state.background.history).toHaveLength(1)
  },
)

it('keeps a call outside the loaded window readable from the actual task facts', () => {
  const state = createTranscript()
  applyEvent(state, {
    type: 'background_work',
    source: 'fixture',
    running: [
      {
        id: 'process',
        toolCallId: 'unloaded-call',
        run: { kind: 'command', input: 'node check-route.mjs' },
      },
    ],
  })
  expect(panelRuns(state).active).toMatchObject([
    { target: { kind: 'background', id: 'process' }, label: 'node check-route.mjs' },
  ])
})

it('retains observed input when the empty level arrives before the ending', () => {
  const state = createTranscript()
  applyEvent(state, {
    type: 'background_work',
    source: 'fixture',
    running: [
      {
        id: 'route',
        description: 'Read the route',
        run: { kind: 'monitor', input: 'Watch the footpath' },
      },
    ],
  })
  applyEvent(state, { type: 'background_work', source: 'fixture', running: [] })
  expect(panelRuns(state).active).toEqual([])
  expect(panelRuns(state).past).toEqual([])
  applyEvent(state, {
    type: 'background_work',
    source: 'fixture',
    progress: { id: 'route', run: { progress: 'Last path checked' } },
  })
  expect(panelRuns(state).active).toEqual([])
  applyEvent(state, {
    type: 'background_work',
    source: 'fixture',
    ended: { id: 'route', outcome: 'completed', run: { result: 'Paths checked' } },
  })
  expect(panelRuns(state).past).toMatchObject([
    {
      label: 'Watch the footpath',
      detail: 'Paths checked',
      run: { progress: 'Last path checked' },
    },
  ])
  applyEvent(state, { type: 'status', state: 'ended' })
  expect(panelRuns(state).past).toMatchObject([
    { label: 'Watch the footpath', detail: 'Paths checked' },
  ])
})

it.each([undefined, 'unloaded-call'])(
  'retains unfinished background facts across session boundaries with binding %s',
  (toolCallId) => {
    for (const boundary of ['ended', 'reopened', 'read-only'] as const) {
      for (const emptyLevel of [false, true]) {
        const state = createTranscript()
        const run = {
          kind: 'command' as const,
          input: 'Read the route',
          progress: 'Reading notes',
        }
        applyEvent(state, {
          type: 'background_work',
          source: 'fixture',
          running: [{ id: 'route-task', toolCallId, run }],
        })
        if (emptyLevel)
          applyEvent(state, { type: 'background_work', source: 'fixture', running: [] })
        if (boundary === 'ended') applyEvent(state, { type: 'status', state: 'ended' })
        else if (boundary === 'reopened') markReopened(state)
        else markReadOnly(state, 'Recorded conversation')
        const past = panelRuns(state).past
        expect(panelRuns(state).active).toEqual([])
        expect(past).toMatchObject([
          {
            status: 'did not finish',
            failed: false,
            target: { kind: 'background', id: 'route-task' },
            run,
          },
        ])
        expect(state.background.history?.[0]?.outcome).toBeUndefined()
        expect(panelRuns(foldWindow([], null, carryForward(state, []))).past).toEqual(past)
        applyEvent(state, {
          type: 'background_work',
          source: 'fixture',
          ended: { id: 'route-task', outcome: 'completed', run: { result: 'Route checked' } },
        })
        expect(panelRuns(state).past).toMatchObject([
          { status: 'Done', run: { ...run, result: 'Route checked' } },
        ])
      }
    }
  },
)
