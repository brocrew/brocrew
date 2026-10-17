import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { attentionQueue, type AttentionRequest } from '../../src/renderer/src/lib/attention'
import { ALLOW_FOR_THIS_CONVERSATION } from '../../src/renderer/src/lib/permission-offer'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import { whatThisAnswerDoes } from '../../src/renderer/src/lib/user-input-offer'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 739 · Draw 3, DRAWN — the conversation grant says what its rule covers (`726` F-14, R94)
 *
 * ⚑ **The finding, verbatim** (`726` §9, F-14): *"On a read outside the folder, the grant is the
 * CLI's own suggestion: a DIRECTORY rule, measured. The card says *"this, and the same thing
 * again"*. It is the provider's own semantics (R92), but the words understate it"*. ⚑ **R94**
 * (`739` §1): *"a grant is the CLI's own suggested rule for the ask, and the card's words say what
 * the rule covers."*
 *
 * | § | surface | 🔴 subject | ⚑ control, one fact over |
 * |---|---|---|---|
 * | 1 | a Claude conversation at 972 px, frozen on a read outside the folder | the line under *Allow for this conversation* names the folder in the CLI's words, and the `conversation grant` row says it — both drawn whole | the same card with no `grants` (a row before `736`): `main`'s line, drawn whole, and no `conversation grant` row |
 * | 2 | Home at 972 px | the effect under *Allow for this conversation* names the folder, and the scope line says it — both drawn whole | the same card with no `grants`: `main`'s line |
 *
 * ⚑ **Mounted through `ConversationPane`** over a record every row reached by `acceptEvent` — the one
 * door — so the card travels the hops the app uses (`record.transcript` → `TranscriptView` →
 * `PermissionCard`) and is never handed to the card by the test. ⚑ At the width a conversation is
 * drawn at beside the rail (1180 − 208 = 972 px), in a window that wide, and left mounted until the
 * test ends (the lead photographs these mounts). ⚑ Home's row is the real projection
 * (`attentionQueue`) over the same kind of record, mounted as wide.
 *
 * ⚑ **The card is `739`'s render suite's literal**, which that suite's §0 pins to the card the REAL
 * `ClaudeRuntime` publishes for a read outside the folder with the CLI's own suggestion
 * (`Read(//elsewhere/**)`): a browser cannot run the adapter, so a literal that drifted from it goes
 * red there. ⚑ The expected lines are typed out here, once each — an oracle computed from the thing
 * it checks is not an oracle.
 *
 * ⚠️ **What `main` (5f406f2f) draws instead, measured**: under the conversation grant on the card
 * and on Home, *"the agent may do this, and what the provider’s own rule for it covers, for this
 * conversation"*; and the disclosure *"for this conversation, its grant covers:
 * Read(//elsewhere/**)"*. ⚑ No export `main` lacks is imported here, so every control runs there.
 * The SSR half, with the person's queue and the rule's words, is
 * `test/what-a-conversation-grant-covers-said.render.test.ts`.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** ⚑ Asked forty seconds ago — so the frozen header reads as a live card does. */
const ASKED_AT = Date.now() - 40_000
const RAIL_W = 208
const PANE_W = 972
const PANE_H = 900

/* ------------------------------------------------------------------ the words, verbatim ONCE */

/** ⚑ `main`'s line under the conversation grant — kept where no rule is carried. */
const MAINS_LINE =
  'the agent may do this, and what the provider’s own rule for it covers, for this conversation'
/** ⚑ The CLI's own row for a read outside the folder (`736` §1), with the rule kept beside it. */
const READ_SAID = 'reading from /elsewhere (Read(//elsewhere/**))'
/** ⚑ The line under the conversation grant where the card names its rule. */
const THE_LINE = `the agent may do this, and for this conversation what the provider’s own rule for it covers: ${READ_SAID}`
/** ⚑ The card's and Home's disclosure. */
const DISCLOSED = `for this conversation, its grant covers: ${READ_SAID}`

/* ------------------------------------------------------------------ the card */

type PermissionRequest = Extract<TranscriptEvent, { type: 'permission_request' }>

/** ⚑ A Claude read outside the folder — the render suite's literal, pinned there to the adapter. */
const READ_OUTSIDE: PermissionRequest = {
  type: 'permission_request',
  id: 'tu_read',
  kind: 'command',
  action: 'Read',
  detail: '/elsewhere/n.txt',
  scope: {
    cwd: '/tmp/x',
    paths: ['/elsewhere/n.txt'],
    networkHosts: [],
    persistence: 'session',
    grants: { allow_for_session: [{ kind: 'tool', tool: 'Read', content: '//elsewhere/**' }] },
    amendments: [],
    availableDecisions: ['allow', 'allow_for_session', 'deny', 'cancel'],
    underDisclosed: false,
    approvalMode: 'ask',
  },
}

/** ⚑ The same card with no `grants` — a row written before `736`, one fact over. */
function withoutGrants(card: PermissionRequest): PermissionRequest {
  const { grants: _dropped, ...scope } = card.scope
  void _dropped
  return { ...card, scope }
}

/* ------------------------------------------------------------------ mounting */

/** ⚑ One row through the one door, at the next ordinal — as the store feeds a live record. */
function feed(record: SessionRecord, event: TranscriptEvent): void {
  const ordinal = record.nextOrdinal
  acceptEvent(record, { sessionId: record.sessionId, ordinal, at: ASKED_AT, event })
}

/** ⚑ A Claude conversation that asked something, ran, and is now frozen on the card. */
function frozenOn(card: PermissionRequest, sessionId = 'sess_1'): SessionRecord {
  const record = createSessionRecord(sessionId)
  record.meta = { ...META, sessionId }
  record.phase = 'open'
  for (const event of [
    { type: 'session', state: 'started', ref: META.ref },
    { type: 'user_turn', text: 'what is in the notes over in /elsewhere?' },
    { type: 'status', state: 'working' },
    card,
    { type: 'status', state: 'waiting_permission' },
  ] as TranscriptEvent[])
    feed(record, event)
  return record
}

/** ⚑ The pane, at the width a conversation is drawn at beside the rail — left mounted to the end. */
async function pane(card: PermissionRequest): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(ConversationPane, paneProps({ record: frozenOn(card), cwd: '/work' }), {
    width: PANE_W,
    height: PANE_H,
  })
  await nextTick()
  await drawnReady()
  return m
}

/** ⚑ Home's row for the request, through the real projection over a record folded by `acceptEvent`. */
function homeRow(card: PermissionRequest): AttentionRequest {
  const rows = attentionQueue([frozenOn(card, 'sess_home')], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

/** ⚑ Home's queue, as wide as the page beside the rail — left mounted to the end. */
async function home(row: AttentionRequest): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(AttentionQueue, { requests: [row], now: ASKED_AT + 40_000 }, { width: PANE_W })
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ The word on a button — its `<strong>`. */
const wordOf = (button: HTMLElement): HTMLElement => {
  const strong = button.querySelector<HTMLElement>('strong')
  expect(strong, 'the button has no word').not.toBeNull()
  return strong!
}

/** ⚑ Home's line under its conversation grant — the one button whose word is its word. */
function homesGrantLine(m: Mounted): HTMLElement {
  const buttons = m
    .all('attention-decide-sess_home')
    .filter((button) => text(wordOf(button)) === ALLOW_FOR_THIS_CONVERSATION)
  expect(buttons, 'Home draws one conversation grant').toHaveLength(1)
  const line = buttons[0]!.querySelector<HTMLElement>('[data-cy="attention-effect"]')
  expect(line, 'no line under the conversation grant').not.toBeNull()
  return line!
}

/** ⚑ What Home's projection says under the conversation grant — the other surface of the join. */
function homeSays(card: PermissionRequest): string {
  const grant = homeRow(card).decisions.find(
    (one) => one.kind === 'permission' && one.decision.outcome === 'allow_for_session',
  )
  if (grant === undefined) throw new Error('Home offers no conversation grant')
  return whatThisAnswerDoes(grant)
}

/* ------------------------------------------------------------------ §1 · the conversation */

describe('§1 · a Claude conversation at 972 px, frozen on a read outside the folder', () => {
  it('🔴 the line under *Allow for this conversation* names the folder in the CLI’s words, and the `conversation grant` row says it — each drawn whole', async () => {
    const m = await pane(READ_OUTSIDE)
    // ⚑ The premise, off the pane: the card is up, asking for the read, with its grant.
    expect(visible(m.q('permission-card'))).toBe(true)
    const button = m.q('permission-allow_for_session')
    expect(text(wordOf(button))).toBe('Allow for this conversation')
    expect(visible(button)).toBe(true)

    const line = m.q('permission-does-allow_for_session')
    // ⛔ `main`: *"… what the provider’s own rule for it covers, for this conversation"*.
    expect.soft(text(line)).toBe(THE_LINE)
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'the line under the conversation grant', m.host)
    // ⚑ The join: the card's line is the line Home's projection says for the same request.
    expect(text(line)).toBe(homeSays(READ_OUTSIDE))

    const covers = m.q('permission-grant-covers')
    // ⛔ `main`: *"for this conversation, its grant covers: Read(//elsewhere/**)"*.
    expect.soft(text(covers)).toBe(DISCLOSED)
    expect(visible(covers)).toBe(true)
    assertDrawn(covers, 'the `conversation grant` row', m.host)
  })

  it('⚑ THE CONTROL — the same card with no `grants` (a row before `736`) keeps `main`’s line, drawn whole, and no `conversation grant` row', async () => {
    const m = await pane(withoutGrants(READ_OUTSIDE))
    expect(visible(m.q('permission-card'))).toBe(true)
    const line = m.q('permission-does-allow_for_session')
    expect(text(line)).toBe(MAINS_LINE)
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'the line under the conversation grant', m.host)
    expect(text(line)).toBe(homeSays(withoutGrants(READ_OUTSIDE)))
    // ⚑ No disclosure row — beside a reading the same card does hold: its persistence.
    expect(m.all('permission-grant-covers')).toEqual([])
    expect(text(m.q('permission-persistence'))).toBe('session')
  })
})

/* ------------------------------------------------------------------ §2 · Home */

describe('§2 · Home at 972 px — the same request’s row', () => {
  it('🔴 the effect under *Allow for this conversation* names the folder, and the scope line says it — each drawn whole', async () => {
    const m = await home(homeRow(READ_OUTSIDE))
    const line = homesGrantLine(m)
    // ⛔ `main`: *"… what the provider’s own rule for it covers, for this conversation"*.
    expect.soft(text(line)).toBe(THE_LINE)
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'Home’s line under the conversation grant', m.host)

    const scope = [...m.q('attention-scope').querySelectorAll<HTMLElement>('li')]
    const said = scope.filter((one) => text(one).startsWith('for this conversation, its grant'))
    expect(said, 'Home says what the grant covers once').toHaveLength(1)
    // ⛔ `main`: *"for this conversation, its grant covers: Read(//elsewhere/**)"*.
    expect.soft(text(said[0]!)).toBe(DISCLOSED)
    expect(visible(said[0]!)).toBe(true)
    assertDrawn(said[0]!, 'Home’s scope line for the grant', m.host)
  })

  it('⚑ THE CONTROL — the same card with no `grants`: `main`’s line, drawn whole, and no scope line for the grant', async () => {
    const m = await home(homeRow(withoutGrants(READ_OUTSIDE)))
    const line = homesGrantLine(m)
    expect(text(line)).toBe(MAINS_LINE)
    expect(visible(line)).toBe(true)
    assertDrawn(line, 'Home’s line under the conversation grant', m.host)
    const scope = [...m.q('attention-scope').querySelectorAll<HTMLElement>('li')].map(text)
    expect(scope.filter((one) => one.startsWith('for this conversation, its grant'))).toEqual([])
    // ⚑ …beside the line the same list does hold: the grant lasts the conversation.
    expect(scope).toContain('for the whole conversation, not just this action')
  })
})
