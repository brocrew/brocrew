import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import { stopJoinsThatAsk } from '../../src/renderer/src/lib/stop-unanswered'
import { ASKED_TO_STOP } from '../../src/shared/how-work-stopped'
import { agentName, type CreatedSession, type TranscriptEvent } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, permission, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 737 · Draw 3, DRAWN — the Stop says the turn is ASKED to stop (`730` F-3), in a real engine
 *
 * ⚑ **The finding, verbatim** (`730` §8): *"The busy title **Interrupt the running turn (Esc)** and
 * the frozen **Esc stops the turn** predate R43's *asked to stop*."* ⚑ **R43** (`709` §1): *"A turn
 * is `interrupted` only when the provider says it was."* — so a press asks, and the words say so.
 *
 * | § | surface | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|---|
 * | 1 | a running Codex conversation | the Stop's title and the foot in R43's words, the foot drawn whole at the composer's width; with a message waiting, no *type to queue*; beside the drawer, drawn whole | the press is unchanged (one `interrupt` per click and per Esc); a closing conversation draws no Stop; the same conversation with an unanswered ask draws R83's words |
 * | 2 | …frozen on a permission card | the frozen title and the foot's Esc clause, drawn whole | — |
 * | 3 | …with the drawer on Open and a mode pending | what the approval mode's panel says ends at the mode — no Stop, no interrupt (737 review) | no mode pending: it names no Stop |
 *
 * ⚑ **Mounted through `ConversationPane`** over a record every row reached by `acceptEvent` — the
 * one door — so the state travels the hops the app uses (`record.control` → `composerState` →
 * `PromptComposer`; `record.meta.queued` → `hasQueued`; `record.meta` → `SessionDrawer` →
 * `SessionPanel` → `AgentCard`) and nothing is handed to a child by the test. ⚑ At the width a conversation is
 * drawn at beside the rail (1180 − 208 = 972 px), in a window that wide, and left mounted until
 * the test ends (the lead photographs these mounts).
 *
 * ⚠️ **What `main` (92209678) draws instead**, measured: the busy Stop *"Interrupt the running turn
 * (Esc)"* and foot *"<who> is working — type to queue a message, or press Esc to interrupt the
 * turn."* (with a message waiting too); the frozen Stop *"Stop the turn instead of answering
 * (Esc)"* and foot *"… but Esc stops the turn."*; the approval title *"… To stop this one now,
 * interrupt it."*
 *
 * ⚠️ **`A_STOP_ASKS_THE_TURN` is a NEW export of a module `main` has**, and this runner's import
 * analysis fails a WHOLE file on a specifier it cannot resolve — so it is reached by
 * `import.meta.glob`, awaited only inside subjects, as
 * `a-stop-the-provider-has-not-answered-drawn.dom.test.ts` reaches its module. The SSR half is
 * `test/the-stop-says-it-asks.render.test.ts`.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

type StopWords = typeof import('../../src/renderer/src/lib/stop-unanswered')
const STOP_WORDS = import.meta.glob<StopWords>('../../src/renderer/src/lib/stop-unanswered.ts')

/** ⚑ The clause the draw added — `undefined` on a tree without it, and a subject then says so. */
async function theClause(): Promise<string | undefined> {
  const load = Object.values(STOP_WORDS)[0]
  if (load === undefined) throw new Error('`lib/stop-unanswered.ts` is not on this tree')
  return (await load()).A_STOP_ASKS_THE_TURN
}

const AT = 1_700_000_000_000
const RAIL_W = 208
const PANE_W = 972
const PANE_H = 900

/** ⚑ R43's clause and the Stop's four sentences — verbatim ONCE; each subject composes them too. */
const THE_TURN_IS_ASKED_TO_STOP = 'the turn is asked to stop'
const BUSY_TITLE = 'Stop — the turn is asked to stop (Esc)'
const FROZEN_TITLE = 'Stop instead of answering — the turn is asked to stop (Esc)'
const BUSY_FOOT_TAIL =
  'is working — type to queue a message. Esc is Stop: the turn is asked to stop.'
const FROZEN_FOOT =
  "Answer the request above to continue. A message won't answer it, but Esc is Stop: the turn is asked to stop."
const PENDING_TAIL = 'that is already running.'

/** ⚑ A Codex conversation — the host's echo of its provider on `meta`, as `725`'s suite builds it. */
const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
}

/** ⚑ Who the pane says is working — `agentName` over the meta's profile, as the pane asks it. */
const WHO = agentName(CODEX_META.profileId, null)

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

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const stopTitle = (m: Mounted): string | null => m.q('interrupt-session').getAttribute('title')

/** ⚑ The foot's key hint — the `<strong>` the foot draws Esc in. */
const keyHints = (foot: HTMLElement): string[] => [...foot.querySelectorAll('strong')].map(text)

/* ------------------------------------------------------------------ §1 */

describe('§1 · a running Codex conversation: the Stop says the turn is asked to stop', () => {
  it('🔴 the Stop’s title and the foot say it in R43’s words — the foot drawn whole at the composer’s width', async () => {
    const m = await pane(conversation([started, asked, working]))
    // ⚑ The premise, off the record the pane draws: running, and a Stop is up.
    expect(m.all('interrupt-session')).toHaveLength(1)
    expect(m.all('permission-card')).toEqual([])

    expect(stopTitle(m)).toBe(BUSY_TITLE)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(`${WHO} ${BUSY_FOOT_TAIL}`)
    expect(keyHints(foot)).toEqual(['Esc'])
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the busy foot in R43’s words', m.host)

    // ⚑ rule 5 — composed from the module's clause, and the clause from `ASKED_TO_STOP`.
    const clause = await theClause()
    expect(clause).toBe(`the turn is ${ASKED_TO_STOP}`)
    expect(clause).toBe(THE_TURN_IS_ASKED_TO_STOP)
    expect(stopTitle(m)).toBe(`Stop — ${clause} (Esc)`)
    expect(text(foot)).toBe(`${WHO} is working — type to queue a message. Esc is Stop: ${clause}.`)
  })

  it('🔴 with a message already waiting (`meta.queued`), the foot still offers to queue — behind it (D-010)', async () => {
    // ⚑ The host writes both halves of one hold: the row the fold draws, and `meta.queued` — the
    // CONTROL truth the composer reads (064). Either alone would be a world the host never makes.
    const held = 'and then run the tests'
    const m = await pane(
      conversation(
        [
          started,
          asked,
          working,
          { type: 'message_queued', messageId: 'q_1', kind: 'work', text: held } as TranscriptEvent,
        ],
        { queued: [{ kind: 'work', id: 'q_1', text: held, since: AT }] },
      ),
    )
    // ⚑ The premise: a message IS waiting — the transcript draws it.
    expect(m.all('queued-entry')).toHaveLength(1)
    const foot = m.q('composer-hint')
    // ⚑ **D-010** — a second is held behind what waits, so *type to queue* is offered here too.
    expect(text(foot)).toBe(
      `${WHO} is working — type to queue a message. Esc is Stop: ${THE_TURN_IS_ASKED_TO_STOP}.`,
    )
    assertDrawn(foot, 'the busy foot with a message waiting', m.host)
    // ⚑ …and the Stop itself is the same Stop.
    expect(stopTitle(m)).toBe(BUSY_TITLE)
  })

  it('🔴 beside the drawer — the narrowest the composer is drawn at — the foot is still drawn whole', async () => {
    const m = await pane(conversation([started, asked, working]), { drawerOpen: true })
    expect(visible(m.q('session-drawer'))).toBe(true)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(`${WHO} ${BUSY_FOOT_TAIL}`)
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the busy foot beside the drawer', m.host)
  })

  it('⚑ THE CONTROL — the press is unchanged: one `interrupt` per click, and Esc sends the same one', async () => {
    const interrupts: string[] = []
    const m = await pane(conversation([started, asked, working]), {
      onInterrupt: () => interrupts.push('stop'),
    })
    m.q('interrupt-session').click()
    expect(interrupts).toEqual(['stop'])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(interrupts).toEqual(['stop', 'stop'])
  })

  it('⚑ THE CONTROL — the same conversation while it closes: no Stop, and the foot says the closing, not Esc', async () => {
    const record = conversation([started, asked, working])
    record.phase = 'closing'
    const m = await pane(record)
    expect(m.all('interrupt-session')).toEqual([])
    // ⚑ The pane's own reason outranks the busy foot (169 §1) — a positive the negatives sit beside.
    // ⚑ **D-017b · in the closing's current words** (`CLOSING_BLOCK`): *"This conversation is
    // closing"* was a process fact (`05` rule 5); the foot now says the conversation is taking up
    // the change, and still says it instead of the Esc clause.
    const foot = m.q('composer-hint')
    expect(text(foot)).toContain('this conversation is taking up the change')
    expect(text(foot)).not.toContain('Esc')
    expect(keyHints(foot)).toEqual([])
  })

  it('⚑ THE CONTROL — the same conversation with an ask Codex has not answered draws R83’s words, not these', async () => {
    const m = await pane(
      conversation([
        started,
        asked,
        working,
        { type: 'work_interrupted', by: 'a-person' },
        { type: 'stop_unanswered', waitedMs: 2_000, by: 'a-person' },
      ]),
    )
    const r83 = stopJoinsThatAsk({ by: 'a-person', waitedMs: 2_000 }, 'codex')
    expect(stopTitle(m)).toBe(`${r83} (Esc)`)
    expect(text(m.q('composer-hint'))).toBe(`${r83}. Esc is Stop; type to queue a message.`)
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · frozen on a permission card: Stop instead of answering, in R43’s words', () => {
  it('🔴 the frozen Stop’s title and the foot’s Esc clause — the foot drawn whole', async () => {
    const m = await pane(
      conversation([
        started,
        asked,
        working,
        permission('req_1'),
        { type: 'status', state: 'waiting_permission' } as TranscriptEvent,
      ]),
    )
    // ⚑ The card is up — the premise the frozen words are about.
    expect(visible(m.q('permission-card'))).toBe(true)
    expect(stopTitle(m)).toBe(FROZEN_TITLE)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(FROZEN_FOOT)
    expect(keyHints(foot)).toEqual(['Esc'])
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the frozen foot in R43’s words', m.host)

    const clause = await theClause()
    expect(clause).toBe(`the turn is ${ASKED_TO_STOP}`)
    expect(stopTitle(m)).toBe(`Stop instead of answering — ${clause} (Esc)`)
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · the approval mode, on the agent card, while a mode waits for the next message', () => {
  /** What the approval mode's panel says of the mode, once its face is pressed. */
  const approvalSays = async (m: Mounted): Promise<string> => {
    const face = m.q('card-approval')
    expect(visible(face)).toBe(true)
    face.click()
    await nextTick()
    await nextTick()
    return (m.q('card-approval-now').textContent ?? '').trim()
  }

  it('🔴 a pending mode says what the mode does, and nothing about the turn — no Stop, no interrupt', async () => {
    const m = await pane(conversation([started, asked, working], { pendingApprovalMode: 'auto' }), {
      drawerOpen: true,
      drawerTab: 'open',
    })
    const said = await approvalSays(m)
    expect(said).toBe(
      `This session asks what its provider’s own CLI asks by default. You have asked it to stop asking — that takes effect from your next message, because neither provider can change the mode of a turn ${PENDING_TAIL}`,
    )
    expect(said).not.toMatch(/Stop|interrupt/)
  })

  it('⚑ THE CONTROL — no mode pending: the mode and when a change applies, and no Stop', async () => {
    const m = await pane(conversation([started, asked, working]), {
      drawerOpen: true,
      drawerTab: 'open',
    })
    expect(await approvalSays(m)).toBe(
      'This session asks what its provider’s own CLI asks by default. Changes apply from your next message.',
    )
  })
})
