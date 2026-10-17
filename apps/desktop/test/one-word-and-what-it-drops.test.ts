import { describe, expect, it } from 'vitest'
import {
  BEING_TOKEN,
  NEEDING_TOKEN,
  STANDING_TONE,
  standingOf,
  type AgentFacets,
  type Standing,
} from '../src/renderer/src/lib/agent-state'
import {
  COLLAPSED,
  PRODUCT_STANDINGS,
  SILENT_IS_AMBER_ONLY_ON_THE_PLATE,
  V23_COLOUR,
  V23_HOLES,
  V23_STATES,
  everyFacetState,
  v23StateOf,
} from '../src/renderer/src/lib/status-projection'

/**
 * 🔴 **`384 §1.2` · settling `status`, and MEASURING what the settlement costs.**
 *
 * The decision itself is in `status-projection.ts`'s header: the view model keeps the three facets
 * and v2.3's single `status` is a projection of them. ⛔ **This file is the half the PM asked for
 * that a decision cannot supply on its own** — *"decide it, write down what it loses, and if it
 * loses nothing say that too."* Every number below is computed over the whole facet space; none of
 * it is a claim a reader has to take on trust.
 *
 * ⚠️ **The left-hand column is the design's vocabulary as `status-projection.ts` holds it.** The
 * design drawing is not in the repository, so that table in code is the reference and nothing
 * re-derives it from the drawing.
 */

describe('§1 · the vocabulary being projected onto', () => {
  it('⚠️ twelve words is seven colours, which is a loss the design already carries', () => {
    const byColour = new Map<string, string[]>()
    for (const word of V23_STATES) {
      const colour = V23_COLOUR[word]
      byColour.set(colour, [...(byColour.get(colour) ?? []), word])
    }
    expect([...byColour.keys()].sort()).toEqual([
      'amber',
      'blue',
      'green',
      'grey',
      'orange',
      'red',
      'violet',
    ])
    expect(byColour.get('red')).toEqual(['failed', 'blocked', 'refused'])
    expect(byColour.get('green')).toEqual(['landed', 'finished'])
    expect(byColour.get('grey')).toEqual(['ready', 'record', 'unknown'])
  })
})

describe('§2 · amber survives the projection', () => {
  const SPACE = everyFacetState()

  it('⚑ the space really is every combination this app can hold', () => {
    // 8 doings (7 + absent) × 8 beings × 4 needings (3 + absent) × detached × scheduled × 4 waits
    // (3 + absent). ⚑ **446 added a fifth NEEDING slot** — `441`'s proposal — and **D-016 took it
    // out again** with the proposal itself.
    // ⛔ **636 added the SIXTH AXIS** — {@link AgentFacets.waiting}, the one wait a conversation is
    // in. ⚠️ A space that swept five of six would have gone on passing over `elsewhere` for ever,
    // which is exactly what `250` and `258` each wrote here about the axis before it.
    expect(SPACE.length).toBe(8 * 8 * 4 * 2 * 2 * 4)
  })

  it('🔴 every state that needs a person projects to amber, on both vocabularies', () => {
    // ⛔ **The PM's constraint, as an assertion**: *"if a lossy projection loses amber, it is the
    // wrong projection."* `permission` and `question` are the things a person must clear (`446`'s
    // `proposal` went at D-016); `plan` deliberately is not one (a go-ahead blocks nothing), which
    // is why it is excluded here and not an oversight. ⚑ A go-ahead is an offer the conversation
    // carries on without.
    //
    // ⚑ **D-017b · there is no exception any more.** `standingOf` used to answer
    // `errored`/`ended`/`unstarted` ABOVE `needing`, so this test was titled *LIVE* and enumerated
    // the terminal states apart. Those standings said whether a process runs (`05` rule 5) and
    // went; a conversation nothing is doing anything in reads by the one state like any other, so
    // a card a person owes is amber whatever `being` the facets carry.
    const blocking = SPACE.filter(
      (facets) => facets.needing === 'permission' || facets.needing === 'question',
    )
    expect(blocking.length, 'no blocked states in the space').toBe(
      // 8 doings × 8 beings × 2 blocking needings × detached × scheduled × 4 waits — the whole
      // blocked slice, with no terminal carve-out.
      8 * 8 * 2 * 2 * 2 * 4,
    )
    // ⚠️ **The control for "no exception"**: the space still holds the beings that USED to be the
    // exception, so the loop below really does reach them rather than passing over an empty slice.
    expect(
      blocking.some(
        (facets) =>
          facets.being === 'errored' || facets.being === 'ended' || facets.being === 'unstarted',
      ),
      'the beings that used to be the exception are not in the space',
    ).toBe(true)
    for (const facets of blocking) {
      expect(standingOf(facets), JSON.stringify(facets)).toBe<Standing>('waiting')
      expect(STANDING_TONE.waiting).toBe('waiting')
      expect(v23StateOf(facets), JSON.stringify(facets)).toBe('waiting')
      expect(V23_COLOUR.waiting).toBe('amber')
    }
    // ⚠️ **The control, measured where the two readings diverge.** Without it, a projection that
    // returned `waiting` for everything would pass the loop above.
    const calm = SPACE.filter((facets) => facets.needing === undefined && facets.being === 'live')
    expect(calm.some((facets) => v23StateOf(facets) !== 'waiting')).toBe(true)
  })

  it('⚠️ …and the amber the WORD does lose is the product’s own, not v2.3’s', () => {
    // `silent` is *"working, but nothing has arrived for the stall window"*. The plate underlines it
    // amber; every one-word surface in the shipped app calls it blue `working`. Pinned so a later
    // dispatch that widens the word meets it.
    expect(BEING_TOKEN.silent).toBe('--waiting')
    expect(NEEDING_TOKEN.permission).toBe('--waiting')
    const stalled: AgentFacets = { doing: 'working', being: 'silent' }
    expect(standingOf(stalled)).toBe('working')
    expect(v23StateOf(stalled)).toBe('in-flight')
    expect(V23_COLOUR['in-flight']).toBe('blue')
    expect(SILENT_IS_AMBER_ONLY_ON_THE_PLATE).toBe(true)
  })
})

describe('§3 · what it loses, counted', () => {
  const SPACE = everyFacetState()
  const reached = new Set(SPACE.map((facets) => standingOf(facets)))

  it('⛔ three of the product’s ten words have no word in v2.3, and each has a control behind it', () => {
    // `background` means no active turn but detached work still running, with Stop available
    // in its registry. `scheduled` means the conversation holds a cron. A one-word vocabulary
    // must distinguish both from `idle` or it restores the original state error.
    //
    // 🔴 **636 · the third, and it is the same defect for the third time.** `elsewhere` is
    // `HO-095` §5.1 — *"BroBot's header, avatar and rail row read `Idle` while Task #1 was being
    // worked on by Ada"* — and its control is the Work tab and the conversation the work went to.
    // ⚠️ **The count in this title is checked by the line below it**, so it may not go stale
    // quietly (`a-title-that-names-a-count-the-assertion-never-checks`).
    const homeless = PRODUCT_STANDINGS.filter((standing) => {
      const example = SPACE.find((facets) => standingOf(facets) === standing)
      return example !== undefined && v23StateOf(example) === null
    })
    expect(homeless).toEqual([...V23_HOLES])
    expect(homeless).toEqual(['background', 'scheduled', 'elsewhere'])
  })

  it('🔴 …and the projection erases a difference the product draws a button for', () => {
    // ⛔ **Measured where the two readings DIVERGE**, which is the only place a collapse is visible:
    // one pair of states differing in exactly one field, answered differently by the product and
    // identically by v2.3.
    const idle: AgentFacets = { doing: 'idle', being: 'live' }
    const withWork: AgentFacets = { doing: 'idle', being: 'live', detached: true }
    const withCron: AgentFacets = { doing: 'idle', being: 'live', scheduled: true }

    expect(standingOf(idle)).toBe('idle')
    expect(standingOf(withWork)).toBe('background')
    expect(standingOf(withCron)).toBe('scheduled')

    // v2.3 answers one of the three and refuses the other two rather than guessing at them.
    expect(v23StateOf(idle)).toBe('ready')
    expect(v23StateOf(withWork)).toBeNull()
    expect(v23StateOf(withCron)).toBeNull()
  })

  it('⚠️ …and no grey word stands for two different product states any more', () => {
    // ⚑ **D-017b** — the collapse that looked harmless was *"nothing has run here yet"* and *"the
    // turn is over"*, the same grey `Ready`. `unstarted` said whether a process runs (`05` rule 5)
    // and went, so the list of collapsed pairs is empty — and that emptiness is checked, not
    // trusted: no two standings the space reaches share one v2.3 word.
    expect(COLLAPSED).toEqual([])
    const byWord = new Map<string, Set<Standing>>()
    for (const facets of SPACE) {
      const word = v23StateOf(facets)
      if (word === null) continue
      byWord.set(word, (byWord.get(word) ?? new Set()).add(standingOf(facets)))
    }
    // The control: the projection answers more than one word, or "no word is shared" is vacuous.
    expect(byWord.size, 'the projection answered fewer than two words').toBeGreaterThan(1)
    for (const [word, standings] of byWord) expect([...standings], word).toHaveLength(1)
  })

  it('⚑ the projection never invents a word, and never re-decides the product’s answer', () => {
    for (const facets of SPACE) {
      const word = v23StateOf(facets)
      if (word !== null) expect(V23_STATES).toContain(word)
    }
    // Every standing the app can actually reach is either projected or named a hole — nothing falls
    // through unnamed, which is `an-unenumerated-state-counts-as-success` in the other direction.
    for (const standing of reached) {
      const example = SPACE.find((facets) => standingOf(facets) === standing)!
      const answered = v23StateOf(example) !== null
      expect(answered || V23_HOLES.includes(standing), standing).toBe(true)
    }
    // …and the space really does reach more than a couple of standings.
    expect(reached.size, 'the space collapsed to one standing').toBeGreaterThan(5)
  })
})
