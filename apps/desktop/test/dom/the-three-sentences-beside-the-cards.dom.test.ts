import { agentCardSides } from './harness'
import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import ReadingPane from '../../src/renderer/src/components/ReadingPane.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import type { AgentIdentity, LibraryEntry, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { createWindow, openAt } from '../../src/renderer/src/lib/transcript-window'
import { META, mount, paneProps, record, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 667 · The three sentences beside the new cards — read as TEXT on a real screen
 *
 * Check the three sentences beside approved cards. Their correctness depends on meaning that
 * types alone cannot verify:
 *
 * | | ⛔ before | ⚑ after |
 * |---|---|---|
 * | §1 G3 | *"the reply to task_… did not reach sess_…: no-conversation"* | *"the reply to Task #3 did not reach Pam: that conversation was not running"* — ⚑ **D-017 · R14**: *"…: something went wrong on the way — <what failed>"*, `no-conversation` being no longer written; ⚑ **D-016**: *"the reply to W1.3 …"*, a piece's label in the number's place |
 * | §2 G4 | *"ada to claude"* · *"claude to ada"* on a recording | *"Ada to this conversation"* · *"This conversation to Ada"* — ⚑ **678**: *"Ada to BroBot"* on a recording of ours, `671` having put its `profileId` on the entry |
 * | §3 G5 | *"dev to Dev"* for an unnamed agent launched as `Dev` | *"dev to dev"*, the same as one launched as `dev` |
 *
 * ## ⚑ Why a DOM file
 *
 * ⛔ **The claim is what a person READS**, and three of its inputs arrive after the fold — the
 * roster, the pane's own name and the recording's mount. ⚠️ So each sentence is read off the
 * mounted surface by `textContent`, and each section plants a CONTROL in the same page: a row whose
 * words must not change, so a repair that rewrote everything cannot pass.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const ident = (slug: string, displayName: string | null): AgentIdentity =>
  ({ id: `aid:${slug}`, slug, displayName }) as unknown as AgentIdentity

const INVENTORY = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: ['message_agent', 'reply_to_parent'].map((name) => ({
      name,
      description: '',
      parameters: [],
    })),
  },
  published: null,
} as unknown as TranscriptEvent

const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const all = (m: Mounted, cy: string): string[] =>
  [...m.host.querySelectorAll(`[data-cy="${cy}"]`)].map((el) =>
    [
      'relayed-heading',
      'outgoing-heading',
      'work-report-from',
      'queued-heading',
      'queued-from',
    ].includes(cy)
      ? cy === 'queued-heading' &&
        el.closest('[data-cy="queued-entry"]')?.querySelector('[data-cy="queued-from"]')
        ? text(el)
        : agentCardSides(el)
      : text(el),
  )

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

/** ⚑ The heading of the agent's OWN replies — the row §2 and §3 read as their control. */
const assistantHeading = (m: Mounted): string[] => all(m, 'assistant-author')

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · G3 — a lost reply, in the card's words
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚑ **D-017 · R14 — what failed, in the host's words** (`whyItWasNotDelivered`'s *gone-folder* arm):
 * `no-conversation` is no longer written, since a giver that is not running is started for the reply.
 */
const ITS_FOLDER_IS_GONE =
  'This conversation did not start: the folder it ran in is no longer there.'

/** Ada's own conversation: Pam gave her W1.3, she replied, and Pam's conversation could not take it. */
function adaReplied(because: unknown, detail?: string): TranscriptEvent[] {
  return [
    INVENTORY,
    {
      type: 'user_turn',
      text: 'Write the migration for the orders index.',
      relayedFrom: 'sess_pam',
      relayedFromProfile: 'project-manager',
      piece: 'work_01HZX9',
      label: 'W1.3',
    },
    {
      type: 'work_given',
      piece: 'work_01HZX9',
      label: 'W1.3',
      parent: 'work_root',
      givenBy: 'sess_pam',
      title: 'the orders index migration',
      brief: 'Write the migration for the orders index.',
    },
    {
      type: 'tool_call',
      id: 'c1',
      name: 'mcp__brobot__reply_to_parent',
      summary: JSON.stringify({ piece: 'W1.3', outcome: 'done', summary: 'Written.' }),
    },
    {
      type: 'work_replied',
      piece: 'work_01HZX9',
      outcome: 'done',
      summary: 'Written.',
      resources: [],
    },
    {
      type: 'reply_undelivered',
      piece: 'work_01HZX9',
      parent: 'sess_pam',
      because,
      ...(detail === undefined ? {} : { detail }),
    },
    { type: 'tool_result', id: 'c1', ok: true, summary: 'W1.3 answered' },
    // ⚑ the control — a notice with no lost reply in it, whose words must not move
    { type: 'turn', state: 'interrupted' },
  ] as unknown as TranscriptEvent[]
}

async function adasPane(because: unknown, detail?: string): Promise<Mounted> {
  await page.viewport(1100, 900)
  const r = record(adaReplied(because, detail), 'sess_ada')
  r.meta = { ...META, sessionId: 'sess_ada', profileId: 'ada' }
  const m = mount(
    ConversationPane,
    paneProps({
      record: r,
      identities: [ident('ada', 'Ada'), ident('project-manager', 'Pam')],
      held: [],
    }),
    { width: 1000, height: 900 },
  )
  await settle()
  return expandAgentCards(m)
}

describe('667 · the three sentences, on a real screen', () => {
  describe('§1 · G3 · a reply that reached nobody', () => {
    it('🔴 the notice names W1.3, Pam and the reason — and the card above it says the same two', async () => {
      // ⚑ **D-017 · R14 — re-aimed from `no-conversation`**: the reason is `not-delivered`, and what
      // failed follows it in the host's own words.
      const m = await adasPane('not-delivered', ITS_FOLDER_IS_GONE)
      expect(all(m, 'what-the-notice-says')).toEqual([
        `the reply to W1.3 did not reach Pam: something went wrong on the way — ${ITS_FOLDER_IS_GONE}`,
        'turn interrupted',
      ])
      // ⚑ the card this notice sits under — the words it has to agree with
      expect(all(m, 'outgoing-heading')).toEqual(['Ada to Pam'])
      expect(all(m, 'outgoing-task')).toEqual(['W1.3'])
      expect(all(m, 'outgoing-state')).toEqual(['not delivered'])
      // ⛔ and nothing on the screen prints the id, the handle or the closed word
      expect(text(m.host)).not.toMatch(/work_01HZX9|sess_pam|no-conversation|not-delivered/)
    })

    it('⚑ each reason in its own words; a word from another build gives none', async () => {
      const said: Record<string, string> = {}
      // ⚑ **D-010** — `parent-is-holding-a-message` is an EARLIER build's word now: a busy parent holds.
      // ⚑ **D-017 · R14** — and so is `no-conversation`: a giver that is not running is started.
      for (const because of [
        'parent-is-holding-a-message',
        'no-conversation',
        'not-delivered',
        'a-later-word',
      ]) {
        const m = await adasPane(because)
        said[because] = all(m, 'what-the-notice-says')[0] ?? ''
        expect(all(m, 'what-the-notice-says')[1], 'the control moved').toBe('turn interrupted')
        unmountAll()
      }
      expect(said).toEqual({
        'parent-is-holding-a-message': 'the reply to W1.3 did not reach Pam',
        'no-conversation': 'the reply to W1.3 did not reach Pam',
        'not-delivered': 'the reply to W1.3 did not reach Pam: something went wrong on the way',
        'a-later-word': 'the reply to W1.3 did not reach Pam',
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · G4 — a recording, and a child's work, name no provider on a card
  // ─────────────────────────────────────────────────────────────────────────────────────────

  /** A conversation in which Ada asked, the agent answered, and the agent messaged Ada back. */
  const EXCHANGE = [
    INVENTORY,
    {
      type: 'user_turn',
      text: 'Which of the two indexes do you mean?',
      relayedFrom: 'sess_ada',
      relayedFromProfile: 'ada',
    },
    { type: 'assistant_message', text: 'The one on orders.created_at.' },
    {
      type: 'tool_call',
      id: 'c2',
      name: 'mcp__brobot__message_agent',
      summary: JSON.stringify({ agent: 'sess_ada', text: 'The created_at one.', kind: 'answer' }),
    },
    {
      type: 'message_sent',
      to: 'sess_ada',
      toProfile: 'ada',
      kind: 'answer',
      delivery: 'sent',
      onBehalfOfAPerson: false,
    },
    { type: 'tool_result', id: 'c2', ok: true, summary: 'sent' },
    // ⚑ **the other two cards that name this side** (`667`'s review): a reply Ada sent back, and
    // two rows still held — a question and a second reply
    {
      type: 'user_turn',
      text: 'Written; the index builds concurrently.',
      attribution: 'app_authored',
      work: { piece: 'work_2', label: 'W1.3', state: 'answered', outcome: 'done' },
      relayedFrom: 'sess_ada',
      relayedFromProfile: 'ada',
    },
    {
      type: 'message_queued',
      text: 'One more question about the orders table.',
      messageId: 'm_1',
      relayedFrom: 'sess_ada',
      relayedFromProfile: 'ada',
    },
    {
      type: 'message_queued',
      text: 'The second migration is written too.',
      messageId: 'm_2',
      work: { piece: 'work_3', label: 'W1.4', state: 'answered', outcome: 'done' },
      relayedFrom: 'sess_ada',
      relayedFromProfile: 'ada',
    },
  ] as unknown as TranscriptEvent[]

  /** ⚑ Every heading that names this side, by the card that draws it — one reading per test. */
  const sides = (m: Mounted): Record<string, string[]> => ({
    relay: all(m, 'relayed-heading'),
    outgoing: all(m, 'outgoing-heading'),
    report: all(m, 'work-report-from'),
    heldRelay: all(m, 'queued-heading').filter((said) => said.includes(' to ')),
    heldReply: all(m, 'queued-from'),
  })

  const IDS = [ident('ada', 'Ada'), ident('brobot', null)]

  describe('§2 · G4 · the card’s own side is a name or *this conversation*', () => {
    /**
     * ⚠️ **678 · re-aimed, not stripped** (rule 26). ⛔ **This planted an `origin: 'ours'` entry with
     * no `profileId`** — a shape main cannot produce since `671` (G4a: every entry of ours carries
     * one) — and pinned *"this conversation"* on it. ⚑ **Three arms now**: an entry of ours names its
     * agent the way the live pane does; one launched as `Dev` is folded the same way (`671` G5a); and
     * the CONTROL — an entry this app did not run as anybody (found in the person's own provider
     * home) — still names nobody, and heads its replies with the provider.
     */
    const readingOf = async (over: Partial<LibraryEntry>): Promise<Mounted> => {
      await page.viewport(1100, 900)
      const window = createWindow()
      openAt(
        window,
        {
          entries: EXCHANGE.map((event, ordinal) => ({ ordinal, at: 1_000 + ordinal, event })),
          from: 0,
          hasOlder: false,
          turnAligned: true,
        },
        'sess_read',
      )
      const entry: LibraryEntry = {
        id: 'sess_read',
        provider: 'claude',
        providerSessionId: 'thread-1',
        recordId: 'sess_read',
        cwd: '/work',
        title: 'The orders index',
        preview: '',
        createdAt: 1_000,
        updatedAt: 2_000,
        bytes: 4_096,
        origin: 'ours',
        onDisk: true,
        readable: true,
        derived: null,
        lastEnding: 'completed',
        unresumableReason: null,
        child: null,
        ...over,
      }
      const m = mount(
        ReadingPane,
        { entry, history: window, mode: 'normal', identities: IDS },
        { width: 1000, height: 900 },
      )
      await settle()
      return expandAgentCards(m)
    }

    it('🔴 678 · a RECORDING of ours names its own agent, as the live pane does', async () => {
      const m = await readingOf({ profileId: 'brobot' })
      expect(sides(m)).toEqual({
        relay: ['Ada to BroBot'],
        outgoing: ['BroBot to Ada'],
        report: ['Ada to BroBot'],
        heldRelay: ['Ada to BroBot'],
        heldReply: ['Ada to BroBot'],
      })
      // ⚑ and the replies are headed with the same name — one agent, one name on this page
      expect(assistantHeading(m)).toEqual(['BroBot'])
      expect(text(m.host)).not.toMatch(/\bto claude\b|\bclaude to\b/i)
    })

    it('⚑ 678 · one launched as `Dev` is folded the way every other surface folds it', async () => {
      const m = await readingOf({ profileId: 'Dev' })
      expect(sides(m).relay).toEqual(['Ada to dev'])
      expect(assistantHeading(m)).toEqual(['dev'])
    })

    it('⛔ the control — a recording this app did not run as anybody names nobody', async () => {
      const m = await readingOf({ origin: 'user-home' })
      expect(sides(m)).toEqual({
        relay: ['Ada to this conversation'],
        outgoing: ['This conversation to Ada'],
        report: ['Ada to this conversation'],
        heldRelay: ['Ada to this conversation'],
        heldReply: ['Ada to this conversation'],
      })
      // ⛔ and its replies keep the heading they had — the provider, never an invented name
      expect(assistantHeading(m)).toEqual(['claude'])
    })

    it('🔴 a CHILD’s work — *sub-agent* heads its replies and never a card', async () => {
      await page.viewport(1100, 900)
      const state = createTranscript()
      for (const event of EXCHANGE) applyEvent(state, event)
      // ⚑ mounted exactly as `ChildWorkViewer` mounts it — `who="sub-agent"`, no `ownAgent`
      const m = mount(
        TranscriptView,
        { items: state.items, mode: 'normal', who: 'sub-agent' },
        { width: 1000, height: 900 },
      )
      await settle()
      await expandAgentCards(m)
      expect(sides(m)).toEqual({
        relay: ['ada to this conversation'],
        outgoing: ['This conversation to ada'],
        report: ['ada to this conversation'],
        heldRelay: ['ada to this conversation'],
        heldReply: ['ada to this conversation'],
      })
      expect(assistantHeading(m)).toEqual(['sub-agent'])
      expect(text(m.host)).not.toMatch(/\bto sub-agent\b|\bsub-agent to\b/i)
    })

    it('⚑ the control — a LIVE pane names its own agent, and both cards say so', async () => {
      await page.viewport(1100, 900)
      const m = mount(
        ConversationPane,
        paneProps({ record: record(EXCHANGE), identities: IDS, held: [] }),
        { width: 1000, height: 900 },
      )
      await settle()
      await expandAgentCards(m)
      expect(sides(m)).toEqual({
        relay: ['Ada to BroBot'],
        outgoing: ['BroBot to Ada'],
        report: ['Ada to BroBot'],
        heldRelay: ['Ada to BroBot'],
        heldReply: ['Ada to BroBot'],
      })
      expect(assistantHeading(m)).toEqual(['BroBot'])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · G5 — one spelling on both halves of a card
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · G5 · an unnamed agent is spelled one way', () => {
    /** An unnamed agent's pane, launched under `spelling`, receiving from its own identity. */
    async function devsPane(spelling: string, displayName: string | null): Promise<Mounted> {
      await page.viewport(1100, 700)
      const r = record(
        [
          {
            type: 'user_turn',
            text: 'Can you take the second half of the migration?',
            relayedFrom: 'sess_dev_2',
            relayedFromProfile: 'dev',
          },
          { type: 'assistant_message', text: 'Yes — starting on it.' },
        ] as unknown as TranscriptEvent[],
        'sess_dev',
      )
      r.meta = { ...META, sessionId: 'sess_dev', profileId: spelling }
      const m = mount(
        ConversationPane,
        paneProps({ record: r, identities: [ident('dev', displayName)], held: [] }),
        { width: 1000, height: 700 },
      )
      await settle()
      return expandAgentCards(m)
    }

    it('🔴 launched as `Dev` it reads exactly as launched as `dev` — where the two readings used to DIVERGE', async () => {
      const read = async (spelling: string): Promise<string[]> => {
        const m = await devsPane(spelling, null)
        const said = [...all(m, 'relayed-heading'), ...assistantHeading(m)]
        unmountAll()
        return said
      }
      const lower = await read('dev')
      // ⚑ the control: spellings that already agree
      expect(lower).toEqual(['dev to dev', 'dev'])
      // 🔴 the case that read *"dev to Dev"*, and a reply headed *Dev* beside it
      expect(await read('Dev')).toEqual(lower)
    })

    it('⚑ a NAMED agent is its name whatever the spelling — the fold changes nothing there', async () => {
      for (const spelling of ['Dev', 'dev']) {
        const m = await devsPane(spelling, 'Ada')
        expect(all(m, 'relayed-heading'), spelling).toEqual(['Ada to Ada'])
        expect(assistantHeading(m), spelling).toEqual(['Ada'])
        unmountAll()
      }
    })
  })
})
