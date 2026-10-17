import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DISCLOSURE_FIELDS,
  HAND_CARRIED,
  V23_ACTIONS,
  V23_FIELD_MAP,
  type Binding,
  type SourceRef,
} from '../src/renderer/src/lib/design-v2-map'

/**
 * 🔴 **382 · The map before the move — the instrument that makes the map a check.**
 *
 * `381` asked for *"an information-map and copy/contract pass before CSS"*, and a map is a document
 * until something refuses a field it forgot. This file is that refusal for everything the map says
 * about the PRODUCT: the verbs it cannot supply, the sources it points at, the verdicts on the
 * design's sentences, and whether any of those sentences has been pasted into the app.
 *
 * ⚠️ **The design drawing the map comes from is not in the repository.** The drawings stay
 * private, so the map's left-hand column — the fields, verbs and sentences v2.3 draws — is the
 * reference, and nothing here holds it against the drawing. The numbering starts at §3 because
 * other files cite the sections by number.
 *
 * ## ⚠️ What each section proves, and what it cannot
 *
 *  - §3 requires a reason on every verb the product cannot supply.
 *  - §4 resolves every {@link SourceRef} against the file it names. It proves the name is declared
 *    there; it is a source census and not a type checker, so it cannot prove a member belongs to the
 *    type it is written under.
 *  - §5 holds each verdict to its sources, in both directions.
 *  - §6 counts the enumerated sentences pasted into `renderer/` or `shared/`, and the count must
 *    be zero.
 *  - §7 holds the map to the rules it is written to enforce.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../..')
const SRC = join(HERE, '../src')

function bindings(): Binding[] {
  return [
    ...V23_FIELD_MAP.map((entry) => entry.binding),
    ...DISCLOSURE_FIELDS.map((slot) => slot.binding),
    ...V23_ACTIONS.map((action) => action.binding),
  ]
}

function refsIn(binding: Binding): readonly SourceRef[] {
  return binding.state === 'hole' ? [] : binding.from
}

/**
 * ⛔ **Every pointer in the file, and `HAND_CARRIED`'s are in it.**
 *
 * ⚠️ They were not, and a mutation found it: a row renaming `SPAWN_RAIL_MEANS` in a `renderFrom`
 * SURVIVED, because the walk only visited the three binding lists. The copy pointers are the most
 * load-bearing in the map — they are what the next commit renders FROM — and they were the ones
 * nothing resolved.
 */
function allRefs(): SourceRef[] {
  return [...bindings().flatMap(refsIn), ...HAND_CARRIED.flatMap((sentence) => sentence.renderFrom)]
}

/**
 * ⛔ **A fact the product HAS and v2.3 has nowhere to draw** — `378`'s List B as data.
 *
 * ⚑ It has to name a source, and that is the whole difference between it and a hole: a hole is a
 * capability nobody has built, an `unhoused` fact is one somebody already did and the design lost.
 */
function unhoused(): Binding[] {
  return bindings().filter((binding) => binding.state === 'unhoused')
}

describe('§3 · a verb the product cannot supply says why', () => {
  it('🔴 a verb with no product command is a HOLE and says why', () => {
    // ⛔ The four that cannot be wired must each carry a reason, because "unavailable" without one
    // is indistinguishable from "not done yet" — and two of these are capability proposals.
    const holes = V23_ACTIONS.filter((entry) => entry.binding.state === 'hole')
    expect(
      holes.length,
      'a hole with no verbs left would mean the product grew four commands',
    ).toBeGreaterThan(0)
    for (const hole of holes)
      expect(
        hole.binding.state === 'hole' && hole.binding.note.length,
        hole.action,
      ).toBeGreaterThan(80)
  })
})

describe('§4 · every pointer at the product resolves', () => {
  /**
   * Whether `symbol` is declared in `module`.
   *
   * A `Type.member` is two questions and both are asked: the type has to be declared, and the member
   * name has to appear in the file. ⚠️ The second is a containment check — see the header.
   */
  function resolves(ref: SourceRef): string | null {
    const path = join(REPO, ref.module)
    if (!existsSync(path)) return `${ref.module} does not exist`
    const code = readFileSync(path, 'utf8')
    const [head, member] = ref.symbol.split('.')
    const declared = new RegExp(
      `(export\\s+(declare\\s+)?(const|function|interface|type|class|enum)\\s+${head}\\b)|(^\\s*(const|interface|type)\\s+${head}\\b)`,
      'm',
    )
    if (!declared.test(code)) return `${ref.module} declares no \`${head}\``
    if (member && !new RegExp(`\\b${member}\\b`).test(code))
      return `${ref.module} never names \`${member}\``
    return null
  }

  it('⛔ every module and symbol the map names is really there', () => {
    const all = allRefs()
    // ⚑ A map whose pointers all resolved because there were none is the shape this floor refuses.
    expect(all.length, 'the map points at nothing').toBeGreaterThan(60)
    expect(all.map(resolves).filter((problem) => problem !== null)).toEqual([])
  })

  it('⚠️ the resolver can fail — two plants, one missing file and one missing name', () => {
    expect(resolves({ module: 'apps/desktop/src/nowhere.ts', symbol: 'Anything' })).toContain(
      'does not exist',
    )
    expect(
      resolves({ module: 'apps/desktop/src/shared/capabilities.ts', symbol: 'NoSuchExport' }),
    ).toContain('declares no')
  })

  it('🔴 the three counts this dispatch reports are pinned, not recomputed by a reader', () => {
    // ⛔ **A floor is not a count.** `> 3` let a mutation re-file a product fact as a hole and pass
    // with five left. These three numbers ARE §9.3 and §9.4's answers — what the product cannot
    // supply, what the design has no home for, and how many of v2.3's sentences are false — so
    // moving one is a deliberate act with a paragraph behind it, the way `retired 220 → 220` is.
    // 🔴 **11 → 13 at `417`, and both are the same removal.** HO-022 §2 took the provider select
    // and the folder field off the new-conversation screen, so v2.3's `selectProvider` and its
    // local `prepareConversation` draft stopped being things the product derives and became things
    // it cannot supply. ⚠️ The paragraph behind the move is on the two bindings themselves; the
    // point of pinning the number is that neither could have been re-filed quietly.
    // ⚑ **13 → 12 at `444` relay 1, and this one is a CLOSURE rather than a re-measurement.**
    // `tools.at` was a hole because `InventoryReading` carried no time; the moment was on the
    // ledger row's own `created_at` the whole while and the renderer's fold received it and threw
    // it away. ⛔ The frame still carries no clock — what changed is that the fold reads the
    // envelope, so the binding is `bound` and not `derived`.
    // 🔴 **12 → 11 at `503`, a closure too, and the two numbers below move with it for one
    // reason.** `requests[].actor` was a hole on the premise *"nothing records WHO decided"*;
    // `477` put the caller on `UserDecisionEvent.by` and ended that premise, and `503` drew it —
    // so the slot is `derived` and the v2.3 sentence it made false (*"An answer or denial stays
    // attributed…"*) is `supported`. ⛔ **One correction moves three counts**, which is what these
    // pins are for: a re-filing that touched only one of them would be a map disagreeing with
    // itself about the same repair.
    // 🔴 **11 → 16 at D-016, and it is a REMOVAL, not a re-measurement.** The product has no
    // projects, so v2.3's five `project.*` fields — name, description, folder, verified and the
    // launcher's selection — are holes nothing is meant to close. ⚠️ `project.selection` was
    // `unhoused` (the product had a project select v2.3 did not draw), so it left the count below
    // for this one.
    expect(bindings().filter((binding) => binding.state === 'hole').length, 'holes').toBe(16)
    expect(unhoused().length, 'product facts v2.3 has nowhere to draw').toBe(5)
    // 🔴 **4 → 5 at `532`**: *"A role is display language; it grants nothing."* was `supported`
    // until HO-052 §1 made a category SEED an identity's capability fields at creation, so a
    // person picking `project-manager` at the creation form now grants two of them by doing it.
    // ⛔ **The sentence did not become half-true; the clause it turns on stopped holding** — and
    // this is the first of these five that a PRODUCT change made false rather than an audit.
    // 🔴 **5 → 6 at `733`**: *"Credential file contents are never previewed here."* — the Info
    // panel's config rows open on the app's paper now, `auth.json` included (`731` F-2, R92).
    // 🔴 **6 → 7 at D-016**: *"It does not imply cross-project task assignment, health or
    // orchestration."* closed the project sheet, and D-016 deleted the sheet with projects.
    expect(HAND_CARRIED.filter((sentence) => sentence.verdict === 'false').length, 'false').toBe(7)
    expect(HAND_CARRIED.filter((s) => s.verdict === 'blurred').length, 'blurred').toBe(1)
    // 🔴 **`unsourced` was 2 and is 0 as of 384 §1.1**, which is the one number in this list that
    // moved because a dispatch CLOSED something rather than because it re-measured. Both sentences
    // got a constant and a test — `PROFILE_IS_NOT` and `CREDENTIAL_FILES_ARE_NOT_READ` — and were
    // `supported`; ⚠️ the second went `false` at `733`, with its constant (see the count above).
    expect(HAND_CARRIED.filter((sentence) => sentence.verdict === 'unsourced').length).toBe(0)
    // ⚠️ **And the pair really did move to `supported` rather than leaving the audit**, which a
    // count of zero on its own cannot tell you: a deleted row would satisfy it just as well.
    expect(HAND_CARRIED.length, 'a sentence left the audit instead of being sourced').toBe(21)
    // ⚑ **15 → 16 at `503`** — the `false` above lost the row this gained, and `HAND_CARRIED.length`
    // above is what makes that a MOVE rather than a deletion. ⛔ **16 → 15 at `532`, the same move
    // in the opposite direction**: a role now seeds capability fields, so *"A role is display
    // language; it grants nothing"* left this count for the one above it. ⛔ **15 → 14 at `733`**,
    // the same move again: the credential sentence left it for `false`. ⛔ **14 → 13 at D-016**,
    // the same move once more: the project sheet's closing line left it for `false`.
    expect(HAND_CARRIED.filter((sentence) => sentence.verdict === 'supported').length).toBe(13)
  })

  it('🔴 every `unhoused` fact names the product surface that already has it', () => {
    // ⛔ Without this, `unhoused` would be a second word for `hole` — a place to put a complaint
    // rather than a claim about the product. `378`'s List B was six paragraphs and no pointers.
    const list = unhoused()
    expect(list.length, 'the map found nothing the design has no home for').toBeGreaterThan(3)
    for (const binding of list)
      expect(refsIn(binding).length, JSON.stringify(binding).slice(0, 120)).toBeGreaterThan(0)
  })

  it('⛔ a `hole` states its reason; a `derived` states its derivation', () => {
    for (const binding of bindings()) {
      if (binding.state === 'bound') continue
      expect(binding.note.trim().length, JSON.stringify(binding).slice(0, 120)).toBeGreaterThan(60)
    }
  })

  it('🔴 every `sentence` field is answered — a sentence with no source is a comment', () => {
    // Standing rule 5. A `fact` may be a hole and draw `Unknown`; a SENTENCE that is a hole is copy
    // somebody is about to write into a template, which is the defect this dispatch exists to stop.
    const sentences = V23_FIELD_MAP.filter((entry) => entry.kind === 'sentence')
    expect(sentences.length, 'the map recognises no copy at all').toBeGreaterThan(4)
    for (const entry of sentences)
      expect(refsIn(entry.binding).length, `${entry.path} names no source`).toBeGreaterThan(0)
  })

  it('⛔ every field says what it draws when the product has nothing', () => {
    for (const entry of V23_FIELD_MAP)
      expect(entry.absent.trim().length, entry.path).toBeGreaterThan(3)
  })
})

describe('§5 · the verdicts on the enumerated copy', () => {
  it('⛔ a `supported` verdict names what to render it FROM, and the other two name nothing', () => {
    for (const sentence of HAND_CARRIED) {
      const named = sentence.renderFrom.length
      if (sentence.verdict === 'supported')
        expect(named, `${sentence.quote} — supported but sourceless`).toBeGreaterThan(0)
      // ⚠️ A sentence with any other verdict that named a source would be a contradiction: the
      // source would be the thing that makes it true, and it is not true.
      else expect(named, `${sentence.quote} — ${sentence.verdict} but sourced`).toBe(0)
    }
  })

  it('🔴 the false ones are named, and the count is not zero', () => {
    // ⛔ The positive half of §6's negative. A pass that reported "no false sentences" would be
    // indistinguishable from an audit that never looked, and this dispatch found five.
    const wrong = HAND_CARRIED.filter((sentence) => sentence.verdict === 'false')
    expect(wrong.length).toBeGreaterThan(0)
    for (const sentence of wrong) expect(sentence.why.length, sentence.quote).toBeGreaterThan(120)
  })
})

describe('§6 · §9.2’s count — hand-copied safety strings in the product', () => {
  /**
   * ⛔ **This file is the enumeration and not a render site**, so it is exempt and says so. Nothing
   * else is: a second exemption would be the hole the count exists to close.
   */
  const EXEMPT = 'renderer/src/lib/design-v2-map.ts'

  function rendererAndShared(): { file: string; code: string }[] {
    return ['renderer', 'shared'].flatMap((root) =>
      readdirSync(join(SRC, root), { recursive: true, encoding: 'utf8' })
        .filter((name) => /\.(ts|vue)$/.test(name))
        .map((name) => ({
          file: `${root}/${name.split(/[\\/]/).join('/')}`,
          code: readFileSync(join(SRC, root, name), 'utf8'),
        })),
    )
  }

  it('⛔ ZERO of v2.3’s static sentences have been pasted into the product', () => {
    const every = rendererAndShared()
    const files = every.filter((file) => file.file !== EXEMPT)
    // The non-vacuity floor `a-mode-that-says-what-it-does` uses on the same two trees.
    expect(files.length, 'the walk found no source at all').toBeGreaterThan(50)
    // 🔴 **EXACTLY one file is excused, and this is what says so.** A mutation widening the
    // exemption to the whole of `renderer/src/lib` survived the paste census — of course it did,
    // there is nothing pasted there yet — so the census cannot be the thing that guards its own
    // scope. ⛔ `a-filter-can-blind-the-instrument-that-justifies-it`.
    expect(every.length - files.length, 'more than one file is exempt from the paste census').toBe(
      1,
    )

    const pasted = HAND_CARRIED.flatMap((sentence) =>
      files
        .filter((file) => file.code.includes(sentence.quote))
        .map((file) => `${file.file}: ${sentence.quote}`),
    )
    expect(pasted).toEqual([])
  })

  it('⚠️ the exemption is real, so the walk is not passing because it excluded everything', () => {
    // A control for the exclusion itself: the exempt file DOES contain the sentences, which is why
    // it is exempt — and if it stopped containing them the enumeration would have moved.
    const map = readFileSync(join(SRC, 'renderer/src/lib/design-v2-map.ts'), 'utf8')
    expect(HAND_CARRIED.filter((sentence) => !map.includes(sentence.quote))).toEqual([])
  })
})

describe('§7 · the map itself obeys the rules it is written to enforce', () => {
  it('⛔ it names no provider — the sheet’s two tabs are a `v-for`, not two literals', () => {
    // 039, and the reason it belongs here rather than only in `provider-neutrality.test.ts`: this
    // file is ABOUT per-provider copy, which is the single most tempting place to write one down.
    const code = readFileSync(join(SRC, 'renderer/src/lib/design-v2-map.ts'), 'utf8')
    const withoutProse = code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(withoutProse).not.toMatch(/'(claude|codex)'/)
  })

  it('⛔ every disclosure slot is classified, and each key is built from its provider', () => {
    expect(DISCLOSURE_FIELDS.length).toBe(4)
    expect(DISCLOSURE_FIELDS.filter((slot) => slot.absent.trim().length < 4)).toEqual([])
    // ⛔ **Every key is a TEMPLATE.** The literal check above passes on `'codex.launchDisclosure'`
    // — the name is not the whole quoted string — and a mutation proved it. The rule the sheet
    // has to obey is that the key is built from the provider it is drawn for.
    expect(DISCLOSURE_FIELDS.filter((slot) => !slot.slot.startsWith('<provider>'))).toEqual([])
  })
})
