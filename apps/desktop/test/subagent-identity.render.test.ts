import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SubAgentEntry from '../src/renderer/src/components/SubAgentEntry.vue'
import type { SubAgentCard } from '../src/renderer/src/lib/transcript'

/**
 * 111 · Who is talking — the identity the card already held and never showed.
 *
 * The sub-agent card must expose the id and the provider-specific kind of id it already
 * carries. Kind, title, and status alone do not distinguish which child is talking.
 */

const card = (over: Partial<SubAgentCard> = {}): SubAgentCard => ({
  agentId: 'ad63a0d89dcd9eed4',
  running: false,
  body: [],
  ...over,
})

/**
 * The rendered card with **HTML comments stripped** — and that is not tidiness.
 *
 * ⚠️ **Vue emits template comments into SSR output, so a raw-HTML assertion can be answered by a
 * comment.** This file found it the hard way in both directions: `not.toContain('0 tools')` failed
 * against a comment explaining why `0 tools` must never appear, and the far worse case is the
 * mirror — a `toContain` that passes because the phrase it looks for is written in a comment beside
 * the code that was supposed to render it. That is a vacuous test that looks green forever.
 */
const render = async (c: SubAgentCard): Promise<string> =>
  (await renderToString(createSSRApp({ render: () => h(SubAgentEntry, { card: c }) }))).replace(
    /<!--[\s\S]*?-->/g,
    '',
  )

describe('a sub-agent card says whose id it is (111)', () => {
  it('a TASK id — a dispatch inside the parent process, with nothing to open', async () => {
    const html = await render(card({ idKind: 'task', parentToolCallId: 'toolu_01L9mvk' }))
    expect(html).toContain('child task ID')
    expect(html).toContain('ad63a0d89dcd9eed4')
    expect(html).toContain('toolu_01L9mvk')
    // …and it is NOT called a thread, because it is not one and nothing can be opened from it.
    expect(html).not.toContain('child thread ID')
  })

  it('a THREAD id — a real conversation, with a rollout file of its own', async () => {
    const html = await render(
      card({ idKind: 'thread', agentId: '019fecbf-3606-7143-9c2a-3f1005cf4085' }),
    )
    expect(html).toContain('child thread ID')
    expect(html).toContain('019fecbf-3606-7143-9c2a-3f1005cf4085')
    expect(html).not.toContain('child task ID')
  })

  it('a card whose event never said claims neither', async () => {
    const html = await render(card())
    expect(html).toContain('child agent')
    expect(html).not.toContain('child task ID')
    expect(html).not.toContain('child thread ID')
  })

  it('the ended outcome is shown when the provider gave one, and never invented', async () => {
    expect(await render(card({ idKind: 'task', outcome: 'completed' }))).toContain(
      'ended completed',
    )
    // ⚠️ Codex's every ending is silence (033) — a child thread going idle says it stopped and
    // nothing more. The status word already carries "ended"; a second line saying "outcome unknown"
    // would be two claims about one silence.
    expect(await render(card({ idKind: 'thread' }))).not.toContain('ended completed')
  })
})

// ⚠️ **The PREMISE moved in 226 and the rule did not.** This described a Codex child as one that
// reports no usage; a Codex child reports tokens, a tool count and a duration, all measured on the
// wire. What is still true — and is what these cases are actually about — is that a card with no
// usage must SAY so rather than render a zero, which is reachable for either provider whenever the
// report never arrived.
describe('⛔ a child that reports no usage says so, and never zero (111, criterion 3)', () => {
  it('an ended child with no usage reads as unreported', async () => {
    // Use the measured child-life shape: `started`, `progress`, and `ended` with an id and
    // parent call, but no other metadata.
    const html = await render(card({ idKind: 'thread' }))
    expect(html).toContain('usage not reported')
    // THE assertion. `0 tools · 0k tokens` is a measurement nobody took, and it reads as a child
    // that did nothing rather than a provider that does not say.
    expect(html).not.toContain('0 tools')
    expect(html).not.toContain('0k tokens')
  })

  it('…and a child that DID report usage still shows it — the paired positive', async () => {
    const html = await render(
      card({ idKind: 'task', usage: { tokens: 14390, toolCalls: 1, ms: 2644 } }),
    )
    expect(html).toContain('1 tool')
    expect(html).toContain('14.4k tokens')
    expect(html).not.toContain('usage not reported')
  })

  it('a RUNNING child with no usage yet says nothing at all', async () => {
    // "Not reported" is a statement about a finished life. While it runs, no usage is ordinary and
    // announcing it would be noise on every heartbeat.
    const html = await render(card({ idKind: 'thread', running: true }))
    expect(html).not.toContain('usage not reported')
    // …paired with the positive that the card really did render, or the negative passes over nothing.
    expect(html).toContain('child thread ID')
  })

  it('a reported ZERO is still shown as zero — the distinction the blank protects', async () => {
    // ⚠️ This is the pair that makes "never render 0" precise. A provider that SAYS zero tools is
    // reporting a fact, and hiding it would be the mirror of the bug. What must never appear is a
    // zero we made up, which is the case above.
    const html = await render(card({ idKind: 'task', usage: { toolCalls: 0 } }))
    expect(html).toContain('0 tools')
    expect(html).not.toContain('usage not reported')
  })
})

/**
 * ⛔ **A grandchild's parent is UNKNOWN, not pending, and the card has to say which** (135).
 *
 * Measured on `sess_d5c8c9ca`: a depth-2 Codex agent reaches this app as a thread that went active
 * and nothing else — no name, no dispatch id, no parent. The state database holds the whole chain
 * and the wire holds none of it, so this is the card 111's rule produces when it is applied to
 * parentage: the honest blank, said out loud.
 */
describe('a nested agent nobody announced says so (135)', () => {
  /** Exactly what `CodexSubAgents.observe` emits, folded: an id, a kind of id, and `origin`. */
  const observed = (over: Partial<SubAgentCard> = {}): SubAgentCard =>
    card({
      agentId: '019ff856-3833-7d11-bd85-c3bd5a0368c0',
      idKind: 'thread',
      origin: 'observed',
      running: true,
      ...over,
    })

  it('names itself a nested agent and states that no parent was reported', async () => {
    const html = await render(observed())
    expect(html).toContain('nested agent')
    expect(html).toContain('nested — parent not reported')
    // The identity it DOES have is still shown — a real thread with a file of its own (111).
    expect(html).toContain('child thread ID')
    expect(html).toContain('019ff856-3833-7d11-bd85-c3bd5a0368c0')
  })

  it('⛔ never invents a parent, and never borrows the word from an announced child', async () => {
    const html = await render(observed())
    // The depth-1 child's dispatch id sits one card away in the real session. Nothing may put it
    // here: naming it would place this agent under a conversation it may not belong to.
    expect(html).not.toContain('call_')
    expect(html).not.toContain('from <code')
    // …paired with the positive, or the negatives pass over an empty render (116).
    expect(html).toContain('nested — parent not reported')
  })

  it('an ANNOUNCED child is untouched: its dispatch is shown and it is just an agent', async () => {
    // The paired positive for the whole change. A card the provider told us about must read exactly
    // as it did before 135 — the word, the dispatch line, and no claim about a missing parent.
    const html = await render(
      card({
        idKind: 'thread',
        kind: 'ui_test',
        parentToolCallId: 'call_LmwDmS9Oiq9Bov0hAVqRAT3Q',
      }),
    )
    expect(html).toContain('ui_test')
    expect(html).toContain('call_LmwDmS9Oiq9Bov0hAVqRAT3Q')
    expect(html).not.toContain('nested — parent not reported')
    expect(html).not.toContain('nested agent')
  })

  it('a card with no origin still reads "agent" — absence is not a claim', async () => {
    // A `task_updated` card, and every event persisted before 135, arrive without the field. They
    // are children whose dispatch is PENDING, not unknown, and must not be relabelled.
    const html = await render(card({ idKind: 'task', running: true }))
    expect(html).toMatch(/data-cy="subagent-kind"[^>]*>agent</)
    expect(html).not.toContain('nested agent')
    expect(html).not.toContain('nested — parent not reported')
  })

  it('⛔ no amber, and no new face: it wears the running plate it already had (080/081)', async () => {
    // A nested agent is not a new KIND of thing — 123 refused a face for provenance and 133 refused
    // one for compaction. It is an ordinary running agent whose parentage we were not told, so its
    // plate must be the SAME plate an announced running child wears, down to the drawing, and never
    // the tone that means "waiting on you".
    const [nested, announced] = await Promise.all([
      render(observed()),
      render(card({ idKind: 'thread', kind: 'ui_test', running: true })),
    ])
    /** The face and its tone: what it is doing, whether it is with us, the drawing, the underline. */
    const face = (html: string): string[] => [
      html.match(/data-doing="([^"]*)"/)?.[1] ?? '',
      html.match(/data-being="([^"]*)"/)?.[1] ?? '',
      html.match(/agents\/([a-z-]+)\.png/)?.[1] ?? '',
      html.match(/--_u:var\((--[a-z-]+)\)/)?.[1] ?? '',
    ]
    // The positive first, so the comparison below cannot be two empty lists agreeing (116).
    expect(face(nested)).toEqual(['working', 'live', 'working', '--accent'])
    expect(face(nested)).toEqual(face(announced))
    // ⛔ 080: the one tone this card may never take. `--waiting` is the amber, and `needing` is what
    // would claim somebody is blocked on the user — a nested agent asks nothing of anyone.
    for (const html of [nested, announced]) {
      expect(html).not.toContain('--waiting')
      expect(html).not.toContain('data-needing')
    }
  })
})
