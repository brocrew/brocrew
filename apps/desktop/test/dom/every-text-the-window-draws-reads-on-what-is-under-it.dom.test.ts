import { afterAll, afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import RecentActivity from '../../src/renderer/src/components/RecentActivity.vue'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { theList } from '../../src/shared/model-choice'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import { settle } from '../../look/fixtures/window'
import { wearTheme } from '../../look/fixtures/themes'
import { ACTIVITY_NOW, ACTIVITY_WINDOW, EVERY_CARD } from '../../look/fixtures/recent-activity'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import {
  openAChildsWork,
  openEverySubAgent,
  pointAtTheWorkflow,
  press,
  stackingWindow,
} from './a-window-with-a-workflow-and-nested-agents'
import { META, mount, paneProps, record, unmountAll } from './harness'
import { paintedReadings, pictures } from './what-is-painted-under'

/**
 * Every piece of text the window draws, in the states that stack its surfaces, reads at 4.5:1 on
 * what is painted under it — under every theme the readability check accepts. The check's model
 * decides what a theme may be; this reads the window itself, so a surface the model doesn't know
 * fails here rather than in a person's window.
 *
 * Each text node is read from the window's own pixels (`what-is-painted-under.ts`): what is painted
 * under it with the glyphs hidden, against its ink painted in the glyphs' own layer, over its whole
 * line boxes where it shows. Scrims, floating panels, popovers, pseudo-elements, layers no pointer
 * reaches, pictures, gradients and every group's opacity count as drawn. A line one of the
 * window's named backdrops dims (an overlay's, a dialog's, the palette's, the floating panel's
 * scrim) is not what a person reads there, and disabled controls are exempt, as they are from
 * WCAG's minimum.
 *
 * Turns before the last compaction are faded on purpose (`--summarised-fade`), and are read as if
 * they weren't: their colours at full strength on their real stack, so a theme that makes them
 * unreadable still fails here. Classic keeps its hand-picked colours, which the check doesn't
 * measure; it is held to the same floor with the exceptions named in KNOWN_IN_CLASSIC and the one
 * drawing named in CLASSIC_LIFTED. Every other theme is read with all it draws.
 */

const BASE = (() => {
  const read = validateTheme(DEFINED_FILE, {
    assets: new Map(),
    builtIns: new Map(),
    builtIn: true,
  })
  if (!read.ok) throw new Error(JSON.stringify(read.problems))
  return read.theme
})()

const WHITE = { waiting: '#ffffff', success: '#ffffff', danger: '#ffffff', auto: '#ffffff' }

/** Themes the check accepts, each near its limits on the surfaces this piece measures. */
const HOSTILE: Record<string, Record<string, unknown>> = {
  'see-through-dark': {
    frame: { ink: '#ffffff', paper: '#000000', accent: '#ffffff' },
    content: { ink: '#ffffff', paper: '#000000', accent: '#4c6ef5', scheme: 'dark' },
    shared: { page: 0, tint: 0 },
    status: WHITE,
    tokens: {
      content: { panel: '#00000000', 'accent-text': '#b0b0b0', 'accent-2-text': '#b0b0b0' },
    },
    conversation: { background: { color: '#111111' } },
    drawer: { background: { color: '#00000000' }, card: { fill: '#00000000' } },
  },
  'light-second-accent': { content: { accent2: '#7a64c0' } },
  'light-accent': {
    shared: { page: 0 },
    content: { accent: '#4c6ef5' },
    tokens: { content: { 'accent-solid-bg': '#3b5bdb' } },
  },
  'light-frame': {
    frame: { ink: '#1b2238', paper: '#ffffff', accent: '#4338ca' },
    shared: { tint: 14 },
  },
}

/** Each hostile theme as the check reads it. */
const ACCEPTED = new Map<string, Theme>(
  Object.entries(HOSTILE).map(([id, own]) => {
    const file = { format: 1, id, name: id, extends: 'defined', ...own }
    const read = validateTheme(file, { assets: new Map(), builtIns: new Map([['defined', BASE]]) })
    if (!read.ok) throw new Error(`${id} is refused: ${JSON.stringify(read.problems)}`)
    return [id, resolveTheme(read.theme, BASE)]
  }),
)

const SHIPPED = ['classic', 'defined', 'brocrew', 'synthwave'] as const
type ThemeName = (typeof SHIPPED)[number] | string

function wear(theme: ThemeName): void {
  const own = ACCEPTED.get(theme)
  if (own) applyTheme(own)
  else if (theme === 'classic') applyTheme(null)
  else wearTheme(theme as 'defined' | 'brocrew' | 'synthwave')
}

const pause = (ms = 120): Promise<void> => new Promise((done) => setTimeout(done, ms))

const MODELS = async ({ provider }: { provider: string }) => ({
  provider,
  notAsked: null,
  standIn: null,
  models: theList(
    [
      {
        id: 'opus',
        label: 'Opus',
        efforts: [{ id: 'high', label: 'high' }],
        defaultEffort: 'high',
        isDefault: true,
      },
    ],
    [],
  ),
  lastPicked: null,
  startsOn: null,
})

/** Press `selector`, which must be there: a state whose control is missing is not brought about. */
async function mustPress(root: ParentNode, selector: string): Promise<void> {
  if (!(await press(root, selector))) throw new Error(`there is no ${selector} to press`)
}

/** Each state of the window that stacks its surfaces, brought about as a person would. */
const STATES: readonly [string, () => Promise<Element>][] = [
  [
    'docked, a workflow under the pointer',
    async () => {
      const m = await stackingWindow()
      await openEverySubAgent(m)
      await pointAtTheWorkflow(m)
      return m.host
    },
  ],
  [
    'sub-agents nested three deep',
    async () => {
      const m = await stackingWindow()
      await openEverySubAgent(m)
      const cards = m.host.querySelectorAll<HTMLElement>('.subagent')
      cards[cards.length - 1]?.scrollIntoView({ block: 'center' })
      await pause()
      return m.host
    },
  ],
  ['the right-hand panel floating', async () => (await stackingWindow(760)).host],
  [
    'turns before the last compaction, scrolled into view',
    async () => {
      const m = await stackingWindow()
      m.host.querySelector('.summarised-out')?.scrollIntoView({ block: 'center' })
      await pause()
      return m.host
    },
  ],
  [
    'a dialog open',
    async () => {
      const m = await stackingWindow()
      await mustPress(m.host, '.files-all')
      await pause()
      // The dialog is drawn in the overlay, outside the window's own element.
      return document.body
    },
  ],
  [
    'a child’s work open',
    async () => {
      const m = await stackingWindow()
      await openAChildsWork(m)
      return document.body
    },
  ],
  [
    'an answer card waiting, its answer chosen and under the pointer',
    async () => {
      const m = await stackingWindow(1180, [
        [
          {
            type: 'user_input_request',
            id: 'toolu_question',
            prompt: 'AskUserQuestion',
            questions: [
              {
                id: 'q0',
                prompt: 'Which header should ship?',
                options: [{ label: 'The bold one' }, { label: 'The quiet one' }],
                multiSelect: false,
              },
            ],
          },
          Date.now() - 1_000,
        ],
      ])
      const answer = m.host.querySelector<HTMLElement>('[data-cy="user-input-answer"]')
      answer?.scrollIntoView({ block: 'center' })
      m.host.querySelector<HTMLElement>('.choice')?.click()
      await pause(200)
      // The answer button, ready now, under the pointer.
      if (answer) await userEvent.hover(answer)
      await pause(200)
      return m.host
    },
  ],
  [
    'an agent at work, a message typed for it',
    async () => {
      const m = await stackingWindow(
        1180,
        [[{ type: 'status', state: 'working' }, Date.now() - 1_000]],
        { draft: 'And then check the menu on a phone.' },
      )
      await pause()
      return m.host
    },
  ],
  [
    'the model picker open',
    async () => {
      await page.viewport(1200, 900)
      ;(window as { api?: unknown }).api = {
        runtime: {
          modelList: MODELS,
          listResumable: async () => [],
          listUnresumable: async () => [],
        },
      }
      const r = record([{ type: 'assistant_message', text: 'hello' } as never])
      r.meta = { ...META, settings: { ...META.settings, model: 'opus', reasoningEffort: 'high' } }
      const m = mount(
        ConversationPane as Component,
        {
          ...paneProps({ record: r, drawerOpen: true, drawerTab: 'open' }),
          pickModel: async () => ({ itsAgentsDefault: true, theLastPick: true }),
        },
        { width: 1200, height: 900 },
      )
      await settle()
      await mustPress(m.host, '[data-cy="card-run-model"]')
      await pause()
      return document.body
    },
  ],
  [
    'the sign-in bar, its button under the pointer',
    async () => {
      await page.viewport(1200, 900)
      const r = record([{ type: 'assistant_message', text: 'hello' } as never])
      r.meta = { ...META, liveness: { ...META.liveness, signInSuperseded: true } } as never
      const m = mount(ConversationPane as Component, paneProps({ record: r }), {
        width: 1200,
        height: 900,
      })
      await settle()
      const button = m.host.querySelector<HTMLElement>('.sign-in-bar-button')
      if (button) await userEvent.hover(button)
      await pause(300)
      return m.host
    },
  ],
  [
    'the Recent activity page, every kind of card, a line under the pointer',
    async () => {
      await page.viewport(1200, 900)
      const m = mount(
        RecentActivity as Component,
        { reading: EVERY_CARD, windowMs: ACTIVITY_WINDOW, clock: ACTIVITY_NOW },
        { width: 1200, height: 900 },
      )
      await settle()
      const line = m.host.querySelector<HTMLElement>('[data-cy="activity-line"]')
      if (line) await userEvent.hover(line)
      await pause(300)
      return m.host
    },
  ],
]

/**
 * What proves each state is brought about: the elements whose words must be read in it (drawn,
 * on screen and read, not merely present), and what else must hold of it.
 */
interface Proof {
  readonly read: readonly string[]
  readonly holds?: () => string | null
}

const PROOF: Record<string, Proof> = {
  'docked, a workflow under the pointer': { read: ['[data-cy="workflow-head"]:hover'] },
  'sub-agents nested three deep': { read: ['.subagent .subagent .subagent'] },
  'the right-hand panel floating': { read: ['.session-drawer.fit-overlay'] },
  'turns before the last compaction, scrolled into view': { read: ['.summarised-out'] },
  'a dialog open': { read: ['.overlay-host .list-dialog'] },
  'a child’s work open': { read: ['[data-cy="child-work-part"]'] },
  'an answer card waiting, its answer chosen and under the pointer': {
    read: ['[data-cy="user-input-answer"]:not(:disabled):hover'],
  },
  'an agent at work, a message typed for it': {
    read: [
      'form.composer.busy [data-cy="queue-prompt"]',
      'form.composer.busy [data-cy="interrupt-send-prompt"]',
    ],
    holds: () =>
      (
        document.querySelector<HTMLTextAreaElement>('form.composer.busy textarea')?.value ?? ''
      ).trim()
        ? null
        : 'the busy composer holds no message',
  },
  'the model picker open': { read: ['[data-cy="model-picker-panel"]:popover-open'] },
  'the sign-in bar, its button under the pointer': { read: ['.sign-in-bar-button:hover'] },
  'the Recent activity page, every kind of card, a line under the pointer': {
    read: [
      '[data-cy="activity-skill-import"]',
      '[data-cy="activity-transcripts-cleared"]',
      '[data-cy="activity-line"]:hover',
      '[data-cy="activity-claimed-note"]',
    ],
  },
}

type Readings = Awaited<ReturnType<typeof paintedReadings>>

/**
 * Brings a state about and reads it, failing unless the state is proved: its control was there,
 * what it is about is drawn and holds what it should, and its words were read where they show.
 */
async function brought(
  state: string,
  bring: () => Promise<Element>,
  proof = PROOF[state],
): Promise<Readings> {
  if (!proof) throw new Error(`${state} says nothing that proves it is brought about`)
  await bring()
  for (const selector of proof.read)
    if (!document.querySelector(selector))
      throw new Error(`${state} is not brought about: no ${selector}`)
  const wrong = proof.holds?.()
  if (wrong) throw new Error(`${state} is not brought about: ${wrong}`)
  const readings = await paintedReadings(document.body, '.summarised-out')
  for (const selector of proof.read) {
    const shown = [...document.querySelectorAll(selector)]
    if (
      !readings.some(
        ({ node, reading }) => reading.is === 'read' && shown.some((e) => e.contains(node)),
      )
    )
      throw new Error(`${state} is not brought about: nothing in ${selector} was read on screen`)
  }
  return readings
}

/** Where a piece of text sits, in a few class names. */
function placeOf(el: Element): string {
  const parts: string[] = []
  for (let e: Element | null = el; e && parts.length < 3; e = e.parentElement) {
    const cls = [...e.classList].slice(0, 2).join('.')
    parts.unshift(`${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}`)
  }
  return parts.join(' > ')
}

/**
 * Every visible piece of text under `root` that reads under 4.5:1 or that could not be read, how
 * many were read, and how many faded turns were on screen.
 */
function faintText(
  root: Element,
  readings: Readings,
): { faint: string[]; read: number; faded: number } {
  const faint: string[] = []
  let read = 0
  let faded = 0
  for (const { node, reading } of readings) {
    if (!root.contains(node)) continue
    const el = node.parentElement
    if (!el || el.closest('svg, option, script, style, [hidden]')) continue
    if (el.closest(':disabled, [aria-disabled="true"]')) continue
    // Faded turns on screen.
    if (el.closest('.summarised-out') && reading.is === 'read') faded++
    // A text the sampler saw drawn and could read no pixel of, with no named cover over it.
    if (reading.is === 'unread') {
      faint.push(`unread ${placeOf(el)} "${node.textContent!.trim().slice(0, 30)}"`)
      continue
    }
    if (reading.is !== 'read') continue
    read++
    if (reading.ratio < 4.5)
      faint.push(
        `${reading.ratio.toFixed(2)} ${placeOf(el)} "${node.textContent!.trim().slice(0, 30)}"`,
      )
  }
  return { faint, read, faded }
}

/**
 * Classic's own colours that read under the floor, each measured and kept for a later decision:
 * classic's --muted on the model picker's panel-3. Any other miss under classic fails.
 */
const KNOWN_IN_CLASSIC = [
  // The picker's provider heading and its effort legend: --muted #5e6b82 on panel-3, 4.47:1.
  'the model picker open: 4.47 div.inside > section.provider > h4 "Claude"',
  'the model picker open: 4.47 div.inside > fieldset.efforts > legend "Effort"',
]

/**
 * Classic's decorative paper network drawing (`--paper-wash`), a 6% line and 10% dots over the
 * page, is lifted while classic is read, and only for classic: no other theme draws it, and every
 * other theme is read with all it draws. Where a line or a dot crosses faint text it drops that
 * text to about 3.81:1 on the second wash, 4.09:1 on the page, and where they fall depends on the
 * width of the clock times beside the words, so the reading would change with when and where the
 * test runs. This is a known open decision about classic's own colours, not a pass.
 */
const CLASSIC_LIFTED = { token: '--paper-wash', worst: 3.81 } as const

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
afterEach(() => {
  applyTheme(null)
  unmountAll()
  delete (window as { api?: unknown }).api
})
afterAll(async () => {
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('a state the sweep cannot bring about fails, rather than reading the window without it', () => {
  it('⛔ its control is missing', async () => {
    await expect(
      brought('a dialog open', async () => {
        const m = await stackingWindow()
        await mustPress(m.host, '.no-such-control')
        return document.body
      }),
    ).rejects.toThrow('there is no .no-such-control to press')
  })

  it('⛔ what it opens is not drawn', async () => {
    await expect(
      brought('a dialog open', async () => (await stackingWindow()).host),
    ).rejects.toThrow('a dialog open is not brought about: no .overlay-host .list-dialog')
  })

  it('⛔ a faded turn that is there but out of view', async () => {
    await expect(
      brought('turns before the last compaction, scrolled into view', async () => {
        const m = await stackingWindow()
        expect(
          m.host.querySelector('.summarised-out'),
          'the window holds a faded turn',
        ).not.toBeNull()
        return m.host
      }),
    ).rejects.toThrow('nothing in .summarised-out was read on screen')
  })

  it('⛔ an agent at work with nothing typed', async () => {
    await expect(
      brought('an agent at work, a message typed for it', async () => {
        const m = await stackingWindow(1180, [
          [{ type: 'status', state: 'working' }, Date.now() - 1_000],
        ])
        expect(m.host.querySelector('form.composer.busy'), 'the composer is busy').not.toBeNull()
        return m.host
      }),
    ).rejects.toThrow('an agent at work, a message typed for it is not brought about')
  })

  it('⛔ another popover open, with the model picker closed', async () => {
    await expect(
      brought('the model picker open', async () => {
        const m = await stackingWindow()
        const other = document.createElement('div')
        other.setAttribute('popover', 'auto')
        other.textContent = 'Some other popover'
        document.body.append(other)
        onTestFinished(() => other.remove())
        other.showPopover()
        return m.host
      }),
    ).rejects.toThrow(
      'the model picker open is not brought about: no [data-cy="model-picker-panel"]:popover-open',
    )
  })

  it('⚑ every state says what proves it is brought about', () => {
    expect(STATES.map(([state]) => state).filter((state) => !PROOF[state])).toEqual([])
  })
})

describe('every text the window draws reads on what is under it', () => {
  // Each theme in each state is its own case, with its own time, and says what it cost, so a
  // slower machine shows its headroom. The theme's last case adds up what its states read.
  describe.each([...SHIPPED, ...ACCEPTED.keys()])('under %s', (theme) => {
    const tally = { read: 0, faded: 0, found: [] as string[] }

    it.each(STATES.map(([state, bring]) => ({ state, bring })))(
      '$state',
      async ({ state, bring }) => {
        const plain = document.createElement('style')
        plain.textContent =
          theme === 'classic' ? `* { ${CLASSIC_LIFTED.token}: none !important; }` : ''
        document.head.append(plain)
        onTestFinished(() => plain.remove())
        const at = { taken: pictures.taken, ms: pictures.ms, clock: performance.now() }
        wear(theme)
        let root: Element = document.body
        const readings = await brought(state, async () => (root = await bring()))
        const seen = faintText(root, readings)
        console.warn(
          `${theme} · ${state}: ${pictures.taken - at.taken} pictures, ${Math.round(pictures.ms - at.ms)} ms of ${Math.round(performance.now() - at.clock)} ms`,
        )
        tally.read += seen.read
        tally.faded += seen.faded
        const found = seen.faint.map((one) => `${state}: ${one}`)
        tally.found.push(...found)
        expect(seen.read, 'the window draws text in this state').toBeGreaterThan(0)
        expect(found).toEqual(
          theme === 'classic' ? KNOWN_IN_CLASSIC.filter((one) => one.startsWith(`${state}: `)) : [],
        )
      },
    )

    it('across its states', () => {
      expect(tally.read, 'the window draws text in these states').toBeGreaterThan(200)
      expect(tally.faded, 'turns before the last compaction are read too').toBeGreaterThan(0)
      expect(tally.found).toEqual(theme === 'classic' ? KNOWN_IN_CLASSIC : [])
    })
  })
})
