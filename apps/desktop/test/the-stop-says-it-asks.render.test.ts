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

const since737 = (): Promise<typeof import('../src/renderer/src/lib/stop-unanswered')> =>
  import('../src/renderer/src/lib/stop-unanswered')

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

const composer = (props: Record<string, unknown>): Promise<string> =>
  render(PromptComposer, { draft: '', who: 'Codex', ...props })

const PLATFORM = typeof navigator === 'undefined' ? '' : navigator.platform
const SEND_KEY = sendKeyLabel(PLATFORM)
const INTERRUPT_KEY = interruptKeyLabel(PLATFORM)

const R83_WORDS = stopJoinsThatAsk({ by: 'a-person', waitedMs: 2_000 }, 'codex')

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

describe('§1 · `busy`: the Stop’s title and the foot say the turn is ASKED to stop', () => {
  it('🔴 the Stop is titled *Stop — the turn is asked to stop (Esc)*, and the foot says Esc is Stop and a message still queues', async () => {
    const html = await composer({ state: 'busy' })
    expect(count(html, 'interrupt-session')).toBe(1)
    expect(titlesOf(html, 'interrupt-session')).toEqual([BUSY_TITLE])
    expect(footOf(html)).toBe(BUSY_FOOT)
    expect(footMarkupOf(html)).toContain(
      `<strong>Esc</strong> is Stop: ${THE_TURN_IS_ASKED_TO_STOP}.`,
    )
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
    expect(footOf(html)).toBe(BUSY_FOOT)
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

describe('§2 · `frozen`: the Stop instead of answering, in R43’s words', () => {
  it('🔴 the Stop is titled *Stop instead of answering — the turn is asked to stop (Esc)*, and the foot’s Esc clause says the same', async () => {
    const html = await composer({ state: 'frozen' })
    expect(count(html, 'interrupt-session')).toBe(1)
    expect(titlesOf(html, 'interrupt-session')).toEqual([FROZEN_TITLE])
    expect(footOf(html)).toBe(FROZEN_FOOT)
    expect(footMarkupOf(html)).toContain(
      `<strong>Esc</strong> is Stop: ${THE_TURN_IS_ASKED_TO_STOP}`,
    )
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

describe('§4 · no word of the Stop claims the press ends the turn', () => {
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
    expect(words).toHaveLength(7)
    for (const one of words) expect(one.length).toBeGreaterThan(20)
    expect(oldClaimsIn(words.join('\n'))).toEqual([])
    for (const one of words.slice(0, 5)) expect(one, one).toContain(ASKED_TO_STOP)
  })

  it('⚑ THE CONTROL (rule 12) — the same search over a planted string of TWO old claims finds exactly two', () => {
    const planted =
      "Interrupt the running turn (Esc)\nAnswer the request above to continue. A message won't answer it, but Esc stops the turn."
    expect(oldClaimsIn(planted)).toEqual(['Interrupt the', 'stops the turn'])
    for (const claim of OLD_CLAIMS) expect(oldClaimsIn(`a ${claim} b`), claim).toEqual([claim])
  })

  it('⚑ THE CONTROL — R83’s words, which a press joins rather than repeats, carry no old claim either', async () => {
    const html = await composer({ state: 'busy', stopUnanswered: R83_WORDS })
    const words = [...titlesOf(html, 'interrupt-session'), footOf(html)]
    expect(words).toHaveLength(2)
    expect(oldClaimsIn(words.join('\n'))).toEqual([])
  })
})

describe('§5 · the words beside the Stop are untouched (scope)', () => {
  it('⚑ THE CONTROL — `busy` WITH R83’s sentence: its title and foot, not the busy words', async () => {
    const html = await composer({ state: 'busy', stopUnanswered: R83_WORDS })
    expect(titlesOf(html, 'interrupt-session')).toEqual([`${R83_WORDS} (Esc)`])
    expect(footOf(html)).toBe(`${R83_WORDS}. Esc is Stop; type to queue a message.`)
    expect(footOf(html)).not.toContain(THE_TURN_IS_ASKED_TO_STOP)
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

  it('⚑ THE CONTROL — `busy` with a draft: the pair, not the Stop, and neither its title nor its foot is the Stop’s sentence', async () => {
    const html = await composer({ state: 'busy', draft: 'no, do this instead' })
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(count(html, 'interrupt-send-prompt')).toBe(1)
    expect(titlesOf(html, 'queue-prompt')).toEqual([
      `Let Codex finish, then send this (${SEND_KEY})`,
    ])
    const [title] = titlesOf(html, 'interrupt-send-prompt')
    expect(title?.length ?? 0).toBeGreaterThan(20)
    expect(
      footOf(html).startsWith(`${SEND_KEY} to send after Codex finishes · ${INTERRUPT_KEY} `),
    ).toBe(true)
    expect(title).not.toBe(BUSY_TITLE)
    expect(footOf(html)).not.toBe(BUSY_FOOT)
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
    const html = await composer({ state: 'busy', blocked: [{ words: blocked }] })
    expect(html).toContain('data-cy="send-blocked"')
    expect(html).toContain(blocked)
    expect(html).not.toContain('data-cy="composer-hint"')
  })
})

describe('§5b · interrupt-and-send, which `739` moved: its title and foot are Stop and send’s', () => {
  it('`busy` with a draft: the pair’s title and the foot say the turn is asked to stop, then this is sent once it ends', async () => {
    const html = await composer({ state: 'busy', draft: 'no, do this instead' })
    const STOP_THEN_SENT = `${THE_TURN_IS_ASKED_TO_STOP}; this is sent once it has ended`
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual([
      `Stop and send — ${STOP_THEN_SENT} (${INTERRUPT_KEY})`,
    ])
    expect(footOf(html)).toBe(
      `${SEND_KEY} to send after Codex finishes · ${INTERRUPT_KEY} is Stop and send: ${STOP_THEN_SENT}`,
    )
    const queued = await composer({ state: 'busy', draft: 'no, do this instead', hasQueued: true })
    expect(footOf(queued)).toBe(
      `${SEND_KEY} to send when Codex finishes, with what is already waiting — a command goes alone · ${INTERRUPT_KEY} is Stop and send: ${STOP_THEN_SENT}`,
    )
  })
})

describe('§6 · the clause has one spelling, and the composer reads it — the drawer claims nothing a press does (737 review)', () => {
  const source = (path: string): string =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

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
      for (const use of draws) expect(code, `${name} draws ${use}`).toContain(use)
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
    const aComment = 'A turn frozen on a card is the one a'
    expect(source(COMPOSER)).toContain(aComment)
    expect(codeOnly(source(COMPOSER))).not.toContain(aComment)
  })
})
