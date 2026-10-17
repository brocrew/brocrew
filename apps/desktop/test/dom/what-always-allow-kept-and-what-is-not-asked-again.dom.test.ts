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
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 739 · Draw 1, DRAWN — what *Always allow* KEPT beside what is only *not asked again*, in a real engine
 *
 * ⚑ **The findings, verbatim.** `736` §12 **F-1**: *"disclose kept grants apart from conversation
 * grants: the header chip and `GRANTS_END_WITH_THE_CONVERSATION` would be false of a kept Codex
 * tool"*. `730` §8 **F-1**: *"After *Allow for this conversation*, the conversation header draws
 * *"⚠ always allowed: mcp__github__create_issue"* … The grant ends with the conversation."*
 *
 * | § | surface | 🔴 subject (RED on `main` 8a52dfd8, by assertion) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 2 | Info, a Codex conversation holding one conversation grant AND one kept grant | the conversation group's *not asked again* row and the agent group's *kept beyond this conversation* row, each fold opened and drawn whole — the kept note naming the file | — |
 *
 * The conditional header band and its two marks are absent, keeping header height consistent
 * between conversations.
 *
 * ⚑ **Mounted through `ConversationPane`** over a record every row reached by `acceptEvent` — the one
 * door — so the kept list travels the hop the app uses (`record.control` → `SessionDrawer`'s own →
 * `SessionInfo`) and nothing is handed to a child by the test. ⚑ At the width a conversation is drawn at beside the
 * rail (1180 − 208 = 972 px), in a window that wide, with the drawer open on Info, and left mounted
 * until the test ends (the lead photographs these mounts).
 *
 * ⚠️ **What `main` (8a52dfd8, with `740` and `741`; 176a860f before them) draws instead**, measured:
 * Info's conversation group listing both under *always allowed* with no kept row in the agent's.
 *
 * ⚠️ **Re-aimed at `739`'s review round 2** (rule 26): the kept note's sentence says *whose launch
 * applies that file* and *beyond the provider's own safety checks* (`KEPT_BEYOND_IT_SAYS`) — since
 * `740` a Claude project's file the repository carries, in a folder not yet trusted, is read and not
 * applied. The SSR suite re-aimed its Claude premise onto `740`'s measured card; this one draws
 * Codex's MCP tool only, whose shape `740` did not move.
 *
 * ⚠️ **`standing-grants.ts` is on `main`; its `739` exports are not** — so they are reached by
 * `import.meta.glob`, awaited only inside subjects AFTER the drawing was asserted, as
 * `the-stop-says-it-asks.dom.test.ts` reaches its clause. The SSR half — every premise one fact over
 * (a refused keep, a Deny, a conversation grant alone, Claude's kept rule, `740`'s file) — is
 * `test/what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

type StandingGrants = typeof import('../../src/renderer/src/lib/standing-grants')
const STANDING_GRANTS = import.meta.glob<StandingGrants>(
  '../../src/renderer/src/lib/standing-grants.ts',
)

/** ⚑ The module's words — the `739` exports are `undefined` on a tree without them. */
async function standingGrants(): Promise<StandingGrants> {
  const load = Object.values(STANDING_GRANTS)[0]
  if (load === undefined) throw new Error('`lib/standing-grants.ts` is not on this tree')
  return load()
}

const AT = 1_700_000_000_000
const RAIL_W = 208
const PANE_W = 972
const PANE_H = 900

/* ------------------------------------------------------------------ the words, verbatim ONCE */

const NOT_ASKED_AGAIN = 'not asked again'
const KEPT_BEYOND_THIS_CONVERSATION = 'kept beyond this conversation'
/**
 * ⚑ **D-017b · both lifetimes, neither by a close** — *ends when it is closed … outlives it* named a
 * close no person makes any more (the End conversation press is gone).
 */
const HOW_THESE_GRANTS_END =
  'This conversation no longer asks before running these — whatever the arguments. BroCrew cannot take ' +
  'them back. One allowed for this conversation may be asked about again later; one kept with ' +
  '“Always allow” is not.'
const KEPT_BEYOND_IT_SAYS =
  'Kept with “Always allow” in this conversation, each in the file named beside it: a later ' +
  'conversation whose launch applies that file is not asked about what it covers, beyond the ' +
  'provider’s own safety checks. BroCrew cannot take them back. Listed from the part of this ' +
  'conversation this window has loaded.'

/* ------------------------------------------------------------------ the conversation */

const SERVER = 'github'
const CREATE = 'create_issue'
const LIST = 'list_issues'
const CREATE_LISTED = `mcp__${SERVER}__${CREATE}`
const LIST_LISTED = `mcp__${SERVER}__${LIST}`
/** ⚑ The file `736`'s Codex adapter names for an MCP *Always allow* — typed, not imported. */
const KEPT_FILE = '/homes/codex/brobot-kept-tool-approvals.json'
const KEPT_SAID = `every ${CREATE} call on ${SERVER}`

/** ⚑ A Codex conversation — the host's echo of its provider on `meta`. */
const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
  config: { ...META.config, home: '/homes/codex', homeEnv: 'CODEX_HOME', model: 'gpt-5' },
}

/**
 * ⚑ **Codex's own MCP tool card, as `736`'s adapter publishes it** where Codex offers `session` and
 * `always`: the rule `{kind:'tool', tool, server}` for both standing buttons, the kept file in the
 * conversation's home — the shape `when-codex-asks-to-run-an-mcp-tool` pins to main's host.
 */
function mcpCard(id: string, tool: string): TranscriptEvent {
  const rule = { kind: 'tool' as const, tool, server: SERVER }
  return {
    type: 'permission_request',
    id,
    kind: 'command',
    action: tool,
    detail: `${SERVER} · ${tool}`,
    cancelStopsNothing: true,
    mcpToolCall: { server: SERVER, tool, parameters: [{ name: 'title', value: 'the bug' }] },
    scope: {
      paths: [],
      networkHosts: [],
      persistence: 'always',
      grants: { allow_all_for_session: [rule], allow_always: [rule], alwaysFile: KEPT_FILE },
      amendments: [],
      availableDecisions: ['allow', 'allow_all_for_session', 'allow_always', 'deny', 'cancel'],
      underDisclosed: true,
      approvalMode: 'ask',
    },
  }
}

const decided = (
  requestId: string,
  outcome: Extract<TranscriptEvent, { type: 'user_decision' }>['outcome'],
): TranscriptEvent => ({ type: 'user_decision', requestId, outcome, by: { who: 'a-person' } })

const asked: TranscriptEvent = { type: 'user_turn', text: 'file the bug you found' }

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
 * ⚑ **`list_issues` allowed for this conversation, then `create_issue` kept with *Always allow*** —
 * and `blanketGrants` as the Codex adapter lists them after both presses (`mcpCalls.grant`).
 */
const BOTH = (): SessionRecord =>
  conversation(
    [
      asked,
      mcpCard('req_1', LIST),
      decided('req_1', 'allow_all_for_session'),
      mcpCard('req_2', CREATE),
      decided('req_2', 'allow_always'),
    ],
    { blanketGrants: [LIST_LISTED, CREATE_LISTED] },
  )

/** ⚑ The pane at the width a conversation is drawn at beside the rail, drawer open on Info — left mounted. */
async function pane(record: SessionRecord): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(
    ConversationPane,
    paneProps({ record, cwd: '/work', drawerOpen: true, drawerTab: 'info' }),
    { width: PANE_W, height: PANE_H },
  )
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ A note's own lines — each child block, as the engine lays them out one under another. */
const linesOf = (note: HTMLElement): string[] => [...note.children].map(text)

/** ⚑ The `<dt>` a row's value sits under — the label a person reads beside it. */
function labelOver(value: HTMLElement): string {
  const dt = value.closest('dd')?.previousElementSibling
  expect(dt?.tagName, 'the value is not in a <dd> after its <dt>').toBe('DT')
  return text(dt!)
}

/** ⚑ Which of Info's two groups heads this element. */
const headedBy = (el: Element): string | undefined =>
  (el.closest('[data-subject]') as HTMLElement | null)?.dataset.subject

/* ------------------------------------------------------------------ §2 */

describe('§2 · Info: the conversation’s row and the agent’s, each fold opened and drawn whole', () => {
  it('🔴 *not asked again* under this conversation, *kept beyond this conversation* under the agent — and the kept note names its file', async () => {
    const record = BOTH()
    const m = await pane(record)
    const grants = m.q('info-grants')
    // ⛔ `main`: both tools here, under *always allowed*, and no kept row at all.
    expect(text(grants)).toBe(LIST_LISTED)
    expect(labelOver(grants)).toBe(NOT_ASKED_AGAIN)
    expect(headedBy(grants)).toBe('conversation')
    const kept = m.q('info-kept')
    expect(text(kept)).toBe(KEPT_SAID)
    expect(labelOver(kept)).toBe(KEPT_BEYOND_THIS_CONVERSATION)
    expect(headedBy(kept)).toBe('agent')
    for (const [el, what] of [
      [grants, 'the not-asked-again row'],
      [kept, 'the kept row'],
    ] as const) {
      expect(visible(el), what).toBe(true)
      assertDrawn(el, what, m.host)
    }

    // ⚑ The folds, pressed as a person presses them.
    m.q('info-why-grants').click()
    m.q('info-why-kept').click()
    await nextTick()
    const grantsNote = m.q('info-note-grants')
    expect(text(grantsNote)).toBe(HOW_THESE_GRANTS_END)
    const keptNote = m.q('info-note-kept')
    // ⚑ The sentence, then one line per kept grant — read line by line, as a person reads them.
    expect(linesOf(keptNote)).toEqual([KEPT_BEYOND_IT_SAYS, `${KEPT_SAID} — in ${KEPT_FILE}`])
    expect(headedBy(keptNote)).toBe('agent')
    for (const [el, what] of [
      [grantsNote, 'how these grants end'],
      [keptNote, 'what a kept grant is, and its file'],
    ] as const) {
      expect(visible(el), what).toBe(true)
      assertDrawn(el, what, m.host)
    }

    const said = await standingGrants()
    expect(text(grantsNote)).toBe(said.HOW_THESE_GRANTS_END)
    expect(labelOver(grants)).toBe(said.NOT_ASKED_AGAIN)
    expect(labelOver(kept)).toBe(said.KEPT_BEYOND_THIS_CONVERSATION)
    const [one] = said.keptInThisConversation(record.control.items)
    expect(linesOf(keptNote)).toEqual([said.KEPT_BEYOND_IT_SAYS, said.keptAndWhere(one!)])
  })
})
