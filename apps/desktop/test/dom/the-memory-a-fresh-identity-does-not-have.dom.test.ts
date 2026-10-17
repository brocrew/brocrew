import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import SessionInfo from '../../src/renderer/src/components/SessionInfo.vue'
import type { InjectedInstruction, SessionInstructions } from '../../src/shared/runtime-ipc'
import { TOLD_IS_THE_LAST_LAUNCH, TOLD_REMEMBERS_NOTHING } from '../../src/shared/told'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, toldProps, unmountAll, visible, type Mounted } from './harness'

/**
 * 🔴 **536 · the memories that are not on the tab any more.**
 *
 * A fresh identity still has a visible memory section, even when it remembers nothing.
 *
 * ## ⛔ §0's answer, and it is the third outcome rather than the first
 *
 * ⚑ **Nothing took it.** `671484ab` (`165`) drew the agent's own store the day the field existed,
 * `a3dc55c6` (`317`) turned it into the whole store with a reach word per file, and every line of
 * that is still drawn at `fca3f3c9`. ⚠️ **What moved is the BLOCK**: `14d0c62f` (`527`) took
 * `SessionInstructions` off the Info tab and put it on a sheet one press behind *What this agent
 * was told* — so the rows are a press further away than they were, and the index entry names them.
 *
 * ⛔ **And what has never existed is a word for the state a fresh identity is in.** Every version
 * of this panel since `165` draws memory with a `v-for` over `agentMemory` and a `v-if` on its
 * length; `442` added the layer row with the same guard. ⚑ **A store with no files therefore
 * produced no row, no layer and no sentence** — the surface named four layers of the prompt and
 * was silent about the fifth, which is the account reading as complete when it is not.
 *
 * ## ⚠️ Why that is the defect and not the press
 *
 * 🔴 **He is on a clean base.** A fresh identity has written nothing, which is the state most
 * identities are in most of the time and the first state he will see — so the surface he opened
 * could not have told him where memory had gone even if he had pressed through to it.
 *
 * ## ⛔ In the dom project, and every negative below is paired
 *
 * ⚑ **`visible()` and the sensor need layout**, and an SSR assertion that a string is absent
 * passes over a component that never mounted (`brobot2-ssr-tests-pass-vacuously`). ⚠️ The sheet's
 * width is `min(780px, 100% - 2 × --lane-clear)` — derived from the WINDOW — so §1 resizes the
 * viewport and restores it: `dom-project-viewport-is-shared`.
 *
 * ---
 *
 * ## 🔴 583 · what moved under this file, and why every claim below is the same claim
 *
 * Exactly one prompt-owner tab’s contents is in the DOM. Press the relevant tab before
 * assertions; the two census tests walk the strip instead of querying the host only once.
 *
 * ⚠️ **`TOLD_REMEMBERS_NOTHING` did not move house; it moved tab.** It is drawn under
 * `whose === 'learned'` — *the agent's own* — and `WhoseGroup.drawn` hard-codes that group as
 * drawn even when it is empty, for `536`'s own argument quoted back at it in `whose-groups.ts`:
 * *"an identity that has been told nothing at all is exactly the identity whose reader has no
 * other way to learn that memory belongs here… Found by photographing a fresh identity: gated on
 * its rows alone, this group vanished and took that sentence with it."*
 *
 * 🔴 **So the load-bearing thing this file now pins is that exception.** Every section below
 * reaches the sentence through `told-tab-learned`, and {@link seesTheEmptyGroupDisappear} says in
 * one place what happens the day somebody deletes the `whose === 'learned'` arm: the tab is not
 * in the strip, `m.q` throws, and nine tests go red rather than one.
 *
 * ⛔ **The one thing 583 genuinely took away is the ZERO-press reading**, and §1.2 says so in
 * words rather than quietly lowering the bar — see its own note.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/**
 * ⛔ **The state a clean base is in: nothing injected, nothing remembered, nothing composed.**
 *
 * ⚠️ **Not a convenience fixture.** `instructions.test.ts` asserts this exact shape off a real
 * profile directory three times over — *"renders nothing before the agent has written anything"*,
 * *"a home with no memory at all is still SILENT"*, and *"a memory DIRECTORY with no index yet is
 * silent too"* — so this is the reader's own output for a profile nobody has used yet.
 */
const FRESH: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: false,
  composed: null,
}

/** One file in the store — the control state, where the layer exists and the sentence must not. */
const INDEX: InjectedInstruction = {
  kind: 'agent-memory',
  path: '/homes/default/memory/MEMORY.md',
  text: '- [Reviewer handle](user_reviewer_handle.md) — who reviews this work',
  bytes: 205,
  truncated: false,
  reach: 'prompt',
}

/**
 * 🔴 **The tab the agent's own store lives behind since `583`** — `WHOSE_TEXT`'s `learned`, whose
 * heading a person reads as *the agent's own*.
 *
 * ⛔ **Named once**, so the day the key is renamed this file fails to compile against the strip
 * rather than going quietly green on a tab that is not there.
 */
const LEARNED = 'learned'

/**
 * ⚑ **The tab `442`'s account went to** — the composed prompt, whole, and the two sentences that
 * belong to the composition rather than to an owner (`told-sentence`, `told-appended-nothing`).
 */
const AS_SENT = 'as-sent'

/**
 * 🔴 **Press one tab and let the panel re-render.**
 *
 * ⛔ **`m.q` rather than `querySelector`**, so a tab that is not in the strip throws HERE, naming
 * the hook, instead of turning into a null press and an assertion that reads *the sentence is
 * missing* when what is really missing is the route to it.
 *
 * ⚑ **This is {@link seesTheEmptyGroupDisappear} in mechanical form**: every reach for
 * `TOLD_REMEMBERS_NOTHING` below goes through this function, so removing the *drawn when empty*
 * exception for `learned` takes the whole file red.
 */
async function press(m: Mounted, key: string): Promise<void> {
  m.q(`told-tab-${key}`).click()
  await nextTick()
}

/**
 * ⛔ **Which tabs the strip really has, in the order it draws them** — read off the surface, never
 * typed, because `tabs` in the component is derived from `WhoseGroup.drawn` and the whole point of
 * the two census tests is that a tab appearing has to be decided rather than absorbed.
 */
function tabKeys(m: Mounted): string[] {
  return [...m.q('told-tabs').querySelectorAll('[data-cy^="told-tab-"]')].map((el) =>
    (el.getAttribute('data-cy') ?? '').replace('told-tab-', ''),
  )
}

/**
 * 🔴 **The whole sheet, one tab at a time** — what a single `host.querySelectorAll` used to be
 * before `583` put one owner's page in the DOM at a time.
 *
 * ⚠️ **It presses EVERY tab the strip offers**, so a sentence or a layer that moved to a tab
 * nobody thought to look at is still counted; the expected lists below are therefore as total as
 * the one-mount queries they replace, and a fourth sentence anywhere on the sheet still has to be
 * decided rather than absorbed.
 */
async function acrossEveryTab(m: Mounted, read: (key: string) => string[]): Promise<string[]> {
  const found: string[] = []
  for (const key of tabKeys(m)) {
    await press(m, key)
    found.push(...read(key))
  }
  return found
}

/**
 * 🔴 **The sentence this whole file exists for cannot be reached without its group being drawn.**
 *
 * ⛔ **`536`'s rule, restated as the thing 583 could have broken and did not.** `learned` carries
 * no layer and no row on a fresh identity, so under the ordinary rule of this panel — *nothing
 * where nothing was injected* — its group would not be drawn, its tab would not be in the strip,
 * and `TOLD_REMEMBERS_NOTHING` would have nowhere to be. ⚑ `whose-groups.ts` hard-codes the
 * exception and cites `536` for it; this is the assertion that holds it there.
 */
function seesTheEmptyGroupDisappear(m: Mounted): void {
  const tab = m.q(`told-tab-${LEARNED}`)
  expect(visible(tab), 'the agent’s own tab is not on the strip').toBe(true)
  // ⛔ **`0`, and that is the whole assertion.** The count is `layers.length + blocks.length`, so
  // a tab reading `0` is a group with NOTHING in it that is drawn anyway — which is precisely the
  // exception, and it cannot be satisfied by a phantom row propping the group up.
  expect(
    tab.querySelector('.tab-count')?.textContent?.trim(),
    'the agent’s own tab is only drawn because something is in it',
  ).toBe('0')
}

/**
 * ⚑ **The widths the sheet really has**, read from `tokens.css` rather than typed — the app's own
 * window floor and the mock's 1200 px target, which is what `what-an-agent-was-told.dom.test.ts`
 * derives for the same surface.
 */
function hostWidths(): number[] {
  const floor = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--app-min-w').trim(),
    10,
  )
  expect(floor, '--app-min-w is gone from tokens.css').toBeGreaterThan(0)
  return [1200, floor]
}

function openSheet(instructions: SessionInstructions, width = 1200): Mounted {
  return mount(AgentInstructionsSheet as never, toldProps(instructions), { width, height: 900 })
}

/* ------------------------------------------------------------------ §1 */

describe('§1 · a fresh identity is TOLD that its memory is empty, not left to guess', () => {
  it('🔴 the sentence is on the sheet, and it is the constant rather than copy typed here', async () => {
    const m = openSheet(FRESH)
    // ⛔ **583: the sheet is a tab strip and the store's tab is `learned`.** The reach is a press
    // longer; the claim is unchanged, and `seesTheEmptyGroupDisappear` is what makes the press
    // reachable at all on an identity with nothing in that group.
    seesTheEmptyGroupDisappear(m)
    await press(m, LEARNED)

    const said = m.q('told-remembers-nothing')
    expect(visible(said)).toBe(true)
    // ⛔ **By its constant** (standing rule 5). A test that re-types the copy asserts that somebody
    // typed the same words twice, and goes green the day one of the two is edited.
    expect((said.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(TOLD_REMEMBERS_NOTHING)
  })

  it('⛔ …and the word a person would go looking for is ONE press away, on a tab nothing can empty', async () => {
    const m = openSheet(FRESH)

    // 🔴 **583 moved this claim and the move is stated rather than absorbed.** ⛔ Until `583` the
    // sentence was on screen with NO press at all, and this test said so. The sheet is a tab strip
    // now: one owner's page is in the DOM at a time, so the zero-press reading is gone and the
    // honest replacement is *one press, on a tab that is always there*. ⚠️ **Both halves are
    // asserted** — that the landing page really does not carry it, so the press below is a
    // measured fact and not an assumption, and that the route is drawn before anything is pressed.
    expect(
      m.host.querySelector('[data-cy="told-remembers-nothing"]'),
      'the landing tab carries it after all — 583’s cost is smaller than this test claims',
    ).toBeNull()
    expect(m.q(`told-tab-${LEARNED}`).getAttribute('aria-selected')).toBe('false')
    seesTheEmptyGroupDisappear(m)

    await press(m, LEARNED)

    // The memory-absence sentence must be visible without opening a collapsed layer
    // explanation. A labeled, visible tab is different: pressing it is the strip’s normal
    // navigation gesture.
    expect(m.host.textContent ?? '').toContain('memory')
    // ⛔ **And nothing on this tab opened itself.** `told-order` was the fold this line watched
    // before `583`; it is on `as sent` now, and the fold that sits over THIS sentence is the
    // group's own membership paragraph. Same claim, on the disclosure that is actually here.
    expect(
      m.host.querySelector(`[data-cy="told-group-more-${LEARNED}"]`),
      'a fold opened itself',
    ).toBeNull()
    // ⛔ **And it is a SIBLING of the layer list, not a body inside one.** `.layer-body` is what a
    // layer's own disclosure opens, and it really exists on this surface — the control for that is
    // the query below, which finds the folds this sheet does have.
    const said = m.q('told-remembers-nothing')
    expect(said.closest('.layer-body'), 'the sentence was moved inside a fold').toBeNull()
    expect(said.closest('.note'), 'the sentence was moved inside the group’s own fold').toBeNull()
    expect(
      m.host.querySelectorAll('.why').length,
      'this sheet has no folds at all',
    ).toBeGreaterThan(0)
    // ⚑ **…and the fold it is NOT inside is a fold that really opens**, so the two negatives above
    // are absences rather than a query for a class this tab never renders.
    m.q(`told-group-why-${LEARNED}`).click()
    await nextTick()
    expect(visible(m.q(`told-group-more-${LEARNED}`))).toBe(true)
  })

  it('🔴 …and it is DRAWN in full at both widths the sheet really has', async () => {
    for (const width of hostWidths()) {
      await page.viewport(width, 900)
      const m = openSheet(FRESH, width)
      seesTheEmptyGroupDisappear(m)
      await press(m, LEARNED)
      await drawnReady()
      // ⛔ **The ink, not the box.** This block wraps rather than clipping, so a box assertion
      // would pass over a sentence whose last line sat below the sheet's own overflow — which is
      // the class `531` built this sensor for.
      assertDrawn(m.q('told-remembers-nothing'), `the memory sentence at ${String(width)}px`)
      m.unmount()
    }
  })

  it('⚠️ …and a host that predates the field gets it too — the key is MISSING, not empty', async () => {
    // ⛔ **The shape a stored session or an older host really has**, which no typed fixture can
    // express — `instructions.dom.test.ts` builds the same one for the same reason. ⚠️ An
    // un-normalised read would make an absent field mean *nothing to say* rather than
    // *nothing read*, and this sentence exists for the second.
    const older = { ...FRESH } as Record<string, unknown>
    delete older['agentMemory']
    const m = openSheet(older as unknown as SessionInstructions)
    // ⚑ **583: `whoseGroups` normalises the same field a second time** (`Array.isArray`, for
    // `agentMemory`'s own reason) — so a missing key has to survive the GROUPING as well as the
    // account, and the tab being here is half of what this test now measures.
    seesTheEmptyGroupDisappear(m)
    await press(m, LEARNED)

    expect((m.q('told-remembers-nothing').textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      TOLD_REMEMBERS_NOTHING,
    )
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · it states an absence and never invents the layer it denies', () => {
  it('⛔ rule 2 is untouched — no layer row, no file row, and no store sentence', async () => {
    const m = openSheet(FRESH)

    // 🔴 **583 · rule 2 is PER GROUP now, and this is where that is pinned.** ⛔ The `anything`
    // computed is gone: one boolean used to gate one `instructions` section over four empty lists,
    // and `data-cy="session-instructions"` — which this test asserted was absent — now names the
    // tab panel, which is always drawn. ⚑ **The rule did not go with it.** `WhoseGroup.drawn` is
    // the same rule one level down, so *nothing where nothing was injected* is now measured as
    // *an owner with nothing in it has no tab*: `factory`, `this conversation's`, `the folder's`
    // and `not read` are all absent here, and a regression that drew an empty heading brings one
    // of them back.
    expect(tabKeys(m)).toEqual(['configured', LEARNED, 'not-held', AS_SENT])

    await press(m, LEARNED)

    // ⚑ **The rows stay exactly as empty as `086` requires**, which is the ruling `536` had to
    // establish it was not reversing: a row is a FILE and this is a claim about the prompt.
    expect(m.host.querySelector('[data-cy="told-layer-agent-store"]')).toBeNull()
    // ⛔ **583 renamed the row hook and this is the same query.** `injected-<kind>` is gone — the
    // compiled bundle is several rows per file now — and every row is `told-block` carrying its
    // `data-kind`. ⚠️ The prefix match is deliberate: `agent-memory`, `agent-memory-note` and
    // `agent-memory-topic` are the three kinds the store can produce, which is exactly the set
    // `[data-cy^="injected-agent-memory"]` used to cover.
    expect(m.host.querySelector('[data-cy="told-block"][data-kind^="agent-memory"]')).toBeNull()
    expect(m.host.querySelector('[data-cy="memory-store-not-a-reading"]')).toBeNull()
    // …and the surface really mounted, so every negative above is an absence rather than a miss.
    // ⛔ **556: *really mounted* is a mount, and a mount is not a reading.** `visible()` is true of
    // a block with padding and no words in it, which is the state four absences above would then
    // be measuring. ⚑ The sentence the block draws unconditionally is the pair — the same repair
    // `the-half-nobody-lists.dom.test.ts` took, on the file `536` F5 pointed at from there.
    // ⚠️ **583: paired on the TAB the negatives were taken on**, because that is the page they are
    // negatives about — the group's own one-line answer, which every drawn group carries.
    const short = m.q(`told-group-says-${LEARNED}`)
    expect(visible(short)).toBe(true)
    expect((short.textContent ?? '').trim().length).toBeGreaterThan(20)

    // ⚑ **…and the account's own unconditional sentence, which went to `as sent` with it.**
    await press(m, AS_SENT)
    expect(visible(m.q('told-composition'))).toBe(true)
    expect(m.q('told-sentence').textContent?.trim()).toBe(TOLD_IS_THE_LAST_LAUNCH)
  })

  it('🔴 the control: one file in the store and the layer is back, with no sentence', async () => {
    const m = openSheet({ ...FRESH, agentMemory: [INDEX] })
    await press(m, LEARNED)

    expect(visible(m.q('told-layer-agent-store'))).toBe(true)
    expect(m.q('told-count-agent-store').textContent?.trim()).toBe('1')
    // ⚑ **583: and the FILE is a row on the same tab**, which is the other half of *the layer is
    // back* — the row hook the `injected-agent-memory` query above was watching, present here on
    // the state where it belongs.
    expect(
      m.host.querySelector('[data-cy="told-block"][data-kind="agent-memory"]'),
      'the store has a file and no row was drawn for it',
    ).not.toBeNull()
    expect(m.host.querySelector('[data-cy="told-remembers-nothing"]')).toBeNull()
    // ⚑ **Both directions in one mount** — a sentence that never disappeared would pass §1 and
    // would be telling a reader with a memory store that they have none.
    expect(m.host.textContent ?? '').not.toContain('BroCrew read none from its store')
  })

  it('⚠️ …and the other absence sentence is still its own, in the same register', async () => {
    const m = openSheet(FRESH)

    // ⛔ **Two absences, two sentences, one class.** `appendedNothing` is `442`'s and it was the
    // precedent for this one; a repair that folded them would make one sentence answer two
    // questions, and a reader could not tell which layer was missing.
    //
    // 🔴 **583 put them on two tabs, so they can no longer be read off one mount** — and that is
    // a STRONGER form of the same claim, not a weaker one: each is asserted present on its own
    // tab and absent on the other's, which is *one sentence does not answer two questions* said
    // with the tab as well as the hook. ⚑ The register check survives unchanged: both are
    // `.muted.absent`, and a repair that promoted one of them would still go red here.
    await press(m, LEARNED)
    const remembers = m.q('told-remembers-nothing')
    const rememberedClass = remembers.className
    const rememberedText = (remembers.textContent ?? '').replace(/\s+/g, ' ').trim()
    expect(
      m.host.querySelector('[data-cy="told-appended-nothing"]'),
      'the composition’s absence was folded onto the store’s tab',
    ).toBeNull()

    await press(m, AS_SENT)
    const appended = m.q('told-appended-nothing')
    expect(
      m.host.querySelector('[data-cy="told-remembers-nothing"]'),
      'the store’s absence was folded onto the composition’s tab',
    ).toBeNull()

    expect(remembers).not.toBe(appended)
    expect(rememberedClass).toBe(appended.className)
    expect(rememberedText).not.toBe((appended.textContent ?? '').replace(/\s+/g, ' ').trim())
    expect(appended.textContent ?? '').toContain('BroCrew appended nothing')
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · what it looks like when there is nothing', () => {
  it('🔴 the whole reading is its sentences, and each one is a different absence', async () => {
    const m = openSheet(FRESH)

    // ⚑ **Derived from the surface, not typed as a count** — the hooks are read off the sheet and
    // named, so a fourth sentence appearing here has to be decided rather than absorbed.
    //
    // 🔴 **583 · the same census, taken across the strip.** ⛔ One tab is in the DOM at a time, so
    // a single `host.querySelectorAll` would now report one page and call it *the whole reading* —
    // which is the census going blind, not the sheet getting shorter. ⚠️ `.lead-short` joins the
    // filter because that is the class `told-sentence` wears now and the class every group's
    // one-line answer wears; without it the standing sentence would drop out of the list and the
    // test would go green over its removal.
    //
    // `told-group-says-*` supplies `WhoseWords.short` for each drawn tab;
    // `told-nothing-of-yours` explains the empty personal layer. Keep the three separate
    // absences for a fresh identity: nothing of yours, nothing remembered, and nothing
    // appended.
    //
    // ⛔ **`told-sentence` is FIRST and belongs to no tab.** 583's self-review found it on the
    // `as sent` tab, where a person reaches it with a press — and `442` §2.2's own rule beside
    // that sentence is that *a scope a reader has to open is a scope most readers never see*. ⚑ A
    // tab is a press, so it moved above the strip, which is why the walk meets it once, before
    // any tab's own sentences, instead of on the last one.
    const said = await acrossEveryTab(m, () =>
      [...m.host.querySelectorAll('[data-cy^="told-"]')]
        .filter((el) => el.matches('.lead, .lead-short, .absent'))
        .map((el) => el.getAttribute('data-cy') ?? ''),
    )
    expect(said).toEqual([
      'told-group-says-configured',
      'told-nothing-of-yours',
      `told-group-says-${LEARNED}`,
      'told-remembers-nothing',
      'told-group-says-not-held',
      'told-appended-nothing',
    ])
    // ⛔ **And the standing sentence is on EVERY tab, because it is above them** — asserted
    // separately so its position is a claim rather than a place in a list.
    const standing = await acrossEveryTab(m, (key) =>
      [...m.host.querySelectorAll('[data-cy="told-sentence"]')].map(() => key),
    )
    expect(standing, 'the scope of everything below it is behind a press').toEqual(tabKeys(m))
    // ⛔ **…and which of them are ABSENCES, by the register they are drawn in rather than by
    // their names.** `.absent` is the italic this surface uses for *there is nothing here*, and
    // §2.3 pins that two of the three share it exactly; taking the subset off the class is what
    // keeps this line from being a re-spelling of the list above.
    const absences = await acrossEveryTab(m, () =>
      [...m.host.querySelectorAll('[data-cy^="told-"].absent')].map(
        (el) => el.getAttribute('data-cy') ?? '',
      ),
    )
    expect(absences).toEqual([
      'told-nothing-of-yours',
      'told-remembers-nothing',
      'told-appended-nothing',
    ])
    // ⛔ …and every one of them has words in it, at a size a person reads.
    for (const cy of said) {
      await press(m, tabOf(cy))
      const el = m.q(cy)
      expect((el.textContent ?? '').trim().length, `${cy} is empty`).toBeGreaterThan(20)
      expect(Number.parseFloat(getComputedStyle(el).fontSize)).toBeGreaterThanOrEqual(9)
    }
  })

  it('⛔ …and the layer list a fresh identity gets is the two nobody can empty', async () => {
    const m = openSheet(FRESH)

    // ⚠️ **The provider's base and the verbs are drawn on every conversation** (`442` §2.1), so
    // the account is never a blank — which is exactly why the two that CAN be empty owe a
    // sentence each.
    //
    // ⚑ **583 filed both of them under `not shown`** — `WHOSE_LAYER` maps `provider-base` and
    // `published-tools` to `not-held`, the group whose one property is *this app holds none of
    // these bytes*. ⛔ **Walked across every tab rather than queried once**, so a layer that
    // slipped onto another owner's page is counted here and breaks this list — which is the
    // claim the single query used to make when the whole sheet was one mount.
    expect(
      await acrossEveryTab(m, () =>
        [...m.host.querySelectorAll('[data-cy^="told-layer-"]')].map((el) =>
          (el.getAttribute('data-cy') ?? '').replace('told-layer-', ''),
        ),
      ),
    ).toEqual(['provider-base', 'published-tools'])
  })
})

/**
 * ⚑ **Which tab one of §3's sentences is read on** — the inverse of the census above, so the
 * per-sentence checks can press back to the page that sentence lives on.
 *
 * ⛔ **Derived from the hook**, because every one of them is either a group's own line (the key is
 * in the name) or one of the two the account keeps.
 */
function tabOf(cy: string): string {
  const group = /^told-group-says-(.+)$/.exec(cy)
  if (group) return group[1]!
  if (cy === 'told-nothing-of-yours') return 'configured'
  if (cy === 'told-remembers-nothing') return LEARNED
  return AS_SENT
}

/* ------------------------------------------------------------------ §4 */

describe('§4 · and the index says where it went — §0’s other half, pinned', () => {
  const openIndex = (width: number): Mounted =>
    mount(
      SessionInfo as never,
      { session: META, sessionRef: null, ended: false },
      { width, height: 900 },
    )

  /** The drawer's floor and ceiling, read from `tokens.css` (W4.183: fluid between the two). */
  function drawerWidths(): number[] {
    const style = getComputedStyle(document.documentElement)
    return ['--drawer-w-min', '--drawer-w-max'].map((name) => {
      const px = Number.parseInt(style.getPropertyValue(name).trim(), 10)
      expect(px, `${name} is gone from tokens.css`).toBeGreaterThan(0)
      return px
    })
  }

  it('🔴 the entry that opens the sheet NAMES memory, and draws it whole at both drawer widths', async () => {
    // ⛔ **The one place the word survives `527`'s move.** A person who cannot see it on the index
    // has no reason to press, and `526` measured what this drawer does to prose it is not
    // watching. ⚠️ This passed before `536` and is pinned here so it cannot stop being true
    // quietly — the rows behind it are one press away and nothing else on the tab says so.
    //
    // 🔴 **583 made this the LAST place the word is free.** The sheet's landing tab does not carry
    // it any more (§1.2), so this entry is now the whole of what tells a person memory is in
    // there before they start pressing tabs.
    for (const width of drawerWidths()) {
      await page.viewport(Math.max(width + 200, 1200), 900)
      const m = openIndex(width)
      await drawnReady()
      const says = m.q('told-index-says')
      expect((says.textContent ?? '').replace(/\s+/g, ' ').trim()).toContain('its own memory')
      assertDrawn(says, `the index entry’s sentence at ${String(width)}px`)
      m.unmount()
    }
  })
})
