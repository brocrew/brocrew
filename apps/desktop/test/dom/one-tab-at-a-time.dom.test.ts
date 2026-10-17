import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import { WHOSE_TEXT, WHOSE_WORDS, type WhoseText } from '../../src/shared/whose-text'
import {
  COULD_NOT_TELL_WHICH_PART,
  NOTHING_OF_YOURS_YET,
  THIS_SHEET_CANNOT_SAY_WHAT_IS_YOURS,
} from '../../src/renderer/src/lib/whose-groups'
import type { InjectedInstruction, SessionInstructions } from '../../src/shared/runtime-ipc'
import { mount, toldProps, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **One owner per tab, and what is under a heading agrees with it** (583 §5.3, its relay).
 *
 * ## ⛔ Why this is a DOM test and `whose-text-is-this.test.ts` is not enough
 *
 * ⚑ That file takes two readings of the same VIEW — where a file really lands, against the table
 * the headings are built from. ⚠️ **Neither of them is the screen.** A component that filtered by
 * the wrong field, rendered two tabs at once, or drew every group's rows under whichever heading
 * happened to be selected would pass every assertion in it.
 *
 * > ⛔ **So the reading here is the RENDERED DOM**: every row actually drawn, its `data-whose`,
 * > read against the tab that is actually selected. `578`'s shape — census what the band draws,
 * > never what the source says it draws.
 *
 * ## ⛔ Every negative below is paired with a reading
 *
 * ⚑ **`556`'s rule, declared so this file is inside the population that enforces it.** A tab
 * strip makes an absence cheap and wrong: an element missing because it is on ANOTHER TAB looks
 * exactly like an element that is not drawn at all. ⚠️ So every `toBeNull` / `toEqual([])` here
 * sits beside an assertion that reads something real off the same mount.
 *
 * ## ⚠️ And the other half of the relay, which is a claim about SIZE
 *
 * Only one tab’s rows are in the document; the other five owners’ rows are absent. A file
 * address is behind its row’s own press, and additional prose is behind `more`, keeping the
 * initial UI light.
 */

afterEach(unmountAll)

const BUNDLE_PATH = '/tmp/home/brobot-instructions.md'

/**
 * ⚑ **A compiled bundle with a section for each of the three layers it really has** — built the
 * way main builds it, as offsets that tile the text, so the split under test is the real one.
 */
function bundle(): InjectedInstruction {
  const parts: { whose: WhoseText; heading: string | null; body: string }[] = [
    {
      whose: 'factory',
      heading: null,
      body: '<!-- brobot2:profile-instructions v1 -->\n\n# Your instructions',
    },
    { whose: 'factory', heading: 'Rules', body: '- never merge without asking' },
    {
      whose: 'configured',
      heading: 'Your own instructions',
      body: 'Run the gate before you say done.',
    },
    { whose: 'dynamic', heading: 'This conversation', body: '- You are running as `brobot`.' },
  ]
  let text = ''
  const sections = parts.map((part, index) => {
    const start = text.length
    const rendered = part.heading === null ? part.body : `## ${part.heading}\n\n${part.body}`
    text += index === parts.length - 1 ? `${rendered}\n` : `${rendered}\n\n`
    return { whose: part.whose, heading: part.heading, start, end: text.length }
  })
  return {
    kind: 'profile-instructions',
    path: BUNDLE_PATH,
    text,
    bytes: text.length,
    truncated: false,
    sections,
  }
}

const BUNDLE = bundle()

function file(kind: InjectedInstruction['kind'], over: Partial<InjectedInstruction> = {}) {
  return {
    kind,
    path: `/tmp/where/${kind}.md`,
    text: `# ${kind}\n\nwhat this file says.\n`,
    bytes: 42,
    truncated: false,
    ...over,
  } satisfies InjectedInstruction
}

const EVERYTHING: SessionInstructions = {
  injected: [BUNDLE, file('repository-conventions'), file('workspace-instructions')],
  agentMemory: [file('agent-memory', { reach: 'prompt' })],
  provider: [{ path: '/tmp/where/CLAUDE.md', scope: 'project' }],
  refused: [{ path: '/tmp/where/bad.md', reason: 'symlink' }],
  note: 'Read at launch and appended as text.',
  recallsReported: true,
  writesReported: false,
  composed: BUNDLE.text,
}

function open(said: SessionInstructions = EVERYTHING): Mounted {
  return mount(AgentInstructionsSheet as never, toldProps(said), { width: 880, height: 900 })
}

/** Which tab is selected, read off the control rather than off any state the test can see. */
function selected(m: Mounted): string {
  const on = m.host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
  expect(on, 'no tab is selected').not.toBeNull()
  return (on?.dataset.cy ?? '').replace('told-tab-', '')
}

/** Every tab, in the order the strip draws them. */
function strip(m: Mounted): string[] {
  return [...m.host.querySelectorAll<HTMLElement>('[role="tab"]')].map((el) =>
    (el.dataset.cy ?? '').replace('told-tab-', ''),
  )
}

async function press(m: Mounted, key: string): Promise<void> {
  m.q(`told-tab-${key}`).click()
  await nextTick()
}

/* ───────────────────────────────────────────────────────────────────────── */

describe('§1 · one owner per tab, read off the DOM (583 §5.3)', () => {
  it('⛔ every row drawn is the selected tab’s, and the other owners’ rows are not in the document', async () => {
    const m = open()
    for (const key of strip(m)) {
      await press(m, key)
      expect(selected(m), 'pressing a tab did not select it').toBe(key)
      // ⛔ **The unsplit row is excluded, and that exclusion is itself the claim** — it is the
      // one row that belongs to no owner, is drawn on every tab on purpose, and carries
      // `data-whose=""`. ⚠️ Without the exclusion this loop would go red on intended behaviour
      // the moment a fixture carried one, which is a false red hiding a real check.
      const drawn = m
        .all('told-block')
        .filter((el) => el.closest('[data-cy="told-unsplit"]') === null)
        .map((el) => el.dataset.whose ?? '')
      for (const whose of drawn) {
        expect(whose, `a ${whose} row is drawn under the ${key} heading`).toBe(key)
      }
      // ⚠️ **The panel is one, always** — two tabpanels in the document is the wall coming back
      // with the tabs drawn on top of it.
      expect(m.host.querySelectorAll('[role="tabpanel"]')).toHaveLength(1)
    }
  })

  /**
   * ⛔ **The control that proves the loop above is looking at anything.** A component that drew
   * no rows at all, or drew every row on every tab, would pass a per-row check vacuously — so
   * the rows a tab draws must DIFFER from the rows the next one draws, and every owner that has
   * files must be reachable.
   */
  it('⚑ …and the tabs really hold different rows, with every owner that has files reachable', async () => {
    const m = open()
    const seen = new Map<string, string[]>()
    for (const key of strip(m)) {
      await press(m, key)
      seen.set(
        key,
        m.all('told-block').map((el) => `${el.dataset.kind ?? ''}#${el.dataset.heading ?? ''}`),
      )
    }
    expect(seen.get('factory')?.length, 'the landing tab drew nothing').toBeGreaterThan(0)
    expect(seen.get('factory')).not.toEqual(seen.get('configured'))
    expect(seen.get('configured')).not.toEqual(seen.get('dynamic'))
    // ⛔ **The compiled bundle is under THREE headings and it is one file** — which is the whole
    // of `HO-073` §4 in one assertion: the wall was one row, and it was three people's text.
    const bundleTabs = [...seen.entries()].filter(([, rows]) =>
      rows.some((row) => row.startsWith('profile-instructions#')),
    )
    expect(bundleTabs.map(([key]) => key).sort()).toEqual(['configured', 'dynamic', 'factory'])
  })

  it('⛔ the strip only ever names owners the vocabulary knows, plus the two that are not owners', async () => {
    const m = open()
    const known: readonly string[] = [...WHOSE_TEXT, 'not-read', 'as-sent']
    for (const key of strip(m))
      expect(known, `${key} is not a tab this app declares`).toContain(key)
    // ⚑ The label a person reads is the vocabulary's, not a second spelling of it.
    for (const whose of WHOSE_TEXT) {
      const tab = m.host.querySelector<HTMLElement>(`[data-cy="told-tab-${whose}"]`)
      if (tab) expect(tab.textContent?.trim()).toContain(WHOSE_WORDS[whose].heading)
    }
  })

  /**
   * 🔴 **The landing tab is an owner, never the composed prompt** (583's relay).
   *
   * ⛔ 2.5 KB of markdown as the first thing a person sees is the wall this dispatch exists to
   * take down, restored as a default — so `as sent` is last, and reachable, and not where you
   * arrive.
   */
  it('⚑ a person lands on an owner, and the whole prompt is the last tab', async () => {
    const m = open()
    expect(selected(m)).not.toBe('as-sent')
    expect(WHOSE_TEXT as readonly string[]).toContain(selected(m))
    expect(strip(m).at(-1)).toBe('as-sent')
    await press(m, 'as-sent')
    // ⛔ **And it really is the composition** — criterion 24's *composed, as sent*, which the
    // sheet never had until this tab.
    expect(m.q('told-bytes-app-composed').textContent).toContain('the text as it was sent')
  })
})

describe('§2 · the one picture, and what it is a share OF (583 relay 2)', () => {
  it('⛔ a tab’s share names the whole it is a share of, and two tabs do not read alike', async () => {
    const m = open()
    const said = new Map<string, string>()
    for (const whose of ['factory', 'configured', 'dynamic'] as const) {
      await press(m, whose)
      said.set(whose, m.q(`told-share-${whose}`).textContent?.replace(/\s+/g, ' ').trim() ?? '')
    }
    for (const [whose, text] of said) {
      expect(text, `${whose}'s bar says no percentage`).toMatch(/\d+% of the /)
      // ⚠️ **The whole is NAMED**, because the provider's own layer is the largest part of a real
      // prompt and has no size we can put in a bar — a bar that omitted it while looking like the
      // whole prompt is `442` §2.1's false claim, drawn. ⛔ **And it is what the sheet HOLDS, not
      // what BroBot appended**: the first version said the latter and was wrong in both
      // directions — the agent's own memory is in the sum and BroBot appends none of it, and the
      // composed string's preamble is appended and is on no row.
      expect(text, `${whose}'s bar does not say what it is a share of`).toContain(
        'this sheet holds',
      )
    }
    expect(
      new Set(said.values()).size,
      'every tab reads the same share — the bar is a constant',
    ).toBe(said.size)
  })

  it('⛔ the group that holds none of its text is nought per cent, and says why', async () => {
    const m = open()
    await press(m, 'not-held')
    const text = m.q('told-share-not-held').textContent?.replace(/\s+/g, ' ').trim() ?? ''
    expect(text).toContain('0%')
    expect(text).toContain('this sheet holds no text of theirs')
    expect(m.all('told-block'), 'a file with bytes is under the group that holds none').toEqual([])
  })
})

describe('§3 · light at rest, complete on a press (583 relay 2)', () => {
  /**
   * ⛔ **Rule 1 of this panel kept rather than dropped** (`086`: *each row is one file, at its
   * real path*). ⚠️ Seven sections of one bundle printed a 104-character path seven times; the
   * address is still there, and a person who wants it has opened the row.
   */
  it('⛔ a row at rest carries no path, and opening it gives the path and the provenance', async () => {
    const m = open()
    const row = m.all('told-block')[0]
    expect(row).toBeDefined()
    expect(row?.textContent, 'the path is on the resting row').not.toContain(BUNDLE_PATH)
    expect(m.host.querySelector('[data-cy="told-block-label"]')).toBeNull()

    row?.querySelector<HTMLButtonElement>('[data-cy="told-block-toggle"]')?.click()
    await nextTick()
    const opened = m.all('told-block')[0]
    expect(opened?.textContent, 'the address did not arrive with the press').toContain(BUNDLE_PATH)
    // ⚑ **And WHICH of that owner's things it is** — the group heading says whose, this says what,
    // and `086`'s rule is that a reader who cannot tell two provenances apart edits the wrong file.
    expect(m.q('told-block-label').textContent?.trim()).not.toBe('')
  })

  /**
   * The initial view has one line; the membership explanation is behind `more`. Assert the
   * DOM, rather than only a constant.
   */
  /**
   * ⛔ **The state `HO-073` §2 is about, said rather than left blank** — and asserted by its
   * constant so the sentence cannot lose the half that names the door (standing rule 5).
   */
  it('⚑ an agent nobody has written rules for says so, and says where they go', async () => {
    // ⚑ **A launch this app really composed for** — `composed` is a string, so the bundle it
    // appended had no `Your own instructions` section and *nobody has written one* is the truth.
    const bare = open({
      ...EVERYTHING,
      injected: [file('repository-conventions')],
      agentMemory: [],
      composed: '# Your instructions\n\n## Rules\n\n- a rule\n',
    })
    await press(bare, 'configured')
    expect(bare.q('told-nothing-of-yours').textContent).toContain(NOTHING_OF_YOURS_YET)
    expect(bare.all('told-block'), 'a group with nothing in it drew a row').toEqual([])
  })

  /**
   * 🔴 **…and on a provider this app appends nothing to, it says the opposite thing** — because
   * the opposite thing is what is true there (found reviewing this dispatch's own diff).
   *
   * ⛔ **`readSessionInstructions` returns `injected: []` for every non-Claude provider**, so the
   * `configured` group is empty whether or not a person has written rules — and their rules ARE
   * in that agent's prompt, inside the leaf BroBot published for the provider to read. ⚠️ *Nothing
   * of yours reaches this agent yet* was the worst sentence this sheet can say: a standing rule
   * reported as not reaching an agent that is following it.
   */
  it('⛔ …and where this app appended nothing, it does not claim the person has written none', async () => {
    const codex = open({
      ...EVERYTHING,
      injected: [],
      agentMemory: [],
      provider: [{ path: '/homes/codex/AGENTS.override.md', scope: 'profile' }],
      refused: [],
      composed: null,
    })
    await press(codex, 'configured')
    const said = codex.q('told-nothing-of-yours').textContent ?? ''
    expect(said).toContain(THIS_SHEET_CANNOT_SAY_WHAT_IS_YOURS)
    expect(
      said,
      'the sheet claimed a rule is not reaching an agent that may be following it',
    ).not.toContain('Nothing of yours reaches this agent yet')
    // ⛔ **The reading that pairs it** (`556`): the sheet really drew this conversation, so the
    // sentence above is about a launch it read rather than about an empty mount.
    expect(codex.q('told-sentence').textContent?.trim()).not.toBe('')
  })

  it('⚑ one short line is drawn and the paragraph is behind a press', async () => {
    const m = open()
    const whose = selected(m) as WhoseText
    expect(m.q(`told-group-says-${whose}`).textContent).toContain(WHOSE_WORDS[whose].short)
    expect(m.host.querySelector(`[data-cy="told-group-more-${whose}"]`)).toBeNull()
    m.q(`told-group-why-${whose}`).click()
    await nextTick()
    expect(m.q(`told-group-more-${whose}`).textContent).toContain(WHOSE_WORDS[whose].says)
  })

  it('⚠️ …and moving to another tab closes it, so a fold never reopens under a different heading', async () => {
    const m = open()
    const first = selected(m) as WhoseText
    m.q(`told-group-why-${first}`).click()
    await nextTick()
    expect(m.q(`told-group-more-${first}`).textContent).toContain(WHOSE_WORDS[first].says)
    await press(m, 'configured')
    expect(m.host.querySelector('[data-cy="told-group-more-configured"]')).toBeNull()
    // ⛔ **The reading that pairs the absence** (`556`): the new tab really drew its own short
    // line, so the fold is closed rather than the panel being empty or on another heading.
    expect(m.q('told-group-says-configured').textContent).toContain(WHOSE_WORDS.configured.short)
  })
})

describe('§4 · a tablist that keeps the promise the role makes (583 relay 2)', () => {
  /**
   * 🔴 **`role="tablist"` PROMISES arrow keys**, and a promise a control does not keep is worse
   * than a plainer control — the announcement and the behaviour would disagree, and the one a
   * person can check is the behaviour.
   */
  it('⛔ the arrows move the selection, and Home and End reach both ends', async () => {
    const m = open()
    const keys = strip(m)
    expect(keys.length).toBeGreaterThan(2)

    const key = (name: string): void => {
      const on = m.host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      on?.dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
      )
    }
    key('ArrowRight')
    await nextTick()
    expect(selected(m)).toBe(keys[1])
    key('ArrowLeft')
    await nextTick()
    expect(selected(m)).toBe(keys[0])
    // ⚑ **It wraps**, which is the pattern's own behaviour and the reason a person never has to
    // know where they are in the strip.
    key('ArrowLeft')
    await nextTick()
    expect(selected(m)).toBe(keys.at(-1))
    key('Home')
    await nextTick()
    expect(selected(m)).toBe(keys[0])
    key('End')
    await nextTick()
    expect(selected(m)).toBe(keys.at(-1))
  })

  /**
   * ⛔ **Roving tabindex**: the strip is ONE stop in the page's tab order, which is the other half
   * of the role's promise. ⚠️ Without it a person tabs through eight buttons to reach the rows.
   */
  it('⚑ the strip is one stop in the tab order, not eight', async () => {
    const m = open()
    const stops = [...m.host.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
      (el) => el.tabIndex === 0,
    )
    expect(stops).toHaveLength(1)
    expect(stops[0]?.getAttribute('aria-selected')).toBe('true')
    await press(m, 'as-sent')
    const after = [...m.host.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
      (el) => el.tabIndex === 0,
    )
    expect(after).toHaveLength(1)
    expect(after[0]?.dataset.cy).toBe('told-tab-as-sent')
  })
})

describe('§5 · the row that is in no group is still a row (583)', () => {
  /**
   * 🔴 **The fail-closed arm draws every mark an ordinary row draws.**
   *
   * ⛔ **Found by an agent re-aiming another file, not by me.** The first version of this block
   * drew the name, the bytes and the path and nothing else — so on the ONE path that exists for
   * bytes this app does not trust, a bundle that was CUT read as a bundle that was short, and the
   * provenance label went with it. ⚠️ **Derived rather than listed**: the hooks an ordinary row
   * draws are read off an ordinary row, so a mark added to one and not the other is a red here
   * rather than a difference nobody looks for.
   */
  it('⛔ an unsplit bundle carries the same marks as a row in a group', async () => {
    const cut = { ...BUNDLE, truncated: true }
    const split: SessionInstructions = { ...EVERYTHING, injected: [cut] }
    const m = open(split)
    const ordinary = m.all('told-block')[0]
    ordinary?.querySelector<HTMLButtonElement>('[data-cy="told-block-toggle"]')?.click()
    await nextTick()
    const marks = (el: Element | undefined): string[] =>
      [...(el?.querySelectorAll<HTMLElement>('[data-cy]') ?? [])]
        .map((one) => (one.dataset.cy ?? '').replace(/-(prompt|on-request)$/, '-*'))
        .filter((cy) => cy !== '' && !cy.startsWith('doc-'))
        .sort()
    const expected = marks(m.all('told-block')[0])
    expect(
      expected,
      'the ordinary row drew no marks — the comparison measures nothing',
    ).not.toEqual([])
    m.unmount()

    const noMap = { ...cut }
    delete (noMap as { sections?: unknown }).sections
    const whole = open({ ...EVERYTHING, injected: [noMap] })
    // ⛔ **By its constant, not by a substring** (standing rule 5): a sentence a test can only
    // name by quoting part of it is a sentence that drifts one clause at a time.
    expect(whole.q('told-unsplit').textContent).toContain(COULD_NOT_TELL_WHICH_PART)
    const row = whole.all('told-block')[0]
    row?.querySelector<HTMLButtonElement>('[data-cy="told-block-toggle"]')?.click()
    await nextTick()
    // ⚑ The unsplit row has no reach word — it is not a memory file — so the comparison is that
    // it carries every mark the ordinary row does EXCEPT the ones a bundle cannot have.
    const drawn = marks(whole.all('told-block')[0])
    const owed = expected.filter((cy) => !cy.startsWith('memory-reach-'))
    expect(
      owed.filter((cy) => !drawn.includes(cy)),
      'the row in no group is missing marks every other row carries',
    ).toEqual([])
    expect(drawn, 'a cut bundle does not say it was cut').toContain('told-block-truncated')
    expect(drawn, 'a bundle in no group loses its provenance').toContain('told-block-label')
  })
})
