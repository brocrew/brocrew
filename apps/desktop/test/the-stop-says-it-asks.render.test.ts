import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PromptComposer, {
  interruptKeyLabel,
  sendKeyLabel,
} from '../src/renderer/src/components/PromptComposer.vue'
import { useConversationControls } from '../src/renderer/src/composables/useConversationControls'
import { stopJoinsThatAsk } from '../src/renderer/src/lib/stop-unanswered'
import { ASKED_TO_STOP } from '../src/shared/how-work-stopped'
import { DEFAULT_PROFILE_ID, type CreatedSession } from '../src/shared/runtime-ipc'

/**
 * # 🔴 737 · Draw 3 — the Stop says what a press does: *the turn is asked to stop* (`730` F-3)
 *
 * ⚑ **The finding, verbatim** (`730` §8): *"The busy title **Interrupt the running turn (Esc)** and
 * the frozen **Esc stops the turn** predate R43's *asked to stop*."*
 *
 * ⚑ **The ruling it answers, verbatim** (`709` prompt §1): *"**R43 (`704` H-3) · The ledger records
 * the provider's word.** A turn the provider completed is recorded `completed`, even when an
 * interrupt was asked; the ask is recorded beside it (`work_interrupted` already is). A turn is
 * `interrupted` only when the provider says it was."*
 *
 * ⛔ **So a press ASKS.** Codex can finish the turn anyway (`probe:codex-early-interrupt`), and on
 * Claude it is this app that ends it when the ack does not come (R71): *interrupts* and *stops* are
 * claims true on neither provider every time. ⚑ The one claim true on both is `ASKED_TO_STOP`'s, and
 * `737` composes the Stop's words from it — `A_STOP_ASKS_THE_TURN`, *"the turn is asked to stop"*.
 *
 * | § | surface | 🔴 subject (RED on `main` 92209678) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 1 | `PromptComposer`, `busy` | the Stop's title and the foot, each in R43's words (also with every optional prop omitted); with a message already waiting the foot still offers to queue — behind it (D-010) | `hasQueued: false` said out loud: the same words |
 * | 2 | `PromptComposer`, `frozen` | the Stop's title and the foot's Esc clause | not interruptible: no Stop, no Esc clause |
 * | 3 | the agent card's approval mode, a pending change | what its panel says ends at the mode, with no claim about the turn (the rule 8.1 sweep, and 737 review) | no pending mode: the mode and when a change applies |
 * | 4 | every Stop word above | a SEARCH SHAPE for the old claims finds none | the same search over a planted string of TWO old claims finds two; R83's words find none |
 * | 5 | the neighbours the draw leaves alone | — | R83's title and foot; not interruptible; the launcher's `starting` Cancel; `busy` with a draft — the pair steps in for the Stop, and neither its title nor its foot is the Stop's sentence; `idle`; `blocked` |
 * | 5b | interrupt-and-send, which `739` moved (`737` F-7) — no longer a neighbour left alone | its title and foot in `739`'s *Stop and send* words (RED on `main` 5f406f2f, by assertion) | — (the §5 control above is its one fact over) |
 * | 6 | the one spelling | the composer composes from the constant; the drawer spells no claim about a press | the stripper leaves code |
 *
 * ⚠️ **What `main` draws instead** (measured on 92209678): the busy Stop *"Interrupt the running
 * turn (Esc)"*; the frozen Stop *"Stop the turn instead of answering (Esc)"*; the busy foot
 * *"<who> is working — type to queue a message, or press Esc to interrupt the turn."* — the same
 * with a message already waiting; the frozen foot *"… A message won't answer it, but Esc stops the
 * turn."*; the approval title *"… that is already running. To stop this one now, interrupt it."*
 *
 * ⚠️ **`A_STOP_ASKS_THE_TURN` is NEW** (the module is `730`'s and is on `main`; the export is not):
 * it is reached only INSIDE subjects, by a dynamic `import()` after the drawing was asserted, so on
 * `main` a subject fails on what `main` draws and the controls still run.
 *
 * ⚠️ **SSR** ([[brobot2-ssr-tests-pass-vacuously]]) — every reading is taken off the ELEMENT (a
 * `title`, the foot's text) with the markup's comments stripped, never off the whole markup: the
 * templates' own comments QUOTE the old words. Every negative sits beside a positive the same
 * markup satisfies. ⚑ **No new wire field is read by this draw**, so no double can lag behind one;
 * the props a caller may omit are the doubles here, and §1 mounts with every one at its default.
 * The engine's half — the foot drawn whole at the pane's width — is
 * `test/dom/the-stop-says-it-asks.dom.test.ts`.
 */

/** ⚑ The new export — read inside subjects only (see the header). */
const since737 = (): Promise<typeof import('../src/renderer/src/lib/stop-unanswered')> =>
  import('../src/renderer/src/lib/stop-unanswered')

/** ⚑ R43's clause, and the five sentences it is said in — verbatim ONCE; rule 5 composes each below. */
const THE_TURN_IS_ASKED_TO_STOP = 'the turn is asked to stop'
const BUSY_TITLE = 'Stop — the turn is asked to stop (Esc)'
const FROZEN_TITLE = 'Stop instead of answering — the turn is asked to stop (Esc)'
const BUSY_FOOT =
  'Codex is working — type to queue a message. Esc is Stop: the turn is asked to stop.'
const FROZEN_FOOT =
  "Answer the request above to continue. A message won't answer it, but Esc is Stop: the turn is asked to stop."
const ASKS_NOW_PENDING_AUTO =
  'This session asks what its provider’s own CLI asks by default. You have asked it to stop asking — that takes effect from your next message, because neither provider can change the mode of a turn that is already running.'
const AUTO_NOW_PENDING_ASK =
  'This session runs commands and edits files without asking, except what the provider’s own plan mode asks while it plans. You have asked it to start asking again — that takes effect from your next message, because neither provider can change the mode of a turn that is already running.'

/**
 * ⛔ **The old claims** — each says a press ENDS the turn, which R43 made false. The first four are
 * `main`'s own words; the rest are `make-the-word-mean-one-thing.test.ts`' paraphrases of *over*.
 */
const OLD_CLAIMS = [
  'Interrupt the',
  'interrupt the turn',
  'stops the turn',
  'Stop the turn',
  'is stopped',
  'is interrupted',
  'ends the turn',
  'interrupt it',
] as const

/** ⚑ Every occurrence of every old claim in `text`, in list order — the search shape §4 plants. */
function oldClaimsIn(text: string): string[] {
  const hits: string[] = []
  for (const claim of OLD_CLAIMS) {
    for (let at = text.indexOf(claim); at !== -1; at = text.indexOf(claim, at + claim.length)) {
      hits.push(claim)
    }
  }
  return hits
}

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

/** ⚑ What a person reads — the templates carry their reasoning inline, as comments. */
const shown = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** ⚑ The `title` of every element with this `data-cy`, decoded — `[]` when none is drawn. */
const titlesOf = (markup: string, cy: string): string[] =>
  [...shown(markup).matchAll(new RegExp(`<[a-z]+\\b[^>]*data-cy="${escapeRegExp(cy)}"[^>]*>`, 'g'))]
    .map((tag) => /\btitle="([^"]*)"/.exec(tag[0])?.[1])
    .filter((title): title is string => title !== undefined)
    .map(decode)

/** ⚑ How many times an element with this `data-cy` is drawn. */
const count = (markup: string, cy: string): number =>
  shown(markup).split(`data-cy="${cy}"`).length - 1

/**
 * ⚑ The foot's own markup, comments gone — where the key hint's `<strong>` can be read. ⚠️ The
 * component's scoped-style attribute (`data-v-…`) is dropped from every tag, so a hint reads as
 * `<strong>Esc</strong>` whatever the build hashes it to.
 */
function footMarkupOf(html: string): string {
  const body = /<p[^>]*data-cy="composer-hint"[^>]*>([\s\S]*?)<\/p>/.exec(shown(html))?.[1]
  expect(body, 'no composer-hint was drawn').toBeDefined()
  return body!.replace(/ data-v-[\w-]+(="[^"]*")?/g, '')
}

/** ⚑ The foot, as a person reads it — tags gone, whitespace collapsed. */
const footOf = (html: string): string =>
  decode(footMarkupOf(html).replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()

const composer = (props: Record<string, unknown>): Promise<string> =>
  render(PromptComposer, { draft: '', who: 'Codex', ...props })

/** ⚑ The platform the component asks (Node has a `navigator` since 21) — the labels it then draws. */
const PLATFORM = typeof navigator === 'undefined' ? '' : navigator.platform
const SEND_KEY = sendKeyLabel(PLATFORM)
const INTERRUPT_KEY = interruptKeyLabel(PLATFORM)

/** ⚑ R83's sentence for a person's unanswered ask in a Codex conversation — `main`'s own function. */
const R83_WORDS = stopJoinsThatAsk({ by: 'a-person', waitedMs: 2_000 }, 'codex')

/** ⚑ A conversation's meta as the host echoes it — `test/dom/harness.ts`' `META`, in node. */
const SESSION: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'codex',
  cwd: '/work',
  providerHome: '/homes/codex',
  profileId: DEFAULT_PROFILE_ID,
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
  config: {
    home: '/homes/codex',
    homeEnv: 'CODEX_HOME',
    model: 'gpt-5-codex',
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
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

// ⚑ **D-017b** — `fixed`: nothing set here would reach the conversation.
// ⚑ The approval mode's panel draws only on a press, so its words are read off the fold that
// writes them — the one the card's panel draws (`card-approval-now`, pinned in the DOM project).
const approval = (over: Partial<CreatedSession>, fixed = false) =>
  useConversationControls({
    session: () => ({ ...SESSION, ...over }),
    capabilities: () => null,
    fixed: () => fixed,
    recorded: () => fixed,
    setApprovalMode: () => {},
    setSessionSetting: () => {},
  }).approval.value

const approvalTitle = async (over: Partial<CreatedSession>): Promise<string> => {
  const said = approval(over)?.now
  expect(said, 'the approval mode said nothing').toBeDefined()
  return said!
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · busy — the Stop and the foot
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · `busy`: the Stop’s title and the foot say the turn is ASKED to stop', () => {
  it('🔴 the Stop is titled *Stop — the turn is asked to stop (Esc)*, and the foot says Esc is Stop and a message still queues', async () => {
    const html = await composer({ state: 'busy' })
    expect(count(html, 'interrupt-session')).toBe(1)
    // ⛔ What `main` draws is read first, so a RED on `main` is about the words.
    expect(titlesOf(html, 'interrupt-session')).toEqual([BUSY_TITLE])
    expect(footOf(html)).toBe(BUSY_FOOT)
    // ⚑ The key hint is the foot's own `<strong>`, as R83's foot draws it.
    expect(footMarkupOf(html)).toContain(
      `<strong>Esc</strong> is Stop: ${THE_TURN_IS_ASKED_TO_STOP}.`,
    )
    // ⚑ rule 5 — the clause is the module's, and the module's is `ASKED_TO_STOP`'s bytes.
    const { A_STOP_ASKS_THE_TURN } = await since737()
    expect(A_STOP_ASKS_THE_TURN).toBe(`the turn is ${ASKED_TO_STOP}`)
    expect(A_STOP_ASKS_THE_TURN).toBe(THE_TURN_IS_ASKED_TO_STOP)
    expect(titlesOf(html, 'interrupt-session')).toEqual([`Stop — ${A_STOP_ASKS_THE_TURN} (Esc)`])
    expect(footOf(html)).toBe(
      `Codex is working — type to queue a message. Esc is Stop: ${A_STOP_ASKS_THE_TURN}.`,
    )
  })

  it('🔴 a double with every optional prop omitted — `who`, `interruptible`, `hasQueued`, `stopUnanswered` at their defaults — draws the same words for *The agent*', async () => {
    const html = await render(PromptComposer, { state: 'busy', draft: '' })
    expect(titlesOf(html, 'interrupt-session')).toEqual([BUSY_TITLE])
    expect(footOf(html)).toBe(
      'The agent is working — type to queue a message. Esc is Stop: the turn is asked to stop.',
    )
  })

  it('🔴 with a message already waiting, the foot still offers to queue — behind it (D-010)', async () => {
    const html = await composer({ state: 'busy', hasQueued: true })
    // ⚑ **D-010** — a second queue was refused until several could wait (`737` dropped *type to
    // queue* here for that); it is held behind now, so the foot and the placeholder offer it.
    expect(footOf(html)).toBe(BUSY_FOOT)
    // ⚑ …and the Stop itself is the same Stop.
    expect(titlesOf(html, 'interrupt-session')).toEqual([BUSY_TITLE])
    const { A_STOP_ASKS_THE_TURN } = await since737()
    expect(footOf(html)).toBe(
      `Codex is working — type to queue a message. Esc is Stop: ${A_STOP_ASKS_THE_TURN}.`,
    )
    expect(html).toContain('placeholder="Codex is working — type to queue a message…"')
  })

  it('⚑ THE CONTROL — `hasQueued: false`, said out loud, is the omitted prop: *type to queue* is offered', async () => {
    const html = await composer({ state: 'busy', hasQueued: false })
    expect(footOf(html)).toContain('Codex is working — type to queue a message')
    expect(count(html, 'interrupt-session')).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · frozen — the Stop and the foot's Esc clause
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · `frozen`: the Stop instead of answering, in R43’s words', () => {
  it('🔴 the Stop is titled *Stop instead of answering — the turn is asked to stop (Esc)*, and the foot’s Esc clause says the same', async () => {
    const html = await composer({ state: 'frozen' })
    expect(count(html, 'interrupt-session')).toBe(1)
    expect(titlesOf(html, 'interrupt-session')).toEqual([FROZEN_TITLE])
    expect(footOf(html)).toBe(FROZEN_FOOT)
    expect(footMarkupOf(html)).toContain(
      `<strong>Esc</strong> is Stop: ${THE_TURN_IS_ASKED_TO_STOP}`,
    )
    // ⚑ The half `094` wrote and five suites pin is untouched: a message still will not answer it.
    expect(
      footOf(html).startsWith("Answer the request above to continue. A message won't answer it"),
    ).toBe(true)
    const { A_STOP_ASKS_THE_TURN } = await since737()
    expect(titlesOf(html, 'interrupt-session')).toEqual([
      `Stop instead of answering — ${A_STOP_ASKS_THE_TURN} (Esc)`,
    ])
    expect(footOf(html)).toBe(
      `Answer the request above to continue. A message won't answer it, but Esc is Stop: ${A_STOP_ASKS_THE_TURN}.`,
    )
  })

  it('⚑ THE CONTROL — `frozen` and NOT interruptible: no Stop, and the foot has no Esc clause at all', async () => {
    const html = await composer({ state: 'frozen', interruptible: false })
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(footOf(html)).toBe("Answer the request above to continue. A message won't answer it.")
    expect(footOf(html)).not.toContain('Esc')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the approval control's title — the rule 8.1 sweep of the same claim
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚑ **737 review** — the sentence ENDS at the mode: it went on *"To stop this one now, interrupt it."*
 * (`main`), which R43 made false, and a mode stays pending after the turn ends, where there is no
 * Stop to press — so no clause about the turn is true in every state that reaches the title.
 */
describe('§3 · the approval mode: a pending mode says what the mode does, and nothing a press would do', () => {
  it('🔴 `ask` with `auto` pending — the title ends at *…a turn that is already running.*', async () => {
    const title = await approvalTitle({ approvalMode: 'ask', pendingApprovalMode: 'auto' })
    expect(title).toBe(ASKS_NOW_PENDING_AUTO)
    expect(oldClaimsIn(title)).toEqual([])
    expect(title).not.toMatch(/Stop|interrupt/)
  })

  it('🔴 `auto` with `ask` pending — the same last sentence', async () => {
    const title = await approvalTitle({ approvalMode: 'auto', pendingApprovalMode: 'ask' })
    expect(title).toBe(AUTO_NOW_PENDING_ASK)
    expect(title).not.toMatch(/Stop|interrupt/)
  })

  it('⚑ THE CONTROL — no pending mode: the mode and when a change applies, no running turn and no Stop', async () => {
    expect(await approvalTitle({ approvalMode: 'ask', pendingApprovalMode: null })).toBe(
      'This session asks what its provider’s own CLI asks by default. Changes apply from your next message.',
    )
    expect(await approvalTitle({ approvalMode: 'auto', pendingApprovalMode: null })).toBe(
      'This session runs commands and edits files without asking, except what the provider’s own plan mode asks while it plans. Changes apply from your next message.',
    )
  })

  it('⚑ THE CONTROL — a conversation whose settings are fixed offers no change, and its words claim no press either', async () => {
    const fixed = approval({ approvalMode: 'ask', pendingApprovalMode: 'auto' }, true)
    expect(fixed?.changeable).toBe(false)
    expect(fixed?.now).toBe(ASKS_NOW_PENDING_AUTO)
    expect(oldClaimsIn(fixed?.now ?? '')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the search shape — no old claim on any Stop word, and the search can fire
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · no word of the Stop claims the press ends the turn', () => {
  /** ⚑ Every sentence this draw owns, read off the elements that draw them. */
  async function everyStopWord(): Promise<string[]> {
    const busy = await composer({ state: 'busy' })
    const queued = await composer({ state: 'busy', hasQueued: true })
    const frozen = await composer({ state: 'frozen' })
    return [
      ...titlesOf(busy, 'interrupt-session'),
      footOf(busy),
      footOf(queued),
      ...titlesOf(frozen, 'interrupt-session'),
      footOf(frozen),
      await approvalTitle({ approvalMode: 'ask', pendingApprovalMode: 'auto' }),
      await approvalTitle({ approvalMode: 'auto', pendingApprovalMode: 'ask' }),
    ]
  }

  it('🔴 the search over all seven finds no old claim — and each of the Stop’s five says the ask', async () => {
    const words = await everyStopWord()
    // ⚑ The premise: seven real sentences, so the search below is over something.
    expect(words).toHaveLength(7)
    for (const one of words) expect(one.length).toBeGreaterThan(20)
    expect(oldClaimsIn(words.join('\n'))).toEqual([])
    // ⚑ …beside the positive the same words satisfy — the Stop's own five (the drawer's two say
    // nothing a press does, 737 review).
    for (const one of words.slice(0, 5)) expect(one, one).toContain(ASKED_TO_STOP)
  })

  it('⚑ THE CONTROL (rule 12) — the same search over a planted string of TWO old claims finds exactly two', () => {
    const planted =
      "Interrupt the running turn (Esc)\nAnswer the request above to continue. A message won't answer it, but Esc stops the turn."
    expect(oldClaimsIn(planted)).toEqual(['Interrupt the', 'stops the turn'])
    // ⚑ …and every claim on the list can fire on its own, once.
    for (const claim of OLD_CLAIMS) expect(oldClaimsIn(`a ${claim} b`), claim).toEqual([claim])
  })

  it('⚑ THE CONTROL — R83’s words, which a press joins rather than repeats, carry no old claim either', async () => {
    const html = await composer({ state: 'busy', stopUnanswered: R83_WORDS })
    const words = [...titlesOf(html, 'interrupt-session'), footOf(html)]
    expect(words).toHaveLength(2)
    expect(oldClaimsIn(words.join('\n'))).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the neighbours this draw leaves alone
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · the words beside the Stop are untouched (scope)', () => {
  it('⚑ THE CONTROL — `busy` WITH R83’s sentence: its title and foot, not the busy words', async () => {
    const html = await composer({ state: 'busy', stopUnanswered: R83_WORDS })
    expect(titlesOf(html, 'interrupt-session')).toEqual([`${R83_WORDS} (Esc)`])
    expect(footOf(html)).toBe(`${R83_WORDS}. Esc is Stop; type to queue a message.`)
    expect(footOf(html)).not.toContain(THE_TURN_IS_ASKED_TO_STOP)
    // ⚑ **D-010** — and the same with a message already waiting: a second is held behind it.
    const queued = await composer({ state: 'busy', stopUnanswered: R83_WORDS, hasQueued: true })
    expect(footOf(queued)).toBe(`${R83_WORDS}. Esc is Stop; type to queue a message.`)
  })

  it('⚑ THE CONTROL — `busy` and NOT interruptible (a closing conversation): no Stop, and the foot says only who is working', async () => {
    const html = await composer({ state: 'busy', interruptible: false })
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(footOf(html)).toBe('Codex is working…')
    expect(footOf(html)).not.toContain('Esc')
  })

  it('⚑ THE CONTROL — the launcher’s `starting`: its own Cancel, titled as it was, and no Esc', async () => {
    const html = await composer({ state: 'starting' })
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(count(html, 'cancel-launch')).toBe(1)
    expect(titlesOf(html, 'cancel-launch')).toEqual(['Stop opening this conversation'])
    expect(footOf(html)).toBe('Codex is starting this conversation…')
    expect(footOf(html)).not.toContain('Esc')
  })

  /**
   * ⚑ **Re-aimed at `739`** (rule 26 — strip AND re-aim; `739` review #21). This control pinned
   * interrupt-and-send's OLD words as *"the neighbours left alone"* by this draw; `739` Draw 5
   * answers `737` F-7 — *"Interrupt-and-send still claims a stop — "Stop Codex and send this
   * instead", "to interrupt and send now""* — so those words MOVED, and a pin on them is a subject
   * now: it is §5b's, below, outside this describe. ⚑ What stays here is what this draw left alone
   * and is true on both trees: with a DRAFT the pair steps in for the Stop, the queue's title is as
   * it was, and neither the pair's title nor the foot is the busy Stop's own sentence (§4's census of
   * seven stays the Stop's own).
   */
  it('⚑ THE CONTROL — `busy` with a draft: the pair, not the Stop, and neither its title nor its foot is the Stop’s sentence', async () => {
    const html = await composer({ state: 'busy', draft: 'no, do this instead' })
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(count(html, 'interrupt-send-prompt')).toBe(1)
    expect(titlesOf(html, 'queue-prompt')).toEqual([
      `Let Codex finish, then send this (${SEND_KEY})`,
    ])
    // ⚑ The pair's title and the foot are real sentences, so the negatives below are about them.
    const [title] = titlesOf(html, 'interrupt-send-prompt')
    expect(title?.length ?? 0).toBeGreaterThan(20)
    expect(
      footOf(html).startsWith(`${SEND_KEY} to send after Codex finishes · ${INTERRUPT_KEY} `),
    ).toBe(true)
    // ⚑ …and none of them is the busy Stop's own sentence, which this draw did not move.
    expect(title).not.toBe(BUSY_TITLE)
    expect(footOf(html)).not.toBe(BUSY_FOOT)
    // ⚑ **D-027 moved the waiting foot's first half**: what waits no longer goes first — this goes
    // WITH it, in one turn, oldest first, a command alone. It said *"…after Codex finishes and
    // takes what is already waiting"*.
    const queued = await composer({ state: 'busy', draft: 'no, do this instead', hasQueued: true })
    expect(
      footOf(queued).startsWith(
        `${SEND_KEY} to send when Codex finishes, with what is already waiting — a command goes alone · ${INTERRUPT_KEY} `,
      ),
    ).toBe(true)
    expect(footOf(queued)).not.toBe(BUSY_FOOT)
  })

  it('⚑ THE CONTROL — `idle` draws no Stop and the send foot; `blocked` outranks the busy foot', async () => {
    const idle = await composer({ state: 'idle' })
    expect(count(idle, 'interrupt-session')).toBe(0)
    expect(footOf(idle)).toBe(`${SEND_KEY} to send · Enter for a new line`)
    const blocked = 'This conversation’s folder is gone.'
    expect(footOf(await composer({ state: 'busy', blocked }))).toBe(blocked)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5b · interrupt-and-send — the neighbour `739` moved (`737` F-7), no longer left alone
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5b · interrupt-and-send, which `739` moved: its title and foot are Stop and send’s', () => {
  /**
   * 🔴 **`739` Draw 5, seen from this file** (`739` review #21: it stood under *"untouched"* as a
   * control, and it is RED on `main` 5f406f2f by assertion — `main` draws *"Stop Codex and send
   * this instead"* and *"to interrupt and send now"*). ⚑ The words are pinned whole, limit and all,
   * by `stop-and-send-says-it-asks.render.test.ts`; this keeps the neighbour's own reading here, in
   * the clause this file owns (`THE_TURN_IS_ASKED_TO_STOP`).
   */
  it('🔴 `busy` with a draft: the pair’s title and the foot say Stop and send in R43’s words, with the host’s limit', async () => {
    const html = await composer({ state: 'busy', draft: 'no, do this instead' })
    const STOP_THEN_SENT = `${THE_TURN_IS_ASKED_TO_STOP}; this is sent once it has ended, or comes back to you if it has not within seconds`
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([
      `Stop and send — ${STOP_THEN_SENT} (${INTERRUPT_KEY})`,
    ])
    expect(footOf(html)).toBe(
      `${SEND_KEY} to send after Codex finishes · ${INTERRUPT_KEY} is Stop and send: ${STOP_THEN_SENT}`,
    )
    // ⚑ **D-027** — with something waiting, this goes WITH it, in one turn (see §5's control).
    const queued = await composer({ state: 'busy', draft: 'no, do this instead', hasQueued: true })
    expect(footOf(queued)).toBe(
      `${SEND_KEY} to send when Codex finishes, with what is already waiting — a command goes alone · ${INTERRUPT_KEY} is Stop and send: ${STOP_THEN_SENT}`,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §6 · one spelling — the composer composes the clause, never types it
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§6 · the clause has one spelling, and the composer reads it — the drawer claims nothing a press does (737 review)', () => {
  const source = (path: string): string =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

  /** ⛔ Prose is not code — the templates' comments quote the old words and name the new ones. */
  const codeOnly = (text: string): string =>
    text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  const COMPOSER = '../src/renderer/src/components/PromptComposer.vue'
  const CONTROLS = '../src/renderer/src/composables/useConversationControls.ts'
  const APPROVAL = '../src/renderer/src/components/CardApproval.vue'
  const MODULE = '../src/renderer/src/lib/stop-unanswered.ts'

  it('🔴 `PromptComposer` imports `A_STOP_ASKS_THE_TURN` and draws it, and spells *asked to stop* nowhere itself', () => {
    // ⚑ 737 review: the approval mode does not say what a press does (its sentence ends at the
    // mode), so neither its words nor its panel import the clause or spell the claim.
    for (const path of [CONTROLS, APPROVAL]) {
      expect(codeOnly(source(path)), path).not.toContain(ASKED_TO_STOP)
      expect(codeOnly(source(path)), path).not.toMatch(/interrupt it/)
    }
    for (const [name, path, draws] of [
      ['PromptComposer.vue', COMPOSER, ['${A_STOP_ASKS_THE_TURN}', '{{ A_STOP_ASKS_THE_TURN }}']],
    ] as const) {
      const code = codeOnly(source(path))
      expect(code, `${name} imports the clause`).toMatch(
        /import \{ A_STOP_ASKS_THE_TURN \} from '\.\.\/lib\/stop-unanswered'/,
      )
      // ⛔ The import, and then the USE — an unused import passes an import census.
      for (const use of draws) expect(code, `${name} draws ${use}`).toContain(use)
      // 🔴 And no second spelling: a literal would say the same bytes today and drift tomorrow.
      expect(code, `${name} spells the claim itself`).not.toContain(ASKED_TO_STOP)
    }
  })

  it('🔴 the clause is composed from `ASKED_TO_STOP`, once', () => {
    const code = codeOnly(source(MODULE))
    const declared = code.split('\n').filter((line) => line.includes('A_STOP_ASKS_THE_TURN ='))
    expect(declared).toHaveLength(1)
    expect(declared[0]).toContain('`the turn is ${ASKED_TO_STOP}`')
    expect(code).not.toContain(`'${ASKED_TO_STOP}'`)
  })

  it('⚑ THE CONTROL — the stripper leaves the code: the Stop and the approval control are still in it', () => {
    expect(codeOnly(source(COMPOSER))).toContain('data-cy="interrupt-session"')
    expect(codeOnly(source(APPROVAL))).toContain('data-cy="card-approval"')
    expect(codeOnly(source(CONTROLS))).toContain('You have asked it to')
    expect(codeOnly(source(MODULE))).toContain('export function stopJoinsThatAsk(')
    // ⚑ …and it does strip: a template comment on both trees is gone from the code.
    const aComment = 'A turn frozen on a card is the one a'
    expect(source(COMPOSER)).toContain(aComment)
    expect(codeOnly(source(COMPOSER))).not.toContain(aComment)
  })
})
