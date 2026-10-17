import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type {
  CreatedSession,
  InjectedInstruction,
  SessionInstructions,
} from '../../src/shared/runtime-ipc'
import { META, mount, paneProps, record, toldProps, unmountAll, type Mounted } from './harness'

/**
 * **🔴 If we inject it, he can see it** (158 §3).
 *
 * > *"If we're injecting any custom prompt or system hint to the agent, we need to display it in
 * > the UI in the conversation."*
 *
 * A hint built and passed to `start` must reach a renderer surface; otherwise a
 * default-workspace Claude session can receive appended system text that the person never
 * sees.
 *
 * A DOM test rather than an SSR render, for the reason 083 built this harness: the block is a
 * disclosure with a control in it, and *"a rule kept in a component's template is a rule nothing
 * can assert without a browser."* The text only exists after a click.
 *
 * ## ⚑ `583` · the panel is a TAB STRIP, and that is why every test below presses something
 *
 * The prompt’s six owners are six tabs, with only one tab’s rows in the DOM at a time. A
 * row’s visibility is checked on its owner’s tab: {@link press} selects the tab, and
 * `data-whose` asserts that the row belongs there.
 *
 * ⚑ **The per-file hooks went with it.** `injected-<kind>`, `injected-toggle-<kind>`,
 * `injected-truncated-<kind>` and `injected-link-<kind>` are gone, because the compiled bundle is
 * now several rows of one file; every row is `told-block` carrying `data-kind`, `data-whose`,
 * `data-heading` and `data-truncated`. 🔴 **The attributes are the answer and the words are for
 * the person** — `163`'s rule, and the reason nothing below parses a heading to learn which group
 * a row is in.
 */

afterEach(unmountAll)

const NOTHING: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: false,
  composed: null,
}

/**
 * ⚑ **The block itself since `527`, rather than the drawer it used to be welded into.**
 *
 * ⛔ **It used to mount `SessionDrawer` on the Info tab and go looking**, because this component
 * had no root of its own — `525`'s named refactor cost, and `HO-050` §1.1 is what paid it. ⚠️ The
 * `over` argument survived the move: two tests below vary `relaunched`, which is still this
 * component's prop and still the record's derivation.
 */
function openInfo(instructions: SessionInstructions, over: Record<string, unknown> = {}): Mounted {
  return mount(AgentInstructionsSheet as never, toldProps(instructions, over), { width: 760 })
}

/**
 * 🔴 **Both surfaces at once, for the claims that really are about both** (`527`).
 *
 * ⛔ **`172`'s reading is a cross-surface claim and always was**: *every path on this panel belongs
 * to the profile the conversation is running in*. Since `HO-050` §1.1 the home is on the index and
 * the files are on the sheet, so proving it takes the surface that mounts both — which is the pane,
 * with the index entry pressed. ⚑ **The claim got stronger rather than weaker**: it now holds
 * across the split the ruling introduced, which is exactly where a profile could leak.
 */
function bothSurfaces(
  instructions: SessionInstructions,
  over: Partial<CreatedSession> = {},
): Mounted {
  const held = record([])
  held.meta = { ...META, ...over, instructions }
  const view = mount(
    ConversationPane,
    paneProps({ record: held, drawerOpen: true, drawerTab: 'info' }),
    { width: 1200, height: 900 },
  )
  view.q('told-index').click()
  return view
}

const hooks = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('[data-cy]')].map((el) => el.getAttribute('data-cy')!)

/* ------------------------------------------------------------- 583 · the tab strip */

const TAB = 'told-tab-'

/**
 * ⚑ **Every tab the strip drew, in the order it drew them** — derived from the strip rather than
 * typed, because the list IS the assertion in two tests below: a group with nothing in it is not
 * a tab, which is what rule 2 became when the panel stopped being one gate over four lists.
 */
const tabKeys = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('[data-cy^="' + TAB + '"]')].map((el) =>
    el.getAttribute('data-cy')!.slice(TAB.length),
  )

/**
 * ⛔ **Press a tab and let Vue draw it.** `Mounted.q` asserts the control exists, so a test that
 * presses a tab has already asserted that the owner it names has a tab at all.
 */
async function press(m: Mounted, key: string): Promise<Mounted> {
  m.q(`${TAB}${key}`).click()
  await nextTick()
  return m
}

/** One `told-block` row, read through its attributes rather than its rendered words (`163`). */
interface Row {
  readonly el: HTMLElement
  readonly kind: string
  readonly whose: string
  readonly heading: string
  readonly truncated: string
}

const rows = (host: HTMLElement): Row[] =>
  [...host.querySelectorAll<HTMLElement>('[data-cy="told-block"]')].map((el) => ({
    el,
    kind: el.getAttribute('data-kind') ?? '',
    whose: el.getAttribute('data-whose') ?? '',
    heading: el.getAttribute('data-heading') ?? '',
    truncated: el.getAttribute('data-truncated') ?? '',
  }))

/**
 * ⚠️ **Exactly one row of that kind on the tab on screen** — the count is asserted rather than
 * assumed, so a change that drew a file twice fails here instead of quietly satisfying the first
 * `querySelector` (`an-assertion-can-be-satisfied-by-a-neighbouring-element`).
 */
function row(host: HTMLElement, kind: string): Row {
  const found = rows(host).filter((one) => one.kind === kind)
  expect(found.length, `exactly one told-block of kind ${kind} on the tab on screen`).toBe(1)
  return found[0]!
}

/** Open one row. The path, the label, the reach sentence and the paper are all behind this. */
async function openRow(one: Row): Promise<Row> {
  one.el.querySelector<HTMLButtonElement>('[data-cy="told-block-toggle"]')!.click()
  await nextTick()
  return one
}

const within = (one: Row, cy: string): HTMLElement | null =>
  one.el.querySelector<HTMLElement>(`[data-cy="${cy}"]`)

/**
 * 🔴 **The WHOLE sheet: every tab, with every row opened.**
 *
 * ⛔ **An absence asserted on one tab is not an absence** now that one tab is in the DOM at a
 * time — a row filed under a different owner would be invisible to it, and `086` in the other
 * direction is exactly the defect that would hide. ⚑ So every negative in this file that used to
 * range over the mounted panel ranges over this instead, which is the same set of elements the
 * one-block panel used to hold.
 *
 * ⚠️ **Rows are left OPEN afterwards**, deliberately: the path, the provenance label and the text
 * are behind the press since `583`, so a sweep that closed them again would be reading the resting
 * row and calling it the panel.
 */
async function wholeSheet(m: Mounted): Promise<{
  readonly text: string
  readonly hooks: readonly string[]
  readonly kinds: readonly string[]
}> {
  let text = ''
  const seen = new Set<string>()
  const kinds: string[] = []
  for (const key of tabKeys(m.host)) {
    await press(m, key)
    for (const toggle of m.all('told-block-toggle')) {
      toggle.click()
      await nextTick()
    }
    for (const one of rows(m.host)) kinds.push(one.kind)
    text += ` ${m.host.textContent ?? ''}`
    for (const cy of hooks(m.host)) seen.add(cy)
  }
  return { text, hooks: [...seen], kinds }
}

/* ------------------------------------------------------------------ nothing */

describe('a session that was told nothing extra', () => {
  it('⚑ the sheet is titled in the words the ruling adopted', () => {
    // ⚑ The sheet takes the design's own label rather than a fourth spelling of it, and this test
    // is where that title is held.
    const m = openInfo(NOTHING)
    expect(m.host.querySelector('[data-cy="agent-sheet-title"]')?.textContent).toBe(
      'What this agent was told',
    )
  })

  it('⛔ draws NO owner’s block for a session told nothing — not a heading, not an empty list', async () => {
    // 086 in the other direction: a conversation with nothing injected must look exactly like one
    // in an app that has no such feature. An "instructions: none" row would be the same noise the
    // ticket is trying to remove, wearing the opposite sign.
    //
    // ⚑ **Re-aimed at what rule 2 IS since `583`, and it did not go away — it moved.** ⛔ The old
    // gate was one `anything` boolean over the whole block, and `data-cy="session-instructions"`
    // was the element it withheld; that hook is now the tab panel and is drawn on every
    // conversation, so asserting it is null would assert nothing. ⚠️ **The rule is now PER GROUP**
    // (`WhoseGroup.drawn`): an owner with no layer and no file is not drawn, and therefore has no
    // tab. 🔴 So the absence is the absence of the OWNERS' tabs and of every `told-block` row —
    // which is the same claim, addressed where the product now makes it.
    //
    // Two empty groups are drawn deliberately. `configured` carries `told-nothing-of-yours`
    // and the route for adding personal instructions. `learned` carries
    // `TOLD_REMEMBERS_NOTHING`, showing that memory belongs there even when none has been
    // supplied. `not-held` is not an exception: it contains the provider’s own layer and
    // published verbs.
    const m = openInfo(NOTHING)

    expect(tabKeys(m.host)).toEqual(['configured', 'learned', 'not-held', 'as-sent'])

    const sheet = await wholeSheet(m)
    // 🔴 **Not one file row anywhere on the sheet** — the rule, stated over every tab rather than
    // over the one that happens to be on screen.
    expect(sheet.kinds).toEqual([])
    expect(sheet.hooks).not.toContain('told-block')
    // …and the two exceptions really are saying their sentence, so this is an absence of ROWS
    // rather than two blank tabs.
    expect(sheet.hooks).toEqual(
      expect.arrayContaining(['told-nothing-of-yours', 'told-remembers-nothing']),
    )
    // …and the surface still rendered, so this is an absence rather than a mount that did nothing.
    // ⚑ **Re-aimed at `583`, not weakened.** It used to pair against `told-composition`, which is
    // the one thing this component drew unconditionally (`442`: the layer list is never empty).
    // That block is still unconditional and still never empty — it is on the `as sent` tab now,
    // which is one press away, so the pair is the same pair with its address written down.
    await press(m, 'as-sent')
    expect(hooks(m.host)).toContain('told-composition')
  })

  it('⚑ 442 · …and the COMPOSITION row is still there, because it answers a different question', async () => {
    // 🔴 **The rule above is unchanged and this is not an exception to it** (442, criterion 24).
    // That block reports what BroBot APPENDED and draws nothing when it appended nothing; this row
    // reports the LAYERS of the prompt, and it has an answer on every conversation — the
    // provider's own instructions are underneath and this app has never held a byte of them.
    // ⚠️ Nothing empty is drawn here either: the layer list is never empty, which is the whole
    // reason it may be unconditional.
    //
    // ⚑ **583 split the account across two tabs and removed none of it.** The composition as sent
    // is the one layer that belongs to no owner, so it stays in the account on `as sent`; the two
    // opaque layers belong to `not-held`, which is the group `583` §3 created precisely so they
    // would not be folded into *ours*. Both addresses are pressed below.
    const m = openInfo(NOTHING)

    await press(m, 'as-sent')
    expect(m.host.querySelector('[data-cy="told-composition"]')).not.toBeNull()
    // …and *"BroBot appended nothing"* is the positive form of the absence above.
    expect(m.host.querySelector('[data-cy="told-appended-nothing"]')?.textContent).toContain(
      'appended nothing',
    )
    // ⛔ **The opaque layer is DRAWN rather than omitted** (442 §2.1) — under the owner that holds
    // none of it, which is where `583` §3 put it.
    await press(m, 'not-held')
    expect(m.host.querySelector('[data-cy="told-layer-provider-base"]')).not.toBeNull()

    // 🔴 …while no LIST row is invented for a file that is not there — swept over EVERY tab,
    // because a row filed under an owner this test never pressed would otherwise be invisible.
    const sheet = await wholeSheet(m)
    for (const absent of [
      // ⚑ The two file rows, named the way `583` names them: the per-kind hooks are gone and the
      // kind is an attribute now, so the absence is asserted over the kinds the sheet drew.
      'provider-instruction',
      'refused-instruction',
      'told-layer-agent-store',
      'told-layer-app-composed',
      'told-layer-provider-discovered',
    ]) {
      expect(sheet.hooks, absent).not.toContain(absent)
    }
    expect(sheet.kinds).not.toContain('profile-memory')
    expect(sheet.kinds).not.toContain('agent-memory')
  })
})

/* --------------------------------------------------------- what WE injected */

describe('what BroCrew appended', () => {
  const injected: SessionInstructions = {
    agentMemory: [],
    injected: [
      {
        kind: 'profile-memory',
        path: '/homes/claude/CLAUDE.md',
        text: '# Who I am\n\nI am the developer profile.',
        bytes: 41,
        truncated: false,
      },
      {
        kind: 'project-memory',
        path: '/work/checkout/CLAUDE.md',
        text: '# This repo\n\nRun the tests before you commit.',
        bytes: 45,
        truncated: false,
      },
      {
        kind: 'workspace-instructions',
        path: '/userdata/brobot-workspace/CLAUDE.md',
        text: '# BroCrew workspace\n\nThis directory persists across conversations.',
        bytes: 64,
        truncated: false,
      },
    ],
    provider: [],
    refused: [],
    note: 'Read at launch and appended as text.',
    recallsReported: false,
    writesReported: false,
    composed: null,
  }

  it('⛔ every item shows its SOURCE — the path, not a category name', async () => {
    // 086: name what it is AND where it came from. A merged blob with no provenance is not a
    // disclosure, and neither is a list of kinds with no files under them.
    //
    // ⚑ **583 moved the path one press in, and the claim is unchanged.** ⛔ Seven sections of one
    // compiled bundle printed a 104-character path seven times, so a row is NAMED by its section
    // heading or the file's basename at rest and carries the whole address when it is opened.
    // ⚠️ **So this asserts both halves**: the resting row does not pass a path off as a name, and
    // the path is really there for the person who asked. 🔴 And it now also asserts WHOSE each
    // file is, which is the question `HO-073` §4 added — a fact the old per-kind hook could not
    // carry.
    const m = openInfo(injected)
    const sheet = await wholeSheet(m)

    expect(sheet.text).toContain('/homes/claude/CLAUDE.md')
    expect(sheet.text).toContain('/work/checkout/CLAUDE.md')
    expect(sheet.text).toContain('/userdata/brobot-workspace/CLAUDE.md')
    // ⛔ **One row per file, and each under the owner `WHOSE_FILE` declares** — the app's own
    // generated file is BroBot's, the cwd file is the place's, and the provider home's `CLAUDE.md`
    // is the agent's (`HO-009` §2 and §3).
    expect(sheet.kinds.length).toBe(3)
    for (const [kind, whose] of [
      ['workspace-instructions', 'factory'],
      ['project-memory', 'the-place'],
      ['profile-memory', 'learned'],
    ] as const) {
      await press(m, whose)
      expect(row(m.host, kind).whose, kind).toBe(whose)
    }

    // ⚠️ **The resting row is a NAME, not an address** — the half of the move that could go wrong
    // silently, because a row that printed the path would still pass every assertion above.
    // ⛔ A SECOND mount, because `wholeSheet` above opened every row of this one and a resting row
    // cannot be read off a sheet somebody has already pressed open.
    const resting = await press(openInfo(injected), 'the-place')
    const shut = row(resting.host, 'project-memory')
    expect(shut.el.textContent).toContain('CLAUDE.md')
    expect(shut.el.textContent).not.toContain('/work/checkout/')
  })

  it('⛔ …and its TEXT, on the same paper every other document in this app opens on', async () => {
    // ⚑ **`profile-memory` is the AGENT's since `583`** (`WHOSE_FILE`: *"the file one line down and
    // one directory over"* from the compiled bundle, with the opposite owner) — so the row this
    // test has always opened is on the `the agent's own` tab. The press is the address; the claim
    // is the same one.
    const m = openInfo(injected)
    await press(m, 'learned')

    expect(m.host.textContent, 'collapsed to start — the name is the disclosure').not.toContain(
      'I am the developer profile',
    )

    await openRow(row(m.host, 'profile-memory'))

    // The standing rule wherever a document renders: Markdown + Raw, on white paper. Reused, not
    // rebuilt — this is `DocumentBody`, the same component the drawer and every preview use.
    const paper = m.host.querySelector('[data-cy="document-body"]')
    expect(paper).not.toBeNull()
    expect(paper!.getAttribute('data-on-white')).not.toBeNull()
    expect(hooks(m.host)).toEqual(expect.arrayContaining(['doc-view-markdown', 'doc-view-raw']))
    expect(m.host.textContent).toContain('I am the developer profile')
  })

  it('⚑ the app’s OWN file says so — provenance survives the merge', async () => {
    // A file BroBot generates and a file the user wrote are different claims. Presenting the
    // workspace file as ordinary project memory would be a lie by omission.
    //
    // ⚑ **583 says it TWICE and this asserts both.** ⛔ The tab says whose the file is — it is on
    // `BroBot's own`, and `data-whose` is that answer — and the row's own `told-block-label` still
    // carries `LABELS[kind]`, because *which* of an owner's things a row is is a second-order
    // distinction the group heading cannot make (`086`). ⚠️ **The label was dropped by the first
    // tab rewrite and put back**, which is why it is asserted by hook here rather than by sweeping
    // the row's words.
    const m = openInfo(injected)
    await press(m, 'factory')
    const one = row(m.host, 'workspace-instructions')

    expect(one.whose).toBe('factory')
    await openRow(one)
    expect(within(one, 'told-block-label')?.textContent).toContain('written by BroCrew')
  })

  it('⚠️ a TRUNCATED file says it was cut, where the text is', async () => {
    // The model got this much and no more. A file cut at the cap must never read as a short file.
    //
    // ⚑ **583 says it twice, at two distances.** ⛔ `injected-truncated-<kind>` is gone; the row
    // carries `data-truncated` and a `told-block-truncated` chip reading *cut* at rest, and the
    // sentence a person acts on — *the model was given this much and no more* — is in
    // `told-block-truncated-says`, beside the text it is about. ⚠️ **Both are asserted**: the chip
    // alone would let the sentence disappear into a fold, and the sentence alone would let a cut
    // file rest on the panel looking like a short one.
    const m = openInfo({
      ...injected,
      injected: [{ ...injected.injected[0]!, truncated: true }],
    })
    await press(m, 'learned')
    const one = row(m.host, 'profile-memory')

    expect(one.truncated).toBe('true')
    expect(within(one, 'told-block-truncated')?.textContent?.trim()).toBe('cut')
    await openRow(one)
    expect(within(one, 'told-block-truncated-says')?.textContent).toContain(
      'the model was given this much and no more',
    )

    // ⚑ **The paired negative** (`193`): without it a chip and a sentence printed unconditionally
    // would pass every assertion above, and *cut* on a whole file is the one word here that must
    // never be decoration.
    const whole = openInfo(injected)
    await press(whole, 'learned')
    const intact = await openRow(row(whole.host, 'profile-memory'))
    expect(intact.truncated).toBe('false')
    expect(within(intact, 'told-block-truncated')).toBeNull()
    expect(within(intact, 'told-block-truncated-says')).toBeNull()
  })

  it('says WHEN it was read, so the panel does not read as live', async () => {
    // 158 §2: a file changed mid-conversation takes effect at the next launch. The UI must not
    // imply otherwise, which is exactly what a refresh button here would have done.
    // ⚑ **Behind the block's own disclosure since 356 §1** — it explains a mechanism rather than
    // naming a file, so it moved one press away instead of sitting on the panel unasked.
    // ⛔ **583 moved that disclosure onto the `as sent` tab**, with the rest of the account of the
    // prompt; it is two presses away now and it is the same fold with the same subject.
    const m = openInfo(injected)
    await press(m, 'as-sent')

    m.q('instructions-why').click()
    await nextTick()

    expect(m.host.querySelector('[data-cy="instructions-note"]')?.textContent).toContain(
      'Read at launch',
    )
  })
})

/* ------------------------------------------------------ what the PROVIDER read */

describe('what the provider read by itself (Codex)', () => {
  const codex: SessionInstructions = {
    injected: [],
    agentMemory: [],
    // ⚑ **Scoped rows since 356**, and the two chosen so the layers DIVERGE: the first sits in the
    // home this mount overrides `providerHome` to, the second on the cwd chain. A pair that both
    // landed in one layer would agree under either reading and measure neither.
    provider: [
      { path: '/homes/codex/AGENTS.md', scope: 'profile' },
      { path: '/work/checkout/AGENTS.md', scope: 'project' },
    ],
    refused: [],
    note: 'BroCrew appends nothing for this provider — it reads its own instruction files.',
    recallsReported: false,
    writesReported: false,
    composed: null,
  }

  /**
   * ⛔ **`583` put the provider's own list on the `not shown` tab, and that is an argument rather
   * than a filing decision.** ⚑ `583` §3 forbids folding the absences into *ours*: the app holds
   * none of these bytes — paths and no content (`430`) — and *"one group, one property"* is what
   * the group is for. ⚠️ So every test below presses `not-held` first, and the press is itself the
   * assertion that the list did not land under an owner this app cannot claim.
   */
  const codexPanel = async (instructions = codex): Promise<Mounted> =>
    press(openInfo(instructions, { provider: 'codex' }), 'not-held')

  it('⛔ Codex’s own list is shown, by path', async () => {
    // 156 §4 measured that BroBot neither retained nor surfaced these. Nearly free, and included
    // for that reason: the user's question is "what was this agent told", not "what did BroBot
    // inject".
    //
    // ⚠️ **Scoped to `.path` since 356**, and it stays an exact equality. The row now carries a
    // layer chip and its two buttons, so reading the whole row's `textContent` would assert about
    // the affordances as well — and 356's own trap list says an assertion can be satisfied by a
    // neighbouring element. The paths are what this test is about.
    const { host } = await codexPanel()
    const found = [...host.querySelectorAll('[data-cy="provider-instruction"] .path')].map(
      (el) => el.textContent?.trim() ?? '',
    )

    expect(found).toEqual(['/homes/codex/AGENTS.md', '/work/checkout/AGENTS.md'])
  })

  it('⚠️ …and says it is the PROVIDER’s list, not ours', async () => {
    // We did not choose these files and did not read them. Presenting them beside our own injected
    // text with no distinction would claim a decision this app never made.
    //
    // ⚑ **356 shortened the sentence and moved its long form behind the block's disclosure.** What
    // may not be lost is the CLAIM, so this asserts the label on the panel and then opens the fold
    // and asserts the paragraph — a label alone would let the provenance quietly disappear into a
    // fold nobody opens, and a fold alone would let the panel show an unattributed list.
    const { host } = await codexPanel()

    expect(host.querySelector('[data-cy="provider-instructions-lead"]')?.textContent).toContain(
      'Reported by the provider',
    )
  })

  it('⛔ …and each row says WHICH LAYER it belongs to (356 §3)', async () => {
    // 357: "A CWD `AGENTS.md` row must say project; it must never be presented as proof that the
    // selected profile owns it." The attribute is the answer and the word is for the person — 163's
    // rule, because a test that parses a sentence passes on a placeholder.
    const { host } = await codexPanel()
    const chips = [...host.querySelectorAll('[data-cy="provider-scope"]')]

    expect(chips.map((el) => el.getAttribute('data-scope'))).toEqual(['profile', 'project'])
    expect(chips.map((el) => el.textContent?.trim())).toEqual(['this profile', 'this project'])
  })

  it('⛔ …and a list with no profile layer in it SAYS so', async () => {
    // The state 357 measured on a real session: this app authors no profile instruction file, so
    // every row is the project's. A list of project files with nothing said about the other layer
    // reads as "this is what the profile has".
    const { host } = await codexPanel({
      ...codex,
      provider: [{ path: '/work/checkout/AGENTS.md', scope: 'project' }],
    })

    expect(host.querySelector('[data-cy="provider-instructions-absent"]')?.textContent).toContain(
      "Nothing above is this profile's own",
    )
  })

  it('⚑ …and it is silent when the profile DOES have one — the paired positive', async () => {
    // Without this, a build that printed the absence unconditionally would pass the test above.
    const { host } = await codexPanel()

    expect(host.querySelector('[data-cy="provider-instructions-absent"]')).toBeNull()
    // …and the block really mounted, so this is an absence rather than a mount that did nothing.
    expect(host.querySelectorAll('[data-cy="provider-instruction"]').length).toBe(2)
  })
})

/* ---------------------------------------------------------------- refusals */

/**
 * ⚑ **`583` gave the refusals a tab of their own, and named it for what they are.**
 *
 * ⛔ **They have no owner** — nothing was read, so there is nothing whose — which is why `not read`
 * is one of the two tabs that is not a `WhoseText` group. ⚠️ The tab exists only where something
 * was refused, which is rule 2 holding for it as well; `refusedPanel` presses it, so every test
 * below asserts the tab's existence before it asserts the row's words.
 */
const refusedPanel = async (instructions: SessionInstructions): Promise<Mounted> =>
  press(openInfo(instructions), 'not-read')

describe('a file the reader would not read', () => {
  it('🔒 is named, with the reason — an absence with a cause, never silence', async () => {
    // A file the walk did not send gets a row with its reason: since `733` a `symlink` row is a
    // chain of links that loops (a working link is followed). Silently skipping it would leave the
    // one outcome worth reporting invisible.
    const { host } = await refusedPanel({
      injected: [],
      agentMemory: [],
      provider: [],
      refused: [{ path: '/work/checkout/CLAUDE.md', reason: 'symlink' }],
      note: '',
      recallsReported: false,
      writesReported: false,
      composed: null,
    })
    const one = host.querySelector('[data-cy="refused-instruction"]')

    expect(one?.textContent).toContain('/work/checkout/CLAUDE.md')
    expect(one?.textContent).toContain('symlink')
    expect(one?.textContent).toContain('not read')
  })

  it('⛔ a file dropped for BUDGET is a row too, and does not claim it was not read (187 §2)', async () => {
    // ⚠️ **The other half of 170's rule.** This file was read, was fine, and did not fit: the total
    // cap ran out before it. `· not read: over-budget` would report a refusal for something the app
    // chose not to SEND — the fix a reader would go looking for is a different fix — so this reason
    // gets a sentence of its own instead of the raw word.
    const { host } = await refusedPanel({
      injected: [],
      agentMemory: [],
      provider: [],
      refused: [{ path: '/work/checkout/CLAUDE.md', reason: 'over-budget' }],
      note: '',
      recallsReported: false,
      writesReported: false,
      composed: null,
    })
    const one = host.querySelector('[data-cy="refused-instruction"]')

    expect(one?.textContent).toContain('/work/checkout/CLAUDE.md')
    expect(one?.textContent).toContain('the instruction budget ran out')
    expect(one?.textContent).not.toContain('not read')
    // ⚑ The raw word is not what the user reads — that was the defect this row's wording fixes.
    expect(one?.textContent).not.toContain('over-budget')
  })

  it('🔴 a memory index that is a BROKEN LINK says so, and says where it pointed (314 §3)', async () => {
    // A Claude `memory/MEMORY.md` symlink can point outside its provider home into
    // `/private/tmp`. While the target exists, `link` discloses it. After reboot clears
    // `/tmp`, the read yields ENOENT; the row must explain the missing memory rather than
    // silently treat the dangling link as `absent`.
    //
    // ⚠️ **And the target is the point.** `realpath` cannot recover where a broken link pointed;
    // `readlink` can, and it is the only fact worth printing about one.
    const { host } = await refusedPanel({
      injected: [],
      agentMemory: [],
      provider: [],
      refused: [
        {
          path: '/homes/claude/memory/MEMORY.md',
          reason: 'dangling-link',
          link: '/private/tmp/brobot-external-memory.md',
        },
      ],
      note: '',
      recallsReported: false,
      writesReported: false,
      composed: null,
    })
    const one = host.querySelector('[data-cy="refused-instruction"]')

    expect(one?.textContent).toContain('/homes/claude/memory/MEMORY.md')
    expect(one?.textContent).toContain('a link with nothing at the other end')
    expect(one?.textContent).toContain('/private/tmp/brobot-external-memory.md')
    // ⛔ …and NOT the reader's vocabulary: nothing declined to read anything here.
    expect(one?.textContent).not.toContain('not read')
    expect(one?.textContent).not.toContain('dangling-link')
  })

  it('⚑ …and a refusal with no link draws no target — the disclosure is not decoration', async () => {
    // The paired negative for the row above (193): without this, a template that printed the
    // sentence unconditionally would pass every assertion in it.
    const { host } = await refusedPanel({
      injected: [],
      agentMemory: [],
      provider: [],
      refused: [{ path: '/work/checkout/CLAUDE.md', reason: 'symlink' }],
      note: '',
      recallsReported: false,
      writesReported: false,
      composed: null,
    })

    expect(host.querySelector('[data-cy="refused-instruction"]')?.textContent).not.toContain(
      'it pointed at',
    )
  })

  it('⚠️ …and a reason this renderer has never heard of still says something true', async () => {
    // A main process that grows a new refusal before this map does must not render a blank row —
    // that is the silence the whole block exists to remove.
    const { host } = await refusedPanel({
      injected: [],
      agentMemory: [],
      provider: [],
      refused: [{ path: '/work/checkout/CLAUDE.md', reason: 'a-reason-from-the-future' }],
      note: '',
      recallsReported: false,
      writesReported: false,
      composed: null,
    })

    expect(host.querySelector('[data-cy="refused-instruction"]')?.textContent).toContain(
      'not read: a-reason-from-the-future',
    )
  })
})

/* --------------------------------- the memory the AGENT wrote (165, moved by 166) */

describe('the agent’s own memory', () => {
  // ⚠️ **The path in this fixture is the PROFILE's since 166** — `<providerHome>/memory/MEMORY.md`,
  // with no `projects/<sanitized-cwd>` segment. It is a string here and the assertions would pass
  // either way, which is exactly why it is corrected rather than left: a fixture depicting a path
  // the app can no longer produce teaches the next reader the wrong scoping.
  const index: InjectedInstruction = {
    kind: 'agent-memory',
    path: '/homes/claude/memory/MEMORY.md',
    text: '- [Project codename](codename.md) — the internal name is BROBOT-CANARY',
    bytes: 70,
    truncated: false,
    reach: 'prompt',
  }
  const remembered: SessionInstructions = { ...NOTHING, agentMemory: [index] }

  /**
   * ⚑ **Every row in this block is the agent's own** (`WHOSE_FILE`: the three `agent-memory*`
   * kinds and `profile-memory` all answer `learned`), so one press addresses the whole describe.
   */
  const learned = async (
    instructions: SessionInstructions,
    over: Record<string, unknown> = {},
  ): Promise<Mounted> => press(openInfo(instructions, over), 'learned')

  it('⛔ is shown, with its SOURCE — the path the provider derived, not a category name', async () => {
    const { host } = await learned(remembered)

    const one = row(host, 'agent-memory')
    expect(one.whose).toBe('learned')
    await openRow(one)
    expect(one.el.textContent).toContain('/homes/claude/memory/MEMORY.md')
  })

  it('🔴 …and says the AGENT wrote it, and that the PROVIDER loads it — not BroBot', async () => {
    // 086, the provenance rule this row exists for. Three authors now appear on this panel — the
    // user, the app, and the agent — and a reader who cannot tell them apart will edit the wrong
    // file. The label carries both halves because both are surprising.
    //
    // ⛔ **It said *"loaded by Claude itself"* until 317, and 314 made that false** by giving Codex
    // a memory too. ⚑ The title and the assertion are corrected in place rather than replaced (142):
    // the claim being made is the same one, with the provider name taken out of it.
    //
    // ⚠️ **583 moved the sentence from the row's `.meta` line into `told-block-label`, one press
    // in**, and the rule that it must still be SAID is the reason it is asserted by hook: a label
    // the tab rewrite dropped is a label no mutation can kill.
    const { host } = await learned(remembered)
    const one = await openRow(row(host, 'agent-memory'))
    const label = within(one, 'told-block-label')?.textContent ?? ''

    expect(label).toContain('written by the agent')
    expect(label).toContain('loaded by the provider')
    // ⚠️ The paired negative: it must not be described as something BroBot appended, which is what
    // every other row on this panel is.
    expect(label).not.toContain('written by BroCrew')
  })

  it('⛔ …and names NO provider, because both of them have one now (317 §2.3)', async () => {
    // 🔴 **The regression this asserts against is the one the dispatch is about.** A label that
    // names one provider goes false the day the other grows the feature, and it did — silently,
    // three dispatches later, in a sentence nobody had a reason to re-read.
    //
    // ⚠️ The whole panel, not just this row: the same trap is one careless word away in any of them.
    // ⚑ **And "the whole panel" is now every tab with every row opened** (`wholeSheet`), which is
    // strictly more text than the `.meta` lines this used to join: the tab labels, the six group
    // sentences and the provenance labels `583` wrote are all inside it, and every one of them is
    // somewhere a provider name could be typed.
    const m = await learned({
      ...remembered,
      injected: [
        {
          kind: 'profile-memory',
          path: '/homes/claude/CLAUDE.md',
          text: 'I am the developer profile.',
          bytes: 27,
          truncated: false,
        },
      ],
      refused: [{ path: '/homes/claude/memory/MEMORY.md', reason: 'symlink' }],
    })
    const sheet = await wholeSheet(m)

    expect(sheet.text, 'the panel rendered nothing to check').toContain('agent memory')
    for (const name of ['Claude', 'Codex']) expect(sheet.text).not.toContain(name)
  })

  it('🔴 says whether the model was GIVEN this, or could go and fetch it (317 §2.2)', async () => {
    // ⛔ 312 measured Codex injecting exactly one file of its store and leaving the rest to the
    // `memories__*` tools. A panel that rendered both the same way would be telling the user the
    // model knows something it may never have opened — 009's rule, and 305's defect.
    //
    // ⚑ **583 says it at two distances and both are asserted.** The resting row carries a SHORT
    // chip (`memory-reach-<reach>`: *in the prompt* / *on request*) because the fact is true of
    // every row in the tab and reading the sentence six times is what a chip is for; the sentence
    // itself — the one `REACH_WORDS` owns — is `memory-reach-says-<reach>`, beside the text.
    // ⚠️ **The chip alone would be a weakening**: three words cannot carry *"it reads this one only
    // if it chooses to"*, which is the half that stops 305's defect.
    const { host } = await learned({
      ...remembered,
      agentMemory: [
        { ...index, path: '/homes/codex/memories/memory_summary.md', reach: 'prompt' },
        {
          kind: 'agent-memory-note',
          path: '/homes/codex/memories/extensions/ad_hoc/notes/2026-09-04T00-00-00-user-name.md',
          text: "The user's name is Bob.",
          bytes: 23,
          truncated: false,
          reach: 'on-request',
        },
      ],
    })

    const summary = row(host, 'agent-memory')
    const note = row(host, 'agent-memory-note')
    expect(within(summary, 'memory-reach-prompt')?.textContent?.trim()).toBe('in the prompt')
    expect(within(note, 'memory-reach-on-request')?.textContent?.trim()).toBe('on request')

    await openRow(summary)
    await openRow(note)

    expect(within(summary, 'memory-reach-says-prompt')?.textContent).toContain(
      'put this in the prompt',
    )
    // ⚑ The positive that makes the negative below a measurement rather than a typo.
    expect(within(note, 'memory-reach-says-on-request')?.textContent).toContain(
      'only if it chooses to',
    )
    expect(note.el.textContent).not.toContain('put this in the prompt')
    // The note explains why it exists.
    expect(within(note, 'told-block-label')?.textContent).toContain(
      'a note the agent was asked to write',
    )
  })

  it('⛔ …and a row with no reach draws no such line — it is a disclosure, not decoration', async () => {
    // 193's rule: without this, a template that printed the words unconditionally would pass every
    // assertion above. `reach` is undefined on everything BroBot appended.
    //
    // ⚑ **Asserted with the row OPENED since `583`**, because there are two places the words could
    // now appear — the resting chip and the opened sentence — and a negative taken on the closed
    // row would be blind to the second of them.
    const { host } = await learned({
      ...NOTHING,
      injected: [
        {
          kind: 'profile-memory',
          path: '/homes/claude/CLAUDE.md',
          text: 'I am the developer profile.',
          bytes: 27,
          truncated: false,
        },
      ],
    })

    const one = await openRow(row(host, 'profile-memory'))
    expect(one.el.querySelector('[data-cy^="memory-reach-"]')).toBeNull()
    expect(host.querySelector('[data-cy^="memory-reach-"]')).toBeNull()
  })

  it('⛔ …and its TEXT opens on the same paper as every other document', async () => {
    const { host } = await learned(remembered)

    const one = row(host, 'agent-memory')
    expect(
      one.el.querySelector('[data-cy="told-block-toggle"]'),
      'the row is expandable',
    ).not.toBeNull()
    expect(host.textContent).not.toContain('BROBOT-CANARY') // collapsed: the name is the disclosure
    await openRow(one)
    expect(host.textContent).toContain('BROBOT-CANARY')
  })

  it('⚠️ renders NOTHING before the agent has written anything — including no empty block', async () => {
    // What a user sees the first time. 158's rule survives the addition: no heading, no "none".
    //
    // ⚑ **583 · the tab IS drawn and that is `536`'s exception, not a breach of the rule.** ⛔ The
    // rule is about ROWS — *"a row is a FILE and a layer is a CLAIM about the prompt"* — and this
    // group is drawn empty on purpose because *"an identity that has been told nothing at all is
    // exactly the identity whose reader has no other way to learn that memory belongs here."*
    // ⚠️ So the assertion is that the tab carries the SENTENCE and no rows and no layer, which is
    // the same rule `442` and `536` settled, addressed where `583` draws it.
    const m = await learned(NOTHING)

    expect(rows(m.host)).toEqual([])
    expect(m.host.querySelector('[data-cy="told-remembers-nothing"]')).not.toBeNull()
    // ⚑ **442**: and no memory LAYER either, which is the same rule one surface over — swept, so a
    // layer drawn under some other owner could not hide from it.
    expect((await wholeSheet(m)).hooks).not.toContain('told-layer-agent-store')
  })

  it('⛔ …and nothing for a session shape that predates the field entirely', async () => {
    // 🔴 **The regression this addition actually caused, before a mutation put it back.** The
    // component's "is there anything to show" test was `agentMemory !== null`, and a
    // `SessionInstructions` recorded before 165 has the key MISSING — `undefined !== null` is true,
    // so the panel rendered an empty `<dd>` with a heading and no rows. Rule 2 broken by the very
    // change rule 2 is about.
    //
    // ⚠️ The cast is the point: this is the shape a stored session or an older host really has, and
    // no typed fixture can express it.
    const legacy = {
      injected: [],
      provider: [],
      refused: [],
      note: '',
      recallsReported: false,
      // ⛔ **No `composed` either, and 442 put it back after adding one.** The field arrived at
      // 442 and this fixture is *the shape an older host really sends*; spelling it here would
      // have made the fixture describe a host that has the field, which is the one thing it
      // exists not to be. ⚠️ `undefined !== null` is true, so the un-normalised projection drew a
      // layer whose bytes were `undefined` — found reviewing that dispatch's own diff.
      writesReported: false,
    } as unknown as SessionInstructions
    const m = openInfo(legacy)

    // ⚑ **Rule 2 as `583` states it**: not one owner's row anywhere, and no tab for an owner that
    // has nothing — the missing key must not conjure either.
    const sheet = await wholeSheet(m)
    expect(sheet.kinds).toEqual([])
    expect(tabKeys(m.host)).toEqual(['configured', 'learned', 'not-held', 'as-sent'])
    // ⚑ **442 · the same shape, one surface over.** The composition row IS drawn for this session,
    // and the missing key must not become a layer there either: `undefined !== null` is true, so
    // an un-normalised projection drew an `app-composed` layer whose bytes were `undefined` and
    // lost the *"appended nothing"* sentence at the same time.
    expect(sheet.hooks).not.toContain('told-layer-app-composed')
    await press(m, 'as-sent')
    expect(m.host.querySelector('[data-cy="told-appended-nothing"]')).not.toBeNull()
  })

  it('⛔ …and a shape from BEFORE it was a list draws ONE row, not one per property (317)', async () => {
    // 🔴 **The regression the shape change could have caused.** `agentMemory` was a single object
    // until 317 and is a list now; `v-for` over 165's object would have iterated its own VALUES —
    // a row for the kind, a row for the path, a row for the byte count — each of them nonsense and
    // none of them an error.
    //
    // ⚠️ The cast is the point: this is the shape an older host really sends, and no typed fixture
    // can express it. The renderer normalises rather than trusting the type.
    const older = { ...NOTHING, agentMemory: index } as unknown as SessionInstructions
    const m = await learned(older)

    // It renders nothing rather than garbage, and the paired positive is that the SAME item in a
    // list renders exactly one row — so this is normalisation, not a component that never draws.
    expect(rows(m.host)).toEqual([])
    const listed = await learned({ ...NOTHING, agentMemory: [index] })
    expect(rows(listed.host).map((one) => one.kind)).toEqual(['agent-memory'])
  })

  it('🔴 a REDIRECTED index says where the text really came from (170 §2)', async () => {
    // ⛔ 168 H3: `memory/MEMORY.md -> /tmp/secret.md` is followed by the pinned CLI with `stat`, so
    // its text is in the model's prompt. BroBot refused it and showed nothing — no content, no
    // path, not even a refused row. The ruling is that it follows what the provider follows and
    // states the redirection; this asserts the second half, which is the part a user acts on.
    //
    // ⚑ **`injected-link-<kind>` became `told-block-link`, inside the opened row** — the same
    // disclosure one press in, beside the path it is a redirection OF, which is where it belongs.
    const { host } = await learned({
      ...remembered,
      agentMemory: [{ ...index, link: '/tmp/secret.md' }],
    })
    const one = await openRow(row(host, 'agent-memory'))

    expect(within(one, 'told-block-link')).not.toBeNull()
    expect(one.el.textContent).toContain('/tmp/secret.md')
    // ⚠️ *"Claude followed it"* until 317, for the reason the label above changed: 314 gave the
    // other provider a memory that is followed the same way.
    expect(one.el.textContent).toContain('the provider followed it')
    // …and the text is still there to read, which is the whole reason for following it.
    expect(host.textContent).toContain('BROBOT-CANARY')
  })

  it('⚠️ …and an ordinary index shows no such line — it is a disclosure, not decoration', async () => {
    // The paired negative. A row that always said "a link" would say nothing at all.
    // ⚑ **Opened**, because the line it is the negative of is drawn only when the row is.
    const { host } = await learned(remembered)
    const one = await openRow(row(host, 'agent-memory'))

    expect(within(one, 'told-block-link')).toBeNull()
    expect(one.el.textContent).not.toContain('followed it')
  })

  it('⛔ a memory index BroBot could not read is a refused row, never silence (170 §2)', async () => {
    // The other half of H3. `readAgentMemory` collapsed every failure to `null`, so a file the
    // provider had loaded and BroBot could not read looked exactly like a session that has no
    // memory. The panel must show that a source exists and was declined.
    const m = openInfo({
      ...NOTHING,
      refused: [{ path: '/homes/claude/memory/MEMORY.md', reason: 'not-utf8' }],
    })

    // ⚑ **The tab is the thing `agentMemory: []` alone would not have caused**, and it is what the
    // old `session-instructions` assertion was really measuring: that hook is the tab panel now
    // and is drawn on every conversation, so the honest replacement is that a `not read` tab
    // EXISTS here and does not exist for `NOTHING`.
    expect(tabKeys(m.host)).toContain('not-read')
    expect(tabKeys(openInfo(NOTHING).host)).not.toContain('not-read')

    await press(m, 'not-read')
    const one = m.host.querySelector('[data-cy="refused-instruction"]')
    expect(one?.textContent).toContain('/homes/claude/memory/MEMORY.md')
    expect(one?.textContent).toContain('not-utf8')
  })

  it('⚑ comes FIRST, because that is the order the model receives them in (165 §3)', async () => {
    // The provider loads memory inside its own preset; everything BroBot appends lands after that
    // preset. The panel is not free to order these however it likes — it is reporting a sequence.
    //
    // ⚑ **583 · the order is WITHIN a tab, and these two rows share one.** ⛔ `WHOSE_FILE` files
    // both `agent-memory` and `profile-memory` under `learned` — the store the agent wrote and the
    // `CLAUDE.md` one directory over, which the agent also writes — so the sequence is still
    // observable on one surface and the assertion is still a comparison rather than two separate
    // readings. ⚠️ **`data-whose` is asserted first for exactly that reason**: if a later dispatch
    // moved one of them to another owner this would go red rather than quietly measuring the order
    // of a one-row list (`a-comparison-tested-where-both-sides-agree-measures-nothing`).
    const { host } = await learned({
      ...remembered,
      injected: [
        {
          kind: 'profile-memory',
          path: '/homes/claude/CLAUDE.md',
          text: 'I am the developer profile.',
          bytes: 27,
          truncated: false,
        },
      ],
    })

    const order = rows(host)
    expect(order.map((one) => one.whose)).toEqual(['learned', 'learned'])
    expect(order.map((one) => one.kind)).toEqual(['agent-memory', 'profile-memory'])
  })
})

/* ------------------------------------------------------- whose files are these */

/**
 * 172 acceptance 6 · **the drawer of a conversation on a non-default profile.**
 *
 * ⛔ The PM read the `default` profile's drawer while a `developer` session was live and could not
 * tell from the UI which one they were looking at — because the developer session was not in the
 * rail to click. With it back, this is what the drawer has to say: every path on this panel belongs
 * to the profile the conversation is running in, and none of them belongs to `default`.
 *
 * ⚑ Measured on my own instance, through the launcher, on a `devx` profile:
 * `profile: devx — this home, its own CLAUDE.md, and what it remembers across every project`, with
 * the memory index under `provider-homes/default/devx/claude/memory/` and its symlink target named
 * beside it. This is that reading, pinned.
 */
describe('a conversation on a non-default profile shows THAT profile’s files (172)', () => {
  const DEV_HOME = '/homes/default/developer/claude'
  const DEFAULT_HOME = '/homes/default/default/claude'

  const onDeveloper: SessionInstructions = {
    agentMemory: [
      {
        kind: 'agent-memory',
        path: `${DEV_HOME}/memory/MEMORY.md`,
        text: '# What I remember\n\nBROBOT-172-DEVELOPER',
        bytes: 38,
        truncated: false,
        reach: 'prompt',
      },
    ],
    injected: [
      {
        kind: 'profile-memory',
        path: `${DEV_HOME}/CLAUDE.md`,
        text: '# Who I am\n\nBROBOT-172-DEVELOPER-CLAUDE-MD',
        bytes: 41,
        truncated: false,
      },
    ],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  }

  const developerSession = {
    profileId: 'developer',
    providerHome: DEV_HOME,
    config: {
      home: DEV_HOME,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'claude-opus-5',
      authNote: null,
      files: [],
    },
  }

  it('⛔ names the profile, and every path on the panel is in its home', async () => {
    // ⚑ **Both surfaces** — see `bothSurfaces`. The home is the index's and the files are the
    // sheet's since `527`, and this claim ranges over both.
    //
    // ⛔ **And over every TAB since `583`, which is the part that had to change.** A paired
    // negative taken on the tab that happens to be on screen would be blind to a path drawn under
    // any other owner — precisely the leak `167` §0 found — so the sweep opens every row of every
    // tab first, and the positives below read the rows it left open.
    const view = bothSurfaces(onDeveloper, developerSession as Partial<CreatedSession>)
    await nextTick()
    const { host } = view

    // 1 · which agent this conversation belongs to, in words, where 167 put it — ⚑ *agent:* since
    //     `714` (R41), and with no roster handed in the name is the slug.
    expect(host.querySelector('[data-cy="session-profile"]')?.textContent).toContain(
      'agent: developer',
    )
    expect(host.querySelector('[data-cy="session-home"]')?.textContent).toBe(DEV_HOME)

    const sheet = await wholeSheet(view)

    // 2 · the memory it carries between projects, and the CLAUDE.md of the same home — both the
    //     agent's own, so both on one tab.
    await press(view, 'learned')
    expect(row(host, 'agent-memory').el.textContent).toContain(`${DEV_HOME}/memory/MEMORY.md`)
    expect(row(host, 'profile-memory').el.textContent).toContain(`${DEV_HOME}/CLAUDE.md`)
    // 3 · and the text is really this profile's — expanded from the same mount, so the paths above
    //     are not three labels over somebody else's file.
    expect(host.textContent).toContain('BROBOT-172-DEVELOPER')

    // ⛔ **The paired negative, and the one the PM could not make by eye:** nothing on this panel
    // comes from the default profile's home. `167` §0 found one place that coalesced a null profile
    // to `default`; this is the reading that would show it.
    expect(sheet.text).not.toContain(DEFAULT_HOME)
    expect(host.textContent).not.toContain(DEFAULT_HOME)
    expect(host.querySelector('[data-cy="session-profile"]')?.textContent).not.toContain('BroBot')
  })

  it('⚠️ …and the default profile’s own drawer still reads as BroBot’s (167 §2)', () => {
    // The other direction, so the assertion above is about the profile rather than about the label
    // being absent everywhere. `default` is LABELLED, not shown bare: it is the product's own agent.
    const { host } = bothSurfaces(onDeveloper)

    expect(host.querySelector('[data-cy="session-profile"]')?.textContent).toContain('BroBot')
    expect(host.querySelector('[data-cy="session-profile"]')?.textContent).not.toContain(
      'agent: developer',
    )
  })
})
