import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REPLY_DELIVERIES, REPLY_LANDED, type ReplyDelivery } from '../src/main/runtime/reply-rails'
import { AN_ANSWER_HELD_THEN_LOST } from '../src/shared/tasks'
import {
  applyEvent,
  createTranscript,
  type NoticeItem,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import {
  isUndeliveredReason,
  lostReplySentence,
  UNDELIVERED_REASON_WORDS,
  type UndeliveredReason,
} from '../src/renderer/src/lib/lost-reply'
import {
  AN_UNNAMED_PARENT,
  outgoingCard,
  type OutgoingCardWords,
} from '../src/renderer/src/lib/outgoing-card'
import { THIS_CONVERSATION, THIS_CONVERSATION_FIRST } from '../src/renderer/src/lib/from-outside'
import {
  agentName,
  profileLabel,
  type AgentIdentity,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 667 · The three sentences beside the new cards
 *
 * The renderer cards can be drawn beside incorrect explanatory sentences. Check the three
 * remaining sentences:
 *
 * | | ⛔ what a person read | ⚑ what this file pins |
 * |---|---|---|
 * | **G3** | *"the reply to task_… did not reach sess_…: no-conversation"* | the card's words: *W1.2*, the parent's NAME, the reason in words — §1 |
 * | **G4** | *"ada to claude"* on a recording, *"sub-agent"* in a child's work | a card is handed a NAME or `null`, never the heading word — §2 |
 * | **G5** | *"dev to Dev"* on one card | measured on a real screen, in `test/dom/the-three-sentences-beside-the-cards.dom.test.ts` |
 *
 * ⚠️ **This file is compiled by `tsconfig.node.json`**, which sees `main/` AND `renderer/` — and
 * that is the whole reason §1's first test can be a TYPE: the renderer cannot import main's
 * vocabulary, and this file is the one place both are in view.
 */

const here = dirname(fileURLToPath(import.meta.url))
const COMPONENTS = join(here, '..', 'src', 'renderer', 'src', 'components')

const CLAUDE = { prefix: 'mcp__', separator: '__' }

const inventory: TranscriptEvent = {
  type: 'tool_inventory',
  naming: CLAUDE,
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

/**
 * ⚑ **D-016 · a give, as the owner's ledger holds it** — re-aimed from `task_assigned`, which is
 * gone. `work_given` names the piece and its label; the brief's turn is the giver's words, so its
 * relayer names who gave it (`rememberTheGiver` joins the two halves by piece).
 */
const assigned = (givenBy = 'sess_pam', profile: string | null = 'project-manager') =>
  [
    { type: 'work_given', piece: 'work_1', label: 'W1.2', parent: 'work_root', givenBy, title: 'Plan the trip', brief: 'Plan the trip.' },
    { type: 'user_turn', text: 'Plan the trip.', relayedFrom: givenBy, ...(profile === null ? {} : { relayedFromProfile: profile }), piece: 'work_1', label: 'W1.2' },
  ] as TranscriptEvent[] // prettier-ignore

const replyCall = { type: 'tool_call', id: 'r1', name: 'mcp__brobot__reply_to_parent', summary: JSON.stringify({ piece: 'W1.2', outcome: 'done', summary: 'It is done.' }) } as TranscriptEvent // prettier-ignore
const replied = { type: 'work_replied', piece: 'work_1', outcome: 'done', summary: 'It is done.', resources: [] } as TranscriptEvent // prettier-ignore
const answered = { type: 'tool_result', id: 'r1', ok: true, summary: 'W1.2 answered' } as TranscriptEvent // prettier-ignore

const lostBecause = (because: unknown, parent = 'sess_pam', detail?: string): TranscriptEvent =>
  ({
    type: 'reply_undelivered',
    piece: 'work_1',
    parent,
    because,
    ...(detail === undefined ? {} : { detail }),
  }) as TranscriptEvent

/**
 * ⚑ **D-017 · R14 — what failed, in the host's words** (`whyItWasNotDelivered`'s *gone-folder* arm):
 * `no-conversation` is gone, and the row says why after the reason. ⚠️ **D-030** — a start that
 * fails now keeps the reply for its giver's next start and writes no row; this is a row a build
 * before it wrote, which a ledger still holds.
 */
const ITS_FOLDER_IS_GONE =
  'This conversation did not start: the folder it ran in is no longer there.'

const fold = (events: readonly TranscriptEvent[]): TranscriptState => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const notices = (state: TranscriptState): NoticeItem[] =>
  state.items.filter(
    (item): item is NoticeItem & (typeof state.items)[number] => item.kind === 'notice',
  )

/** ⚑ The one lost-reply notice in a fold — found by its facts, and asserted to be alone. */
const lostNotice = (state: TranscriptState): NoticeItem => {
  const found = notices(state).filter((item) => item.lostReply !== undefined)
  expect(found, 'exactly one lost-reply notice').toHaveLength(1)
  return found[0] as NoticeItem
}

const ident = (slug: string, displayName: string | null): AgentIdentity =>
  ({ id: `aid:${slug}`, slug, displayName }) as unknown as AgentIdentity

const IDS = [ident('project-manager', 'Pam'), ident('ada', 'Ada')]

/** Words a person must never read on a lost reply — ids, handles, and the vocabulary itself. */
const RAW = /work_|sess_|parent-is-holding-a-message|no-conversation|not-delivered/

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · G3 — a reply that reached nobody, in the card's words
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · G3 · the notice says it the way the card says it', () => {
  it('🔴 the reasons ARE main’s undelivered answers — a type pin, so a new one is a compile error', () => {
    // ⛔ **Checked by `pnpm run typecheck`, not by this test running**: `Exact` is `true` only when
    // main's vocabulary is exactly the renderer's reasons plus the three that landed — ⚑ D-030
    // added `kept`. A fifth member in `REPLY_DELIVERIES` makes this line fail to COMPILE, which is
    // `667` §1's demand.
    type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
    const vocabulary: Exact<ReplyDelivery, UndeliveredReason | 'sent' | 'held' | 'kept'> = true
    expect(vocabulary).toBe(true)
    // ⚑ **…and the three the type calls LANDED are the three `REPLY_LANDED` marks true** — the value
    // half, which a type cannot read out of a `Record<…, boolean>`.
    expect(REPLY_DELIVERIES.filter((word) => REPLY_LANDED[word]).sort()).toEqual([
      'held',
      'kept',
      'sent',
    ])
    expect(REPLY_DELIVERIES.filter((word) => !REPLY_LANDED[word]).sort()).toEqual(
      Object.keys(UNDELIVERED_REASON_WORDS).sort(),
    )
  })

  it('⚑ each reason has its own words, none of them the word itself', () => {
    const words = Object.values(UNDELIVERED_REASON_WORDS)
    // ⛔ a set whose members must differ needs a distinctness check
    expect(new Set(words).size).toBe(words.length)
    for (const said of words) {
      expect(said.trim().length).toBeGreaterThan(10)
      expect(said).not.toMatch(RAW)
    }
    // the guard answers yes for each reason and no for a word from a later build
    for (const reason of Object.keys(UNDELIVERED_REASON_WORDS)) {
      expect(isUndeliveredReason(reason)).toBe(true)
    }
    for (const other of [
      'sent',
      'held',
      'kept',
      'a-word-from-a-later-build',
      'toString',
      42,
      null,
    ]) {
      expect(isUndeliveredReason(other), String(other)).toBe(false)
    }
  })

  it('🔴 the fold keeps FACTS, and the sentence names the piece, the parent and the reason', () => {
    // ⚑ **D-017 · R14 — re-aimed from `no-conversation`**, which main no longer writes: the reason
    // is `not-delivered`, and what failed follows it in the host's own words.
    const state = fold([inventory, ...assigned(), replyCall, replied, lostBecause('not-delivered', 'sess_pam', ITS_FOLDER_IS_GONE), answered]) // prettier-ignore
    const lost = lostNotice(state)
    expect(lost.level).toBe('warn')
    expect(lost.lostReply).toEqual({
      label: 'W1.2',
      toProfile: 'project-manager',
      because: 'not-delivered',
      detail: ITS_FOLDER_IS_GONE,
    })
    // ⚑ with the roster — what the transcript draws
    expect(lostReplySentence(lost.lostReply!, IDS)).toBe(
      `the reply to W1.2 did not reach Pam: something went wrong on the way — ${ITS_FOLDER_IS_GONE}`,
    )
    // ⚠️ and `text` is the same function WITHOUT one — the slug, never a handle
    expect(lost.text).toBe(
      `the reply to W1.2 did not reach project-manager: something went wrong on the way — ${ITS_FOLDER_IS_GONE}`,
    )
    expect(lost.text).toBe(lostReplySentence(lost.lostReply!, null))
    // ⚑ …and a `no-conversation` row an earlier build wrote is a word this build has no words
    // for: the sentence stops at the name, and never says the word.
    const old = lostNotice(fold([inventory, ...assigned(), replyCall, replied, lostBecause('no-conversation'), answered])) // prettier-ignore
    expect(old.lostReply?.because).toBe(null)
    expect(lostReplySentence(old.lostReply!, IDS)).toBe('the reply to W1.2 did not reach Pam')
  })

  it('🔴 the notice and the card above it name the same piece and the same parent', () => {
    const state = fold([inventory, ...assigned(), replyCall, replied, lostBecause('no-conversation'), answered]) // prettier-ignore
    const reply = state.items.find((item): item is ToolItem & (typeof state.items)[number] => item.kind === 'tool' && item.callId === 'r1') // prettier-ignore
    expect(reply?.outgoing).toBeDefined()
    const card = outgoingCard(reply!, reply!.outgoing as OutgoingCardWords, IDS, null)
    expect(card.state).toBe('not-delivered')
    const said = lostReplySentence(lostNotice(state).lostReply!, IDS)
    expect(card.recipient).toBe('Pam')
    expect(card.facts?.heading).toBe('W1.2')
    expect(said).toContain(`${card.facts!.heading} did not reach ${card.recipient}`)
  })

  it('⚑ every reason, and a word this build does not know, reads without an id or a raw word', () => {
    for (const because of [
      ...REPLY_DELIVERIES.filter((word) => !REPLY_LANDED[word]),
      'a-word-from-a-later-build',
      undefined,
      7,
    ]) {
      // prettier-ignore
      const lost = lostNotice(fold([inventory, ...assigned(), replyCall, replied, lostBecause(because), answered])) // prettier-ignore
      for (const said of [lost.text, lostReplySentence(lost.lostReply!, IDS)]) {
        expect(said, String(because)).not.toMatch(RAW)
        expect(said, String(because)).not.toMatch(/a-word-from-a-later-build|undefined|null|\b7\b/)
      }
    }
    // ⛔ an unknown word gives NO reason — the sentence stops at the name
    const unknown = lostNotice(fold([inventory, ...assigned(), replyCall, replied, lostBecause('a-word-from-a-later-build'), answered])) // prettier-ignore
    expect(lostReplySentence(unknown.lostReply!, IDS)).toBe('the reply to W1.2 did not reach Pam')
  })

  it('🔴 a name is taken only from the give that came from THIS reply’s parent — the control agrees', () => {
    // ⚑ the control: the parent the row names is the conversation that gave the piece
    // (⚑ D-017 · R14: `not-delivered`, as `no-conversation` is no longer written)
    const same = lostNotice(fold([inventory, ...assigned('sess_pam'), lostBecause('not-delivered', 'sess_pam')])) // prettier-ignore
    expect(lostReplySentence(same.lostReply!, IDS)).toBe(
      'the reply to W1.2 did not reach Pam: something went wrong on the way',
    )
    // ⛔ the divergence: a row naming a DIFFERENT parent borrows no name from this give
    const other = lostNotice(fold([inventory, ...assigned('sess_pam'), lostBecause('not-delivered', 'sess_other')])) // prettier-ignore
    expect(other.lostReply?.toProfile).toBeUndefined()
    expect(lostReplySentence(other.lostReply!, IDS)).toBe(
      `the reply to W1.2 did not reach ${AN_UNNAMED_PARENT}: something went wrong on the way`,
    )
    // ⚠️ a give with no identity on it names nobody either
    const unnamed = lostNotice(fold([inventory, ...assigned('sess_pam', null), lostBecause('not-delivered')])) // prettier-ignore
    expect(unnamed.lostReply?.toProfile).toBeUndefined()
  })

  it('⚑ no give in view — *the reply*, never an id', () => {
    const lost = lostNotice(fold([inventory, lostBecause('not-delivered')]))
    expect(lost.lostReply).toEqual({ because: 'not-delivered' })
    expect(lostReplySentence(lost.lostReply!, IDS)).toBe(
      `the reply did not reach ${AN_UNNAMED_PARENT}: something went wrong on the way`,
    )
    // ⚑ **D-010** — a row an earlier build wrote for a busy parent is a word this build has no
    // words for: the sentence gives no reason, and never the word.
    const old = lostNotice(fold([inventory, lostBecause('parent-is-holding-a-message')]))
    expect(old.lostReply).toEqual({ because: null })
    expect(lostReplySentence(old.lostReply!, IDS)).toBe(
      `the reply did not reach ${AN_UNNAMED_PARENT}`,
    )
  })

  it('⛔ the control: every other notice is untouched — no facts, and its own words', () => {
    const state = fold([inventory, { type: 'turn', state: 'interrupted' } as TranscriptEvent, lostBecause('not-delivered')]) // prettier-ignore
    const plain = notices(state).filter((item) => item.lostReply === undefined)
    expect(plain.map((item) => item.text)).toEqual(['turn interrupted'])
    expect(notices(state)).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · G4 — a card is handed a NAME or nothing
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ Every `:own-agent="…"` binding in a file, in order — the reader §2's census stands on. */
function ownAgentBindings(source: string): string[] {
  // ⚠️ **Every way Vue passes the prop** — bound (`:`), `v-bind:`, or STATIC, and kebab or camel.
  // ⛔ The first cut read `:own-agent=` alone, and a static `own-agent="sub-agent"` — the exact
  // form `ChildWorkViewer` binds `who` in — would have passed as *binds nothing* (`667`'s review).
  return [...source.matchAll(/(?:^|\s)(?::|v-bind:)?(?:own-agent|ownAgent)="([^"]*)"/g)].map(
    (found) => found[1]!.trim(),
  )
}

/** ⚑ Code only — a docblock quoting the words it retired must not count as a use. */
const code = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

describe('§2 · G4 · never a provider or *sub-agent* on a card', () => {
  it('⚑ the reader finds every binding in a file, not the first — and in every form Vue accepts', () => {
    expect(
      ownAgentBindings('<A :own-agent="x" />\n<B\n  :own-agent="props.y ?? null"\n/>'),
    ).toEqual(['x', 'props.y ?? null'])
    // ⛔ the forms the first reader could not see — each one a way a provider could come back
    expect(
      ownAgentBindings(
        '<A own-agent="sub-agent" />\n<B :ownAgent="p" />\n<C v-bind:own-agent="q" />\n<D ownAgent="r" />',
      ),
    ).toEqual(['sub-agent', 'p', 'q', 'r'])
    // ⚑ and not a prop DECLARATION, which carries no `=` quote
    expect(ownAgentBindings('  ownAgent: string | null\n')).toEqual([])
  })

  // ⚠️ **678 · re-aimed, not stripped** (rule 26): `671` put `profileId` on a library entry (G4a), so a
  // RECORDING of ours now names its own agent as the live pane does — the census's population grew by
  // one surface, and the one mount that has no name (a child's work) still binds nothing.
  it('🔴 the surfaces that NAME this conversation’s agent are the live pane and a recording; the rest forward it', () => {
    const found = new Map<string, string[]>()
    for (const name of readdirSync(COMPONENTS).filter((one) => one.endsWith('.vue'))) {
      for (const binding of ownAgentBindings(code(readFileSync(join(COMPONENTS, name), 'utf8')))) {
        found.set(binding, [...(found.get(binding) ?? []), name])
      }
    }
    expect(Object.fromEntries(found)).toEqual({
      // ⚑ `ConversationPane.ownAgent` — `agentName` over the profile, which it folds (§3's DOM file);
      // ⚑ **678** `ReadingPane.ownAgent` — the same, over the recording's OWN `entry.profileId`
      // ⚑ **D-017b** — 701's `KeptOpenPane.ownAgent` went with the pane: a conversation the quit
      // left open opens in the one full view (`ConversationPane`), which names its agent itself.
      // ⚑ `RecoveryApp.ownAgent` — a recording read from a restored copy, named by the agent name
      // the copy holds for it; the recovery window is handed no roster to ask `agentName` with.
      ownAgent: ['ConversationPane.vue', 'ReadingPane.vue', 'RecoveryApp.vue'],
      // The transcript and answer wrapper forward the same nullable name to their child cards.
      'props.ownAgent ?? null': [
        'AnsweredQuestionEntry.vue',
        'AnsweredQuestionEntry.vue',
        ...Array(7).fill('TranscriptView.vue'),
      ],
    })
    // ⛔ **A recording names its agent from ITS OWN read** — the entry's id through the one naming
    // function — never from the rail's list (`readRecorded`'s rule): a heading composed out of
    // another read would name some recordings and not others by how they were opened.
    const reading = code(readFileSync(join(COMPONENTS, 'ReadingPane.vue'), 'utf8'))
    expect(reading).toMatch(/agentName\(props\.entry\.profileId, props\.identities \?\? null\)/)
    // ⛔ **The surface with no name binds NOTHING**, so its cards say *this conversation* — and it
    // still mounts a transcript, so the absence is about the binding and not the file.
    const child = code(readFileSync(join(COMPONENTS, 'ChildWorkViewer.vue'), 'utf8'))
    expect(child, 'ChildWorkViewer mounts no transcript').toContain('<TranscriptView')
    expect(ownAgentBindings(child), 'ChildWorkViewer').toEqual([])
  })

  it('⚑ a recording is handed the SAME roster a live pane is — so its cards name the other agent', () => {
    const screen = code(readFileSync(join(COMPONENTS, 'RuntimeScreen.vue'), 'utf8'))
    /** The one `<Tag … />` mount of a component in the screen, asserted to be alone. */
    const mountOf = (tag: string): string => {
      const starts = [...screen.matchAll(new RegExp(`<${tag}\\n`, 'g'))]
      expect(starts, `${tag} is mounted once`).toHaveLength(1)
      const from = starts[0]!.index!
      return screen.slice(from, screen.indexOf('/>', from))
    }
    const roster = (block: string): string | undefined => /:identities="([^"]*)"/.exec(block)?.[1]
    const live = roster(mountOf('ConversationPane'))
    expect(live, 'the live pane is handed no roster').toMatch(/identities/)
    expect(roster(mountOf('ReadingPane'))).toBe(live)
  })

  it('🔴 each card draws the name it is handed, or *this conversation* — and reads no `who`', () => {
    const CARDS: Record<string, string> = {
      RelayedEntry: THIS_CONVERSATION,
      WorkReportEntry: THIS_CONVERSATION,
      QueuedMessage: THIS_CONVERSATION,
      OutgoingEntry: THIS_CONVERSATION_FIRST,
    }
    for (const [card, word] of Object.entries(CARDS)) {
      const source = code(readFileSync(join(COMPONENTS, `${card}.vue`), 'utf8'))
      expect(source, `${card} declares no ownAgent`).toMatch(/^\s*ownAgent: string \| null$/m)
      const fallback = word === THIS_CONVERSATION ? 'THIS_CONVERSATION' : 'THIS_CONVERSATION_FIRST'
      expect(source, `${card} falls back to something else`).toMatch(
        new RegExp(`ownAgent \\?\\? ${fallback}\\b`),
      )
      expect(source, `${card} still reads the heading word`).not.toMatch(/props\.who\b|\bwho:/)
    }
    // ⚑ the words themselves: one phrase, capitalised only where it opens a heading
    expect(THIS_CONVERSATION_FIRST.toLowerCase()).toBe(THIS_CONVERSATION)
    expect(THIS_CONVERSATION_FIRST).not.toBe(THIS_CONVERSATION)
    // The recipient is named once in the compact heading, never repeated in the body.
    const queued = code(readFileSync(join(COMPONENTS, 'QueuedMessage.vue'), 'utf8'))
    expect(queued.match(/ownAgent \?\? THIS_CONVERSATION\b/g)).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · G5 — a conversation's profile is asked in ONE spelling, everywhere it is named
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Every `.ts` and `.vue` file under the renderer, recursively. */
function rendererFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? rendererFiles(join(dir, entry.name))
      : /\.(ts|vue)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  )
}

/** ⚑ Each `agentName(` call's FIRST argument, read up to its comma. */
const namingKeys = (source: string): string[] =>
  [...source.matchAll(/\bagentName\(\s*([^,]+),/g)].map((found) => found[1]!.trim())

/**
 * 🔴 **678 · §3 re-aimed, not stripped** (rule 26). ⚠️ **It pinned `667`'s renderer `oneSpelling`**,
 * the fold `667` put in front of every `agentName` call because `agentName` folded its lookup key and
 * not its fallback. ⚑ **`671` folded the fallback in `shared/`** (`667` G5a, handed back), so the four
 * renderer folds became a second fold of a folded name — and `678` dropped them for ONE owner.
 *
 * ⛔ **So what this pins moved from the renderer's calls to the function they call**: the fold is
 * `agentName`'s, on both halves, and it survives a record with no profile — the crash `667`'s first
 * cut hit in the rail, which `oneSpelling`'s guard existed for. ⚑ **And the census now refuses the
 * SECOND fold**: a renderer that folds before asking is a second owner of the spelling, which is how
 * two spellings of one agent began.
 */
describe('§3 · G5 · one spelling of a conversation’s agent', () => {
  it('🔴 the fold is `agentName`’s own — on the lookup AND the fallback — and survives no profile', () => {
    // ⚑ nobody named it: the FALLBACK is folded — `667`'s *"dev to Dev"* is gone at the source
    expect(agentName('Dev', null)).toBe('dev')
    expect(agentName('Project-Manager', [])).toBe('project-manager')
    // ⚑ somebody named it: the LOOKUP is folded, and the name is returned exactly as typed
    expect(agentName('Dev', [ident('dev', 'Ada')])).toBe('Ada')
    // ⛔ the control — a canonical id was never the problem, and it still answers the same
    expect(agentName('dev', null)).toBe('dev')
    // ⚑ `null` is a conversation from before profiles, which ran in the default one
    expect(agentName(null, null)).toBe(profileLabel(null))
    // ⛔ **a record with NO profile** — `attention-rail.dom.test.ts` and `closed-rail.dom.test.ts`
    // mount such records, and the rail crashed on exactly this in `667`'s first cut
    expect(() => agentName(undefined as unknown as string | null, null)).not.toThrow()
    expect(agentName(undefined as unknown as string | null, null)).toBe(profileLabel(null))
  })

  it('⚑ the reader finds every call — the control plants TWO, one folded and one not', () => {
    expect(
      namingKeys(
        'a = agentName(foldProfileName(meta.profileId), ids)\nb = agentName(row.profileId, x)',
      ),
    ).toEqual(['foldProfileName(meta.profileId)', 'row.profileId'])
  })

  it('🔴 no renderer call folds a `profileId` before `agentName` — the spelling has ONE owner', () => {
    const RENDERER = join(here, '..', 'src', 'renderer', 'src')
    const asked: string[] = []
    const foldedFirst: string[] = []
    for (const file of rendererFiles(RENDERER)) {
      for (const key of namingKeys(code(readFileSync(file, 'utf8')))) {
        // ⚑ **D-017b** — `profile` too: `whoIsIn` (lib/session-record.ts) asks of the profile a
        // conversation runs as, under that name, for the live pane and the drawer.
        if (!/\bprofile(?:Id)?\b/.test(key)) continue
        // ⛔ any call wrapped around the id is a fold of it — the renderer's own, or a borrowed one
        ;(/^[\w.]+\(/.test(key) || /\.toLowerCase\(/.test(key) ? foldedFirst : asked).push(
          `${file.slice(RENDERER.length + 1).replaceAll('\\', '/')} · ${key}`,
        )
      }
    }
    // ⛔ nothing folds before asking
    expect(foldedFirst).toEqual([])
    // ⚑ and the population is every surface that names a conversation's agent — so an empty census
    // (a reader that found nothing) cannot pass as a clean one. ⚑ **678** adds the recording.
    expect(asked.sort()).toEqual([
      // ⚑ **D-017b** — 701's `KeptOpenPane` is gone (every conversation opens in the one full view)
      'components/ReadingPane.vue · props.entry.profileId',
      // ⚑ **714** (R41, `712` F-4) — the ones that drew `profileLabel`'s *profile:* line name the
      // agent now: both halves of the reopen list and the Info tab's home line. The shelf's Agent
      // cell left with the shelf's four settings; the Agent panel names the agent.
      'components/ResumableSessions.vue · session.profileId',
      'components/ResumableSessions.vue · session.profileId',
      'components/SessionInfo.vue · session.profileId',
      'components/SideRail.vue · meta.profileId',
      // ⚑ **712** (R41, `707` GAP-5) — the store's remove sentences name the agent they are about,
      // asked of the id the door was handed, before the removal
      'lib/agent-store.ts · profileId',
      // ⚑ **D-017b** — the ONE Conversations list (rail and ⌘K) names each host row's agent;
      // `closed-threads.ts`, which named the closed group's, went with the split
      'lib/conversation-list.ts · row.profileId',
      // ⚑ **2026-09-29** — a give's card names the agent it gave to, asked of the call's own
      // `profile` argument, unfolded
      'lib/outgoing-card.ts · profile.text',
      // ⚑ **D-017b** — the live pane and the drawer name through `whoIsIn`, which asks
      // `agentName` of the profile the conversation runs as (its provider's name for one this
      // app ran as nobody) — ONE call where `ConversationPane` and `SessionDrawer` had one each
      'lib/session-record.ts · profile',
    ])
    // ⛔ **And the `profile` it asks of is the row's own id, unfolded** — `whoIsIn`'s key is a
    // local, so the fold census above cannot see a fold made where the local is assigned.
    const record = code(readFileSync(join(RENDERER, 'lib', 'session-record.ts'), 'utf8'))
    expect(record).toMatch(
      /export function whoIsIn\([^)]*\): string \{\n {2}const profile = profileItRunsAs\(meta\)\n/,
    )
    expect(record).toMatch(
      /export function profileItRunsAs\([^)]*\): string \| null \{\n[^\n]*\n {2}return meta\.profileId\n\}/,
    )
    // ⚑ …and the two surfaces that name through it DO ask it, so the one call above is theirs.
    for (const name of ['ConversationPane.vue', 'SessionDrawer.vue']) {
      expect(code(readFileSync(join(COMPONENTS, name), 'utf8')), name).toMatch(/\bwhoIsIn\(/)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 729 · R89 — a reply HELD for its giver and then lost, drawn by the words this build has
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('729 · R89 · a reply held for its giver and then lost, on the replier’s own transcript', () => {
  /**
   * ⚑ **The person's half of R89** (*"Lost is lost, whatever lost it"*): main now writes the lost
   * reply's record LATER, when the held message ends unsent (`AN_ANSWER_HELD_THEN_LOST`), and this
   * fold — unchanged — reads it as it reads every lost reply. ⚠️ A pin of what a person sees, not a
   * RED subject: the RED is the row's writing, measured on the product path
   * (`the-words-that-were-lost-and-who-asked.test.ts` §1). ⚑ No reason is drawn for the new word —
   * this build has no words for it (reported to the frontend, `729`).
   */
  it('⚑ the card stops saying delivered, and the notice names the piece and the giver', () => {
    const replyIn = (state: TranscriptState) => state.items.find((item): item is ToolItem & (typeof state.items)[number] => item.kind === 'tool' && item.callId === 'r1') // prettier-ignore
    // ⚑ The control: held, and nothing after it — the card counts it landed, as `REPLY_LANDED` does.
    const held = fold([inventory, ...assigned(), replyCall, replied, answered])
    const heldCard = replyIn(held)
    expect(outgoingCard(heldCard!, heldCard!.outgoing as OutgoingCardWords, IDS, null).state).toBe(
      'delivered',
    )
    // 🔴 The subject: the held message ended unsent, and the record arrived after the answer.
    const state = fold([inventory, ...assigned(), replyCall, replied, answered, lostBecause(AN_ANSWER_HELD_THEN_LOST)]) // prettier-ignore
    const reply = replyIn(state)
    expect(outgoingCard(reply!, reply!.outgoing as OutgoingCardWords, IDS, null).state).toBe(
      'not-delivered',
    )
    const lost = lostNotice(state)
    expect(lost.lostReply).toMatchObject({ label: 'W1.2', toProfile: 'project-manager' })
    expect(lostReplySentence(lost.lostReply!, IDS)).toContain('the reply to W1.2 did not reach Pam')
    expect(lost.text).not.toMatch(RAW)
    expect(lost.text).not.toContain(AN_ANSWER_HELD_THEN_LOST)
  })
})
