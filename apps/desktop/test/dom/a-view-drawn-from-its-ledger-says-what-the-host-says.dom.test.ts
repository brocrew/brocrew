import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { createAttachmentBook, draftKey } from '../../src/renderer/src/lib/drafts'
import { createSessionStore } from '../../src/renderer/src/lib/session-store'
import type { SessionRecord } from '../../src/renderer/src/lib/session-record'
import {
  ANSWERED_IN_THE_OTHER_WINDOW,
  ANSWERED_ONCE_A_WINDOW_TAKES_IT,
  TAKE_IT_OVER_TO_ANSWER_HERE,
} from '../../src/renderer/src/lib/taking-over'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import {
  HELD_ELSEWHERE,
  type AgentIdentity,
  type ResumedSession,
  type RuntimeBridge,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { META, mount, paneProps, permission, record, unmountAll, visible } from './harness'
import type { Mounted } from './harness'

/**
 * # D-017b · a view drawn from its ledger says what the host says, and a live one says what it is
 *
 * A conversation nothing runs here opens in the ONE full view, drawn from the host's recorded
 * hand-over (`ConversationPane` over a record whose phase is `recorded`). Its own fold is a page of
 * the ledger, not the present, so the pane takes what the host handed over instead of what the fold
 * would say: whether a message from here can continue it (`cannotTakeAMessage`), whether anything
 * set here would reach it (`settingsFixed`), which state its row draws (`listedState`), whether a
 * message is already starting it (`launching`), and whose window answers a card it holds
 * (`turnsTakenWithoutThisWindow`). `RuntimeScreen` is what hands the pane those.
 *
 * Every section below carries a control in the same test: the same fact one step over, mounted the
 * same way, so an absence is never asserted against a view that draws nothing. The live control is
 * a conversation this window is fed (phase `open`), which must NOT take any of the host's words.
 *
 * What this file cannot say: `RuntimeScreen` is not mounted (it needs the whole app around it), so
 * its wiring of the pane is read as text at the end, as `a-stop-a-modal-cannot-cover.dom.test.ts`
 * reads it. A census of text says the binding is written; the mounts above say what it does.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/** Derived from `tokens.css`, not chosen: `--app-min-w` and `--rail-w`. */
const APP_MIN_W = 1180
const RAIL_W = 208
/** The box a conversation is really given: the app at its floor, and the app as it opens. */
const PANE_WIDTHS = [APP_MIN_W - RAIL_W, 1200 - RAIL_W] as const
const PANE_H = 808

const words = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const SESSION_ID = 'sess_ledger'
const CWD = '/Users/alex/dev/brobot-2'
const ADA = 'Ada'

const identity = (slug: string, displayName: string | null): AgentIdentity => ({
  id: `agp:default:${slug}`,
  slug,
  displayName,
  createdAt: 1_700_000_000_000,
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})
const IDS: AgentIdentity[] = [identity('ada', ADA)]

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent
const at = (ordinal: number, event: TranscriptEvent): RuntimeEventMessage => ({
  sessionId: SESSION_ID,
  ordinal,
  at: 1_700_000_000_000 + ordinal * 1_000,
  event,
})

/** One user turn, one reply, and a permission the provider asked and nobody answered. */
const ENTRIES: RuntimeEventMessage[] = [
  at(0, ev({ type: 'user_turn', text: 'rebuild the orders index, then tell me what broke' })),
  at(1, ev({ type: 'assistant_message', text: 'Rebuilding it now, one command first.' })),
  at(2, permission('req_1')),
  at(3, ev({ type: 'status', state: 'waiting_permission' })),
]

/** What a test says about the hand-over it asks the store to adopt; every field is optional. */
interface Handed {
  /** Where the recorded life stopped. Present as `liveFrom: undefined` it is OMITTED, as the host does. */
  liveFrom?: number | undefined
  /** The host's word on why a message from here cannot continue it. */
  cannot?: string
  /** Whether anything set here would reach the conversation. */
  settingsFixed?: boolean
  entries?: RuntimeEventMessage[]
}

/**
 * A press on a conversation nothing runs, through the renderer store's own door: `store.look` over
 * a bridge that answers as the host does, with a `recorded` hand-over of its ledger. Nothing is
 * started; the store adopts what it is handed, and the record it holds is what the pane draws.
 */
async function looked(over: Handed = {}): Promise<SessionRecord> {
  const entries = over.entries ?? ENTRIES
  const handed: Record<string, unknown> = {
    ...META,
    sessionId: SESSION_ID,
    profileId: 'ada',
    cwd: CWD,
    ref: { provider: 'claude', sessionId: 'thread-ledger', cwd: '/x', rotation: 0 },
    handover: 'recorded',
    history: {
      entries,
      from: 0,
      hasOlder: false,
      turnAligned: true,
      atTail: true,
      behind: 0,
    },
    liveFrom: 'liveFrom' in over ? over.liveFrom : ENTRIES.length,
  }
  // The host omits `liveFrom` for a conversation something runs with no owner: there is nothing to
  // settle, because its page is the present.
  if (handed.liveFrom === undefined) delete handed.liveFrom
  if (over.cannot !== undefined) handed.cannotTakeAMessage = over.cannot
  if (over.settingsFixed !== undefined) handed.settingsFixed = over.settingsFixed
  const store = createSessionStore({
    onEvent: () => () => {},
    onLiveness: () => () => {},
    look: () => Promise.resolve(handed as unknown as ResumedSession),
  } as unknown as RuntimeBridge)
  expect(await store.look(SESSION_ID), store.lookError.value ?? 'the look answered null').toBe(
    SESSION_ID,
  )
  // The premise: drawn from its ledger, and not fed. Nothing runs it here.
  const drawn = store.get(SESSION_ID)
  expect(drawn?.phase).toBe('recorded')
  expect(store.isLive(SESSION_ID)).toBe(false)
  return drawn!
}

interface Seen {
  sent: unknown[][]
  interrupts: number[]
  takeItOver: number[]
}

/**
 * The full view under a parent that HOLDS its draft, as the app's screen does: the composer's text
 * is the caller's, so a mount that did not write `update:draft` back would send whatever the DOM
 * happened to hold. Extra props are spread last, so a test overrides anything it names.
 */
function view(
  drawn: SessionRecord,
  props: Record<string, unknown> = {},
  box: { width: number; height?: number } = { width: PANE_WIDTHS[1], height: PANE_H },
): { m: Mounted; seen: Seen } {
  const seen: Seen = { sent: [], interrupts: [], takeItOver: [] }
  const draft = ref('')
  const handing = createAttachmentBook().handing(draftKey(drawn.sessionId))
  const Host = defineComponent({
    name: 'FullViewHost',
    setup() {
      return () =>
        h(ConversationPane as Component, {
          record: drawn,
          cwd: CWD,
          identities: IDS,
          mode: 'normal',
          debug: false,
          drawerOpen: false,
          drawerTab: 'open',
          // ⚑ UI-012 · what the screen hands every conversation: a model pick, carried out.
          pickModel: () => Promise.resolve(),
          capabilities: null,
          draft: draft.value,
          handing,
          'onUpdate:draft': (text: string) => {
            draft.value = text
          },
          onSend: (...args: unknown[]) => seen.sent.push(args),
          onInterrupt: () => seen.interrupts.push(1),
          onTakeItOver: () => seen.takeItOver.push(1),
          ...props,
        })
    },
  })
  return { m: mount(Host, {}, box), seen }
}

/** A conversation this window is fed: the harness's own record, phase `open`. */
const liveRecord = (events: TranscriptEvent[]): SessionRecord => {
  const live = record(events)
  expect(live.phase).toBe('open')
  return live
}

/** The harness's default record: a permission card asked, and the conversation waiting on it. */
const liveWithACard = (): SessionRecord => paneProps().record as SessionRecord

/** Type into the composer the way a person does: set the value, and tell the box it was input. */
async function typeInto(m: Mounted, text: string): Promise<void> {
  const box = m.q('prompt-input') as HTMLTextAreaElement
  box.value = text
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

const isDisabled = (el: HTMLElement): boolean => (el as HTMLButtonElement).disabled
const WORDS = 'go ahead and rebuild it'

/* ================================================================ 1 · the composer */

describe('the composer of a view drawn from its ledger', () => {
  it('the composer of a view drawn from its ledger is live above a card nobody here can answer, and the same card on a live conversation freezes it', async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    // The host handed this over for a conversation something runs with no owner: no `liveFrom`, so
    // the card it asked stays open, and no window here can answer it.
    const { m, seen } = view(await looked({ liveFrom: undefined }))
    await settle()
    // The premise: the card is drawn, so the composer below is live over it and not over nothing.
    expect(m.all('permission-card')).toHaveLength(1)
    const box = m.q('prompt-input') as HTMLTextAreaElement
    expect(visible(box)).toBe(true)
    expect(box.disabled).toBe(false)
    await typeInto(m, WORDS)
    expect(isDisabled(m.q('send-prompt'))).toBe(false)
    expect(m.all('interrupt-session')).toHaveLength(0)
    expect(words(m.q('composer-hint'))).not.toContain('Answer the request above')
    m.q('send-prompt').click()
    await settle()
    expect(seen.sent).toHaveLength(1)
    expect(seen.sent[0]?.[0]).toBe(WORDS)

    // The control, one fact over: the same card on a conversation this window is fed freezes it.
    const control = view(liveWithACard())
    await settle()
    expect(control.m.all('permission-card')).toHaveLength(1)
    expect((control.m.q('prompt-input') as HTMLTextAreaElement).disabled).toBe(true)
    // A frozen turn is one to abandon, so the slot Send holds is Stop's: the way out is drawn, and
    // the way to send is not.
    expect(visible(control.m.q('interrupt-session'))).toBe(true)
    expect(control.m.all('send-prompt')).toHaveLength(0)
    expect(words(control.m.q('composer-hint'))).toContain('Answer the request above to continue')
    expect(control.seen.sent).toHaveLength(0)
  })

  it("the host's refusal is said in place of Send on a view drawn from its ledger, in the host's own words, and a view told nothing sends", async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    const APP_CANNOT = 'This app cannot start that conversation again.'

    // C, the control: the same view with no refusal. It sends, and says neither sentence.
    const told = view(await looked({}))
    await settle()
    await typeInto(told.m, WORDS)
    expect(isDisabled(told.m.q('send-prompt'))).toBe(false)
    expect(words(told.m.q('composer-hint'))).not.toContain(HELD_ELSEWHERE)
    expect(words(told.m.q('composer-hint'))).not.toContain(APP_CANNOT)
    told.m.q('send-prompt').click()
    await settle()
    expect(told.seen.sent).toHaveLength(1)
    expect(told.seen.sent[0]?.[0]).toBe(WORDS)

    // A, another window holds it (and no `liveFrom`); B, settled, and this app cannot start it again.
    const refused: { name: string; says: string; over: Handed }[] = [
      {
        name: 'another window holds it',
        says: HELD_ELSEWHERE,
        over: { liveFrom: undefined, cannot: HELD_ELSEWHERE },
      },
      { name: 'this app cannot start it again', says: APP_CANNOT, over: { cannot: APP_CANNOT } },
    ]
    for (const { name, says, over } of refused) {
      const { m, seen } = view(await looked(over))
      await settle()
      await typeInto(m, WORDS)
      expect(visible(m.q('prompt-input')), `${name}: the box is gone`).toBe(true)
      expect(words(m.q('composer-hint')), `${name}: the hint`).toContain(says)
      expect(isDisabled(m.q('send-prompt')), `${name}: Send is lit`).toBe(true)
      m.q('send-prompt').click()
      await settle()
      expect(seen.sent, `${name}: the press reached onSend`).toHaveLength(0)
    }
  })

  it('while a message is starting the conversation the composer is busy with a Stop the pane emits, and with nothing starting there is none', async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    // The message that continues it is in flight: the box is busy, and the way out is a Stop.
    const starting = view(await looked(), { launching: true })
    await settle()
    expect(visible(starting.m.q('interrupt-session'))).toBe(true)
    expect(words(starting.m.q('composer-hint'))).toContain('is working')
    expect((starting.m.q('prompt-input') as HTMLTextAreaElement).disabled).toBe(false)
    starting.m.q('interrupt-session').click()
    await settle()
    expect(starting.seen.interrupts).toHaveLength(1)
    // A second message waits behind the start.
    await typeInto(starting.m, WORDS)
    expect(starting.m.all('queue-prompt')).toHaveLength(1)

    // The control: the same view with nothing starting has no Stop, and sends.
    const idle = view(await looked())
    await settle()
    expect(idle.m.all('interrupt-session')).toHaveLength(0)
    expect(idle.m.all('send-prompt')).toHaveLength(1)
    expect(words(idle.m.q('composer-hint'))).toContain('to send')
  })
})

/* ================================================================ 2 · the plate and the controls */

describe('what the header and the drawer say of a view drawn from its ledger', () => {
  const plateOf = (m: Mounted): HTMLElement =>
    m.q('session-header').querySelector<HTMLElement>('[data-cy="agent-state"]')!

  it("a view drawn from its ledger draws the host's state on its plate, and a live conversation draws its own", async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    // 1: its row says active, and the plate says so. This is also the proof the probe can read
    // *working* at all, so the two negatives below cannot pass on a plate that never draws.
    const said = view(await looked(), { listedState: { is: 'active' } })
    await settle()
    expect(plateOf(said.m)).not.toBeNull()
    expect(visible(plateOf(said.m))).toBe(true)
    expect(plateOf(said.m).dataset.doing).toBe('working')

    // 2: told nothing, its own fold answers.
    const told = view(await looked())
    await settle()
    expect(plateOf(told.m).dataset.doing).toBe('idle')

    // 3: a conversation this window is fed draws its own fold, and ignores its row.
    const running = view(liveRecord([ev({ type: 'status', state: 'idle' })]), {
      listedState: { is: 'active' },
    })
    await settle()
    expect(plateOf(running.m)).not.toBeNull()
    expect(plateOf(running.m).dataset.doing).not.toBe('working')
    expect(plateOf(running.m).dataset.doing).toBe('idle')
  })

  it("the controls on a view are statements where the host says nothing set there would reach it, told nothing counts as saying so, and a live conversation's never are", async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    const open = { drawerOpen: true, drawerTab: 'open' }
    const box = { width: PANE_WIDTHS[1], height: PANE_H }
    const controls = async (
      drawn: SessionRecord,
    ): Promise<{ picker: boolean; mode: HTMLElement }> => {
      const { m } = view(drawn, open, box)
      await settle()
      // ⚑ UI-012 · the agent card mounts the model picker only where a pick reaches the
      // conversation; the approval mode says whether its panel offers a change.
      return {
        picker: m.host.querySelector('[data-cy="model-picker"]') !== null,
        mode: m.q('card-approval'),
      }
    }

    // R3 and L first: the controls ARE offered, so the statements below are not a drawer that
    // draws nothing. R3 is a host that said they reach it; L is a live conversation, whose meta
    // carries no `settingsFixed` at all (the phase guard's control).
    const reaches = await controls(await looked({ settingsFixed: false }))
    expect(reaches.picker).toBe(true)
    expect(reaches.mode.dataset.changeable).toBe('true')
    const live = await controls(liveRecord([ev({ type: 'status', state: 'idle' })]))
    expect(live.picker).toBe(true)
    expect(live.mode.dataset.changeable).toBe('true')

    // R1: the host said nothing set here would reach it. R2: it said nothing at all, and a record
    // its own fold moved to `recorded` still holds the last life's meta, which says nothing either.
    for (const [name, over] of [
      ['told it is fixed', { settingsFixed: true }],
      ['told nothing', {}],
    ] as const) {
      const fixed = await controls(await looked(over))
      expect(fixed.picker, `${name}: the model picker`).toBe(false)
      expect(fixed.mode.dataset.changeable, `${name}: the approval mode`).toBe('false')
      expect((fixed.mode as HTMLInputElement).disabled, name).toBe(true)
      expect(fixed.mode.closest('label')?.title, `${name}: why`).toContain('can’t be changed')
    }
  })
})

/* ================================================================ 3 · the cards */

describe('a card held in a view drawn from its ledger', () => {
  it('a card on a view no window feeds says who answers it, one press takes the conversation over, and the same card live offers Allow', async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    // L, the control: the same card on a conversation this window is fed offers Allow.
    const live = view(liveWithACard())
    await settle()
    expect(live.m.all('permission-allow')).toHaveLength(1)
    expect(visible(live.m.q('permission-allow'))).toBe(true)
    expect(live.m.all('permission-answered-elsewhere')).toHaveLength(0)
    expect(live.m.all('permission-take-it-over')).toHaveLength(0)

    // A: no window holds the conversation, so one press takes it.
    const none = view(await looked({ liveFrom: undefined }))
    await settle()
    expect(none.m.all('permission-card')).toHaveLength(1)
    const said = none.m.q('permission-answered-elsewhere')
    expect(visible(said)).toBe(true)
    expect(words(said.querySelector('.after'))).toBe(ANSWERED_ONCE_A_WINDOW_TAKES_IT)
    expect(visible(none.m.q('permission-take-it-over'))).toBe(true)
    expect(words(none.m.q('permission-take-it-over'))).toBe(TAKE_IT_OVER_TO_ANSWER_HERE)
    expect(none.m.all('permission-allow')).toHaveLength(0)
    none.m.q('permission-take-it-over').click()
    await settle()
    expect(none.seen.takeItOver).toHaveLength(1)

    // B: another window holds it. It says so, and offers no press: switching windows is not ours.
    const other = view(await looked({ liveFrom: undefined, cannot: HELD_ELSEWHERE }))
    await settle()
    expect(other.m.all('permission-card')).toHaveLength(1)
    expect(visible(other.m.q('permission-answered-elsewhere'))).toBe(true)
    expect(words(other.m.q('permission-answered-elsewhere').querySelector('.after'))).toBe(
      ANSWERED_IN_THE_OTHER_WINDOW,
    )
    expect(other.m.all('permission-take-it-over')).toHaveLength(0)
    expect(other.m.all('permission-allow')).toHaveLength(0)
    expect(other.seen.takeItOver).toHaveLength(0)
  })

  it('a message held in a view drawn from its ledger offers no Cancel, and the same held message on a live conversation does', async () => {
    await page.viewport(PANE_WIDTHS[1] + RAIL_W, PANE_H)
    const held: RuntimeEventMessage[] = [
      at(0, ev({ type: 'user_turn', text: 'rebuild the orders index' })),
      at(1, ev({ type: 'assistant_message', text: 'Rebuilding it now.' })),
      at(2, ev({ type: 'message_queued', text: 'when you get a moment', messageId: 'msg_held' })),
    ]
    // The control: this window is fed it, so the held message is one it can take back.
    const live = view(liveRecord(held.map((entry) => entry.event)))
    await settle()
    expect(live.m.all('queued-entry')).toHaveLength(1)
    expect(words(live.m.q('queued-entry'))).toContain('not sent')
    expect(live.m.all('cancel-queued')).toHaveLength(1)
    expect(visible(live.m.q('cancel-queued'))).toBe(true)

    // Drawn from its ledger with no `liveFrom`, the row stays waiting, and Cancel is not offered.
    const recorded = view(await looked({ liveFrom: undefined, entries: held }))
    await settle()
    expect(recorded.m.all('queued-entry')).toHaveLength(1)
    expect(words(recorded.m.q('queued-entry'))).toContain('not sent')
    expect(recorded.m.all('cancel-queued')).toHaveLength(0)
  })
})

/* ================================================================ 4 · the screen's wiring */

/** `RuntimeScreen`'s own source: nothing mounts it, so its wiring of the pane is read as text. */
async function screenSource(): Promise<string> {
  return (
    (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')) as {
      default: string
    }
  ).default
}

/** From `start` to the first line that is exactly `end`; each is asserted found first. */
function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  expect(from, `nothing starts with ${start}`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  expect(to, `nothing ends ${start} with ${end.trim()}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('what RuntimeScreen hands the pane, read as text', () => {
  it("RuntimeScreen hands the pane the host's word, the start it is making and the take-over press: the census of its bindings", async () => {
    const screen = await screenSource()
    // The pane on the conversation surface: from its opening tag to the line that closes it.
    const panes = [...screen.matchAll(/<ConversationPane\b[\s\S]*?\/>/g)]
    expect(panes).toHaveLength(1)
    const pane = panes[0]![0]
    expect(pane).toContain(`v-else-if="surface === 'conversation' && active?.meta"`)
    expect(pane).toContain(':launching="store.isLaunching(active.sessionId)"')
    expect(pane).toContain(':listed-state="listedStateOfActive"')
    expect(pane).toContain('@interrupt="stopIt"')
    expect(pane).toContain('@take-it-over="activeId && openConversation(activeId)"')
    // The word it hands is its row's state, in the one list, and null while the list names nothing.
    const listed = slice(screen, 'const listedStateOfActive = computed(', '\n)\n')
    expect(listed).toContain('rail.value?.listedOf(active.value.sessionId)?.state ?? null')
  })

  it('hands the link scope the resolver and opening door, and the archive its retained page', async () => {
    const screen = await screenSource()
    const scopes = [...screen.matchAll(/<MessageLinks\b[^>]*>/g)].map(([tag]) => tag)
    // The archived history is a page inside the window's own scope, so there is one.
    expect(scopes).toEqual([
      '<MessageLinks :resolve="resolveMessageLink" :open="openMessageDestination">',
    ])
    const archives = [...screen.matchAll(/<LinkedHistory\b[\s\S]*?\/>/g)]
    expect(archives).toHaveLength(1)
    // The page is retained data; only paging leaves it, and Back is the window's own.
    expect(
      [...archives[0]![0].matchAll(/:([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
    ).toEqual([
      ['key', 'linkedHistory.sessionId'],
      ['history', 'linkedHistory.history'],
      ['title', 'linkedHistory.title'],
      ['load-older', 'olderLinkedHistory'],
    ])
  })

  it('stopIt cancels a start it is making and interrupts what runs, and neither arm has gone', async () => {
    const screen = await screenSource()
    const body = slice(screen, 'function stopIt(): void {', '\n}\n')
    const asks = body.indexOf('store.isLaunching(sessionId)')
    const cancels = body.indexOf('void store.cancelLaunch(sessionId)')
    const interrupts = body.indexOf('else void store.interrupt(sessionId)')
    // Presence first, then the order the arms are read in.
    expect(asks).toBeGreaterThan(-1)
    expect(cancels).toBeGreaterThan(-1)
    expect(interrupts).toBeGreaterThan(-1)
    expect(asks).toBeLessThan(cancels)
    expect(cancels).toBeLessThan(interrupts)
    // One interrupt, in the else arm: a plant that makes both arms interrupt cannot pass.
    expect(body.split('void store.interrupt(sessionId)')).toHaveLength(2)
  })

  it("a recorded conversation on screen is looked at again when it moved, and let go when it leaves the screen: the census of the screen's watches", async () => {
    const screen = await screenSource()
    const again = slice(screen, 'function lookAgainIfItMoved(): void {', '\n}\n')
    expect(again).toContain("record?.phase !== 'recorded' || record.meta === null")
    expect(again).toContain('listed.updatedAt === record.meta.liveness.since')
    expect(again).toContain('listed.inAnotherWindow === toldItWasElsewhere')
    expect(again).toContain("void store.look(sessionId, 'again')")
    // It is asked after the list refreshes, which is when the row can have moved.
    expect(screen).toContain('void rail.value?.refreshResumable().then(lookAgainIfItMoved)')

    // A recorded conversation is held only while it is on screen.
    const leaves = slice(screen, 'watch(onScreenNow, (_now, was) => {', '\n)\n')
    expect(leaves).toContain('if (was !== null) store.forget(was)')
    expect(screen).toContain(
      'if (!now.includes(sessionId) && sessionId !== onScreenNow.value) store.forget(sessionId)',
    )
  })
})
