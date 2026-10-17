import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick, ref, type Component } from 'vue'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { CAPABILITY_FIELDS, type ProfileCapabilities } from '../../src/shared/capabilities'
import type { AgentIdentities, AgentIdentity } from '../../src/shared/runtime-ipc'
import { HUMAN_NAMES, aNameForANewAgent, namesThatCanBeGiven } from '../../src/shared/human-names'
import { assertClipped, assertDrawn, drawnReady, inkRects } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 538 · what a seeded name does to the surfaces that DRAW it
 *
 * ## ⛔ Why this is measured and not assumed
 *
 * ⚠️ **The brief asked for it in those words** — *"what a derived or seeded name does to the
 * surfaces that draw it, measured with ink rather than assumed"* — and named the reason: `530`
 * measured this rail's copy column at **131 px** (143 px at the ≥1400 px width), found that one
 * `--text-2xs` line holds about 27 characters, and found an assertion passing over a string the
 * column had already cut off. ⛔ **`textContent` is the same whether a line is drawn or
 * ellipsized**, so no amount of SSR could answer this question.
 *
 * ## 🔴 It uses `531`'s SENSOR, and the first draft of this file did not
 *
 * ⛔ **The first version measured a `Range` of its own and read `scrollWidth`/`clientWidth`
 * beside it** — which is `530`'s technique copied into a second place, and
 * `every-assertion-that-reads-clipped-text.test.ts` went RED on exactly that: *"the sensor is the
 * only one of them addressed to TEXT"*. ⚑ **That census is right and the repair is to use
 * {@link assertDrawn} rather than to add a row to it** — `169` §1, and the whole reason `531`
 * extracted `drawn.ts` at all.
 *
 * ⚠️ **It is also a better instrument than the one it replaced.** `scrollWidth` floors at
 * `clientWidth`, so two names that both FIT measure identically — 131 and 131 — and a comparison
 * built on it reports *no change* for every string the column can hold.
 *
 * ## 🔴 What the measurement actually said, and it is not what the brief expected
 *
 * ⚠️ **The brief leaned to deriving a name and asked what that would do to this column**, naming
 * `530` as the reason to check. ⛔ **The answer is that the seeded name is NARROWER than the slug
 * it replaces**: *Project Manager* takes **93.0 px** where `project-manager` takes **95.1 px**, in
 * the rail's 131 px column, at both shipped rail widths. 🔴 **Same character count, less ink** —
 * two hyphens and fifteen lowercase glyphs against a space, two capitals and thirteen — so a test
 * that counted characters would have reported no change and a reasoned guess would have reported
 * the wrong direction.
 *
 * ⚑ **The pair is still the whole instrument.** *It fits* means nothing beside a column that
 * cannot clip, so every width is asserted with a name long enough to clip on the same row, in the
 * same render.
 *
 * ## ⚠️ 570 · the surface moved, and BOTH numbers above moved with it
 *
 * ⛔ **`EXT-008` §4.4 took the AGENTS section out of the rail**, so the roster this measures is
 * `TeamWorkspace`'s card, drawn at `566`'s two page widths rather than at `--rail-w`. ⚑ **The
 * property is unchanged and the direction survived**: at the card heading's larger size
 * *Project Manager* takes **150.8 px** where `project-manager` takes **154.2 px**, at both page
 * widths — the same 2 %-ish saving, measured again rather than carried forward.
 * 🔴 **The `93.0`/`95.1` pair above is kept as the RAIL's number and labelled as such**, because
 * it is the measurement `538` actually took and a number silently re-pointed at a different
 * column is `a-number-can-survive-the-death-of-its-derivation` in one edit.
 *
 * ⚠️ **And the control had to grow.** `The Acme Platform Migration Project Manager` clipped a
 * 131 px column and does NOT clip a card, so the name long enough to clip is longer now — which
 * is the honest way a positive control follows its surface.
 *
 * ## ⚠️ And the other surface the assigned name reaches, in a real engine
 *
 * `StartAsAgent` cannot be rendered from the node project at all — it binds to a window-scoped
 * store on setup — so `538`'s closure of `537` F6 is asserted here.
 *
 * ⛔ **584 · §2 held the word *Project Manager* typed literally, twice**, and that word went with
 * the seed (`HO-078` §1) — so the title and the placeholder are built from the generator now.
 * ⚑ **What §2 is ABOUT is unchanged**: this door says the identity's NAME where `537` F6 found it
 * saying the address it is filed under. 🔴 **And the pool made the glyph assertion beside it a
 * measurement for the first time** — *Project Manager* and `project-manager` share a `P`, so both
 * derivations agreed and the old assertion could not tell which column the letter came from
 * (`a-comparison-tested-where-both-sides-agree-measures-nothing`); an assigned *Ada* gives `A`.
 *
 * ## 🔴 584 · RE-AIMED, because the name stopped being a table with one row in it
 *
 * ⛔ **`HO-078` §5 made the name GENERATED** and `HO-078` §1 retired the identity `538` wrote this
 * about, so *the seeded word* and the `150.8`/`154.2` pair are both facts about a world that moved.
 * ⚠️ **Stripping the numbers would have left this file green over a changed world**, which is
 * standing rule 26's whole warning — so it asks the question a list of names makes ASKABLE:
 *
 * > ⚑ **No name this app can assign clips this column** — measured on every member of
 * > {@link HUMAN_NAMES} and on the widest of the other names, in one render, at both page widths,
 * > beside a control that does clip.
 *
 * 🔴 **That is a stronger claim than the one it replaces.** ⛔ `538` could measure one string and
 * had to reason about the rest; this measures BroBot's own list whole, and of the thousands of
 * other names the widest by a count of wide and narrow letters, so a list that took a name the card
 * cannot hold is a RED rather than a thing somebody notices on a screenshot. ⚠️ The widest are
 * chosen by that count, not measured one by one; every name is at most ten letters.
 *
 * ⚠️ **The old numbers are kept as the record of what `538` and `570` measured** and are labelled
 * as belonging to a name this app no longer assigns.
 */

/**
 * ⚠️ **`566`'s two page widths, and they are the window's rather than the rail's** — this roster is
 * a body surface since `570`, filling the column beside a `--rail-w` of 208 px. ⛔ **It was
 * `[208, 220]`, `530`'s measurement of the rail's copy column**, and that column is gone.
 */
const PAGE_WIDTHS = [1100, 760] as const

/** ⛔ Long enough to clip in this column at the card heading's size, and it is a plausible name. */
const TOO_LONG = 'The Acme Platform Migration Project Manager for the Nordics and Benelux Region'

/**
 * ⚑ **584 · the slug is a LOCAL constant now** (`HO-078` §1) — a name an agent CREATED rather than
 * one this app ships. ⛔ The string is unchanged on purpose: it is the one `538` and `570` measured
 * against, so the numbers in the note above still name the thing they were taken from.
 */
const MINTED_SLUG = 'project-manager'

/**
 * 🔴 **584 · a name this app hands an agent**, read from the generator and never typed here
 * (`human-names.ts`), drawn with a source that always answers 0 so it is the same on every run.
 *
 * ⛔ **The app ASSIGNS this word and does not seed it, which is why the constant no longer says it
 * does.** `HO-078` §1 leaves `brobot` the only identity a fresh install ships, so there is no
 * seeded row carrying this name and no table to read it out of — `HO-078` §5 has the app GENERATE
 * it at the moment it mints an identity. ⚑ A constant still spelled *seeded* would have been a
 * fact about a world that moved, left standing in the one place a reader looks first.
 */
const ASSIGNED: string = aNameForANewAgent([], () => 0)

const identity = (slug: string, displayName: string | null): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  provider: null,
  createdAt: 1_700_000_000_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  externalMcpServerIds: [],
  // ⚑ **D-016** — each field's own `narrowest`, read off the schema now that the set it made is
  // gone.
  capabilities: Object.fromEntries(
    CAPABILITY_FIELDS.map((field) => [field.key, field.narrowest]),
  ) as unknown as ProfileCapabilities,
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

/**
 * ⚑ **Both rows in ONE render**, so the comparison is between rows of the same card grid rather
 * than between two mounts that could differ for any other reason. ⚠️ **584 · it said *three* and
 * this fixture has held two since `538` wrote it** (`f1de5aa0`) — a count in prose that no
 * assertion ever checked (`a-title-that-names-a-count-the-assertion-never-checks`), corrected
 * here rather than carried one dispatch further.
 */
const roster = (pmName: string | null): AgentIdentities => ({
  identities: [
    // 🔴 The minted row — with the name this app assigns it, or with the `null` a row nobody has
    // named carries. ⛔ **584 · it is not a row a fresh install ships any more** (`HO-078` §1).
    identity(MINTED_SLUG, pmName),
    // ⛔ The control: a name this column genuinely cannot hold.
    identity('long', TOO_LONG),
  ],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
})

/**
 * ⚑ **584 · one row per assignable name, plus the control that clips** — the roster the whole-pool
 * measurement below renders. ⛔ The slugs are SHORT and derived from the index, so the card's own
 * width is decided by the heading rather than by an address nobody assigned.
 */
const poolSlug = (index: number): string => `a${String(index)}`

/**
 * The names measured: BroBot's own list, and the widest of the others by a rough count of glyph
 * width (a wide letter, a narrow one) — too many to draw at once, and the widest are the ones a
 * column could cut.
 */
const MEASURED: readonly string[] = (() => {
  const wide = /[mwMWÆŒ]/u
  const narrow = /[ijlrtfIJíìïîıĳļľł]/u
  const width = (name: string): number =>
    [...name].reduce(
      (sum, letter) => sum + (wide.test(letter) ? 1.5 : narrow.test(letter) ? 0.5 : 1),
      0,
    )
  const others = namesThatCanBeGiven()
    .slice(HUMAN_NAMES.length)
    .sort((a, b) => width(b) - width(a))
    .slice(0, 40)
  return [...HUMAN_NAMES, ...others]
})()

const everyPoolName = (): AgentIdentities => ({
  identities: [
    ...MEASURED.map((name, index) => identity(poolSlug(index), name)),
    identity('long', TOO_LONG),
  ],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
})

/** ⛔ Neither door is pressed in §1; a store that throws says so rather than pretending. */
const NO_WRITES = {
  renameTo: () => {
    throw new Error('an ink measurement must not write')
  },
  remove: () => {
    throw new Error('an ink measurement must not write')
  },
}

function pageAt(width: number, pmName: string | null): Mounted {
  return mount(
    TeamWorkspace as Component,
    { agents: roster(pmName), store: NO_WRITES },
    { width, height: 1200 },
  )
}

/**
 * ⛔ **`drawnReady` and not only a tick.** Inter is a bundled `@font-face`, and until it has loaded
 * every width on this page is the fallback's — which would make the two numbers below a
 * measurement of a font this app does not ship (`drawn.ts` limit 7).
 */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await drawnReady()
}

const nameCell = (m: Mounted, slug: string): HTMLElement => m.q(`team-name-${slug}`)

/** ⚑ The ink this element's text was laid into, through the ONE sensor (`531`). */
const inkWidth = (el: HTMLElement): number =>
  inkRects(el).reduce((total, rect) => total + rect.width, 0)

afterEach(() => {
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
})

describe('§1 · the name this app assigns, in the column that draws the roster', () => {
  for (const width of PAGE_WIDTHS) {
    it(`🔴 ${width}px · the name this app assigns is drawn WHOLE, and so is the slug beside it`, async () => {
      // ⚑ **The word a fresh install actually hands out**, pinned where a person reads it rather
      // than only inside the list's own order.
      expect(ASSIGNED).toBe('Ada')

      const after = pageAt(width, ASSIGNED)
      await settle()
      const assigned = nameCell(after, MINTED_SLUG)
      // ⚑ The premise: the words really are on the row, so the measurement is about them.
      expect(assigned.textContent?.trim()).toBe(ASSIGNED)
      // 🔴 **The measurement, through `531`'s sensor.** `.rail-copy strong` is `nowrap` +
      // `text-overflow: ellipsis`, so a name wider than its box is silently cut and `textContent`
      // says nothing about it — which is `530`'s finding on the line below this one.
      // ⚠️ **The mount host is the boundary**, because `base.css` gives `html, body`
      // `overflow: hidden` on purpose and the default would be a clipper of its own
      // (`drawn.ts` limit 5b).
      assertDrawn(assigned, `the assigned name at ${String(width)}px`, after.host)
      after.unmount()

      // ⛔ **The same row, in the state `main` draws it** — the before half of the comparison.
      const before = pageAt(width, null)
      await settle()
      const bare = nameCell(before, MINTED_SLUG)
      expect(bare.textContent?.trim()).toBe(MINTED_SLUG)
      assertDrawn(bare, `the slug at ${String(width)}px`, before.host)
    })

    it(`⛔ ${width}px · and the column really can clip, proven by a name long enough to do it`, async () => {
      const m = pageAt(width, ASSIGNED)
      await settle()

      const over = nameCell(m, 'long')
      // ⛔ **The paired positive** (`a-positive-assertion-must-differ-from-the-default`): *not
      // clipped* above is only a measurement if something in the SAME column can be clipped.
      expect(over.textContent?.trim()).toBe(TOO_LONG)
      assertClipped(over, `a name too long for the column at ${String(width)}px`, m.host)
    })

    it(`⚠️ ${width}px · the assigned name takes LESS ink than the slug, measured rather than reasoned`, async () => {
      const after = pageAt(width, ASSIGNED)
      await settle()
      const assignedCell = nameCell(after, MINTED_SLUG)
      const drawn = inkWidth(assignedCell)
      // ⚠️ **The CARD's width, and finding the right box was itself the measurement.** In the rail
      // the name was a block `strong` filling a 131 px copy column, so its own `clientWidth` WAS
      // the column. ⛔ On a card neither the `strong` nor the heading button is: the button is a
      // `justify-items: start` grid at fit-content width and the `strong` carries
      // `max-width: 100%`, so **both measure the string itself** — and reading either would have
      // measured the text twice and called the second reading a column.
      const column = after.q(`team-card-${MINTED_SLUG}`).clientWidth
      after.unmount()

      const before = pageAt(width, null)
      await settle()
      const slug = inkWidth(nameCell(before, MINTED_SLUG))

      // 🔴 **The direction, asserted** — so a font change that reversed it is a red rather than a
      // sentence in a response doc that quietly went false
      // (`a-number-can-survive-the-death-of-its-derivation`).
      //
      // ⚠️ **584 · this used to rest on the two strings having the same LENGTH** — *Project
      // Manager* against `project-manager`, fifteen characters each, where only the glyphs
      // differed. ⛔ **That pairing died with the seed** and the comparison is now between an
      // ordinary first name and a slug, which is a difference a character count would also have
      // found. ⚑ **So the load-bearing measurement moved to the test below**, which asks the
      // question a list of names makes askable; this one stays because the direction is still
      // what a person sees and a surface that drew the slug instead would pass without it.
      expect(
        drawn,
        `the assigned name (${drawn.toFixed(1)}px) is no longer narrower than the slug (${slug.toFixed(1)}px)`,
      ).toBeLessThan(slug)
      // 🔴 **Both are inside the column that draws them**, which is the claim §1 makes and this
      // is the same claim in glyphs rather than in an overflow flag.
      // ⚠️ **`570` · the column is no longer a token's value and is no longer asserted as one.**
      // It was `131` at `--rail-w: 208px` and `143` at `220`, read straight off `530`. ⛔ The card
      // is a `minmax(260px, 1fr)` grid track inside a padded page, so its width is a CONSEQUENCE
      // of the page's and pinning a number here would be pinning arithmetic nobody derived. ⚑ It
      // is asserted to be a real, non-trivial column instead, and the two ink numbers below it
      // are the measurement.
      expect(column, `the card collapsed to ${String(column)}px`).toBeGreaterThanOrEqual(260)
      expect(
        drawn,
        `the assigned name needs ${drawn.toFixed(1)}px of a ${String(column)}px column`,
      ).toBeLessThan(column)
      expect(slug).toBeLessThan(column)
    })

    it(`🔴 ${width}px · NO name this app can assign clips this column — BroBot’s list and the widest of the rest`, async () => {
      // 🔴 **584 · the claim a list of names makes askable, and the reason this file was re-aimed
      // rather than stripped** (standing rule 26).
      //
      // ⛔ **`538` measured ONE string and had to reason about the rest.** ⚑ BroBot's own list is
      // measured whole and the other names by their widest ({@link MEASURED}), so a name this card
      // cannot hold is a red here rather than something somebody notices on a screenshot.
      //
      // ⚠️ **One render, so the rows share a column** — mounting sixty-nine times would compare
      // boxes that could differ for any other reason.
      const m = mount(
        TeamWorkspace as Component,
        { agents: everyPoolName(), store: NO_WRITES },
        { width, height: 4000 },
      )
      await settle()
      for (const [index, name] of MEASURED.entries()) {
        const cell = nameCell(m, poolSlug(index))
        // ⚑ The premise: the word really is on the row, so the measurement is about it.
        expect(cell.textContent?.trim()).toBe(name)
        assertDrawn(cell, `the assignable name ${name} at ${String(width)}px`, m.host)
      }
      // ⛔ **The paired positive, in the SAME render** (`a-positive-assertion-must-differ-from-the-
      // default`): *none of them is clipped* is only a measurement if a row in this very column
      // can be.
      assertClipped(
        nameCell(m, 'long'),
        `a name too long for the column at ${String(width)}px`,
        m.host,
      )
    })
  }
})

describe('§2 · `537` F6 — the launcher door that named an identity by its slug', () => {
  /**
   * ⛔ **A bridge is installed before every mount**, so a reach into `window.api` is an answer
   * rather than a mount error. ⚠️ **D-016** took the project store this sheet read on setup (and
   * the `projects` door with it); the rest of the bridge is unchanged.
   */
  function installBridge(): void {
    ;(window as unknown as { api: unknown }).api = {
      runtime: {
        checkProviderAuth: () => Promise.resolve({ state: 'usable' }),
      },
    }
  }

  /**
   * ⚑ **The roster is INJECTED**, because a store that has not been read and a store with no name
   * in it are the same `null` to this component — and telling them apart is the whole assertion.
   */
  const storeHolding = (list: AgentIdentities | null): AgentStore =>
    ({ identities: ref(list), loaded: ref(list !== null), loadError: ref(null) }) as AgentStore

  const sheet = (agents: AgentStore): Mounted => {
    installBridge()
    return mount(
      StartAsAgent as Component,
      {
        profileSlug: MINTED_SLUG,
        provider: 'claude',
        defaultApprovalMode: 'ask',
        capabilities: allProviderCapabilities(),
        agents,
      },
      { width: 992, height: 808 },
    )
  }

  it('🔴 it opens as the NAME this app assigned it, not as the address it is filed under', async () => {
    await page.viewport(1200, 808)
    const m = sheet(storeHolding(roster(ASSIGNED)))
    await nextTick()

    // 🔴 **584 · RE-AIMED, and standing rule 26's three questions answered on it.**
    // ⚑ **1 · It read CODE** — a title this engine actually rendered, never a docblock word.
    // ⚠️ **2 · Only the WORD moved, not the fact.** The claim is `537` F6's: this sheet says the
    // identity's NAME where it used to say the address it is filed under. ⛔ The literal it was
    // spelled with — *Project Manager* — was `seededDisplayNameFor('project-manager')`, and
    // `HO-078` §1 left `brobot` the only identity a fresh install ships, so that table and that
    // row are both gone. 🔴 **3 · It pins the same property against the name this app ASSIGNS**
    // (`HO-078` §5), read from the generator rather than typed here a second time.
    //
    // ⛔ **Not stripped and not loosened to a `toContain`**: the title is still asserted WHOLE, so
    // a sheet that drew the name and the address together would still be red.
    // ⚑ **The word is pinned here as well as in §1**, because §2 is a different surface and an
    // assertion that only compared the fixture to itself would pass over an empty name.
    expect(ASSIGNED).toBe('Ada')
    expect(m.q('start-as-agent-title').textContent?.trim()).toBe(`New conversation as ${ASSIGNED}`)
    // ⚑ **And the composer's placeholder, which is the second place this sheet says the name** —
    // one derivation, two surfaces, `169` §1.
    expect((m.q('prompt-input') as HTMLTextAreaElement).placeholder).toContain(`Tell ${ASSIGNED}`)
    // 🔴 **The divergence this rests on, stated rather than assumed** (standing rule 3): the name
    // and the slug are different strings, so drawing either one is a distinguishable outcome and
    // the test below draws the other one in the same component.
    expect(ASSIGNED).not.toBe(MINTED_SLUG)
  })

  it('⛔ …and with no roster read yet it draws exactly what it drew before `538`', async () => {
    await page.viewport(1200, 808)
    const m = sheet(storeHolding(null))
    await nextTick()

    // 🔴 **`agentName(slug, null)` IS `profileLabel(slug)`** — so a sheet opened before the read
    // lands is today's behaviour exactly, and never a blank or a placeholder.
    expect(m.q('start-as-agent-title').textContent?.trim()).toBe(
      'New conversation as project-manager',
    )
  })

  it('⚠️ the glyph stays on the SLUG, which is the letter the sheet beside it derives too', async () => {
    await page.viewport(1200, 808)
    const m = sheet(storeHolding(roster(ASSIGNED)))
    await nextTick()
    // ⛔ Two surfaces disagreeing about one initial is the shape `538` was closing, so the sheet
    // keeps the slug's derivation rather than taking the first letter of the new words.
    // ⚠️ **584 · the peer is no longer the RAIL** — `570` took the roster out of it (`EXT-008`
    // §4.4) — it is `CapabilitiesSheet`, which draws `profileSlug.slice(0, 1).toUpperCase()` in
    // the same `.sheet-glyph` box. ⚑ One derivation, two sheets (`169` §1).
    //
    // 🔴 **584 · and this is the first version of this assertion that MEASURES that.** ⛔ *Project
    // Manager* and `project-manager` both begin with a `P`, so the two derivations agreed and a
    // sheet that had taken its letter off the display name would have passed exactly as loudly
    // (`a-comparison-tested-where-both-sides-agree-measures-nothing`). ⚑ An assigned *Ada* gives
    // `A` where the slug gives `P`, so the letter now NAMES the column it came from.
    expect(m.host.querySelector('.sheet-glyph')?.textContent?.trim()).toBe('P')
    // ⚠️ **The divergence is pinned, not hoped for** — a pool reordered so that a `P` name came
    // first would quietly put this assertion back to where both readings agree, and that is a red
    // here rather than a claim that silently stops being one.
    expect(ASSIGNED.slice(0, 1).toUpperCase()).not.toBe(MINTED_SLUG.slice(0, 1).toUpperCase())
  })
})
