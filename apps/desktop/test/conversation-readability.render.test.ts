import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import SubAgentEntry from '../src/renderer/src/components/SubAgentEntry.vue'
import type {
  PermissionItem,
  PermissionOutcome,
  SubAgentCard,
} from '../src/renderer/src/lib/transcript'

/**
 * Reading the conversation (Slice 2 · 034).
 *
 * Two things here are geometry, which a unit test cannot see, and two are markup, which is where
 * the geometry is decided. What this file pins is the second kind: WHICH elements exist in each
 * state, because that is what the stylesheet keys off and what the live smoke then measures.
 *
 * The expand-again half of the disclosure is deliberately NOT here — it needs a real click on a
 * real DOM, so `smoke:ui` owns it. An SSR test that reached into the component's `open` ref to
 * fake the click would assert that the template can render, which is not the claim.
 */

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const SCOPE = {
  cwd: '/tmp/scratch',
  paths: ['write /tmp/scratch/out.txt'],
  networkHosts: [] as string[],
  persistence: 'once' as const,
  amendments: [] as { kind: 'exec' | 'network'; detail: string }[],
  availableDecisions: ['allow' as const, 'allow_for_session' as const, 'deny' as const],
  underDisclosed: true,
}

function card(
  outcome: PermissionOutcome | null,
  note: string | null = null,
): PermissionItem & { at: number } {
  return {
    kind: 'permission',
    id: 'item-1',
    at: 1_700_000_000_000,
    outcome,
    note,
    refused: null,
    request: {
      type: 'permission_request',
      id: 'req_1',
      kind: 'command',
      action: 'Bash',
      detail: 'sysctl hw.memsize\ncat /etc/hosts',
      scope: SCOPE,
    },
  }
}

describe('an answered permission collapses', () => {
  it('a PENDING card is untouched — the whole question, and no way to fold it away', async () => {
    const html = await render(PermissionCard, { item: card(null) })
    expect(html).toContain('Frozen until you answer')
    expect(html).toContain('data-cy="permission-detail"')
    expect(html).toContain('sysctl hw.memsize')
    expect(html).toContain('data-cy="permission-under-disclosed"')
    expect(html).toContain('data-cy="permission-allow"')
    // No summary line: there is nothing to summarise, and a collapse control on a question the
    // agent is frozen on would be a way to hide it.
    expect(html).not.toContain('data-cy="permission-answered"')
  })

  it('an ANSWERED card is one line — the outcome, what it was, and the time', async () => {
    const html = await render(PermissionCard, { item: card('allow') })
    expect(html).toContain('data-cy="permission-answered"')
    expect(html).toContain('>Approved<')
    // What it was, from the FIRST line of the detail — the rest is behind the fold with everything
    // else, rather than re-flowing the summary to three lines.
    expect(html).toContain('Bash · sysctl hw.memsize')
    expect(html).not.toContain('cat /etc/hosts')
    // The whole point: the command block, the scope table and the warning are OUT of the document.
    // Not hidden with CSS — a collapsed card that still laid the body out would still be tall.
    expect(html).not.toContain('data-cy="permission-detail"')
    expect(html).not.toContain('data-cy="permission-under-disclosed"')
    expect(html).not.toContain('data-cy="permission-action"')
    // Still a disclosure, so the fold is reachable and announced as one.
    expect(html).toContain('aria-expanded="false"')
    // …but NOT with an `aria-controls` naming an element that is not in the document (034 review).
    // The body really is absent when collapsed — that is the whole point, and why it is `v-if` and
    // not `v-show` — so the half of the ARIA pair that names it has to go absent with it.
    // `aria-expanded`, which is the required half, stays.
    expect(html).not.toContain('aria-controls')
  })

  it('states WHICH way it went — approvals and refusals do not share a word or a colour', async () => {
    const approved = await render(PermissionCard, { item: card('allow_for_session') })
    expect(approved).toContain('>Allowed for this conversation<')
    expect(approved).toContain('data-outcome="approved"')

    for (const outcome of ['deny', 'cancel'] as const) {
      const refused = await render(PermissionCard, { item: card(outcome) })
      expect(refused).toContain('data-outcome="refused"')
      expect(refused).toContain(outcome === 'deny' ? '>Denied<' : '>Cancelled<')
    }
  })

  it('a card that was never answered says so, rather than borrowing a verdict', async () => {
    // Teardown settles a card without a decision (the note says why). It is neither an approval
    // nor a refusal, and the tone must not claim it is one.
    const html = await render(PermissionCard, { item: card(null, 'session closed') })
    expect(html).toContain('>Not answered<')
    expect(html).toContain('data-outcome="unanswered"')
    expect(html).toContain('session closed')
    // Still answered ENOUGH to stop being actionable: the resume smoke tells open cards from
    // settled ones by exactly this marker, so a settled card must always carry it.
    expect(html).toContain('data-cy="permission-answered"')
    expect(html).not.toContain('data-cy="permission-allow"')
  })
})

describe('the sub-agent card is a card in both places it appears', () => {
  const agent: SubAgentCard = {
    agentId: 'agent-1',
    kind: 'code_quality',
    title: 'review the diff',
    running: false,
    outcome: 'completed',
    body: [],
    summary: '',
    usage: undefined,
  }

  it('renders top-level as a transcript entry, and nested as part of its dispatch row', async () => {
    // Both are first-class: 029 renders a card whose dispatching row is not on screen at top
    // level BY DESIGN, and 033 made that the ONLY way a Codex sub-agent ever renders.
    const top = await render(SubAgentEntry, { card: agent, placement: 'transcript' })
    expect(top).toContain('data-placement="transcript"')

    const nested = await render(SubAgentEntry, { card: agent, placement: 'nested' })
    expect(nested).toContain('data-placement="nested"')

    // Same card either way — the placement decides geometry, never content.
    //
    // ⚠️ **Only the ATTRIBUTE is normalised, not every occurrence of the word** (115). The blunt
    // form of this — `top.replace(/transcript/g, 'X')` — turned the card's own "Open transcript →"
    // into "Open X →" on one side and left it alone on the other, so a card that renders identically
    // in both placements failed for having the word in its content. What is under test is the
    // placement attribute; every other byte must match verbatim, which is what this now asserts.
    const placeless = (html: string): string => html.replace(/data-placement="[a-z]+"/, 'X')
    expect(placeless(top)).toBe(placeless(nested))
  })

  it('defaults to the standalone treatment when nobody says', async () => {
    // A new call site that forgets the prop gets a card that obeys the reading measure. The
    // failure mode of the other default is the bug this fixes: a full-width card in the stream.
    expect(await render(SubAgentEntry, { card: agent })).toContain('data-placement="transcript"')
  })

  it("an agent's own agent stays in the transcript popup", async () => {
    // Child output stays behind the transcript action, including nested agents.
    const withGrandchild: SubAgentCard = {
      ...agent,
      body: [
        {
          kind: 'tool',
          callId: 'toolu_inner',
          name: 'Agent',
          summary: 'check the lockfile',
          subAgents: [
            { ...agent, agentId: 'agent-2', kind: 'Explore', title: 'check the lockfile' },
          ],
        },
      ],
    }
    const html = await render(SubAgentEntry, { card: withGrandchild, placement: 'transcript' })
    expect(html.match(/data-cy="subagent-entry"/g), 'one card until opened').toHaveLength(1)
    expect(html).not.toContain('data-agent-id="agent-2"')
    // The parent transcript action remains available.
    expect(html).toContain('subagent-open-transcript')
    expect(html).not.toContain('aria-expanded')
  })

  it('a compact card has no disclosure or inline body', async () => {
    const withBody: SubAgentCard = { ...agent, summary: 'read four files' }
    const closed = await render(SubAgentEntry, { card: withBody, placement: 'transcript' })
    expect(closed).toContain('subagent-open-transcript')
    expect(closed).not.toContain('aria-expanded')
    expect(closed).not.toContain('aria-controls')

    // A card with no body has the same compact presentation.
    const bodiless = await render(SubAgentEntry, { card: agent, placement: 'transcript' })
    expect(bodiless).not.toContain('aria-expanded')
    expect(bodiless).not.toContain('aria-controls')
  })
})
