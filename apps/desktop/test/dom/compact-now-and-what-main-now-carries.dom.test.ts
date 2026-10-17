import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import {
  COMPACT_HEADING,
  COMPACT_HEADING_AFTER_THE_TURN,
  COMPACT_IT,
  COMPACT_LINE,
  KEEP_EVERYTHING,
} from '../../src/renderer/src/lib/compaction-offer'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import type { WorkGivenOutReading } from '../../src/renderer/src/lib/work-given-out'
import type { CreatedSession, TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { WorkGivenOut } from '../../src/shared/tasks'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import {
  META,
  channelGap,
  drawerProps,
  mount,
  paintedBackground,
  paneProps,
  parseColor,
  permission,
  unmountAll,
  visible,
  type Mounted,
} from './harness'
import { conv, forestDrawn, task, viewOf } from './forest-fixture'

/**
 * # 🔴 718 — Compact now, and what main now carries: the halves only a real engine can see
 *
 *  - **§1 · `R60`** — the Context popup's *"Compact now…"* is live, opens a question, and sends the
 *    person's `/compact` only on the answer; dark, in words, where it cannot.
 *  - **§2 · `707` GAP-2/3/4** — three surfaces draw a piece by its label, *W1.1*. ⚑ **D-016** took
 *    the project out of a piece's name, so none of them says *in <project>* any more.
 *  - **§3 · `710` F-9** — the StartAsAgent sheet shows its own launch and its own refusal, and hands
 *    the words back.
 *  - **§4 · the `:9555` confusion** — the window's own title follows the name the bar draws.
 */

afterEach(unmountAll)

/* ================================================================ §1 · R60 */

const PAST = 1_700_000_000_000

/** A conversation record, built rather than patched — `SessionRecord.sessionId` is readonly. */
function conversation(
  events: readonly TranscriptEvent[],
  over: { sessionId?: string; meta?: Partial<CreatedSession>; phase?: 'open' | 'closing' } = {},
) {
  const sessionId = over.sessionId ?? 'sess_1'
  const r = createSessionRecord(sessionId)
  r.meta = { ...META, sessionId, ...over.meta }
  r.phase = over.phase ?? 'open'
  for (const event of events) applyEvent(r.transcript, event)
  return r
}

const WORKING = { type: 'status', state: 'working' } as TranscriptEvent

/**
 * ⚑ **The pane, its Context popup open, behind a host that can SWAP the record** — the conversation
 * switch and the offer withdrawn under an open question both need a record that moves, and a prop
 * handed to `createApp` does not (`watch-and-stop-one-command.dom.test.ts`' own finding).
 * ⚑ **W4.208** — the meter left the Dropped tab for a popup the card's context figure opens.
 */
async function theContextPopup(
  first: ReturnType<typeof conversation>,
  capabilities: unknown = CAPABILITY_FIXTURE,
) {
  const showing = ref(first)
  const pressed: string[] = []
  const Host = defineComponent({
    name: 'DroppedHost',
    setup() {
      return () =>
        h(ConversationPane as Component, {
          ...paneProps({ drawerOpen: true, drawerTab: 'open', capabilities }),
          record: showing.value,
          onCompactNow: (intent: string) => pressed.push(intent),
        })
    },
  })
  const m = mount(Host, {}, { width: 1200, height: 900 })
  await openThePopup(m)
  return { m, showing, pressed }
}

async function openThePopup(m: Mounted): Promise<void> {
  await nextTick()
  m.q('card-run-context').click()
  await nextTick()
  m.q('context-dialog')
}

const button = (m: Mounted) => m.q('context-compact-now') as HTMLButtonElement
const door = (m: Mounted) => m.host.querySelector<HTMLElement>('[data-cy="compact-door"]')
const why = (m: Mounted) => m.q('context-compact-why').textContent?.replace(/\s+/g, ' ').trim()

describe('§1 · `R60` — "Compact now…" works, after a confirm', () => {
  it('🔴 idle: the control is live, and the press asks — it sends NOTHING by itself', async () => {
    const { m, pressed } = await theContextPopup(conversation([]))
    await nextTick()
    expect(button(m).disabled).toBe(false)
    expect(why(m)).toContain('The provider can be asked — by /compact')
    // ⛔ Not the deferred foot's sentence any more — it described a confirm that now exists.
    expect(why(m)).not.toContain('no confirm step yet')
    expect(why(m)).not.toMatch(/^Deferred\./)

    expect(door(m)).toBeNull()
    button(m).click()
    await nextTick()
    expect(door(m), 'the press did not open the question').not.toBeNull()
    expect(m.q('compact-heading').textContent?.trim()).toBe(COMPACT_HEADING)
    expect(m.q('compact-line').textContent?.trim()).toBe(COMPACT_LINE)
    expect(button(m).getAttribute('aria-expanded')).toBe('true')
    expect(pressed, 'the first press sent something').toEqual([])
  })

  it('🔴 *Compact it* sends the person’s /compact — once, now — and shuts the question', async () => {
    const { m, pressed } = await theContextPopup(conversation([]))
    await nextTick()
    button(m).click()
    await nextTick()
    expect(m.q('compact-it').textContent?.trim()).toBe(COMPACT_IT)
    m.q('compact-it').click()
    await nextTick()
    expect(pressed).toEqual(['now'])
    expect(door(m)).toBeNull()
  })

  it('⛔ the other answer — *Keep everything* shuts it and sends nothing', async () => {
    const { m, pressed } = await theContextPopup(conversation([]))
    await nextTick()
    button(m).click()
    await nextTick()
    expect(m.q('compact-keep').textContent?.trim()).toBe(KEEP_EVERYTHING)
    m.q('compact-keep').click()
    await nextTick()
    expect(door(m)).toBeNull()
    expect(pressed).toEqual([])
  })

  it('🔴 busy: it QUEUES behind the turn, and says so before the press', async () => {
    const { m, pressed } = await theContextPopup(conversation([WORKING]))
    await nextTick()
    expect(button(m).disabled).toBe(false)
    expect(why(m)).toContain('is working, so it goes when this turn ends')
    button(m).click()
    await nextTick()
    // ⚑ **`718`'s review — the question says what the answer will DO**: not *now*, behind the turn.
    expect(m.q('compact-heading').textContent?.trim()).toBe(COMPACT_HEADING_AFTER_THE_TURN)
    m.q('compact-it').click()
    await nextTick()
    expect(pressed).toEqual(['queue'])
  })

  it('⛔ a question asked as *now* is shut when the agent starts working under it — and asked again', async () => {
    const { m, showing, pressed } = await theContextPopup(conversation([]))
    await nextTick()
    button(m).click()
    await nextTick()
    expect(m.q('compact-heading').textContent?.trim()).toBe(COMPACT_HEADING)
    showing.value = conversation([WORKING])
    await nextTick()
    await nextTick()
    expect(button(m).disabled).toBe(false)
    expect(door(m), 'a *now* question stayed open over a *queue* answer').toBeNull()
    // ⚑ …and asked again, in the words for what the answer will now do.
    button(m).click()
    await nextTick()
    expect(m.q('compact-heading').textContent?.trim()).toBe(COMPACT_HEADING_AFTER_THE_TURN)
    expect(pressed).toEqual([])
  })

  it('🔴 after a confirmed Compact behind the turn, the foot says it is on its way — not to cancel it', async () => {
    const { m } = await theContextPopup(
      conversation([WORKING], {
        meta: {
          queued: [{ messageId: 'm1', kind: 'person', text: '/compact', since: PAST }] as never,
        },
      }),
    )
    await nextTick()
    expect(button(m).disabled).toBe(true)
    expect(why(m)).toContain('A /compact is already waiting to go')
    expect(why(m)).not.toContain('Cancel it')
  })

  it('🔴 D-010 · a message already held, whoever wrote it: lit — the compaction waits its turn behind it', async () => {
    for (const held of [{ messageId: 'm1' }, { messageId: 'm1', attribution: 'app_authored' }]) {
      const { m } = await theContextPopup(
        conversation([WORKING], { meta: { queued: [held] as never } }),
      )
      await nextTick()
      expect(button(m).disabled, JSON.stringify(held)).toBe(false)
      unmountAll()
    }
  })

  // ⚑ **D-017b · no `ended` case** — there is no ended conversation: the composer takes a message in
  // every one, and the offer agrees with it (the render file's parity arm). ⚑ And the closing words
  // say no process fact (`05` rule 5): a conversation taking up a change.
  it.each([
    {
      what: 'a card waiting on the person',
      record: () => conversation([permission('req_1')]),
      says: 'waiting on you',
    },
    {
      what: 'closing',
      record: () => conversation([], { phase: 'closing' }),
      says: 'this conversation is taking up the change',
    },
    {
      what: 'a superseded sign-in',
      record: () =>
        conversation([], {
          meta: {
            liveness: { state: 'live', since: PAST, signInSuperseded: true },
          } as never,
        }),
      says: 'reopen it on the current one',
    },
  ])('⛔ $what: dark, a press opens nothing, and the foot says why', async ({ record, says }) => {
    const { m, pressed } = await theContextPopup(record())
    await nextTick()
    expect(button(m).disabled).toBe(true)
    expect(why(m)).toMatch(/^Not now\./)
    expect(why(m)).toContain(says)
    button(m).click()
    await nextTick()
    expect(door(m)).toBeNull()
    expect(pressed).toEqual([])
  })

  it('⛔ no capabilities read: dark, `087`’s sentence', async () => {
    const { m } = await theContextPopup(conversation([]), null)
    await nextTick()
    expect(button(m).disabled).toBe(true)
    expect(why(m)).toMatch(/^Not offered\. Not declared/)
  })

  it('⚠️ an offer withdrawn UNDER an open question shuts it — an answer to a stale question sends nothing', async () => {
    const { m, showing, pressed } = await theContextPopup(conversation([]))
    await nextTick()
    button(m).click()
    await nextTick()
    expect(door(m)).not.toBeNull()
    // ⚑ The same conversation, now waiting on the person — a card arrived while the door was open.
    showing.value = conversation([permission('req_9')])
    await nextTick()
    await nextTick()
    expect(door(m), 'the question outlived the offer').toBeNull()
    // ⛔ …and it stays shut when the offer COMES BACK: an answered card makes the press live again,
    // and a question nobody asked a second time must not reappear to be answered.
    showing.value = conversation([])
    await nextTick()
    await nextTick()
    expect(button(m).disabled).toBe(false)
    expect(door(m), 'the withdrawn question came back by itself').toBeNull()
    expect(pressed).toEqual([])
  })

  it('⛔ a DIFFERENT conversation does not inherit the open question', async () => {
    const { m, showing, pressed } = await theContextPopup(conversation([]))
    await nextTick()
    button(m).click()
    await nextTick()
    expect(door(m)).not.toBeNull()
    showing.value = conversation([], { sessionId: 'sess_2' })
    await nextTick()
    await nextTick()
    // ⚑ **W4.208 · the popup shuts with the conversation it was opened on**…
    expect(m.host.querySelector('[data-cy="context-dialog"]')).toBeNull()
    // …and opened on B it still offers the press — only the question is gone.
    await openThePopup(m)
    expect(button(m).disabled).toBe(false)
    expect(door(m), 'conversation B shows the question asked on A').toBeNull()
    expect(pressed).toEqual([])
  })

  it('⛔ the question is never amber, and its two answers do not look alike', async () => {
    const { m } = await theContextPopup(conversation([]))
    await nextTick()
    button(m).click()
    await nextTick()
    const pane = m.q('conversation-pane')
    const style = getComputedStyle(pane)
    const waiting = parseColor(style.getPropertyValue('--waiting').trim()) ?? [0, 0, 0, 1]
    for (const el of [door(m)!, ...door(m)!.querySelectorAll('*')]) {
      expect(channelGap(paintedBackground(el), waiting), el.className).toBeGreaterThan(6)
    }
    const keep = paintedBackground(m.q('compact-keep'))
    const compact = paintedBackground(m.q('compact-it'))
    expect(channelGap(keep, compact), 'the two answers are painted alike').toBeGreaterThan(30)
    expect(visible(m.q('compact-it'))).toBe(true)
  })
})

/* ================================================================ §2 · GAP-2 / GAP-3 / GAP-4 */

const MESSAGE = 'mcp__brobot__message_agent'

describe('§2 · `707` GAP-2 — the sender’s card', () => {
  it('🔴 draws *W1.1* — and a receipt written before D-016, still carrying `elsewhere`, draws the same', async () => {
    const card = async (over: object): Promise<string | undefined> => {
      const record = conversation([
        {
          type: 'tool_inventory',
          naming: { prefix: 'mcp__', separator: '__' },
          declared: {
            server: 'brobot',
            tools: [{ name: 'message_agent', description: '', parameters: [] }],
          },
          published: null,
        } as unknown as TranscriptEvent,
        {
          type: 'tool_call',
          id: 'c1',
          name: MESSAGE,
          summary: '{"text":"do it"}',
        } as TranscriptEvent,
        {
          type: 'message_sent',
          to: 'sess_pm',
          toProfile: 'pm',
          kind: 'follow-up',
          delivery: 'sent',
          onBehalfOfAPerson: false,
          piece: 'work_1',
          label: 'W1.1',
          ...over,
        } as TranscriptEvent,
        { type: 'tool_result', id: 'c1', summary: 'ok', ok: true } as TranscriptEvent,
      ])
      const m = mount(ConversationPane as Component, paneProps({ record }), { width: 1100 })
      await nextTick()
      await expandAgentCards(m)
      const said = m.q('outgoing-task').textContent?.trim()
      m.unmount()
      return said
    }
    expect(await card({ elsewhere: 'beta' })).toBe('W1.1')
    expect(await card({})).toBe('W1.1')
  })
})

const AT = 9_000_000

const given = (piece: string, label: string): WorkGivenOut => ({
  piece,
  label,
  title: 'the work',
  state: 'working',
  givenToProfile: 'worker',
  givenAt: AT - 60_000,
})

describe('§2b · `707` GAP-3 — the Work tab', () => {
  it('🔴 each row’s heading is its label alone, and no chip names a project', async () => {
    const reading: WorkGivenOutReading = {
      conversation: META.sessionId,
      walk: {
        rows: [given('work_one', 'W1.1'), given('work_two', 'W1.2')],
        walk: 'every-conversation-this-one-gave-work-to',
        ledgers: 2,
        rowsUnread: 0,
      },
      answered: true,
      at: AT,
    }
    const m = mount(SessionDrawer as never, drawerProps({ tab: 'work', work: reading }), {
      width: DRAWER_W_MIN,
      height: 800,
    })
    await nextTick()
    const heading = (piece: string) =>
      m.q(`work-row-${piece}`).querySelector('.heading')?.textContent?.trim()
    expect(heading('work_one')).toBe('W1.1')
    expect(heading('work_two')).toBe('W1.2')
    expect(m.all('work-row-project')).toEqual([])
  })
})

describe('§2c · `707` GAP-4 — *Assigned by it*', () => {
  /**
   * The graph draws given-out pieces on their holders’ cards, both in the main panel and on
   * the Team page. The right panel shows only the current agent’s card. A piece line still
   * spells its piece by label alone.
   */
  it('🔴 each line spells its piece by its label alone', async () => {
    const m = mount(
      TeamForest,
      {
        view: viewOf([
          conv(META.sessionId, null),
          conv('sess_pm', META.sessionId),
          task('sess_pm', 'work_one', 'W1.1', 'the work', META.sessionId),
          task('sess_pm', 'work_two', 'W1.2', 'the work', META.sessionId),
        ]),
      },
      { width: 1000, height: 700 },
    )
    await forestDrawn()
    const lines = m.all('forest-task-number').map((one) => one.textContent?.trim())
    expect(lines).toEqual(['W1.1', 'W1.2'])
  })
})

/* ================================================================ §3 · F-9 */

const storeHolding = (): AgentStore =>
  ({ identities: ref(null), loaded: ref(false), loadError: ref(null) }) as unknown as AgentStore

/** ⚑ The sheet behind a host whose `busy` and `error` move — the two facts the screen hands it. */
function theSheet() {
  ;(window as unknown as { api: unknown }).api = {
    runtime: {
      checkProviderAuth: () => Promise.resolve({ state: 'usable' }),
    },
  }
  const busy = ref(false)
  const error = ref<string | null>(null)
  const started: string[] = []
  const cancels: number[] = []
  const Host = defineComponent({
    name: 'SheetHost',
    setup() {
      return () =>
        h(StartAsAgent as Component, {
          profileSlug: 'pm',
          provider: 'claude',
          defaultApprovalMode: 'ask',
          capabilities: CAPABILITY_FIXTURE,
          agents: storeHolding(),
          busy: busy.value,
          error: error.value,
          onStart: (_input: unknown, text: string) => started.push(text),
          onCancel: () => cancels.push(1),
        })
    },
  })
  const m = mount(Host, {}, { width: 992, height: 808 })
  return { m, busy, error, started, cancels }
}

async function typeAndSend(m: Mounted, text: string): Promise<void> {
  const box = m.q('prompt-input') as HTMLTextAreaElement
  box.value = text
  box.dispatchEvent(new Event('input'))
  await nextTick()
  m.q('send-prompt').click()
  await nextTick()
}

describe('§3 · `710` F-9 — a refused start is drawn where the person pressed', () => {
  it('🔴 the sheet shows its own launch — the composer’s `starting`, with a Cancel that works', async () => {
    const { m, busy, started, cancels } = theSheet()
    await typeAndSend(m, 'Plan the migration.')
    expect(started).toEqual(['Plan the migration.'])
    busy.value = true
    await nextTick()
    expect(m.q('cancel-launch')).toBeTruthy()
    m.q('cancel-launch').click()
    await nextTick()
    expect(cancels).toEqual([1])
  })

  it('🔴 a refusal is drawn IN the sheet, in the host’s words, and the words come back to its box', async () => {
    const { m, busy, error } = theSheet()
    await typeAndSend(m, 'Plan the migration.')
    expect((m.q('prompt-input') as HTMLTextAreaElement).value).toBe('')
    busy.value = true
    await nextTick()
    // ⚑ The store sets the error and lowers the flag in one block — the order `forLaunch` has.
    error.value = 'Claude is not signed in on this machine.'
    busy.value = false
    await nextTick()
    await nextTick()
    expect(m.q('start-as-agent-error').textContent?.trim()).toBe(
      'Claude is not signed in on this machine.',
    )
    expect(visible(m.q('start-as-agent-refused'))).toBe(true)
    expect((m.q('prompt-input') as HTMLTextAreaElement).value).toBe('Plan the migration.')
  })

  it('🔴 a Cancel pressed IN the sheet hands the words back — a cancelled start does not eat them', async () => {
    const { m, busy } = theSheet()
    await typeAndSend(m, 'Plan the migration.')
    busy.value = true
    await nextTick()
    m.q('cancel-launch').click()
    await nextTick()
    // ⚑ A cancel is not a failure (`102`): no refusal is set, and the flag simply falls.
    busy.value = false
    await nextTick()
    await nextTick()
    expect(m.host.querySelector('[data-cy="start-as-agent-refused"]')).toBeNull()
    expect((m.q('prompt-input') as HTMLTextAreaElement).value).toBe('Plan the migration.')
  })

  it('⚑ THE CONTROL — a launch that settles WITHOUT a refusal hands nothing back and draws no box', async () => {
    const { m, busy } = theSheet()
    await typeAndSend(m, 'Plan the migration.')
    busy.value = true
    await nextTick()
    busy.value = false
    await nextTick()
    expect(m.host.querySelector('[data-cy="start-as-agent-refused"]')).toBeNull()
    expect((m.q('prompt-input') as HTMLTextAreaElement).value).toBe('')
  })
})

/* ================================================================ §4 · :9555 */

describe('§4 · the `:9555` confusion — the window’s own title follows the name the bar draws', () => {
  const INFO = {
    name: 'BroBot2',
    version: '0.0.0',
    step: 'Step 0',
    build: { id: 'dev', commit: '', dirty: false },
    db: { migrationsApplied: 1, providerSessionCount: 0 },
  }

  it('🔴 a title main composes reaches BOTH places a person reads it', async () => {
    const before = document.title
    try {
      document.title = 'BroBot2'
      const m = mount(
        AppTitleBar as Component,
        { info: { ...INFO, windowTitle: 'BroBot2 — seat-fe' }, error: null },
        { width: 1200, height: 60 },
      )
      await nextTick()
      expect(m.q('app-titlebar').textContent).toContain('BroBot2 — seat-fe')
      expect(document.title).toBe('BroBot2 — seat-fe')
    } finally {
      document.title = before
    }
  })

  it('⚑ THE CONTROL — before the read lands the page keeps the title it was given', async () => {
    const before = document.title
    try {
      document.title = 'BroBot2'
      mount(AppTitleBar as Component, { info: null, error: null }, { width: 1200, height: 60 })
      await nextTick()
      expect(document.title).toBe('BroBot2')
    } finally {
      document.title = before
    }
  })
})
