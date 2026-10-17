import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import SessionPanel from '../src/renderer/src/components/SessionPanel.vue'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import { formatTokens, groupTokens } from '../src/renderer/src/lib/context-meter'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'

/**
 * The session panel, rendered (037).
 *
 * A `.render.test.ts` because it imports an SFC — those are checked by `vue-tsc` under the web
 * project, not by the node one. What it adds over `session-panel.test.ts` is everything the
 * projection cannot say on its own: that an empty panel READS as deliberate, that no section sits
 * at zero, that a row carries the item id navigation needs, and that there is no second way to
 * answer anything here.
 *
 * What it deliberately does NOT claim: that clicking a row scrolls. There is no layout in an SSR
 * render — every scroll number is zero and `scrollIntoView` does not exist — so that claim belongs
 * to the live smoke (step 29) and is made nowhere else.
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

function feed(state: TranscriptState, ...events: TranscriptEvent[]): TranscriptState {
  for (const event of events) applyEvent(state, event)
  return state
}

/** The four sections, all open at once. */
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
    {
      type: 'permission_request',
      id: 'req_1',
      kind: 'file',
      action: 'Write',
      detail: 'out.txt',
      scope,
    },
    {
      type: 'user_input_request',
      id: 'ask_1',
      prompt: 'Which database should the importer read?',
      questions: [
        {
          id: 'q1',
          prompt: 'Which database?',
          options: [{ label: 'primary' }, { label: 'replica' }],
        },
      ],
    },
  )
}

describe('the panel renders as a way in, and says so when there is nothing (037)', () => {
  const render = (
    state: TranscriptState,
    mode: 'normal' | 'debug' = 'normal',
    over: Record<string, unknown> = {},
  ): Promise<string> =>
    renderToString(createSSRApp({ render: () => h(SessionPanel, { state, mode, ...over }) }))

  it('names each open thing and points it at its transcript item', async () => {
    const state = busySession()
    const html = await render(state)

    expect(html).toContain('data-cy="panel-permissions"')
    expect(html).toContain('data-cy="panel-questions"')
    expect(html).toContain('data-cy="panel-agents"')
    expect(html).toContain('data-cy="panel-todo"')
    expect(html).toContain('Which database?')
    for (const entry of sessionPanel(state).permissions) {
      expect(html).toContain(`data-item="${entry.itemId}"`)
    }
    expect(html).not.toContain('data-cy="session-panel-empty"')
  })

  /**
   * ⚠️ **The fixture 088's review added, and the one 090 must keep exercising.**
   *
   * Agents running, nothing BLOCKED. It exists because `busySession()` opens a permission, a
   * question, an agent AND a checklist at once, so any predicate keyed on the waiting COUNT rather
   * than on the tab's emptiness would have looked right in every other test here. 090 deletes the
   * predicate entirely, and this stays as the state acceptance 3 names by hand.
   */
  function agentsOnly(): TranscriptState {
    return feed(
      createTranscript(),
      { type: 'tool_call', id: 'call_1', name: 'Task', summary: 'explore the tree' },
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'started',
        parentToolCallId: 'call_1',
        title: 'explore',
      },
    )
  }

  /** The block's own markup, stopping at its close — never a row mark from the list below it. */
  const botBlock = (html: string): string => {
    const from = html.indexOf('data-cy="session-bot"')
    expect(from, 'nothing with data-cy="session-bot" was rendered').toBeGreaterThan(-1)
    const rest = html.slice(from)
    // The block ends before the run strip that follows it under the plate, and so before the
    // scroller whose rows draw marks of their own. Not at the first `</div>`: the name's row is a
    // `<div>` holding the approval mode and its panel.
    const end = rest.indexOf('data-cy="card-run"')
    expect(end, 'nothing follows the block to bound it').toBeGreaterThan(-1)
    const block = rest.slice(0, end)
    // ⚠️ …and if the strip ever came first, this slice would hold nothing and every `not.toContain`
    // below would pass over it. So the helper proves it reached the plate before returning.
    expect(block, 'the block slice stopped before the plate').toContain('data-cy="agent-state"')
    return block
  }

  /** The underline span's own classes — `none` is the unpainted slot. Order-independent. */
  const underlineClasses = (block: string): string[] =>
    (/<span class="([^"]*)"[^>]*data-cy="agent-underline"/.exec(block)?.[1] ?? '').split(' ')

  it('the bot is ONE size in ONE place, whatever is in the tab (090)', async () => {
    // Keep the state control at a permanent, stable position at the top, with the same size
    // whether items are present or absent. The Open tab still exposes attention items without
    // shifting the control as its state changes.
    //
    // ⚠️ The three fixtures are the three shapes the deleted predicate distinguished: the empty tab
    // it drew big, agents-with-nothing-waiting (the case 088's own review added, because the other
    // two both have `waiting > 0` and a count-keyed predicate would have looked right), and
    // everything open at once. If any branch survived anywhere, these three disagree.
    const facets = { doing: 'thinking' as const, being: 'live' as const }
    const states = {
      empty: createTranscript(),
      'agents, nothing waiting': agentsOnly(),
      'everything open': busySession(),
    }
    // The middle fixture is only worth anything if it really is the shape 088's review named.
    const middle = sessionPanel(states['agents, nothing waiting'])
    expect(middle.waiting).toBe(0)
    expect(middle.agents.length).toBeGreaterThan(0)
    expect(middle.empty).toBe(false)

    for (const [name, state] of Object.entries(states)) {
      const html = await render(state, 'normal', { facets, who: 'project-manager' })
      const block = botBlock(html)
      const size = /data-size="(\d+)"/.exec(block)?.[1] ?? ''
      // ⚠️ Stated ABSOLUTELY, one fixture at a time — not by collecting the three and asserting they
      // agree. "They agree" is satisfied by three blocks that all drew nothing, and a `Set` of one
      // cannot fail once this line has already thrown. (The Set check was here; it could not fail
      // independently of this, which is the definition of the vacuous assertion this repo tracks.
      // Found in review.)
      expect(size, `${name} drew the bot at ${size}px`).toBe('77')

      // ⚠️ **"It does not scroll away" is structural, and this is the assertion for it.** The block
      // opens BEFORE the scroll container does, so it is a sibling above it and there is no scroll
      // position at which it can be anywhere else. SSR has no layout, so the scrolling itself is
      // measured live and nowhere in this file — see the response's numbers.
      expect(html.indexOf('data-cy="session-bot"')).toBeLessThan(
        html.indexOf('data-cy="panel-body"'),
      )
    }

    // …and the sections are all still under it, in the fixture that has them.
    const busy = await render(busySession(), 'normal', { facets, who: 'project-manager' })
    expect(busy).toContain('data-cy="panel-permissions"')
    expect(busy).toContain('data-cy="panel-questions"')
    expect(busy).not.toContain('data-cy="session-panel-empty"')
    expect(busy.indexOf('data-cy="session-bot"')).toBeLessThan(
      busy.indexOf('data-cy="panel-permissions"'),
    )
  })

  it('…and it draws the WHOLE composition, which is the point of pinning it (090 §4)', async () => {
    // Assert all three composing axes inside the block. `agent-needing` and `agent-underline`
    // also occur on row marks below, so whole-page `toContain` could pass even if the block
    // drew neither.
    const html = await render(busySession(), 'normal', {
      facets: { doing: 'tool' as const, being: 'live' as const, needing: 'permission' as const },
      who: 'project-manager',
    })
    const block = botBlock(html)

    expect(block).toContain('data-cy="agent-avatar"') // DOING — the illustration
    expect(block).toContain('data-cy="agent-underline"') // BEING — the line beneath it
    expect(underlineClasses(block), 'the BEING underline is present but unpainted').not.toContain(
      'none',
    )
    expect(block).toContain('data-cy="agent-needing"') // NEEDING — the corner badge
    // The block’s own name and state word sit beside the plate.
    expect(block).toContain('data-cy="session-bot-name"')
    expect(block).toContain('data-cy="session-bot-word"')
    // ⚠️ The angle brackets matter. `accessibleName` puts the NAME and the DOING word into the
    // root's `aria-label`, which is inside this slice — so a bare `toContain(…)` would pass with
    // the `:title` binding deleted and no name drawn at all. Found in review.
    //
    // 🔴 **537 re-aimed this, and the FACT moved rather than its spelling** (standing rule 26).
    // ⛔ The prop said `provider` and the plate drew `claude` about a conversation the rail, the
    // PROFILE field and the AGENTS list all called `project-manager`. ⚑ It is `who` now and it
    // carries the agent's name, which `SessionDrawer` derives through `agentName` — the app's one
    // naming function (`449`). ⚠️ **The subject of this assertion never moved**: the plate draws
    // the name it is HANDED, and the `:title` binding is what draws it.
    expect(block).toContain('>project-manager<')
    // ⚑ **UI-008** — the plate's word, not a second reading: a person's permission outranks the
    // DOING (F051), whose own word is the avatar's illustration above.
    expect(block).toContain('>needs you: permission<')
    expect(block).toContain('data-being="live"')

    // Paired, because every assertion above is a presence check: the facets that are ABSENT draw
    // nothing, so these hooks are reporting the props rather than always being there.
    const bare = botBlock(
      await render(busySession(), 'normal', { facets: { doing: 'idle' as const } }),
    )
    expect(bare).not.toContain('data-cy="agent-needing"')
    expect(bare).not.toContain('data-being="live"')
    // ⚠️ The underline slot is still THERE and merely unpainted — `visibility`, not `display`, so a
    // BEING arriving cannot make the block taller and shift the list under it. (`data-being` itself
    // is simply absent when the prop is: SSR omits an undefined attribute, so asserting on its
    // presence would have been asserting on Vue.)
    expect(bare).toContain('data-cy="agent-underline"')
    expect(underlineClasses(bare)).toContain('none')
  })

  it('…and with no session behind it, it draws no agent at all rather than a faceless one', async () => {
    // Nothing forces a caller to have an agent, and an absent one is absent — not a dashed ring
    // nobody asked for.
    // ⚠️ This comment used to say "the read-only pane renders this panel without live facets". That
    // pane does not render this component at all; the claim was invented. Found in review.
    const html = await render(createTranscript())
    expect(html).not.toContain('data-cy="session-bot"')
    expect(html).not.toContain('data-cy="session-panel-empty"')
    // Paired: the same state WITH facets does draw it, so the absence above is the `v-if` and not a
    // component that never renders.
    const withAgent = await render(createTranscript(), 'normal', {
      facets: { doing: 'idle' as const },
    })
    expect(withAgent).toContain('data-cy="session-bot"')
  })

  it('every row that is an AGENT wears its own mark, and the others deliberately do not (082)', async () => {
    // ⚠️ Found in review: nothing asserted the marks at all. Swapping the two facets in
    // `session-panel.ts` — a lock on questions, a `?` on permissions, the wrong glyph on every
    // blocked card — left all four tests in this file green.
    const state = busySession()
    const html = await render(state)
    expect(html).toContain('data-cy="agent-state"')

    // Each section's row carries the facet its section means.
    const rowFor = (cy: string): string => {
      const section = html.slice(html.indexOf(`data-cy="${cy}"`))
      return section.slice(0, section.indexOf('</section>'))
    }
    expect(rowFor('panel-permissions')).toContain('data-needing="permission"')
    expect(rowFor('panel-permissions')).toContain('#i-lock')
    expect(rowFor('panel-questions')).toContain('data-needing="question"')
    expect(rowFor('panel-questions')).toContain('#i-question')
    // …and they are not the same glyph, which is the whole reason the facets are per-section.
    expect(rowFor('panel-permissions')).not.toContain('#i-question')
    expect(rowFor('panel-questions')).not.toContain('#i-lock')

    // A running sub-agent is drawn from its own card: live, and on a tool if it has one.
    expect(rowFor('panel-agents')).toContain('data-being="live"')

    // The checklist is not an agent, so it gets no mark at all — not an empty column where one
    // would go. Its row is outside the section loop and carries no `data-mark`, which is the
    // one-column default in the scoped CSS rather than a second rule.
    const todo = rowFor('panel-todo')
    expect(todo).not.toContain('data-cy="agent-state"')
    expect(todo).not.toContain('data-mark')
    // Paired: the sections above DO carry it, so the absence above is a decision and not a binding
    // that never fires.
    expect(rowFor('panel-permissions')).toContain('data-mark="true"')
  })

  it('offers no way to answer anything — navigation only (037 §4)', async () => {
    const html = await render(busySession())
    // 031/034 wrote the disclosure rules for these decisions on the cards. A second set of controls
    // here would be a second code path that has to stay honest about a security decision.
    for (const word of ['Allow', 'Deny', 'Approve', '<textarea', '<input']) {
      expect(html, `the panel must not offer "${word}"`).not.toContain(word)
    }
  })

  /**
   * Quiet, scheduled, and still-running states draw no empty-section sentence. A column with
   * nothing open draws its sections or nothing, and the composer-freezing count stays zero in
   * all three cases.
   */
  it('⛔ an empty panel draws no sentence — quiet, scheduled or still running', async () => {
    const states = {
      quiet: createTranscript(),
      scheduled: feed(createTranscript(), {
        type: 'scheduled_work',
        jobs: [{ id: 'e3826cc5', schedule: '0 3 * * *', recurring: true, prompt: 'check' }],
        source: 'hook/Stop',
      } as TranscriptEvent),
      running: feed(createTranscript(), {
        type: 'background_work',
        running: [{ id: 'b6uoyo82k', kind: 'local_bash', description: 'watching the Desktop' }],
        source: 'background_tasks_changed',
      } as TranscriptEvent),
    }
    for (const [name, state] of Object.entries(states)) {
      const html = await render(state)
      expect(html, name).toContain('data-cy="session-panel"')
      expect(html, name).not.toContain('data-cy="session-panel-empty"')
      expect(html, name).not.toContain('are on a card here')
      expect(html, name).toContain('data-waiting="0"')
      // No section headings sitting at zero: "open" is the whole contract.
      expect(html, name).not.toContain('data-cy="panel-permissions"')
    }
  })

  /**
   * Show context beneath the plate when known, using the Context tab’s words. A percentage
   * requires a known window size.
   */
  it('🔴 the card says how full its context is — a percentage only where a window is known', async () => {
    const reading = (r: Record<string, unknown>): TranscriptEvent =>
      ({ type: 'context_reading', reading: r, source: 'test/reading' }) as TranscriptEvent
    const facets = { facets: { doing: 'idle' as const } }
    const full = await render(
      feed(createTranscript(), reading({ kind: 'proportional', used: 90_000, window: 200_000 })),
      'normal',
      facets,
    )
    // ⚑ W4.183 · a run-strip item now; its figure drawn, its detail on its title.
    expect(full).toContain('class="run-item context"')
    // ⚑ W4.183 · v3 draws the context in tokens; the share of the window is on its title.
    expect(full).toContain(`>${formatTokens(90_000)}<`)
    expect(full).toContain(`45% of ${groupTokens(200_000)} tokens`)
    const counted = await render(
      feed(createTranscript(), reading({ kind: 'tokens', used: 90_000 })),
      'normal',
      facets,
    )
    expect(counted).toContain('window size not reported')
    expect(counted).not.toContain('%<')
  })

  // ⚑ **W4.208 · the figure is the Context popup's door**, so it is drawn before the first reading
  // too — as an em-dash, never a zero and never a figure made of nothing.
  it('⚑ THE CONTROL — nothing reported, an em-dash and no figure', async () => {
    const html = await render(createTranscript(), 'normal', { facets: { doing: 'idle' as const } })
    expect(html).toContain('data-cy="session-bot"')
    expect(html).toContain('class="run-item context"')
    expect(html).toMatch(/<strong class="context-figure"[^>]*>—<\/strong>/)
    expect(html).toContain('Context: — · no reading yet')
    expect(html).not.toContain('NaN')
  })

  it('a row whose item this view is hiding is disabled rather than dead', async () => {
    // Both views hide a tool row the runtime told us is rendered as something else (028). A card
    // hanging off one would leave the panel offering a jump to nowhere.
    //
    // ⛔ **The `debug` half was `not.toContain('disabled')` until 211 §4**, on the ground that debug
    // *"shows everything"*. It does not any more — a superseded call is the same fact twice in
    // either view — so the jump is offered in neither, and the row still says the agent is running.
    const superseded = feed(
      createTranscript(),
      { type: 'tool_call', id: 'call_1', name: 'TaskCreate', summary: 'todo' },
      { type: 'sub_agent', agentId: 'a1', phase: 'started', parentToolCallId: 'call_1' },
      { type: 'plan_update', steps: [{ text: 'x', status: 'active' }], supersedes: ['call_1'] },
    )
    // ⚑ **The paired positive, and without it this test passes over a panel that disables
    // everything.** The same shape with nothing superseding the call: the row IS reachable, in both
    // views, so what is asserted below is about the hidden item and not about the panel.
    const reachable = feed(
      createTranscript(),
      { type: 'tool_call', id: 'call_1', name: 'Task', summary: 'go' },
      { type: 'sub_agent', agentId: 'a1', phase: 'started', parentToolCallId: 'call_1' },
    )
    expect(sessionPanel(reachable).agents).toHaveLength(1)
    expect(await render(reachable, 'debug')).not.toContain('disabled')
    expect(await render(reachable, 'normal')).not.toContain('disabled')

    // It is still LISTED — the panel's job is to say the agent is running — and now unreachable in
    // both views, because the item it would jump to is drawn in neither.
    expect(sessionPanel(superseded).agents).toHaveLength(1)
    expect(await render(superseded, 'debug')).toContain('disabled')
    expect(await render(superseded, 'normal')).toContain('disabled')
  })
})
