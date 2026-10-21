import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { CreatedSession } from '../src/shared/runtime-ipc'
import SessionHeader from '../src/renderer/src/components/SessionHeader.vue'
import SessionDrawer from '../src/renderer/src/components/SessionDrawer.vue'
import { createTranscript } from '../src/renderer/src/lib/transcript'
import { createWindow } from '../src/renderer/src/lib/transcript-window'
import SessionInfo from '../src/renderer/src/components/SessionInfo.vue'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import {
  ANOTHER_CALLER_IS_ON_IT,
  ANOTHER_CALLER_MAY_REACH_IN,
  NOT_ASKED_AGAIN,
} from '../src/renderer/src/lib/standing-grants'
import type { AttentionRequest } from '../src/renderer/src/lib/attention'

/**
 * 🔴 **349 §3b · HO-006 §4.5 — the disclosure, on the two surfaces that already exist.**
 *
 * > **340:** `commandedBy` is not on `UnclaimedSession`, **and a person taking a session over is
 * > not told an agent can still drive it.**
 * > **HO-006:** *"That is a surface implying a state that is not true, which is criterion 9."*
 *
 * ⛔ **A conversation an agent commissioned does not stop being the agent's when a person takes it
 * over.** `SessionSlot.commandedBy` is `readonly` and fixed at reservation — 340 made it so
 * deliberately, and `release`'s docblock says *"there is no line that could write it"* — so the
 * caller that asked for the work can go on sending into it before the claim, during it, and after
 * the claiming window has gone. **A person handed a turn they did not start, on a screen that said
 * nothing about anybody else being able to start one, is criterion 9.**
 *
 * ⚠️ **These are SSR renders — no DOM, no clicks, no computed styles** (086). So every negative
 * assertion below is paired with a positive one on the same component: `not.toContain` alone also
 * passes against a component that rendered nothing at all.
 *
 * ## 🔴 529 — the disclosure moved surface, and this file moved with it
 *
 * ⛔ **`HO-050` §1.2: *Controls are things you press. Info is things you read.*** The paragraph
 * *"states and does not offer"* by its own docblock, so it is `SessionInfo`'s now and the hook is
 * `info-has-a-commander`. ⚑ **Every assertion below was RE-AIMED rather than stripped** — the
 * repair `520` relay 2 named: *stripping alone would have been the worst repair available; the
 * test would have gone GREEN with the world changed underneath it.* ⚠️ So the stopped pairing,
 * the paragraph slice and the id-leak sweep all still run, one component over, and a new negative
 * says the sentence is not on the agent card, where the controls are now, as a second copy.
 *
 * ⚑ **D-017b · the `ended` gate is gone** — a conversation is never ended, and a message from that
 * caller continues one nothing runs — so the pairing now says the disclosure is drawn whatever the
 * process state.
 *
 * Info and Home state that an agent can still drive the conversation. The header has no
 * conditional mark, keeping its height consistent; it remains in the id-leak sweep because an
 * identifier could still reach it.
 */

const SESSION: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work',
  providerHome: '/homes/claude',
  profileId: 'default',
  ref: null,
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'claude-opus-5',
    authNote: null,
    files: [],
  },
  instructions: {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'Asks before consequential actions',
  blanketGrants: [],
  planNeedsGoAhead: false,
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  queued: [],
  liveness: { state: 'live', since: 1_700_000_000_000 },
  hasACommander: false,
  // 523 · a conversation a window started: it is not handed back, it is ended.
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

const header = (session: CreatedSession): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(SessionHeader as never, {
          session,
          status: 'idle',
          debug: false,
          facets: { doing: 'idle' as const, being: 'live' as const },
        }),
    }),
  )

/** The place a person presses: the agent card, on the drawer's Open tab. */
const controls = (session: CreatedSession): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(SessionDrawer as never, {
          session,
          state: createTranscript(),
          shown: createTranscript(),
          mode: 'normal',
          window: createWindow(),
          sessionRef: null,
          status: 'idle',
          fixed: false,
          recorded: false,
          capabilities: null,
          waiting: 0,
          tab: 'open',
          fit: 'docked',
          facets: { doing: 'idle' as const, being: 'live' as const },
          work: null,
          identities: null,
        }),
    }),
  )

/**
 * ⚑ **The surface the disclosure lives on since 529**, and an INDEX since `527` — the sentence is
 * behind that row's *what this is*, so an SSR render shows the row and its summary line and not
 * the paragraph. ⚑ **D-017b · it takes no `ended`** — the panel draws the same rows whatever the
 * process state; `sessionRef` is the fixture's own fact and reaches neither row.
 */
const info = (session: CreatedSession): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () => h(SessionInfo as never, { session, sessionRef: null }),
    }),
  )

/** One waiting permission, as `attentionQueue` projects one. */
const REQUEST: AttentionRequest = {
  key: 'sess_1:perm_1',
  sessionId: 'sess_1',
  requestId: 'perm_1',
  itemId: 'item_1',
  kind: 'permission',
  where: 'work',
  hasACommander: false,
  provider: 'claude',
  profileId: 'default',
  who: 'default',
  standing: 'waiting: permission',
  asked: 'run: touch a file',
  scope: ['write /work/out.txt'],
  underDisclosed: false,
  detailOmitted: null,
  // ⚑ **487 · this fixture's request CAN be allowed**, so there is no sentence about why not.
  noPositive: null,
  decisions: [{ kind: 'permission', label: 'Allow', decision: { outcome: 'allow' } }],
  limit: null,
  at: 1_700_000_000_000,
  sent: false,
  refused: null,
}

const queue = (over: Partial<AttentionRequest> = {}): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(AttentionQueue as never, { requests: [{ ...REQUEST, ...over }], alone: true }),
    }),
  )

describe('349 §3b · a person taking a conversation over is told an agent can still drive it', () => {
  it('⚑ D-017b · Info says it on a conversation nothing runs, since a message from that caller continues it', async () => {
    // 🔴 **The inverse of what this test pinned before D-017b, and on purpose.** It was *criterion 9
    // pointed the other way*: every verb the surfaces named was refused once the session was
    // over. ⚑ **Nothing is over now** — a stop is not an ending, and a caller's message to a
    // conversation nothing runs starts it again — so the capability is there either way, and a
    // surface that hid it on a stopped conversation would imply a state that is not true.
    //
    // ⚠️ **The grant stays in the fixture** (529): it is the OTHER row on `527`'s index, and it is
    // what proves the panel drew independently of the commander row.
    const commanded = { ...SESSION, hasACommander: true, blanketGrants: ['Bash'] }
    const stoppedInfo = await info(commanded)
    expect(stoppedInfo).toContain('data-cy="info-has-a-commander"')
    expect(stoppedInfo).toContain('data-cy="info-grants"')
    expect(stoppedInfo).toContain('data-cy="session-subject-conversation"')
    // ⚑ **563 · and the row is read, not counted.** A hook says the cell is in the markup —
    // `not.toBeNull()` spelled for a string — and an empty `<span data-cy="info-grants"></span>`
    // satisfies it. ⛔ The grant is the thing a person is being told about, so the pair is the
    // WORD in the cell and the label over it.
    expect(/data-cy="info-grants"[^>]*>([^<]*)</.exec(stoppedInfo)?.[1]).toBe('Bash')
    // ⚠️ **739 · re-aimed, not stripped** (rule 26): the label over the cell is *not asked again*
    // (`NOT_ASKED_AGAIN`) — `730` F-1: *"the conversation header draws "⚠ always allowed: …" … The
    // grant ends with the conversation."* ⛔ Read off the `<dt>` ELEMENT, not the render: the
    // template's own comment says *not asked again* too, and would satisfy a bare `toContain`.
    expect(stoppedInfo).toMatch(new RegExp(`<dt\\b[^>]*>${NOT_ASKED_AGAIN}</dt>`))

    // ⛔ **The pairing, so the positives are about `hasACommander` and not about a panel that
    // draws the row for everything**: the same panel without a commander does not.
    expect(await info({ ...SESSION, blanketGrants: ['Bash'] })).not.toContain(
      'data-cy="info-has-a-commander"',
    )
  })

  it('⛔ the Info surface says what it means for what a person may answer', async () => {
    const commanded = await info({ ...SESSION, hasACommander: true })
    expect(commanded).toContain('data-cy="info-has-a-commander"')
    // ⚑ **The sentence that matters is `a-person-must-answer`'s, said before the refusal rather
    // than after it** — an agent can give this conversation work, and cannot decide what that work
    // is allowed to do. ⛔ **Read out of THE PARAGRAPH and not out of the render**: an assertion over
    // a document holding the paragraph and a neighbour that says the same would be satisfied by the
    // neighbour and would survive this paragraph being deleted.
    // ⛔ **The sentence is behind this row's fold since `527` made the panel an index**, and an
    // SSR render draws a collapsed `v-if` as nothing — so the CLAUSES are asserted against the
    // constant and the ROW against the render. ⚠️ The pair is what stops either half being
    // vacuous: a constant nothing renders, or a row with no words in it.
    const paragraph = commanded.slice(commanded.indexOf('data-cy="info-has-a-commander"'))
    expect(paragraph).toContain('data-cy="info-why-commander"')
    expect(paragraph).toContain(ANOTHER_CALLER_IS_ON_IT)
    for (const clause of [
      'It can go as far as',
      'sending messages here and stopping what this conversation is doing',
      'not decide what that',
      'work is allowed to do',
    ]) {
      expect(ANOTHER_CALLER_MAY_REACH_IN, clause).toContain(clause)
    }
    expect(ANOTHER_CALLER_MAY_REACH_IN).not.toContain('is a grant a person made')
    // ⚑ **D-017** — nothing ends a conversation, so the paragraph promises no ending.
    expect(ANOTHER_CALLER_MAY_REACH_IN).not.toContain('ending it')
    // ⛔ …and the summary line carries NONE of them, which is the boundary `529` drew: the line
    // says a caller exists, the paragraph says what it may do.
    expect(ANOTHER_CALLER_IS_ON_IT).not.toContain('sending messages')

    const ordinary = await info(SESSION)
    expect(ordinary).toContain('data-cy="session-info"')
    expect(ordinary).not.toContain('data-cy="info-has-a-commander"')

    // 🔴 **529 · and it did not stay behind.** ⛔ A move that leaves the old block rendering is
    // how a sentence ends up with two homes and one of them stops being edited — the defect
    // `the-layer-a-file-belongs-to.test.ts` counts copies for. ⚠️ Paired with the positive, so
    // this is about the paragraph and not about a card render that produced nothing.
    const stillControls = await controls({ ...SESSION, hasACommander: true })
    expect(stillControls).toContain('data-cy="card-approval"')
    // ⚑ **563 · the reading the card owes those two negatives.** `data-cy="card-approval"` is an
    // existence positive; the mode a person reads there is what makes the negatives about words.
    expect(stillControls.replace(/<!--[\s\S]*?-->/g, '')).toMatch(
      /data-cy="card-approval"[^>]*data-mode="ask"[^>]*>/,
    )
    const mode = stillControls.match(/<input[^>]*data-cy="card-approval"[^>]*>/)?.[0]
    expect(mode).toContain('role="switch"')
    expect(mode).not.toMatch(/\schecked(?:\s|=|>)/)
    expect(stillControls).not.toContain('has-a-commander')
    expect(stillControls).not.toContain('Another caller')
  })

  it('🔴 the surface a person ANSWERS from says it too, and Home is that surface', async () => {
    // ⛔ **The one gesture the disclosure is about, performed outside the conversation.** A person
    // can allow or deny from Home without ever opening the conversation — the pill and the
    // Approvals note are both inside one — so this row is where *"an agent can give this
    // conversation work, but not decide what that work is allowed to do"* is actually decided.
    const commanded = await queue({ hasACommander: true })
    expect(commanded).toContain('data-cy="attention-has-a-commander"')
    expect(commanded).toContain('supplied the work this conversation is doing')

    // ⛔ **The pairing**: the same row, one field over, still draws its card and its decision — so
    // the negative is about this line and not about a queue that rendered nothing.
    const ordinary = await queue()
    expect(ordinary).toContain('data-cy="attention-asked"')
    expect(ordinary).toContain('data-cy="attention-decide-sess_1"')
    expect(ordinary).not.toContain('data-cy="attention-has-a-commander"')
  })

  it('⚠️ neither surface is GIVEN an owner id, and neither renders one', async () => {
    // ⛔ **085's rule, and the reason the wire field is a fact rather than an identity.** The
    // commander is an `ownerId` — `agent:sess_…`, `webContents:3` — and there is no spawn-tree UI
    // to resolve one into a name (the PO deferred it). `CreatedSession` therefore carries
    // `hasACommander` and not `commandedBy`; the id stays on `UnclaimedSession`, which no screen
    // reads.
    //
    // 🔴 **This is the assertion that can fail, and it is first for that reason.** Neither
    // component is handed an id at all, so the sweep below cannot see a leak today — what it
    // guards is a future edit that puts one on this surface. The move that would make such a leak
    // possible is the wire type growing the id, and this is what watches for it.
    expect(Object.keys(SESSION)).not.toContain('commandedBy')
    expect(typeof SESSION.hasACommander).toBe('boolean')
    // ⚠️ **The comments come out first, and that is the instrument rather than a convenience.**
    // Both templates ARGUE about `commandedBy` and `ownerId` at length, and Vue's SSR keeps an HTML
    // comment verbatim — so a search over the raw render would find every word this test forbids,
    // in prose nobody can read on a screen. A census that cannot tell code from the paragraph
    // explaining it measures the paragraph.
    const rendered = (await header({ ...SESSION, hasACommander: true })).concat(
      await controls({ ...SESSION, hasACommander: true }),
      await info({ ...SESSION, hasACommander: true }),
    )
    const shown = rendered.replaceAll(/<!--[\s\S]*?-->/g, '')
    // ⛔ **The strip is checked in both directions before anything is concluded from it**: it really
    // removed something, and it really left the disclosure standing. Without the second line the
    // loop below would pass over an empty string.
    expect(shown.length).toBeLessThan(rendered.length)
    // ⛔ **One marker from EACH component, because `shown` is all THREE of them concatenated**
    // (529 added the third), so a single marker would be supplied by whichever one happened to
    // render and would say nothing about the others. ⚑ The header's is its title's words — since
    // 2026-10-01 it says nothing about a commander. ⛔ The words, not the title's hook: a hook is a
    // presence, and this block's one reading.
    // ⚠️ **634 · a LITERAL, and it is not belt-and-braces.** ⛔ `a-mount-is-not-a-reading.test.ts`
    // cannot see a reading in an assertion whose argument is an identifier — so this block's
    // absences below would sit unpaired, which is `556`'s rule firing correctly on a green change.
    expect(shown).toContain('>work</h1>')
    expect(shown).toContain('data-cy="card-approval"')
    expect(shown).toContain('data-cy="info-has-a-commander"')
    for (const leak of ['webContents:', 'mcp:', 'commandedBy', 'ownerId']) {
      expect(shown).not.toContain(leak)
    }
    // ⚑ **714 re-aimed the `agent:` arm to the ID's shape.** R41 (`712` F-4) labels the Info tab's
    // home line *agent: Ada* — a WORD and a space — and the literal `agent:` read that as a leak. ⛔ An
    // owner id is `agent:` and the id with no space between, which is what is refused now; the
    // planted id below is the proof the pattern still finds one.
    const AN_OWNER_ID = /\bagent:(?!\s)/
    expect(AN_OWNER_ID.test('commanded by agent:sess_7')).toBe(true)
    expect(AN_OWNER_ID.test(shown)).toBe(false)
  })
})
