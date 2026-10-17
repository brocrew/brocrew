import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ReadingPane from '../src/renderer/src/components/ReadingPane.vue'
import PromptComposer from '../src/renderer/src/components/PromptComposer.vue'
import TranscriptView from '../src/renderer/src/components/TranscriptView.vue'
import type { LibraryEntry, PersistedEventInfo } from '../src/shared/runtime-ipc'
import { applyEvent, createTranscript, markReadOnly } from '../src/renderer/src/lib/transcript'
import { createWindow, openAt, type WindowState } from '../src/renderer/src/lib/transcript-window'

/**
 * The read-only container (Slice 2 · 047).
 *
 * The claim it has to earn is a NEGATIVE one — that nothing here can be acted on — and a negative
 * is what a component quietly loses. So these tests assert the absences directly, and one of them
 * (`no live approval buttons`) is written against a transcript that is genuinely mid-request,
 * because that is the only shape in which the buttons would render at all.
 */

const here = dirname(fileURLToPath(import.meta.url))
const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(ReadingPane as never, props) }))

const ENTRY: LibraryEntry = {
  id: 'sess_read',
  provider: 'claude',
  providerSessionId: 'thread-1',
  recordId: 'sess_read',
  cwd: '/work/parser',
  title: 'Fix the parser',
  preview: 'the parser drops a line',
  createdAt: 1_000,
  updatedAt: 2_000,
  bytes: 4_096,
  origin: 'user-home',
  onDisk: true,
  readable: true,
  // The ordinary case: our reading of this recording covers every byte we hold (065), so the pane
  // says nothing about completeness. The `stale` shape gets its own test.
  derived: 'current',
  lastEnding: 'completed',
  unresumableReason:
    "one of your own Claude conversations, found in Claude's own folder — BroBot can read it " +
    "here, but a reopen would start Claude in BroCrew's own folder, where this conversation is not",
  child: null,
}

/**
 * A page of recorded conversation, in the shape the wire carries since 054 — the entries plus the
 * cursor that says whether anything precedes them.
 *
 * `hasOlder: false` because everything these tests fold is everything there is. Paging back is
 * exercised where the paging lives; here the point is that the pane renders what it is handed, and
 * a fixture that quietly claimed there was more would put a "load earlier" affordance into
 * assertions about a read-only surface having no controls.
 */
function history(...events: PersistedEventInfo['event'][]): WindowState {
  const window = createWindow()
  openAt(
    window,
    {
      entries: events.map((event, ordinal) => ({ ordinal, at: 1_000 + ordinal, event })),
      from: 0,
      hasOlder: false,
      turnAligned: true,
    },
    'sess_read',
  )
  return window
}

/**
 * A permission request in the shape the runtime actually emits — `kind`, `action`, `detail` and a
 * full `scope`. Transcribed from the schema rather than approximated: the first version of this
 * fixture omitted `scope`, which rendered fine as a SETTLED card and crashed the moment a test
 * rendered it as a live one. A fixture that only survives the path under test proves nothing about
 * the path it is meant to contrast with.
 */
const PERMISSION_SCOPE = {
  cwd: '/work/parser',
  paths: ['write /work/parser/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

function permissionRequest(id = 'req-1'): PersistedEventInfo['event'] {
  return {
    type: 'permission_request',
    id,
    kind: 'file',
    action: 'Write',
    detail: 'out.txt',
    scope: PERMISSION_SCOPE,
  }
}

const CONVERSATION = history(
  { type: 'user_turn', text: 'hello there' },
  { type: 'assistant_message', text: 'hello back' },
)

describe('a conversation being read', () => {
  it('renders the transcript through the same fold a live session uses', async () => {
    const html = await render({
      entry: ENTRY,
      history: CONVERSATION,
      mode: 'normal',
    })
    expect(html).toContain('hello there')
    expect(html).toContain('hello back')
  })

  it('says it is read-only, on its face', async () => {
    const html = await render({
      entry: ENTRY,
      history: CONVERSATION,
      mode: 'normal',
    })
    expect(html).toContain('data-cy="read-only-banner"')
    expect(html).toContain('Read-only')
  })

  it('gives the reason in the STORE’s words rather than its own', async () => {
    const html = await render({
      entry: ENTRY,
      history: CONVERSATION,
      mode: 'normal',
    })
    // ⚑ **151 rewrote this sentence and the point of the test is unchanged**: the pane prints the
    // STORE's words. The three clauses are asserted separately so a rewrite that quietly drops one
    // of them — whose it is, that it is readable, why it will not reopen — fails here.
    expect(html).toContain('one of your own Claude conversations')
    // The pane explains where the read-only conversation came from, not only why it cannot
    // resume. Assert that provenance explicitly. Use wording without an apostrophe so the
    // assertion survives SSR escaping unlike `BroBot&#39;s`.
    expect(html).toContain('found in Claude')
    expect(html).toContain('BroBot can read it here')
    // ⚠️ **A clause with no apostrophe in it**: this is escaped markup, so `BroBot's` arrives as
    // `BroBot&#39;s` and a `toContain` of the source string fails for a sentence that is present.
    expect(html).toContain('where this conversation is not')
    // ⚠️ **No `not.toContain('provider home')` here.** This is an SSR string and it carries the
    // component's own source comments, which name internal concepts freely — the jargon assertion
    // belongs where the sentence is BUILT, and `archive-sweep.test.ts` makes it there.
  })

  it('names the provider by passing the value through, never by knowing it', async () => {
    const html = await render({
      entry: { ...ENTRY, provider: 'codex' },
      history: CONVERSATION,
      mode: 'normal',
    })
    expect(html).toContain('codex')
  })

  it('falls back to the directory when the provider never named it — never to a composed title', async () => {
    const html = await render({
      entry: { ...ENTRY, title: '' },
      history: CONVERSATION,
      mode: 'normal',
    })
    // `parser` is the basename of a real cwd. A summary invented here would be indistinguishable
    // from one a provider wrote, which is the whole reason nothing composes one.
    expect(html).toContain('parser')
  })

  it('renders an un-imported conversation as empty, and says which kind of empty', async () => {
    const html = await render({
      entry: ENTRY,
      history: history(),
      mode: 'normal',
    })
    expect(html).toContain('Nothing has been imported')
  })

  describe('🔒 nothing in it can be acted on', () => {
    it('mounts no composer', async () => {
      // The composer is not conditionally hidden — it is not imported. Asserted on the rendered
      // output too, because "not imported today" is a fact a later edit can quietly undo.
      //
      // The selectors are proven REAL first, by rendering the composer itself. A `not.toContain`
      // against a `data-cy` that never existed passes forever and proves nothing — which is what
      // this test did before the string was checked against the component.
      const composer = await renderToString(
        createSSRApp({
          render: () => h(PromptComposer as never, { state: 'idle', who: 'claude', draft: '' }),
        }),
      )
      expect(composer).toContain('data-cy="prompt-input"')
      expect(composer).toContain('data-cy="send-prompt"')

      const html = await render({
        entry: ENTRY,
        history: CONVERSATION,
        mode: 'normal',
      })
      expect(html).not.toContain('data-cy="prompt-input"')
      expect(html).not.toContain('data-cy="send-prompt"')
      expect(html).not.toContain('<textarea')
    })

    it('offers no resume', async () => {
      const html = await render({
        entry: ENTRY,
        history: CONVERSATION,
        mode: 'normal',
      })
      // Deliberately absent rather than disabled: 036 mapped what resuming an imported session
      // would need and it is still out of scope. A Resume that failed would read as data loss.
      //
      // A WORD-boundary match, not `>resume<`: a button labelled "Resume session" would have
      // slipped straight through the tag-adjacent form.
      expect(html).not.toMatch(/\bresume\b/i)
    })

    it('shows NO live approval buttons for a request the session never answered', async () => {
      // The shape that makes this test non-vacuous: a permission request with no decision after it,
      // which is exactly what a ledger holds when the app was quit mid-request. Fed through the
      // plain fold, this renders Allow and Deny.
      const pending = history({ type: 'user_turn', text: 'delete the thing' }, permissionRequest())

      const live = createTranscript()
      for (const entry of pending.entries) applyEvent(live, entry.event, entry.at)
      const card = live.items.find((item) => item.kind === 'permission')
      expect(card, 'the fixture must actually produce a permission card').toBeDefined()
      expect(card?.kind === 'permission' && card.outcome).toBeNull()

      // Non-vacuity, proven rather than assumed: the SAME items, rendered WITHOUT the read-only
      // pass, do show the buttons. Without this the assertion below would pass just as happily if
      // the selector were misspelled or the card had never rendered at all.
      const offered = await renderToString(
        createSSRApp({
          render: () => h(TranscriptView as never, { items: live.items, mode: 'debug' }),
        }),
      )
      expect(offered).toContain('data-cy="permission-allow"')

      const html = await render({
        entry: ENTRY,
        history: pending,
        mode: 'debug',
      })
      // Settled with a reason instead of offered as a choice.
      expect(html).toContain('This is a recording')
      // 154 §2b · one noun. The sentence said *"the session that asked is gone"* — this repo's word
      // for the thing every other line on this pane calls a conversation.
      expect(html).toContain('the conversation that asked is gone')
      expect(html).not.toContain('data-cy="permission-allow"')
    })
  })
})

describe('markReadOnly', () => {
  it('settles a request nobody can answer, with a reason', () => {
    const state = createTranscript()
    applyEvent(state, permissionRequest(), 1_000)
    const before = state.items.find((item) => item.kind === 'permission')
    expect(before?.kind === 'permission' && before.note).toBeNull()

    markReadOnly(state, 'because it is a recording')

    const after = state.items.find((item) => item.kind === 'permission')
    expect(after?.kind === 'permission' && after.note).toBe('because it is a recording')
  })

  it('does NOT mark the transcript as ended', () => {
    const state = createTranscript()
    markReadOnly(state, 'reading')
    // A recording is not a conversation that ended — some of these never did — and the flag governs
    // a composer that is not mounted here at all.
    expect(state.ended).toBe(false)
  })

  it('stops claiming anything is running now', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'activity', phase: 'tool', detail: 'Bash' } as never, 1_000)
    markReadOnly(state, 'reading')
    // A pulsing "running Bash" in a transcript being READ is a claim about now, and it is false.
    expect(state.activity).toBeNull()
  })

  it('stops a checklist frozen mid-step from pulsing under a "read-only" banner', () => {
    const state = createTranscript()
    applyEvent(
      state,
      {
        type: 'plan_update',
        steps: [
          { text: 'read the file', status: 'done' },
          { text: 'change it', status: 'active' },
          { text: 'test it', status: 'pending' },
        ],
      } as never,
      1_000,
    )
    const before = state.items.find((item) => item.kind === 'plan')
    expect(before?.kind === 'plan' && before.steps[1]?.status).toBe('active')

    markReadOnly(state, 'reading')

    // `PlanEntry` animates an `active` step, so a recording of a session that died on step 2 sat
    // there pulsing — the same false claim about NOW that the activity pill and the sub-agent
    // cards were already corrected for. `pending` is what it was, and the only one still true.
    const after = state.items.find((item) => item.kind === 'plan')
    expect(after?.kind === 'plan' && after.steps.map((step) => step.status)).toEqual([
      'done',
      'pending',
      'pending',
    ])
  })

  it('drops the pointers a further event would use to overwrite what was replayed', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'assistant_delta', text: 'half a th' }, 1_000)
    applyEvent(
      state,
      { type: 'plan_update', steps: [{ text: 'a step', status: 'active' }] } as never,
      1_001,
    )

    markReadOnly(state, 'reading')

    // The asymmetry with `markReopened` was the trap: these point INTO items, and a state handed
    // one more event would splice out the last streamed block or clobber the checklist in place.
    expect(state.provisionalId).toBeNull()
    expect(state.planId).toBeNull()
    expect(state.streamingId).toBeNull()
  })

  it('leaves an already-answered decision exactly as it was', () => {
    const state = createTranscript()
    applyEvent(state, permissionRequest(), 1_000)
    applyEvent(state, { type: 'user_decision', requestId: 'req-1', outcome: 'allow' }, 1_001)

    markReadOnly(state, 'reading')

    const card = state.items.find((item) => item.kind === 'permission')
    // The history says it was allowed. Overwriting that with "nothing can answer" would rewrite
    // what actually happened.
    expect(card?.kind === 'permission' && card.outcome).toBe('allow')
    expect(card?.kind === 'permission' && card.note).toBeNull()
  })
})

describe('🔒 the library surfaces name no provider', () => {
  /**
   * AC5, as a source scan rather than a rendered one: a provider comparison can hide in a branch no
   * fixture reaches. The renderer is provider-agnostic by construction — every provider name it
   * shows is a VALUE it was handed — and these two files are the newest place that could break it.
   */
  const SURFACES = ['SessionLibrary.vue', 'ReadingPane.vue']

  /**
   * The file with its COMMENTS removed.
   *
   * The rule is about what the component knows, not about what it may be documented as doing —
   * explaining that this surface merges a Claude home and a Codex home is exactly the kind of note
   * worth keeping, and a scan that banned the words outright would push that explanation out of the
   * file it belongs in. What must not survive is a provider name in code or in rendered text.
   */
  const withoutComments = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  for (const name of SURFACES) {
    it(`${name} names no provider outside its comments`, () => {
      const source = readFileSync(join(here, '../src/renderer/src/components', name), 'utf8')
      const code = withoutComments(source)
      // WORD boundaries rather than quote-adjacency. The quoted form catches `'claude'` and misses
      // `<span>from claude</span>` — a label in running prose is exactly the provider knowledge
      // this rule exists to keep out of the renderer, and it would have been invisible.
      expect(code).not.toMatch(/\bclaude\b/i)
      expect(code).not.toMatch(/\bcodex\b/i)
    })
  }

  it('the scan would still catch a provider name in code or in rendered text', () => {
    // Non-vacuity: strip-comments is doing real work above, so prove it does not strip everything.
    // Both of these are what the rule is actually for, and both must be caught.
    const inCode = withoutComments(`<script>const x = props.provider === 'claude'</script>`)
    const inTemplate = withoutComments(`<template><span>running on Codex</span></template>`)
    expect(inCode).toMatch(/\bclaude\b/i)
    expect(inTemplate).toMatch(/\bcodex\b/i)
    // And a comment is genuinely removed, or the test above would be unpassable rather than strict.
    expect(withoutComments('/* the user’s Claude home */')).not.toMatch(/\bclaude\b/i)
  })
})

/**
 * Paging back through a long recording (054).
 *
 * The affordance sits INSIDE the scroll container, so it moves with the content it belongs to.
 * These assert what a reader can see and act on — the arithmetic that keeps their place is a pure
 * function and is tested in `transcript-window.test.ts`, because this environment has no layout.
 */
describe('a recording longer than one page', () => {
  /** A page with more before it — the ordinary state of a long conversation. */
  function paged(rest: Partial<WindowState> = {}): WindowState {
    const window = createWindow()
    openAt(
      window,
      {
        entries: [
          { ordinal: 900, at: 1_000, event: { type: 'user_turn', text: 'carry on' } },
          { ordinal: 901, at: 1_001, event: { type: 'assistant_message', text: 'carrying on' } },
        ],
        from: 900,
        hasOlder: true,
        turnAligned: true,
      },
      'sess_read',
    )
    return Object.assign(window, rest)
  }

  it('offers to load what came before', async () => {
    const html = await render({
      entry: ENTRY,
      history: paged(),
      mode: 'normal',
      onLoadOlder: async () => {},
    })
    expect(html).toContain('data-cy="load-older"')
    expect(html).toContain('Load earlier messages')
  })

  it('offers nothing when there is nothing before it', async () => {
    // The rule this surface is built on: a control that is present and inert is worse than absent.
    const html = await render({
      entry: ENTRY,
      history: CONVERSATION,
      mode: 'normal',
      onLoadOlder: async () => {},
    })
    expect(html).not.toContain('data-cy="load-older"')
  })

  it('says when the page begins part-way through a turn, and stays quiet when it does not', async () => {
    // The event ceiling can cut mid-turn, and a reader cannot tell that from a conversation that
    // really started there. Both directions asserted, so the message is not simply always on.
    const cut = await render({
      entry: ENTRY,
      history: paged({ turnAligned: false }),
      mode: 'normal',
      onLoadOlder: async () => {},
    })
    expect(cut).toContain('data-cy="older-partial"')
    expect(cut).toContain('part-way through a turn')

    const clean = await render({
      entry: ENTRY,
      history: paged(),
      mode: 'normal',
      onLoadOlder: async () => {},
    })
    expect(clean).not.toContain('data-cy="older-partial"')
  })

  it('🔒 still offers nothing that would act on the session', async () => {
    // 047's guarantee, re-asserted against the ONE control this task added. A "Load earlier" button
    // reads from the ledger and can touch nothing; the point is that adding it did not quietly
    // reopen the composer or a resume path alongside it.
    const html = await render({
      entry: ENTRY,
      history: paged(),
      mode: 'normal',
      onLoadOlder: async () => {},
    })
    expect(html).not.toMatch(/\bresume\b/i)
    expect(html).not.toContain('data-cy="prompt-input"')
    expect(html).not.toContain('data-cy="permission-allow"')
  })
})

/**
 * **Read-only is not the same claim as complete** (065, from 061 finding 6).
 *
 * The banner this pane has always shown says nobody can change this conversation. It says nothing
 * about whether what is on screen is all of it — and 061's cost is exactly that: *"the UI can
 * permanently present the old derived tail as complete"*. Both directions are asserted, because a
 * notice that is always on says nothing either.
 */
describe('the reading pane can say a recording is behind its archive (065)', () => {
  const withDerived = (derived: LibraryEntry['derived']): LibraryEntry => ({ ...ENTRY, derived })

  const paneFor = (derived: LibraryEntry['derived']): Promise<string> =>
    render({
      entry: withDerived(derived),
      history: { entries: [], hasOlder: false, turnAligned: true },
      mode: 'normal',
    })

  it('says so for a stale recording, in words that do not read as damage', async () => {
    const html = await paneFor('stale')
    expect(html).toContain('data-cy="reading-behind"')
    expect(html).toContain('Read by an older version of BroCrew. Rebuild to read it again.')
    // The read-only claim is still made; this qualifies it rather than replacing it.
    expect(html).toContain('data-cy="read-only-banner"')
  })

  it('says the previous transcript is intact when a rebuild failed', async () => {
    const html = await paneFor('failed')
    expect(html).toContain('data-cy="reading-behind"')
    // The thing a reader would otherwise assume is that the failure damaged something.
    expect(html).toContain('the previous transcript, whole')
  })

  it('stays silent when the recording covers its archive, and when nothing was projected', async () => {
    expect(await paneFor('current')).not.toContain('data-cy="reading-behind"')
    // Null is a session this app RAN: its ledger is the recording, so there is no watermark it
    // could be behind and nothing honest to say about one.
    expect(await paneFor(null)).not.toContain('data-cy="reading-behind"')
  })
})
