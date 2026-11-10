import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PromptComposer, {
  interruptKeyLabel,
  sendIntentFor,
  sendKeyLabel,
} from '../src/renderer/src/components/PromptComposer.vue'
import { stopJoinsThatAsk } from '../src/renderer/src/lib/stop-unanswered'

/**
 * *Stop and send* says what a press does: the turn is ASKED to stop, and the draft is sent once it
 * has ended, or comes back if it has not within the host's bounded wait. Every reading is taken off
 * the element (a `title`, the foot's text) with the markup's comments stripped, because the
 * template's own comments quote the old words. The press itself is
 * `test/dom/stop-and-send-says-it-asks.dom.test.ts`.
 */

/** ⚑ The platform the component asks (Node has a `navigator` since 21) — the labels it then draws. */
const PLATFORM = typeof navigator === 'undefined' ? '' : navigator.platform
const SEND_KEY = sendKeyLabel(PLATFORM)
const INTERRUPT_KEY = interruptKeyLabel(PLATFORM)

/** The sentences, verbatim. */
const TITLE = `Stop and send — the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds (${INTERRUPT_KEY})`
const FOOT = `${SEND_KEY} to send after Codex finishes · ${INTERRUPT_KEY} is Stop and send: the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds`
/**
 * ⚑ **D-010** — one foot while something waits, whoever wrote it. ⚑ **D-027 moved its first half**:
 * what waits no longer goes first, one turn each — this goes WITH it, in one turn, oldest first, and
 * only a command goes alone; it said *"…after Codex finishes and takes what is already waiting"*.
 */
const FOOT_WAITING = `${SEND_KEY} to send when Codex finishes, with what is already waiting — a command goes alone · ${INTERRUPT_KEY} is Stop and send: the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds`

/** ⚑ The neighbours this draw leaves alone — verbatim, as `main` draws them too. */
const PLAIN_STOP_TITLE = 'Stop — the turn is asked to stop (Esc)'
const QUEUE_TITLE = `Let Codex finish, then send this (${SEND_KEY})`
/** ⚑ **D-027** — with what waits, in one turn; it said *"…finish and take what is already waiting, then send this"*. */
const QUEUE_BEHIND = `Let Codex finish, then send this with what is already waiting — a command goes alone (${SEND_KEY})`

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
    // The pair is drawn, and the plain Stop has stepped aside for it.
    expect(count(html, 'interrupt-send-prompt')).toBe(1)
    expect(count(html, 'queue-prompt')).toBe(1)
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([TITLE])
  })

  it('🔴 the foot says ⇧⌘↵ is Stop and send, in the same clause, limit and all — and the queue half is unchanged', async () => {
    const html = await busyWithADraft()
    expect(footOf(html)).toBe(FOOT)
    // The key hint is the foot's own `<strong>`.
    expect(footMarkupOf(html)).toContain(`<strong>${INTERRUPT_KEY}</strong> is Stop and send: `)
    expect(footMarkupOf(html)).toContain(
      `<strong>${SEND_KEY}</strong> to send after Codex finishes`,
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
    expect(footOf(html)).not.toContain('Cancel it')
    expect(footMarkupOf(html)).toContain(`<strong>${INTERRUPT_KEY}</strong> is Stop and send:`)
    // The title does not depend on the queue — the same Stop and send.
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([TITLE])
  })

  it('⚑ THE CONTROL — the queue button offers to go behind what waits, and is not disabled', async () => {
    const waiting = await busyWithADraft({ hasQueued: true })
    expect(titlesOf(waiting, 'queue-prompt')).toEqual([QUEUE_BEHIND])
    // ⚑ …beside the title with nothing waiting, one fact over.
    expect(titlesOf(await busyWithADraft(), 'queue-prompt')).toEqual([QUEUE_TITLE])
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
