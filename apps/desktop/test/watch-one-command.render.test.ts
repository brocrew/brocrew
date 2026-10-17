import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { RuntimeEvent } from '@brobot2/runtime'
import ToolEntry from '../src/renderer/src/components/ToolEntry.vue'
import {
  commandIsLive,
  outputStandingFor,
  tailAbsence,
  tailDroppedNote,
  tailIsLive,
} from '../src/renderer/src/lib/command-tail'
import {
  applyEvent,
  createTranscript,
  markReopened,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import type { CapabilityStatus, CommandTail } from '../src/shared/runtime-ipc'

/**
 * # 🔴 The card that shows what a command is printing, and offers to stop just it (300)
 *
 * ⛔ **Every fixture is a Codex-shaped stream with NO `tool_result`** — §5's gate, and the reason
 * `280` #1 was possible: *"every desktop test uses a Claude-style receipt"*. A detached Codex command
 * emits no `item/completed`, ever (275, measured), so a suite that closed the card would be testing
 * the one shape this provider does not produce.
 *
 * ⚠️ **SSR, so every negative here is paired with a positive.** A renderer test that only asserts
 * *"the Stop is not on screen"* passes just as happily over a component that failed to render at
 * all — which is what `193` is about and what `brobot2-ssr-tests-pass-vacuously` is a standing note
 * about. Each `not.toContain` below sits beside a `toContain` from the SAME html.
 */

const CALL = 'exec-14dfe485-2de2-4f00-b24c-f0b42a7ad785'
const KEY = '28992'

/** ⚠️ `backgroundId` on the CALL, which is what Codex puts on every PTY-backed command. */
function codexCall(): RuntimeEvent {
  return { type: 'tool_call', id: CALL, name: 'shell', summary: 'seq 1 12', backgroundId: KEY }
}

function foldOf(...events: RuntimeEvent[]): ToolItem {
  const state: TranscriptState = createTranscript()
  for (const event of events) applyEvent(state, event, 1_000)
  const found = state.items.find((item): item is ToolItem => item.kind === 'tool')
  expect(found, 'the tool row this test is about').toBeDefined()
  return found as ToolItem
}

const tail = (over: Partial<CommandTail> = {}): CommandTail => ({
  text: 'tick-1\ntick-2\n',
  dropped: 0,
  closed: false,
  ...over,
})

async function render(props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(ToolEntry, props))
}

describe('300 · the fold keeps the provider’s stop key without calling it a detachment', () => {
  it('🔴 a running command carries `stopKey` — and is NOT background work', () => {
    const item = foldOf(codexCall())
    expect(item.stopKey, 'the key the provider handed us on the call itself').toBe(KEY)
    // ⛔ **The distinction `detachment` refuses to blur, from the other side.** Codex attaches a
    // `processId` to every PTY-backed command, so a card that called itself detached because it had
    // one would put "still running" on finished commands — the false-settled card's mirror image.
    expect(item.background, 'having a key must never mean having detached').toBeUndefined()
  })

  it('⚑ a receipt that names the key sets it too — which is the only place CLAUDE ever does', () => {
    // `claude/normalize.ts` sets `backgroundId` only beside `backgrounded`, so a detached Claude
    // task has no key until this frame, where the Codex call already had one from `item/started`.
    const item = foldOf(
      { type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'sleep 30' },
      {
        type: 'tool_result',
        id: 'toolu_1',
        summary: 'Command running in background with ID: b6uoyo82k',
        ok: true,
        backgrounded: true,
        backgroundId: 'b6uoyo82k',
      },
    )
    expect(item.stopKey).toBe('b6uoyo82k')
    // …and here it IS detached, which is the paired positive that keeps the negative above honest.
    expect(item.background?.id).toBe('b6uoyo82k')
  })

  it('⛔ a later receipt carrying no key cannot take the key away', () => {
    const item = foldOf(codexCall(), {
      type: 'tool_result',
      id: CALL,
      summary: 'seq 1 12',
      ok: true,
    })
    // ⚠️ Same rule as `background` being merged rather than assigned: a second frame must not be
    // able to remove what a first one stated.
    expect(item.stopKey).toBe(KEY)
  })
})

describe('300 · one predicate for “is this command going on”', () => {
  /**
   * ⛔ **Two surfaces ask it and they must not be able to disagree** (099/064, and `300` §4's own
   * warning). The card gates its tail and its Stop on it; the pane asked the same question in its
   * first draft with a second derivation, which is the shape this function exists to remove.
   */
  it('🔴 a call with no receipt is live, and one with a receipt is not', () => {
    expect(commandIsLive(foldOf(codexCall()))).toBe(true)
    expect(
      commandIsLive(
        foldOf(codexCall(), { type: 'tool_result', id: CALL, summary: 'done', ok: true }),
      ),
    ).toBe(false)
  })

  it('⛔ a FAILED receipt is not live either — the row is finished, however it finished', () => {
    expect(
      commandIsLive(
        foldOf(codexCall(), { type: 'tool_result', id: CALL, summary: 'failed', ok: false }),
      ),
    ).toBe(false)
  })

  it('🔴 an `unfinished` row is NOT live — nothing will ever report back, so nothing may act on it', () => {
    const state = createTranscript()
    applyEvent(state, codexCall(), 1_000)
    markReopened(state)
    const item = state.items.find((i): i is ToolItem => i.kind === 'tool') as ToolItem
    expect(item.unfinished, 'the paired positive: the sweep really ran').toBe(true)
    expect(commandIsLive(item)).toBe(false)
  })

  it('⚑ DETACHED work is live until the provider reports an ending — the receipt is not one', () => {
    const detached = foldOf(
      { type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'sleep 30' },
      {
        type: 'tool_result',
        id: 'toolu_1',
        summary: 'Command running in background with ID: b6uoyo82k',
        ok: true,
        backgrounded: true,
        backgroundId: 'b6uoyo82k',
      },
    )
    // ⛔ `245` measured 24.5 seconds of a green settled card on exactly this row. The receipt says
    // it LEFT; only `background_work.ended` says it is over.
    expect(commandIsLive(detached)).toBe(true)
    const ended = foldOf(
      { type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'sleep 30' },
      {
        type: 'tool_result',
        id: 'toolu_1',
        summary: 'Command running in background with ID: b6uoyo82k',
        ok: true,
        backgrounded: true,
        backgroundId: 'b6uoyo82k',
      },
      {
        type: 'background_work',
        ended: { id: 'b6uoyo82k', toolCallId: 'toolu_1', outcome: 'completed' },
        source: 'test',
      },
    )
    expect(commandIsLive(ended)).toBe(false)
  })
})

describe('300 · gap 5 — the Stop on the card', () => {
  it('🔴 is offered for a running command with a key, on a session that can stop one', async () => {
    const html = await render({ item: foldOf(codexCall()), canStop: true })
    expect(html).toContain('Stop this command')
    expect(html, 'the paired positive: the card really rendered').toContain('seq 1 12')
  })

  it('⛔ is absent when the ADAPTER cannot stop one — 106, and absent rather than greyed (118)', async () => {
    const html = await render({ item: foldOf(codexCall()), canStop: false })
    expect(html).not.toContain('Stop this command')
    expect(html, 'the paired positive').toContain('seq 1 12')
  })

  it('⛔ is absent when the provider named no key — every Claude call that did not detach', async () => {
    const item = foldOf({ type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'sleep 30' })
    const html = await render({ item, canStop: true })
    expect(html).not.toContain('Stop this command')
    expect(html, 'the paired positive').toContain('sleep 30')
  })

  it('🔴 is absent once the row is UNFINISHED — which is what keeps a recycled id unreachable', async () => {
    // ⛔ Codex's `processId` is a counter it reuses; a transcript row lives as long as the
    // conversation. `stopOpenToolCalls` marks every open row `unfinished` at each boundary that ends
    // the thing running it, so a replayed conversation offers nothing to press.
    const state = createTranscript()
    applyEvent(state, codexCall(), 1_000)
    markReopened(state)
    const item = state.items.find((i): i is ToolItem => i.kind === 'tool') as ToolItem
    expect(item.stopKey, 'the key is still on the row — this is about the GATE').toBe(KEY)
    const html = await render({ item, canStop: true })
    expect(html).not.toContain('Stop this command')
    expect(html, 'the paired positive').toContain('did not finish')
  })

  it('⚠️ reads "Stopping…" while the request is in flight, and is disabled', async () => {
    const html = await render({ item: foldOf(codexCall()), canStop: true, stopping: true })
    expect(html).toContain('Stopping…')
    expect(html).toContain('disabled')
    expect(html).not.toContain('Stop this command')
  })
})

describe('300 · gap 3 — the live tail', () => {
  it('⛔ is behind the fold, because opening the row is what asking to see it IS', async () => {
    const html = await render({ item: foldOf(codexCall()), canWatch: true, tail: tail() })
    // ⚠️ Folded is the default, and the tail is the one thing that waits for the gesture — unlike
    // the Stop above it, which must never be behind a disclosure triangle (106).
    expect(html).not.toContain('tool-tail-text-')
    expect(html, 'the paired positive').toContain('seq 1 12')
  })

  it('🔴 the whole absence vocabulary is three different sentences, not one blank', () => {
    const absent: CapabilityStatus = {
      state: 'absent',
      reason: 'Claude does not report it until the command finishes.',
      checkedAgainst: 'the probe',
    }
    // ⚑ the provider will never stream it — its own sentence, never a copy (039)
    expect(tailAbsence(null, false, absent)).toBe(absent.reason)
    // ⚑ D-017b · nothing is watching it here: the same sentence as nothing kept — ⛔ whether the
    // conversation's process runs is not the card's to say (`05` rule 5), so no `closed`.
    const unread = tailAbsence(null, false, { state: 'available' })
    expect(unread).toBe('Nothing has been kept for this one.')
    expect(unread).not.toMatch(/closed|running|process/i)
    // ⚑ nothing kept for this one
    expect(tailAbsence(null, true, { state: 'available' })).toContain('Nothing has been kept')
    // ⚑ …which is a different fact from having printed nothing yet (074)
    expect(tailAbsence(tail({ text: '' }), true, { state: 'available' })).toContain(
      'not printed anything yet',
    )
    // ⛔ and with something to show, there is no sentence at all
    expect(tailAbsence(tail(), true, { state: 'available' })).toBeNull()
  })

  it('provider follow-ups 1 · a command that went to the background reads the background half', () => {
    const foreground: CapabilityStatus = { state: 'absent', reason: 'FG', checkedAgainst: 'probe' }
    const background: CapabilityStatus = { state: 'unwired', reason: 'BG' }
    expect(outputStandingFor(true, foreground, background)).toBe(background)
    expect(outputStandingFor(false, foreground, background)).toBe(foreground)
    // ⚑ What that means on Claude's card: an `unwired` half says the card's own sentence (below).
    expect(tailAbsence(null, false, outputStandingFor(true, foreground, background))).toBe(
      'Nothing has been kept for this one.',
    )
    expect(tailAbsence(null, false, outputStandingFor(false, foreground, background))).toBe('FG')
  })

  it('⚠️ an `unwired` reason is NOT shown — it is a sentence about us, in the wrong voice', () => {
    const said = tailAbsence(null, false, { state: 'unwired', reason: 'we have not built it' })
    expect(said).not.toContain('we have not built it')
    // ⚑ the paired positive: the card's own sentence stands in its place
    expect(said).toBe('Nothing has been kept for this one.')
  })

  it('⛔ a cut is COUNTED, never an ellipsis (092)', () => {
    expect(tailDroppedNote(1)).toBe('1 earlier character is no longer kept')
    expect(tailDroppedNote(12_000)).toContain('12,000')
  })

  it('⚑ "still live" comes from the provider’s ending, never from silence', () => {
    expect(tailIsLive(tail())).toBe(true)
    expect(tailIsLive(tail({ closed: true }))).toBe(false)
    // A command that has printed nothing for a minute is a command printing nothing (042's ruling
    // about `idle`, one subject over) — the empty tail is still live.
    expect(tailIsLive(tail({ text: '' }))).toBe(true)
    expect(tailIsLive(null)).toBe(false)
  })
})
