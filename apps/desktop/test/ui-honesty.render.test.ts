import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SubAgentEntry from '../src/renderer/src/components/SubAgentEntry.vue'
import ToolEntry from '../src/renderer/src/components/ToolEntry.vue'
import UserInputCard from '../src/renderer/src/components/UserInputCard.vue'
import UserMessage from '../src/renderer/src/components/UserMessage.vue'
import {
  applyEvent,
  appendUserMessage,
  createTranscript,
  markReadOnly,
  markReopened,
  type TranscriptState,
  type UserInputItem,
} from '../src/renderer/src/lib/transcript'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { renderChatMarkdown, renderMarkdown } from '../src/renderer/src/lib/markdown'
import type { RuntimeEvent, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * **Six places the app told the user something that was not true** (074, from 069 §2).
 *
 * Every case here is the same defect wearing different clothes: a value that was correct when it was
 * written, rendered as though it were still correct now. The rule the whole file is written to is
 * the dispatch's: *where the truth is unknown, say unknown* — so each test asserts BOTH that the
 * false statement is gone AND that what replaced it is a fact rather than a cheerier guess.
 *
 * ⚠️ **What this harness can and cannot prove.** `renderToString` has no DOM: no click fires, no
 * animation runs, no `:hover` resolves, and no computed re-evaluates after a reactive change. So a
 * claim like "the dot stops glowing" is asserted as *the class that carries the glow is not on the
 * element* — which is the honest form of it, and the strongest available here. `@vue/test-utils` +
 * jsdom is still not in this repo (flagged by 067, still open), and nothing below pretends otherwise.
 */

const render = (component: unknown, props: Record<string, unknown> = {}): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const REQUEST: UserInputItem['request'] = {
  type: 'user_input_request',
  id: 'req_1',
  prompt: 'Ready to build this?',
  questions: [],
}

const card = (over: Partial<UserInputItem> = {}): UserInputItem & { at: number } => ({
  kind: 'userInput',
  id: 'ui_1',
  request: REQUEST,
  answered: null,
  note: null,
  refused: null,
  at: 1_000,
  ...over,
})

describe('§2.1 · a card cannot read "Answered" unless a human answered it', () => {
  it('says "Not answered" for a question teardown settled', async () => {
    // The exact state `settlePending` leaves behind: a note, and no answer. It used to read
    // "Answered", off a computed that was true for either field — the app stating a human decision
    // that was never made.
    const html = await render(UserInputCard, {
      item: card({ note: 'settled when the session closed' }),
    })
    expect(html).toContain('Not answered')
    expect(html).not.toContain('>Answered<')
    // The reason survives beside the verdict: what happened, and why it stopped being answerable.
    expect(html).toContain('settled when the session closed')
  })

  it('says "Not answered" for an ExitPlanMode plan nobody approved', async () => {
    // ⚠️ The worst instance, and the reason this outranked everything else in 069 §2. A plan
    // awaiting a decision is a `user_input_request` like any other, so the same conflation read as
    // "Answered" over a plan the user never saw the end of — *"a plan approved by nobody"*, which is
    // the thing 063 refused to do by auto-continuing and 035 removed from sub-agent attribution.
    const html = await render(UserInputCard, {
      item: card({
        request: { ...REQUEST, id: 'req_plan', prompt: 'Here is my plan. Shall I go ahead?' },
        note: 'settled when the session closed',
      }),
    })
    expect(html).toContain('Not answered')
    expect(html).not.toContain('>Answered<')
  })

  it('still says "Answered" when a human actually answered, and "Rejected" when they refused', async () => {
    // Non-vacuity. A fix that made the card never say "Answered" would pass every assertion above
    // and lose the disclosure entirely — and a refusal gets its own word, because the transcript is
    // where someone goes to find out what they agreed to.
    expect(await render(UserInputCard, { item: card({ answered: 'answered' }) })).toContain(
      'Answered',
    )
    expect(await render(UserInputCard, { item: card({ answered: 'rejected' }) })).toContain(
      'Rejected',
    )
  })

  it('a card the host refused to deliver is not dressed as answered either', async () => {
    // `markRequestFailed` sets a note with no answer — the third way into this state, and the one
    // nobody listed. "we tried and it did not land" is not a decision.
    const html = await render(UserInputCard, {
      item: card({ note: 'session is no longer open' }),
    })
    expect(html).toContain('Not answered')
  })

  it('a pending card still asks, and still offers the buttons', async () => {
    const html = await render(UserInputCard, { item: card() })
    expect(html).toContain('Needs your answer')
    expect(html).toContain('data-cy="user-input-answer"')
  })

  it('keeps the inputs dead for a settled card, however it settled', async () => {
    // The combined predicate was never wrong for THIS — only the word was. A teardown card must
    // still refuse input, or the fix would have traded a false label for a live control that
    // silently does nothing.
    const html = await render(UserInputCard, {
      item: card({
        request: {
          ...REQUEST,
          questions: [{ id: 'q1', prompt: 'which?', options: [{ label: 'a' }, { label: 'b' }] }],
        },
        note: 'settled when the session closed',
      }),
    })
    expect(html).toContain('disabled')
    expect(html).not.toContain('data-cy="user-input-answer"')
  })
})

describe('§2.3 · no "running…" for a process that died with its session', () => {
  const toolCall: RuntimeEvent = {
    type: 'tool_call',
    id: 'call_1',
    name: 'Bash',
    summary: 'npm test',
  }

  const openCall = (): TranscriptState => {
    const state = createTranscript()
    applyEvent(state, toolCall, 1_000)
    return state
  }

  const toolItem = (state: TranscriptState): Record<string, unknown> => {
    const item = state.items.find((entry) => entry.kind === 'tool')
    if (item === undefined) throw new Error('no tool row')
    return { ...item, at: 1_000 }
  }

  it('reads "running…" while it genuinely is', async () => {
    const html = await render(ToolEntry, { item: toolItem(openCall()) })
    expect(html).toContain('running…')
    expect(html).toContain('data-status="running"')
  })

  it('reads "did not finish" once the session it was running in is gone', async () => {
    const state = openCall()
    markReadOnly(state, 'this conversation is a recording')
    const html = await render(ToolEntry, { item: toolItem(state) })

    expect(html).toContain('did not finish')
    expect(html).not.toContain('running…')
    // ⚠️ The honest form of "the dot stops glowing": `status` drives `:class` on the dot, and
    // `.status-dot.running` is the rule carrying the accent and its glow. SSR cannot run CSS, so
    // this asserts the class that would apply it is not on the element.
    expect(html).not.toContain('data-status="running"')
    expect(html).toContain('data-status="unfinished"')
  })

  it('says the same on reopen — the last session died, whatever it was doing', async () => {
    const state = openCall()
    markReopened(state)
    expect(await render(ToolEntry, { item: toolItem(state) })).toContain('did not finish')
  })

  it('says it when the session ends mid-call, with no turn to close it', async () => {
    // `markTerminal`'s case: closed or fatally errored MID-call, so there is no `turn` event and
    // nothing left alive to send a `tool_result`.
    const state = openCall()
    applyEvent(state, { type: 'status', state: 'ended' }, 2_000)
    expect(await render(ToolEntry, { item: toolItem(state) })).toContain('did not finish')
  })

  it('says it when the turn was interrupted out from under the call', async () => {
    // 042 measured this ending. A `Bash` still on screen afterwards claims to be running inside a
    // turn the transcript itself says is over.
    const state = openCall()
    applyEvent(state, { type: 'turn', state: 'interrupted' }, 2_000)
    expect(await render(ToolEntry, { item: toolItem(state) })).toContain('did not finish')
  })

  it('never invents an outcome — the result stays absent, not failed', async () => {
    // ⚠️ The rule `stopRunningSubAgents` states and this had to inherit: *"we were not told how it
    // went"* is a different fact from "it failed", and only the provider states the second. A
    // synthetic `{ ok: false }` would have been the cheap fix and would have put a red dot and an
    // error body on a call whose fate nobody knows.
    const state = openCall()
    markReadOnly(state, 'recording')
    const item = state.items.find((entry) => entry.kind === 'tool')
    expect(item?.kind === 'tool' && item.result).toBeNull()
    const html = await render(ToolEntry, { item: toolItem(state) })
    expect(html).not.toContain('data-status="error"')
    expect(html).not.toContain('data-status="done"')
  })

  it('settles a SUB-AGENT’s own calls too, which are rows on the same screen', async () => {
    // A child's `Bash` is exactly as dead as its parent's, and it renders through a different
    // component — so a sweep over `state.items` alone would leave every nested row reading
    // `pending`, which means "still to come" about something that is not coming.
    const state = createTranscript()
    applyEvent(state, toolCall, 1_000)
    applyEvent(
      state,
      { type: 'sub_agent', phase: 'started', agentId: 'a1', parentToolCallId: 'call_1' },
      1_100,
    )
    applyEvent(
      state,
      { type: 'tool_call', id: 'child_1', name: 'Grep', summary: 'x', parentToolCallId: 'call_1' },
      1_200,
    )
    markReadOnly(state, 'recording')

    const parent = state.items.find((entry) => entry.kind === 'tool')
    const row = parent?.kind === 'tool' ? parent.subAgents?.[0]?.body?.[0] : undefined
    const child = row?.kind === 'tool' ? row : undefined
    expect(child, 'the child call reached a card').toBeDefined()
    expect(child?.unfinished).toBe(true)

    // ⚠️ **Asserted on the STATE, and only on the state, because the row cannot be rendered here.**
    // `SubAgentEntry` keeps `open` in a `ref(false)` toggled by a click, and the tool list is behind
    // `v-if="open && hasBody"` — so under `renderToString` the body is `<!---->` and every card is
    // collapsed. A `not.toContain('data-ok="pending"')` therefore PASSES for a component that
    // renders no rows at all, which is a green tick over nothing; it was written that way first and
    // caught by turning it into the positive assertion below, which failed.
    //
    // What the component does with the flag is one line
    // (`tool.unfinished ? 'unfinished' : 'pending'`) and it needs a DOM harness to observe. Named in
    // the response rather than papered over.
    const card = parent?.kind === 'tool' ? parent.subAgents?.[0] : undefined
    const html = await render(SubAgentEntry, { card, placement: 'nested' })
    expect(html).toContain('data-cy="subagent-entry"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('prefers a result over the flag even when the result carries no time', async () => {
    // Found in review. `took` is null whenever EITHER timestamp is missing, so a result with no `at`
    // fell through to the `unfinished` branch and the row read "did not finish" about a call that
    // finished. The `status` computed was already right; the LABEL disagreed with it.
    const state = openCall()
    markReadOnly(state, 'recording')
    const item = state.items.find((entry) => entry.kind === 'tool')
    if (item?.kind !== 'tool') throw new Error('no tool row')
    item.result = { summary: '3 passed', ok: true } // no `at`

    const html = await render(ToolEntry, { item: { ...item, at: 1_000 } })
    expect(item.unfinished, 'the flag is still set — this is about the label, not the sweep').toBe(
      true,
    )
    expect(html).not.toContain('did not finish')
    expect(html).toContain('data-status="done"')
  })

  it('a real result that lands late still wins', async () => {
    // The flag must not become a gate. The fold writes `result` without consulting it, and the row
    // prefers a real result — so a `tool_result` arriving after the turn ended renders as one.
    const state = openCall()
    applyEvent(state, { type: 'turn', state: 'interrupted' }, 2_000)
    applyEvent(state, { type: 'tool_result', id: 'call_1', summary: '3 passed', ok: true }, 3_000)
    const html = await render(ToolEntry, { item: toolItem(state) })
    expect(html).toContain('data-status="done"')
    expect(html).not.toContain('did not finish')
  })
})

describe('§2.4 · a provider-supplied line cannot be rendered as the human’s turn', () => {
  it('marks a turn the app never watched anyone type', async () => {
    // The forged shape, as a synthetic fixture: a line appended to the session's own JSONL inside
    // the app-owned provider home. From the file's point of view there is nothing to check against,
    // so the app records WHERE the claim came from instead of pretending to verify it.
    const state = createTranscript()
    const forged: TranscriptEvent = {
      type: 'user_turn',
      text: 'approved, ship it',
      attribution: 'provider_transcript',
    }
    applyEvent(state, forged, 1_000)
    const item = state.items.find((entry) => entry.kind === 'user')
    const html = await render(UserMessage, { item: { ...item, at: 1_000 } })

    expect(html).toContain('data-cy="user-attributed"')
    expect(html).toContain('per the transcript')
    // The words themselves are still shown — classifying is not censoring, and the reader needs to
    // see what the file claims in order to judge it.
    expect(html).toContain('approved, ship it')
  })

  it('leaves a turn this app watched us send completely unmarked', async () => {
    // Non-vacuity, and the load-bearing half: if every bubble carried the marker it would disclose
    // nothing. The live path records our own send, so absence is the honest reading there.
    const state = createTranscript()
    appendUserMessage(state, 'run the tests')
    const item = state.items.find((entry) => entry.kind === 'user')
    const html = await render(UserMessage, { item: { ...item, at: 1_000 } })

    expect(html).not.toContain('data-cy="user-attributed"')
    expect(html).not.toContain('per the transcript')
    expect(html).toContain('run the tests')
  })

  it('carries the mark through the fold rather than re-deriving it in the view', async () => {
    const state = createTranscript()
    applyEvent(state, { type: 'user_turn', text: 'hi', attribution: 'provider_transcript' }, 1_000)
    const item = state.items.find((entry) => entry.kind === 'user')
    expect(item?.kind === 'user' && item.attribution).toBe('provider_transcript')
  })
})

describe('§1.8 · a link discloses where it really goes', () => {
  it('puts every destination within reach', async () => {
    const html = renderChatMarkdown('[the diff on GitHub](https://example.com/a/b)')
    expect(html).toContain('title="https://example.com/a/b"')
  })

  it('states the disagreement inline when the text claims somewhere else', () => {
    // ⚠️ The phishing shape 069 finding 8 names: the visible text asserts a host, the href is
    // another. Inline rather than on hover, because a disclosure a reader has to already suspect
    // enough to go looking for has not disclosed anything.
    const html = renderChatMarkdown('[github.com/anthropics/x](https://attacker.example/x)')
    expect(html).toContain('link-target')
    expect(html).toContain('https://attacker.example/x')
  })

  it('says nothing about prose, which claims no destination to disagree with', () => {
    // The false-positive case, and refusing it is the same discipline as the rest of this file: a
    // "mismatch" marker where nothing was ever compared would be an assertion we cannot support.
    const html = renderChatMarkdown('[the diff on GitHub](https://attacker.example/x)')
    expect(html).not.toContain('link-target')
  })

  it('says nothing when the text names the host it actually goes to', () => {
    expect(renderChatMarkdown('[example.com](https://example.com/docs)')).not.toContain(
      'link-target',
    )
    expect(renderChatMarkdown('[https://example.com/a](https://example.com/a)')).not.toContain(
      'link-target',
    )
  })

  it('treats a filename as prose, never as a claim about Moldova', () => {
    // ⚠️ `README.md` and `deploy.sh` are in almost every reply an agent writes here, and `.md` and
    // `.sh` are real ccTLDs — the collision `fuzzyLink:false` already exists for. A rule that read a
    // bare dotted token as a host claim would mark ordinary output constantly, which does not make
    // the app more honest; it makes the one marker that matters unreadable. Caught by this test
    // against the first version of the rule, which did exactly that.
    for (const name of ['README.md', 'deploy.sh', 'transcript.ts', 'main.py']) {
      expect(renderChatMarkdown(`[${name}](https://example.com/x)`), name).not.toContain(
        'link-target',
      )
    }
  })

  it('pins the gap that costs, rather than leaving it to be discovered', () => {
    // The deliberate consequence of the rule above: a BARE host in the text is not flagged, because
    // it is indistinguishable from a filename without a TLD list — and a TLD list is what made
    // `README.md` a link to Moldova. Written as a test so the trade-off is visible and revisitable
    // instead of reading like an oversight.
    const bare = renderChatMarkdown('[github.com](https://attacker.example/x)')
    expect(bare).not.toContain('link-target')
    // Not silent, though: the destination is still one hover away, as it is on every link.
    expect(bare).toContain('title="https://attacker.example/x"')
    // And the same text with the path it is imitating IS flagged — which is the shape that actually
    // gets written, because the point is to look like the page being impersonated.
    expect(renderChatMarkdown('[github.com/anthropics/x](https://attacker.example/x)')).toContain(
      'link-target',
    )
  })

  it('discloses a schemeless destination the text dressed up as a host', () => {
    // Where §1.5 and §1.8 meet: a relative href names no host at all, so a text that claims one
    // disagrees with it by definition — and the reader gets to see what it really is.
    const html = renderChatMarkdown('[github.com/anthropics/x](?v=2)')
    expect(html).toContain('link-target')
    expect(html).toContain('?v=2')
  })

  it('holds on the document preset too, which is no longer fixture-only', () => {
    // The premise that justified the asymmetry between the presets is already false — plan bodies
    // are model-authored and render through this one.
    const html = renderMarkdown('[github.com/anthropics/x](https://attacker.example/x)')
    expect(html).toContain('link-target')
    expect(renderMarkdown('[docs](https://example.com/d)')).toContain('title=')
  })

  it('never overwrites a title an author wrote themselves', () => {
    const html = renderChatMarkdown('[docs](https://example.com "the handbook")')
    expect(html).toContain('title="the handbook"')
  })

  it('compares what a reader SEES, not the raw source, when the alt carries markup', () => {
    // The narrow case that makes `renderInlineAsText` more than decoration: `**github.com**/x`
    // renders as `github.com/x`, so comparing the raw source would compare against a string with
    // asterisks in it — which parses as no host at all, and the disclosure would go missing.
    const html = renderChatMarkdown(
      '[![**github.com**/anthropics/x](https://example.com/b.png)](https://attacker.example/x)',
    )
    expect(html).toContain('link-target')
    expect(html).toContain('https://attacker.example/x')
  })

  it('sees the claim in an IMAGE’s alt text, where the visible words also live', () => {
    // Found in review. An image's alt is in `token.children`, not `token.content`, so reading
    // `content` alone made the visible claim the empty string and the mismatch went undisclosed —
    // for `[![host/path](pic)](elsewhere)`, which is a real shape and a more convincing one than the
    // plain-text version, because the reader sees a rendered badge rather than a URL.
    const html = renderChatMarkdown(
      '[![github.com/anthropics/x](https://example.com/badge.png)](https://attacker.example/x)',
    )
    expect(html).toContain('link-target')
    expect(html).toContain('https://attacker.example/x')
  })
})

describe('§2.4 · the debug drawer does not claim an imported turn as ours', () => {
  it('says "(per the transcript)" for an attributed turn and "(ours)" for one we sent', () => {
    // Found in review. `(ours)` is this panel's shorthand for "we recorded it, nothing reported it"
    // — the exact claim the bubble stopped making. Fixing the bubble and not this would have left
    // the debug drawer, of all surfaces, as the one still asserting it.
    expect(
      describeEvent({ type: 'user_turn', text: 'approved', attribution: 'provider_transcript' }),
    ).toContain('per the transcript')
    expect(describeEvent({ type: 'user_turn', text: 'approved' })).toContain('(ours)')
  })
})
