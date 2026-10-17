import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import {
  applyEvent,
  createTranscript,
  markPermissionAnswered,
  markReadOnly,
  markReopened,
  markUserInputAnswered,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'

/**
 * The session panel (037) — what still needs you, beside the conversation instead of scrolled away
 * inside it.
 *
 * ⚠️ **Every assertion here goes through the fold.** Nothing constructs a panel entry directly.
 * That is the point of the whole task: the panel is a PROJECTION of `TranscriptState`, so a test
 * that built entries by hand would prove the renderer works and say nothing at all about the thing
 * that can actually go wrong — the panel and the transcript disagreeing about the same session.
 *
 * The drift tests below are the acceptance criterion. Each one settles something and then asserts
 * BOTH that the entry left the panel and that the transcript item is still there saying what
 * happened to it. A panel that empties because the transcript lost the item would pass the first
 * half and be a different bug.
 */

const scope = {
  cwd: '/tmp/scratch',
  paths: ['write /tmp/scratch/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

function permissionRequest(id = 'req_1'): TranscriptEvent {
  return { type: 'permission_request', id, kind: 'file', action: 'Write', detail: 'out.txt', scope }
}

function question(id = 'ask_1'): TranscriptEvent {
  return {
    type: 'user_input_request',
    id,
    prompt: 'Which database should the importer read?',
    questions: [
      {
        id: 'q1',
        prompt: 'Which database?',
        options: [{ label: 'primary' }, { label: 'replica' }],
      },
    ],
  }
}

function feed(state: TranscriptState, ...events: TranscriptEvent[]): TranscriptState {
  for (const event of events) applyEvent(state, event)
  return state
}

/** The four sections, all open at once — the shape most of these tests start from. */
function busySession(): TranscriptState {
  return feed(
    createTranscript(),
    { type: 'user_turn', text: 'do the thing' },
    {
      type: 'plan_update',
      steps: [
        { text: 'read', status: 'done' },
        { text: 'write', status: 'active' },
      ],
    },
    { type: 'tool_call', id: 'call_1', name: 'Task', summary: 'explore the tree' },
    {
      type: 'sub_agent',
      agentId: 'a1',
      phase: 'started',
      parentToolCallId: 'call_1',
      title: 'explore',
    },
    permissionRequest(),
    question(),
  )
}

describe('the panel is computed from the fold, never beside it (037)', () => {
  it('reads all four sections off one TranscriptState', () => {
    const panel = sessionPanel(busySession())

    expect(panel.permissions.map((entry) => entry.title)).toEqual(['Write'])
    expect(panel.questions.map((entry) => entry.title)).toEqual(['Which database?'])
    expect(panel.agents.map((entry) => entry.title)).toEqual(['explore'])
    expect(panel.todo).toMatchObject({ done: 1 })
    expect(panel.todo?.steps).toHaveLength(2)
    expect(panel.empty).toBe(false)
  })

  it('counts only what is blocked on the user, not what is merely happening', () => {
    // A running agent and an unfinished checklist are not a number you can bring down, and a badge
    // that never reaches zero is a badge nobody reads.
    const working = feed(
      createTranscript(),
      { type: 'plan_update', steps: [{ text: 'write', status: 'active' }] },
      { type: 'tool_call', id: 'call_1', name: 'Task', summary: 'explore' },
      { type: 'sub_agent', agentId: 'a1', phase: 'started', parentToolCallId: 'call_1' },
    )

    const panel = sessionPanel(working)
    expect(panel.waiting).toBe(0)
    // …and yet the panel is NOT empty: there is something to look at, it just is not a demand.
    expect(panel.empty).toBe(false)
    expect(sessionPanel(busySession()).waiting).toBe(2)
  })

  it('points every entry at the transcript item that renders it', () => {
    const state = busySession()
    const panel = sessionPanel(state)
    const ids = new Set(state.items.map((item) => item.id))

    for (const entry of [...panel.permissions, ...panel.questions, ...panel.agents]) {
      expect(ids, `${entry.key} points at an item that is not in the transcript`).toContain(
        entry.itemId,
      )
    }
    expect(ids).toContain(panel.todo?.itemId)
    // The agent's card hangs off the tool row that dispatched it (029), so the row is where a
    // reader has to be taken — the card is not an item of its own.
    const home = state.items.find((item) => item.id === panel.agents[0]?.itemId)
    expect(home).toMatchObject({ kind: 'tool', callId: 'call_1' })
  })

  it('finds an agent nested inside another agent, and still names a real item (035)', () => {
    const state = feed(
      createTranscript(),
      { type: 'tool_call', id: 'call_1', name: 'Task', summary: 'parent' },
      { type: 'sub_agent', agentId: 'a1', phase: 'started', parentToolCallId: 'call_1' },
      // The child's own call, which becomes a dispatch point rather than a row…
      {
        type: 'tool_call',
        id: 'call_2',
        name: 'Task',
        summary: 'child',
        parentToolCallId: 'call_1',
      },
      // …and the grandchild hanging off it, whose home is `card:a1` and not an item id at all.
      {
        type: 'sub_agent',
        agentId: 'a2',
        phase: 'started',
        parentToolCallId: 'call_2',
        title: 'deep',
      },
    )

    const panel = sessionPanel(state)
    expect(panel.agents.map((entry) => entry.key)).toEqual(['agent:a1', 'agent:a2'])
    // Both resolve to the ONE item on screen: the top-level row. A grandchild whose `subAgentHomes`
    // entry is `card:a1` would otherwise have nowhere to send a reader.
    expect(new Set(panel.agents.map((entry) => entry.itemId)).size).toBe(1)
    expect(state.items.some((item) => item.id === panel.agents[1]?.itemId)).toBe(true)
  })
})

describe('the panel cannot drift from the transcript (037)', () => {
  it('answering a permission removes it from the panel and settles it in the transcript', () => {
    const state = busySession()
    expect(sessionPanel(state).permissions).toHaveLength(1)

    markPermissionAnswered(state, 'req_1', 'allow')

    expect(sessionPanel(state).permissions).toEqual([])
    expect(sessionPanel(state).waiting).toBe(1) // the question is still open
    // The transcript keeps the card — settled, not deleted. The panel lists what is OPEN; the
    // conversation is still the record of what happened.
    expect(state.items.filter((item) => item.kind === 'permission')).toMatchObject([
      { outcome: 'allow', note: null },
    ])
  })

  it('answering a question removes it, and so does the provider withdrawing one (051)', () => {
    const answered = busySession()
    markUserInputAnswered(answered, 'ask_1', 'answered')
    expect(sessionPanel(answered).questions).toEqual([])
    expect(answered.items.filter((item) => item.kind === 'userInput')).toMatchObject([
      { answered: 'answered' },
    ])

    // The other way a request stops being ours to answer: nobody pressed anything.
    const withdrawn = feed(busySession(), { type: 'request_resolved', id: 'ask_1' })
    expect(sessionPanel(withdrawn).questions).toEqual([])
    expect(sessionPanel(withdrawn).permissions).toHaveLength(1)
  })

  it('an agent that ends stops being listed as running', () => {
    const state = busySession()
    expect(sessionPanel(state).agents).toHaveLength(1)

    feed(state, { type: 'sub_agent', agentId: 'a1', phase: 'ended', outcome: 'completed' })

    expect(sessionPanel(state).agents).toEqual([])
    // The card is still on its row, with what it reported — the panel stopped claiming it is
    // running, which is a different statement from the card being gone.
    const row = state.items.find((item) => item.kind === 'tool')
    expect(row).toMatchObject({
      subAgents: [{ agentId: 'a1', running: false, outcome: 'completed' }],
    })
  })

  it('a turn ending clears every agent, at every depth (029/035)', () => {
    const state = feed(
      createTranscript(),
      { type: 'tool_call', id: 'call_1', name: 'Task', summary: 'parent' },
      { type: 'sub_agent', agentId: 'a1', phase: 'started', parentToolCallId: 'call_1' },
      {
        type: 'tool_call',
        id: 'call_2',
        name: 'Task',
        summary: 'child',
        parentToolCallId: 'call_1',
      },
      { type: 'sub_agent', agentId: 'a2', phase: 'started', parentToolCallId: 'call_2' },
    )
    expect(sessionPanel(state).agents).toHaveLength(2)

    feed(state, { type: 'turn', state: 'completed' })

    // A sub-agent cannot outlive the turn that dispatched it, so neither can its panel row.
    expect(sessionPanel(state).agents).toEqual([])
  })

  it('the checklist leaves when its last step is done', () => {
    const state = feed(createTranscript(), {
      type: 'plan_update',
      steps: [{ text: 'write', status: 'active' }],
    })
    expect(sessionPanel(state).todo).not.toBeNull()

    feed(state, { type: 'plan_update', steps: [{ text: 'write', status: 'done' }] })

    expect(sessionPanel(state).todo).toBeNull()
    // The plan is still in the conversation. "Done" leaves the panel; it does not leave history.
    expect(state.items.filter((item) => item.kind === 'plan')).toHaveLength(1)
  })

  it('the CURRENT checklist is the one shown, and an abandoned one does not come back', () => {
    // The rule this pins: LAST plan wins, unconditionally. Turn 1 is interrupted with a step still
    // active; turn 2 opens its own block (028 — a new turn never rewrites the old one) and
    // finishes it. The panel then shows nothing, even though an item with an `active` step is
    // still in the transcript above.
    //
    // That is the intended answer and it is worth stating out loud, because "show the most recent
    // UNFINISHED plan" is the other reasonable rule and it is wrong here: it would resurrect a
    // checklist the agent abandoned two turns ago and put it back in front of the user as though
    // it were live. The transcript keeps it — history is where an abandoned plan belongs.
    const state = feed(
      createTranscript(),
      { type: 'plan_update', steps: [{ text: 'abandoned', status: 'active' }] },
      { type: 'turn', state: 'interrupted' },
      { type: 'plan_update', steps: [{ text: 'finished', status: 'done' }] },
    )

    expect(state.items.filter((item) => item.kind === 'plan')).toHaveLength(2)
    expect(sessionPanel(state).todo).toBeNull()

    // …and the newest one is what is shown while it IS open, not the oldest.
    const second = feed(
      createTranscript(),
      { type: 'plan_update', steps: [{ text: 'old', status: 'active' }] },
      { type: 'turn', state: 'completed' },
      { type: 'plan_update', steps: [{ text: 'new', status: 'active' }] },
    )
    expect(sessionPanel(second).todo?.steps.map((step) => step.text)).toEqual(['new'])
  })

  it('a plan document with no checklist is not a todo (030)', () => {
    const state = feed(createTranscript(), {
      type: 'plan_update',
      steps: [],
      body: '# the plan\n\nrewrite the importer',
    })

    expect(state.items.filter((item) => item.kind === 'plan')).toHaveLength(1)
    expect(sessionPanel(state).todo).toBeNull()
    expect(sessionPanel(state).empty).toBe(true)
  })

  it('a session ending empties the panel, because nothing can be answered any more', () => {
    const state = busySession()
    feed(state, { type: 'status', state: 'ended' })

    const panel = sessionPanel(state)
    // Teardown settles every pending card with a note, and the turn ending stopped the agent. The
    // checklist is the one thing that legitimately survives: it is what the turn set out to do.
    expect({ waiting: panel.waiting, agents: panel.agents.length }).toEqual({
      waiting: 0,
      agents: 0,
    })
    expect(panel.todo).not.toBeNull()
  })
})

describe('the panel is rebuilt by the same fold on replay and resume (037)', () => {
  it('folding the same events twice yields the same panel', () => {
    // The resume path replays the ledger through `applyEvent`, the same door live events come
    // through — so "does a resumed session show what it had" is this equality, exactly.
    expect(sessionPanel(busySession())).toEqual(sessionPanel(busySession()))
  })

  it('a resumed session SETTLES the questions it had, and drops the agents it lost (085)', () => {
    // After `bridge.resume` returns a new handle, the resumed adapter has an empty request
    // map. Old permission ids are `unseen` and answering them throws, so old cards must not
    // remain counted as the person’s pending answers. `markReopened` must reflect that new
    // process boundary.
    //
    // ⚠️ **And it was worse than a refusal.** `panel.waiting` is what freezes the composer
    // (`ConversationPane.composerState`), so a conversation resumed with an open card could neither
    // be answered — refused by the new adapter — nor typed into. It was unusable, permanently, and
    // the only way out was to abandon the conversation.
    const state = busySession()
    expect(sessionPanel(state).waiting, 'positive: they really were waiting before').toBe(2)

    markReopened(state)

    const panel = sessionPanel(state)
    // Nothing is waiting for these answers, so the panel does not claim anything is.
    expect(panel.waiting).toBe(0)
    // …and the composer is free again, which is the half a count alone would not have caught.
    expect(panel.empty || panel.waiting === 0).toBe(true)
    // Whatever the sub-agent was doing died with the process that was doing it (029). A card still
    // claiming to be running after a relaunch is a statement about now, and it is false.
    expect(panel.agents).toEqual([])
  })

  it('a read-only recording has nothing waiting, because nothing in it can be answered (047)', () => {
    const state = busySession()
    markReadOnly(state, 'this conversation is a recording')

    const panel = sessionPanel(state)
    expect({ waiting: panel.waiting, agents: panel.agents.length }).toEqual({
      waiting: 0,
      agents: 0,
    })
    // …which is why the reading pane does not mount the panel: it would be a column that is empty
    // by construction. The checklist survives with its active step returned to `pending`.
    expect(panel.todo?.steps.map((step) => step.status)).toEqual(['done', 'pending'])
  })
})

describe('the panel subscribes to nothing (037 acceptance 2)', () => {
  const source = (path: string): string =>
    readFileSync(new URL(`../src/renderer/src/${path}`, import.meta.url), 'utf8')

  it('neither the projection nor the component can reach the event stream', () => {
    // The failure this rules out is not a typo, it is a design drift: someone adds `onEvent` here
    // "just for the panel", and from that day the app has two folds and two answers. The check is
    // structural because by the time the two disagree, the test that catches it is a flake.
    for (const file of ['lib/session-panel.ts', 'components/SessionPanel.vue']) {
      const code = source(file)
      for (const forbidden of ['useSessionStore', 'runtime.', 'onEvent', 'addEventListener']) {
        expect(code, `${file} must not reach past the fold (${forbidden})`).not.toContain(forbidden)
      }
      // It may not fold events either — a second `applyEvent` is a second store wearing a
      // function's clothes.
      expect(code, `${file} must not fold events`).not.toContain('applyEvent')
    }
  })

  /**
   * ⚠️ The one criterion no test in this suite can PROVE, and what is done about it instead.
   *
   * "Clicking navigates" (acceptance 4) is a claim about layout: the row is pressed, the scroll
   * container moves, the entry ends up in the pane. This project's test environment is `node` with
   * Vue's server renderer — there is no DOM, no layout, `scrollIntoView` does not exist and every
   * scroll number is zero. Mounting it in a real DOM would mean adding jsdom to the repo, and jsdom
   * has no layout engine either: `scrollIntoView` is a no-op stub there, so the test would assert
   * that a function it stubbed was called. That is not evidence.
   *
   * So the behaviour is proven by live smoke step 29 and NOWHERE ELSE, which is stated here rather
   * than left for someone to discover. What this test does pin is the part that is checkable and
   * that silently rots: the three links of the chain still exist and still agree on their names. A
   * renamed emit or a dropped binding is the realistic way this breaks, and it would otherwise be
   * caught only by the batched smoke run, tasks later.
   */
  it('the navigate chain is joined end to end — the part a DOM-less test can pin', () => {
    // ⚑ The row is the agent card's since the panel's top agent became `AgentCard`; the panel
    // forwards the card's `navigate` under the same name.
    const card = source('components/AgentCard.vue')
    const panel = source('components/SessionPanel.vue')
    const pane = source('components/ConversationPane.vue')
    const view = source('components/TranscriptView.vue')

    // 1 · the row emits, and it is the row that emits — not the section, not the header.
    expect(card).toContain("emit('navigate', entry.itemId)")
    expect(card).toContain('navigate: [itemId: string]')
    expect(panel).toContain('@navigate="(itemId) => emit(\'navigate\', itemId)"')
    expect(panel).toContain('navigate: [itemId: string]')
    // 2 · the pane binds that exact name to its own forwarder…
    expect(pane).toContain('@navigate="focus"')
    expect(pane).toContain('view.value?.focusItem(itemId)')
    // 3 · …and the transcript exposes it under that name, on the ref the pane holds.
    expect(view).toContain('defineExpose({ focusItem })')
    expect(pane).toContain('ref="view"')
    // 4 · and the thing `focusItem` looks for is the thing the transcript actually writes.
    // ⚑ **`587` folded the list into ROWS and a row is not always an item** — a run of settled tool
    // calls is one wrapper over several, carrying its FIRST call's id.
    //
    // ⛔ **So a navigation to the 2nd…Nth member of a run would find nothing**, and the first draft
    // of this note claimed the opposite. ⚠️ **What makes that safe is not the wrapper, it is what
    // the panel EMITS**: `session-panel.ts` gives a tool item's id for exactly two kinds of row —
    // a sub-agent home and a workflow home — and `joinsARun` excludes both, so no ordinary settled
    // call's id ever reaches `focusItem`. A run's finished thoughts are members too, and the panel
    // never links to a thought. 🔴 **Add a third and this stops being true**; both
    // wrappers are asserted below so the arm this dispatch added is at least covered.
    expect(view).toContain(':data-item="row.item.id"')
    expect(view).toContain(':data-item="row.members[0]?.id"')
    expect(view).toContain('.entry[data-item=')
  })

  it('everything it shows is reachable from a TranscriptState alone', () => {
    // The positive form of the same claim, and the one that would survive a rename: the projection
    // takes one argument, and it is the fold's own state.
    expect(sessionPanel.length).toBe(1)
    expect(sessionPanel(createTranscript())).toEqual({
      questions: [],
      permissions: [],
      assets: [],
      agents: [],
      workflows: [],
      todo: null,
      waiting: 0,
      empty: true,
      // ⛔ The fourth thing the panel now knows and does not list (250) — false on a fresh fold,
      // because a registry nobody has stated is empty and `dropped` is zero with it.
      stillRunning: false,
      runningNamed: false,
      // ⛔ …and the FIFTH (258), false on a fresh fold for the same reason — and it is deliberately
      // false rather than absent for a Codex conversation too. The distinction between *"nothing is
      // scheduled"* and *"this provider was never asked"* is kept by nothing drawing a negative
      // from it, not by a third value here.
      scheduled: false,
    })
  })
})
