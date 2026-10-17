import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  interruptKeyLabel,
  sendKeyLabel,
} from '../../src/renderer/src/components/PromptComposer.vue'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import { ASKED_TO_STOP } from '../../src/shared/how-work-stopped'
import { agentName, type CreatedSession, type TranscriptEvent } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 739 · Draw 5, DRAWN — *Stop and send* says the turn is ASKED to stop (`737` F-7), in a real engine
 *
 * ⚑ **The finding, verbatim** (`737` §7, F-7): *"**Interrupt-and-send still claims a stop** —
 * "Stop Codex and send this instead", "to interrupt and send now"."* ⚑ **R43** (`709` §1): *"A turn
 * is `interrupted` only when the provider says it was."* — so the press asks, the words go once the
 * turn has ended (stopped, or finished first), and the words say so.
 *
 * ⚠️ **Re-aimed at `739`'s review round 1** (rule 26; `739` #2, #25, #4): the clause carries the
 * host's limit now — *"the turn is asked to stop; this is sent once it has ended, or comes back to
 * you if it has not within seconds"* — so the title is the clause and the chord, and each of the
 * three feet carries the limit too (round 0 put *"if it does not end, …"* in the title alone, and
 * the host's condition is its own bounded wait, not the turn never ending). ⚑ The feet are LONGER
 * by that clause, which is why §1 and §3 still ask that each is drawn whole — at the pane's width
 * and beside the drawer.
 *
 * | § | surface | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|---|
 * | 1 | a running Codex conversation, a draft in the box | the button's title and the foot in R43's words, the foot drawn whole at 972 px | no draft: the plain Stop, and no pair |
 * | 2 | …with a message already waiting | the person's own: the foot drawn whole; one they did not write (688 R22): the foot drawn whole — with what waits, in one turn, since D-027 | — |
 * | 3 | …beside the drawer, the narrowest the composer is drawn at | the plain foot and the longest foot, each drawn whole | — |
 * | 4 | the press | — | one send with intent `interrupt` per click and per ⇧⌘↵; ⌘↵ alone queues |
 *
 * ⚑ **Mounted through `ConversationPane`** over a record every row reached by `acceptEvent` — the
 * one door — so the state travels the hops the app uses (`record.control` → `composerState` →
 * `PromptComposer`; `record.meta.queued` → `hasQueued`) and nothing is handed
 * to the composer by the test. ⚑ At the width a conversation is drawn at beside the rail
 * (1180 − 208 = 972 px), in a window that wide, and left mounted until the test ends (the lead
 * photographs these mounts).
 *
 * ⚠️ **What `main` (5f406f2f; 176a860f before it) draws instead**, measured: the title *"Stop BroBot and send this
 * instead (⇧⌘↵)"*; the foot *"⌘↵ to send after BroBot finishes · ⇧⌘↵ to interrupt and send now"*
 * (at 972 px and beside the drawer); with a message waiting, the person's own or not, *"… before
 * queueing another, or ⇧⌘↵ to interrupt and send this now."*
 *
 * ⚠️ **`A_STOP_THEN_THIS_IS_SENT` is a NEW export of a module `main` has**, and this runner's import
 * analysis fails a WHOLE file on a specifier it cannot resolve — so it is reached by
 * `import.meta.glob`, awaited only inside subjects, as `the-stop-says-it-asks.dom.test.ts` reaches
 * `737`'s. The SSR half is `test/stop-and-send-says-it-asks.render.test.ts`.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

type StopWords = typeof import('../../src/renderer/src/lib/stop-unanswered')
const STOP_WORDS = import.meta.glob<StopWords>('../../src/renderer/src/lib/stop-unanswered.ts')

/** ⚑ The two clauses — `undefined` on a tree without the new one, and a subject then says so. */
async function theClauses(): Promise<{ asks: string | undefined; sent: string | undefined }> {
  const load = Object.values(STOP_WORDS)[0]
  if (load === undefined) throw new Error('`lib/stop-unanswered.ts` is not on this tree')
  const words = await load()
  return { asks: words.A_STOP_ASKS_THE_TURN, sent: words.A_STOP_THEN_THIS_IS_SENT }
}

const AT = 1_700_000_000_000
const RAIL_W = 208
const PANE_W = 972
const PANE_H = 900

/** ⚑ The keys the composer draws, from its own labels over this engine's platform. */
const SEND_KEY = sendKeyLabel(navigator.platform)
const INTERRUPT_KEY = interruptKeyLabel(navigator.platform)

/**
 * ⚑ R43's clause, the draw's, and its sentences — verbatim ONCE; each subject composes them too.
 * ⚠️ `739` review round 1: the host's limit is in the clause, so the title and every foot carry it.
 */
const THE_LIMIT = 'or comes back to you if it has not within seconds'
const STOP_THEN_SENT =
  'the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds'
const TITLE = `Stop and send — the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds (${INTERRUPT_KEY})`
const FOOT_TAIL = `finishes · ${INTERRUPT_KEY} is Stop and send: the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds`
const PLAIN_STOP_TITLE = 'Stop — the turn is asked to stop (Esc)'

/** ⚑ A Codex conversation — the host's echo of its provider on `meta`, as `737`'s suite builds it. */
const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
}

/** ⚑ Who the pane says is working — `agentName` over the meta's profile, as the pane asks it. */
const WHO = agentName(CODEX_META.profileId, null)
/**
 * ⚑ **D-010** — one foot while something waits, whoever wrote it. ⚑ **D-027 moved its first half**:
 * what waits no longer goes first, one turn each — this goes WITH it, in one turn, oldest first, and
 * only a command goes alone; it said *"…after <who> finishes and takes what is already waiting"*.
 * ⚠️ 15 characters longer, so §3 still asks that it is drawn whole beside the drawer.
 */
const FOOT_WAITING = `${SEND_KEY} to send when ${WHO} finishes, with what is already waiting — a command goes alone · ${INTERRUPT_KEY} is Stop and send: the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds`

const DRAFT = 'no, look at the migration first'

const started = { type: 'session', state: 'started', ref: CODEX_META.ref } as TranscriptEvent
const asked = { type: 'user_turn', text: 'count to sixty, slowly' } as TranscriptEvent
const working = { type: 'status', state: 'working' } as TranscriptEvent

/** ⚑ One row through the one door, at the next ordinal — as the store feeds a live record. */
function feed(record: SessionRecord, event: TranscriptEvent): void {
  const ordinal = record.nextOrdinal
  acceptEvent(record, { sessionId: record.sessionId, ordinal, at: AT + ordinal * 1_000, event })
}

/** ⚑ `reactive`, as the store holds a record. */
function conversation(
  events: TranscriptEvent[],
  meta: Partial<CreatedSession> = {},
): SessionRecord {
  const record = reactive(createSessionRecord('sess_1')) as SessionRecord
  record.meta = { ...CODEX_META, ...meta }
  record.phase = 'open'
  for (const event of events) feed(record, event)
  return record
}

/**
 * ⚑ A message held behind the running turn — BOTH halves the host writes for one hold: the row the
 * fold draws, and `meta.queued`, the CONTROL truth the composer reads (064). `appAuthored` is
 * `687`'s `attribution`, on both, as the host carries it.
 */
function holding(appAuthored: boolean): SessionRecord {
  const text = appAuthored ? 'Go ahead with the plan.' : 'and then run the tests'
  const attribution = appAuthored ? { attribution: 'app_authored' as const } : {}
  return conversation(
    [
      started,
      asked,
      working,
      {
        type: 'message_queued',
        messageId: 'q_1',
        kind: 'work',
        text,
        ...attribution,
      } as TranscriptEvent,
    ],
    { queued: [{ kind: 'work', id: 'q_1', text, since: AT, ...attribution }] },
  )
}

/** ⚑ The pane, at the width a conversation is drawn at beside the rail — left mounted to the end. */
async function pane(record: SessionRecord, over: Record<string, unknown> = {}): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(ConversationPane, paneProps({ record, cwd: '/work', draft: DRAFT, ...over }), {
    width: PANE_W,
    height: PANE_H,
  })
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const stopAndSendTitle = (m: Mounted): string | null =>
  m.q('interrupt-send-prompt').getAttribute('title')

/** ⚑ The foot's key hints — the `<strong>`s the foot draws the chords in. */
const keyHints = (foot: HTMLElement): string[] => [...foot.querySelectorAll('strong')].map(text)

/* ------------------------------------------------------------------ §1 */

describe('§1 · a running Codex conversation with a draft: Stop and send says the turn is asked to stop', () => {
  it('🔴 the button’s title and the foot say it in R43’s words, the host’s limit in each — the foot drawn whole at the composer’s width', async () => {
    const m = await pane(conversation([started, asked, working]))
    // ⚑ The premise, off the record the pane draws: running, a draft, so the pair is up.
    expect(visible(m.q('interrupt-send-prompt'))).toBe(true)
    expect(visible(m.q('queue-prompt'))).toBe(true)
    expect(m.all('interrupt-session')).toEqual([])
    expect((m.q('prompt-input') as HTMLTextAreaElement).value).toBe(DRAFT)

    expect(stopAndSendTitle(m)).toBe(TITLE)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(`${SEND_KEY} to send after ${WHO} ${FOOT_TAIL}`)
    // ⚑ `739` #2: the always-visible foot carries the limit, not only the hover.
    expect(text(foot)).toContain(THE_LIMIT)
    expect(keyHints(foot)).toEqual([SEND_KEY, INTERRUPT_KEY])
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the busy foot with a draft, in R43’s words', m.host)

    // ⚑ rule 5 — composed from the module's clause, and that from `737`'s and `ASKED_TO_STOP`.
    const { asks, sent } = await theClauses()
    expect(asks).toBe(`the turn is ${ASKED_TO_STOP}`)
    expect(sent).toBe(`${asks}; this is sent once it has ended, ${THE_LIMIT}`)
    expect(sent).toBe(STOP_THEN_SENT)
    expect(stopAndSendTitle(m)).toBe(`Stop and send — ${sent} (${INTERRUPT_KEY})`)
    expect(text(foot)).toBe(
      `${SEND_KEY} to send after ${WHO} finishes · ${INTERRUPT_KEY} is Stop and send: ${sent}`,
    )
  })

  it('⚑ THE CONTROL — the same conversation with NO draft: the plain Stop, titled as `737` left it, and no pair', async () => {
    const m = await pane(conversation([started, asked, working]), { draft: '' })
    expect(m.all('interrupt-send-prompt')).toEqual([])
    expect(m.all('queue-prompt')).toEqual([])
    expect(m.q('interrupt-session').getAttribute('title')).toBe(PLAIN_STOP_TITLE)
    expect(text(m.q('composer-hint'))).not.toContain('Stop and send')
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · with a message already waiting, the foot queues behind it and still says ⇧⌘↵ asks', () => {
  /**
   * ⚑ **D-010** — the person's own waiting message drew *"Cancel it … before queueing another"* and
   * one they did not write *"Wait for it to go …"* (688 R22), because a second was refused. Several
   * may wait now, so both draw the one foot: queue behind it, or Stop and send. ⚑ **D-027** — and
   * what is held goes out together, in one turn, oldest first, a command alone: the foot says
   * *"with what is already waiting — a command goes alone"*.
   */
  it('🔴 whoever wrote what waits: queue behind it, then Stop and send, limit and all — drawn whole', async () => {
    for (const notYours of [false, true]) {
      const m = await pane(holding(notYours))
      // ⚑ The premise: a message IS waiting — the transcript draws it.
      expect(m.all('queued-entry')).toHaveLength(1)
      const foot = m.q('composer-hint')
      expect(text(foot)).toBe(FOOT_WAITING)
      expect(text(foot)).toContain(THE_LIMIT)
      expect(text(foot)).not.toContain('Cancel it')
      expect(keyHints(foot)).toEqual([SEND_KEY, INTERRUPT_KEY])
      assertDrawn(foot, `the foot with a message waiting (not yours: ${String(notYours)})`, m.host)
      // ⚑ …and the button is the same Stop and send.
      expect(stopAndSendTitle(m)).toBe(TITLE)
      const { sent } = await theClauses()
      expect(text(foot).endsWith(`is Stop and send: ${sent}`)).toBe(true)
      unmountAll()
    }
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · beside the drawer — the narrowest the composer is drawn at', () => {
  it('🔴 the foot with a draft — the limit in it — is still drawn whole', async () => {
    const m = await pane(conversation([started, asked, working]), { drawerOpen: true })
    expect(visible(m.q('session-drawer'))).toBe(true)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(`${SEND_KEY} to send after ${WHO} ${FOOT_TAIL}`)
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the busy foot with a draft, beside the drawer', m.host)
  })

  it('🔴 the longer of the two feet — a message already waiting, the limit in it — is still drawn whole', async () => {
    const m = await pane(holding(true), { drawerOpen: true })
    expect(visible(m.q('session-drawer'))).toBe(true)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(FOOT_WAITING)
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the waiting foot beside the drawer', m.host)
  })
})

/* ------------------------------------------------------------------ §4 */

describe('§4 · the press is unchanged — only its words moved', () => {
  it('⚑ THE CONTROL — one send with intent `interrupt` per click and per ⇧⌘↵, the draft’s words each time; ⌘↵ alone queues', async () => {
    const sends: { text: string; intent: string }[] = []
    const m = await pane(conversation([started, asked, working]), {
      onSend: (words: string, intent: string) => sends.push({ text: words, intent }),
    })
    m.q('interrupt-send-prompt').click()
    await nextTick()
    await drawnReady()
    expect(sends).toEqual([{ text: DRAFT, intent: 'interrupt' }])

    // ⚑ The chord, where a person's is — on the box, ⇧ held. The pane owns the draft and is not
    // re-rendered by this test, so the words are still in the box for the second press.
    const box = m.q('prompt-input')
    const chord = (shiftKey: boolean): void => {
      box.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      )
    }
    chord(true)
    await nextTick()
    await drawnReady()
    expect(sends).toEqual([
      { text: DRAFT, intent: 'interrupt' },
      { text: DRAFT, intent: 'interrupt' },
    ])

    // ⚑ …one fact over: without ⇧ the same chord queues, so the reading above is the ⇧'s.
    chord(false)
    await nextTick()
    await drawnReady()
    expect(sends.map((each) => each.intent)).toEqual(['interrupt', 'interrupt', 'queue'])
  })
})
