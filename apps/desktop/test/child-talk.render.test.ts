import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ChildWorkViewer from '../src/renderer/src/components/ChildWorkViewer.vue'
import type {
  ChildSendResult,
  ChildStateResult,
  ChildWorkResult,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # The composer in the sub-agent viewer (296) — what SSR can and cannot see
 *
 * ⚠️ **This project's SSR rule, and this file is a good place to restate why.** `renderToString`
 * gives one string. Every `not.toContain` here therefore sits beside a `toContain` that proves the
 * component rendered SOMETHING — otherwise "the composer is absent" passes just as happily over a
 * viewer that threw, rendered nothing, or lost its template entirely.
 *
 * ⛔ **And HTML comments are stripped**, for the reason `subagent-identity.render.test.ts` records:
 * this component's own source is dense with prose about the composer, so an unstripped `toContain`
 * could be answered by a code comment sitting beside the code that was supposed to render it.
 *
 * ⚑ **What is NOT here: the timer.** `onMounted` does not run under `renderToString`, so no refresh
 * fires and no state is ever fetched — which is exactly why the "asking…" line below is what SSR
 * sees. The follow itself is measured in `test/dom/child-talk.dom.test.ts`.
 */

const transcript = (
  over: Partial<Extract<ChildWorkResult, { ok: true }>> = {},
): ChildWorkResult => ({
  ok: true,
  part: 'transcript',
  name: 'rollout-2026-09-02.jsonl',
  runId: null,
  taskId: null,
  text: '{"type":"agent_message"}\n',
  truncated: false,
  bytes: 25,
  entries: [],
  ...over,
})

const CHILD = '01a05f65-acd4-7973-a576-10bf559433b9'

interface Wiring {
  agent?: string | null
  onRefresh?: () => Promise<void>
  onReadState?: (agentId: string) => Promise<ChildStateResult>
  onSend?: (agentId: string, text: string) => Promise<ChildSendResult>
}

/** Everything a mount needs to be able to talk — used whole, or with one piece taken away. */
const wired = (): Required<Wiring> => ({
  agent: CHILD,
  onRefresh: () => Promise.resolve(),
  onReadState: () => Promise.resolve({ ok: false, reason: 'unreachable' } as ChildStateResult),
  onSend: () => Promise.resolve({ ok: true, turnId: null }),
})

const render = async (result: ChildWorkResult, wiring: Wiring = {}): Promise<string> =>
  (
    await renderToString(
      createSSRApp({ render: () => h(ChildWorkViewer, { result, label: 'Plato', ...wiring }) }),
    )
  ).replace(/<!--[\s\S]*?-->/g, '')

describe('296 · the composer appears only where there is something to talk to', () => {
  it('⛔ a mount with the whole channel DRAWS a composer — the positive this file is anchored on', async () => {
    const html = await render(transcript(), wired())
    expect(html).toContain('data-cy="child-talk"')
    expect(html).toContain('data-cy="child-talk-input"')
    expect(html).toContain('data-cy="child-talk-send"')
    expect(html).toContain('<textarea')
    // The label travels into the box, so a person can see which child they are about to speak to.
    expect(html).toContain('Say something to Plato')
  })

  it('⚠️ …and a mount with NO channel draws none — the pre-296 viewer, unchanged', async () => {
    const html = await render(transcript())
    // ⛔ The paired positive FIRST: this proves the component rendered a transcript viewer at all,
    // so the three absences below are absences in a real render.
    expect(html).toContain('data-cy="child-work-viewer"')
    expect(html).toContain('data-cy="child-work-paper"')
    expect(html).not.toContain('data-cy="child-talk"')
    expect(html).not.toContain('<textarea')
  })

  it('every single piece of the channel is REQUIRED — one missing and there is no box', async () => {
    // ⚠️ Four mounts, each missing exactly one thing, so this cannot pass because of whichever
    // condition happens to be checked first.
    for (const missing of ['agent', 'onReadState', 'onSend'] as const) {
      const wiring: Wiring = { ...wired() }
      if (missing === 'agent') wiring.agent = null
      else delete wiring[missing]
      const html = await render(transcript(), wiring)
      expect(html, `${missing} was missing and a composer appeared anyway`).not.toContain(
        'data-cy="child-talk"',
      )
      expect(html, 'the viewer still rendered').toContain('data-cy="child-work-viewer"')
    }
  })

  it('⛔ a JOURNAL is nobody’s child, so it gets no composer however it is wired', async () => {
    // The union `ChildWorkInput` makes, carried all the way to the mount: a run's document belongs
    // to a task and there is no thread behind it to address.
    const journal: ChildWorkResult = {
      ...(transcript() as Extract<ChildWorkResult, { ok: true }>),
      part: 'journal',
      name: 'journal.jsonl',
    }
    const html = await render(journal, { ...wired(), agent: null })
    expect(html).toContain('data-cy="child-work-viewer"')
    expect(html).not.toContain('data-cy="child-talk"')
  })

  it('a REFUSED read gets the refusal sentence and no composer', async () => {
    const html = await render({ ok: false, reason: 'gone' }, wired())
    expect(html).toContain('data-cy="child-work-refusal"')
    expect(html).not.toContain('data-cy="child-talk"')
  })
})

describe('296 · what the viewer says before the provider has answered', () => {
  it('says it is asking, rather than showing a dark box with no explanation', async () => {
    const html = await render(transcript(), wired())
    // SSR never runs `onMounted`, so this is genuinely the pre-answer state — the one a person sees
    // for the first fraction of a second, and the one 169 is about: a control with no sentence
    // beside it is a control nobody can act on.
    expect(html).toContain('data-cy="child-talk-note"')
    expect(html).toContain('Asking the agent what this child is doing')
  })

  it('⛔ the send button starts DISABLED — nothing has said the child will listen', async () => {
    const html = await render(transcript(), wired())
    const button = html.slice(html.indexOf('data-cy="child-talk-send"'))
    expect(button.slice(0, 200)).toContain('disabled')
  })
})

/**
 * ⛔ **The note is the sentence a SETTLED CARD carries**, which is why these fixtures have a
 * permission request in them. `markReadOnly(state, reason)` puts the reason on requests the child
 * left pending — so a child transcript with no card never shows it at all, and a test that asserted
 * the wording over an empty transcript would have been asserting nothing (the first draft of this
 * block was, and it failed rather than passing, which is the one good way to find out).
 */
describe('296 · the read-only note moved deliberately', () => {
  const pending: TranscriptEvent[] = [
    { type: 'user_turn', text: 'Have a look around.' } as TranscriptEvent,
    {
      type: 'permission_request',
      id: 'perm_1',
      kind: 'command',
      action: 'Bash',
      detail: 'run: ls',
      scope: { onceLabel: 'Allow once', alwaysLabel: null, denyLabel: 'Deny' },
    } as unknown as TranscriptEvent,
  ]

  it('⛔ stops claiming "nothing here can answer" once there IS something', async () => {
    const withBox = await render(transcript({ entries: pending }), wired())
    // The paired positive first — the card really rendered, so the wording below is a wording that
    // is on screen rather than one that is absent along with everything else.
    expect(withBox).toContain('data-cy="child-talk"')
    expect(withBox).toContain('answered in its own')
    expect(
      withBox,
      'the viewer promised a person nothing could answer, with a composer underneath it',
    ).not.toContain('nothing here can answer')
  })

  it('⚑ …and still says it where it is still true — the paired positive', async () => {
    const withoutBox = await render(transcript({ entries: pending }))
    expect(withoutBox).not.toContain('data-cy="child-talk"')
    expect(withoutBox).toContain('nothing here can answer')
  })
})

describe('296 · a follow that has stopped moving says so', () => {
  it('⛔ names the ceiling, separately from how big the file is', async () => {
    const html = await render(transcript({ truncated: true, bytes: 3_500_000 }), wired())
    // Both lines, because they say different things: one is the size, the other is that the SCREEN
    // has stopped changing — which is the thing a reader would otherwise read as a finished child.
    expect(html).toContain('data-cy="child-work-truncated"')
    expect(html).toContain('data-cy="child-work-outgrown"')
    expect(html).toContain('stopped changing')
  })

  it('⚠️ a viewer that does not FOLLOW says only the size — the first part of a file is honest', async () => {
    const html = await render(transcript({ truncated: true, bytes: 3_500_000 }))
    expect(html).toContain('data-cy="child-work-truncated"')
    expect(html).not.toContain('data-cy="child-work-outgrown"')
  })

  it('and an untruncated followed file says neither', async () => {
    const html = await render(transcript(), wired())
    expect(html).toContain('data-cy="child-work-paper"')
    expect(html).not.toContain('data-cy="child-work-outgrown"')
    expect(html).not.toContain('data-cy="child-work-truncated"')
  })
})
