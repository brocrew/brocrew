import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HAND_CARRIED, V27_SURFACES } from '../src/renderer/src/lib/design-v2-map'
import { SPAWN_RAIL_MEANS } from '../src/shared/capabilities'

/**
 * 🔴 **455 · the v2.7 delivery, made checkable** — the instrument for `design-v2-map.ts` §10.
 *
 * ## ⛔ Why this file exists rather than more rows in `382`'s
 *
 * `the-map-before-the-move.test.ts` asks *"where does v2.3's value come from"*, field by field.
 * ⚠️ **Nothing in it says WHEN**: a row that says drawn without a revision cannot be read a week
 * later. §4 answers the two of the three questions about a SURFACE that this tree can answer —
 * which commit imported it, and what is still only drawn — from `git` and the files rather than
 * from a recital. ⚠️ The third, which revision drew it, is `drawnIn`, and it is a record (below).
 *
 * ## ⚑ The one rule every section here obeys
 *
 * ⛔ **Nothing below trusts the delivery.** Standing rule 17: *"every source claim and every copy
 * string in such a delivery is UNVERIFIED until the importer verifies it, and 'the mock says so' is
 * not evidence."* So the import commits are resolved against `git` rather than recited, and every
 * other section reads OUR code rather than a sentence about it.
 *
 * ## ⚠️ What it does not check
 *
 * The v2.3 and v2.7 drawings are not in the repository, so nothing here reads them: the map's
 * `title`, `drawnIn` and `heldIn` are a record that nothing re-derives or checks against a drawing.
 * ⚑ The numbering has gaps (§1–§3 and §6) because other files cite the sections by number; §5
 * holds only the length pin of `SPAWN_RAIL_MEANS`.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../..')
const SRC = join(HERE, '../src')

/**
 * ⛔ **Prose out first.** §10 asks what a component's CODE imports, and a docblock or a template
 * comment that names `design-v2-map` is not an import. ⚠️ The sibling helper `px()` in §9 strips
 * for the same reason.
 */
function withoutProse(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[\s;{(=,>])\/\/[^\n]*/g, (_match, keep: string) => keep)
}

/* ------------------------------------------------------------------------------------- the repo */

/** `git`, or `null` when this environment has none — see §4's premise test. */
function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 30_000,
      // ⚠️ `cat-file -e` on a path that is not in a tree writes to stderr and exits non-zero —
      // which is this file's SUCCESS case, twice per row. Inherited, it would print 33 `fatal:`
      // lines into a green gate.
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * ⚠️ **The premise is FULL HISTORY, not a working `git`.** `rev-parse HEAD` answers in a shallow or
 * grafted clone and `cat-file -t <old sha>` does not, so a premise keyed on the former would send
 * §4 red reporting the MACHINE — the exact failure its three-valued guard exists to prevent. The
 * oldest sha any row names is probed instead.
 */
const OLDEST_ROW_COMMIT = '1c20ab5'
const GIT_WORKS =
  git(['rev-parse', 'HEAD']) !== null && git(['cat-file', '-t', OLDEST_ROW_COMMIT]) === 'commit'

/* ───────────────────────────────────────── §4 · the product half — the file, and the commit ── */

describe('§4 · which commit imported it', () => {
  it('⛔ every named product file exists', () => {
    for (const row of V27_SURFACES)
      for (const path of row.renders)
        expect(existsSync(join(REPO, path)), `${row.id} names ${path}`).toBe(true)
  })

  it('🔴 `state` and the two lists agree, in both directions', () => {
    for (const row of V27_SURFACES) {
      const empty = row.renders.length === 0
      expect(row.importedAt.length, `${row.id}: one commit per file`).toBe(row.renders.length)
      const shouldBeEmpty = row.state === 'only-drawn' || row.state === 'review-scaffold'
      expect(empty, `${row.id} is ${row.state} and names ${row.renders.length} file(s)`).toBe(
        shouldBeEmpty,
      )
    }
  })

  it('🔴 `stillOnlyDrawn` is what separates `imported` from `part-imported`', () => {
    // ⛔ **Without this, the four-member vocabulary was two members to a test** — empty renders or
    // not — and flipping any of the fifteen `imported` rows to `part-imported` was a phantom.
    for (const row of V27_SURFACES) {
      const owed = row.stillOnlyDrawn.length
      if (row.state === 'part-imported')
        expect(owed, `${row.id} is part-imported and names nothing owed`).toBeGreaterThan(0)
      else expect(row.stillOnlyDrawn, `${row.id} is ${row.state} and names owed work`).toEqual([])
    }
    // ⚑ The answer to `455 §2.1`'s third question, as a list a plan can lift.
    expect(V27_SURFACES.flatMap((row) => row.stillOnlyDrawn).length).toBeGreaterThanOrEqual(10)
  })

  it('⛔ the surfaces wholly unbuilt are named — D-016’s four, and nothing an accident left', () => {
    // 🔴 **`only-drawn` had no member until D-016, and this said so out loud.** Every route and
    // every sheet the drawing could reach had SOMETHING in the product; what was only drawn was not
    // a surface but smaller things the router cannot name: the `awaiting-reply` presentation state,
    // the refusal remedy's separate strip, and *page-ness* — `attention` and `digest` are blocks on
    // `waiting` and `away`, not routes.
    // ⚑ **D-016 took projects out of the product, and four rows became only drawn ON PURPOSE** —
    // the board, the room, the record sheet and the workspace summary, each with nothing owed.
    // ⛔ **Pinned by kind and id**, so a surface cannot go wholly unbuilt by accident: a fifth
    // member is a decision this list has to be told about.
    const onlyDrawn = V27_SURFACES.filter((row) => row.state === 'only-drawn')
    expect(onlyDrawn.map((row) => `${row.kind}:${row.id}`)).toEqual([
      'route:projects',
      'route:project',
      'sheet:project',
      'sheet:workspace',
    ])
    // ⚠️ **And each says why, in the words of the commit that did it** — an unexplained
    // `only-drawn` would be the accident this test exists to refuse.
    for (const row of onlyDrawn) expect(row.note, `${row.kind}:${row.id}`).toContain('D-016')
    // ⚑ The empty-list branch of §4's `state`/`renders` agreement is still exercised by the two
    // `review-scaffold` rows as well — so the only-drawn rows are not the only thing holding it.
    expect(
      V27_SURFACES.filter((row) => row.renders.length === 0 && row.state !== 'only-drawn').map(
        (row) => row.id,
      ),
    ).toEqual(['review', 'unavailable'])
  })

  it('⚑ `review-scaffold` is the drawing’s own chrome and nothing else wears it', () => {
    // ⚠️ A state that excuses a row from every product assertion needs its membership pinned, or
    // it becomes the place a surface goes to stop being owed.
    expect(
      V27_SURFACES.filter((row) => row.state === 'review-scaffold').map((row) => row.id),
    ).toEqual(['review', 'unavailable'])
  })

  it('🔴 every `wiredAt` is a real ancestor commit that TOUCHED the surface', () => {
    if (!GIT_WORKS) {
      expect(git(['cat-file', '-t', OLDEST_ROW_COMMIT])).not.toBe('commit')
      return
    }
    const wired = V27_SURFACES.filter((row) => row.wiredAt !== null)
    // ⛔ **A floor, so an empty column cannot satisfy the loop.** NINE surfaces were born as
    // something other than the thing the drawing draws.
    //
    // ⚠️ **It said *eight* and the floor said `8`, and `510` moved both** — the `document` row
    // gained a `wiredAt`, and a sentence beside an assertion that would not have noticed is
    // `a-number-can-survive-the-death-of-its-derivation` in the one place this file could least
    // afford it. ⚑ The floor is raised with the sentence so the column cannot quietly shrink back.
    // ⚑ **9 → 7 at D-016**, with the sentence: `projects` (`f6751216`), `project` (`71d7360`) and
    // the decision sheet (`af733d1`, `ProposalCard`) lost the files their `wiredAt` touched, so
    // SEVEN surfaces now record when they were wired.
    // ⚑ **7 → 4 when Recent activity replaced the digest card**: the digest route, its window and
    // its gap sheet lost the card their `wiredAt` touched, so FOUR surfaces now record it.
    expect(wired.length, 'nothing records when a surface was wired').toBeGreaterThanOrEqual(4)
    for (const row of wired) {
      const sha = row.wiredAt as string
      expect(git(['cat-file', '-t', sha]), `${row.id} @ ${sha}`).toBe('commit')
      expect(git(['merge-base', '--is-ancestor', sha, 'HEAD']), `${row.id} @ ${sha}`).toBe('')
      // ⚑ TOUCHED, not born — that is the difference from `importedAt`, and the whole reason the
      // second column exists.
      const touched = row.renders.some(
        (path) => (git(['show', '--stat', '--format=', sha, '--', path]) ?? '') !== '',
      )
      expect(touched, `${sha} touches none of ${row.id}'s files`).toBe(true)
    }
    // ⚠️ **And the column must SAY something the other does not.** A `wiredAt` that is the birth
    // of every file the row names is a row that learned nothing, and `null` is how that is said.
    // ⚑ It may equal ONE of them — `438` created `lib/digest.ts` in the same commit that made
    // `DigestCard.vue` draw a real digest, and both facts are true of that commit.
    for (const row of wired)
      expect(
        row.importedAt.some((sha) => sha !== row.wiredAt),
        `${row.id}: wiredAt is the birth of every file it names — use null`,
      ).toBe(true)
  })

  it('🔴 every `importedAt` is the commit that FIRST carried its file', () => {
    if (!GIT_WORKS) {
      // ⚠️ Three-valued, like `build-identity.test.ts`: with no reachable history the premise is
      // absent rather than the claim false, and a red test would be reporting the machine.
      expect(git(['cat-file', '-t', OLDEST_ROW_COMMIT])).not.toBe('commit')
      return
    }
    for (const row of V27_SURFACES)
      row.renders.forEach((path, at) => {
        const sha = row.importedAt[at] as string
        const where = `${row.id} → ${path} @ ${sha}`
        expect(git(['cat-file', '-t', sha]), where).toBe('commit')
        expect(
          git(['merge-base', '--is-ancestor', sha, 'HEAD']),
          `${where} is not an ancestor of HEAD`,
        ).toBe('')
        // ⛔ **Present at the commit and ABSENT at its first parent.** Without the second half any
        // commit that merely touched the file would pass, which is the difference between
        // *"imported at"* and *"edited at some point".*
        expect(git(['cat-file', '-e', `${sha}:${path}`]), `${where}: not in that tree`).toBe('')
        const parent = git(['rev-parse', `${sha}^1`])
        if (parent === null) return
        expect(git(['cat-file', '-e', `${sha}^1:${path}`]), `${where}: already there before`).toBe(
          null,
        )
      })
  })
})

/* ─────────────────────────────────────────── §5 · the sentence above the first grant control ── */

describe('§5 · `SPAWN_RAIL_MEANS`, pinned by its length', () => {
  /**
   * 🔴 **The one check a revert of the sentence's wording cannot pass.** The sentence says a
   * conversation an agent starts *"can never be given more latitude in its approval mode"*; the
   * earlier wording shares *can never be given more*, and that phrase is all
   * `consent-never-containment.test.ts` and `a-mode-a-child-inherits.test.ts` match, so a revert
   * keeps both green and only this length catches it. ⚑ The verb is on the same pin: *an agent
   * creates* is one character longer than *an agent starts*.
   */
  it('⛔ the sentence is 274 characters, and the number is typed rather than read off it', () => {
    // ⛔ The number is typed here and not read off the constant: a bound written as the constant
    // cannot pin it, so it moves only with a hand on this line.
    expect(SPAWN_RAIL_MEANS.length, 'the sentence moved').toBe(274)
  })
})

/* ────────────────────────────── §7 · the third clause of the provider note, pinned at last ── */

describe('§7 · a running session’s provider and handle are `readonly`', () => {
  /**
   * 🔴 **`design-v2-map.ts`'s `selectProvider` note said `a-front-door-that-asks-nothing.test.ts`
   * §1 pinned all three of `417 §3`'s findings. It pins two.** §1's walk is `tree('main')`; the
   * handle classes are in `packages/runtime`, and the word `readonly` does not occur in that file.
   * ⚑ This is the third.
   */
  it('⛔ `HostedSession` declares both as `readonly`, and the interface has mutable fields too', () => {
    const host = readFileSync(join(SRC, 'main/runtime/runtime-host.ts'), 'utf8')
    const start = host.indexOf('interface HostedSession {')
    expect(start, 'HostedSession is gone').toBeGreaterThan(-1)
    const body = host.slice(start, host.indexOf('\n}\n', start))
    expect(body).toMatch(/^\s*readonly provider: Provider$/m)
    expect(body).toMatch(/^\s*readonly handle: SessionHandle$/m)
    // ⚠️ **The control, and it is the reason the two above mean anything.** If every field in this
    // interface were `readonly`, the assertions would be about the house style rather than about
    // these two fields. `lastAgentInfo` is deliberately mutable.
    expect(body).toMatch(/^\s*lastAgentInfo: string$/m)
  })

  it('⛔ the handle it holds is built by a per-provider class, one per provider', () => {
    const runtime = join(REPO, 'packages/runtime/src')
    const classes = ['claude/claude-runtime.ts', 'codex/codex-runtime.ts'].map((file) => {
      const code = readFileSync(join(runtime, file), 'utf8')
      const named = [...code.matchAll(/export class (\w*SessionHandle)\b/g)].map(
        (m) => m[1] as string,
      )
      return { file, named }
    })
    for (const { file, named } of classes)
      expect(named.length, `${file} declares no session-handle class`).toBe(1)
    // Two providers, two DIFFERENT classes — the fact that makes a provider swap a relaunch.
    expect(new Set(classes.flatMap((c) => c.named)).size).toBe(2)
  })
})

/* ──────────────────────────────── §8 · the sentence audit now says which drawing it is about ── */

/**
 * ⚑ **`heldIn` is a record**: the drawings are not in the repository, so nothing looks for a quote
 * in a drawing's bytes. What is checked is the counts.
 */
describe('§8 · `heldIn`, recorded', () => {
  it('🔴 `heldIn` puts exactly ONE of v2.3’s sentences in v2.7, and every number here is pinned', () => {
    // ⛔ **The counts the title used to name and nothing checked.** `382`'s own file pins 21 and
    // 16 (`the-map-before-the-move.test.ts`); they are pinned here too, because a sentence in
    // THIS file that quotes a number must be able to go red with it.
    // ⚑ **15 → 16 at `503`**: *"An answer or denial stays attributed…"* was `false` on a premise
    // `477` ended, and the correction landed with the surface that draws the actor.
    // ⚑ **16 → 15 at `532`, and it is the first move in the other direction**: every earlier
    // correction here closed a hole and made a sentence supported; HO-052 §1 made one of them
    // false, because a role now seeds what an identity starts out allowed to do.
    // ⚑ **15 → 14 at `733`, the same direction**: *"Credential file contents are never previewed
    // here."* went `false` when the Info panel's config rows got Open (`731` F-2, R92).
    // ⚑ **14 → 13 at D-016, the same direction**: *"It does not imply cross-project task
    // assignment…"* went `false` when projects left the product — it closed a sheet that is gone.
    expect(HAND_CARRIED.length, 'the enumeration moved').toBe(21)
    expect(HAND_CARRIED.filter((one) => one.verdict === 'supported').length).toBe(13)
    const survivors = HAND_CARRIED.filter((sentence) => sentence.heldIn.includes('v2.7'))
    expect(HAND_CARRIED.every((sentence) => sentence.heldIn.includes('v2.3'))).toBe(true)
    expect(survivors.map((sentence) => sentence.quote)).toEqual([
      'A change to approval mode does not rewrite a running turn.',
    ])
    // ⚑ **All the `false` and the one `blurred` are gone from v2.7** — the drawing dropped every
    // sentence `382` refused. ⛔ So did TWELVE OF THE THIRTEEN it SUPPORTS: this is a redrawing,
    // not a correction, and `382`'s guard was pointed at a drawing four revisions old. (`733` moved
    // both numbers by one, as `532` did: the sentence it made false is held in v2.3 alone.)
    // ⚠️ **`532` moved both numbers by one and neither derivation moved**: the sentence it made
    // false is held in v2.3 alone, so it left the supported count and the non-survivors together.
    // ⚠️ **Both numbers moved at `503` and neither derivation did**: the corrected sentence is
    // held in v2.3 alone, so it joined the supported count and the non-survivors in one step.
    expect(survivors.filter((one) => one.verdict === 'supported').length).toBe(1)
    expect(
      HAND_CARRIED.filter(
        (sentence) => sentence.verdict !== 'supported' && sentence.heldIn.includes('v2.7'),
      ),
    ).toEqual([])
  })
})

/* ──────────────────────────────── §9 · the band, the rail and the drawer — our half of each ── */

/**
 * 🔴 **The drawing's geometry sentence is true, and its CSS composes the same band differently.**
 * The geometry measured in our window is in `the-drawing-arrives.dom.test.ts`; this section lists
 * how the band, the rail and the drawer are built differently, the harmless differences included.
 * ⚑ The drawing's side of each is in the comments below, as read off its stylesheet; what is
 * asserted is OUR side, the half that can still move.
 */
describe('§9 · the band, the rail and the drawer, in our own tokens', () => {
  /**
   * Every `--custom-property: <n>px` DECLARATION, by name, from a stylesheet's bytes.
   *
   * ⛔ **Comments stripped first.** `tokens.css` argues about its own numbers in prose —
   * *"`rail-rhythm.dom.test.ts` pins `--rail-w: 220px` at ≥1400px"* — and a census that read the
   * argument as a declaration would report three rail widths where the file declares two.
   * `a-source-census-must-strip-prose-before-it-asserts`, and it fired on the first run of this
   * very function.
   */
  function px(source: string, name: string): number[] {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
    const found = [...code.matchAll(new RegExp(`${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'g'))].map(
      (m) => Number(m[1]),
    )
    expect(found.length, `${name} is not declared`).toBeGreaterThan(0)
    return found
  }

  const tokens = (): string => readFileSync(join(SRC, 'renderer/src/assets/tokens.css'), 'utf8')

  it('🔴 the clearance is DERIVED — one literal for the lane, and `--lane-clear` built from it', () => {
    // ⚑ The drawing writes the band (210) and the clearance (220) as independent literals in
    // `:root` (`--safety-band`, `--sheet-clearance`). Ours is ONE literal with the other derived
    // from it, and that is the difference that matters. ⛔ Two literals can drift apart silently.
    expect(px(tokens(), '--lane-w')).toEqual([200])
    expect(px(tokens(), '--space-5')).toEqual([10])
    expect(tokens()).toContain(
      '--lane-clear: calc(var(--space-5) + var(--lane-w) + var(--space-5))',
    )
    expect(tokens()).not.toMatch(/--lane-clear:\s*220px/)
  })

  it('⚠️ the lane card sits one gutter in and is the lane wide — its right edge IS the band’s', () => {
    // ⛔ **Read from the rule's bytes**, because arithmetic like `10 + 200 === 210` has no subject
    // and no edit could make it red.
    // ⚑ The drawing insets its card on BOTH sides — `--safety-inset: 12px`, the card two insets
    // narrower than the band. Ours is one gutter and the card's own width, so its right edge IS the
    // band's edge — which is why `--lane-clear` needs one more step and theirs does not. Same band,
    // two shapes.
    const overlay = readFileSync(join(SRC, 'renderer/src/components/OverlayHost.vue'), 'utf8')
    const corner = overlay.slice(overlay.indexOf('.overlay-corner {'))
    expect(corner.slice(0, corner.indexOf('}'))).toContain('left: var(--space-5)')
    expect(corner.slice(0, corner.indexOf('}'))).toContain('width: var(--lane-w)')
    expect(corner.slice(0, corner.indexOf('}'))).not.toContain('right:')
  })

  it('⛔ we declare two rail widths — 251.68, and 266.2 at ≥1400px', () => {
    // The drawing declares five — 208, 210, 212, 220 and 224 — because v2.7 is v2.6's stylesheet
    // with a v2.7 block appended. Ours are wider than all of them and there are only two: each
    // further breakpoint would be more pinned numbers.
    expect(px(tokens(), '--rail-w')).toEqual([251.68])
    expect(px(tokens(), '--rail-w-wide')).toEqual([266.2])
    expect(tokens()).toContain('--rail-w: var(--rail-w-wide)')
  })

  /**
   * The drawing’s drawer is 320 or 380px, but the product drawer responds fluidly between 360
   * and 560px. Its preview widths, 463 and 532px, lie within that range.
   */
  it('⛔ the drawer is fluid between 360 and 560, seated by the row it shares and not the window', () => {
    expect(px(tokens(), '--drawer-w-min')).toEqual([360])
    expect(px(tokens(), '--drawer-w-max')).toEqual([560])
    // ⛔ **And the rule behind them is not the drawing's.** Theirs switches on window width; ours on
    // the measured width of the row the transcript and the drawer share, because a rule keyed on
    // the viewport would detach the drawer while the transcript still has all the room it asked
    // for.
    expect(readFileSync(join(SRC, 'renderer/src/lib/drawer.ts'), 'utf8')).toContain(
      'export function drawerFit(available: number): DrawerFit',
    )
  })
})

/* ───────────────────────────── §10 · the map's own claim about itself, which nothing checked ── */

describe('§10 · no component imports the map', () => {
  /**
   * ⚑ **`design-v2-map.ts`'s header has said *"it renders nothing and no component imports it"*
   * and this test asserts it.** ⛔ The day a component does import it, the whole enumeration and
   * its quotes enter the renderer bundle — and the sentence would still read as true.
   */
  it('⛔ zero `.vue` files import it, and the walk can see an import that exists', () => {
    const components = readdirSync(join(SRC, 'renderer/src/components'), {
      recursive: true,
      encoding: 'utf8',
    }).filter((name) => name.endsWith('.vue'))
    expect(components.length, 'the component walk found nothing').toBeGreaterThan(50)
    const importers = components.filter((name) =>
      /from '[^']*design-v2-map'/.test(
        withoutProse(readFileSync(join(SRC, 'renderer/src/components', name), 'utf8')),
      ),
    )
    expect(importers, 'a component now imports the map — the header says none does').toEqual([])
    // ⛔ **The positive control**: the same shape, on an import that really is there. Without it a
    // broken regex would report the whole tree as clean.
    const shelf = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/SessionShelf.vue'), 'utf8'),
    )
    expect(/from '[^']*\/agent-state'/.test(shelf), 'the import walk sees nothing at all').toBe(
      true,
    )
  })
})
