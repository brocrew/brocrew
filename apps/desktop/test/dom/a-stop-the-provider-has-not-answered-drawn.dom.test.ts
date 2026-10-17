import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import type { CreatedSession, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady, lineCount } from './drawn'
import { META, mount, paneProps, permission, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 730 · Draw 3, DRAWN — a Stop Codex has not answered, in a real engine
 *
 * ⚑ **R83, verbatim** (`730` §1) — *"A Stop the provider does not answer is said (Codex has not
 * answered the stop), and a second press joins the first ask instead of queuing another."*
 *
 * | § | surface | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|---|
 * | 1 | a Codex conversation, running, whose Stop Codex has not answered | the notice reads *Codex has not answered the stop asked for by a person*, drawn whole; the Stop's title and the composer's foot say that Stop joins that ask — the foot drawn whole at the composer's width (two lines at 820 px); beside the drawer the longest asker's foot WRAPS and is not cut | the same conversation without `stop_unanswered` draws the busy title and foot |
 * | 2 | …and then the turn ends | the Stop's words go back the moment the `turn` row lands, and the notice stays as history | — |
 * | 3 | …with a card up (`frozen`) | — | the Stop keeps the frozen words: a press there is a NEW ask |
 *
 * ⚑ **Mounted through `ConversationPane`** over a record every row reached by `acceptEvent` — the
 * one door — so the provider travels the hops the app uses (`record.meta.provider` → `TranscriptView`
 * → `NoticeEntry`; `control.stopUnanswered` → `stopUnansweredWords` → `PromptComposer`) and is never
 * handed to a child by the test. ⚑ At the width a conversation is drawn at beside the rail
 * (1180 − 208 = 972 px), in a window that wide; the composer inside it is capped by
 * `--measure-composer`.
 *
 * ⚠️ **What `main` (b9b1a4fc) draws instead**: no notice for the row at all, and the busy Stop and
 * foot (since `737` in R43's words — *"Stop — the turn is asked to stop (Esc)"*; on b9b1a4fc
 * `730` F-3's *"Interrupt the running turn (Esc)"*).
 *
 * ⚠️ **`lib/stop-unanswered.ts` is NEW, and this runner links native modules**: a static or a
 * literal dynamic `import` of a module `main` does not have fails the WHOLE file there (Vite's
 * client import analysis refuses an unresolved specifier), controls included. ⚑ So it is reached by
 * `import.meta.glob`, which matches nothing on `main` and is awaited only inside subjects.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

type Since730 = typeof import('../../src/renderer/src/lib/stop-unanswered')
const SINCE_730 = import.meta.glob<Since730>('../../src/renderer/src/lib/stop-unanswered.ts')

/** ⚑ The new module — `main` has none, and the subject that asks for it says so. */
async function since730(): Promise<Since730> {
  const load = Object.values(SINCE_730)[0]
  if (load === undefined) throw new Error('`lib/stop-unanswered.ts` is not on this tree')
  return load()
}

const AT = 1_700_000_000_000
const RAIL_W = 208
const PANE_W = 972
const PANE_H = 900

/** ⚑ R83's two sentences in a Codex conversation, verbatim ONCE — rule 5 pins them by function. */
const CODEX_HAS_NOT_ANSWERED = 'Codex has not answered the stop asked for by a person'
const CODEX_STOP_JOINS = `${CODEX_HAS_NOT_ANSWERED} — while that ask stands, Stop joins it rather than asking Codex again`

/** ⚑ The busy Stop, the frozen Stop, and the busy foot's tail — R43's words since `737`. */
// ⚑ **737 · `730` F-3** — the Stop's own words in R43's (`A_STOP_ASKS_THE_TURN`).
const BUSY_TITLE = 'Stop — the turn is asked to stop (Esc)'
const FROZEN_TITLE = 'Stop instead of answering — the turn is asked to stop (Esc)'
const BUSY_FOOT_TAIL =
  'is working — type to queue a message. Esc is Stop: the turn is asked to stop.'

/** ⚑ A Codex conversation — the host's echo of its provider on `meta`, as `725`'s suite builds it. */
const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
}

const started = {
  type: 'session',
  state: 'started',
  ref: CODEX_META.ref,
} as TranscriptEvent
const asked = { type: 'user_turn', text: 'count to sixty, slowly' } as TranscriptEvent
const working = { type: 'status', state: 'working' } as TranscriptEvent
const aPersonsAsk: TranscriptEvent = { type: 'work_interrupted', by: 'a-person' }
/** ⚑ The row as the host writes it at its default bound, for a person's Stop. */
const unanswered: TranscriptEvent = { type: 'stop_unanswered', waitedMs: 2_000, by: 'a-person' }

/** ⚑ One row through the one door, at the next ordinal — as the store feeds a live record. */
function feed(record: SessionRecord, event: TranscriptEvent): void {
  const ordinal = record.nextOrdinal
  acceptEvent(record, { sessionId: record.sessionId, ordinal, at: AT + ordinal * 1_000, event })
}

/** ⚑ `reactive`, as the store holds a record — a row fed after the mount has to reach the screen. */
function conversation(...events: TranscriptEvent[]): SessionRecord {
  const record = reactive(createSessionRecord('sess_1')) as SessionRecord
  record.meta = CODEX_META
  record.phase = 'open'
  for (const event of events) feed(record, event)
  return record
}

/** ⚑ The pane, at the width a conversation is drawn at beside the rail — left mounted to the end. */
async function pane(record: SessionRecord, over: Record<string, unknown> = {}): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(ConversationPane, paneProps({ record, cwd: '/work', ...over }), {
    width: PANE_W,
    height: PANE_H,
  })
  await nextTick()
  await drawnReady()
  return m
}

const settle = async (): Promise<void> => {
  await nextTick()
  await drawnReady()
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ The notice lines that say R83's words — found by the words, so a control can count none. */
const r83Lines = (m: Mounted): HTMLElement[] =>
  m.all('what-the-notice-says').filter((el) => text(el).includes('has not answered the stop'))

const stopTitle = (m: Mounted): string | null => m.q('interrupt-session').getAttribute('title')

/* ------------------------------------------------------------------ §1 */

describe('§1 · a running Codex conversation whose Stop Codex has not answered', () => {
  it('🔴 the notice names Codex and is drawn whole; the Stop and the foot say a press joins that ask — the foot drawn whole at the composer’s width', async () => {
    const interrupts: string[] = []
    const record = conversation(started, asked, working, aPersonsAsk, unanswered)
    const m = await pane(record, { onInterrupt: () => interrupts.push('stop') })

    // ⚑ The premise, off the record the pane draws: running, and the ask is on screen.
    expect(m.all('what-the-notice-says').map(text)).toContain('asked to stop by a person')

    // ⛔ On `main` there is no such line: the ask, and then silence.
    const lines = r83Lines(m)
    expect(lines.map(text)).toEqual([CODEX_HAS_NOT_ANSWERED])
    const line = lines[0]!
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'R83’s notice', m.host)
    expect(line.getAttribute('title')).toBe(CODEX_HAS_NOT_ANSWERED)
    expect(line.closest('[data-cy="notice-warn"]')).not.toBeNull()

    // ⛔ On `main` the Stop reads the busy title, and the foot the busy sentence.
    expect(stopTitle(m)).not.toBe(BUSY_TITLE)
    expect(stopTitle(m)).toBe(`${CODEX_STOP_JOINS} (Esc)`)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(`${CODEX_STOP_JOINS}. Esc is Stop; type to queue a message.`)
    expect(visible(foot)).toBe(true)
    // ⚑ Drawn in full at the composer's own width (`--measure-composer`, 820 px here): at the 12 px
    // floor the sentence is wider than that, so it takes two lines and none of it is cut. The foot
    // wraps, so a longer asker wraps rather than is cut (§1b).
    assertDrawn(foot, 'the composer’s foot with R83’s words', m.host)
    expect(foot.getBoundingClientRect().width).toBeLessThanOrEqual(820)
    expect(lineCount(foot)).toBe(2)
    expect(getComputedStyle(foot).whiteSpace).toBe('normal')

    // ⚑ The press itself is unchanged: ONE `interrupt`, and the join is the host's (`723` §2).
    m.q('interrupt-session').click()
    expect(interrupts).toEqual(['stop'])
    // ⚑ …and *Esc is Stop*, as the foot says: the key sends the same one.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(interrupts).toEqual(['stop', 'stop'])

    // ⚑ rule 5 — the words are the module's, for this fact and this conversation's provider.
    const { stopJoinsThatAsk, stopUnansweredSays } = await since730()
    const fact = { by: 'a-person' as const, waitedMs: 2_000 }
    expect(text(line)).toBe(stopUnansweredSays(fact, 'codex'))
    expect(stopTitle(m)).toBe(`${stopJoinsThatAsk(fact, 'codex')} (Esc)`)
  })

  it('🔴 the longest asker, with the drawer open — the narrowest the composer is drawn at: the foot WRAPS and is drawn in full', async () => {
    // ⚑ *a caller this app has no word for* is a real value of the row (`WhoStoppedIt`), and it is
    // the longest; the drawer beside the transcript is the narrowest the composer gets at 972 px.
    const record = conversation(
      started,
      asked,
      working,
      { type: 'work_interrupted', by: 'a-caller-this-app-cannot-name' },
      { type: 'stop_unanswered', waitedMs: 2_000, by: 'a-caller-this-app-cannot-name' },
    )
    const m = await pane(record, { drawerOpen: true })
    const says = 'Codex has not answered the stop asked for by a caller this app has no word for'
    expect(r83Lines(m).map(text)).toEqual([says])
    assertDrawn(r83Lines(m)[0]!, 'R83’s notice beside the drawer', m.host)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(
      `${says} — while that ask stands, Stop joins it rather than asking Codex again. Esc is Stop; type to queue a message.`,
    )
    expect(visible(foot)).toBe(true)
    // ⚑ Narrower than the pane's own composer, and too narrow for the sentence on one line…
    expect(foot.getBoundingClientRect().width).toBeLessThan(820)
    expect(lineCount(foot), 'the foot did not wrap beside the drawer').toBeGreaterThan(1)
    // ⚑ …so it wraps, and every word of it is drawn.
    assertDrawn(foot, 'the composer’s foot beside the drawer', m.host)
  })

  it('⚑ THE CONTROL — the same conversation without `stop_unanswered` draws the busy Stop and foot, and no such line', async () => {
    const m = await pane(conversation(started, asked, working, aPersonsAsk))
    expect(m.all('what-the-notice-says').map(text)).toContain('asked to stop by a person')
    expect(r83Lines(m)).toEqual([])
    expect(stopTitle(m)).toBe(BUSY_TITLE)
    const foot = m.q('composer-hint')
    expect(text(foot).endsWith(BUSY_FOOT_TAIL)).toBe(true)
    expect(visible(foot)).toBe(true)
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · the turn ends — the Stop’s words go with the ask, the notice stays', () => {
  it('🔴 a `turn` row puts the busy words back on the Stop at once; `idle` then takes the Stop away; the notice is history', async () => {
    const record = conversation(started, asked, working, aPersonsAsk, unanswered)
    const m = await pane(record)
    // ⚑ The premise — the words are up — asserted, so the clear is not read off nothing.
    expect(stopTitle(m)).toBe(`${CODEX_STOP_JOINS} (Esc)`)

    // ⚑ Codex ends the turn in its own word; no `idle` yet, so the composer is still `busy`.
    feed(record, { type: 'turn', state: 'interrupted' } as TranscriptEvent)
    await settle()
    expect(stopTitle(m)).toBe(BUSY_TITLE)
    expect(text(m.q('composer-hint')).endsWith(BUSY_FOOT_TAIL)).toBe(true)
    expect(r83Lines(m).map(text)).toEqual([CODEX_HAS_NOT_ANSWERED])

    // ⚑ …and then idle: no Stop at all, and the notice is still in the conversation.
    feed(record, { type: 'status', state: 'idle' } as TranscriptEvent)
    await settle()
    expect(m.all('interrupt-session')).toEqual([])
    expect(m.all('send-prompt')).toHaveLength(1)
    const lines = r83Lines(m)
    expect(lines.map(text)).toEqual([CODEX_HAS_NOT_ANSWERED])
    expect(visible(lines[0]!)).toBe(true)
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · with a card up the Stop is a NEW ask, and keeps the frozen words', () => {
  it('⚑ THE CONTROL — frozen on a permission card: the frozen title and foot, never R83’s', async () => {
    const record = conversation(
      started,
      asked,
      working,
      aPersonsAsk,
      unanswered,
      permission('req_1'),
      { type: 'status', state: 'waiting_permission' } as TranscriptEvent,
    )
    const m = await pane(record)
    // ⚑ The card is up — the positive the negatives below sit beside.
    expect(visible(m.q('permission-card'))).toBe(true)
    expect(stopTitle(m)).toBe(FROZEN_TITLE)
    const foot = text(m.q('composer-hint'))
    expect(foot).toBe(
      "Answer the request above to continue. A message won't answer it, but Esc is Stop: the turn is asked to stop.",
    )
    expect(foot).not.toContain('has not answered')
  })
})
