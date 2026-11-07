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

const since739 = (): Promise<typeof import('../src/renderer/src/lib/stop-unanswered')> =>
  import('../src/renderer/src/lib/stop-unanswered')

const PLATFORM = typeof navigator === 'undefined' ? '' : navigator.platform
const SEND_KEY = sendKeyLabel(PLATFORM)
const INTERRUPT_KEY = interruptKeyLabel(PLATFORM)

const THE_TURN_IS_ASKED_TO_STOP = 'the turn is asked to stop'
const THE_LIMIT = 'comes back to you'
const STOP_THEN_SENT = 'the turn is asked to stop; this is sent once it has ended'
const TITLE = `Stop and send — the turn is asked to stop; this is sent once it has ended (${INTERRUPT_KEY})`
const FOOT = `${SEND_KEY} to send after Codex finishes · ${INTERRUPT_KEY} is Stop and send: the turn is asked to stop; this is sent once it has ended`
const FOOT_WAITING = `${SEND_KEY} to send when Codex finishes, with what is already waiting — a command goes alone · ${INTERRUPT_KEY} is Stop and send: the turn is asked to stop; this is sent once it has ended`
const ROUND_0_LIMIT = 'if it does not end'

const PLAIN_STOP_TITLE = 'Stop — the turn is asked to stop (Esc)'
const QUEUE_TITLE = `Let Codex finish, then send this (${SEND_KEY})`
const QUEUE_BEHIND = `Let Codex finish, then send this with what is already waiting — a command goes alone (${SEND_KEY})`

const OLD_CLAIMS = [
  'instead',
  'and send now',
  'send this now',
  'interrupt and send',
  'Stop Codex and',
] as const

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

const shown = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const titlesOf = (markup: string, cy: string): string[] =>
  [...shown(markup).matchAll(new RegExp(`<[a-z]+\\b[^>]*data-cy="${escapeRegExp(cy)}"[^>]*>`, 'g'))]
    .map((tag) => /\btitle="([^"]*)"/.exec(tag[0])?.[1])
    .filter((title): title is string => title !== undefined)
    .map(decode)

const count = (markup: string, cy: string): number =>
  shown(markup).split(`data-cy="${cy}"`).length - 1

function footMarkupOf(html: string): string {
  const body = /<p[^>]*data-cy="composer-hint"[^>]*>([\s\S]*?)<\/p>/.exec(shown(html))?.[1]
  expect(body, 'no composer-hint was drawn').toBeDefined()
  return body!.replace(/ data-v-[\w-]+(="[^"]*")?/g, '')
}

const footOf = (html: string): string =>
  decode(footMarkupOf(html).replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()

const DRAFT = 'no, look at the migration first'

const composer = (props: Record<string, unknown>): Promise<string> =>
  render(PromptComposer, { draft: '', who: 'Codex', ...props })

const busyWithADraft = (props: Record<string, unknown> = {}): Promise<string> =>
  composer({ state: 'busy', draft: DRAFT, ...props })

const R83_WORDS = stopJoinsThatAsk({ by: 'a-person', waitedMs: 2_000 }, 'codex')

describe('§1 · `busy` with a draft: *Stop and send* says the turn is ASKED to stop, and this goes once it has ended', () => {
  it('🔴 the interrupt-and-send button is titled in R43’s words — the ask, the send once it has ended, and the limit, all in the clause', async () => {
    const html = await busyWithADraft()
    expect(count(html, 'interrupt-send-prompt')).toBe(1)
    expect(count(html, 'queue-prompt')).toBe(1)
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([TITLE])
    const { A_STOP_ASKS_THE_TURN, A_STOP_THEN_THIS_IS_SENT } = await since739()
    expect(A_STOP_ASKS_THE_TURN).toBe(THE_TURN_IS_ASKED_TO_STOP)
    expect(A_STOP_THEN_THIS_IS_SENT).toBe(`${A_STOP_ASKS_THE_TURN}; this is sent once it has ended`)
    expect(A_STOP_THEN_THIS_IS_SENT).toBe(STOP_THEN_SENT)
    expect(A_STOP_THEN_THIS_IS_SENT).toContain(ASKED_TO_STOP)
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([
      `Stop and send — ${A_STOP_THEN_THIS_IS_SENT} (${INTERRUPT_KEY})`,
    ])
  })

  it('🔴 the foot says ⇧⌘↵ is Stop and send, in the same clause, limit and all — and the queue half is unchanged', async () => {
    const html = await busyWithADraft()
    expect(footOf(html)).toBe(FOOT)
    expect(footOf(html)).not.toContain(THE_LIMIT)
    expect(footMarkupOf(html)).toContain(`<strong>${INTERRUPT_KEY}</strong> is Stop and send: `)
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
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([TITLE])
    expect(footOf(html)).toBe(FOOT.replace('after Codex finishes', 'after The agent finishes'))
  })

  it('🔴 with R83’s standing ask the words are the same — Stop and send asks ANEW (`723` F-5), it does not join', async () => {
    const html = await busyWithADraft({ stopUnanswered: R83_WORDS })
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([TITLE])
    expect(footOf(html)).toBe(FOOT)
    expect(footOf(html)).not.toContain('has not answered')
    expect(titlesOf(html, 'interrupt-send-prompt')[0]).not.toContain('has not answered')
  })
})

describe('§2 · with a message already waiting, the foot queues behind it and still says ⇧⌘↵ asks', () => {
  it('🔴 whoever wrote what waits: queue behind it, then Stop and send in R43’s words, limit and all', async () => {
    const html = await busyWithADraft({ hasQueued: true })
    expect(footOf(html)).toBe(FOOT_WAITING)
    expect(footOf(html)).not.toContain(THE_LIMIT)
    expect(footOf(html)).not.toContain('Cancel it')
    expect(footMarkupOf(html)).toContain(`<strong>${INTERRUPT_KEY}</strong> is Stop and send:`)
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([TITLE])
    const { A_STOP_THEN_THIS_IS_SENT } = await since739()
    expect(
      footOf(html).endsWith(`${INTERRUPT_KEY} is Stop and send: ${A_STOP_THEN_THIS_IS_SENT}`),
    ).toBe(true)
  })

  it('⚑ THE CONTROL — the queue button offers to go behind what waits, and is not disabled', async () => {
    const waiting = await busyWithADraft({ hasQueued: true })
    expect(titlesOf(waiting, 'queue-prompt')).toEqual([QUEUE_BEHIND])
    expect(titlesOf(await busyWithADraft(), 'queue-prompt')).toEqual([QUEUE_TITLE])
  })
})

describe('§3 · no word of Stop and send promises a stop', () => {
  async function everyStopAndSendWord(): Promise<string[]> {
    const free = await busyWithADraft()
    const waiting = await busyWithADraft({ hasQueued: true })
    return [...titlesOf(free, 'interrupt-send-prompt'), footOf(free), footOf(waiting)]
  }

  it('🔴 the search over all three finds no old claim — and each says the ask, the send once it has ended, and the limit', async () => {
    const words = await everyStopAndSendWord()
    expect(words).toHaveLength(3)
    for (const one of words) expect(one.length).toBeGreaterThan(20)
    expect(oldClaimsIn(words.join('\n'))).toEqual([])
    for (const one of words) {
      expect(one, one).toContain(ASKED_TO_STOP)
      expect(one, one).toContain(STOP_THEN_SENT)
      expect(one, one).not.toContain(THE_LIMIT)
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
    for (const claim of OLD_CLAIMS) expect(oldClaimsIn(`a ${claim} b`), claim).toEqual([claim])
  })
})

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

describe('§5 · the clause has one spelling, composed from `737`’s, and the composer reads it', () => {
  const source = (path: string): string =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

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
    expect(code.split('${A_STOP_THEN_THIS_IS_SENT}').length - 1, 'the title').toBe(1)
    expect(code.split('{{ A_STOP_THEN_THIS_IS_SENT }}').length - 1, 'the two feet').toBe(2)
    expect(code).not.toContain(ASKED_TO_STOP)
    expect(code).not.toContain(SECOND_HALF)
    expect(code).not.toContain('comes back to you')
    expect(code).not.toContain(ROUND_0_LIMIT)
  })

  it('🔴 the clause is composed from `A_STOP_ASKS_THE_TURN`, once — and the module types *asked to stop* nowhere', () => {
    const code = codeOnly(source(MODULE))
    const declared = code.split('\n').filter((line) => line.includes('A_STOP_THEN_THIS_IS_SENT ='))
    expect(declared).toHaveLength(1)
    expect(declared[0]).toContain('`${A_STOP_ASKS_THE_TURN}; this is sent once it has ended`')
    expect(code.split('\n').filter((line) => line.includes('A_STOP_ASKS_THE_TURN ='))).toHaveLength(
      1,
    )
    expect(code.split(SECOND_HALF).length - 1).toBe(1)
    expect(code).not.toContain(ASKED_TO_STOP)
  })

  it('⚑ THE CONTROL — `737`’s import line is byte-identical, and the stripper leaves the code', () => {
    const raw = source(COMPOSER)
    expect(
      raw.split("import { A_STOP_ASKS_THE_TURN } from '../lib/stop-unanswered'\n").length - 1,
    ).toBe(1)
    expect(codeOnly(raw)).toContain('data-cy="interrupt-send-prompt"')
    expect(codeOnly(source(MODULE))).toContain('export function stopJoinsThatAsk(')
    const aComment = 'A turn frozen on a card is the one a'
    expect(raw).toContain(aComment)
    expect(codeOnly(raw)).not.toContain(aComment)
  })
})
