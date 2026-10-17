import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PromptComposer, {
  interruptKeyLabel,
  sendIntentFor,
  sendKeyLabel,
} from '../src/renderer/src/components/PromptComposer.vue'
import { stopJoinsThatAsk } from '../src/renderer/src/lib/stop-unanswered'
import { ASKED_TO_STOP } from '../src/shared/how-work-stopped'

/**
 * # 🔴 739 · Draw 5 — *Stop and send* says what a press does: the turn is ASKED to stop (`737` F-7)
 *
 * ⚑ **The finding, verbatim** (`737` §7, F-7): *"**Interrupt-and-send still claims a stop** —
 * "Stop Codex and send this instead", "to interrupt and send now". `730` kept them and tests pin
 * them; outside this brief."* ⚑ **The brief** (`739` §2.5): *"promise a stop; since R43 the provider
 * may finish first. Say it as an ask."*
 *
 * ⚑ **The ruling it answers, verbatim** (`709` §1): *"**R43 (`704` H-3) · The ledger records the
 * provider's word.** … A turn is `interrupted` only when the provider says it was."*
 *
 * ⛔ **So the press ASKS, and the words go once the turn has ENDED** — stopped, or finished first
 * (`RuntimeHost.runSendInterrupting`: ask, a bounded wait, then the send). *instead* was false when
 * the provider finished first, and *now* was false for the whole bounded wait. ⚑ `739` composes the
 * words from `737`'s clause — `A_STOP_THEN_THIS_IS_SENT` = `${A_STOP_ASKS_THE_TURN}; this is sent
 * once it has ended, or comes back to you if it has not within seconds`.
 *
 * ⚠️ **Re-aimed at `739`'s review round 1** (rule 26; `739` #2, #25, #4). ⛔ The clause said *"…, and
 * this is sent once it has ended"* with no limit, in all three feet, and the title alone added *"; if
 * it does not end, this comes back to you"* — ⚑ but the host sends only if the turn has ended within
 * ITS bounded waits (the ask's 2 s, then `waitForIdle`'s 5 s); a Codex turn that ends at 8 s has
 * ended, and the words came back. ⚑ So the limit is IN the clause — *"or comes back to you if it
 * has not within seconds"* — and the title and the three feet each carry it, because each draws the
 * clause. §1–§3 pin the new bytes whole; §3 also refuses the round-0 title's *"if it does not end"*.
 *
 * | § | surface | 🔴 subject (RED on `main` 5f406f2f, by assertion) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 1 | `PromptComposer`, `busy` WITH a draft | the interrupt-and-send title and the foot, in R43's words, the limit in each; also with every optional prop omitted, and with R83's standing ask (it asks anew, `723` F-5) | — |
 * | 2 | …with a message already waiting | the one foot — queued behind it since D-010, and with it, in one turn, since D-027, whoever wrote it — the limit in it | the queue's title with what waits |
 * | 3 | the three sentences above (four until D-010 folded the two waiting feet) | a SEARCH SHAPE for the old claims finds none, and each carries the limit and not round 0's *if it does not end* | the same search over `main`'s four planted finds each; every claim fires alone |
 * | 4 | the neighbours this draw leaves alone | — | the plain Stop; the queue title; R83's foot; what a press MEANS (`sendIntentFor`) |
 * | 5 | the one spelling | the composer imports the new clause and draws it three times (four until D-010), spelling neither half; the module composes it from `A_STOP_ASKS_THE_TURN` | `737`'s import line is byte-identical; the stripper leaves code |
 *
 * ⚠️ **What `main` (5f406f2f; 176a860f before it) draws instead**, measured: the title *"Stop Codex and send this
 * instead (⇧⌘↵)"*; the foot *"⌘↵ to send after Codex finishes · ⇧⌘↵ to interrupt and send now"*;
 * with a message waiting *"A message is already waiting. Cancel it in the transcript before queueing
 * another, or ⇧⌘↵ to interrupt and send this now."*, and the not-yours foot *"… Wait for it to go
 * before queueing another, or ⇧⌘↵ to interrupt and send this now."*
 *
 * ⚠️ **`A_STOP_THEN_THIS_IS_SENT` is NEW** (the module is `730`'s and is on `main`; the export is
 * not): it is reached only INSIDE subjects, by a dynamic `import()` after the drawing was asserted,
 * so on `main` a subject fails on what `main` draws and the controls still run.
 *
 * ⚠️ **SSR** ([[brobot2-ssr-tests-pass-vacuously]]) — every reading is taken off the ELEMENT (a
 * `title`, the foot's text) with the markup's comments stripped, never off the whole markup: the
 * template's own comments QUOTE the old words (`739`: *it said "stops the turn and sends it
 * instead"*). Every negative sits beside a positive the same markup satisfies. ⚑ **No new wire
 * field is read by this draw**, so no double can lag behind one; the props a caller may omit are
 * the doubles here, and §1 mounts with every one at its default. ⚑ **The behaviour is unchanged** —
 * one send with intent `interrupt` per click and per chord — and the engine's half (the foot drawn
 * whole at the pane's width, and the press) is `test/dom/stop-and-send-says-it-asks.dom.test.ts`.
 */

/** ⚑ The new export — read inside subjects only (see the header). */
const since739 = (): Promise<typeof import('../src/renderer/src/lib/stop-unanswered')> =>
  import('../src/renderer/src/lib/stop-unanswered')

/** ⚑ The platform the component asks (Node has a `navigator` since 21) — the labels it then draws. */
const PLATFORM = typeof navigator === 'undefined' ? '' : navigator.platform
const SEND_KEY = sendKeyLabel(PLATFORM)
const INTERRUPT_KEY = interruptKeyLabel(PLATFORM)

/**
 * ⚑ The clause and its four sentences — verbatim ONCE; rule 5 composes each below as well.
 * ⚠️ `739` review round 1: the limit is in the clause (see the header), so each sentence carries it.
 */
const THE_TURN_IS_ASKED_TO_STOP = 'the turn is asked to stop'
const THE_LIMIT = 'or comes back to you if it has not within seconds'
const STOP_THEN_SENT =
  'the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds'
const TITLE = `Stop and send — the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds (${INTERRUPT_KEY})`
const FOOT = `${SEND_KEY} to send after Codex finishes · ${INTERRUPT_KEY} is Stop and send: the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds`
/**
 * ⚑ **D-010** — one foot while something waits, whoever wrote it. ⚑ **D-027 moved its first half**:
 * what waits no longer goes first, one turn each — this goes WITH it, in one turn, oldest first, and
 * only a command goes alone; it said *"…after Codex finishes and takes what is already waiting"*.
 */
const FOOT_WAITING = `${SEND_KEY} to send when Codex finishes, with what is already waiting — a command goes alone · ${INTERRUPT_KEY} is Stop and send: the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds`
/**
 * ⛔ `739` round 0's title limit — an unbounded condition: the host hands the words back when the
 * turn has not ended within ITS waits, not when it *does not end* (`739` #2, #25).
 */
const ROUND_0_LIMIT = 'if it does not end'

/** ⚑ The neighbours this draw leaves alone — verbatim, as `main` draws them too. */
const PLAIN_STOP_TITLE = 'Stop — the turn is asked to stop (Esc)'
const QUEUE_TITLE = `Let Codex finish, then send this (${SEND_KEY})`
/** ⚑ **D-027** — with what waits, in one turn; it said *"…finish and take what is already waiting, then send this"*. */
const QUEUE_BEHIND = `Let Codex finish, then send this with what is already waiting — a command goes alone (${SEND_KEY})`

/**
 * ⛔ **The old claims** — each promises a stop (or a send that does not wait for the turn to end),
 * which R43 made false. `737` F-7's own words and `main`'s spellings of them.
 */
const OLD_CLAIMS = [
  'instead',
  'and send now',
  'send this now',
  'interrupt and send',
  'Stop Codex and',
] as const

/** ⚑ Every occurrence of every old claim in `text`, in list order — the search shape §3 plants. */
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
 * component's scoped-style attribute (`data-v-…`) is dropped from every tag.
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

const DRAFT = 'no, look at the migration first'

const composer = (props: Record<string, unknown>): Promise<string> =>
  render(PromptComposer, { draft: '', who: 'Codex', ...props })

/** ⚑ `busy` with something to send — the state the pair of buttons is drawn in (`busyChoices`). */
const busyWithADraft = (props: Record<string, unknown> = {}): Promise<string> =>
  composer({ state: 'busy', draft: DRAFT, ...props })

/** ⚑ R83's sentence for a person's unanswered ask in a Codex conversation — `main`'s own function. */
const R83_WORDS = stopJoinsThatAsk({ by: 'a-person', waitedMs: 2_000 }, 'codex')

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · busy with a draft — the title and the foot
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · `busy` with a draft: *Stop and send* says the turn is ASKED to stop, and this goes once it has ended', () => {
  it('🔴 the interrupt-and-send button is titled in R43’s words — the ask, the send once it has ended, and the limit, all in the clause', async () => {
    const html = await busyWithADraft()
    // ⚑ The premise: the pair is drawn, and the plain Stop has stepped aside for it.
    expect(count(html, 'interrupt-send-prompt')).toBe(1)
    expect(count(html, 'queue-prompt')).toBe(1)
    expect(count(html, 'interrupt-session')).toBe(0)
    // ⛔ What `main` draws is read first, so a RED on `main` is about the words.
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([TITLE])
    // ⚑ rule 5 — the clause is the module's, and the module's is `737`'s clause plus the send.
    const { A_STOP_ASKS_THE_TURN, A_STOP_THEN_THIS_IS_SENT } = await since739()
    expect(A_STOP_ASKS_THE_TURN).toBe(THE_TURN_IS_ASKED_TO_STOP)
    expect(A_STOP_THEN_THIS_IS_SENT).toBe(
      `${A_STOP_ASKS_THE_TURN}; this is sent once it has ended, ${THE_LIMIT}`,
    )
    expect(A_STOP_THEN_THIS_IS_SENT).toBe(STOP_THEN_SENT)
    expect(A_STOP_THEN_THIS_IS_SENT).toContain(ASKED_TO_STOP)
    // ⚑ `739` review round 1: the title is the clause and the chord — no clause of its own beside it.
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([
      `Stop and send — ${A_STOP_THEN_THIS_IS_SENT} (${INTERRUPT_KEY})`,
    ])
  })

  it('🔴 the foot says ⇧⌘↵ is Stop and send, in the same clause, limit and all — and the queue half is unchanged', async () => {
    const html = await busyWithADraft()
    expect(footOf(html)).toBe(FOOT)
    // ⚑ `739` #2: the foot is always visible and promised the send without condition.
    expect(footOf(html)).toContain(THE_LIMIT)
    // ⚑ The key hint is the foot's own `<strong>`, as 737's busy foot draws Esc.
    expect(footMarkupOf(html)).toContain(`<strong>${INTERRUPT_KEY}</strong> is Stop and send: `)
    // ⚑ …and the half `077` wrote is untouched, `<strong>` and all.
    expect(footMarkupOf(html)).toContain(
      `<strong>${SEND_KEY}</strong> to send after Codex finishes`,
    )
    const { A_STOP_THEN_THIS_IS_SENT } = await since739()
    expect(footOf(html)).toBe(
      `${SEND_KEY} to send after Codex finishes · ${INTERRUPT_KEY} is Stop and send: ${A_STOP_THEN_THIS_IS_SENT}`,
    )
  })

  it('🔴 a double with every optional prop omitted — `who`, `interruptible`, `hasQueued`, `stopUnanswered` at their defaults — draws the same words, *The agent* only in the queue half', async () => {
    const html = await render(PromptComposer, { state: 'busy', draft: DRAFT })
    // ⚑ The title names no one, so a default `who` cannot make it read *Stop The agent …*.
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([TITLE])
    expect(footOf(html)).toBe(FOOT.replace('after Codex finishes', 'after The agent finishes'))
  })

  it('🔴 with R83’s standing ask the words are the same — Stop and send asks ANEW (`723` F-5), it does not join', async () => {
    const html = await busyWithADraft({ stopUnanswered: R83_WORDS })
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([TITLE])
    expect(footOf(html)).toBe(FOOT)
    // ⚑ …beside the positive above: R83's *has not answered* is the plain Stop's, not this press's.
    expect(footOf(html)).not.toContain('has not answered')
    expect(titlesOf(html, 'interrupt-send-prompt')[0]).not.toContain('has not answered')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · a message already waiting — one foot since D-010, whoever wrote it
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · with a message already waiting, the foot queues behind it and still says ⇧⌘↵ asks', () => {
  /**
   * ⚑ **D-010** — until then the foot said *"Cancel it … before queueing another"* (the person's
   * own) or *"Wait for it to go …"* (one they did not write, 688 R22), because the host refused a
   * second held message. It holds any number now, so there is one foot, and it queues behind.
   * ⚑ **D-027** — and what is held goes out together, in one turn, oldest first, a command alone:
   * the foot and the Queue title say *"with what is already waiting — a command goes alone"*.
   */
  it('🔴 whoever wrote what waits: queue behind it, then Stop and send in R43’s words, limit and all', async () => {
    const html = await busyWithADraft({ hasQueued: true })
    expect(footOf(html)).toBe(FOOT_WAITING)
    expect(footOf(html)).toContain(THE_LIMIT)
    expect(footOf(html)).not.toContain('Cancel it')
    expect(footMarkupOf(html)).toContain(`<strong>${INTERRUPT_KEY}</strong> is Stop and send:`)
    // ⚑ The title does not depend on the queue — the same Stop and send.
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([TITLE])
    const { A_STOP_THEN_THIS_IS_SENT } = await since739()
    expect(
      footOf(html).endsWith(`${INTERRUPT_KEY} is Stop and send: ${A_STOP_THEN_THIS_IS_SENT}`),
    ).toBe(true)
  })

  it('⚑ THE CONTROL — the queue button offers to go behind what waits, and is not disabled', async () => {
    const waiting = await busyWithADraft({ hasQueued: true })
    expect(titlesOf(waiting, 'queue-prompt')).toEqual([QUEUE_BEHIND])
    // ⚑ …beside the title with nothing waiting, one fact over.
    expect(titlesOf(await busyWithADraft(), 'queue-prompt')).toEqual([QUEUE_TITLE])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the search shape — no old claim in the four, and the search can fire
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · no word of Stop and send promises a stop', () => {
  /** ⚑ Every sentence this draw owns, read off the elements that draw them. */
  async function everyStopAndSendWord(): Promise<string[]> {
    const free = await busyWithADraft()
    const waiting = await busyWithADraft({ hasQueued: true })
    return [...titlesOf(free, 'interrupt-send-prompt'), footOf(free), footOf(waiting)]
  }

  it('🔴 the search over all three finds no old claim — and each says the ask, the send once it has ended, and the limit', async () => {
    const words = await everyStopAndSendWord()
    // ⚑ The premise: three real sentences (four until D-010), so the search below is over something.
    expect(words).toHaveLength(3)
    for (const one of words) expect(one.length).toBeGreaterThan(20)
    expect(oldClaimsIn(words.join('\n'))).toEqual([])
    // ⚑ …beside the positive the same words satisfy.
    for (const one of words) {
      expect(one, one).toContain(ASKED_TO_STOP)
      expect(one, one).toContain(STOP_THEN_SENT)
      // ⚑ `739` #2, #25: every one of them carries the host's limit, not only the hover…
      expect(one, one).toContain(THE_LIMIT)
      // ⛔ …and none says round 0's unbounded *if it does not end* — beside the positive above.
      expect(one, one).not.toContain(ROUND_0_LIMIT)
    }
  })

  it('⚑ THE CONTROL (rule 12) — the same search over `main`’s four sentences, planted, finds every claim they make', () => {
    const planted = [
      `Stop Codex and send this instead (${INTERRUPT_KEY})`,
      `${SEND_KEY} to send after Codex finishes · ${INTERRUPT_KEY} to interrupt and send now`,
      `A message is already waiting. Cancel it in the transcript before queueing another, or ${INTERRUPT_KEY} to interrupt and send this now.`,
      `A message you did not write is already waiting — its entry in the transcript says whose it is. Wait for it to go before queueing another, or ${INTERRUPT_KEY} to interrupt and send this now.`,
    ].join('\n')
    expect(oldClaimsIn(planted)).toEqual([
      'instead',
      'and send now',
      'send this now',
      'send this now',
      'interrupt and send',
      'interrupt and send',
      'interrupt and send',
      'Stop Codex and',
    ])
    // ⚑ …and every claim on the list can fire on its own, once.
    for (const claim of OLD_CLAIMS) expect(oldClaimsIn(`a ${claim} b`), claim).toEqual([claim])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the neighbours this draw leaves alone
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the words and the press beside Stop and send are untouched (scope)', () => {
  it('⚑ THE CONTROL — `busy` with NO draft: the plain Stop, titled as `737` left it, and no pair', async () => {
    const html = await composer({ state: 'busy' })
    expect(count(html, 'interrupt-send-prompt')).toBe(0)
    expect(titlesOf(html, 'interrupt-session')).toEqual([PLAIN_STOP_TITLE])
    expect(footOf(html)).toBe(
      'Codex is working — type to queue a message. Esc is Stop: the turn is asked to stop.',
    )
  })

  it('⚑ THE CONTROL — the queue button’s title while the queue is free: *Let Codex finish, then send this*', async () => {
    const html = await busyWithADraft()
    expect(titlesOf(html, 'queue-prompt')).toEqual([QUEUE_TITLE])
  })

  it('⚑ THE CONTROL — `busy` with NO draft and R83’s sentence: R83’s title and foot, not these', async () => {
    const html = await composer({ state: 'busy', stopUnanswered: R83_WORDS })
    expect(titlesOf(html, 'interrupt-session')).toEqual([`${R83_WORDS} (Esc)`])
    expect(footOf(html)).toBe(`${R83_WORDS}. Esc is Stop; type to queue a message.`)
    expect(footOf(html)).not.toContain('Stop and send')
  })

  it('⚑ THE CONTROL — what a press MEANS is unchanged: ⇧ while busy is `interrupt`, the plain chord queues', () => {
    expect(sendIntentFor('busy', true)).toBe('interrupt')
    expect(sendIntentFor('busy', false)).toBe('queue')
    expect(sendIntentFor('idle', true)).toBe('now')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · one spelling — the composer composes the clause, never types it
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · the clause has one spelling, composed from `737`’s, and the composer reads it', () => {
  const source = (path: string): string =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

  /** ⛔ Prose is not code — the template's comments quote the old words and name the new ones. */
  const codeOnly = (text: string): string =>
    text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  const COMPOSER = '../src/renderer/src/components/PromptComposer.vue'
  const MODULE = '../src/renderer/src/lib/stop-unanswered.ts'
  const SECOND_HALF = 'sent once it has ended'

  it('🔴 `PromptComposer` imports `A_STOP_THEN_THIS_IS_SENT`, draws it in the title and the two feet, and spells neither half — nor the limit — itself', () => {
    const code = codeOnly(source(COMPOSER))
    expect(code).toMatch(/import \{ A_STOP_THEN_THIS_IS_SENT \} from '\.\.\/lib\/stop-unanswered'/)
    // ⛔ The import, and then the USE — an unused import passes an import census.
    expect(code.split('${A_STOP_THEN_THIS_IS_SENT}').length - 1, 'the title').toBe(1)
    // ⚑ Two since D-010 folded the two waiting feet into one.
    expect(code.split('{{ A_STOP_THEN_THIS_IS_SENT }}').length - 1, 'the two feet').toBe(2)
    // 🔴 And no second spelling: a literal would say the same bytes today and drift tomorrow.
    expect(code).not.toContain(ASKED_TO_STOP)
    expect(code).not.toContain(SECOND_HALF)
    // ⚑ `739` review round 1: the limit is the clause's, so the title spells no limit of its own.
    expect(code).not.toContain('comes back to you')
    expect(code).not.toContain(ROUND_0_LIMIT)
  })

  it('🔴 the clause is composed from `A_STOP_ASKS_THE_TURN`, once — and the module types *asked to stop* nowhere', () => {
    const code = codeOnly(source(MODULE))
    const declared = code.split('\n').filter((line) => line.includes('A_STOP_THEN_THIS_IS_SENT ='))
    expect(declared).toHaveLength(1)
    expect(declared[0]).toContain(
      '`${A_STOP_ASKS_THE_TURN}; this is sent once it has ended, or comes back to you if it has not within seconds`',
    )
    // ⚑ One declaration of `737`'s clause still, and the second half is spelled once in the module.
    expect(code.split('\n').filter((line) => line.includes('A_STOP_ASKS_THE_TURN ='))).toHaveLength(
      1,
    )
    expect(code.split(SECOND_HALF).length - 1).toBe(1)
    expect(code).not.toContain(ASKED_TO_STOP)
  })

  it('⚑ THE CONTROL — `737`’s import line is byte-identical, and the stripper leaves the code', () => {
    // ⚑ `737`'s census (and its M62 anchor) reads this exact line with its newline.
    const raw = source(COMPOSER)
    expect(
      raw.split("import { A_STOP_ASKS_THE_TURN } from '../lib/stop-unanswered'\n").length - 1,
    ).toBe(1)
    expect(codeOnly(raw)).toContain('data-cy="interrupt-send-prompt"')
    expect(codeOnly(source(MODULE))).toContain('export function stopJoinsThatAsk(')
    // ⚑ …and it does strip: a template comment on both trees is gone from the code.
    const aComment = 'A turn frozen on a card is the one a'
    expect(raw).toContain(aComment)
    expect(codeOnly(raw)).not.toContain(aComment)
  })
})
