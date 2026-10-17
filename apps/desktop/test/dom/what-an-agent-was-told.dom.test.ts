import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import type { SessionInstructions } from '../../src/shared/runtime-ipc'
import { TOLD_HAS_AN_EARLIER_LIFE, type ToldLayerKind } from '../../src/shared/told'
import { WHOSE_LAYER } from '../../src/shared/whose-text'
import { mount, toldProps, unmountAll, visible, type Mounted } from './harness'

/**
 * 🔴 **What an agent was told, in the column it actually lives in** (442, HO-024 §4 criterion 24).
 *
 * ⛔ **Painted, because every claim here is a layout claim.** A register chip a person cannot read
 * is a layer with no register whatever the projection says, and an SSR render one directory up
 * cannot see a box (`brobot2-ssr-tests-pass-vacuously`).
 *
 * ⚑ **At the SURFACE's real widths, and they are read from the tokens rather than typed** — this
 * block lives in a column, not in the whole window, so a bare 1200 would be the lucky layout
 * `421` §5.1 paid for measuring.
 *
 * ## 🔴 527 · re-aimed, because the column MOVED — the fact changed, not its spelling
 *
 * ⛔ **This file measured a 320–380 px drawer column and that column is no longer where the block
 * lives.** `HO-050` §1.1 split the Info tab into an index and a wide sheet, and the composition —
 * the 253-character launch scope, the layer list, four `DocumentBody` mounts — is the sheet's.
 * ⚠️ **Deleting the widths to make it pass would have been the worst repair available**: it would
 * have gone green over a world that had moved (standing rule 26).
 *
 * ⚑ **What it pins NOW is the same claim about the surface the block really has**:
 * `AgentInstructionsSheet` is `min(780px, 100% - 2 × --lane-clear)`, so its width is what the
 * window leaves after the gutter `OverlayHost` reserves for the emergency stop — and the block
 * still has to stay inside it and still has to wrap. ⛔ The widths below are the app's own floor
 * and the mock's 1200 px target, read from `tokens.css` rather than typed, so a sheet that stopped
 * deriving its width would move this test with it.
 *
 * ## 🔴 583 · re-aimed again, because the sheet became a TAB STRIP — every claim survives
 *
 * The six prompt owners are labeled tabs, with exactly one tab’s content in the DOM at a
 * time.
 *
 * ⚠️ **So a mount no longer shows everything this file used to read in one pass**, and the repair
 * is a PRESS, never a shorter assertion. Every test below reaches its subject through
 * {@link show}, which presses the tab the subject moved to and checks the strip took the press —
 * a query that silently found nothing on the landing tab is the vacuous green this dispatch is
 * most exposed to (`grep-is-blind-to-one-test-file`'s cousin: a hook that exists on another tab).
 *
 * ⚑ **Where the four layers of this fixture went, and it is DERIVED here rather than typed** —
 * `WHOSE_LAYER` is the shared table the component filters on, so a layer moved to another owner
 * moves this file in the same edit rather than leaving it asserting yesterday's tab:
 *
 * | layer | tab | behind a press? |
 * |---|---|---|
 * | `provider-base` | `not-held` | yes — `told-why-provider-base`, unchanged |
 * | `published-tools` | `not-held` | yes — `told-why-published-tools`, unchanged |
 * | `agent-store` | `learned` | yes |
 * | `app-composed` | `as-sent` | ⛔ **no** — the tab IS the press (see the composed test) |
 */

/**
 * ⛔ **The viewport is shared across this directory**, so it is captured before the first resize
 * and restored after every test. ⚑ **It has to be resized at all since `527`**: the surface this
 * block lives on is a sheet on the overlay layer, whose width is what the WINDOW leaves after the
 * stop's gutter — a claim that cannot be made inside a mounted box narrower than the app's own
 * floor (`the-dom-runner-draws-overlay-scrollbars` is the neighbouring lesson: the runner's own
 * geometry is not the product's).
 */
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/**
 * ⚠️ Derived from `tokens.css`, so a window floor that moves moves this test with it.
 *
 * ⛔ **The app's own minimum first**, because that is the narrowest the sheet can ever be in this
 * product (`--app-min-w`; a narrower window scrolls the app rather than shrinking it — `525` Q4).
 * ⚑ The second is the 1200 px target the mock was drawn and measured at.
 */
function hostWidths(): number[] {
  const style = getComputedStyle(document.documentElement)
  const floor = Number.parseInt(style.getPropertyValue('--app-min-w').trim(), 10)
  expect(floor, '--app-min-w is gone from tokens.css').toBeGreaterThan(0)
  return [1200, floor]
}

/**
 * 🔴 **Press one tab, and prove the strip took the press** (583).
 *
 * ⛔ **The assertion on `aria-selected` is not decoration.** Only one tab's panel is in the DOM,
 * so every query below this call is conditional on the press having landed; a `click()` on a
 * button that had stopped being a tab would leave the next `querySelector` returning `null` and
 * the failure would read as *the hook is gone* rather than *the strip is broken*. ⚑ And
 * `aria-selected` is the attribute `578`'s rule puts on a control that decides what is being
 * read, so asserting it is asserting the thing a screen reader is told.
 */
async function show(m: Mounted, key: string): Promise<void> {
  const tab = m.q(`told-tab-${key}`)
  tab.click()
  await nextTick()
  expect(tab.getAttribute('aria-selected'), `the ${key} tab did not take the press`).toBe('true')
}

const COMPOSED =
  'You are Lena (writer), an agent in BroBot, the app you run inside. Below are your instructions, ' +
  "your workspace notes and this conversation's details. Follow them; they take precedence over earlier general guidance." +
  '\n\nContents of /Users/somebody/provider-homes/default/default/claude/CLAUDE.md ' +
  "(this profile's private instructions for all projects):\n\nBROBOT-CANARY-ONE\n\n" +
  'Contents of /Users/somebody/work/repo/CLAUDE.md (project instructions, checked into the ' +
  'codebase):\n\nBROBOT-CANARY-TWO\n'

const TOLD: SessionInstructions = {
  injected: [
    {
      kind: 'profile-memory',
      path: '/Users/somebody/provider-homes/default/default/claude/CLAUDE.md',
      text: 'BROBOT-CANARY-ONE',
      bytes: 17,
      truncated: false,
    },
    {
      kind: 'project-memory',
      path: '/Users/somebody/work/repo/CLAUDE.md',
      text: 'BROBOT-CANARY-TWO',
      bytes: 17,
      truncated: false,
    },
  ],
  agentMemory: [
    {
      kind: 'agent-memory',
      path: '/Users/somebody/provider-homes/default/default/claude/memory/MEMORY.md',
      text: 'what the agent keeps',
      bytes: 20,
      truncated: false,
      reach: 'prompt',
    },
  ],
  provider: [],
  refused: [],
  note: 'The walk stopped at the home boundary.',
  recallsReported: false,
  writesReported: true,
  composed: COMPOSED,
}

/**
 * ⚑ **Which tab a layer is drawn on, from the table the COMPONENT filters on** (583).
 *
 * ⛔ **Never a literal per layer.** `WHOSE_LAYER` maps a layer to its owner or to `null`, and
 * `null` is *belongs to no owner* — which the sheet draws on the `as sent` tab, the one tab that
 * is not a group. ⚠️ A layer given an owner tomorrow moves here and in the component together;
 * a typed table would have gone quietly stale (`a-number-can-survive-the-death-of-its-derivation`).
 */
const AS_SENT = 'as-sent'
function tabOf(kind: ToldLayerKind): string {
  return WHOSE_LAYER[kind] ?? AS_SENT
}

/**
 * 🔴 **What each layer's register chip must say — and the ONE layer that no longer has one.**
 *
 * ⛔ **`app-composed`'s chip is GONE from the surface at 583**, and it is recorded here as `null`
 * rather than dropped from the expectation: the `as sent` tab draws that layer as its sentence,
 * its `DocumentBody` and its byte count, with no `told-register` anywhere in the row. ⚠️ **The
 * claim `observed` made in one word is asserted against what replaced it** — the text itself,
 * on screen, with the bytes beside it — and the loss of the word is reported to 583 rather than
 * papered over (standing rule: name what replaced a subject, never delete the assertion).
 */
/**
 * ⛔ **How this file asks *is there a document on this row*** — `DocumentBody`'s own hook, plus
 * the two spellings this test used before.
 *
 * ⚠️ **The old selector could not have found one.** It asked for `.markdown, .document-body,
 * pre`: the component renders `doc-paper` › `doc-content` › `md-doc`, `pre` only in the Raw
 * view, and `<style scoped>` means a class from another component matches nothing here anyway
 * (`a-scoped-class-matches-nothing-in-another-component`). ⛔ **So the opaque layer's *and never
 * a body* was passing on a query that matches no body anywhere** — it is a superset now, and the
 * composed layer above is the positive control that proves it fires.
 */
const BODY = '[data-cy="document-body"], .markdown, .document-body, pre'

const REGISTER_OF: Readonly<Record<string, string | null>> = {
  'provider-base': 'unknown',
  'agent-store': 'claimed',
  'app-composed': null,
  'published-tools': 'unknown',
}

function openInfo(
  instructions: SessionInstructions,
  width: number,
  over: Record<string, unknown> = {},
): Mounted {
  return mount(AgentInstructionsSheet as never, toldProps(instructions, over), {
    width,
    height: 900,
  })
}

describe('the composition fits the column it lives in', () => {
  it('🔴 at both real sheet widths the block stays inside it and nothing scrolls sideways', async () => {
    for (const width of hostWidths()) {
      await page.viewport(width, 900)
      const m = openInfo(TOLD, width)
      // ⚑ **583 · the composition is the LAST tab now**, so reaching it is part of the layout
      // claim rather than a detour: `told-composition` is drawn only on `as sent`, and that tab
      // is also the widest thing on this sheet — it carries the whole composed prompt on paper.
      await show(m, AS_SENT)
      const block = m.q('told-composition')
      expect(visible(block), `invisible at ${String(width)}px`).toBe(true)

      const around = block.parentElement!
      const box = block.getBoundingClientRect()
      const bounds = around.getBoundingClientRect()
      // ⚠️ **A pixel of slack for sub-pixel rounding, and no more.** This is the claim that the
      // block is bounded by the sheet's own body rather than by the window behind it.
      expect(box.right, `overflows right at ${String(width)}px`).toBeLessThanOrEqual(
        bounds.right + 1,
      )
      expect(box.left, `overflows left at ${String(width)}px`).toBeGreaterThanOrEqual(
        bounds.left - 1,
      )
      // ⛔ **The long sentences WRAP.** A block that let one layer's sentence set its width would
      // push the sheet sideways past the gutter the emergency stop sits in.
      expect(block.scrollWidth, `wider than itself at ${String(width)}px`).toBeLessThanOrEqual(
        block.clientWidth + 1,
      )
      // ⛔ **And the STRIP wraps too** (583). It is a row of `white-space: nowrap` controls and
      // it is new, so it is the one element on this sheet that can put the column into a
      // sideways scroll at the app's own floor — the failure `421` §5.1 paid to measure, arriving
      // through a control instead of through a sentence.
      const strip = m.q('told-tabs')
      expect(strip.scrollWidth, `the tabs overflow at ${String(width)}px`).toBeLessThanOrEqual(
        strip.clientWidth + 1,
      )
      expect(document.body.scrollWidth).toBeLessThanOrEqual(window.innerWidth + 1)
      // ⛔ **Unmounted inside the loop**, or the previous width's box is still in `document.body`
      // and the page-scroll assertion above is about a host the narrower pass never built.
      m.unmount()
    }
  })

  it('🔴 every layer carries a register chip that is on screen and has words in it', async () => {
    const [wide] = hostWidths()
    const m = openInfo(TOLD, wide!)
    // ⚠️ **Four, derived from the fixture rather than from a number in a title**: the opaque base,
    // the agent's store, what BroBot appended, and the verbs. No provider-reported files here, so
    // no fifth — and `a-title-that-names-a-count-the-assertion-never-checks` is why this is an
    // expression and not a sentence.
    const kinds = Object.keys(REGISTER_OF) as ToldLayerKind[]
    // ⚑ **583 · the tabs are walked from the STRIP, not from a list typed here**, so a tab this
    // file does not know about still gets searched for layer rows. ⛔ That is what makes the
    // *drawn on exactly one tab* claim below exhaustive rather than a claim about four guesses.
    const keys = [...m.q('told-tabs').querySelectorAll('[data-cy^="told-tab-"]')].map((one) =>
      (one.getAttribute('data-cy') ?? '').replace('told-tab-', ''),
    )
    expect(keys.length, 'the tab strip drew no tabs at all').toBeGreaterThan(1)

    const seen = new Map<string, string>()
    for (const key of keys) {
      await show(m, key)
      // ⚠️ **By PREFIX, because the rows are a family** — `told-layer-<kind>`. A `data-cy="told-layer"`
      // query matches nothing here, which is how this assertion first passed for no reason at all.
      for (const row of m.host.querySelectorAll<HTMLElement>('[data-cy^="told-layer-"]')) {
        const kind = (row.getAttribute('data-cy') ?? '').replace('told-layer-', '')
        expect(seen.has(kind), `${kind} was drawn on two tabs`).toBe(false)
        seen.set(kind, key)
        const chip = row.querySelector<HTMLElement>('[data-cy="told-register"]')
        const wants = REGISTER_OF[kind]
        if (wants === null) {
          // ⛔ **The one layer with no chip, and the bytes are what stand in its place.** An
          // `observed` register said *this app watched these bytes go*; on this tab the bytes
          // themselves are on screen, so the claim is asserted against the thing that carries it.
          expect(chip, `${kind} grew a register chip back — re-aim this expectation`).toBeNull()
          expect(visible(m.q(`told-bytes-${kind}`))).toBe(true)
          // ⛔ **By `data-cy`, and that is a REPAIR rather than a style choice.** The opaque
          // test below asked for `.markdown, .document-body, pre` and `DocumentBody` renders
          // none of those three at rest — it is `doc-paper` / `md-doc`, and every class in it is
          // scoped anyway (`a-scoped-class-matches-nothing-in-another-component`). ⚑ **This line
          // is the control that proves the sensor fires**: the same query, on the one row that
          // really does carry a body (`a-control-must-be-trapped-the-way-the-subject-is`).
          expect(row.querySelector(BODY)).not.toBeNull()
          continue
        }
        expect(chip, `${kind} lost its register chip`).not.toBeNull()
        expect(visible(chip!)).toBe(true)
        // ⛔ **A chip with no words is a layer with no register**, whatever the projection says.
        expect((chip!.textContent ?? '').trim().length).toBeGreaterThan(0)
        const box = chip!.getBoundingClientRect()
        expect(box.width).toBeGreaterThan(30)
        expect(box.height).toBeGreaterThan(8)
        expect(chip!.getAttribute('data-register'), `${kind}'s register`).toBe(wants)
        // ⚑ **The words, not only the attribute** — 163: the attribute is the answer, the word is
        // for the person, and a test that reads only the attribute cannot tell a blank chip from
        // a full one.
        expect((chip!.textContent ?? '').trim(), `${kind}'s register word`).toBe(wants)
      }
    }
    // …and the rows really are the layers the projection named — every one of them drawn, none
    // lost to the regrouping, and each on the tab `WHOSE_LAYER` sends it to. ⛔ **583 broke the
    // single ORDER this file used to assert** (one list, top to bottom) and this is the same
    // claim over the new shape: membership, uniqueness, and the owner of each row.
    expect([...seen.keys()].sort(), 'a layer was drawn on no tab at all').toEqual([...kinds].sort())
    for (const kind of kinds) expect(seen.get(kind), `where ${kind} landed`).toBe(tabOf(kind))
  })

  it('⛔ the opaque layer opens to a SENTENCE and never to a body — there is nothing to open', async () => {
    const [wide] = hostWidths()
    const m = openInfo(TOLD, wide!)
    // ⚑ **583 · it lives under *not shown*** — the group `583` §3 gave the two layers this app
    // can name and cannot show. The disclosure inside the row did not move.
    await show(m, tabOf('provider-base'))
    const row = m.q('told-layer-provider-base')
    expect(row.querySelector(BODY)).toBeNull()
    m.q('told-why-provider-base').click()
    await nextTick()
    const says = row.querySelector('[data-cy="told-says-provider-base"]')
    expect(visible(says as HTMLElement)).toBe(true)
    expect(says?.textContent).toContain('never replaces it')
    // ⛔ **Opened, and still no bytes.** An opaque layer that grew a body would be showing
    // something this app does not have — the reconstruction `430` rules out by name.
    expect(row.querySelector('[data-cy="told-bytes-provider-base"]')).toBeNull()
  })

  it('🔴 the composed layer opens to the text AS SENT — preamble, headers and all', async () => {
    const [wide] = hostWidths()
    const m = openInfo(TOLD, wide!)
    // ⚠️ **Not on the landing tab**: the sheet opens on the first owner with something in it, and
    // the prompt is one press away at the end of the strip. ⛔ **583 moved the press from
    // `told-why-app-composed` to the tab itself** — *"open on this tab rather than behind a
    // press, because this tab IS the press"* — so the negative control moved with it and did not
    // go: 2.5 KB of markdown must not be what a person lands on.
    // ⛔ **And the negative is measured on a sheet that IS drawn** — the strip is up, the `as
    // sent` tab is there and is not the one selected. Without this line the absence above would
    // also pass on a sheet that rendered nothing at all (`put-the-hazard-on-the-path`).
    expect(m.q(`told-tab-${AS_SENT}`).getAttribute('aria-selected')).toBe('false')
    expect(m.host.textContent).not.toContain('You are Lena (writer)')
    await show(m, tabOf('app-composed'))
    const row = m.q('told-layer-app-composed')
    expect(row.textContent).toContain('You are Lena (writer)')
    // ⛔ **The framing is the whole finding.** The per-file rows below have carried the file text
    // since 158; the preamble and the `Contents of …` headers went to the model and appeared on
    // no surface at all until this one.
    expect(row.textContent).toContain('Contents of /Users/somebody/work/repo/CLAUDE.md')
    // ⚑ **And it is open with NO second press**, which is the half of this claim 583 changed the
    // mechanism of: the row carries no toggle of its own now, so a row that still needed one
    // would leave this red.
    expect(row.querySelector('[data-cy="told-why-app-composed"]')).toBeNull()
    expect(visible(m.q('told-bytes-app-composed'))).toBe(true)
    expect(m.q('told-bytes-app-composed').textContent).toContain('as it was sent')
  })

  it('⚑ the sentence is on screen with no click, and the relaunch line only when there was one', async () => {
    const [wide] = hostWidths()
    const once = openInfo(TOLD, wide!)
    // 🔴 **442 §2.2 calls this the deliverable even if nothing else lands** — so it may not be
    // behind a fold. A scope a reader has to open is a scope most readers never see.
    //
    // ⛔ **583 moved it onto the `as sent` tab, and that IS a press** — reported as a finding, not
    // absorbed. ⚑ **What this test holds now is the strongest form of the rule that survives the
    // move**: the tab is on screen from the first paint, it is ONE press from where a person
    // lands, and once pressed the sentence is read WITHOUT a second gesture — no `why`, no
    // chevron, nothing collapsed over it.
    expect(visible(once.q(`told-tab-${AS_SENT}`)), 'the way to the scope is not on screen').toBe(
      true,
    )
    await show(once, AS_SENT)
    expect(visible(once.q('told-sentence'))).toBe(true)
    expect(once.q('told-sentence').textContent).toContain('most recent launch')
    // ⛔ **Nothing was unfolded to get here.** Both of this tab's disclosures are still shut,
    // which is what *not behind a fold* means once the tab itself is the only gesture.
    expect(once.host.querySelector('[data-cy="told-order"]')).toBeNull()
    expect(once.host.querySelector('[data-cy="instructions-why-body"]')).toBeNull()
    expect(once.host.querySelector('[data-cy="told-earlier"]')).toBeNull()

    unmountAll()
    const again = openInfo(TOLD, wide!, { relaunched: true })
    await show(again, AS_SENT)
    const earlier = again.q('told-earlier')
    expect(visible(earlier)).toBe(true)
    expect(earlier.textContent?.trim()).toBe(TOLD_HAS_AN_EARLIER_LIFE)
  })

  it('⚠️ a conversation that reported no toolset says so, and does not print a zero', async () => {
    const [wide] = hostWidths()
    const m = openInfo(TOLD, wide!)
    // ⚑ **583 · the verbs are a *not shown* layer** — the provider composes their definitions and
    // this app holds none of that text, which is the property that whole tab is.
    await show(m, tabOf('published-tools'))
    // ⛔ **The row FIRST, and that is not ceremony.** Only one tab is in the DOM at 583, so an
    // absent-count assertion taken on the wrong tab passes because the whole row is elsewhere —
    // the vacuous green this file is most exposed to. The row on screen is what makes the
    // absence below a measurement.
    const row = m.q('told-layer-published-tools')
    // ⛔ **`told-count-published-tools` is ABSENT rather than `0`** — the harness's transcript has
    // no tool frame, and *"nothing has said"* must never be drawn as *"it was handed none"*.
    expect(row.querySelector('[data-cy="told-count-published-tools"]')).toBeNull()
    expect(m.host.querySelector('[data-cy="told-count-published-tools"]')).toBeNull()
    m.q('told-why-published-tools').click()
    await nextTick()
    expect(m.q('told-says-published-tools').textContent).toContain('has not reported')
  })

  it('⛔ the order paragraph is documentation, so it stays behind this row’s OWN disclosure', async () => {
    const [wide] = hostWidths()
    const m = openInfo(TOLD, wide!)
    // ⚑ **583 · both folds are on `as sent` now**, which is where the account went. The tab does
    // not open them: a tab chooses what you are reading, a fold chooses how much of it.
    await show(m, AS_SENT)
    expect(m.host.querySelector('[data-cy="told-order"]')).toBeNull()
    // ⚑ **`told-why`, not `instructions-why`.** Two folds with two subjects: this one explains how
    // the layers are ordered and is drawn on every conversation; the other belongs to the file
    // list below and is gated on that list having something to explain (356 §1).
    m.q('told-why').click()
    await nextTick()
    expect(visible(m.q('told-order'))).toBe(true)
    expect(m.q('told-order').textContent).toContain('not something this app observes')
    // ⛔ **And the OTHER fold stayed shut**, which is the half of *two subjects* nothing checked
    // until now: this fixture carries a `note`, so `instructions-why` is drawn beside it and a
    // single shared boolean would have opened both from one press.
    expect(visible(m.q('instructions-why'))).toBe(true)
    expect(m.host.querySelector('[data-cy="instructions-why-body"]')).toBeNull()
  })
})
